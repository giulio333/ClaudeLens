import { isClaudeCliCommand } from '../electron/modules/process-scanner';

// Which command lines count as a live Claude Code session. This is the legacy
// fallback's identity check (CLI < 2.x, or a registry dir that does not exist
// yet) AND the pid-reuse guard of the 2.x registry reader, so a wrong verdict
// here is a session invented or a session hidden.
//
// The cases below that start with "observed" are real command lines taken off
// this machine while the previous substring match (`\bclaude\b` anywhere in the
// line) reported them as live sessions.

describe('isClaudeCliCommand', () => {
  it('accepts the CLI however it is launched', () => {
    expect(isClaudeCliCommand('claude')).toBe(true);
    expect(isClaudeCliCommand('claude --resume abc')).toBe(true);
    expect(isClaudeCliCommand('/usr/local/bin/claude -p "hello"')).toBe(true);
    // Local installer: the executable lives *inside* ~/.claude, so a rule that
    // simply ignored config paths would lose the real session.
    expect(isClaudeCliCommand('/Users/x/.claude/local/claude')).toBe(true);
    // Through an interpreter.
    expect(
      isClaudeCliCommand('node /Users/x/node_modules/@anthropic-ai/claude-code/cli.js --resume')
    ).toBe(true);
  });

  it('rejects processes that merely mention claude', () => {
    // Observed: cloning a repo whose name contains "claude" counted as three
    // live sessions in the folder the clone was started from — which is what
    // blocked deleting a project that had nothing running in it.
    expect(
      isClaudeCliCommand(
        '/Library/Developer/CommandLineTools/usr/libexec/git-core/git-remote-https origin https://example.com/general/claude-plugins.git'
      )
    ).toBe(false);
    expect(isClaudeCliCommand('grep -rn claude src/')).toBe(false);
    expect(isClaudeCliCommand('/usr/bin/vim /Users/x/.claude/settings.json')).toBe(false);
  });

  it('rejects the shells Claude Code spawns for its own Bash calls', () => {
    // Observed: these inherit the project's cwd, so they read as a session
    // sitting in exactly the folder the user is trying to delete.
    expect(
      isClaudeCliCommand(
        "/bin/zsh -c source /Users/x/.claude/shell-snapshots/snapshot-zsh-1786873209434.sh 2>/dev/null || true && eval 'npm test'"
      )
    ).toBe(false);
  });

  it('rejects the desktop app, ClaudeLens itself and the bg-agent plumbing', () => {
    expect(isClaudeCliCommand('/Applications/Claude.app/Contents/MacOS/Claude')).toBe(false);
    expect(isClaudeCliCommand('/Applications/ClaudeLens.app/Contents/MacOS/ClaudeLens')).toBe(
      false
    );
    expect(isClaudeCliCommand('claude --bg-pty-host')).toBe(false);
    expect(isClaudeCliCommand('')).toBe(false);
  });
});
