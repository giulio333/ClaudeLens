interface DeleteProjectDialogProps {
  project: { hash: string; realPath: string };
  isLoading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteProjectDialog({
  project,
  isLoading,
  onConfirm,
  onCancel,
}: DeleteProjectDialogProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[var(--cl-paper-2)] rounded-lg shadow-lg p-6 max-w-md w-full mx-4">
        <h3 className="text-[15px] font-semibold text-[var(--cl-ink)] mb-2">Delete project?</h3>
        <p className="text-[13px] text-[var(--cl-ink-3)] mb-4">
          This action will permanently delete the folder:
        </p>
        <div className="bg-[var(--cl-paper-3)] border border-[var(--cl-line)] rounded-lg p-3 mb-6 font-mono text-[11px] text-[var(--cl-ink-3)] break-words">
          ~/.claude/projects/{project.hash}
        </div>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2 rounded-lg border border-[var(--cl-line)] hover:bg-[var(--cl-paper-3)] transition-colors text-[13px] font-medium text-[var(--cl-ink-3)]"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className="flex-1 px-4 py-2 rounded-lg bg-[var(--cl-danger)] hover:bg-[var(--cl-danger)] disabled:opacity-50 transition-colors text-[13px] font-medium text-white"
          >
            {isLoading ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
