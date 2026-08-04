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
