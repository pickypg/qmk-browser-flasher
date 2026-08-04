import type { ChipParams } from "../types/index.js";
import chipsJson from "./chips.json";

export const chips: Readonly<Record<string, ChipParams>> = chipsJson;

export function getChip(id: string): ChipParams {
  const chip = chips[id];
  if (!chip) {
    throw new Error(`Unknown chip: ${id}`);
  }
  return chip;
}
