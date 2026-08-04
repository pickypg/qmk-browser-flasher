import type { FirmwareImage } from "../../types/index.js";

// TODO(M6, phase 2): parse UF2's 512-byte-block format into a FirmwareImage.
export function parseUf2(_bytes: Uint8Array): FirmwareImage {
  throw new Error("Not implemented");
}
