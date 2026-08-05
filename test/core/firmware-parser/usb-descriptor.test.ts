import { describe, expect, it } from "vitest";

import { findUsbDeviceDescriptor } from "../../../src/core/firmware-parser/usb-descriptor.js";

/** Builds a plausible 18-byte USB device descriptor, matching the shape
 * confirmed against a real compiled NuPhy Air75 V2 build. */
function buildDescriptor(vendorId: number, productId: number): number[] {
  return [
    0x12, // bLength
    0x01, // bDescriptorType = DEVICE
    0x00,
    0x02, // bcdUSB = 2.00
    0x00, // bDeviceClass
    0x00, // bDeviceSubClass
    0x00, // bDeviceProtocol
    0x40, // bMaxPacketSize0 = 64
    vendorId & 0xff,
    (vendorId >> 8) & 0xff,
    productId & 0xff,
    (productId >> 8) & 0xff,
    0x00,
    0x01, // bcdDevice
    0x01, // iManufacturer
    0x02, // iProduct
    0x00, // iSerialNumber
    0x01, // bNumConfigurations
  ];
}

describe("findUsbDeviceDescriptor", () => {
  it("finds a single valid descriptor embedded in surrounding bytes", () => {
    const filler = new Array<number>(20).fill(0xaa);
    const bytes = new Uint8Array([...filler, ...buildDescriptor(0x19f5, 0x3246), ...filler]);

    expect(findUsbDeviceDescriptor(bytes)).toEqual({ vendorId: 0x19f5, productId: 0x3246 });
  });

  it("still finds it when the same descriptor appears twice (e.g. a duplicate copy)", () => {
    const descriptor = buildDescriptor(0x19f5, 0x3246);
    const bytes = new Uint8Array([...descriptor, ...new Array<number>(10).fill(0xaa), ...descriptor]);

    expect(findUsbDeviceDescriptor(bytes)).toEqual({ vendorId: 0x19f5, productId: 0x3246 });
  });

  it("returns undefined when two different plausible descriptors are found (ambiguous)", () => {
    const bytes = new Uint8Array([...buildDescriptor(0x19f5, 0x3246), ...new Array<number>(10).fill(0xaa), ...buildDescriptor(0x3434, 0x0210)]);

    expect(findUsbDeviceDescriptor(bytes)).toBeUndefined();
  });

  it("ignores a 0x12 0x01 byte pair that doesn't look like a real descriptor", () => {
    const fake = buildDescriptor(0x19f5, 0x3246);
    fake[7] = 0x99; // invalid bMaxPacketSize0
    const bytes = new Uint8Array([...new Array<number>(5).fill(0xaa), ...fake, ...new Array<number>(5).fill(0xaa)]);

    expect(findUsbDeviceDescriptor(bytes)).toBeUndefined();
  });

  it("returns undefined when there's no plausible descriptor at all", () => {
    expect(findUsbDeviceDescriptor(new Uint8Array(50).fill(0xaa))).toBeUndefined();
  });

  it("returns undefined for a buffer shorter than a full descriptor", () => {
    expect(findUsbDeviceDescriptor(new Uint8Array([0x12, 0x01, 0x00]))).toBeUndefined();
  });
});
