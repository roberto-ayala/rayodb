import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const selectVariants = cva(
  "w-full cursor-pointer appearance-none rounded-md border border-border bg-input bg-[length:0.65rem] bg-[right_0.6rem_center] bg-no-repeat pr-7 text-foreground transition-colors focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      size: {
        default: "h-9 px-3 text-sm",
        sm: "h-7 px-2 text-xs",
      },
    },
    defaultVariants: { size: "default" },
  },
);

export interface SelectProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size">,
    VariantProps<typeof selectVariants> {}

/** Native select on the same metrics as Input, with a themed chevron */
const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, size, style, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(selectVariants({ size }), className)}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%23888' stroke-width='1.5'%3E%3Cpath d='M4 6l4 4 4-4'/%3E%3C/svg%3E\")",
        ...style,
      }}
      {...props}
    />
  ),
);
Select.displayName = "Select";

export { Select, selectVariants };
