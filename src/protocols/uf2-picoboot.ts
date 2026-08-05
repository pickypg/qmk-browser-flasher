import type { ChipParams, FirmwareImage, FlashResult, FlashStepEvent } from "../types/index.js";

// TODO(M6, phase 2): RP2040 PICOBOOT over WebUSB (or mass-storage UF2 drop),
// deferred — different transfer model from the DFU/HID protocols above.
export function flashUf2Picoboot(
  _device: USBDevice,
  _image: FirmwareImage,
  _chip: ChipParams,
  _onStep?: (event: FlashStepEvent) => void,
): Promise<FlashResult> {
  return Promise.reject(new Error("Not implemented"));
}
