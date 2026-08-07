import type { FirmwareImage } from "../../types/index.js";

// UF2 block format, confirmed against microsoft/uf2's README/spec: 512-byte
// blocks, each a 32-byte header + up to 476 bytes of data + a 4-byte
// trailing magic. Field layout (all multi-byte fields LE):
//   magicStart0(4) magicStart1(4) flags(4) targetAddr(4) payloadSize(4)
//   blockNo(4) numBlocks(4) fileSize/familyID(4) data(476) magicEnd(4)
// See docs/PROTOCOL_NOTES.md.

const BLOCK_SIZE = 512;
const DATA_OFFSET = 32;
const MAX_PAYLOAD = 476;

const MAGIC_START0 = 0x0a324655;
const MAGIC_START1 = 0x9e5d5157;
const MAGIC_END = 0x0ab16f30;

const FLAG_NOT_MAIN_FLASH = 0x00000001;
const FLAG_FAMILY_ID_PRESENT = 0x00002000;

/** RP2040's UF2 family ID, confirmed against microsoft/uf2's
 * uf2families.json — the only family this tool targets. */
const RP2040_FAMILY_ID = 0xe48bff56;

interface DataChunk {
  readonly targetAddr: number;
  readonly data: Uint8Array;
}

/** Parses a .uf2 file into a flat FirmwareImage. Validates every block's
 * magic numbers and blockNo/numBlocks bookkeeping (rejecting anything
 * that isn't a well-formed, complete file), cross-checks familyID against
 * RP2040 when present, and assembles the flash-bound blocks into one
 * contiguous image — real QMK RP2040 builds are a single contiguous
 * image, so a gap or overlap between blocks is treated as a malformed
 * file rather than something to fill in. */
export function parseUf2(bytes: Uint8Array): FirmwareImage {
  if (bytes.length === 0) {
    throw new Error("Firmware file is empty");
  }
  if (bytes.length % BLOCK_SIZE !== 0) {
    throw new Error(`.uf2 file size (${bytes.length} bytes) isn't a multiple of the 512-byte block size — likely truncated`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const numBlocksTotal = bytes.length / BLOCK_SIZE;
  const chunks: DataChunk[] = [];

  for (let i = 0; i < numBlocksTotal; i++) {
    const offset = i * BLOCK_SIZE;

    const magicStart0 = view.getUint32(offset, true);
    const magicStart1 = view.getUint32(offset + 4, true);
    const magicEnd = view.getUint32(offset + BLOCK_SIZE - 4, true);
    if (magicStart0 !== MAGIC_START0 || magicStart1 !== MAGIC_START1 || magicEnd !== MAGIC_END) {
      throw new Error(`Block ${i} has invalid UF2 magic numbers — not a valid .uf2 file`);
    }

    const flags = view.getUint32(offset + 8, true);
    const targetAddr = view.getUint32(offset + 12, true);
    const payloadSize = view.getUint32(offset + 16, true);
    const blockNo = view.getUint32(offset + 20, true);
    const numBlocks = view.getUint32(offset + 24, true);
    const fileSizeOrFamilyId = view.getUint32(offset + 28, true);

    if (blockNo !== i || numBlocks !== numBlocksTotal) {
      throw new Error(`Block ${i} declares blockNo=${blockNo}/numBlocks=${numBlocks}, but the file has ${numBlocksTotal} blocks — out of order or truncated`);
    }
    if (payloadSize > MAX_PAYLOAD) {
      throw new Error(`Block ${i} declares payloadSize=${payloadSize}, more than the 476-byte maximum`);
    }
    if ((flags & FLAG_FAMILY_ID_PRESENT) !== 0 && fileSizeOrFamilyId !== RP2040_FAMILY_ID) {
      throw new Error(`This .uf2 file is for board family 0x${fileSizeOrFamilyId.toString(16)}, not RP2040 (0x${RP2040_FAMILY_ID.toString(16)})`);
    }
    if ((flags & FLAG_NOT_MAIN_FLASH) !== 0) {
      continue;
    }

    chunks.push({ targetAddr, data: bytes.subarray(offset + DATA_OFFSET, offset + DATA_OFFSET + payloadSize) });
  }

  if (chunks.length === 0) {
    throw new Error("No flash-data blocks found in this .uf2 file");
  }

  chunks.sort((a, b) => a.targetAddr - b.targetAddr);

  const startAddress = chunks[0]!.targetAddr;
  let cursor = startAddress;
  for (const chunk of chunks) {
    if (chunk.targetAddr !== cursor) {
      throw new Error(`Gap or overlap in .uf2 data at 0x${cursor.toString(16)}..0x${chunk.targetAddr.toString(16)} — not a single contiguous image`);
    }
    cursor += chunk.data.length;
  }

  const combined = new Uint8Array(cursor - startAddress);
  for (const chunk of chunks) {
    combined.set(chunk.data, chunk.targetAddr - startAddress);
  }

  return { bytes: combined, startAddress };
}
