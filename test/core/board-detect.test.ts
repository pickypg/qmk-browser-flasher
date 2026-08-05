import { describe, expect, it } from "vitest";

import { detectBoardViaHid } from "../../src/core/board-detect.js";
import type { BoardEntry } from "../../src/types/index.js";

const KNOWN_BOARD: BoardEntry = {
  id: "known-board",
  name: "Known Board",
  protocol: "stm32-dfu",
  hidVendorId: 0x1111,
  hidProductId: 0x2222,
  bootloaderEntry: { kind: "magic-key", key: "Esc" },
};

const UNKNOWN_BOARD: BoardEntry = {
  id: "unknown-board",
  name: "Unknown Board",
  protocol: "stm32-dfu",
  bootloaderEntry: { kind: "reset-button" },
};

function fakeHid(devices: HIDDevice[]): HID {
  return { requestDevice: () => Promise.resolve(devices) } as unknown as HID;
}

describe("detectBoardViaHid", () => {
  it("returns undefined without prompting when no candidate has HID data", async () => {
    const hid = { requestDevice: () => Promise.reject(new Error("should not be called")) } as unknown as HID;

    await expect(detectBoardViaHid(hid, [UNKNOWN_BOARD])).resolves.toBeUndefined();
  });

  it("returns the matching board when the selected device's IDs match a candidate", async () => {
    const device = { vendorId: 0x1111, productId: 0x2222 } as HIDDevice;
    const hid = fakeHid([device]);

    await expect(detectBoardViaHid(hid, [KNOWN_BOARD, UNKNOWN_BOARD])).resolves.toBe(KNOWN_BOARD);
  });

  it("returns undefined when the user cancels the picker (empty device list)", async () => {
    const hid = fakeHid([]);

    await expect(detectBoardViaHid(hid, [KNOWN_BOARD])).resolves.toBeUndefined();
  });

  it("returns undefined when the selected device matches no candidate", async () => {
    const device = { vendorId: 0x9999, productId: 0x8888 } as HIDDevice;
    const hid = fakeHid([device]);

    await expect(detectBoardViaHid(hid, [KNOWN_BOARD])).resolves.toBeUndefined();
  });
});
