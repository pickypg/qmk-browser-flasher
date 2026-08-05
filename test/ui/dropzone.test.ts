import { describe, expect, it } from "vitest";

import { isBinFile } from "../../src/ui/components/dropzone.js";

describe("isBinFile", () => {
  it("accepts a .bin file", () => {
    expect(isBinFile(new File(["data"], "firmware.bin"))).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isBinFile(new File(["data"], "FIRMWARE.BIN"))).toBe(true);
  });

  it("rejects other extensions", () => {
    expect(isBinFile(new File(["data"], "firmware.hex"))).toBe(false);
    expect(isBinFile(new File(["data"], "firmware"))).toBe(false);
  });
});
