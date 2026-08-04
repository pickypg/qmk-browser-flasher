import type { ChipParams, FirmwareImage, FlashProgress, FlashResult } from "../types/index.js";

// TODO(M2): Teensy HalfKay fixed-packet HID protocol (single "write page"
// report, no explicit erase/status commands).
export function flashHalfKay(
  _device: HIDDevice,
  _image: FirmwareImage,
  _chip: ChipParams,
  _onProgress?: (progress: FlashProgress) => void,
): Promise<FlashResult> {
  return Promise.reject(new Error("Not implemented"));
}
