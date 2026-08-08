import type { DriverType } from "@/types";
import type { DatabaseDriver } from "./index";
import { IpcDriver } from "./ipc-driver";

export class DriverFactory {
  // Every engine goes through the same IPC driver: the backend dispatches on
  // the project's kind, so the frontend needs one implementation, not one per
  // engine. Registration here is what makes a driver selectable in the UI.
  private static shared: DatabaseDriver = new IpcDriver();

  private static drivers: Map<DriverType, DatabaseDriver> = new Map([
    ["PGSQL", DriverFactory.shared],
    ["SQLITE", DriverFactory.shared],
  ] as [DriverType, DatabaseDriver][]);

  static getDriver(driverType: DriverType): DatabaseDriver {
    const driver = DriverFactory.drivers.get(driverType);
    if (!driver) {
      throw new Error(`Driver ${driverType} not found`);
    }
    return driver;
  }

  static getSupportedDrivers(): DriverType[] {
    return Array.from(DriverFactory.drivers.keys());
  }
}

export interface DriverConfig {
  name: string;
  defaultPort: string;
}

/**
 * Static fallbacks for the engines that ship. The authoritative list comes
 * from `db_drivers`; this covers the paths that need a label before it loads.
 */
export const DRIVER_CONFIGS: Partial<Record<DriverType, DriverConfig>> = {
  PGSQL: { name: "PostgreSQL", defaultPort: "5432" },
  SQLITE: { name: "SQLite", defaultPort: "" },
};

export type { DriverType };
