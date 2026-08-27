import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:pointer-events-none disabled:opacity-40 select-none",
  {
    variants: {
      variant: {
        /*
         * The "plate": a dark green slab with a green hairline and bright green
         * type. Shared with the headline's flip word so the call-to-action and
         * the hero read as one system rather than two unrelated widgets.
         * The lift on hover comes from the inset hairline brightening plus an
         * outer bloom, not from changing the fill — the fill staying put is what
         * makes it feel like a physical key rather than a coloured rectangle.
         */
        primary:
          "font-semibold text-accent [background:linear-gradient(to_bottom,#14251c,#0f1a12)] shadow-[inset_0_-1px_#0a1109,inset_0_0_0_1px_rgba(124,232,31,0.22)] hover:text-accent-glow hover:shadow-[inset_0_-1px_#0a1109,inset_0_0_0_1px_rgba(124,232,31,0.5),0_0_28px_-6px_rgba(124,232,31,0.45)] active:shadow-[inset_0_2px_6px_rgba(0,0,0,0.5),inset_0_0_0_1px_rgba(124,232,31,0.4)]",
        secondary:
          "bg-surface-2 text-ink border border-line-strong hover:bg-surface-3 hover:border-line-strong",
        ghost: "text-ink-muted hover:text-ink hover:bg-surface-2",
        outline:
          "border border-accent-dim/60 text-accent hover:bg-accent/10 hover:border-accent",
        danger:
          "bg-loss/15 text-loss border border-loss/30 hover:bg-loss/25",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-10 px-4",
        lg: "h-12 px-6 text-base",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { buttonVariants };
