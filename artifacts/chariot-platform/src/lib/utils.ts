export { cn } from "cn";

export function formatDate(
  dateString: string | Date | null | undefined,
): string {
  if (!dateString) return "N/A";
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return "N/A";
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

export function formatMoney(amount: number | null | undefined): string {
  if (amount == null || isNaN(amount)) return "£0";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Flag a document expiry relative to today: expired, due within 30 days, or fine. */
export function documentExpiry(
  expiresAt: string | null | undefined,
): { state: "expired" | "soon" | "ok"; days: number; label: string } | null {
  if (!expiresAt) return null;
  const expires = new Date(expiresAt.slice(0, 10) + "T00:00:00");
  if (isNaN(expires.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((expires.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return { state: "expired", days, label: `Expired ${formatDate(expires)}` };
  if (days === 0) return { state: "expired", days, label: "Expires today" };
  if (days <= 30) return { state: "soon", days, label: `Expires in ${days} day${days === 1 ? "" : "s"}` };
  return { state: "ok", days, label: `Expires ${formatDate(expires)}` };
}
