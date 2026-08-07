import { describe, expect, it } from "vitest";

import { parseUf2 } from "../../../src/core/firmware-parser/uf2.js";

const MAGIC_START0 = 0x0a324655;
const MAGIC_START1 = 0x9e5d5157;
const MAGIC_END = 0x0ab16f30;
const RP2040_FAMILY_ID = 0xe48bff56;
const FLAG_NOT_MAIN_FLASH = 0x00000001;
const FLAG_FAMILY_ID_PRESENT = 0x00002000;

interface BlockOptions {
  readonly targetAddr: number;
  readonly data: number[];
  readonly blockNo: number;
  readonly numBlocks: number;
  readonly flags?: number;
  readonly familyId?: number;
  readonly corruptMagic?: boolean;
}

/** Builds one well-formed 512-byte UF2 block. */
function block(opts: BlockOptions): Uint8Array {
  const buf = new Uint8Array(512);
  const view = new DataView(buf.buffer);
  view.setUint32(0, opts.corruptMagic ? 0xdeadbeef : MAGIC_START0, true);
  view.setUint32(4, MAGIC_START1, true);
  view.setUint32(8, opts.flags ?? 0, true);
  view.setUint32(12, opts.targetAddr, true);
  view.setUint32(16, opts.data.length, true);
  view.setUint32(20, opts.blockNo, true);
  view.setUint32(24, opts.numBlocks, true);
  view.setUint32(28, opts.familyId ?? 0, true);
  buf.set(opts.data, 32);
  view.setUint32(508, MAGIC_END, true);
  return buf;
}

function file(blocks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(blocks.length * 512);
  blocks.forEach((b, i) => out.set(b, i * 512));
  return out;
}

describe("parseUf2", () => {
  it("parses a simple single-block file", () => {
    const bytes = file([block({ targetAddr: 0x10000000, data: [0xde, 0xad, 0xbe, 0xef], blockNo: 0, numBlocks: 1 })]);

    const image = parseUf2(bytes);

    expect(image.startAddress).toBe(0x10000000);
    expect(Array.from(image.bytes)).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });

  it("assembles multiple contiguous blocks", () => {
    const bytes = file([
      block({ targetAddr: 0x10000000, data: [1, 2, 3, 4], blockNo: 0, numBlocks: 2 }),
      block({ targetAddr: 0x10000004, data: [5, 6, 7, 8], blockNo: 1, numBlocks: 2 }),
    ]);

    const image = parseUf2(bytes);

    expect(image.startAddress).toBe(0x10000000);
    expect(Array.from(image.bytes)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("throws on invalid magic numbers", () => {
    const bytes = file([block({ targetAddr: 0x10000000, data: [1], blockNo: 0, numBlocks: 1, corruptMagic: true })]);
    expect(() => parseUf2(bytes)).toThrow(/magic/i);
  });

  it("throws on a blockNo/numBlocks mismatch", () => {
    const bytes = file([block({ targetAddr: 0x10000000, data: [1], blockNo: 0, numBlocks: 5 })]);
    expect(() => parseUf2(bytes)).toThrow(/blockNo/);
  });

  it("throws when familyID is present but wrong", () => {
    const bytes = file([
      block({ targetAddr: 0x10000000, data: [1], blockNo: 0, numBlocks: 1, flags: FLAG_FAMILY_ID_PRESENT, familyId: 0x12345678 }),
    ]);
    expect(() => parseUf2(bytes)).toThrow(/board family/i);
  });

  it("accepts a file with the correct RP2040 familyID", () => {
    const bytes = file([
      block({ targetAddr: 0x10000000, data: [0xaa], blockNo: 0, numBlocks: 1, flags: FLAG_FAMILY_ID_PRESENT, familyId: RP2040_FAMILY_ID }),
    ]);

    const image = parseUf2(bytes);

    expect(Array.from(image.bytes)).toEqual([0xaa]);
  });

  it("assembles blocks correctly even when file order doesn't match address order", () => {
    const bytes = file([
      block({ targetAddr: 0x10000004, data: [5, 6, 7, 8], blockNo: 0, numBlocks: 2 }),
      block({ targetAddr: 0x10000000, data: [1, 2, 3, 4], blockNo: 1, numBlocks: 2 }),
    ]);

    const image = parseUf2(bytes);

    expect(image.startAddress).toBe(0x10000000);
    expect(Array.from(image.bytes)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("throws on a gap between blocks", () => {
    const bytes = file([
      block({ targetAddr: 0x10000000, data: [1, 2, 3, 4], blockNo: 0, numBlocks: 2 }),
      block({ targetAddr: 0x10000008, data: [5, 6, 7, 8], blockNo: 1, numBlocks: 2 }),
    ]);
    expect(() => parseUf2(bytes)).toThrow(/gap|overlap/i);
  });

  it("excludes not-main-flash-flagged blocks from the output", () => {
    const bytes = file([
      block({ targetAddr: 0x10000000, data: [1, 2, 3, 4], blockNo: 0, numBlocks: 2 }),
      block({ targetAddr: 0x20000000, data: [9, 9], blockNo: 1, numBlocks: 2, flags: FLAG_NOT_MAIN_FLASH }),
    ]);

    const image = parseUf2(bytes);

    expect(image.startAddress).toBe(0x10000000);
    expect(Array.from(image.bytes)).toEqual([1, 2, 3, 4]);
  });

  it("throws on an empty file", () => {
    expect(() => parseUf2(new Uint8Array(0))).toThrow(/empty/i);
  });

  it("throws when the file size isn't a multiple of 512", () => {
    expect(() => parseUf2(new Uint8Array(511))).toThrow(/512/);
  });
});
