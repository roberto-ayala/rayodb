import { Loader2, Save, Trash2, X } from "lucide-react";
import { Button } from "../ui/button";
import { Dialog, DialogContent } from "../ui/dialog";
import { ModalBanner } from "../ui/modal-banner";
import type { EditState } from "./types";

interface ToolbarEditProps {
  editState: EditState | null;
  editError: string | null;
  isCommitting: boolean;
  pendingDeleteCount: number;
  onCommit: () => void;
  onDeleteRows: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onDiscard: () => void;
}

export function ToolbarEdit({
  editState,
  editError,
  isCommitting,
  pendingDeleteCount,
  onCommit,
  onDeleteRows,
  onConfirmDelete,
  onCancelDelete,
  onDiscard,
}: ToolbarEditProps) {
  return (
    <>
      {editError && (
        <span className="text-xs text-destructive max-w-[200px] truncate" title={editError}>
          {editError}
        </span>
      )}
      <button
        type="button"
        onClick={onCommit}
        disabled={(editState?.cellEdits.size ?? 0) === 0 || isCommitting}
        className="flex items-center gap-1 px-2.5 py-1 rounded text-xs bg-success text-success-foreground hover:bg-success/90 transition-colors disabled:opacity-50"
      >
        {isCommitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
        Commit
      </button>
      <button
        type="button"
        onClick={onDeleteRows}
        disabled={(editState?.deletedRows.size ?? 0) === 0 || isCommitting}
        className="flex items-center gap-1 px-2.5 py-1 rounded text-xs border border-destructive/50 text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
      >
        <Trash2 className="h-3 w-3" />
        Delete ({editState?.deletedRows.size ?? 0})
      </button>
      <Dialog
        open={pendingDeleteCount > 0}
        onOpenChange={(open) => {
          if (!open) onCancelDelete();
        }}
      >
        <DialogContent className="gap-0 p-0 sm:max-w-[420px]">
          <ModalBanner
            icon={<Trash2 className="h-5 w-5 text-destructive" />}
            title="Delete rows"
            badge="Rows"
            description={`${pendingDeleteCount} selected`}
          />
          <div className="space-y-4 px-5 py-4">
            <p className="text-xs text-muted-foreground">
              {pendingDeleteCount} row{pendingDeleteCount !== 1 ? "s" : ""} will be deleted
              permanently. This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" className="text-xs" onClick={onCancelDelete}>
                Cancel
              </Button>
              <Button variant="destructive" className="text-xs" onClick={onConfirmDelete}>
                Delete {pendingDeleteCount} row{pendingDeleteCount !== 1 ? "s" : ""}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <button
        type="button"
        onClick={onDiscard}
        disabled={isCommitting}
        className="flex items-center gap-1 px-2.5 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
      >
        <X className="h-3 w-3" />
        Discard
      </button>
    </>
  );
}
