import type { ChipParams, FirmwareImage, FlashResult, FlashStepEvent } from "../types/index.js";

// TODO(M1): DFU DNLOAD/GETSTATUS/ERASE/MANIFEST state machine over WebUSB
// control transfers, per USB DFU 1.1 + Atmel/LUFA's bootloader extensions.
// Reference: webdfu (license to be confirmed before porting — see
// docs/THIRD_PARTY_NOTICES.md).
export function flashAvrDfu(
  _device: USBDevice,
  _image: FirmwareImage,
  _chip: ChipParams,
  _onStep?: (event: FlashStepEvent) => void,
): Promise<FlashResult> {
  return Promise.reject(new Error("Not implemented"));
}
