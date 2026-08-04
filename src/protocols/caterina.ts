import type { ChipParams, FirmwareImage, FlashProgress, FlashResult } from "../types/index.js";

// TODO(M4): AVR109/STK500v2 over WebSerial (byte-stream framing rather than
// USB control transfers — distinct retry/timeout handling from DFU/HID).
export function flashCaterina(
  _port: SerialPort,
  _image: FirmwareImage,
  _chip: ChipParams,
  _onProgress?: (progress: FlashProgress) => void,
): Promise<FlashResult> {
  return Promise.reject(new Error("Not implemented"));
}
