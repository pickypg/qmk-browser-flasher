import { beforeEach, describe, expect, it } from "vitest";

import { encodeErasePage, encodeMassErase, encodeSetAddress, flashStm32Dfu } from "../../src/protocols/stm32-dfu.js";
import type { ChipParams, FirmwareImage } from "../../src/types/index.js";

const DFU_DNLOAD = 1;
const DFU_UPLOAD = 2;
const DFU_GETSTATUS = 3;
const DFU_ABORT = 6;

const STATE_DFU_IDLE = 2;
const STATE_DFU_DNBUSY = 4;
const STATE_DFU_DNLOAD_IDLE = 5;
const STATE_DFU_MANIFEST = 7;

const TRANSFER_SIZE = 2048;

const chip: ChipParams = {
  name: "test-chip",
  flashBaseAddress: 0,
  flashSizeBytes: 4096,
  pageSizeBytes: 2048,
  bootloaderStartAddress: 4096,
};

interface RecordedCommand {
  readonly request: number;
  readonly value: number;
  readonly bytes?: number[] | undefined;
}

/** Simulates a DfuSe device: tracks flash contents and the erase/set-address/
 * program/read state machine closely enough to exercise the real protocol
 * flow, including page-erase dedup and a byte-accurate readback. */
class MockDfuDevice {
  readonly flash: Uint8Array;
  readonly commands: RecordedCommand[] = [];
  private state = STATE_DFU_IDLE;
  private lastSetAddress = 0;
  corruptReadback = false;
  readonly configuration = {
    interfaces: [{ interfaceNumber: 0, alternates: [{ alternateSetting: 0, interfaceClass: 0xfe, interfaceSubclass: 0x01 }] }],
  } as unknown as USBConfiguration;

  constructor(flashSize: number) {
    this.flash = new Uint8Array(flashSize).fill(0xff);
  }

  controlTransferOut(setup: USBControlTransferParameters, data?: BufferSource): Promise<USBOutTransferResult> {
    const bytes = data ? Array.from(new Uint8Array(data as ArrayBuffer)) : undefined;
    this.commands.push({ request: setup.request, value: setup.value, bytes });

    if (setup.request === DFU_DNLOAD) {
      if (setup.value === 0 && bytes) {
        this.applySpecialCommand(bytes);
        this.state = STATE_DFU_DNBUSY;
      } else if (bytes && bytes.length > 0) {
        this.flash.set(bytes, this.lastSetAddress);
        this.state = STATE_DFU_DNLOAD_IDLE;
      } else {
        // zero-length "leave DFU mode" download triggers manifestation
        this.state = STATE_DFU_MANIFEST;
      }
    } else if (setup.request === DFU_ABORT) {
      this.state = STATE_DFU_IDLE;
    }

    return Promise.resolve({ status: "ok", bytesWritten: bytes?.length ?? 0 });
  }

  controlTransferIn(setup: USBControlTransferParameters, length: number): Promise<USBInTransferResult> {
    this.commands.push({ request: setup.request, value: setup.value });

    if (setup.request === DFU_GETSTATUS) {
      const buffer = new ArrayBuffer(6);
      const view = new DataView(buffer);
      view.setUint8(0, 0); // bStatus = OK
      view.setUint8(4, this.state);
      return Promise.resolve({ status: "ok", data: view });
    }

    if (setup.request === DFU_UPLOAD) {
      const chunkIndex = setup.value - 2;
      const address = this.lastSetAddress + chunkIndex * TRANSFER_SIZE;
      const slice = this.flash.slice(address, address + length);
      if (this.corruptReadback && slice.length > 0) {
        slice[0] = (slice[0]! + 1) & 0xff;
      }
      const buffer = slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength);
      return Promise.resolve({ status: "ok", data: new DataView(buffer) });
    }

    throw new Error(`Unexpected control transfer in: ${setup.request}`);
  }

  private applySpecialCommand(bytes: number[]): void {
    const command = bytes[0];
    const address = (bytes[1] ?? 0) | ((bytes[2] ?? 0) << 8) | ((bytes[3] ?? 0) << 16) | ((bytes[4] ?? 0) << 24);
    if (command === 0x21) {
      this.lastSetAddress = address;
    } else if (command === 0x41 && bytes.length > 1) {
      const pageStart = Math.floor(address / chip.pageSizeBytes) * chip.pageSizeBytes;
      this.flash.fill(0xff, pageStart, pageStart + chip.pageSizeBytes);
    } else if (command === 0x41) {
      this.flash.fill(0xff);
    }
  }
}

describe("stm32-dfu command encoding", () => {
  it("encodes SET_ADDRESS as a 5-byte little-endian command", () => {
    expect(Array.from(encodeSetAddress(0x08000800))).toEqual([0x21, 0x00, 0x08, 0x00, 0x08]);
  });

  it("encodes ERASE_PAGE as a 5-byte little-endian command", () => {
    expect(Array.from(encodeErasePage(0x08000000))).toEqual([0x41, 0x00, 0x00, 0x00, 0x08]);
  });

  it("encodes MASS_ERASE as a single byte", () => {
    expect(Array.from(encodeMassErase())).toEqual([0x41]);
  });
});

describe("flashStm32Dfu", () => {
  let device: MockDfuDevice;

  beforeEach(() => {
    device = new MockDfuDevice(chip.flashSizeBytes);
  });

  it("erases, programs, and verifies a single-page image", async () => {
    const bytes = new Uint8Array(64).map((_, i) => i);
    const image: FirmwareImage = { bytes, startAddress: 0 };

    const result = await flashStm32Dfu(device as unknown as USBDevice, image, chip);

    expect(result.ok).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.bytesWritten).toBe(64);
    expect(Array.from(device.flash.subarray(0, 64))).toEqual(Array.from(bytes));
  });

  it("does not re-erase a page it already erased this run", async () => {
    const bytes = new Uint8Array(64);
    const image: FirmwareImage = { bytes, startAddress: 0 };

    await flashStm32Dfu(device as unknown as USBDevice, image, chip);

    const eraseCommands = device.commands.filter((c) => c.request === DFU_DNLOAD && c.value === 0 && c.bytes?.[0] === 0x41);
    expect(eraseCommands).toHaveLength(1);
  });

  it("erases every page an image spans", async () => {
    const bytes = new Uint8Array(chip.pageSizeBytes + 16);
    const image: FirmwareImage = { bytes, startAddress: 0 };

    await flashStm32Dfu(device as unknown as USBDevice, image, chip);

    const eraseAddresses = device.commands
      .filter((c) => c.request === DFU_DNLOAD && c.value === 0 && c.bytes?.[0] === 0x41)
      .map((c) => (c.bytes ?? [])[1]! | ((c.bytes ?? [])[2]! << 8));
    expect(eraseAddresses).toEqual([0, chip.pageSizeBytes]);
  });

  it("reports verified: false when the readback does not match what was written", async () => {
    const bytes = new Uint8Array(64).fill(0xaa);
    const image: FirmwareImage = { bytes, startAddress: 0 };
    device.corruptReadback = true;

    const result = await flashStm32Dfu(device as unknown as USBDevice, image, chip);

    expect(result.verified).toBe(false);
    expect(result.ok).toBe(false);
  });
});
