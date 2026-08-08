import type { DriverType } from "@/types";
import type { DatabaseDriver } from "./index";
import { IpcDriver } from "./ipc-driver";

/**
 * Hands out the frontend driver.
 *
 * There is exactly one: every method invokes a `db_*` command and the backend
 * dispatches on the project's engine, so nothing here varies by engine. This
 * used to keep a map of registered drivers, which meant the set of supported
 * engines was declared twice — once here and once in Rust — and adding MySQL
 * to the backend while forgetting this map made it selectable but unusable.
 *
 * The backend is the only source of truth now: `db_drivers` says which engines
 * exist, and this returns the same driver for all of them.
 */
export class DriverFactory {
  private static shared: DatabaseDriver = new IpcDriver();

  static getDriver(_driverType: DriverType): DatabaseDriver {
    return DriverFactory.shared;
  }
}

export interface DriverConfig {
  name: string;
  defaultPort: string;
}

/**
 * Labels for paths that need one before `db_drivers` has answered. The
 * authoritative list is the backend's.
 */
export const DRIVER_CONFIGS: Partial<Record<DriverType, DriverConfig>> = {
  PGSQL: { name: "PostgreSQL", defaultPort: "5432" },
  MYSQL: { name: "MySQL", defaultPort: "3306" },
  SQLITE: { name: "SQLite", defaultPort: "" },
};

export type { DriverType };
