import { describe, expect, it } from "vitest";

import { findSegment, parseDfuSeMemoryLayout } from "../../src/protocols/dfuse-memory-layout.js";

describe("parseDfuSeMemoryLayout", () => {
  it("parses a real single-segment descriptor (STM32F072xB)", () => {
    const segments = parseDfuSeMemoryLayout("@Internal Flash /0x08000000/64*002Kg");

    expect(segments).toEqual([
      {
        start: 0x08000000,
        end: 0x0801ffff,
        pageSizeBytes: 2048,
        readable: true,
        erasable: true,
        writable: true,
      },
    ]);
  });

  it("parses comma-separated non-uniform sectors (synthetic, e.g. STM32F4-style)", () => {
    const segments = parseDfuSeMemoryLayout("@Internal Flash /0x08000000/04*016Kg,01*064Kg,07*128Kg");

    expect(segments).toHaveLength(3);
    expect(segments[0]).toMatchObject({ start: 0x08000000, end: 0x08000000 + 4 * 16384 - 1, pageSizeBytes: 16384 });
    expect(segments[1]).toMatchObject({ start: 0x08000000 + 4 * 16384, pageSizeBytes: 65536 });
    expect(segments[2]).toMatchObject({ pageSizeBytes: 131072 });
    // Segments should be contiguous.
    expect(segments[1]!.start).toBe(segments[0]!.end + 1);
    expect(segments[2]!.start).toBe(segments[1]!.end + 1);
  });

  it("parses multiple separate address groups in one string", () => {
    const segments = parseDfuSeMemoryLayout("@Device /0x08000000/64*002Kg/0x1FFFF800/01*016Be");

    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ start: 0x08000000 });
    // 'e' = 0x65 & 7 = 5 = readable + writable, not erasable.
    expect(segments[1]).toMatchObject({ start: 0x1fffF800, pageSizeBytes: 16, readable: true, erasable: false, writable: true });
  });

  it("decodes read/erase/write flags from the type character", () => {
    // 'g' = 0x67 & 7 = 7 (all), 'e' = 0x65 & 7 = 5 (readable+writable, no erase)
    const segments = parseDfuSeMemoryLayout("@Flash /0x08000000/01*002Kg,01*002Ke");
    expect(segments[0]).toMatchObject({ readable: true, erasable: true, writable: true });
    expect(segments[1]).toMatchObject({ readable: true, erasable: false, writable: true });
  });

  it("throws on a non-DfuSe-formatted string", () => {
    expect(() => parseDfuSeMemoryLayout("not a dfuse string")).toThrow();
  });
});

describe("findSegment", () => {
  it("finds the segment containing a given address", () => {
    const segments = parseDfuSeMemoryLayout("@Internal Flash /0x08000000/64*002Kg");
    expect(findSegment(segments, 0x08000000)).toMatchObject({ pageSizeBytes: 2048 });
    expect(findSegment(segments, 0x0801ffff)).toMatchObject({ pageSizeBytes: 2048 });
  });

  it("returns undefined for an address outside all segments", () => {
    const segments = parseDfuSeMemoryLayout("@Internal Flash /0x08000000/64*002Kg");
    expect(findSegment(segments, 0x09000000)).toBeUndefined();
  });
});
