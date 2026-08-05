export function verifyFlash(expected: Uint8Array, readback: Uint8Array): boolean {
  if (expected.length !== readback.length) {
    return false;
  }
  for (let i = 0; i < expected.length; i++) {
    if (expected[i] !== readback[i]) {
      return false;
    }
  }
  return true;
}
