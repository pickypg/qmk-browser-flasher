import type { BoardEntry } from "../types/index.js";
import boardsJson from "./boards.json";

export const boards: readonly BoardEntry[] = boardsJson as BoardEntry[];

export function getBoard(id: string): BoardEntry {
  const board = boards.find((b) => b.id === id);
  if (!board) {
    throw new Error(`Unknown board: ${id}`);
  }
  return board;
}

/** Looks up a board by its normal-operating-mode USB IDs (hidVendorId/
 * hidProductId) — used for both opt-in WebHID detection and firmware-file
 * detection (src/core/board-detect.ts, src/core/firmware-parser/
 * usb-descriptor.ts). Distinct from usbVendorId/usbProductId, which are
 * bootloader-mode IDs and not usable for matching (see
 * docs/PROTOCOL_NOTES.md). */
export function findBoardByHidIds(vendorId: number, productId: number): BoardEntry | undefined {
  return boards.find((b) => b.hidVendorId === vendorId && b.hidProductId === productId);
}
