const ABSOLUTE_DATE = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

/** Deterministic UTC timestamp (server-rendered; no client re-format). */
export function formatTimestamp(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    return "—";
  }
  return `${ABSOLUTE_DATE.format(new Date(ms))} UTC`;
}

/** Compact relative time, e.g. "3d ago". Computed at request time. */
export function formatRelative(iso: string, now: number = Date.now()): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    return "—";
  }
  const diff = Math.max(0, now - ms);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month}mo ago`;
  return `${Math.floor(month / 12)}y ago`;
}

/** Human-readable duration from milliseconds. */
export function formatDuration(ms?: number): string {
  if (ms == null || Number.isNaN(ms) || ms < 0) {
    return "—";
  }
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) {
    return `${totalSec}s`;
  }
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return sec === 0 ? `${min}m` : `${min}m ${sec}s`;
}

/** Percentage as a whole number with a trailing `%`. */
export function formatPercent(value: number): string {
  if (Number.isNaN(value)) {
    return "—";
  }
  return `${Math.round(value)}%`;
}
