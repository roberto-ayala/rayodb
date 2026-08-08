import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  DbGrant,
  DefaultGrant,
  PgRole,
  ProjectConnectionStatus,
  RoleSpec,
  SchemaGrant,
  SchemaObject,
  TableGrant,
} from "@/types";
import type {
  DatabaseDriver,
  QueryStreamEvent,
  StreamCallbacks,
  WireColumnDetail,
  WireConstraintDetail,
  WireDataTypeInfo,
  WireEventTriggerInfo,
  WireForeignKeyInfo,
  WireForeignTableInfo,
  WireFunctionInfo,
  WireIndexDetail,
  WirePackedResult,
  WirePolicyDetail,
  WireProcedureInfo,
  WireRuleDetail,
  WireSequenceInfo,
  WireTableInfo,
  WireTriggerDetail,
  WireTriggerFunctionInfo,
} from "./index";
import {
  CELL_SEP,
  parseColumnDetails,
  parseConstraintDetails,
  parseDataTypeInfo,
  parseEventTriggerInfo,
  parseForeignTableInfo,
  parseFunctionInfo,
  parseIndexDetails,
  parsePolicyDetails,
  parseProcedureInfo,
  parseRuleDetails,
  parseSequenceInfo,
  parseTriggerDetails,
  parseTriggerFunctionInfo,
  ROW_SEP,
  unpackResult,
} from "./index";

/**
 * The one frontend driver. Every method invokes a `db_*` command, and the
 * backend dispatches on the project's engine, so nothing here is
 * engine-specific — a new driver is a Rust concern, not a class in this file.
 *
 * Methods an engine does not implement reject with `Unsupported`; the UI is
 * expected to gate on capabilities rather than call and catch.
 */
export class IpcDriver implements DatabaseDriver {
  async connect(
    projectId: string,
    key: [string, string, string, string, string, string],
    ssh?: string[],
  ) {
    return invoke<ProjectConnectionStatus>("db_connect", {
      project_id: projectId,
      key,
      ssh: ssh ?? null,
    });
  }
  async disconnect(projectId: string) {
    await invoke("db_disconnect", { project_id: projectId });
  }
  async cancelQuery(projectId: string) {
    return invoke<boolean>("db_cancel_query", { project_id: projectId });
  }
  async loadSchemas(projectId: string) {
    return invoke<string[]>("db_load_schemas", { project_id: projectId });
  }
  async loadTables(projectId: string, schema: string) {
    return invoke<WireTableInfo[]>("db_load_tables", { project_id: projectId, schema });
  }
  async loadColumns(projectId: string, schema: string, table: string) {
    return invoke<string[]>("db_load_columns", { project_id: projectId, schema, table });
  }
  async loadColumnDetails(projectId: string, schema: string, table: string) {
    const wire = await invoke<WireColumnDetail[]>("db_load_column_details", {
      project_id: projectId,
      schema,
      table,
    });
    return parseColumnDetails(wire);
  }
  async loadIndexes(projectId: string, schema: string, table: string) {
    const wire = await invoke<WireIndexDetail[]>("db_load_indexes", {
      project_id: projectId,
      schema,
      table,
    });
    return parseIndexDetails(wire);
  }
  async loadConstraints(projectId: string, schema: string, table: string) {
    const wire = await invoke<WireConstraintDetail[]>("db_load_constraints", {
      project_id: projectId,
      schema,
      table,
    });
    return parseConstraintDetails(wire);
  }
  async loadTriggers(projectId: string, schema: string, table: string) {
    const wire = await invoke<WireTriggerDetail[]>("db_load_triggers", {
      project_id: projectId,
      schema,
      table,
    });
    return parseTriggerDetails(wire);
  }
  async loadRules(projectId: string, schema: string, table: string) {
    const wire = await invoke<WireRuleDetail[]>("db_load_rules", {
      project_id: projectId,
      schema,
      table,
    });
    return parseRuleDetails(wire);
  }
  async loadPolicies(projectId: string, schema: string, table: string) {
    const wire = await invoke<WirePolicyDetail[]>("db_load_policies", {
      project_id: projectId,
      schema,
      table,
    });
    return parsePolicyDetails(wire);
  }
  async loadViews(projectId: string, schema: string) {
    return invoke<string[]>("db_load_views", { project_id: projectId, schema });
  }
  async loadMaterializedViews(projectId: string, schema: string) {
    return invoke<string[]>("db_load_materialized_views", { project_id: projectId, schema });
  }
  async loadSequences(projectId: string, schema: string) {
    const wire = await invoke<WireSequenceInfo[]>("db_load_sequences", {
      project_id: projectId,
      schema,
    });
    return parseSequenceInfo(wire);
  }
  async loadFunctions(projectId: string, schema: string) {
    const wire = await invoke<WireFunctionInfo[]>("db_load_functions", {
      project_id: projectId,
      schema,
    });
    return parseFunctionInfo(wire);
  }
  async loadForeignTables(projectId: string, schema: string) {
    const wire = await invoke<WireForeignTableInfo[]>("db_load_foreign_tables", {
      project_id: projectId,
      schema,
    });
    return parseForeignTableInfo(wire);
  }
  async loadEventTriggers(projectId: string) {
    const wire = await invoke<WireEventTriggerInfo[]>("db_load_event_triggers", {
      project_id: projectId,
    });
    return parseEventTriggerInfo(wire);
  }
  async loadDataTypes(projectId: string, schema: string) {
    const wire = await invoke<WireDataTypeInfo[]>("db_load_data_types", {
      project_id: projectId,
      schema,
    });
    return parseDataTypeInfo(wire);
  }
  async loadProcedures(projectId: string, schema: string) {
    const wire = await invoke<WireProcedureInfo[]>("db_load_procedures", {
      project_id: projectId,
      schema,
    });
    return parseProcedureInfo(wire);
  }
  async loadTriggerFunctions(projectId: string, schema: string) {
    const wire = await invoke<WireTriggerFunctionInfo[]>("db_load_trigger_functions", {
      project_id: projectId,
      schema,
    });
    return parseTriggerFunctionInfo(wire);
  }
  async runQuery(projectId: string, sql: string, timeoutMs?: number) {
    // Use packed format for faster IPC (avoids JSON overhead of nested arrays)
    const [packed, time] = await invoke<WirePackedResult>("db_run_query_packed", {
      project_id: projectId,
      sql,
      timeout_ms: timeoutMs ?? null,
    });
    return unpackResult(packed, time);
  }
  async runQueryStreamed(
    projectId: string,
    sql: string,
    streamId: string,
    { onColumns, onChunk, onDone }: StreamCallbacks,
  ): Promise<void> {
    let resolveStream: () => void;
    let rejectStream: (err: unknown) => void;
    const streamDone = new Promise<void>((resolve, reject) => {
      resolveStream = resolve;
      rejectStream = reject;
    });

    const unlisten = await listen<QueryStreamEvent>(`query-stream-${streamId}`, (event) => {
      const p = event.payload;
      switch (p.type) {
        case "columns": {
          const cols = p.columns ? p.columns.split(CELL_SEP) : [];
          onColumns(cols, p.total_rows);
          break;
        }
        case "chunk": {
          if (p.data) {
            const rows = p.data.split(ROW_SEP).map((r) => r.split(CELL_SEP));
            onChunk(rows);
          }
          break;
        }
        case "done": {
          onDone(p.elapsed, p.capped);
          unlisten();
          resolveStream?.();
          break;
        }
      }
    });

    invoke("db_run_query_streamed", {
      project_id: projectId,
      sql,
      stream_id: streamId,
    }).catch((err) => {
      unlisten();
      rejectStream?.(err);
    });

    return streamDone;
  }
  async executeVirtual(
    projectId: string,
    sql: string,
    queryId: string,
    pageSize: number,
    timeoutMs?: number,
  ) {
    return invoke<[string, number, string, number]>("db_execute_virtual", {
      project_id: projectId,
      sql,
      query_id: queryId,
      page_size: pageSize,
      timeout_ms: timeoutMs ?? null,
    });
  }
  async fetchPage(
    _projectId: string,
    queryId: string,
    colCount: number,
    offset: number,
    limit: number,
  ) {
    return invoke<string>("db_fetch_page", {
      query_id: queryId,
      col_count: colCount,
      offset,
      limit,
    });
  }
  async closeVirtual(_projectId: string, queryId: string) {
    return invoke<void>("db_close_virtual", {
      query_id: queryId,
    });
  }
  async loadActivity(projectId: string) {
    return invoke<string[][]>("db_load_activity", { project_id: projectId });
  }
  async loadDatabaseStats(projectId: string) {
    return invoke<[string, string][]>("db_load_database_stats", { project_id: projectId });
  }
  async loadTableStats(projectId: string) {
    return invoke<string[][]>("db_load_table_stats", { project_id: projectId });
  }
  async loadForeignKeys(projectId: string, schema: string) {
    const wire = await invoke<WireForeignKeyInfo[]>("db_load_foreign_keys", {
      project_id: projectId,
      schema,
    });
    return wire.map(([sourceTable, sourceColumn, targetTable, targetColumn]) => ({
      sourceTable,
      sourceColumn,
      targetTable,
      targetColumn,
    }));
  }
  async loadTableStatistics(projectId: string, schema: string, table: string) {
    return invoke<[string, string][]>("db_table_statistics", {
      project_id: projectId,
      schema,
      table,
    });
  }
  async loadFKDetails(projectId: string, schema: string, table: string, direction: string) {
    return invoke<[string, string, string, string, string, string, string, string, string][]>(
      "db_fk_details",
      { project_id: projectId, schema, table, direction },
    );
  }
  async loadViewInfo(projectId: string, schema: string, view: string) {
    return invoke<[string, string][]>("db_view_info", { project_id: projectId, schema, view });
  }
  async loadMatviewInfo(projectId: string, schema: string, matview: string) {
    return invoke<[string, string][]>("db_matview_info", {
      project_id: projectId,
      schema,
      matview,
    });
  }
  async loadFunctionInfo(projectId: string, schema: string, funcName: string) {
    return invoke<[string, string][]>("db_function_info", {
      project_id: projectId,
      schema,
      func_name: funcName,
    });
  }
  async generateDDL(projectId: string, schema: string, name: string, objectType: string) {
    return invoke<string>("db_generate_ddl", {
      project_id: projectId,
      schema,
      name,
      object_type: objectType,
    });
  }
  async csvPreview(filePath: string) {
    return invoke<[string[], string[][]]>("db_csv_preview", { file_path: filePath });
  }
  async csvImport(
    projectId: string,
    filePath: string,
    schema: string,
    table: string,
    columnMapping: [number, string][],
  ) {
    return invoke<number>("db_csv_import", {
      project_id: projectId,
      file_path: filePath,
      schema,
      table,
      column_mapping: columnMapping,
    });
  }
  async listenStart(projectId: string, channel: string) {
    return invoke<boolean>("db_listen_start", { project_id: projectId, channel });
  }
  async listenStop(projectId: string, channel: string) {
    return invoke<boolean>("db_listen_stop", { project_id: projectId, channel });
  }
  async notifySend(projectId: string, channel: string, payload: string) {
    return invoke<boolean>("db_notify_send", { project_id: projectId, channel, payload });
  }
  async discoverChannels(projectId: string) {
    return invoke<string[]>("db_discover_channels", { project_id: projectId });
  }
  async loadRoles(projectId: string) {
    return invoke<PgRole[]>("db_load_roles", { project_id: projectId });
  }
  async createRole(projectId: string, spec: RoleSpec) {
    return invoke<string>("db_create_role", { project_id: projectId, spec });
  }
  async alterRole(projectId: string, spec: RoleSpec) {
    return invoke<string>("db_alter_role", { project_id: projectId, spec });
  }
  async dropRole(projectId: string, name: string) {
    return invoke<string>("db_drop_role", { project_id: projectId, name });
  }
  async setDatabasePrivilege(
    projectId: string,
    database: string,
    roleName: string,
    privilege: string,
    granted: boolean,
  ) {
    return invoke<string>("db_set_database_privilege", {
      project_id: projectId,
      database,
      role_name: roleName,
      privilege,
      granted,
    });
  }
  async loadSchemaTableGrants(projectId: string, roleName: string) {
    return invoke<SchemaGrant[]>("db_load_schema_table_grants", {
      project_id: projectId,
      role_name: roleName,
    });
  }
  async loadDefaultTableGrants(projectId: string, roleName: string) {
    return invoke<DefaultGrant[]>("db_load_default_table_grants", {
      project_id: projectId,
      role_name: roleName,
    });
  }
  async setSchemaTablePrivilege(
    projectId: string,
    schema: string,
    roleName: string,
    privilege: string,
    granted: boolean,
  ) {
    return invoke<string>("db_set_schema_table_privilege", {
      project_id: projectId,
      schema,
      role_name: roleName,
      privilege,
      granted,
    });
  }
  async setDefaultTablePrivilege(
    projectId: string,
    schema: string,
    roleName: string,
    privilege: string,
    granted: boolean,
  ) {
    return invoke<string>("db_set_default_table_privilege", {
      project_id: projectId,
      schema,
      role_name: roleName,
      privilege,
      granted,
    });
  }
  async revokeTablePrivileges(projectId: string, schema: string, table: string, roleName: string) {
    return invoke<string>("db_revoke_table_privileges", {
      project_id: projectId,
      schema,
      table,
      role_name: roleName,
    });
  }
  async loadTableGrants(projectId: string, roleName: string) {
    return invoke<TableGrant[]>("db_load_table_grants", {
      project_id: projectId,
      role_name: roleName,
    });
  }
  async loadDatabaseGrants(projectId: string, roleName: string) {
    return invoke<DbGrant[]>("db_load_database_grants", {
      project_id: projectId,
      role_name: roleName,
    });
  }
  async extractSchemaObjects(projectId: string, schema: string) {
    return invoke<SchemaObject[]>("db_extract_schema_objects", {
      project_id: projectId,
      schema,
    });
  }
  async loadLocks(projectId: string) {
    return invoke<string[][]>("db_load_locks", { project_id: projectId });
  }
  async loadIndexUsage(projectId: string) {
    return invoke<string[][]>("db_load_index_usage", { project_id: projectId });
  }
  async loadTableBloat(projectId: string) {
    return invoke<string[][]>("db_load_table_bloat", { project_id: projectId });
  }
  async loadDatabases(projectId: string) {
    return invoke<string[]>("db_load_databases", { project_id: projectId });
  }
  async loadTablespaces(projectId: string) {
    return invoke<[string, string, string, string][]>("db_load_tablespaces", {
      project_id: projectId,
    });
  }
  async loadExtensions(projectId: string) {
    return invoke<string[][]>("db_load_extensions", { project_id: projectId });
  }
  async loadAvailableExtensions(projectId: string) {
    return invoke<string[][]>("db_load_available_extensions", { project_id: projectId });
  }
  async loadPgSettings(projectId: string) {
    return invoke<string[][]>("db_load_server_settings", { project_id: projectId });
  }
  async tableAction(
    projectId: string,
    action: string,
    schema: string,
    table: string,
    objectType: string,
  ) {
    return invoke<string>("db_table_action", {
      project_id: projectId,
      action,
      schema,
      table,
      object_type: objectType,
    });
  }
}
