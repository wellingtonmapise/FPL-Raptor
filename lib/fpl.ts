/** FPL money is stored in tenths of a million: 1009 -> "£100.9m". */
export function formatPrice(tenths: number | null | undefined): string {
  if (tenths == null) return "-";
  return `£${(tenths / 10).toFixed(1)}m`;
}

/** FPL position ids. */
export const POSITIONS: Record<number, string> = {
  1: "GK",
  2: "DEF",
  3: "MID",
  4: "FWD",
};

/** FPL player status codes. */
export const STATUS_LABELS: Record<string, string> = {
  a: "Available",
  d: "Doubtful",
  i: "Injured",
  s: "Suspended",
  u: "Unavailable",
  n: "Not in squad",
};
