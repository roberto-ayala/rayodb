import type React from "react";
import { cn } from "@/lib/utils";
import { DialogDescription, DialogHeader, DialogTitle } from "./dialog";

/**
 * The banded dialog header: a tinted strip carrying a framed icon, the title
 * and a line of context. Every modal in the app wears it, so they read as one
 * family and none of them re-decides its own padding.
 *
 * Pair it with `p-0 gap-0` on DialogContent — the band brings its own padding,
 * and the body below supplies its own.
 */
export function ModalBanner({
  icon,
  title,
  badge,
  description,
  actions,
  className,
  children,
}: {
  icon: React.ReactNode;
  title: React.ReactNode;
  /** Small uppercase chip ahead of the description, for the kind of thing this is */
  badge?: React.ReactNode;
  description?: React.ReactNode;
  /** Sits next to the title — a copy button, a spinner */
  actions?: React.ReactNode;
  className?: string;
  /** Anything that belongs inside the band under the title, such as tabs */
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("border-b border-border bg-muted px-5 pt-5 pb-3", className)}>
      <DialogHeader>
        <div className="flex items-stretch gap-2.5">
          {/* Square, sized by the two text rows next to it */}
          <div className="flex w-11 shrink-0 items-center justify-center rounded-md border border-border bg-background">
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <DialogTitle className="flex items-center gap-2 text-base">
              <span className="truncate">{title}</span>
              {actions}
            </DialogTitle>
            {(badge || description) && (
              <DialogDescription className="mt-0.5 flex items-center gap-1.5">
                {badge && (
                  <span className="inline-flex items-center gap-1 rounded-sm border border-border bg-background px-1.5 py-0.5 text-3xs font-medium uppercase tracking-wider">
                    {badge}
                  </span>
                )}
                {description && <span className="truncate text-xs">{description}</span>}
              </DialogDescription>
            )}
          </div>
        </div>
      </DialogHeader>
      {children}
    </div>
  );
}
