import { invoke } from "@tauri-apps/api/core";
import type { DriverType } from "@/types";

/**
 * What an engine supports. Mirrors `drivers::capabilities::Capabilities` in
 * Rust, which is the source of truth — the backend declares this once and the
 * UI reads it, so a driver can never claim a feature it has not implemented.
 *
 * Gate on these rather than on the driver name: `caps.materializedViews`, not
 * `driver === "PGSQL"`. The former keeps working when the next engine arrives.
 */
export interface DriverCapabilities {
  // schema tree
  schemas: boolean;
  materializedViews: boolean;
  sequences: boolean;
  functions: boolean;
  procedures: boolean;
  dataTypes: boolean;
  foreignTables: boolean;
  triggerFunctions: boolean;
  eventTriggers: boolean;
  partitions: boolean;

  // per-table detail
  triggers: boolean;
  rules: boolean;
  policies: boolean;

  // server-level panels
  databases: boolean;
  tablespaces: boolean;
  roles: boolean;
  extensions: boolean;
  serverSettings: boolean;
  monitoring: boolean;
  pubsub: boolean;

  // actions
  queryCancellation: boolean;
  streaming: boolean;
  csvImport: boolean;
  ddlGeneration: boolean;
  tableMaintenance: boolean;
  schemaDiff: boolean;
}

/**
 * The conservative default: offer nothing we have not been told exists. Used
 * before the real set has loaded, so a slow answer hides features briefly
 * rather than showing dead ones.
 */
export const NO_CAPABILITIES: DriverCapabilities = {
  schemas: false,
  materializedViews: false,
  sequences: false,
  functions: false,
  procedures: false,
  dataTypes: false,
  foreignTables: false,
  triggerFunctions: false,
  eventTriggers: false,
  partitions: false,
  triggers: false,
  rules: false,
  policies: false,
  databases: false,
  tablespaces: false,
  roles: false,
  extensions: false,
  serverSettings: false,
  monitoring: false,
  pubsub: false,
  queryCancellation: false,
  streaming: false,
  csvImport: false,
  ddlGeneration: false,
  tableMaintenance: false,
  schemaDiff: false,
};

// Capabilities are static per engine, so one round trip per driver is enough
// for the life of the process.
const cache = new Map<DriverType, DriverCapabilities>();

export async function fetchCapabilities(driver: DriverType): Promise<DriverCapabilities> {
  const cached = cache.get(driver);
  if (cached) return cached;

  const caps = await invoke<DriverCapabilities>("db_capabilities", { driver });
  cache.set(driver, caps);
  return caps;
}
