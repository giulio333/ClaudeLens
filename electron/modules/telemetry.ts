// Anonymous, privacy-first usage telemetry for Aptabase (https://aptabase.com).
//
// ClaudeLens touches sensitive Claude Code data, so telemetry here is
// deliberately minimal: a single `app_started` event per launch. We attach only
// anonymous system properties (app version, OS name/version, locale, Chromium
// version, a *rotating* session id) — never a persistent user identifier, and
// never anything from `~/.claude/` (no session content, prompts, file paths,
// usernames, project names, or API keys). See PRIVACY.md.
//
// Consent model: OPT-OUT. Telemetry is on by default (legal basis: legitimate
// interest, lawful because the data is anonymous and aggregate) and can be
// turned off at any time in Settings → Privacy.
//
// IMPORTANT — why we DON'T use the official `@aptabase/electron` SDK:
// that SDK sends events via `electron.net.request`, i.e. Chromium's network
// stack. The first such request makes Chromium initialize its encrypted cookie
// store (os_crypt), which on macOS reads a key from the Keychain ("<app> Safe
// Storage") and pops a permission dialog at launch — especially on unsigned
// builds (which is how ClaudeLens ships). To avoid that prompt entirely, we
// post the event with Node's `https` module instead, which never touches
// Chromium or the Keychain. The payload below mirrors the Aptabase ingest API.

import { app } from 'electron';
import https from 'https';
import os from 'os';
import { execFile } from 'child_process';
import { readFile } from 'fs';
import { readPrefs, setPref } from './prefs-store';

// Public Aptabase ingest key (EU data center — the `A-EU-` prefix selects the
// host below). This is a client key meant to be embedded, not a secret.
const APP_KEY = 'A-EU-6837693164';
const REGION_HOSTS: Record<string, string> = {
  US: 'us.aptabase.com',
  EU: 'eu.aptabase.com',
  DEV: 'localhost',
};
const SDK_VERSION = 'claudelens-telemetry@1';
const SESSION_TTL_MS = 60 * 60 * 1000; // rotate the session id after 1h idle

// Opt-out preference, stored in ~/.claudelens/preferences.json (ClaudeLens
// state, not Claude data). Absent → telemetry on (opt-out default).
const PREF_KEY = 'cl-telemetry-enabled';

type SystemProps = {
  isDebug: boolean;
  locale: string;
  osName: string;
  osVersion: string;
  engineName: string;
  engineVersion: string;
  appVersion: string;
  sdkVersion: string;
};

let initialized = false;
let enabled = false;
let systemProps: SystemProps | null = null;
let sessionId = newSessionId();
let lastTouch = 0;
let launchedAt = 0;

function newSessionId(): string {
  const epoch = Math.floor(Date.now() / 1000).toString();
  const rand = Math.floor(Math.random() * 1e8)
    .toString()
    .padStart(8, '0');
  return epoch + rand;
}

function ingestHost(): string | null {
  const region = APP_KEY.split('-')[1];
  return REGION_HOSTS[region] ?? null;
}

/** Whether telemetry is currently enabled. Defaults to ON (opt-out model). */
export function isTelemetryEnabled(): boolean {
  const v = readPrefs()[PREF_KEY];
  return v === undefined || v === null ? true : v === true;
}

/**
 * Initialize the egress gate. Call once, after the app is ready (so
 * `app.getLocale()` / `app.getVersion()` are reliable). Performs no network I/O.
 */
export function initTelemetry(): void {
  if (initialized) return;
  initialized = true;
  launchedAt = Date.now();
  if (process.env.SCREENSHOT_MODE) return;
  enabled = isTelemetryEnabled();
}

/**
 * Record an anonymous event. No-op unless the user is opted in. `props` must be
 * flat string/number/boolean values — never include anything derived from
 * `~/.claude/` content, file paths, or user identity. Fire-and-forget: failures
 * are swallowed so telemetry can never block or break the app.
 */
export async function track(
  eventName: string,
  props?: Record<string, string | number | boolean>,
): Promise<void> {
  if (!enabled || process.env.SCREENSHOT_MODE) return;
  const host = ingestHost();
  if (!host) return;
  try {
    if (!systemProps) systemProps = await resolveSystemProps();
    const now = Date.now();
    if (now - lastTouch > SESSION_TTL_MS) sessionId = newSessionId();
    lastTouch = now;
    const body = JSON.stringify({
      timestamp: new Date().toISOString(),
      sessionId,
      eventName,
      systemProps,
      props: props ?? null,
    });
    await post(host, body);
  } catch {
    /* best-effort */
  }
}

/**
 * Record `app_exited` with how long the app was open, then resolve once the
 * request has actually been sent (or timed out). Awaited on quit so the event
 * isn't cut off by process exit. No-op (resolves instantly) when opted out.
 */
export function trackExit(): Promise<void> {
  const durationSeconds = launchedAt ? Math.round((Date.now() - launchedAt) / 1000) : 0;
  return track('app_exited', { duration_seconds: durationSeconds });
}

/**
 * Flip the opt-out preference at runtime. Persists to disk and updates the
 * egress gate immediately (no restart needed).
 */
export function setTelemetryEnabled(value: boolean): void {
  setPref(PREF_KEY, value);
  enabled = value;
}

// ─── Internals ────────────────────────────────────────────────────────────────

// POST the event to Aptabase via Node's https (NOT electron.net — see header).
// Resolves once the request settles (response / error / 2s timeout) so callers
// that must not race process exit (the quit event) can await it. Never rejects.
function post(host: string, body: string): Promise<void> {
  return new Promise(resolve => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    const req = https.request(
      {
        host,
        path: '/api/v0/event',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'App-Key': APP_KEY,
          'Content-Length': Buffer.byteLength(body),
        },
      },
      res => {
        res.resume(); // drain so the socket closes; ignore the response body
        res.on('end', finish);
        res.on('error', finish);
      },
    );
    req.on('error', finish);
    // Cap the wait so an awaited send (on quit) can't hang shutdown.
    req.setTimeout(2000, () => req.destroy());
    req.write(body);
    req.end();
  });
}

async function resolveSystemProps(): Promise<SystemProps> {
  const [osName, osVersion] = await resolveOs();
  return {
    isDebug: !app.isPackaged, // dev runs land in Aptabase's debug bucket
    locale: app.getLocale() || '',
    osName,
    osVersion,
    engineName: 'Chromium',
    engineVersion: process.versions.chrome,
    appVersion: app.getVersion(),
    sdkVersion: SDK_VERSION,
  };
}

function resolveOs(): Promise<[string, string]> {
  switch (process.platform) {
    case 'win32':
      return Promise.resolve(['Windows', os.release()]);
    case 'darwin':
      return new Promise(resolve => {
        execFile('/usr/bin/sw_vers', ['-productVersion'], (e, out) => {
          resolve(['macOS', e ? '' : out.trim()]);
        });
      });
    default:
      return new Promise(resolve => {
        readFile('/etc/os-release', 'utf8', (e, data) => {
          if (e) return resolve(['Linux', '']);
          const kv: Record<string, string> = {};
          for (const line of data.split('\n')) {
            const [k, v] = line.split('=');
            if (k && v) kv[k] = v.replace(/"/g, '');
          }
          resolve([kv.NAME ?? 'Linux', kv.VERSION_ID ?? '']);
        });
      });
  }
}
