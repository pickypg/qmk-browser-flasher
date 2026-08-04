import type { FlashableDevice } from "../types/index.js";

// TODO(M1): wrap navigator.usb.requestDevice() with vendor/product filters
// from board-db and map the result to a FlashableDevice.
export function requestUsbDevice(): Promise<FlashableDevice> {
  return Promise.reject(new Error("Not implemented"));
}

// TODO(M2): wrap navigator.hid.requestDevice() for HalfKay-class boards.
export function requestHidDevice(): Promise<FlashableDevice> {
  return Promise.reject(new Error("Not implemented"));
}

// TODO(M4): wrap navigator.serial.requestPort() for Caterina-class boards.
export function requestSerialDevice(): Promise<FlashableDevice> {
  return Promise.reject(new Error("Not implemented"));
}
