// Parses ST DfuSe's memory-layout interface descriptor string, per ST
// document UM0424 section 4.3.2 (e.g. "@Internal Flash /0x08000000/64*002Kg").
// Format verified against dfu-util's src/dfuse_mem.c (GPL-2.0, read for the
// format spec only — nothing here is ported from it). See docs/PROTOCOL_NOTES.md.

export interface DfuSeSegment {
  readonly start: number;
  readonly end: number;
  readonly pageSizeBytes: number;
  readonly readable: boolean;
  readonly erasable: boolean;
  readonly writable: boolean;
}

const DFUSE_READABLE = 1;
const DFUSE_ERASABLE = 2;
const DFUSE_WRITABLE = 4;

const ADDRESS_GROUP = /\/0x([0-9a-fA-F]+)\//y;
const SEGMENT_GROUP = /(\d+)\*(\d+)([BKM])([^,]?),?/y;

export function parseDfuSeMemoryLayout(descriptor: string): DfuSeSegment[] {
  const nameEnd = descriptor.indexOf("/");
  if (nameEnd === -1 || !descriptor.startsWith("@")) {
    throw new Error(`Not a DfuSe memory-layout string: ${descriptor}`);
  }

  const segments: DfuSeSegment[] = [];
  let pos = nameEnd;

  ADDRESS_GROUP.lastIndex = pos;
  let addressMatch: RegExpExecArray | null;
  while ((addressMatch = ADDRESS_GROUP.exec(descriptor)) !== null) {
    let address = parseInt(addressMatch[1]!, 16);
    pos = ADDRESS_GROUP.lastIndex;

    SEGMENT_GROUP.lastIndex = pos;
    let segmentMatch: RegExpExecArray | null;
    while ((segmentMatch = SEGMENT_GROUP.exec(descriptor)) !== null) {
      const count = parseInt(segmentMatch[1]!, 10);
      let size = parseInt(segmentMatch[2]!, 10);
      const multiplier = segmentMatch[3];
      const typeChar = segmentMatch[4];

      if (multiplier === "K") size *= 1024;
      else if (multiplier === "M") size *= 1024 * 1024;

      const flags = typeChar ? typeChar.charCodeAt(0) & 0x7 : 0;
      segments.push({
        start: address,
        end: address + count * size - 1,
        pageSizeBytes: size,
        readable: (flags & DFUSE_READABLE) !== 0,
        erasable: (flags & DFUSE_ERASABLE) !== 0,
        writable: (flags & DFUSE_WRITABLE) !== 0,
      });

      address += count * size;
      pos = SEGMENT_GROUP.lastIndex;

      if (descriptor[pos - 1] !== ",") {
        break;
      }
    }

    ADDRESS_GROUP.lastIndex = pos;
  }

  return segments;
}

export function findSegment(segments: readonly DfuSeSegment[], address: number): DfuSeSegment | undefined {
  return segments.find((segment) => address >= segment.start && address <= segment.end);
}
