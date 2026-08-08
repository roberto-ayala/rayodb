import { CheckCircle2, Database, Loader2, XCircle } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { useCapabilityStore } from "@/stores/capability-store";
import { testConnection } from "@/tauri";
import type { DriverType, ProjectDetails } from "@/types";
import { Button } from "../ui/button";
import { Dialog, DialogContent } from "../ui/dialog";
import { ModalBanner } from "../ui/modal-banner";
import {
  AutoConnectCheckbox,
  ConnStringField,
  DatabaseField,
  DriverPicker,
  FilePathField,
  HostPortFields,
  NameField,
  PasswordField,
  SslCheckbox,
  UsernameField,
} from "./form-fields";
import { SshConfig } from "./ssh-config";

interface ConnectionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (connection: ConnectionConfig) => void;
  editData?: { name: string; details: ProjectDetails } | null;
  existingNames: string[];
}

export interface ConnectionConfig {
  id: string;
  name: string;
  driver: DriverType;
  /** File-based engines only; empty for a networked server. */
  filePath: string;
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
  ssl: boolean;
  sshEnabled: boolean;
  sshHost: string;
  sshPort: string;
  sshUser: string;
  sshPassword: string;
  sshKeyPath: string;
  autoConnect: boolean;
}

const defaultForm: Omit<ConnectionConfig, "id"> = {
  name: "",
  driver: "PGSQL",
  filePath: "",
  host: "localhost",
  port: "5432",
  database: "",
  username: "",
  password: "",
  ssl: false,
  sshEnabled: false,
  sshHost: "",
  sshPort: "22",
  sshUser: "",
  sshPassword: "",
  sshKeyPath: "",
  autoConnect: false,
};

/** Pull the file path out of the stored options blob, tolerating junk. */
function readFilePath(options: string | undefined): string {
  if (!options) return "";
  try {
    const parsed = JSON.parse(options);
    return typeof parsed?.path === "string" ? parsed.path : "";
  } catch {
    return "";
  }
}

function parseConnectionString(url: string): Partial<Omit<ConnectionConfig, "id">> | null {
  try {
    // Handle postgresql:// and postgres:// schemes
    const normalized = url.trim().replace(/^postgres:\/\//, "postgresql://");
    if (!normalized.startsWith("postgresql://")) return null;
    const parsed = new URL(normalized);
    const params = parsed.searchParams;
    const ssl =
      params.get("sslmode") === "require" ||
      params.get("sslmode") === "verify-full" ||
      params.get("ssl") === "true";
    return {
      driver: "PGSQL",
      host: parsed.hostname || "localhost",
      port: parsed.port || "5432",
      database: parsed.pathname.replace(/^\//, "") || "",
      username: decodeURIComponent(parsed.username || ""),
      password: decodeURIComponent(parsed.password || ""),
      ssl,
    };
  } catch {
    return null;
  }
}

export function ConnectionModal({
  open,
  onOpenChange,
  onSave,
  editData,
  existingNames,
}: ConnectionModalProps) {
  const [formData, setFormData] = useState<Omit<ConnectionConfig, "id">>(defaultForm);
  const [connString, setConnString] = useState("");
  const [connStringError, setConnStringError] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (open && editData) {
      setFormData({
        name: editData.name,
        driver: editData.details.driver,
        filePath: readFilePath(editData.details.options),
        host: editData.details.host,
        port: editData.details.port,
        database: editData.details.database,
        username: editData.details.username,
        password: editData.details.password,
        ssl: editData.details.ssl === "true",
        sshEnabled: editData.details.sshEnabled === "true",
        sshHost: editData.details.sshHost || "",
        sshPort: editData.details.sshPort || "22",
        sshUser: editData.details.sshUser || "",
        sshPassword: editData.details.sshPassword || "",
        sshKeyPath: editData.details.sshKeyPath || "",
        autoConnect: editData.details.autoConnect === "true",
      });
      setConnString("");
      setConnStringError(false);
      setTestResult(null);
    } else if (open && !editData) {
      // Default to the first engine that actually ships rather than a
      // hardcoded one, so the form is right the day a second driver lands.
      const first = useCapabilityStore.getState().drivers[0];
      setFormData(
        first
          ? { ...defaultForm, driver: first.id, port: first.defaultPort || defaultForm.port }
          : defaultForm,
      );
      setConnString("");
      setConnStringError(false);
      setTestResult(null);
    }
  }, [open, editData]);

  const handleConnStringPaste = (value: string) => {
    setConnString(value);
    setConnStringError(false);
    if (!value.trim()) return;
    const parsed = parseConnectionString(value);
    if (parsed) {
      setFormData((prev) => ({ ...prev, ...parsed, name: prev.name || parsed.database || "" }));
    } else {
      setConnStringError(true);
    }
  };

  const drivers = useCapabilityStore((s) => s.drivers);
  const isFileBased = drivers.find((d) => d.id === formData.driver)?.fileBased ?? false;

  const isEditing = !!editData;
  const name = formData.name.trim();
  const nameTaken = name !== editData?.name && existingNames.includes(name);

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const key: [string, string, string, string, string, string] = [
        formData.username,
        formData.password,
        // A file-based engine has a path where a server has a database name.
        isFileBased ? formData.filePath : formData.database,
        formData.host,
        formData.port,
        formData.ssl ? "true" : "false",
      ];
      const version = await testConnection(formData.driver, key);
      setTestResult({ ok: true, message: version });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setTestResult({ ok: false, message: msg });
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (nameTaken) return;
    const connection: ConnectionConfig = {
      ...formData,
      name,
      id: editData ? editData.name : `conn-${Date.now()}`,
    };
    onSave(connection);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[500px]">
        <ModalBanner
          className="shrink-0"
          icon={<Database className="h-5 w-5 text-primary" />}
          title={isEditing ? editData.name : "New Connection"}
          badge={formData.driver}
          description={isEditing ? "Update connection details" : "Add a new database connection"}
        />
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {!isEditing && (
              <ConnStringField
                value={connString}
                onChange={handleConnStringPaste}
                error={connStringError}
              />
            )}

            <DriverPicker
              driver={formData.driver}
              drivers={drivers}
              onChange={(driver) =>
                setFormData((prev) => ({
                  ...prev,
                  driver,
                  // Carry the new engine's default rather than leaving the old
                  // one's port sitting in the field.
                  port: drivers.find((d) => d.id === driver)?.defaultPort ?? prev.port,
                }))
              }
            />

            <NameField
              value={formData.name}
              onChange={(value) => setFormData({ ...formData, name: value })}
              error={nameTaken ? "A connection with this name already exists" : undefined}
            />

            {isFileBased ? (
              <FilePathField
                value={formData.filePath}
                onChange={(value) => setFormData({ ...formData, filePath: value })}
              />
            ) : (
              <>
                <HostPortFields
                  host={formData.host}
                  port={formData.port}
                  onHostChange={(value) => setFormData({ ...formData, host: value })}
                  onPortChange={(value) => setFormData({ ...formData, port: value })}
                />

                <DatabaseField
                  value={formData.database}
                  onChange={(value) => setFormData({ ...formData, database: value })}
                />

                <UsernameField
                  value={formData.username}
                  onChange={(value) => setFormData({ ...formData, username: value })}
                  driver={formData.driver}
                />

                <PasswordField
                  value={formData.password}
                  onChange={(value) => setFormData({ ...formData, password: value })}
                />

                <SslCheckbox
                  checked={formData.ssl}
                  onChange={(checked) => setFormData({ ...formData, ssl: checked })}
                />
              </>
            )}

            <AutoConnectCheckbox
              checked={formData.autoConnect}
              onChange={(checked) => setFormData({ ...formData, autoConnect: checked })}
            />

            <SshConfig
              enabled={formData.sshEnabled}
              sshHost={formData.sshHost}
              sshPort={formData.sshPort}
              sshUser={formData.sshUser}
              sshPassword={formData.sshPassword}
              sshKeyPath={formData.sshKeyPath}
              onEnabledChange={(checked) => setFormData({ ...formData, sshEnabled: checked })}
              onSshHostChange={(value) => setFormData({ ...formData, sshHost: value })}
              onSshPortChange={(value) => setFormData({ ...formData, sshPort: value })}
              onSshUserChange={(value) => setFormData({ ...formData, sshUser: value })}
              onSshPasswordChange={(value) => setFormData({ ...formData, sshPassword: value })}
              onSshKeyPathChange={(value) => setFormData({ ...formData, sshKeyPath: value })}
            />

            {testResult && (
              <div
                className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${
                  testResult.ok
                    ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-500"
                    : "border-destructive/30 bg-destructive/5 text-destructive"
                }`}
              >
                {testResult.ok ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                )}
                <span className="break-all">{testResult.message}</span>
              </div>
            )}
          </div>

          <div className="flex shrink-0 justify-between border-border border-t px-5 py-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleTestConnection()}
              disabled={testing || !formData.host || !formData.database}
              className="text-xs"
            >
              {testing && <Loader2 className="h-3 w-3 animate-spin mr-1.5" />}
              Test Connection
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                className="text-xs"
              >
                Cancel
              </Button>
              <Button type="submit" variant="default" className="text-xs" disabled={nameTaken}>
                {isEditing ? "Save Changes" : "Connect"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
