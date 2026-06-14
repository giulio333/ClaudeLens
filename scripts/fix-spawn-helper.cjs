// npm strips the execute bit from node-pty's prebuilt `spawn-helper` when
// unpacking the tarball, which makes every PTY spawn fail with
// "posix_spawnp failed". Restore it after install (no-op on Windows, whose
// prebuilds ship no spawn-helper).
const fs = require('fs');
const path = require('path');

const prebuilds = path.join(__dirname, '..', 'node_modules', 'node-pty', 'prebuilds');
try {
  for (const sub of fs.readdirSync(prebuilds)) {
    const helper = path.join(prebuilds, sub, 'spawn-helper');
    if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755);
  }
} catch {
  // node-pty absent or layout changed — nothing to fix.
}
