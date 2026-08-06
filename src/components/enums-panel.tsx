import { List, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PanelHeader, PanelSection } from "@/components/ui/panel";
import { DriverFactory } from "@/lib/database-driver";
import { useProjectStore } from "@/stores/project-store";

interface EnumType {
  schema: string;
  name: string;
  labels: string;
}

export function EnumsPanel({ projectId }: { projectId: string }) {
  const projects = useProjectStore((s) => s.projects);
  const details = projects[projectId];

  const [enums, setEnums] = useState<EnumType[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [filter, setFilter] = useState("");

  const refresh = useCallback(async () => {
    if (!details) return;
    setIsLoading(true);
    try {
      const driver = DriverFactory.getDriver(details.driver);
      const result = await driver.loadEnumTypes?.(projectId);
      if (result) {
        setEnums(result.map((r) => ({ schema: r[0], name: r[1], labels: r[2] })));
      }
    } finally {
      setIsLoading(false);
    }
  }, [projectId, details]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const lowerFilter = filter.toLowerCase();
  const filtered = enums.filter(
    (e) =>
      e.name.toLowerCase().includes(lowerFilter) ||
      e.labels.toLowerCase().includes(lowerFilter) ||
      e.schema.toLowerCase().includes(lowerFilter),
  );

  const grouped = new Map<string, EnumType[]>();
  for (const e of filtered) {
    if (!grouped.has(e.schema)) grouped.set(e.schema, []);
    grouped.get(e.schema)?.push(e);
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <PanelHeader
        icon={<List className="h-3.5 w-3.5" />}
        title="Enum Types"
        subtitle={details?.database ?? projectId}
      >
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter..."
          size="sm"
          className="w-48"
        />
        <Button variant="ghost" size="icon-sm" onClick={() => void refresh()} disabled={isLoading}>
          {isLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
        </Button>
      </PanelHeader>

      <div className="flex-1 overflow-auto p-4">
        {Array.from(grouped.entries()).map(([schema, types]) => (
          <PanelSection key={schema} title={schema} className="mb-3">
            <div>
              {types.map((e) => (
                <div
                  key={`${e.schema}.${e.name}`}
                  className="border-b border-border/60 px-3 py-2.5 last:border-b-0 hover:bg-hover"
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <List className="h-3.5 w-3.5 text-primary/60" />
                    <span className="text-xs font-medium">{e.name}</span>
                    <span className="text-3xs text-muted-foreground">
                      {e.labels.split(", ").length} values
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {e.labels.split(", ").map((label) => (
                      <span
                        key={label}
                        className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-3xs text-primary"
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </PanelSection>
        ))}
        {filtered.length === 0 && (
          <div className="py-8 text-center text-xs text-muted-foreground">
            {filter ? "No matching enum types" : "No enum types found"}
          </div>
        )}
      </div>
    </div>
  );
}
