import type { FirmwareImage } from "../../types/index.js";

export function parseBin(bytes: Uint8Array, startAddress: number): FirmwareImage {
  if (bytes.length === 0) {
    throw new Error("Firmware file is empty");
  }
  return { bytes, startAddress };
}
