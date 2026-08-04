import type { FirmwareImage } from "../../types/index.js";

// TODO(M1): wrap a raw .bin buffer as a FirmwareImage at a caller-supplied
// start address (raw binaries carry no address metadata of their own).
export function parseBin(_bytes: Uint8Array, _startAddress: number): FirmwareImage {
  throw new Error("Not implemented");
}
