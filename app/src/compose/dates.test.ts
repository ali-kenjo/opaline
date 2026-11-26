import { describe, expect, it } from "vitest";
import { formatDate } from "./dates";

// 2026-11-23 09:09:07 UTC
const T = Date.UTC(2026, 10, 23, 9, 9, 7);

describe("date()", () => {
  it("formats skeletons in a zone", () => {
    expect(formatDate(T, "Hm", "Europe/Berlin", "en")).toBe("10:09");
    expect(formatDate(T, "Hms", "UTC", "en")).toBe("09:09:07");
    expect(formatDate(T, "hm", "UTC", "en")).toMatch(/^9:09\s?AM$/);
    expect(formatDate(T, "yMMMd", "UTC", "en")).toBe("Nov 23, 2026");
    expect(formatDate(T, "yMMMMEEEEd", "UTC", "de")).toBe("Montag, 23. November 2026");
    expect(formatDate(T, "MMMEd", "UTC", "en")).toBe("Mon, Nov 23");
  });

  it("gives null for an unknown zone or time", () => {
    expect(formatDate(T, "Hm", "Mars/Olympus", "en")).toBeNull();
    expect(formatDate(NaN, "Hm", "UTC", "en")).toBeNull();
  });
});
