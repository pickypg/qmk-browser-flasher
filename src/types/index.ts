export type Protocol = "avr-dfu" | "stm32-dfu" | "halfkay" | "caterina" | "uf2-picoboot";

export type Transport = "usb" | "hid" | "serial";

export interface ChipParams {
  readonly name: string;
  /** Base address of flash in the chip's address space (e.g. 0x08000000 on STM32). */
  readonly flashBaseAddress: number;
  readonly flashSizeBytes: number;
  readonly pageSizeBytes: number;
  /** Offset from flashBaseAddress where the bootloader begins, or flashSizeBytes if the bootloader isn't in this flash region at all. */
  readonly bootloaderStartAddress: number;
}

export type BootloaderEntryMethod =
  | { readonly kind: "reset-button" }
  | { readonly kind: "magic-key"; readonly key: string }
  | { readonly kind: "hid-command" };

export interface BoardEntry {
  readonly id: string;
  readonly name: string;
  readonly protocol: Protocol;
  /** Bootloader-mode (e.g. DFU) USB IDs — generic to the chip's ROM
   * bootloader, not the board, and can collide across boards (see
   * docs/PROTOCOL_NOTES.md). Not used for matching, kept for reference. */
  readonly usbVendorId?: number;
  readonly usbProductId?: number;
  /** The board's own USB IDs while running its normal application
   * firmware (not in bootloader mode) — specific enough to actually
   * identify the board, unlike usbVendorId/usbProductId above. Used only
   * for opt-in WebHID board detection (src/core/board-detect.ts) to
   * preselect bootloader-entry instructions; never for pairing/flashing. */
  readonly hidVendorId?: number;
  readonly hidProductId?: number;
  readonly bootloaderEntry: BootloaderEntryMethod;
}

export type FlashableDevice =
  | { readonly transport: "usb"; readonly protocol: Protocol; readonly productName: string; readonly boardId?: string; readonly device: USBDevice }
  | { readonly transport: "hid"; readonly protocol: Protocol; readonly productName: string; readonly boardId?: string; readonly device: HIDDevice }
  | { readonly transport: "serial"; readonly protocol: Protocol; readonly productName: string; readonly boardId?: string; readonly device: SerialPort };

export interface FirmwareImage {
  readonly bytes: Uint8Array;
  readonly startAddress: number;
}

export type FlashPhase = "preparing" | "flashing" | "verifying" | "finishing";

/**
 * "progress" events are frequent (e.g. once per transfer chunk) and only
 * carry current/total for bar animation. "start"/"ok"/"error" are sparse,
 * one per named operation, and are what a step log should render as rows.
 */
export interface FlashStepEvent {
  readonly phase: FlashPhase;
  /** Stable identity/display text for the operation — constant across a
   * phase's start/progress/ok/error events (e.g. "Erasing flash"). */
  readonly label: string;
  readonly status: "start" | "progress" | "ok" | "error";
  readonly current?: number;
  readonly total?: number;
  /** Transient, more specific description of what's happening right now
   * within the phase (e.g. "Erasing page 0x8000800") — for a live activity
   * indicator, not for identifying the row a step log should update. */
  readonly detail?: string;
  readonly error?: string;
}

export interface FlashResult {
  readonly ok: boolean;
  readonly bytesWritten: number;
  readonly verified: boolean;
  readonly error?: string;
}
