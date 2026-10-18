/**
 * Presentation helpers for the profile page's Active Sessions list.
 *
 * Everything here is derived from data the server already holds — the raw
 * user agent string the browser sent at sign-in, and the session timestamps.
 * The user agent is parsed into a browser/OS label because that is factual
 * information the browser itself transmits; when it cannot be parsed the UI
 * says so instead of inventing a device. There is deliberately no location,
 * activity or "risk" value here: the app stores none, so none is shown.
 */

export interface DeviceInfo {
  browser: string | null;
  os: string | null;
  /** "Chrome on Windows", "Safari on iOS"… or a neutral, honest fallback. */
  label: string;
}

/** First match wins — order matters (Edge/Opera before Chrome, Chrome before Safari). */
const BROWSERS: [RegExp, string][] = [
  [/Edg[A-Za-z]*\//, "Edge"],
  [/OPR\/|Opera[ /]/, "Opera"],
  [/SamsungBrowser\//, "Samsung Internet"],
  [/CriOS\//, "Chrome"],
  [/FxiOS\//, "Firefox"],
  [/Chrome\//, "Chrome"],
  [/Firefox\//, "Firefox"],
  [/Safari\//, "Safari"],
];

const SYSTEMS: [RegExp, string][] = [
  [/Windows NT/, "Windows"],
  [/CrOS/, "ChromeOS"],
  [/Android/, "Android"],
  [/iPhone|iPad|iPod/, "iOS"], // before macOS: iOS user agents also contain "like Mac OS X"
  [/Mac OS X|Macintosh/, "macOS"],
  [/Linux/, "Linux"],
];

export function describeDevice(userAgent: string | null | undefined): DeviceInfo {
  const ua = (userAgent ?? "").trim();
  if (!ua) return { browser: null, os: null, label: "Device not recorded" };
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1] ?? null;
  const os = SYSTEMS.find(([re]) => re.test(ua))?.[1] ?? null;
  // Only claim what was parsed: "Chrome on Windows", or the known half plus an
  // honest "unknown" for the other, or a neutral fallback for neither.
  const label = browser && os
    ? `${browser} on ${os}`
    : browser
      ? `${browser} (system unknown)`
      : os
        ? `Unknown browser on ${os}`
        : "Unknown device";
  return { browser, os, label };
}

/**
 * A non-current session is "active" when it reached the server within this
 * window (the idle timeout is 2 hours, so an inactive session is heading for
 * expiry); the current session is always "current".
 */
export const SESSION_ACTIVE_WINDOW_MS = 15 * 60 * 1000;

export type SessionStatus = "current" | "active" | "idle";

export function sessionStatus(
  session: { current: boolean; lastActiveAt: Date | string },
  now: Date = new Date(),
): SessionStatus {
  if (session.current) return "current";
  const t = new Date(session.lastActiveAt).getTime();
  if (Number.isNaN(t)) return "idle";
  return now.getTime() - t <= SESSION_ACTIVE_WINDOW_MS ? "active" : "idle";
}

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

/** "just now", "5 minutes ago", "3 hours ago", "2 days ago", "3 months ago". */
export function timeAgo(date: Date | string, now: Date = new Date()): string {
  const ms = now.getTime() - new Date(date).getTime();
  if (Number.isNaN(ms)) return "unknown";
  if (ms < MIN) return "just now";
  const mins = Math.round(ms / MIN);
  if (mins < 60) return `${plural(mins, "minute")} ago`;
  const hours = Math.round(ms / HOUR);
  if (hours < 24) return `${plural(hours, "hour")} ago`;
  const days = Math.round(ms / DAY);
  if (days < 30) return `${plural(days, "day")} ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${plural(months, "month")} ago`;
  return `${plural(Math.round(days / 365), "year")} ago`;
}

/** "in less than a minute", "in 11 hours", "in 3 days" · "expired" once past. */
export function timeUntil(date: Date | string, now: Date = new Date()): string {
  const ms = new Date(date).getTime() - now.getTime();
  if (Number.isNaN(ms)) return "unknown";
  if (ms <= 0) return "expired";
  if (ms < MIN) return "in less than a minute";
  const mins = Math.round(ms / MIN);
  if (mins < 60) return `in ${plural(mins, "minute")}`;
  const hours = Math.round(ms / HOUR);
  if (hours < 24) return `in ${plural(hours, "hour")}`;
  const days = Math.round(ms / DAY);
  if (days < 30) return `in ${plural(days, "day")}`;
  const months = Math.round(days / 30);
  if (months < 12) return `in ${plural(months, "month")}`;
  return `in ${plural(Math.round(days / 365), "year")}`;
}
