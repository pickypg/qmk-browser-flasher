export type Protocol = "avr-dfu" | "halfkay" | "caterina" | "uf2-picoboot";

export type Transport = "usb" | "hid" | "serial";

export interface ChipParams {
  readonly name: string;
  readonly flashSizeBytes: number;
  readonly pageSizeBytes: number;
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
  readonly chip: string;
  readonly usbVendorId?: number;
  readonly usbProductId?: number;
  readonly bootloaderEntry: BootloaderEntryMethod;
}

export interface FlashableDevice {
  readonly protocol: Protocol;
  readonly transport: Transport;
  readonly productName: string;
}

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
