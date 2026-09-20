# Prompt Playbook (#282)

Reuse static prompts in Mission Control and the SDK composer, scoped to the
current project. English UI; existing brand tokens only.

Mission Control opens Playbook in its side rail via a book icon in the header.
The SDK composer opens a popover. The shared panel offers Saved and Suggested
lists, manual creation, editing,
deletion, promotion, dismissal and system clipboard copy. Templates live under
`~/.claudelens/playbook/<hash>/`, never under `~/.claude`. Dismissal fingerprints
persist; computed candidates do not. Compare case-sensitive text after whitespace
normalization, retain original formatting, require three distinct sessions and
exclude short and technical/non-human messages. Read the existing transcript
parsers, including queued human messages. Bound scans and disclose partial results.

Compute suggestions lazily when the panel opens. No background transcript scan
while it is closed. Save operations invalidate the project-specific cache.

Use appends to the SDK composer's current draft without sending. In Mission
Control, Use reveals/mounts Terminal and pastes through xterm, waiting for the
CLI's bracketed-paste readiness. Lens remains a read-only transcript. Failure,
exit and navigation cancel pending insertion; no prompt is submitted automatically.

Validate project hashes, template IDs and input sizes at IPC/storage boundaries.
Atomic writes and serialized mutations preserve data; corrupt stores report an
error rather than being replaced. Tests use synthetic fixtures shaped like real
data, temporary directories and StrictMode renderer mounts. Probe the real local
corpus read-only and report aggregate counts only.
