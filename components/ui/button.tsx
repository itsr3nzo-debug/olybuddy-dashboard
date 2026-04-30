import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Button — v2.
 *
 * Heights:  xs 24 / sm 32 / default 36 / lg 40
 * Radius:   6px (md) on every size — never 12px+. The "rounded-2xl on a
 *           button" anti-pattern is killed at the token layer (radius
 *           cap in globals.css `@theme inline`) but we set 6px here too.
 * Variants:
 *   default     — solid navy `--primary`, white text, AA-compliant
 *   secondary   — hairline-bordered ghost (Linear pattern). Text is
 *                 muted by default, lifts to foreground on hover; border
 *                 strengthens. Replaces every "outline" usage that
 *                 should be tertiary.
 *   outline     — same as secondary but visible-by-default border. Used
 *                 for explicit "this is a button, not a link" cases.
 *   ghost       — transparent until hover. Sidebar items, table actions.
 *   destructive — `bg-danger/15 text-danger border-danger/30`. No solid
 *                 red — destructive should LOOK destructive but not feel
 *                 like a primary action.
 *   link        — text-only, underline on hover. For inline CTAs in body
 *                 prose where a button would feel heavy.
 *
 * Mobile: lg variant has `min-h-11` for 44px touch target. xs/sm should
 * not be used on touch targets.
 */
const buttonVariants = cva(
  cn(
    // Base shell
    "group/button inline-flex shrink-0 items-center justify-center",
    // 6px radius — never grows
    "rounded-md",
    // Subtle border for layout consistency (transparent on solid variants)
    "border border-transparent bg-clip-padding",
    // Type
    "text-sm font-medium whitespace-nowrap",
    // Behaviour
    "transition-colors outline-none select-none cursor-pointer",
    // Focus — 2px ring, 2px offset, primary colour
    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    // Active — every variant gets a 1px translate (tactile press feel).
    // Variant-specific bg-shift active states are added per-variant below.
    "active:not-aria-[haspopup]:translate-y-px",
    // Disabled — Linear pattern: dim AND cursor AND remove hover. Pure
    // opacity-50 reads as "I'm not sure if this is enabled" — explicit
    // cursor-not-allowed + suppressed hover removes ambiguity.
    "disabled:pointer-events-none disabled:opacity-60 disabled:cursor-not-allowed",
    // Invalid state
    "aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/30",
    // Icon sizing
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
    "[&_svg:not([class*='size-'])]:size-4",
  ),
  {
    variants: {
      variant: {
        // Solid navy — the only way primary actions look on this dashboard.
        // No gradients. White text passes AA on `oklch(0.65 0.13 264)`.
        default: cn(
          "bg-primary text-primary-foreground",
          "hover:bg-primary/90",
          "active:bg-primary/95",
          // Disabled override — kill hover state when disabled
          "disabled:hover:bg-primary",
        ),
        // Hairline-bordered ghost — Linear / Mercury pattern. Default state
        // is muted text + subtle border; hover lifts both; active deepens.
        secondary: cn(
          "bg-transparent text-muted-foreground border-border",
          "hover:bg-muted/40 hover:text-foreground",
          "active:bg-muted/60",
          "aria-expanded:bg-muted/60 aria-expanded:text-foreground",
          "disabled:hover:bg-transparent disabled:hover:text-muted-foreground",
        ),
        // Same shell as secondary but the border is always visible.
        // Use for "this is a button, definitely click it" cases.
        outline: cn(
          "bg-transparent text-foreground border-border",
          "hover:bg-muted/60",
          "active:bg-muted",
          "aria-expanded:bg-muted aria-expanded:text-foreground",
          "disabled:hover:bg-transparent",
        ),
        // Transparent until hovered. Sidebar items, table action menus.
        ghost: cn(
          "bg-transparent text-muted-foreground",
          "hover:bg-muted/60 hover:text-foreground",
          "active:bg-muted/80",
          "aria-expanded:bg-muted aria-expanded:text-foreground",
          "disabled:hover:bg-transparent disabled:hover:text-muted-foreground",
        ),
        // Destructive — tinted, never solid red. Alpha bg + bordered.
        // Looks dangerous without screaming.
        destructive: cn(
          "bg-destructive/12 text-destructive border-destructive/30",
          "hover:bg-destructive/20 hover:border-destructive/50",
          "active:bg-destructive/25",
          "focus-visible:ring-destructive/40",
          "disabled:hover:bg-destructive/12 disabled:hover:border-destructive/30",
        ),
        // Inline link CTA. No padding — flows in prose.
        link: cn(
          "text-primary underline-offset-4 hover:underline px-0 h-auto",
          "active:opacity-80",
          "rounded-none border-none bg-transparent",
        ),
      },
      size: {
        // 24px — inline pill / chip / hashtag. Don't use on touch targets.
        xs: cn(
          "h-6 gap-1 px-2 text-xs",
          "[&_svg:not([class*='size-'])]:size-3",
        ),
        // 32px — compact toolbar / table row action.
        sm: cn(
          "h-8 gap-1.5 px-2.5",
          "[&_svg:not([class*='size-'])]:size-3.5",
        ),
        // 36px — the standard. Form submits, dialogs, page-level CTAs.
        default: cn(
          "h-9 gap-2 px-3.5",
        ),
        // 40px — primary hero CTA on auth pages, settings save buttons.
        // Min-h-11 on touch (44px target).
        lg: cn(
          "h-10 gap-2 px-4 text-sm",
          "sm:h-10 max-sm:min-h-11",
        ),
        // Square icon-only sizes.
        "icon-xs": cn(
          "size-6 [&_svg:not([class*='size-'])]:size-3",
        ),
        "icon-sm": cn(
          "size-8 [&_svg:not([class*='size-'])]:size-3.5",
        ),
        icon: cn(
          "size-9",
        ),
        "icon-lg": cn(
          "size-10",
        ),
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
