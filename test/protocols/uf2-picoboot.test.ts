import { beforeEach, describe, expect, it } from "vitest";

import { findPicobootInterface, flashUf2Picoboot, RP2040_FLASH_BASE } from "../../src/protocols/uf2-picoboot.js";
import type { FlashStepEvent } from "../../src/types/index.js";

const PC_EXCLUSIVE_ACCESS = 0x01;
const PC_REBOOT = 0x02;
const PC_FLASH_ERASE = 0x03;
const PC_WRITE = 0x05;
const PC_EXIT_XIP = 0x06;

const SECTOR_SIZE = 4096;
const FLASH_SIZE = SECTOR_SIZE * 3;

type Phase = "idle" | "awaiting-write-data" | "awaiting-write-ack" | "awaiting-read-data" | "awaiting-read-ack";

/** Simulates an RP2040 PICOBOOT device closely enough to exercise the real
 * command/data-phase/ack sequence flashUf2Picoboot uses: tracks flash
 * contents, every command's id, exclusive-access/exit-XIP calls, and
 * supports simulating a stalled transfer — same role as MockDfuDevice in
 * stm32-dfu.test.ts, adapted for PICOBOOT's bulk-transfer shape instead of
 * DFU's control-transfer one. */
class MockPicobootDevice {
  readonly flash: Uint8Array;
  readonly commandLog: number[] = [];
  readonly exclusiveAccessCalls: number[] = [];
  exitXipCount = 0;
  resetCount = 0;
  corruptReadback = false;
  /** When set to a command id, that command's initial send stalls once —
   * simulates a mid-flash protocol failure, cleared automatically. */
  failCmdId: number | null = null;

  private phase: Phase = "idle";
  private pending: { addr: number; size: number } | null = null;

  constructor(flashSize: number) {
    this.flash = new Uint8Array(flashSize).fill(0xff);
  }

  get configuration(): USBConfiguration {
    return {
      interfaces: [
        {
          interfaceNumber: 0,
          alternates: [
            {
              interfaceClass: 0xff,
              endpoints: [
                { endpointNumber: 1, direction: "out", type: "bulk", packetSize: 64 },
                { endpointNumber: 2, direction: "in", type: "bulk", packetSize: 64 },
              ],
            },
          ],
        },
      ],
    } as unknown as USBConfiguration;
  }

  clearHalt(): Promise<void> {
    return Promise.resolve();
  }

  controlTransferOut(): Promise<USBOutTransferResult> {
    this.resetCount++;
    return Promise.resolve({ status: "ok", bytesWritten: 0 });
  }

  transferOut(_endpointNumber: number, data: BufferSource): Promise<USBOutTransferResult> {
    const bytes = ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);

    if (this.phase === "idle") {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const cmdId = bytes[8]!;
      const transferLength = view.getUint32(12, true);
      const addr = view.getUint32(16, true);
      const size = view.getUint32(20, true);

      if (this.failCmdId === cmdId) {
        this.failCmdId = null;
        return Promise.resolve({ status: "stall", bytesWritten: 0 });
      }

      this.commandLog.push(cmdId);
      if (cmdId === PC_EXCLUSIVE_ACCESS) {
        this.exclusiveAccessCalls.push(bytes[16]!);
      }
      if (cmdId === PC_EXIT_XIP) {
        this.exitXipCount++;
      }
      if (cmdId === PC_FLASH_ERASE) {
        this.flash.fill(0xff, addr - RP2040_FLASH_BASE, addr - RP2040_FLASH_BASE + size);
      }

      this.pending = { addr, size };
      const isReadShaped = (cmdId & 0x80) !== 0;
      this.phase = transferLength === 0 ? "awaiting-write-ack" : isReadShaped ? "awaiting-read-data" : "awaiting-write-data";
      return Promise.resolve({ status: "ok", bytesWritten: bytes.length });
    }

    if (this.phase === "awaiting-write-data") {
      this.flash.set(bytes, this.pending!.addr - RP2040_FLASH_BASE);
      this.phase = "awaiting-write-ack";
      return Promise.resolve({ status: "ok", bytesWritten: bytes.length });
    }

    if (this.phase === "awaiting-read-ack") {
      this.phase = "idle";
      this.pending = null;
      return Promise.resolve({ status: "ok", bytesWritten: 0 });
    }

    throw new Error(`Unexpected transferOut in phase ${this.phase}`);
  }

  transferIn(_endpointNumber: number, _length: number): Promise<USBInTransferResult> {
    if (this.phase === "awaiting-read-data") {
      const { addr, size } = this.pending!;
      const slice = this.flash.slice(addr - RP2040_FLASH_BASE, addr - RP2040_FLASH_BASE + size);
      if (this.corruptReadback && slice.length > 0) {
        slice[0] = (slice[0]! + 1) & 0xff;
      }
      this.phase = "awaiting-read-ack";
      const buffer = slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength);
      return Promise.resolve({ status: "ok", data: new DataView(buffer) });
    }

    if (this.phase === "awaiting-write-ack") {
      this.phase = "idle";
      this.pending = null;
      return Promise.resolve({ status: "ok", data: new DataView(new ArrayBuffer(0)) });
    }

    throw new Error(`Unexpected transferIn in phase ${this.phase}`);
  }
}

describe("findPicobootInterface", () => {
  it("finds the vendor-specific 2-endpoint interface", () => {
    const device = new MockPicobootDevice(FLASH_SIZE);

    expect(findPicobootInterface(device as unknown as USBDevice)).toEqual({ interfaceNumber: 0, outEndpoint: 1, inEndpoint: 2 });
  });

  it("throws when no matching interface exists", () => {
    const device = { configuration: { interfaces: [] } } as unknown as USBDevice;
    expect(() => findPicobootInterface(device)).toThrow(/No PICOBOOT interface/);
  });
});

describe("flashUf2Picoboot", () => {
  let device: MockPicobootDevice;

  beforeEach(() => {
    device = new MockPicobootDevice(FLASH_SIZE);
  });

  it("erases, writes, and verifies a single-sector image", async () => {
    const bytes = new Uint8Array(64).map((_, i) => i);

    const result = await flashUf2Picoboot(device as unknown as USBDevice, bytes);

    expect(result.ok).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.bytesWritten).toBe(64);
    expect(Array.from(device.flash.subarray(0, 64))).toEqual(Array.from(bytes));
  });

  it("gains exclusive access and exits XIP before the first erase", async () => {
    const bytes = new Uint8Array(64);

    await flashUf2Picoboot(device as unknown as USBDevice, bytes);

    const firstErase = device.commandLog.indexOf(PC_FLASH_ERASE);
    const exclusiveIndex = device.commandLog.indexOf(PC_EXCLUSIVE_ACCESS);
    const exitXipIndex = device.commandLog.indexOf(PC_EXIT_XIP);
    expect(exclusiveIndex).toBeGreaterThanOrEqual(0);
    expect(exitXipIndex).toBeGreaterThanOrEqual(0);
    expect(exclusiveIndex).toBeLessThan(firstErase);
    expect(exitXipIndex).toBeLessThan(firstErase);
    expect(device.exclusiveAccessCalls[0]).toBe(1);
  });

  it("erases every sector an image spans and interleaves erase+write per sector", async () => {
    const bytes = new Uint8Array(SECTOR_SIZE + 16); // spans 2 sectors

    await flashUf2Picoboot(device as unknown as USBDevice, bytes);

    const eraseIndices = device.commandLog.map((id, i) => ({ id, i })).filter((x) => x.id === PC_FLASH_ERASE).map((x) => x.i);
    const writeIndices = device.commandLog.map((id, i) => ({ id, i })).filter((x) => x.id === PC_WRITE).map((x) => x.i);
    expect(eraseIndices).toHaveLength(2);
    expect(writeIndices).toHaveLength(2);
    // The first sector's write happens before the second sector even gets
    // erased — each sector's replacement is written right away, not after
    // every sector in the image has already been wiped.
    expect(writeIndices[0]).toBeGreaterThan(eraseIndices[0]!);
    expect(writeIndices[0]).toBeLessThan(eraseIndices[1]!);
  });

  it("pads the final short chunk to a 256-byte boundary with 0xFF", async () => {
    const bytes = new Uint8Array(300).map((_, i) => i & 0xff); // not a multiple of 256

    const result = await flashUf2Picoboot(device as unknown as USBDevice, bytes);

    expect(result.ok).toBe(true);
    expect(Array.from(device.flash.subarray(300, 512))).toEqual(new Array(212).fill(0xff));
  });

  it("reports verified: false when the readback does not match what was written", async () => {
    const bytes = new Uint8Array(64).fill(0xaa);
    device.corruptReadback = true;

    const result = await flashUf2Picoboot(device as unknown as USBDevice, bytes);

    expect(result.verified).toBe(false);
    expect(result.ok).toBe(false);
  });

  it("surfaces a stalled transfer mid-flash as a clean, retryable error", async () => {
    const bytes = new Uint8Array(64);
    device.failCmdId = PC_FLASH_ERASE;
    const events: FlashStepEvent[] = [];

    await expect(flashUf2Picoboot(device as unknown as USBDevice, bytes, (event) => events.push(event))).rejects.toThrow(/stall/);

    const flashingError = events.find((e) => e.phase === "flashing" && e.status === "error");
    expect(flashingError?.error).toMatch(/stall/);
  });

  it("reboots into the application as the final command after a successful flash", async () => {
    const bytes = new Uint8Array(64);

    await flashUf2Picoboot(device as unknown as USBDevice, bytes);

    expect(device.commandLog.at(-1)).toBe(PC_REBOOT);
  });
});
