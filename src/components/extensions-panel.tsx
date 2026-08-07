import { ArrowUpCircle, Check, Download, Loader2, Package, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ModalBanner } from "@/components/ui/modal-banner";
import {
  PanelCard,
  PanelHeader,
  PanelSection,
  PanelToolbar,
  SegmentedTabs,
} from "@/components/ui/panel";
import { DriverFactory } from "@/lib/database-driver";
import { useProjectStore } from "@/stores/project-store";

interface Extension {
  name: string;
  installedVersion: string;
  defaultVersion: string;
  comment: string;
  schema: string;
}

interface AvailableExtension {
  name: string;
  version: string;
  comment: string;
}

export function ExtensionsPanel({ projectId }: { projectId: string }) {
  const projects = useProjectStore((s) => s.projects);
  const details = projects[projectId];

  const [installed, setInstalled] = useState<Extension[]>([]);
  const [available, setAvailable] = useState<AvailableExtension[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [tab, setTab] = useState<"installed" | "available">("installed");

  const refresh = useCallback(async () => {
    if (!details) return;
    setIsLoading(true);
    try {
      const driver = DriverFactory.getDriver(details.driver);
      const [inst, avail] = await Promise.allSettled([
        driver.loadExtensions?.(projectId),
        driver.loadAvailableExtensions?.(projectId),
      ]);
      if (inst.status === "fulfilled" && inst.value) {
        setInstalled(
          inst.value.map((r) => ({
            name: r[0],
            installedVersion: r[1],
            defaultVersion: r[2],
            comment: r[3],
            schema: r[4],
          })),
        );
      }
      if (avail.status === "fulfilled" && avail.value) {
        setAvailable(
          avail.value.map((r) => ({
            name: r[0],
            version: r[1],
            comment: r[2],
          })),
        );
      }
    } finally {
      setIsLoading(false);
    }
  }, [projectId, details]);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDrop, setConfirmDrop] = useState<string | null>(null);
  const [confirmInstall, setConfirmInstall] = useState<string | null>(null);

  const execSQL = useCallback(
    async (sql: string, extName: string) => {
      if (!details) return;
      setBusy(extName);
      setError(null);
      try {
        const driver = DriverFactory.getDriver(details.driver);
        await driver.runQuery(projectId, sql);
        await refresh();
      } catch (err: any) {
        setError(`${extName}: ${err?.message ?? String(err)}`);
      } finally {
        setBusy(null);
      }
    },
    [details, projectId, refresh],
  );

  const installExt = useCallback((name: string) => {
    setConfirmInstall(name);
  }, []);

  const confirmInstallExt = useCallback(() => {
    if (!confirmInstall) return;
    setConfirmInstall(null);
    void execSQL(`CREATE EXTENSION IF NOT EXISTS "${confirmInstall}";`, confirmInstall);
  }, [confirmInstall, execSQL]);

  const dropExt = useCallback((name: string) => {
    setConfirmDrop(name);
  }, []);

  const confirmDropExt = useCallback(() => {
    if (!confirmDrop) return;
    setConfirmDrop(null);
    void execSQL(`DROP EXTENSION IF EXISTS "${confirmDrop}" CASCADE;`, confirmDrop);
  }, [confirmDrop, execSQL]);

  const updateExt = useCallback(
    (name: string) => {
      void execSQL(`ALTER EXTENSION "${name}" UPDATE;`, name);
    },
    [execSQL],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const lowerFilter = filter.toLowerCase();
  const filteredInstalled = installed.filter(
    (e) =>
      e.name.toLowerCase().includes(lowerFilter) || e.comment.toLowerCase().includes(lowerFilter),
  );
  const filteredAvailable = available.filter(
    (e) =>
      e.name.toLowerCase().includes(lowerFilter) || e.comment.toLowerCase().includes(lowerFilter),
  );

  return (
    <div className="flex h-full flex-col bg-background">
      <PanelHeader
        icon={<Package className="h-3.5 w-3.5" />}
        title="Extensions"
        subtitle={details?.database ?? projectId}
      >
        <Button variant="ghost" size="icon-sm" onClick={() => void refresh()} disabled={isLoading}>
          {isLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
        </Button>
      </PanelHeader>

      <PanelToolbar>
        <SegmentedTabs
          tabs={[
            { id: "installed" as const, label: "Installed", count: installed.length },
            { id: "available" as const, label: "Available", count: available.length },
          ]}
          value={tab}
          onChange={setTab}
        />
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter..."
          size="sm"
          className="ml-auto w-48"
        />
      </PanelToolbar>

      {error && (
        <div className="mx-4 mt-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2">
          <span className="text-xs text-destructive">{error}</span>
        </div>
      )}

      <div className="flex-1 overflow-auto p-4">
        {tab === "installed" && (
          <PanelSection
            title={`Installed (${filteredInstalled.length})`}
            icon={<Package className="h-3 w-3" />}
          >
            <PanelCard>
              {filteredInstalled.map((ext) => (
                <div
                  key={ext.name}
                  className="border-b border-border/60 px-3 py-2.5 transition-colors last:border-b-0 hover:bg-hover"
                >
                  <div className="flex items-center gap-2">
                    <Check className="h-3.5 w-3.5 text-green-500" />
                    <span className="text-sm font-medium">{ext.name}</span>
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-3xs text-primary">
                      {ext.installedVersion}
                    </span>
                    {ext.defaultVersion && ext.defaultVersion !== ext.installedVersion && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-yellow-700 dark:text-yellow-400 hover:bg-yellow-100 dark:hover:bg-yellow-900/30"
                        onClick={() => updateExt(ext.name)}
                        disabled={busy === ext.name}
                      >
                        {busy === ext.name ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <ArrowUpCircle className="h-3 w-3" />
                        )}
                        Update to {ext.defaultVersion}
                      </Button>
                    )}
                    <span className="ml-auto flex items-center gap-2">
                      <span className="text-3xs text-muted-foreground">{ext.schema}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-destructive"
                        onClick={() => dropExt(ext.name)}
                        disabled={busy === ext.name}
                        title={`DROP EXTENSION "${ext.name}"`}
                      >
                        {busy === ext.name ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Trash2 className="h-3 w-3" />
                        )}
                      </Button>
                    </span>
                  </div>
                  {ext.comment && (
                    <p className="mt-1 text-xs text-muted-foreground">{ext.comment}</p>
                  )}
                </div>
              ))}
              {filteredInstalled.length === 0 && (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  {filter ? "No matching extensions" : "No extensions installed"}
                </div>
              )}
            </PanelCard>
          </PanelSection>
        )}

        {tab === "available" && (
          <PanelSection
            title={`Available (${filteredAvailable.length})`}
            icon={<Package className="h-3 w-3" />}
          >
            <PanelCard>
              {filteredAvailable.map((ext) => (
                <div
                  key={ext.name}
                  className="border-b border-border/60 px-3 py-2.5 transition-colors last:border-b-0 hover:bg-hover"
                >
                  <div className="flex items-center gap-2">
                    <Download className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-sm font-medium">{ext.name}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-3xs text-muted-foreground">
                      {ext.version}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="ml-auto"
                      onClick={() => installExt(ext.name)}
                      disabled={busy === ext.name}
                    >
                      {busy === ext.name ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Download className="h-3 w-3" />
                      )}
                      Install
                    </Button>
                  </div>
                  {ext.comment && (
                    <p className="mt-1 text-xs text-muted-foreground">{ext.comment}</p>
                  )}
                </div>
              ))}
              {filteredAvailable.length === 0 && (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  {filter ? "No matching extensions" : "No available extensions"}
                </div>
              )}
            </PanelCard>
          </PanelSection>
        )}
      </div>

      <Dialog
        open={!!confirmInstall}
        onOpenChange={(open) => {
          if (!open) setConfirmInstall(null);
        }}
      >
        <DialogContent className="gap-0 p-0 sm:max-w-[420px]">
          <ModalBanner
            icon={<Package className="h-5 w-5 text-primary" />}
            title="Install Extension"
            badge="Extension"
            description={confirmInstall ?? ""}
          />
          <div className="space-y-4 px-5 py-4">
            <div className="rounded-lg border border-border bg-muted/20 p-3 font-mono text-xs text-muted-foreground">
              CREATE EXTENSION IF NOT EXISTS "{confirmInstall}";
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" className="text-xs" onClick={() => setConfirmInstall(null)}>
                Cancel
              </Button>
              <Button variant="default" className="text-xs" onClick={confirmInstallExt}>
                Install
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!confirmDrop}
        onOpenChange={(open) => {
          if (!open) setConfirmDrop(null);
        }}
      >
        <DialogContent className="gap-0 p-0 sm:max-w-[420px]">
          <ModalBanner
            icon={<Package className="h-5 w-5 text-destructive" />}
            title="Drop Extension"
            badge="Extension"
            description={confirmDrop ?? ""}
          />
          <div className="space-y-4 px-5 py-4">
            <p className="text-xs text-muted-foreground">
              Everything that depends on it goes too — the statement runs with CASCADE.
            </p>
            <div className="rounded-lg border border-border bg-muted/20 p-3 font-mono text-xs text-muted-foreground">
              DROP EXTENSION IF EXISTS "{confirmDrop}" CASCADE;
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" className="text-xs" onClick={() => setConfirmDrop(null)}>
                Cancel
              </Button>
              <Button variant="destructive" className="text-xs" onClick={confirmDropExt}>
                Drop Extension
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
