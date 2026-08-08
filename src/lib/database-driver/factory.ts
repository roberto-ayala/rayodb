import type { DriverType } from "@/types";
import type { DatabaseDriver } from "./index";
import { PostgreSQLDriver } from "./pgsql";

export class DriverFactory {
  private static drivers: Map<DriverType, DatabaseDriver> = new Map([
    ["PGSQL", new PostgreSQLDriver()],
  ]);

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
};

export type { DriverType };
