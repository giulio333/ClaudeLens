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
// Error reports (`trackError`) go to a second Aptabase endpoint behind the SAME
// opt-out gate. They are the one payload not anonymous by construction — a
// message or stack can carry a path, hence a username and a project name — so
// every field is scrubbed by `shared/error-redact.ts` before it is sent.
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
import { join } from 'path';
import { execFile } from 'child_process';
import { readFile, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { readPrefs, setPref } from './prefs-store';
import { describeError, redactPaths, ERROR_LIMITS } from '../shared/error-redact';

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
const EVENT_PATH = '/api/v0/event';
const ERROR_PATH = '/api/v0/error';
// A render loop that throws can fire the same error hundreds of times a second,
// and the Aptabase error quota is monthly: cap what one run can spend.
const MAX_ERRORS_PER_RUN = 20;
// A fatal error kills the process before an async POST can leave, so it is
// written here synchronously and sent on the next launch instead.
const PENDING_ERROR_FILE = join(os.homedir(), '.claudelens', 'pending-error.json');

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
  props?: Record<string, string | number | boolean>
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
    await post(host, EVENT_PATH, body);
  } catch {
    /* best-effort */
  }
}

/**
 * Report an error to Aptabase. Same opt-out gate as `track()`; the message and
 * stack are scrubbed of every filesystem path first (see `error-redact.ts`).
 * `kind` follows the Aptabase vocabulary: `crash` (the process died),
 * `unhandled` (nothing caught it), `handled` (we caught it and carried on).
 * Fire-and-forget: failures are swallowed.
 */
export async function trackError(
  value: unknown,
  opts: { kind: 'crash' | 'unhandled' | 'handled'; severity?: 'fatal' | 'error' } = {
    kind: 'handled',
  }
): Promise<void> {
  if (!enabled || process.env.SCREENSHOT_MODE) return;
  try {
    await sendError({
      ...scrub(describeError(value)),
      kind: opts.kind,
      severity: opts.severity ?? (opts.kind === 'crash' ? 'fatal' : 'error'),
      timestamp: new Date().toISOString(),
    });
  } catch {
    /* best-effort */
  }
}

/**
 * Record a fatal error synchronously, for the crash paths where the process is
 * about to die and an async POST would never leave. The report is picked up and
 * sent by `flushPendingError()` on the next launch. Written even when opted out
 * is NOT an option: the gate is checked here too, so an opted-out user never
 * has an error report sitting on disk.
 */
export function queueFatalError(value: unknown): void {
  if (!enabled || process.env.SCREENSHOT_MODE) return;
  try {
    const body = {
      ...scrub(describeError(value)),
      kind: 'crash' as const,
      severity: 'fatal' as const,
      timestamp: new Date().toISOString(),
    };
    mkdirSync(join(os.homedir(), '.claudelens'), { recursive: true });
    writeFileSync(PENDING_ERROR_FILE, JSON.stringify(body), 'utf-8');
  } catch {
    /* the app is already dying — never throw from the crash path */
  }
}

/**
 * Send (and clear) the report a previous run left behind when it crashed. The
 * file is deleted first: a report that can't be sent is dropped, never retried
 * into the next launch. No-op when opted out — but the leftover is still
 * removed, so opting out empties the queue too.
 */
export async function flushPendingError(): Promise<void> {
  try {
    if (!existsSync(PENDING_ERROR_FILE)) return;
    const raw = readFileSync(PENDING_ERROR_FILE, 'utf-8');
    unlinkSync(PENDING_ERROR_FILE);
    if (!enabled || process.env.SCREENSHOT_MODE) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.errorMessage !== 'string') return;
    await sendError(parsed as ErrorReport);
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

type ErrorReport = {
  errorType: string;
  errorMessage: string;
  stackTrace?: string;
  kind: 'crash' | 'unhandled' | 'handled';
  severity: 'fatal' | 'error';
  timestamp: string;
};

let errorsSent = 0;
let quotaExhausted = false;
const seenErrors = new Set<string>();

// Scrub every path out of a described error. `app.getAppPath()` is the one
// prefix worth keeping (our own frames stay readable as `<app>/…`); everything
// else — home, projects, ~/.claude — collapses to `<path>`.
function scrub(d: ReturnType<typeof describeError>) {
  const ctx = { home: os.homedir(), appRoot: safeAppPath() };
  return {
    errorType: redactPaths(d.errorType, ctx).slice(0, ERROR_LIMITS.type),
    errorMessage: redactPaths(d.errorMessage, ctx).slice(0, ERROR_LIMITS.message),
    stackTrace: d.stackTrace
      ? redactPaths(d.stackTrace, ctx).slice(0, ERROR_LIMITS.stack)
      : undefined,
  };
}

function safeAppPath(): string | undefined {
  try {
    return app.getAppPath();
  } catch {
    return undefined; // called before `app` is ready (crash path)
  }
}

// POST one error report, deduped by signature and capped per run so a throwing
// loop can't eat the monthly quota. A 403 means the quota IS exhausted — the
// API uses it precisely because it must not be retried — so we stop for good.
async function sendError(report: ErrorReport): Promise<void> {
  const host = ingestHost();
  if (!host || quotaExhausted || errorsSent >= MAX_ERRORS_PER_RUN) return;
  const signature = `${report.errorType}|${report.errorMessage.slice(0, 200)}`;
  if (seenErrors.has(signature)) return;
  seenErrors.add(signature);
  errorsSent += 1;
  if (!systemProps) systemProps = await resolveSystemProps();
  const body = JSON.stringify({
    ...report,
    platform: systemProps.osName,
    osName: systemProps.osName,
    osVersion: systemProps.osVersion,
    appVersion: systemProps.appVersion,
    sdkVersion: SDK_VERSION,
    sessionId,
    isDebug: systemProps.isDebug,
  });
  const status = await post(host, ERROR_PATH, body);
  if (status === 403) quotaExhausted = true;
}

// POST to Aptabase via Node's https (NOT electron.net — see header). Resolves
// with the status code once the request settles (response / error / 2s timeout)
// so callers that must not race process exit (the quit event) can await it.
// Never rejects.
function post(host: string, path: string, body: string): Promise<number | null> {
  return new Promise(resolve => {
    let done = false;
    let status: number | null = null;
    const finish = () => {
      if (done) return;
      done = true;
      resolve(status);
    };
    const req = https.request(
      {
        host,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'App-Key': APP_KEY,
          'Content-Length': Buffer.byteLength(body),
        },
      },
      res => {
        status = res.statusCode ?? null;
        res.resume(); // drain so the socket closes; ignore the response body
        res.on('end', finish);
        res.on('error', finish);
      }
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
