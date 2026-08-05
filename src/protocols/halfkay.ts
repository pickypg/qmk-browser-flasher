import type { ChipParams, FirmwareImage, FlashResult, FlashStepEvent } from "../types/index.js";

// TODO(M2): Teensy HalfKay fixed-packet HID protocol (single "write page"
// report, no explicit erase/status commands).
export function flashHalfKay(
  _device: HIDDevice,
  _image: FirmwareImage,
  _chip: ChipParams,
  _onStep?: (event: FlashStepEvent) => void,
): Promise<FlashResult> {
  return Promise.reject(new Error("Not implemented"));
}
