import type { FirmwareImage } from "../types/index.js";

// TODO(M1): read back written flash contents from the device and compare
// against the source FirmwareImage byte-for-byte (or by checksum, where the
// protocol doesn't support raw readback).
export function verifyFlash(_expected: FirmwareImage, _readback: Uint8Array): boolean {
  throw new Error("Not implemented");
}
