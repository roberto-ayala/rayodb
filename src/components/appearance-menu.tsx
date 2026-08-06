import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SegmentedTabs } from "@/components/ui/panel";
import { cn } from "@/lib/utils";
import { ACCENTS, type ThemeMode, useUIStore } from "@/stores/ui-store";

const MODES: { id: ThemeMode; label: string; icon: React.ReactNode }[] = [
  { id: "auto", label: "Auto", icon: <Monitor className="h-3 w-3" /> },
  { id: "light", label: "Light", icon: <Sun className="h-3 w-3" /> },
  { id: "dark", label: "Dark", icon: <Moon className="h-3 w-3" /> },
];

/** Theme mode and accent, the two choices that outlive a restart */
export function AppearanceMenu() {
  const themeMode = useUIStore((s) => s.themeMode);
  const theme = useUIStore((s) => s.theme);
  const accentHue = useUIStore((s) => s.accentHue);
  const setThemeMode = useUIStore((s) => s.setThemeMode);
  const setAccentHue = useUIStore((s) => s.setAccentHue);

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => setOpen(!open)}
        title="Appearance"
        aria-label="Appearance"
      >
        {themeMode === "auto" ? (
          <Monitor className="h-4 w-4" />
        ) : theme === "light" ? (
          <Sun className="h-4 w-4" />
        ) : (
          <Moon className="h-4 w-4" />
        )}
      </Button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-60 rounded-lg border border-border bg-popover p-3 shadow-[var(--shadow-popover)]">
          <div className="space-y-1.5">
            <span className="text-3xs font-semibold uppercase tracking-widest text-muted-foreground">
              Theme
            </span>
            <SegmentedTabs
              stretch
              tabs={MODES.map((m) => ({ id: m.id, label: m.label, icon: m.icon }))}
              value={themeMode}
              onChange={setThemeMode}
            />
            {themeMode === "auto" && (
              <p className="text-3xs text-muted-foreground">
                Following the system — currently {theme}
              </p>
            )}
          </div>

          <div className="mt-3 space-y-1.5">
            <span className="text-3xs font-semibold uppercase tracking-widest text-muted-foreground">
              Accent
            </span>
            <div className="flex items-center gap-1.5">
              {ACCENTS.map((accent) => (
                <button
                  key={accent.id}
                  type="button"
                  onClick={() => setAccentHue(accent.hue)}
                  title={accent.label}
                  aria-label={accent.label}
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full border transition-transform hover:scale-110",
                    accentHue === accent.hue ? "border-foreground/40" : "border-border",
                  )}
                  style={{
                    backgroundColor:
                      theme === "dark"
                        ? `oklch(0.68 0.17 ${accent.hue})`
                        : `oklch(0.5 0.2 ${accent.hue})`,
                  }}
                >
                  {accentHue === accent.hue && <Check className="h-3 w-3 text-white" />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
