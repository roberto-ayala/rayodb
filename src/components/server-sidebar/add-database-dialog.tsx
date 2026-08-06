import React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { ProjectDetails } from "@/types";

export function AddDatabaseDialog({
  open,
  onOpenChange,
  sourceProjectId,
  projects,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceProjectId: string;
  projects: Record<string, ProjectDetails>;
  onAdd: (name: string, database: string) => Promise<void>;
}) {
  const [dbName, setDbName] = React.useState("");
  const [connName, setConnName] = React.useState("");
  const source = projects[sourceProjectId];

  React.useEffect(() => {
    if (open) {
      setDbName("");
      setConnName("");
    }
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!dbName.trim()) return;
    void onAdd(connName.trim() || dbName.trim(), dbName.trim());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="">Add Database</DialogTitle>
          <DialogDescription>
            Add a database to{" "}
            <span className="font-semibold text-foreground">
              {source?.host}:{source?.port}
            </span>
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="mt-2 space-y-4">
          <Field label="Database Name" htmlFor="addDbName">
            <Input
              id="addDbName"
              value={dbName}
              onChange={(e) => {
                setDbName(e.target.value);
                if (!connName) setConnName("");
              }}
              placeholder="analytics_db"
              autoFocus
            />
          </Field>
          <Field label="Connection Name" htmlFor="addConnName">
            <Input
              id="addConnName"
              value={connName}
              onChange={(e) => setConnName(e.target.value)}
              placeholder={dbName || "optional"}
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              className="text-xs"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" variant="default" className="text-xs" disabled={!dbName.trim()}>
              Add
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
