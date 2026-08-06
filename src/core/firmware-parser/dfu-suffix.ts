// dfu-util's DFU suffix format (its `dfu-suffix` tool): a 16-byte trailer
// some .bin builds carry, meant for command-line dfu-util's own file
// validation — not firmware content. Layout (all multi-byte fields LE):
//   bcdDevice(2) idProduct(2) idVendor(2) bcdDFU(2) "UFD" bLength(1)=16 CRC32(4)
// Confirmed field-by-field against a real compiled NuPhy Air75 V2 .bin
// (idVendor=0x0483/idProduct=0xDF11 — ST's generic bootloader ID, not the
// board's own). The CRC32 variant needed empirical verification: standard
// poly 0xEDB88320, init 0xFFFFFFFF, over every byte preceding the CRC
// field itself, but WITHOUT the final inversion most CRC-32
// implementations (zlib/PNG/gzip) apply — confirmed by brute-force
// matching against the real embedded CRC value. See docs/PROTOCOL_NOTES.md.

const SUFFIX_LENGTH = 16;
const SIGNATURE = [0x55, 0x46, 0x44]; // "UFD"

export interface DfuSuffix {
  readonly vendorId: number;
  readonly productId: number;
  readonly bcdDevice: number;
  readonly crcValid: boolean;
}

function crc32NoFinalInvert(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return crc >>> 0;
}

/** Looks for a DFU suffix at the end of `bytes` — returns undefined if
 * it's too short or the anchor (signature + bLength) doesn't match,
 * since most firmware files won't have one and that's not an error.
 * When found, `crcValid` reports whether the embedded CRC32 matches the
 * preceding content, catching a corrupted/truncated file. */
export function findDfuSuffix(bytes: Uint8Array): DfuSuffix | undefined {
  if (bytes.length < SUFFIX_LENGTH) {
    return undefined;
  }

  const suffix = bytes.subarray(bytes.length - SUFFIX_LENGTH);
  const signatureMatches = suffix[8] === SIGNATURE[0] && suffix[9] === SIGNATURE[1] && suffix[10] === SIGNATURE[2];
  const bLength = suffix[11]!;
  if (!signatureMatches || bLength !== SUFFIX_LENGTH) {
    return undefined;
  }

  const bcdDevice = suffix[0]! | (suffix[1]! << 8);
  const idProduct = suffix[2]! | (suffix[3]! << 8);
  const idVendor = suffix[4]! | (suffix[5]! << 8);
  const crcField = suffix[12]! | (suffix[13]! << 8) | (suffix[14]! << 16) | (suffix[15]! << 24);

  const computedCrc = crc32NoFinalInvert(bytes.subarray(0, bytes.length - 4));

  return {
    vendorId: idVendor,
    productId: idProduct,
    bcdDevice,
    crcValid: (computedCrc >>> 0) === (crcField >>> 0),
  };
}
