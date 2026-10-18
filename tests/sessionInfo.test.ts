import { describe, expect, it } from "vitest";
import {
  SESSION_ACTIVE_WINDOW_MS,
  describeDevice,
  sessionStatus,
  timeAgo,
  timeUntil,
} from "../src/lib/sessionInfo";

describe("describeDevice", () => {
  it("labels the common browsers and systems from the real user agent", () => {
    const chromeWin =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
    expect(describeDevice(chromeWin).label).toBe("Chrome on Windows");

    const safariIphone =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
    expect(describeDevice(safariIphone).label).toBe("Safari on iOS");

    const firefoxAndroid = "Mozilla/5.0 (Android 14; Mobile; rv:128.0) Gecko/128.0 Firefox/128.0";
    expect(describeDevice(firefoxAndroid).label).toBe("Firefox on Android");

    const edge =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";
    expect(describeDevice(edge).label).toBe("Edge on Windows");

    const samsung =
      "Mozilla/5.0 (Linux; Android 13; SM-S901B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36";
    expect(describeDevice(samsung).label).toBe("Samsung Internet on Android");

    const macSafari =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
    expect(describeDevice(macSafari).label).toBe("Safari on macOS");
  });

  it("never invents a device when the agent is missing or unparsable", () => {
    expect(describeDevice(null).label).toBe("Device not recorded");
    expect(describeDevice("").label).toBe("Device not recorded");
    expect(describeDevice("curl/8.4.0").label).toBe("Unknown device");
    // Unparsable agent: neither half is claimed.
    expect(describeDevice("curl/8.4.0").browser).toBeNull();
    expect(describeDevice("curl/8.4.0").os).toBeNull();
    // A script agent that names Windows but no browser claims only the OS.
    expect(describeDevice("Mozilla/5.0 (Windows NT; Windows NT 10.0; en-US) WindowsPowerShell/5.1").label).toBe(
      "Unknown browser on Windows",
    );
  });
});

describe("sessionStatus", () => {
  const now = new Date("2026-10-18T12:00:00Z");
  it("marks the current session and derives active/idle from the real last-active time", () => {
    expect(sessionStatus({ current: true, lastActiveAt: now }, now)).toBe("current");
    expect(
      sessionStatus({ current: false, lastActiveAt: new Date(now.getTime() - 5 * 60_000) }, now),
    ).toBe("active");
    expect(
      sessionStatus({ current: false, lastActiveAt: new Date(now.getTime() - SESSION_ACTIVE_WINDOW_MS - 1000) }, now),
    ).toBe("idle");
  });
});

describe("relative timestamps", () => {
  const now = new Date("2026-10-18T12:00:00Z");
  it("renders readable past times", () => {
    expect(timeAgo(new Date(now.getTime() - 20_000), now)).toBe("just now");
    expect(timeAgo(new Date(now.getTime() - 5 * 60_000), now)).toBe("5 minutes ago");
    expect(timeAgo(new Date(now.getTime() - 60 * 60_000), now)).toBe("1 hour ago");
    expect(timeAgo(new Date(now.getTime() - 3 * 3_600_000), now)).toBe("3 hours ago");
    expect(timeAgo(new Date(now.getTime() - 2 * 86_400_000), now)).toBe("2 days ago");
  });
  it("renders readable future times and expiry", () => {
    expect(timeUntil(new Date(now.getTime() + 30_000), now)).toBe("in less than a minute");
    expect(timeUntil(new Date(now.getTime() + 11 * 3_600_000), now)).toBe("in 11 hours");
    expect(timeUntil(new Date(now.getTime() + 3 * 86_400_000), now)).toBe("in 3 days");
    expect(timeUntil(new Date(now.getTime() - 1), now)).toBe("expired");
  });
});
