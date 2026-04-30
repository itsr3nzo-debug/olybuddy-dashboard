import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Input — v2.
 *
 * Settings pages currently use raw <input> elements styled inline (~30+
 * occurrences). This primitive enforces:
 * - 4px corner radius (--radius-sm), never grows
 * - 36px height on the default size (matches default Button)
 * - 1px hairline border that goes solid `--primary` on focus (no shadow,
 *   no glow — Linear pattern)
 * - Subtle bg shift on focus for affordance without heavy ring chrome
 * - `tabular-nums` so numeric inputs (£, phone, count) align with table
 *   columns out of the box
 *
 * Usage:
 *   <Input placeholder="Owner name" />
 *   <Input type="email" required />
 *   <Input size="sm" prefix="@" />     // 32px height
 *   <Input invalid />                   // bordered red, role=alert
 *
 * For numeric inputs that should display in mono:
 *   <Input type="number" className="font-mono" />
 */

type InputSize = 'sm' | 'default' | 'lg'

interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'> {
  size?: InputSize
  invalid?: boolean
  /** Optional leading affix (e.g. "£" or "@") rendered inside the input frame */
  prefix?: React.ReactNode
  /** Optional trailing affix (e.g. unit label, clear button) */
  suffix?: React.ReactNode
}

const HEIGHT: Record<InputSize, string> = {
  sm: 'h-8 text-sm',
  default: 'h-9 text-sm',
  lg: 'h-10 text-base',
}

const PADDING_X: Record<InputSize, string> = {
  sm: 'px-2.5',
  default: 'px-3',
  lg: 'px-3.5',
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, size = 'default', invalid, prefix, suffix, type = 'text', ...props }, ref) => {
    const inputBase = cn(
      'w-full bg-transparent text-foreground placeholder:text-muted-foreground/70',
      'tabular-nums',
      'outline-none focus:outline-none',
      'disabled:cursor-not-allowed disabled:opacity-50',
    )

    // No affix — single input
    if (!prefix && !suffix) {
      return (
        <input
          ref={ref}
          type={type}
          className={cn(
            inputBase,
            // 4px radius — never grows
            'rounded-sm',
            // Hairline border, solid primary on focus
            'border border-input',
            // Focus treatment: border swap + bg-shift + 3px primary "glow"
            // ring via box-shadow. Linear's pattern — a 10% alpha primary
            // ring lifts the input visibly without resorting to bright
            // ring chrome. The ring expands from `0 0 0 0` so it animates
            // in cleanly.
            'focus:border-primary focus:bg-muted/30',
            'focus:shadow-[0_0_0_3px_rgba(56,80,160,0.10)]',
            'dark:focus:shadow-[0_0_0_3px_rgba(101,128,208,0.14)]',
            invalid && 'border-destructive focus:border-destructive focus:shadow-[0_0_0_3px_rgba(239,68,68,0.10)]',
            // Density
            HEIGHT[size],
            PADDING_X[size],
            // Transition border + bg + shadow together so the focus animates
            // cohesively. 150ms ease-out matches the rest of the motion system.
            'transition-[border-color,background-color,box-shadow] duration-150 ease-out',
            className,
          )}
          aria-invalid={invalid || undefined}
          {...props}
        />
      )
    }

    // With affix — wrap in flex container that owns the border + radius
    return (
      <div
        className={cn(
          'flex items-stretch w-full overflow-hidden',
          'rounded-sm border border-input bg-transparent',
          'focus-within:border-primary focus-within:bg-muted/30',
          // Same focus glow as the bare input form — applies to wrapper
          'focus-within:shadow-[0_0_0_3px_rgba(56,80,160,0.10)]',
          'dark:focus-within:shadow-[0_0_0_3px_rgba(101,128,208,0.14)]',
          invalid && 'border-destructive focus-within:border-destructive focus-within:shadow-[0_0_0_3px_rgba(239,68,68,0.10)]',
          'transition-[border-color,background-color,box-shadow] duration-150 ease-out',
          HEIGHT[size],
          className,
        )}
      >
        {prefix && (
          <div
            className={cn(
              'flex items-center text-sm text-muted-foreground select-none border-r border-input',
              PADDING_X[size],
            )}
          >
            {prefix}
          </div>
        )}
        <input
          ref={ref}
          type={type}
          className={cn(inputBase, 'flex-1', PADDING_X[size])}
          aria-invalid={invalid || undefined}
          {...props}
        />
        {suffix && (
          <div
            className={cn(
              'flex items-center text-sm text-muted-foreground select-none border-l border-input',
              PADDING_X[size],
            )}
          >
            {suffix}
          </div>
        )}
      </div>
    )
  },
)
Input.displayName = 'Input'

/* ─────────────────────────────────────────────────────────────────────
   Textarea — same visual language as Input, vertical-resize only.
   ───────────────────────────────────────────────────────────────────── */

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, invalid, rows = 4, ...props }, ref) => (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(
        'w-full bg-transparent text-foreground placeholder:text-muted-foreground/70',
        'rounded-sm border border-input px-3 py-2 text-sm',
        'focus:border-primary focus:bg-muted/30 focus:outline-none',
        // Match Input's focus glow so textarea feels at home in the form
        'focus:shadow-[0_0_0_3px_rgba(56,80,160,0.10)]',
        'dark:focus:shadow-[0_0_0_3px_rgba(101,128,208,0.14)]',
        'resize-y min-h-[80px]',
        'transition-[border-color,background-color,box-shadow] duration-150 ease-out',
        invalid && 'border-destructive focus:border-destructive focus:shadow-[0_0_0_3px_rgba(239,68,68,0.10)]',
        'disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
      aria-invalid={invalid || undefined}
      {...props}
    />
  ),
)
Textarea.displayName = 'Textarea'

/* ─────────────────────────────────────────────────────────────────────
   Select — native HTML <select> with v2 styling.

   Not using @base-ui/react/select for now — settings pages all use the
   native select, and the styling primitive here matches that to avoid
   churn. A custom Select can be layered later for accessibility wins.
   ───────────────────────────────────────────────────────────────────── */

// HTML <select> has a native `size` attribute (number of visible rows).
// We Omit it so our InputSize string doesn't collide.
interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  invalid?: boolean
  size?: InputSize
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, size = 'default', invalid, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'w-full bg-transparent text-foreground',
        'rounded-sm border border-input',
        'focus:border-primary focus:bg-muted/30 focus:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'transition-colors appearance-none',
        // Caret is rendered by the browser via background-image trick.
        // Use Tailwind arbitrary value with a small inline SVG.
        "bg-[url('data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%2210%22%20height%3D%226%22%20viewBox%3D%220%200%2010%206%22%3E%3Cpath%20d%3D%22M1%201l4%204%204-4%22%20stroke%3D%22currentColor%22%20stroke-width%3D%221.5%22%20fill%3D%22none%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%2F%3E%3C/svg%3E')] bg-no-repeat bg-[position:right_0.75rem_center] pr-8",
        HEIGHT[size],
        PADDING_X[size],
        invalid && 'border-destructive focus:border-destructive',
        className,
      )}
      aria-invalid={invalid || undefined}
      {...props}
    >
      {children}
    </select>
  ),
)
Select.displayName = 'Select'

/* ─────────────────────────────────────────────────────────────────────
   Field — wraps Input/Textarea/Select with label + helper + error.

   Unifies form layout across settings pages. Replaces the ad-hoc
   `<label>...</label>` + `<input>` pattern that exists in dozens of files.

   Usage:
     <Field label="Owner phone" hint="UK mobile, e.g. 07700900111">
       <Input type="tel" />
     </Field>

     <Field label="Email" error="Already registered">
       <Input type="email" invalid />
     </Field>
   ───────────────────────────────────────────────────────────────────── */

interface FieldProps {
  label: string
  hint?: string
  error?: string
  required?: boolean
  children: React.ReactNode
  className?: string
  /** Render the label visually-hidden but still in DOM */
  hideLabel?: boolean
}

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
  hideLabel,
}: FieldProps) {
  return (
    <label className={cn('block', className)}>
      <span
        className={cn(
          'block mb-1.5 text-sm font-medium text-foreground',
          hideLabel && 'sr-only',
        )}
      >
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </span>
      {children}
      {hint && !error && (
        <span className="block mt-1.5 text-xs text-muted-foreground leading-relaxed">{hint}</span>
      )}
      {error && (
        <span role="alert" className="block mt-1.5 text-xs text-destructive leading-relaxed">
          {error}
        </span>
      )}
    </label>
  )
}
