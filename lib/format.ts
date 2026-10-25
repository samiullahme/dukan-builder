export function parseSqlDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value.replace(" ", "T") + "Z");
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDateTime(value: string | null | undefined): string {
  const d = parseSqlDate(value);
  if (!d) return "—";
  return (
    d.toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    }) + " UTC"
  );
}

export function relativeTime(value: string | null | undefined, now = Date.now()): string {
  const d = parseSqlDate(value);
  if (!d) return "—";
  const seconds = Math.max(0, Math.round((now - d.getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

export function formatDuration(start: string | null | undefined, finish: string | null | undefined): string {
  const a = parseSqlDate(start);
  const b = parseSqlDate(finish);
  if (!a || !b) return "—";
  const seconds = Math.max(0, Math.round((b.getTime() - a.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

export function lastLogLine(log: string | null | undefined, max = 140): string {
  if (!log) return "";
  const lines = log
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const line = lines.length ? lines[lines.length - 1] : "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
