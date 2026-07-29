/**
 * Shared class-name constants.
 *
 * Deliberately constants rather than `<Button>` / `<Input>` components: this is a
 * four-page app, and wrapping every control would touch every line of every page
 * for very little. What the app actually needed was one place to fix tap target
 * sizes — the pagination chevrons were 28px while being the primary navigation on
 * a phone, well under the ~44px guideline — and constants make that a one-line
 * change instead of a refactor.
 */
import { cn } from './utils';

/** Minimum comfortable touch target. Below this, mis-taps are routine on a phone. */
export const TOUCH = 'min-h-11 min-w-11';

const focusRing =
	'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

const btnBase = cn(
	'inline-flex items-center justify-center gap-1.5 rounded-md text-sm font-medium transition-colors',
	'disabled:pointer-events-none disabled:opacity-50',
	focusRing,
);

export const btnPrimary = cn(
	btnBase,
	TOUCH,
	'bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90',
);

export const btnSecondary = cn(
	btnBase,
	TOUCH,
	'border border-border bg-card px-3 py-2 hover:bg-accent',
);

export const btnDestructive = cn(
	btnBase,
	TOUCH,
	'border border-destructive/40 bg-card px-3 py-2 text-destructive hover:bg-destructive/10',
);

/** Icon-only button. Still a full touch target — it is usually pagination. */
export const btnIcon = cn(btnBase, TOUCH, 'rounded-md hover:bg-accent');

/**
 * Compact row action. Padding is smaller but the touch target is not: `min-h-11`
 * keeps the hit area honest while the visual box stays dense enough for a table.
 */
export const btnRow = cn(
	btnBase,
	'min-h-11 border border-border bg-card px-3 py-1.5 text-xs hover:bg-accent',
);

export const btnRowDestructive = cn(
	btnBase,
	'min-h-11 border border-destructive/40 bg-card px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10',
);

/**
 * `text-base` on small screens is not cosmetic: iOS Safari zooms the viewport
 * when a focused input's font is below 16px, and the user is then stuck at the
 * wrong zoom level for the rest of the form.
 */
export const inputBase = cn(
	'w-full rounded-md border border-input bg-background px-3 py-2 text-base sm:text-sm',
	'placeholder:text-muted-foreground',
	'aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-destructive',
	focusRing,
);

export const labelBase = 'block text-sm font-medium';

export const fieldErrorText = 'text-xs text-destructive';
