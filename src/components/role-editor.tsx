import { Loader2, Shield, ShieldCheck, User, Users } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { CheckboxField, Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ModalBanner } from "@/components/ui/modal-banner";
import { cn } from "@/lib/utils";
import type { PgRole, RoleSpec } from "@/types";

const EMPTY: RoleSpec = {
  name: "",
  login: true,
  superuser: false,
  create_db: false,
  create_role: false,
  inherit: true,
  replication: false,
  bypass_rls: false,
  conn_limit: -1,
  valid_until: "",
  password: "",
  member_of: [],
};

function specFrom(role: PgRole): RoleSpec {
  return {
    name: role.name,
    login: role.login,
    superuser: role.superuser,
    create_db: role.create_db,
    create_role: role.create_role,
    inherit: role.inherit,
    replication: role.replication,
    bypass_rls: role.bypass_rls,
    conn_limit: role.conn_limit,
    valid_until: role.valid_until,
    password: "",
    member_of: role.member_of,
  };
}

export function RoleEditor({
  open,
  onOpenChange,
  editing,
  roles,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The role being edited, or null when creating one */
  editing: PgRole | null;
  /** Every role on the server, to pick group memberships from */
  roles: PgRole[];
  onSave: (spec: RoleSpec) => Promise<void>;
}) {
  const [form, setForm] = useState<RoleSpec>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(editing ? specFrom(editing) : EMPTY);
    setError(null);
  }, [open, editing]);

  const isEditing = !!editing;
  const name = form.name.trim();
  const nameTaken = !isEditing && roles.some((r) => r.name === name);

  const set = <K extends keyof RoleSpec>(key: K, value: RoleSpec[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const toggleGroup = (group: string) =>
    setForm((f) => ({
      ...f,
      member_of: f.member_of.includes(group)
        ? f.member_of.filter((g) => g !== group)
        : [...f.member_of, group],
    }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (nameTaken || !name) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({ ...form, name });
      onOpenChange(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  // A role cannot be a member of itself, and groups are what you join
  const groupOptions = roles.filter((r) => r.name !== editing?.name);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[560px]">
        <ModalBanner
          className="shrink-0"
          icon={
            form.superuser ? (
              <ShieldCheck className="h-5 w-5 text-warning" />
            ) : form.login ? (
              <User className="h-5 w-5 text-primary" />
            ) : (
              <Users className="h-5 w-5 text-muted-foreground" />
            )
          }
          title={isEditing ? editing.name : "New Role"}
          badge={form.login ? "Login role" : "Group role"}
          description={
            isEditing
              ? "Attributes, password and group memberships"
              : "A login role is a user; without LOGIN it is a group"
          }
        />

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
            <Field
              label="Role Name"
              htmlFor="role-name"
              error={nameTaken ? "A role with this name already exists" : undefined}
            >
              <Input
                id="role-name"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="app_user"
                required
                // Renaming is a separate operation in Postgres and clears an
                // md5 password, so an edit keeps the name it was opened with
                disabled={isEditing}
                className={nameTaken ? "border-destructive" : undefined}
              />
            </Field>

            <Field
              label="Password"
              htmlFor="role-password"
              hint={isEditing ? "Leave empty to keep the current password" : undefined}
            >
              <Input
                id="role-password"
                type="password"
                value={form.password}
                onChange={(e) => set("password", e.target.value)}
                placeholder="••••••••"
              />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Connection Limit" htmlFor="role-conn-limit" hint="-1 is unlimited">
                <Input
                  id="role-conn-limit"
                  type="number"
                  value={String(form.conn_limit)}
                  onChange={(e) => set("conn_limit", Number(e.target.value))}
                />
              </Field>
              <Field label="Valid Until" htmlFor="role-valid-until" hint="Empty never expires">
                <Input
                  id="role-valid-until"
                  value={form.valid_until}
                  onChange={(e) => set("valid_until", e.target.value)}
                  placeholder="2027-01-01"
                />
              </Field>
            </div>

            <div className="space-y-2">
              <div className="text-3xs font-semibold uppercase tracking-widest text-muted-foreground">
                Attributes
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border border-border bg-muted/20 p-3">
                <CheckboxField
                  id="role-login"
                  label="LOGIN"
                  checked={form.login}
                  onChange={(v) => set("login", v)}
                />
                <CheckboxField
                  id="role-inherit"
                  label="INHERIT"
                  checked={form.inherit}
                  onChange={(v) => set("inherit", v)}
                />
                <CheckboxField
                  id="role-createdb"
                  label="CREATEDB"
                  checked={form.create_db}
                  onChange={(v) => set("create_db", v)}
                />
                <CheckboxField
                  id="role-createrole"
                  label="CREATEROLE"
                  checked={form.create_role}
                  onChange={(v) => set("create_role", v)}
                />
                <CheckboxField
                  id="role-replication"
                  label="REPLICATION"
                  checked={form.replication}
                  onChange={(v) => set("replication", v)}
                />
                <CheckboxField
                  id="role-bypassrls"
                  label="BYPASSRLS"
                  checked={form.bypass_rls}
                  onChange={(v) => set("bypass_rls", v)}
                />
                <CheckboxField
                  id="role-superuser"
                  label="SUPERUSER"
                  checked={form.superuser}
                  onChange={(v) => set("superuser", v)}
                />
              </div>
              {form.superuser && (
                <p className="flex items-start gap-1.5 text-xs text-warning">
                  <Shield className="mt-0.5 h-3 w-3 shrink-0" />A superuser bypasses every
                  permission check, including row level security.
                </p>
              )}
            </div>

            {groupOptions.length > 0 && (
              <div className="space-y-2">
                <div className="text-3xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Member of
                </div>
                <div className="flex flex-wrap gap-1.5 rounded-lg border border-border bg-muted/20 p-3">
                  {groupOptions.map((r) => {
                    const active = form.member_of.includes(r.name);
                    return (
                      <button
                        key={r.name}
                        type="button"
                        onClick={() => toggleGroup(r.name)}
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-xs transition-colors",
                          active
                            ? "border-primary/20 bg-primary/10 text-primary"
                            : "border-border/60 bg-muted/30 text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {r.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}
          </div>

          <div className="flex shrink-0 justify-end gap-2 border-border border-t px-5 py-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="default"
              className="text-xs"
              disabled={saving || nameTaken}
            >
              {saving && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
              {isEditing ? "Save Changes" : "Create Role"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
