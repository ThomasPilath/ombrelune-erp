export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ControlSize = "compact" | "standard";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-brand text-white hover:bg-brand-strong disabled:opacity-40",
  secondary: "border bg-surface text-ink hover:bg-surface-muted disabled:opacity-40",
  danger: "bg-danger text-canvas hover:opacity-90 disabled:opacity-40",
  ghost: "text-ink hover:bg-surface-muted disabled:opacity-40"
};

const buttonSizes: Record<ControlSize, string> = {
  compact: "min-h-10 rounded-lg px-3",
  standard: "min-h-11 rounded-xl px-4"
};

export function buttonClasses(variant: ButtonVariant = "primary", size: ControlSize = "standard"): string {
  return `inline-flex items-center justify-center font-bold ${buttonSizes[size]} ${buttonVariants[variant]}`;
}

export function iconButtonClasses(variant: ButtonVariant = "secondary", size: ControlSize = "standard"): string {
  const dimensions = size === "compact" ? "size-10 rounded-lg" : "size-11 rounded-xl";
  return `grid shrink-0 place-items-center ${dimensions} ${buttonVariants[variant]}`;
}

export function fieldClasses(size: ControlSize = "standard"): string {
  const height = size === "compact" ? "min-h-10" : "min-h-11";
  return `${height} w-full rounded-xl border bg-surface px-3 text-ink read-only:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60`;
}

export const dialogActionClasses = "flex flex-col-reverse gap-3 border-t p-4 sm:flex-row sm:justify-end";
