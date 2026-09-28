export const APPLICATION_TIMEZONE = process.env.APP_TIMEZONE || "Africa/Cairo";

export function formatAppDateTime(value: string | Date | null | undefined) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en", {
    timeZone: APPLICATION_TIMEZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
