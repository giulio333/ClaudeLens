#!/usr/bin/env bash
# PreToolUse hook on Bash: refuses a commit, push, PR, issue or release whose
# content matches a private denylist that lives OUTSIDE the repo.
#
# The repo is public and the app reads this machine's real Claude Code data, so
# the list of names that must never appear here is itself the most sensitive
# file of all — it is never tracked. Default location:
#
#     ~/.config/claudelens/private-terms.regex   (one extended regex per line)
#
# or wherever $CLAUDELENS_PRIVATE_TERMS points. Without the list the hook is a
# no-op, so a contributor's clone is unaffected.
#
# Hooks run in a non-interactive shell: no nvm, no node. Only bash, git, grep
# and python3 (for the JSON on stdin) are used.
set -u

LIST="${CLAUDELENS_PRIVATE_TERMS:-$HOME/.config/claudelens/private-terms.regex}"
[ -r "$LIST" ] || exit 0

CMD=$(python3 -c 'import json,sys
try:
    d = json.load(sys.stdin)
    print(d.get("tool_input", {}).get("command", ""))
except Exception:
    print("")' 2>/dev/null)
[ -n "$CMD" ] || exit 0

scan() {
  # $1: label, stdin: text. Prints the first matches and returns 1 on a hit.
  local label=$1 hits
  hits=$(grep -i -E -n -f "$LIST" 2>/dev/null | head -5)
  if [ -n "$hits" ]; then
    echo "guard-private-terms: private term in $label — refused." >&2
    echo "$hits" | cut -c1-160 >&2
    return 1
  fi
  return 0
}

status=0

# Files whose content the command would publish: -F/--body-file/--notes-file/-f.
for f in $(printf '%s' "$CMD" | grep -o -E '(--body-file|--notes-file|-F|-f)[= ]+[^ ]+' | sed -E 's/^[^ =]+[= ]+//' | tr -d "'\"" ); do
  [ -r "$f" ] && { scan "file $f" < "$f" || status=1; }
done

# Only ADDED lines are scanned: a commit that removes a private term is the one
# commit that must always go through.
case "$CMD" in
  *"git commit"*)
    git diff --cached | grep '^+' | scan "the staged additions" || status=1
    printf '%s' "$CMD" | scan "the commit command" || status=1
    ;;
  *"git push"*)
    git log --branches --not --remotes --format=%B 2>/dev/null | scan "an unpushed commit message" || status=1
    git log --branches --not --remotes -p --format= 2>/dev/null | grep '^+' | scan "an unpushed commit" || status=1
    ;;
  *"gh pr "*|*"gh issue "*|*"gh release "*|*"gh api "*)
    # Local temp paths carry the machine's own names (the scratchpad dir embeds
    # the home path) and never reach GitHub: drop those tokens before scanning.
    printf '%s' "$CMD" | tr ' ' '\n' | grep -v -E '/tmp/|^~/|^\$HOME/' | tr '\n' ' ' \
      | scan "the gh command" || status=1
    ;;
esac

# Exit 2 is the hook protocol for "block this call and show stderr to Claude".
[ "$status" -eq 0 ] || exit 2
exit 0
