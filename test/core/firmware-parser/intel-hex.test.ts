import { describe, expect, it } from "vitest";

import { parseIntelHex } from "../../../src/core/firmware-parser/intel-hex.js";

/** Builds one well-formed Intel HEX record line, computing its checksum. */
function record(address: number, type: number, data: number[]): string {
  const bytes = [data.length, (address >> 8) & 0xff, address & 0xff, type, ...data];
  const sum = bytes.reduce((total, b) => total + b, 0);
  const checksum = (0x100 - (sum & 0xff)) & 0xff;
  return `:${[...bytes, checksum].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

const EOF_RECORD = ":00000001FF";

describe("parseIntelHex", () => {
  it("parses a simple valid file into the expected bytes/startAddress", () => {
    const text = [record(0x0000, 0x00, [0xde, 0xad, 0xbe, 0xef]), EOF_RECORD].join("\n");

    const image = parseIntelHex(text);

    expect(image.startAddress).toBe(0);
    expect(Array.from(image.bytes)).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });

  it("honors Extended Linear Address records across a 64KiB boundary", () => {
    const text = [
      record(0x0000, 0x04, [0x08, 0x00]), // upper 16 bits = 0x0800 -> base 0x08000000
      record(0xfffc, 0x00, [0x01, 0x02, 0x03, 0x04]), // ends exactly at the 64KiB boundary
      record(0x0000, 0x04, [0x08, 0x01]), // upper 16 bits = 0x0801 -> base 0x08010000
      record(0x0000, 0x00, [0x05, 0x06]),
      EOF_RECORD,
    ].join("\n");

    const image = parseIntelHex(text);

    expect(image.startAddress).toBe(0x08000000 + 0xfffc);
    expect(image.bytes.length).toBe(0x08010002 - image.startAddress);
    expect(Array.from(image.bytes.slice(0, 4))).toEqual([1, 2, 3, 4]);
    expect(Array.from(image.bytes.slice(-2))).toEqual([5, 6]);
  });

  it("honors Extended Segment Address records", () => {
    const text = [
      record(0x0000, 0x02, [0x08, 0x00]), // segment 0x0800 -> base 0x0800 << 4 = 0x8000
      record(0x0000, 0x00, [0xaa]),
      EOF_RECORD,
    ].join("\n");

    const image = parseIntelHex(text);

    expect(image.startAddress).toBe(0x8000);
    expect(Array.from(image.bytes)).toEqual([0xaa]);
  });

  it("fills a gap between data records with 0x00, not 0xFF", () => {
    // Confirmed against a real compiled .hex/.bin pair from the same QMK
    // build: arm-none-eabi-objcopy zero-fills gaps between sections in the
    // .bin, not 0xFF — matching that exactly is what "correct" means here.
    const text = [record(0x0000, 0x00, [0x11, 0x22]), record(0x0010, 0x00, [0x33, 0x44]), EOF_RECORD].join("\n");

    const image = parseIntelHex(text);

    expect(image.bytes.length).toBe(0x12);
    expect(Array.from(image.bytes.slice(0, 2))).toEqual([0x11, 0x22]);
    expect(Array.from(image.bytes.slice(2, 0x10)).every((b) => b === 0)).toBe(true);
    expect(Array.from(image.bytes.slice(0x10, 0x12))).toEqual([0x33, 0x44]);
  });

  it("throws on a checksum mismatch", () => {
    const bad = ":04000000DEADBEEF00"; // real checksum would be C4, not 00
    expect(() => parseIntelHex([bad, EOF_RECORD].join("\n"))).toThrow(/checksum/i);
  });

  it("throws on a malformed line missing the leading colon", () => {
    expect(() => parseIntelHex(["0400000000000000", EOF_RECORD].join("\n"))).toThrow(/':'/);
  });

  it("throws on an unsupported record type", () => {
    const text = [record(0x0000, 0x06, [0x00]), EOF_RECORD].join("\n");
    expect(() => parseIntelHex(text)).toThrow(/unsupported/i);
  });

  it("throws when the file has no EOF record", () => {
    expect(() => parseIntelHex(record(0x0000, 0x00, [0x01]))).toThrow(/end-of-file/i);
  });

  it("throws when the file has no data records", () => {
    expect(() => parseIntelHex(EOF_RECORD)).toThrow(/empty/i);
  });
});
