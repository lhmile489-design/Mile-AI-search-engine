import { describe, expect, it } from "vitest";
import { formatMs } from "../format";

describe("formatMs", () => {
  it("shows a sub-millisecond measurement as less than 1 ms, never 0 ms", () => {
    expect(formatMs(0)).toBe("小于 1 ms");
    expect(formatMs(0.4)).toBe("小于 1 ms");
  });

  it("keeps real measurements unchanged", () => {
    expect(formatMs(1)).toBe("1 ms");
    expect(formatMs(1284)).toBe("1,284 ms");
  });
});
