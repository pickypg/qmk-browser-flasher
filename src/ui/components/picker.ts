import { boards } from "../../board-db/index.js";
import { detectBoardViaHid } from "../../core/board-detect.js";
import type { BoardEntry, BootloaderEntryMethod } from "../../types/index.js";

const GENERIC_INSTRUCTIONS =
  "Common ways to enter bootloader/DFU mode: hold a magic key (often Esc or Space) while plugging the keyboard in, press a physical reset button (sometimes only accessible through a small hole), or use a QMK keycode/shortcut if your board supports one. Check your keyboard's own documentation for the exact method — WebUSB can only see a board once it's already in bootloader mode, so it can't identify one automatically that way. If your keyboard is currently connected and running normally, the \"Detect my keyboard\" button below may be able to identify it instead, via WebHID.";

export interface PickerHandle {
  /** Programmatically selects a board (e.g. from firmware-file detection)
   * and updates the shown instructions — a no-op if boardId isn't known. */
  selectBoard(boardId: string): void;
  getSelectedBoard(): BoardEntry | undefined;
}

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
 * mode, so this never gates pairing — it's informational only. An opt-in
 * "Detect my keyboard" button (WebHID, a separate permission grant from
 * the WebUSB one used for actual pairing) can preselect the right board;
 * nothing is prompted unless the user clicks it. `onSelectionChange` fires
 * for every change regardless of cause (user, detect button, or a caller's
 * `selectBoard`), so callers can stay in sync with the current selection —
 * e.g. main.ts uses it to compare against a firmware-file-detected board. */
export function renderPicker(container: HTMLElement, onSelectionChange?: (board: BoardEntry | undefined) => void): PickerHandle {
  const hidSupported = "hid" in navigator;

  container.innerHTML = `
    <label for="board-select">Your keyboard (optional, for instructions)</label>
    <div class="board-detect-row">
      <select id="board-select">
        <option value="">My board isn't listed</option>
        ${boards.map((board) => `<option value="${board.id}">${board.name}</option>`).join("")}
      </select>
      <button type="button" id="detect-board-button" ${hidSupported ? "" : "hidden"}>Detect my keyboard</button>
    </div>
    <p class="detect-status" data-role="detect-status"></p>
    <p class="instructions" data-role="board-instructions">${GENERIC_INSTRUCTIONS}</p>
  `;

  const select = container.querySelector<HTMLSelectElement>("#board-select")!;
  const detectButton = container.querySelector<HTMLButtonElement>("#detect-board-button")!;
  const detectStatus = container.querySelector<HTMLParagraphElement>('[data-role="detect-status"]')!;
  const instructions = container.querySelector<HTMLParagraphElement>('[data-role="board-instructions"]')!;

  function applySelection(boardId: string): void {
    const board = boards.find((b) => b.id === boardId);
    select.value = board?.id ?? "";
    instructions.innerHTML = board ? describeBootloaderEntry(board.bootloaderEntry) : GENERIC_INSTRUCTIONS;
    onSelectionChange?.(board);
  }

  select.addEventListener("change", () => {
    detectStatus.textContent = "";
    applySelection(select.value);
  });

  detectButton.addEventListener("click", () => {
    detectStatus.textContent = "";
    detectButton.disabled = true;
    void detectBoardViaHid(navigator.hid, boards)
      .then((board) => {
        if (board) {
          applySelection(board.id);
        } else {
          detectStatus.textContent = "No matching board found — pick yours above, or check its own documentation.";
        }
      })
      .catch(() => {
        detectStatus.textContent = "Detection was cancelled or failed — pick your board above instead.";
      })
      .finally(() => {
        detectButton.disabled = false;
      });
  });

  return {
    selectBoard: applySelection,
    getSelectedBoard: () => boards.find((b) => b.id === select.value),
  };
}
