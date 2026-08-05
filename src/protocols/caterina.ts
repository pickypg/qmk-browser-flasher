import type { ChipParams, FirmwareImage, FlashResult, FlashStepEvent } from "../types/index.js";

// TODO(M4): AVR109/STK500v2 over WebSerial (byte-stream framing rather than
// USB control transfers — distinct retry/timeout handling from DFU/HID).
export function flashCaterina(
  _port: SerialPort,
  _image: FirmwareImage,
  _chip: ChipParams,
  _onStep?: (event: FlashStepEvent) => void,
): Promise<FlashResult> {
  return Promise.reject(new Error("Not implemented"));
}
