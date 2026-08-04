import { boards } from "../board-db/index.js";
import { findDfuInterface } from "../protocols/stm32-dfu.js";
import type { FlashableDevice } from "../types/index.js";

const usbBoards = boards.filter(
  (board): board is typeof board & { usbVendorId: number; usbProductId: number } =>
    board.usbVendorId !== undefined && board.usbProductId !== undefined,
);

export async function requestUsbDevice(): Promise<FlashableDevice> {
  const filters = usbBoards.map((board) => ({ vendorId: board.usbVendorId, productId: board.usbProductId }));
  const device = await navigator.usb.requestDevice({ filters });

  const board = usbBoards.find((b) => b.usbVendorId === device.vendorId && b.usbProductId === device.productId);
  if (!board) {
    throw new Error(`Unrecognized USB device: ${device.vendorId.toString(16)}:${device.productId.toString(16)}`);
  }

  await device.open();
  if (device.configuration === null) {
    await device.selectConfiguration(1);
  }
  // DFU-class detection (USB interface class 0xFE / subclass 0x01) works
  // for any WebUSB DFU protocol, not just stm32-dfu — reused as-is when
  // avr-dfu is implemented.
  const { interfaceNumber, alternateSetting } = findDfuInterface(device);
  await device.claimInterface(interfaceNumber);
  await device.selectAlternateInterface(interfaceNumber, alternateSetting);

  return {
    transport: "usb",
    protocol: board.protocol,
    productName: device.productName ?? board.name,
    boardId: board.id,
    device,
  };
}

// TODO(M2): wrap navigator.hid.requestDevice() for HalfKay-class boards.
export function requestHidDevice(): Promise<FlashableDevice> {
  return Promise.reject(new Error("Not implemented"));
}

// TODO(M4): wrap navigator.serial.requestPort() for Caterina-class boards.
export function requestSerialDevice(): Promise<FlashableDevice> {
  return Promise.reject(new Error("Not implemented"));
}
