import { describe, expect, it } from "vitest";

import { isBinFile, isHexFile, isUf2File } from "../../src/ui/components/dropzone.js";

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

describe("isHexFile", () => {
  it("accepts a .hex file", () => {
    expect(isHexFile(new File(["data"], "firmware.hex"))).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isHexFile(new File(["data"], "FIRMWARE.HEX"))).toBe(true);
  });

  it("rejects other extensions", () => {
    expect(isHexFile(new File(["data"], "firmware.bin"))).toBe(false);
    expect(isHexFile(new File(["data"], "firmware"))).toBe(false);
  });
});

describe("isUf2File", () => {
  it("accepts a .uf2 file", () => {
    expect(isUf2File(new File(["data"], "firmware.uf2"))).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isUf2File(new File(["data"], "FIRMWARE.UF2"))).toBe(true);
  });

  it("rejects other extensions", () => {
    expect(isUf2File(new File(["data"], "firmware.bin"))).toBe(false);
    expect(isUf2File(new File(["data"], "firmware"))).toBe(false);
  });
});
