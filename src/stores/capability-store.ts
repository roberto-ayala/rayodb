import { create } from "zustand";
import {
  type DriverCapabilities,
  type DriverInfo,
  fetchCapabilities,
  fetchDrivers,
  NO_CAPABILITIES,
} from "@/lib/database-driver/capabilities";
import type { DriverType } from "@/types";

interface CapabilityState {
  byDriver: Partial<Record<DriverType, DriverCapabilities>>;
  /** Engines that can be selected in the connection form. */
  drivers: DriverInfo[];
  load: (driver: DriverType) => Promise<void>;
  loadDrivers: () => Promise<void>;
}

/**
 * Capabilities are static per engine, so this is a load-once cache rather than
 * per-connection state. `useCapabilities` reads it; nothing else should.
 */
export const useCapabilityStore = create<CapabilityState>((set, get) => ({
  byDriver: {},
  drivers: [],

  loadDrivers: async () => {
    try {
      set({ drivers: await fetchDrivers() });
    } catch (e) {
      console.error("Failed to load the driver list:", e);
    }
  },

  load: async (driver) => {
    if (get().byDriver[driver]) return;
    try {
      const caps = await fetchCapabilities(driver);
      set((s) => ({ byDriver: { ...s.byDriver, [driver]: caps } }));
    } catch (e) {
      // Leaving the entry unset means the UI keeps the conservative default
      // and simply offers less, which beats offering something that errors.
      console.error(`Failed to load capabilities for ${driver}:`, e);
    }
  },
}));

/** The capabilities of a given driver, or the conservative default. */
export function useDriverCapabilities(driver: DriverType | undefined): DriverCapabilities {
  return useCapabilityStore((s) =>
    driver ? (s.byDriver[driver] ?? NO_CAPABILITIES) : NO_CAPABILITIES,
  );
}

/**
 * For loaders outside React, which must not read a half-populated cache: a
 * store that has not answered yet would look like "supports nothing", and the
 * empty result would be cached as though the server had said so. Awaiting the
 * fetch (already memoised per driver) removes that race.
 */
export async function ensureCapabilities(driver: DriverType): Promise<DriverCapabilities> {
  const known = useCapabilityStore.getState().byDriver[driver];
  if (known) return known;

  await useCapabilityStore.getState().load(driver);
  return useCapabilityStore.getState().byDriver[driver] ?? NO_CAPABILITIES;
}
