import type { FirmwareImage } from "../../types/index.js";

// TODO(M1): parse Intel HEX records (:LLAAAATT[DD...]CC) into a flat
// FirmwareImage byte buffer, honoring extended linear/segment address
// records for images that cross the 64KiB boundary.
export function parseIntelHex(_text: string): FirmwareImage {
  throw new Error("Not implemented");
}
