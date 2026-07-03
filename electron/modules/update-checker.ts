// Update check against GitHub Releases.
//
// ClaudeLens ships unsigned (no Apple Developer certificate), so a real
// auto-updater (electron-updater / Squirrel.Mac) is off the table on macOS:
// Squirrel refuses unsigned bundles, and a silently swapped .app would land
// quarantined and refuse to launch anyway. Instead we do the honest version:
// ask the GitHub API for the latest release, compare it to the running
// version, and let the UI point the user at the release page (plus the
// quarantine-clearing command from the README after they install).
//
// Network I/O goes through Node's `https` — same rationale as telemetry.ts:
// `electron.net` would initialize Chromium's cookie store and can pop a macOS
// Keychain prompt on unsigned builds.

import https from 'https';

// GitHub repo the app is released from (also in package.json "repository").
export const RELEASES_REPO = 'giulio333/ClaudeLens';
export const RELEASES_PAGE_URL = `https://github.com/${RELEASES_REPO}/releases`;

const API_HOST = 'api.github.com';
const API_PATH = `/repos/${RELEASES_REPO}/releases/latest`;
const TIMEOUT_MS = 8000;

export interface UpdateInfo {
  /** Version the app is currently running (from package.json). */
  currentVersion: string;
  /** Latest published release version, normalized (no leading `v`). */
  latestVersion: string;
  /** True when `latestVersion` is strictly newer than `currentVersion`. */
  updateAvailable: boolean;
  /** Release title, when the author set one (e.g. "ClaudeLens 2.2.0"). */
  releaseName: string | null;
  /** Web page of the release — where the user downloads the new build. */
  releaseUrl: string;
  publishedAt: string | null;
}

/**
 * Compare two version strings semver-style: negative when a < b, 0 when equal,
 * positive when a > b. Tolerates a leading `v` and compares dot-separated
 * numeric parts; a pre-release suffix (`-beta.1`) sorts *before* its release,
 * per semver. Anything non-numeric in a part is treated as 0.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): { nums: number[]; pre: string } => {
    const cleaned = v.trim().replace(/^v/i, '');
    const [core, ...preParts] = cleaned.split('-');
    const nums = core.split('.').map(p => {
      const n = parseInt(p, 10);
      return Number.isFinite(n) ? n : 0;
    });
    return { nums, pre: preParts.join('-') };
  };
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.nums.length, pb.nums.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa.nums[i] ?? 0) - (pb.nums[i] ?? 0);
    if (diff !== 0) return diff;
  }
  if (pa.pre === pb.pre) return 0;
  if (!pa.pre) return 1; // release > its own pre-release
  if (!pb.pre) return -1;
  return pa.pre < pb.pre ? -1 : 1;
}

/**
 * Map the GitHub `releases/latest` payload to an UpdateInfo, or null when the
 * payload doesn't look like a release (defensive: the API shape is external).
 * `releases/latest` already excludes drafts and pre-releases.
 */
export function parseLatestRelease(payload: unknown, currentVersion: string): UpdateInfo | null {
  if (!payload || typeof payload !== 'object') return null;
  const rel = payload as Record<string, unknown>;
  const tag = typeof rel.tag_name === 'string' ? rel.tag_name.trim() : '';
  if (!/^v?\d+\.\d+(\.\d+)?/.test(tag)) return null;
  const latestVersion = tag.replace(/^v/i, '');
  const releaseUrl =
    typeof rel.html_url === 'string' && rel.html_url.startsWith('https://')
      ? rel.html_url
      : RELEASES_PAGE_URL;
  return {
    currentVersion,
    latestVersion,
    updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
    releaseName: typeof rel.name === 'string' && rel.name.trim() ? rel.name.trim() : null,
    releaseUrl,
    publishedAt: typeof rel.published_at === 'string' ? rel.published_at : null,
  };
}

/**
 * Fetch the latest GitHub release and compare it to `currentVersion`.
 * Rejects on network failure / non-200 / unparsable payload, so callers can
 * distinguish "up to date" from "couldn't check".
 */
export function checkForUpdates(currentVersion: string): Promise<UpdateInfo> {
  return fetchLatestRelease().then(payload => {
    const info = parseLatestRelease(payload, currentVersion);
    if (!info) throw new Error('Unexpected response from the GitHub releases API');
    return info;
  });
}

function fetchLatestRelease(): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: API_HOST,
        path: API_PATH,
        method: 'GET',
        headers: {
          // The GitHub API rejects requests without a User-Agent.
          'User-Agent': 'ClaudeLens-update-check',
          Accept: 'application/vnd.github+json',
        },
      },
      res => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`GitHub releases API responded ${res.statusCode}`));
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error('GitHub releases API returned invalid JSON'));
          }
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('Update check timed out')));
    req.end();
  });
}
