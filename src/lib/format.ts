/** Larger-side share as the hobby's max/min centering ratio, e.g. 0.58 → "58/42". */
export function formatRatio(largerShare: number): string {
  const big = clampInt(Math.round(largerShare * 100), 50, 100);
  return `${big}/${100 - big}`;
}

export function describeAxis(primaryShare: number, axis: "lr" | "tb"): string {
  const secondary = 1 - primaryShare;
  const larger = Math.max(primaryShare, secondary);
  const ratio = formatRatio(larger);
  if (Math.abs(primaryShare - secondary) < 0.015) return `${ratio}, even`;
  if (axis === "lr") {
    return primaryShare > secondary ? `${ratio}, left side wider` : `${ratio}, right side wider`;
  }
  return primaryShare > secondary ? `${ratio}, top wider` : `${ratio}, bottom wider`;
}

export function largerShare(primary: number): number {
  return Math.max(primary, 1 - primary);
}

export function confidenceLabel(confidence: number): string {
  if (confidence < 0.4) return "Limited";
  if (confidence < 0.55) return "Guarded";
  if (confidence < 0.7) return "Moderate";
  return "Fairly supported";
}

export function formatGrade(grade: number, halves: boolean): string {
  if (!halves) return String(Math.round(grade));
  const rounded = Math.round(grade * 2) / 2;
  return Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1);
}

export function clampHalf(grade: number, min = 1, max = 10): number {
  const clamped = Math.min(max, Math.max(min, grade));
  return Math.round(clamped * 2) / 2;
}

export function money(amount: number | null | undefined, currency: "USD" | "EUR"): string {
  if (amount == null || Number.isNaN(amount)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: amount >= 100 ? 0 : 2,
  }).format(amount);
}

function clampInt(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
