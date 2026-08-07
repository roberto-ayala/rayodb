import {
  Copy,
  ExternalLink,
  Eye,
  FileCode,
  FileUp,
  FolderOpen,
  Grid2x2,
  Hash,
  Layers,
  Plus,
  RefreshCw,
  Settings2,
  Shapes,
  SquarePlay,
  Table,
  Unlink,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ProjectConnectionStatus, type TableInfo } from "@/types";
import { I, INDENT_STEP } from "./constants";
import {
  ddlFunctionQuery,
  ddlTableQuery,
  ddlViewQuery,
  detachPartitionTemplate,
  newDataTypeTemplate,
  newForeignTableTemplate,
  newFunctionTemplate,
  newMatViewTemplate,
  newPartitionedTableTemplate,
  newPartitionTemplate,
  newProcedureTemplate,
  newSequenceTemplate,
  newTableTemplate,
  newTriggerFunctionTemplate,
  newViewTemplate,
} from "./ddl-queries";
import { renderTableDetails } from "./render-table-details";
import { SectionHeader } from "./section-header";
import { TreeRow } from "./tree-row";
import type { SidebarRenderCtx } from "./types";

/**
 * A table row, its columns, and — when it is partitioned — its partitions
 * nested underneath, each rendered the same way so sub-partitions work too.
 * Every level of nesting is two indent steps: one for the section, one for the
 * rows under it.
 */
function renderTable(
  ctx: SidebarRenderCtx,
  pid: string,
  schema: string,
  ti: TableInfo,
  partitionsOf: Map<string, TableInfo[]>,
  depth: number,
) {
  const {
    loading,
    selectedItem,
    setSelectedItem,
    setCsvImportTarget,
    openProperties,
    isOpen,
    toggle,
    onExpandTable,
    onPreviewTableQuery,
    onOpenTableQuery,
    onPinPreview,
    openTab,
    loadColumns,
    showMenu,
    copy,
  } = ctx;

  const tKey = `table::${pid}::${schema}::${ti.name}`;
  const isTableOpen = isOpen(tKey);
  const partitions = partitionsOf.get(ti.name) ?? [];
  const offset = depth * 2 * INDENT_STEP;

  return (
    <div key={ti.name}>
      <TreeRow
        indent={I.table + offset}
        icon={
          partitions.length > 0 ? (
            <Grid2x2 className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <Table className="h-3.5 w-3.5 text-muted-foreground" />
          )
        }
        label={ti.name}
        expanded={isTableOpen}
        loading={loading[tKey]}
        selected={selectedItem === tKey}
        onClick={() => {
          setSelectedItem(tKey);
          onPreviewTableQuery(pid, schema, ti.name);
        }}
        onDoubleClick={onPinPreview}
        onToggle={() => {
          setSelectedItem(tKey);
          onExpandTable(pid, schema, ti.name);
        }}
        onContextMenu={(e) => {
          setSelectedItem(tKey);
          showMenu(e, [
            { header: "Query" },
            {
              label: "SELECT TOP 100",
              icon: <Table className="h-3 w-3" />,
              onClick: () => onOpenTableQuery(pid, schema, ti.name),
            },
            {
              label: "SELECT COUNT(*)",
              icon: <Table className="h-3 w-3" />,
              onClick: () => openTab(pid, `SELECT COUNT(*) FROM "${schema}"."${ti.name}";`),
            },
            { separator: true as const },
            {
              label: "Import CSV",
              icon: <FileUp className="h-3 w-3" />,
              onClick: () => {
                void loadColumns(pid, schema, ti.name).then((cols) => {
                  setCsvImportTarget({
                    projectId: pid,
                    schema,
                    table: ti.name,
                    columns: cols,
                  });
                });
              },
            },
            ...(ti.partitionKey
              ? [
                  { separator: true as const },
                  {
                    label: "New Partition…",
                    icon: <Grid2x2 className="h-3 w-3" />,
                    onClick: () =>
                      openTab(
                        pid,
                        newPartitionTemplate(
                          schema,
                          ti.name,
                          ti.partitionKey,
                          partitions.map((p) => p.bound).filter(Boolean),
                        ),
                        { title: `New partition of ${ti.name}` },
                      ),
                  },
                ]
              : []),
            ...(ti.parent
              ? [
                  { separator: true as const },
                  {
                    label: "Detach Partition…",
                    icon: <Unlink className="h-3 w-3" />,
                    onClick: () =>
                      openTab(pid, detachPartitionTemplate(schema, ti.parent, ti.name), {
                        title: `Detach ${ti.name}`,
                      }),
                  },
                ]
              : []),
            { separator: true as const },
            {
              label: "Properties",
              icon: <Settings2 className="h-3 w-3" />,
              onClick: () => openProperties("table", pid, schema, ti.name),
            },
            {
              label: "Show CREATE TABLE",
              icon: <FileCode className="h-3 w-3" />,
              onClick: () => openTab(pid, ddlTableQuery(schema, ti.name)),
            },
            { separator: true as const },
            {
              label: "Copy Name",
              icon: <Copy className="h-3 w-3" />,
              onClick: () => copy(`"${schema}"."${ti.name}"`),
              shortcut: navigator.platform.includes("Mac") ? "\u2318C" : "Ctrl+C",
            },
          ]);
        }}
        meta={
          ti.bound ? (
            <>
              {ti.size}
              {/* What the partition actually holds, which its name only claims */}
              <span className="ml-1.5 text-muted-foreground/50">
                {ti.bound.replace(/^FOR VALUES /, "")}
              </span>
            </>
          ) : (
            ti.size
          )
        }
      />
      {isTableOpen && (
        <>
          {renderTableDetails(ctx, pid, schema, ti.name, offset)}
          {partitions.length > 0 && (
            <>
              <SectionHeader
                indent={I.section + offset}
                label={`Partitions (${partitions.length})`}
                icon={<Grid2x2 className="h-3 w-3" />}
                sectionKey={`${tKey}::parts`}
                expanded={isOpen(`${tKey}::parts`, true)}
                onClick={() => toggle(`${tKey}::parts`, true)}
              />
              {isOpen(`${tKey}::parts`, true) &&
                partitions.map((part) =>
                  renderTable(ctx, pid, schema, part, partitionsOf, depth + 1),
                )}
            </>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The category's own action: creating the first object of its kind. It has to
 * live on the category, because an empty one is exactly where there is nothing
 * else to right-click.
 */
function newObjectMenu(
  ctx: SidebarRenderCtx,
  pid: string,
  label: string,
  icon: React.ReactNode,
  sql: string,
  title: string,
) {
  return (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    ctx.showMenu(e, [{ label, icon, onClick: () => ctx.openTab(pid, sql, { title }) }]);
  };
}

/** Render schemas + tables/views/functions for a connected database project */
export function renderSchemas(ctx: SidebarRenderCtx, pid: string) {
  const {
    schemas,
    status,
    tables,
    views,
    materializedViews,
    sequences,
    functions,
    procedures,
    dataTypes,
    foreignTables,
    triggerFunctions,
    loading,
    selectedItem,
    setSelectedItem,
    openProperties,
    isOpen,
    toggle,
    onExpandSchema,
    onOpenTableQuery,
    onPreviewTableQuery,
    onPinPreview,
    openTab,
    openERDTab,
    showMenu,
    copy,
  } = ctx;

  const projectSchemas = schemas[pid] || [];
  const isConnected = status[pid] === ProjectConnectionStatus.Connected;
  if (!isConnected || !projectSchemas.length) return null;

  return projectSchemas.map((schema) => {
    const sKey = `schema::${pid}::${schema}`;
    const schemaStoreKey = `${pid}::${schema}`;
    const schemaTables = tables[schemaStoreKey];
    const schemaViews = views[schemaStoreKey];
    const schemaMatViews = materializedViews[schemaStoreKey];
    const schemaSequences = sequences[schemaStoreKey];
    const schemaFns = functions[schemaStoreKey];
    const schemaProcs = procedures[schemaStoreKey];
    const schemaDataTypes = dataTypes[schemaStoreKey];
    const schemaForeignTables = foreignTables[schemaStoreKey];

    // Partitions are tables too, so the flat listing carries them; group them
    // under the table they belong to instead of repeating them at top level.
    const partitionsOf = new Map<string, TableInfo[]>();
    for (const ti of schemaTables ?? []) {
      if (!ti.parent) continue;
      const siblings = partitionsOf.get(ti.parent) ?? [];
      siblings.push(ti);
      partitionsOf.set(ti.parent, siblings);
    }
    const rootTables = (schemaTables ?? []).filter((ti) => !ti.parent);
    const schemaTrigFns = triggerFunctions[schemaStoreKey];
    const isSchemaOpen = isOpen(sKey);

    return (
      <div key={schema}>
        <TreeRow
          indent={I.schema}
          icon={<FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />}
          label={schema}
          expanded={isSchemaOpen}
          loading={loading[sKey]}
          onClick={() => onExpandSchema(pid, schema)}
          onContextMenu={(e) =>
            showMenu(e, [
              {
                label: "ERD Diagram",
                icon: <Layers className="h-3 w-3" />,
                onClick: () => openERDTab(pid, schema),
              },
              {
                label: "Copy Schema Name",
                icon: <Copy className="h-3 w-3" />,
                onClick: () => copy(schema),
              },
              {
                label: "New Query",
                icon: <Plus className="h-3 w-3" />,
                onClick: () => openTab(pid, `-- Schema: ${schema}\n`),
              },
            ])
          }
        />

        {isSchemaOpen && (
          <>
            {/* Tables category */}
            <SectionHeader
              indent={I.schemaObj}
              label={`Tables${schemaTables ? ` (${rootTables.length})` : ""}`}
              icon={<Table className="h-3 w-3" />}
              sectionKey={`${sKey}::tables`}
              expanded={isOpen(`${sKey}::tables`, true)}
              onClick={() => toggle(`${sKey}::tables`, true)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                showMenu(e, [
                  {
                    label: "New Table…",
                    icon: <Table className="h-3 w-3" />,
                    onClick: () => openTab(pid, newTableTemplate(schema), { title: "New table" }),
                  },
                  {
                    label: "New Partitioned Table…",
                    icon: <Grid2x2 className="h-3 w-3" />,
                    onClick: () =>
                      openTab(pid, newPartitionedTableTemplate(schema), {
                        title: "New partitioned table",
                      }),
                  },
                ]);
              }}
            />
            {isOpen(`${sKey}::tables`, true) &&
              rootTables.map((ti) => renderTable(ctx, pid, schema, ti, partitionsOf, 0))}

            {/* Foreign Tables category */}
            {schemaForeignTables && schemaForeignTables.length > 0 && (
              <>
                <SectionHeader
                  indent={I.schemaObj}
                  label={`Foreign Tables (${schemaForeignTables.length})`}
                  icon={<ExternalLink className="h-3 w-3" />}
                  sectionKey={`${sKey}::ftables`}
                  expanded={isOpen(`${sKey}::ftables`)}
                  onClick={() => toggle(`${sKey}::ftables`)}
                  onContextMenu={newObjectMenu(
                    ctx,
                    pid,
                    "New Foreign Table…",
                    <ExternalLink className="h-3 w-3" />,
                    newForeignTableTemplate(schema),
                    "New foreign table",
                  )}
                />
                {isOpen(`${sKey}::ftables`) &&
                  schemaForeignTables.map((ft) => {
                    const ftKey = `ftable::${pid}::${schema}::${ft.name}`;
                    return (
                      <TreeRow
                        key={ft.name}
                        indent={I.table}
                        icon={<ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />}
                        label={ft.name}
                        meta={ft.server}
                        selected={selectedItem === ftKey}
                        onClick={() => {
                          setSelectedItem(ftKey);
                          onPreviewTableQuery(pid, schema, ft.name);
                        }}
                        onDoubleClick={onPinPreview}
                        onContextMenu={(e) => {
                          setSelectedItem(ftKey);
                          showMenu(e, [
                            {
                              label: "SELECT TOP 100",
                              icon: <ExternalLink className="h-3 w-3" />,
                              onClick: () => onOpenTableQuery(pid, schema, ft.name),
                            },
                            { separator: true as const },
                            {
                              label: "Copy Name",
                              icon: <Copy className="h-3 w-3" />,
                              onClick: () => copy(`"${schema}"."${ft.name}"`),
                            },
                          ]);
                        }}
                      />
                    );
                  })}
              </>
            )}

            {/* Views category */}
            {schemaViews && schemaViews.length > 0 && (
              <>
                <SectionHeader
                  indent={I.schemaObj}
                  label={`Views (${schemaViews.length})`}
                  icon={<Eye className="h-3 w-3" />}
                  sectionKey={`${sKey}::views`}
                  expanded={isOpen(`${sKey}::views`)}
                  onClick={() => toggle(`${sKey}::views`)}
                  onContextMenu={newObjectMenu(
                    ctx,
                    pid,
                    "New View…",
                    <Eye className="h-3 w-3" />,
                    newViewTemplate(schema),
                    "New view",
                  )}
                />
                {isOpen(`${sKey}::views`) &&
                  schemaViews.map((v) => {
                    const vKey = `view::${pid}::${schema}::${v}`;
                    return (
                      <TreeRow
                        key={v}
                        indent={I.table}
                        icon={<Eye className="h-3.5 w-3.5 text-muted-foreground" />}
                        label={v}
                        selected={selectedItem === vKey}
                        onClick={() => {
                          setSelectedItem(vKey);
                          onPreviewTableQuery(pid, schema, v);
                        }}
                        onDoubleClick={onPinPreview}
                        onContextMenu={(e) => {
                          setSelectedItem(vKey);
                          showMenu(e, [
                            {
                              label: "SELECT TOP 100",
                              icon: <Eye className="h-3 w-3" />,
                              onClick: () => onOpenTableQuery(pid, schema, v),
                            },
                            { separator: true as const },
                            {
                              label: "Properties",
                              icon: <Settings2 className="h-3 w-3" />,
                              onClick: () => openProperties("view", pid, schema, v),
                            },
                            {
                              label: "Show CREATE VIEW",
                              icon: <FileCode className="h-3 w-3" />,
                              onClick: () => openTab(pid, ddlViewQuery(schema, v)),
                            },
                            { separator: true as const },
                            {
                              label: "Copy Name",
                              icon: <Copy className="h-3 w-3" />,
                              onClick: () => copy(`"${schema}"."${v}"`),
                            },
                          ]);
                        }}
                      />
                    );
                  })}
              </>
            )}

            {/* Materialized Views category */}
            {schemaMatViews && schemaMatViews.length > 0 && (
              <>
                <SectionHeader
                  indent={I.schemaObj}
                  label={`Materialized Views (${schemaMatViews.length})`}
                  icon={<Layers className="h-3 w-3" />}
                  sectionKey={`${sKey}::matviews`}
                  expanded={isOpen(`${sKey}::matviews`)}
                  onClick={() => toggle(`${sKey}::matviews`)}
                  onContextMenu={newObjectMenu(
                    ctx,
                    pid,
                    "New Materialized View…",
                    <Layers className="h-3 w-3" />,
                    newMatViewTemplate(schema),
                    "New materialized view",
                  )}
                />
                {isOpen(`${sKey}::matviews`) &&
                  schemaMatViews.map((mv) => {
                    const mvKey = `matview::${pid}::${schema}::${mv}`;
                    return (
                      <TreeRow
                        key={mv}
                        indent={I.table}
                        icon={<Layers className="h-3.5 w-3.5 text-muted-foreground" />}
                        label={mv}
                        selected={selectedItem === mvKey}
                        onClick={() => {
                          setSelectedItem(mvKey);
                          onPreviewTableQuery(pid, schema, mv);
                        }}
                        onDoubleClick={onPinPreview}
                        onContextMenu={(e) => {
                          setSelectedItem(mvKey);
                          showMenu(e, [
                            {
                              label: "SELECT TOP 100",
                              icon: <Layers className="h-3 w-3" />,
                              onClick: () => onOpenTableQuery(pid, schema, mv),
                            },
                            {
                              label: "REFRESH",
                              icon: <RefreshCw className="h-3 w-3" />,
                              onClick: () =>
                                openTab(pid, `REFRESH MATERIALIZED VIEW "${schema}"."${mv}";`),
                            },
                            { separator: true as const },
                            {
                              label: "Properties",
                              icon: <Settings2 className="h-3 w-3" />,
                              onClick: () => openProperties("matview", pid, schema, mv),
                            },
                            { separator: true as const },
                            {
                              label: "Copy Name",
                              icon: <Copy className="h-3 w-3" />,
                              onClick: () => copy(`"${schema}"."${mv}"`),
                            },
                          ]);
                        }}
                      />
                    );
                  })}
              </>
            )}

            {/* Sequences category */}
            {schemaSequences && schemaSequences.length > 0 && (
              <>
                <SectionHeader
                  indent={I.schemaObj}
                  label={`Sequences (${schemaSequences.length})`}
                  icon={<Hash className="h-3 w-3" />}
                  sectionKey={`${sKey}::seqs`}
                  expanded={isOpen(`${sKey}::seqs`)}
                  onClick={() => toggle(`${sKey}::seqs`)}
                  onContextMenu={newObjectMenu(
                    ctx,
                    pid,
                    "New Sequence…",
                    <Hash className="h-3 w-3" />,
                    newSequenceTemplate(schema),
                    "New sequence",
                  )}
                />
                {isOpen(`${sKey}::seqs`) &&
                  schemaSequences.map((seq) => {
                    const seqKey = `sequence::${pid}::${schema}::${seq.name}`;
                    return (
                      <TreeRow
                        key={seq.name}
                        indent={I.table}
                        icon={<Hash className="h-3.5 w-3.5 text-muted-foreground" />}
                        label={seq.name}
                        meta={seq.lastValue}
                        selected={selectedItem === seqKey}
                        onClick={() => {
                          setSelectedItem(seqKey);
                          onPreviewTableQuery(pid, schema, seq.name);
                        }}
                        onDoubleClick={onPinPreview}
                        onContextMenu={(e) => {
                          setSelectedItem(seqKey);
                          showMenu(e, [
                            {
                              label: "Show State",
                              icon: <Hash className="h-3 w-3" />,
                              onClick: () => onOpenTableQuery(pid, schema, seq.name),
                            },
                            {
                              label: "SELECT nextval",
                              icon: <Hash className="h-3 w-3" />,
                              onClick: () =>
                                openTab(pid, `SELECT nextval('"${schema}"."${seq.name}"');`),
                            },
                            { separator: true as const },
                            {
                              label: "Copy Name",
                              icon: <Copy className="h-3 w-3" />,
                              onClick: () => copy(`"${schema}"."${seq.name}"`),
                            },
                          ]);
                        }}
                      />
                    );
                  })}
              </>
            )}

            {/* Functions category */}
            {schemaFns && schemaFns.length > 0 && (
              <>
                <SectionHeader
                  indent={I.schemaObj}
                  label={`Functions (${schemaFns.length})`}
                  icon={<FileCode className="h-3 w-3" />}
                  sectionKey={`${sKey}::fns`}
                  expanded={isOpen(`${sKey}::fns`)}
                  onClick={() => toggle(`${sKey}::fns`)}
                  onContextMenu={newObjectMenu(
                    ctx,
                    pid,
                    "New Function…",
                    <FileCode className="h-3 w-3" />,
                    newFunctionTemplate(schema),
                    "New function",
                  )}
                />
                {isOpen(`${sKey}::fns`) &&
                  schemaFns.map((fn, i) => {
                    const fnKey = `fn::${pid}::${schema}::${fn.name}::${i}`;
                    return (
                      <div
                        key={`${fn.name}-${i}`}
                        className={cn(
                          "relative flex items-center gap-1.5 py-0.5 rounded-sm whitespace-nowrap select-none",
                          selectedItem === fnKey ? "bg-primary/10" : "hover:bg-sidebar-accent",
                        )}
                        style={{ paddingLeft: `${I.table}px` }}
                        onClick={() => setSelectedItem(fnKey)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setSelectedItem(fnKey);
                          showMenu(e, [
                            {
                              label: "Show Definition",
                              icon: <FileCode className="h-3 w-3" />,
                              onClick: () => openTab(pid, ddlFunctionQuery(schema, fn.name)),
                            },
                            {
                              label: "Properties",
                              icon: <Settings2 className="h-3 w-3" />,
                              onClick: () => openProperties("function", pid, schema, fn.name),
                            },
                            { separator: true as const },
                            {
                              label: "Copy Name",
                              icon: <Copy className="h-3 w-3" />,
                              onClick: () => copy(fn.name),
                            },
                          ]);
                        }}
                      >
                        <FileCode className="h-3 w-3 shrink-0 text-muted-foreground/50" />
                        <span className="text-xs text-foreground">
                          {fn.name}({fn.arguments ? "..." : ""})
                        </span>
                        <span className="text-3xs text-muted-foreground">{fn.returnType}</span>
                      </div>
                    );
                  })}
              </>
            )}

            {/* Procedures category */}
            {schemaProcs && schemaProcs.length > 0 && (
              <>
                <SectionHeader
                  indent={I.schemaObj}
                  label={`Procedures (${schemaProcs.length})`}
                  icon={<SquarePlay className="h-3 w-3" />}
                  sectionKey={`${sKey}::procs`}
                  expanded={isOpen(`${sKey}::procs`)}
                  onClick={() => toggle(`${sKey}::procs`)}
                  onContextMenu={newObjectMenu(
                    ctx,
                    pid,
                    "New Procedure…",
                    <SquarePlay className="h-3 w-3" />,
                    newProcedureTemplate(schema),
                    "New procedure",
                  )}
                />
                {isOpen(`${sKey}::procs`) &&
                  schemaProcs.map((proc, i) => {
                    const procKey = `procedure::${pid}::${schema}::${proc.name}::${i}`;
                    return (
                      // biome-ignore lint/a11y/noStaticElementInteractions: mirrors the function rows — selection and a context menu, no primary action
                      <div
                        key={`${proc.name}-${i}`}
                        className={cn(
                          "relative flex items-center gap-1.5 py-0.5 rounded-sm whitespace-nowrap select-none",
                          selectedItem === procKey ? "bg-primary/10" : "hover:bg-sidebar-accent",
                        )}
                        style={{ paddingLeft: `${I.table}px` }}
                        onClick={() => setSelectedItem(procKey)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setSelectedItem(procKey);
                          showMenu(e, [
                            {
                              label: "CALL",
                              icon: <SquarePlay className="h-3 w-3" />,
                              // The signature goes on its own line: a trailing
                              // comment would swallow the closing paren.
                              onClick: () =>
                                openTab(
                                  pid,
                                  proc.arguments
                                    ? `-- arguments: ${proc.arguments}\nCALL "${schema}"."${proc.name}"();`
                                    : `CALL "${schema}"."${proc.name}"();`,
                                ),
                            },
                            {
                              label: "Show Definition",
                              icon: <FileCode className="h-3 w-3" />,
                              onClick: () => openTab(pid, ddlFunctionQuery(schema, proc.name)),
                            },
                            { separator: true as const },
                            {
                              label: "Copy Name",
                              icon: <Copy className="h-3 w-3" />,
                              onClick: () => copy(proc.name),
                            },
                          ]);
                        }}
                      >
                        <SquarePlay className="h-3 w-3 shrink-0 text-muted-foreground/50" />
                        <span className="text-xs text-foreground">
                          {proc.name}({proc.arguments ? "..." : ""})
                        </span>
                      </div>
                    );
                  })}
              </>
            )}

            {/* Data Types category */}
            {schemaDataTypes && schemaDataTypes.length > 0 && (
              <>
                <SectionHeader
                  indent={I.schemaObj}
                  label={`Data Types (${schemaDataTypes.length})`}
                  icon={<Shapes className="h-3 w-3" />}
                  sectionKey={`${sKey}::types`}
                  expanded={isOpen(`${sKey}::types`)}
                  onClick={() => toggle(`${sKey}::types`)}
                  onContextMenu={newObjectMenu(
                    ctx,
                    pid,
                    "New Data Type…",
                    <Shapes className="h-3 w-3" />,
                    newDataTypeTemplate(schema),
                    "New data type",
                  )}
                />
                {isOpen(`${sKey}::types`) &&
                  schemaDataTypes.map((dt) => {
                    const dtKey = `datatype::${pid}::${schema}::${dt.name}`;
                    return (
                      // biome-ignore lint/a11y/noStaticElementInteractions: a type is a label — selection and a context menu, no primary action
                      <div
                        key={dt.name}
                        className={cn(
                          "relative flex items-center gap-1.5 py-0.5 rounded-sm whitespace-nowrap select-none",
                          selectedItem === dtKey ? "bg-primary/10" : "hover:bg-sidebar-accent",
                        )}
                        style={{ paddingLeft: `${I.table}px` }}
                        onClick={() => setSelectedItem(dtKey)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setSelectedItem(dtKey);
                          showMenu(e, [
                            { header: dt.kind },
                            {
                              label: "Copy Name",
                              icon: <Copy className="h-3 w-3" />,
                              onClick: () => copy(`"${schema}"."${dt.name}"`),
                            },
                            ...(dt.detail
                              ? [
                                  {
                                    label: dt.kind === "enum" ? "Copy Labels" : "Copy Definition",
                                    icon: <Copy className="h-3 w-3" />,
                                    onClick: () => copy(dt.detail),
                                  },
                                ]
                              : []),
                          ]);
                        }}
                      >
                        <Shapes className="h-3 w-3 shrink-0 text-muted-foreground/50" />
                        <span className="text-xs text-foreground">{dt.name}</span>
                        <span className="text-3xs text-muted-foreground">{dt.kind}</span>
                        {dt.detail && (
                          <span className="max-w-64 truncate text-3xs text-muted-foreground/40">
                            {dt.detail}
                          </span>
                        )}
                      </div>
                    );
                  })}
              </>
            )}

            {/* Trigger Functions category */}
            {schemaTrigFns && schemaTrigFns.length > 0 && (
              <>
                <SectionHeader
                  indent={I.schemaObj}
                  label={`Trigger Functions (${schemaTrigFns.length})`}
                  icon={<Zap className="h-3 w-3" />}
                  sectionKey={`${sKey}::trigfns`}
                  expanded={isOpen(`${sKey}::trigfns`)}
                  onClick={() => toggle(`${sKey}::trigfns`)}
                  onContextMenu={newObjectMenu(
                    ctx,
                    pid,
                    "New Trigger Function…",
                    <Zap className="h-3 w-3" />,
                    newTriggerFunctionTemplate(schema),
                    "New trigger function",
                  )}
                />
                {isOpen(`${sKey}::trigfns`) &&
                  schemaTrigFns.map((fn, i) => {
                    const tfKey = `trigfn::${pid}::${schema}::${fn.name}::${i}`;
                    return (
                      <div
                        key={`${fn.name}-${i}`}
                        className={cn(
                          "relative flex items-center gap-1.5 py-0.5 rounded-sm whitespace-nowrap select-none",
                          selectedItem === tfKey ? "bg-primary/10" : "hover:bg-sidebar-accent",
                        )}
                        style={{ paddingLeft: `${I.table}px` }}
                        onClick={() => setSelectedItem(tfKey)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setSelectedItem(tfKey);
                          showMenu(e, [
                            {
                              label: "Show Definition",
                              icon: <FileCode className="h-3 w-3" />,
                              onClick: () => openTab(pid, ddlFunctionQuery(schema, fn.name)),
                            },
                            {
                              label: "Properties",
                              icon: <Settings2 className="h-3 w-3" />,
                              onClick: () =>
                                openProperties("trigger-function", pid, schema, fn.name),
                            },
                            { separator: true as const },
                            {
                              label: "Copy Name",
                              icon: <Copy className="h-3 w-3" />,
                              onClick: () => copy(fn.name),
                            },
                          ]);
                        }}
                      >
                        <Zap className="h-3 w-3 shrink-0 text-muted-foreground/50" />
                        <span className="text-xs text-foreground">{fn.name}()</span>
                        <span className="text-3xs text-muted-foreground">
                          {fn.kind === "event_trigger" ? "event trigger" : "trigger"}
                        </span>
                      </div>
                    );
                  })}
              </>
            )}
          </>
        )}
      </div>
    );
  });
}
