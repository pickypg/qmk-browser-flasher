import type { FirmwareImage } from "../../types/index.js";

// Intel HEX record: ":LLAAAATT[DD...]CC" — byte count, 16-bit address,
// record type, data, checksum, all hex-encoded. This parser is
// protocol-agnostic (no assumptions about which chip/base address is
// "correct") — that validation belongs to the caller, since a HalfKay/
// Caterina/UF2 target could legitimately use a different base address
// than STM32's 0x08000000. See docs/PROTOCOL_NOTES.md.

const RECORD_TYPE_DATA = 0x00;
const RECORD_TYPE_EOF = 0x01;
const RECORD_TYPE_EXTENDED_SEGMENT_ADDRESS = 0x02;
const RECORD_TYPE_START_SEGMENT_ADDRESS = 0x03;
const RECORD_TYPE_EXTENDED_LINEAR_ADDRESS = 0x04;
const RECORD_TYPE_START_LINEAR_ADDRESS = 0x05;

interface DataChunk {
  readonly address: number;
  readonly data: Uint8Array;
}

function parseLine(line: string): number[] {
  if (!line.startsWith(":")) {
    throw new Error(`Malformed Intel HEX line (missing ':'): "${line}"`);
  }
  const hex = line.slice(1);
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error(`Malformed Intel HEX line (invalid hex digits): "${line}"`);
  }
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.slice(i, i + 2), 16));
  }
  return bytes;
}

/** Parses Intel HEX text into a flat FirmwareImage, honoring Extended
 * Linear/Segment Address records for images crossing a 64KiB boundary.
 * Any gap between data records is filled with 0x00 — confirmed against a
 * real compiled pair (nuphy-qmk-firmware's claude_test build, both .hex
 * and .bin) that this matches what `arm-none-eabi-objcopy -O binary`
 * itself zero-fills between sections, byte-for-byte, rather than the
 * 0xFF an "erased flash" assumption would suggest. */
export function parseIntelHex(text: string): FirmwareImage {
  const chunks: DataChunk[] = [];
  let upperAddress = 0;
  let sawEof = false;

  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }

    const bytes = parseLine(line);
    if (bytes.length < 5) {
      throw new Error(`Malformed Intel HEX record (too short): "${line}"`);
    }

    const byteCount = bytes[0]!;
    if (bytes.length !== byteCount + 5) {
      throw new Error(`Malformed Intel HEX record (length doesn't match byte count): "${line}"`);
    }

    const sum = bytes.slice(0, byteCount + 4).reduce((total, b) => total + b, 0);
    const expectedChecksum = (0x100 - (sum & 0xff)) & 0xff;
    const checksum = bytes[byteCount + 4]!;
    if (checksum !== expectedChecksum) {
      throw new Error(`Intel HEX checksum mismatch: "${line}"`);
    }

    const recordAddress = (bytes[1]! << 8) | bytes[2]!;
    const recordType = bytes[3]!;
    const data = Uint8Array.from(bytes.slice(4, 4 + byteCount));

    switch (recordType) {
      case RECORD_TYPE_DATA:
        chunks.push({ address: upperAddress + recordAddress, data });
        break;
      case RECORD_TYPE_EOF:
        sawEof = true;
        break;
      case RECORD_TYPE_EXTENDED_SEGMENT_ADDRESS:
        upperAddress = ((data[0]! << 8) | data[1]!) << 4;
        break;
      case RECORD_TYPE_EXTENDED_LINEAR_ADDRESS:
        upperAddress = ((data[0]! << 8) | data[1]!) << 16;
        break;
      case RECORD_TYPE_START_SEGMENT_ADDRESS:
      case RECORD_TYPE_START_LINEAR_ADDRESS:
        break; // entry point — irrelevant for flashing, safely ignored
      default:
        throw new Error(`Unsupported Intel HEX record type 0x${recordType.toString(16)}: "${line}"`);
    }
  }

  if (!sawEof) {
    throw new Error("Intel HEX file is missing its end-of-file record");
  }
  if (chunks.length === 0) {
    throw new Error("Firmware file is empty");
  }

  const startAddress = Math.min(...chunks.map((c) => c.address));
  const endAddress = Math.max(...chunks.map((c) => c.address + c.data.length));
  const bytes = new Uint8Array(endAddress - startAddress).fill(0x00);
  for (const chunk of chunks) {
    bytes.set(chunk.data, chunk.address - startAddress);
  }

  return { bytes, startAddress };
}
