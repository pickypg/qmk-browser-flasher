import { boards } from "../../board-db/index.js";
import type { BootloaderEntryMethod } from "../../types/index.js";

const GENERIC_INSTRUCTIONS =
  "Common ways to enter bootloader/DFU mode: hold a magic key (often Esc or Space) while plugging the keyboard in, press a physical reset button (sometimes only accessible through a small hole), or use a QMK keycode/shortcut if your board supports one. Check your keyboard's own documentation for the exact method — WebUSB can only see a board once it's already in bootloader mode, so this can't be detected automatically.";

function describeBootloaderEntry(entry: BootloaderEntryMethod): string {
  switch (entry.kind) {
    case "magic-key":
      return `Hold <span class="key">${entry.key}</span> while plugging the keyboard in.`;
    case "reset-button":
      return "Press the reset button on the underside of the board (sometimes only accessible through a small hole).";
    case "hid-command":
      return "This board enters bootloader mode via a software command rather than a physical action — check your keyboard's documentation for the trigger.";
  }
}

/** Renders the "prepare your keyboard" panel: a board picker backed by
 * board-db, purely to surface the right bootloader-entry instructions.
 * WebUSB's device picker can only ever list devices already in bootloader
 * mode, so this never gates pairing — it's informational only. */
export function renderPicker(container: HTMLElement): void {
  container.innerHTML = `
    <label for="board-select">Your keyboard (optional, for instructions)</label>
    <select id="board-select">
      <option value="">My board isn't listed</option>
      ${boards.map((board) => `<option value="${board.id}">${board.name}</option>`).join("")}
    </select>
    <p class="instructions" data-role="board-instructions">${GENERIC_INSTRUCTIONS}</p>
  `;

  const select = container.querySelector<HTMLSelectElement>("#board-select")!;
  const instructions = container.querySelector<HTMLParagraphElement>('[data-role="board-instructions"]')!;

  select.addEventListener("change", () => {
    const board = boards.find((b) => b.id === select.value);
    instructions.innerHTML = board ? describeBootloaderEntry(board.bootloaderEntry) : GENERIC_INSTRUCTIONS;
  });
}
