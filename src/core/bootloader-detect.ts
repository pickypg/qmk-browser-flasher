import type { FlashableDevice, Protocol } from "../types/index.js";

// TODO(M1+): identify protocol from USB/HID descriptors (vendor/product ID,
// interface class) against board-db, falling back to user selection.
export function detectProtocol(_device: FlashableDevice): Protocol {
  throw new Error("Not implemented");
}
