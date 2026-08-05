import type { BoardEntry } from "../types/index.js";

/** Prompts the user to pick a HID device — their keyboard running
 * normally, not yet in bootloader mode — and matches it against board-db
 * entries with known hidVendorId/hidProductId, purely to preselect
 * bootloader-entry instructions. Opt-in only: call this from a click
 * handler, since WebHID's picker needs a user gesture and its own
 * permission grant, separate from (and in addition to) the WebUSB grant
 * used later for actual DFU pairing/flashing. Returns undefined if no
 * candidate has HID data, the user cancels the picker, or the selected
 * device doesn't match any candidate.
 *
 * `hid` is passed in rather than read from `navigator.hid` internally so
 * this is unit-testable with a plain fake. */
export async function detectBoardViaHid(hid: HID, candidates: readonly BoardEntry[]): Promise<BoardEntry | undefined> {
  const filters = candidates.flatMap((board) =>
    board.hidVendorId !== undefined && board.hidProductId !== undefined ? [{ vendorId: board.hidVendorId, productId: board.hidProductId }] : [],
  );
  if (filters.length === 0) {
    return undefined;
  }

  const devices = await hid.requestDevice({ filters });
  const device = devices[0];
  if (!device) {
    return undefined;
  }

  return candidates.find((board) => board.hidVendorId === device.vendorId && board.hidProductId === device.productId);
}
