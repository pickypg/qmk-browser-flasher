import { findDfuInterface } from "../protocols/stm32-dfu.js";
import { findPicobootInterface } from "../protocols/uf2-picoboot.js";
import type { FlashableDevice } from "../types/index.js";

/** ST's factory DFU bootloader — every STM32 chip's ROM bootloader
 * enumerates under this same generic ID, regardless of which board or
 * chip it actually is (chip identity is read live once paired; see
 * stm32-dfu.ts). Board-db doesn't help here since it can't disambiguate
 * boards that share this ID. */
const STM32_BOOTLOADER_VENDOR_ID = 0x0483;
const STM32_BOOTLOADER_PRODUCT_ID = 0xdf11;

/** RP2040's ROM bootloader ("RPI-RP2") — same generic-ID situation as
 * STM32 above, confirmed against raspberrypi/usb-pid. */
const RP2040_BOOTLOADER_VENDOR_ID = 0x2e8a;
const RP2040_BOOTLOADER_PRODUCT_ID = 0x0003;

export async function requestUsbDevice(): Promise<FlashableDevice> {
  const device = await navigator.usb.requestDevice({
    filters: [
      { vendorId: STM32_BOOTLOADER_VENDOR_ID, productId: STM32_BOOTLOADER_PRODUCT_ID },
      { vendorId: RP2040_BOOTLOADER_VENDOR_ID, productId: RP2040_BOOTLOADER_PRODUCT_ID },
    ],
  });

  await device.open();
  if (device.configuration === null) {
    await device.selectConfiguration(1);
  }

  if (device.vendorId === STM32_BOOTLOADER_VENDOR_ID && device.productId === STM32_BOOTLOADER_PRODUCT_ID) {
    // DFU-class detection (USB interface class 0xFE / subclass 0x01) works
    // for any WebUSB DFU protocol, not just stm32-dfu — reused as-is when
    // avr-dfu is implemented.
    const { interfaceNumber, alternateSetting } = findDfuInterface(device);
    await device.claimInterface(interfaceNumber);
    await device.selectAlternateInterface(interfaceNumber, alternateSetting);
    return {
      transport: "usb",
      protocol: "stm32-dfu",
      productName: device.productName ?? "STM32 DFU bootloader",
      device,
    };
  }

  if (device.vendorId === RP2040_BOOTLOADER_VENDOR_ID && device.productId === RP2040_BOOTLOADER_PRODUCT_ID) {
    const { interfaceNumber } = findPicobootInterface(device);
    await device.claimInterface(interfaceNumber);
    return {
      transport: "usb",
      protocol: "uf2-picoboot",
      productName: device.productName ?? "RP2040 PICOBOOT bootloader",
      device,
    };
  }

  throw new Error(`Unsupported USB device: ${device.vendorId.toString(16)}:${device.productId.toString(16)}`);
}

/** Watches for `device` disconnecting (e.g. unplugged) and calls
 * `onDisconnect` once if it does; returns an unsubscribe function. Takes
 * `usb` explicitly (rather than reaching for `navigator.usb` internally)
 * so this is unit-testable with a plain EventTarget. */
export function watchForDisconnect(usb: USB, device: USBDevice, onDisconnect: () => void): () => void {
  const handler = (event: USBConnectionEvent): void => {
    if (event.device === device) {
      onDisconnect();
    }
  };
  usb.addEventListener("disconnect", handler);
  return () => usb.removeEventListener("disconnect", handler);
}

// TODO(M2): wrap navigator.hid.requestDevice() for HalfKay-class boards.
export function requestHidDevice(): Promise<FlashableDevice> {
  return Promise.reject(new Error("Not implemented"));
}

// TODO(M4): wrap navigator.serial.requestPort() for Caterina-class boards.
export function requestSerialDevice(): Promise<FlashableDevice> {
  return Promise.reject(new Error("Not implemented"));
}
