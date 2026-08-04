import type { FirmwareImage } from "../types/index.js";

export function verifyFlash(expected: FirmwareImage, readback: Uint8Array): boolean {
  if (expected.bytes.length !== readback.length) {
    return false;
  }
  for (let i = 0; i < expected.bytes.length; i++) {
    if (expected.bytes[i] !== readback[i]) {
      return false;
    }
  }
  return true;
}
