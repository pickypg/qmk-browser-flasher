import { describe, expect, it } from "vitest";

import { watchForDisconnect } from "../../src/core/device-picker.js";

describe("watchForDisconnect", () => {
  it("only calls onDisconnect for the matching device", () => {
    const usb = new EventTarget();
    const watchedDevice = {} as USBDevice;
    const otherDevice = {} as USBDevice;
    let disconnectCount = 0;

    watchForDisconnect(usb as unknown as USB, watchedDevice, () => {
      disconnectCount++;
    });

    usb.dispatchEvent(Object.assign(new Event("disconnect"), { device: otherDevice }));
    expect(disconnectCount).toBe(0);

    usb.dispatchEvent(Object.assign(new Event("disconnect"), { device: watchedDevice }));
    expect(disconnectCount).toBe(1);
  });

  it("stops calling onDisconnect after unsubscribing", () => {
    const usb = new EventTarget();
    const watchedDevice = {} as USBDevice;
    let disconnectCount = 0;

    const unwatch = watchForDisconnect(usb as unknown as USB, watchedDevice, () => {
      disconnectCount++;
    });
    unwatch();

    usb.dispatchEvent(Object.assign(new Event("disconnect"), { device: watchedDevice }));
    expect(disconnectCount).toBe(0);
  });
});
