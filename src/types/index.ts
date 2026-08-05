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
  readonly usbVendorId?: number;
  readonly usbProductId?: number;
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

export interface FlashProgress {
  readonly bytesWritten: number;
  readonly totalBytes: number;
}

export interface FlashResult {
  readonly ok: boolean;
  readonly bytesWritten: number;
  readonly verified: boolean;
  readonly error?: string;
}
