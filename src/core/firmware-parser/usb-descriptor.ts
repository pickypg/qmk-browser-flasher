// Compiled firmware embeds its own USB device descriptor as literal bytes
// in flash (any USB stack needs that table regardless of protocol) —
// confirmed empirically against a real NuPhy Air75 V2 build, where the
// descriptor's bcdDevice field independently matched the board's own
// keyboard.json device_version, ruling out a coincidental byte match. This
// scans a raw .bin for that shape to recover the board's VID/PID without
// any device connected. See docs/PROTOCOL_NOTES.md.

const DEVICE_DESCRIPTOR_LENGTH = 18;
const B_LENGTH = 0x12;
const B_DESCRIPTOR_TYPE_DEVICE = 0x01;
const VALID_MAX_PACKET_SIZES = new Set([8, 16, 32, 64]);
const MAX_STRING_INDEX = 16;
const MAX_NUM_CONFIGURATIONS = 4;

export interface UsbDeviceIds {
  readonly vendorId: number;
  readonly productId: number;
}

/** Scans `bytes` for a standard 18-byte USB device descriptor
 * (bLength=18, bDescriptorType=DEVICE, plus sane values for
 * bMaxPacketSize0/string indices/bNumConfigurations) and returns its
 * vendorId/productId. A `12 01` byte pair is common enough in arbitrary
 * binary data that the surrounding fields are sanity-checked too, not
 * just the two anchor bytes. The same descriptor can legitimately appear
 * more than once (matches dedupe by value), but if *different* plausible
 * descriptors are found, that's ambiguous — returns undefined rather than
 * guessing, same as finding none at all. */
export function findUsbDeviceDescriptor(bytes: Uint8Array): UsbDeviceIds | undefined {
  const candidates = new Map<string, UsbDeviceIds>();

  for (let i = 0; i + DEVICE_DESCRIPTOR_LENGTH <= bytes.length; i++) {
    if (bytes[i] !== B_LENGTH || bytes[i + 1] !== B_DESCRIPTOR_TYPE_DEVICE) {
      continue;
    }

    const maxPacketSize0 = bytes[i + 7]!;
    const iManufacturer = bytes[i + 14]!;
    const iProduct = bytes[i + 15]!;
    const iSerialNumber = bytes[i + 16]!;
    const numConfigurations = bytes[i + 17]!;

    if (!VALID_MAX_PACKET_SIZES.has(maxPacketSize0)) {
      continue;
    }
    if (numConfigurations < 1 || numConfigurations > MAX_NUM_CONFIGURATIONS) {
      continue;
    }
    if (iManufacturer > MAX_STRING_INDEX || iProduct > MAX_STRING_INDEX || iSerialNumber > MAX_STRING_INDEX) {
      continue;
    }

    const vendorId = bytes[i + 8]! | (bytes[i + 9]! << 8);
    const productId = bytes[i + 10]! | (bytes[i + 11]! << 8);
    if (vendorId === 0x0000 || vendorId === 0xffff || productId === 0x0000 || productId === 0xffff) {
      continue;
    }

    candidates.set(`${vendorId}:${productId}`, { vendorId, productId });
  }

  const distinct = [...candidates.values()];
  if (distinct.length !== 1) {
    return undefined;
  }
  return distinct[0];
}
