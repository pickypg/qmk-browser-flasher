import { describe, expect, it } from "vitest";

import { findDfuSuffix } from "../../../src/core/firmware-parser/dfu-suffix.js";

/** Mirrors dfu-suffix's CRC32 variant, confirmed empirically against a
 * real compiled .bin in dfu-suffix.ts's own header comment — used here
 * only to build valid test fixtures, not to re-derive correctness. */
function crc32NoFinalInvert(bytes: number[]): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return crc >>> 0;
}

function buildSuffixedBin(content: number[], options: { vendorId: number; productId: number; bcdDevice?: number; corruptCrc?: boolean }): Uint8Array {
  const bcdDevice = options.bcdDevice ?? 0xffff;
  const suffixWithoutCrc = [
    bcdDevice & 0xff,
    (bcdDevice >> 8) & 0xff,
    options.productId & 0xff,
    (options.productId >> 8) & 0xff,
    options.vendorId & 0xff,
    (options.vendorId >> 8) & 0xff,
    0x00,
    0x01, // bcdDFU = 0x0100
    0x55,
    0x46,
    0x44, // "UFD"
    0x10, // bLength = 16
  ];
  const crc = crc32NoFinalInvert([...content, ...suffixWithoutCrc]);
  const crcBytes = [crc & 0xff, (crc >> 8) & 0xff, (crc >> 16) & 0xff, (crc >>> 24) & 0xff];
  if (options.corruptCrc) {
    crcBytes[0] = (crcBytes[0]! ^ 0xff) & 0xff;
  }
  return new Uint8Array([...content, ...suffixWithoutCrc, ...crcBytes]);
}

describe("findDfuSuffix", () => {
  it("returns undefined when there's no suffix", () => {
    const bytes = new Uint8Array(64).fill(0xaa);
    expect(findDfuSuffix(bytes)).toBeUndefined();
  });

  it("returns undefined for a buffer shorter than a full suffix", () => {
    expect(findDfuSuffix(new Uint8Array(10))).toBeUndefined();
  });

  it("finds a valid suffix and reports its fields", () => {
    const bytes = buildSuffixedBin([0xde, 0xad, 0xbe, 0xef], { vendorId: 0x0483, productId: 0xdf11 });

    const suffix = findDfuSuffix(bytes);

    expect(suffix).toEqual({ vendorId: 0x0483, productId: 0xdf11, bcdDevice: 0xffff, crcValid: true });
  });

  it("reports crcValid: false when the checksum doesn't match (corrupted/truncated file)", () => {
    const bytes = buildSuffixedBin([0xde, 0xad, 0xbe, 0xef], { vendorId: 0x0483, productId: 0xdf11, corruptCrc: true });

    expect(findDfuSuffix(bytes)?.crcValid).toBe(false);
  });

  it("doesn't misdetect a tail that only coincidentally ends the right length", () => {
    // Same shape/length as a real suffix, but the signature bytes are wrong.
    const bytes = new Uint8Array([...new Array<number>(4).fill(0xaa), 1, 2, 3, 4, 5, 6, 7, 8, 0x00, 0x00, 0x00, 0x10, 9, 9, 9, 9]);
    expect(findDfuSuffix(bytes)).toBeUndefined();
  });
});
