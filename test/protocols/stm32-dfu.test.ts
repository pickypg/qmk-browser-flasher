import { beforeEach, describe, expect, it } from "vitest";

import { encodeErasePage, encodeMassErase, encodeSetAddress, flashStm32Dfu } from "../../src/protocols/stm32-dfu.js";

const DFU_DNLOAD = 1;
const DFU_UPLOAD = 2;
const DFU_GETSTATUS = 3;
const DFU_ABORT = 6;

const STATE_DFU_IDLE = 2;
const STATE_DFU_DNBUSY = 4;
const STATE_DFU_DNLOAD_IDLE = 5;
const STATE_DFU_MANIFEST = 7;

const TRANSFER_SIZE = 2048;
const PAGE_SIZE = 2048;
const FLASH_BASE = 0x08000000;
const FLASH_SIZE = 4096; // 2 pages, matches the mock's descriptor string below

interface RecordedCommand {
  readonly request: number;
  readonly value: number;
  readonly bytes?: number[] | undefined;
}

/** Simulates a DfuSe device: tracks flash contents and the erase/set-address/
 * program/read state machine closely enough to exercise the real protocol
 * flow, including page-erase dedup and a byte-accurate readback. The
 * descriptor string below is what flashStm32Dfu reads to learn the flash
 * layout — no chip data is passed in externally. */
class MockDfuDevice {
  readonly flash: Uint8Array;
  readonly commands: RecordedCommand[] = [];
  private state = STATE_DFU_IDLE;
  private lastSetAddress = FLASH_BASE;
  corruptReadback = false;
  readonly configuration = {
    interfaces: [
      {
        interfaceNumber: 0,
        alternates: [
          {
            alternateSetting: 0,
            interfaceClass: 0xfe,
            interfaceSubclass: 0x01,
            interfaceName: `@Internal Flash /0x${FLASH_BASE.toString(16)}/2*002Kg`,
          },
        ],
      },
    ],
  } as unknown as USBConfiguration;

  constructor(flashSize: number) {
    this.flash = new Uint8Array(flashSize).fill(0xff);
  }

  selectAlternateInterface(): Promise<void> {
    return Promise.resolve();
  }

  controlTransferOut(setup: USBControlTransferParameters, data?: BufferSource): Promise<USBOutTransferResult> {
    const bytes = data ? Array.from(new Uint8Array(data as ArrayBuffer)) : undefined;
    this.commands.push({ request: setup.request, value: setup.value, bytes });

    if (setup.request === DFU_DNLOAD) {
      if (setup.value === 0 && bytes) {
        this.applySpecialCommand(bytes);
        this.state = STATE_DFU_DNBUSY;
      } else if (bytes && bytes.length > 0) {
        this.flash.set(bytes, this.lastSetAddress - FLASH_BASE);
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
      const address = this.lastSetAddress - FLASH_BASE + chunkIndex * TRANSFER_SIZE;
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
      const pageStart = Math.floor((address - FLASH_BASE) / PAGE_SIZE) * PAGE_SIZE;
      this.flash.fill(0xff, pageStart, pageStart + PAGE_SIZE);
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
    device = new MockDfuDevice(FLASH_SIZE);
  });

  it("erases, programs, and verifies a single-page image", async () => {
    const bytes = new Uint8Array(64).map((_, i) => i);

    const result = await flashStm32Dfu(device as unknown as USBDevice, bytes);

    expect(result.ok).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.bytesWritten).toBe(64);
    expect(Array.from(device.flash.subarray(0, 64))).toEqual(Array.from(bytes));
  });

  it("does not re-erase a page it already erased this run", async () => {
    const bytes = new Uint8Array(64);

    await flashStm32Dfu(device as unknown as USBDevice, bytes);

    const eraseCommands = device.commands.filter((c) => c.request === DFU_DNLOAD && c.value === 0 && c.bytes?.[0] === 0x41);
    expect(eraseCommands).toHaveLength(1);
  });

  it("erases every page an image spans", async () => {
    const bytes = new Uint8Array(PAGE_SIZE + 16);

    await flashStm32Dfu(device as unknown as USBDevice, bytes);

    const eraseAddresses = device.commands
      .filter((c) => c.request === DFU_DNLOAD && c.value === 0 && c.bytes?.[0] === 0x41)
      .map((c) => ((c.bytes ?? [])[1]! | ((c.bytes ?? [])[2]! << 8) | ((c.bytes ?? [])[3]! << 16) | ((c.bytes ?? [])[4]! << 24)) >>> 0);
    expect(eraseAddresses).toEqual([FLASH_BASE, FLASH_BASE + PAGE_SIZE]);
  });

  it("reports verified: false when the readback does not match what was written", async () => {
    const bytes = new Uint8Array(64).fill(0xaa);
    device.corruptReadback = true;

    const result = await flashStm32Dfu(device as unknown as USBDevice, bytes);

    expect(result.verified).toBe(false);
    expect(result.ok).toBe(false);
  });

  it("rejects firmware larger than the device's detected flash size", async () => {
    const bytes = new Uint8Array(FLASH_SIZE + 1);

    await expect(flashStm32Dfu(device as unknown as USBDevice, bytes)).rejects.toThrow(/larger than/);
  });
});

/** Builds a minimal standard USB configuration descriptor (9-byte config
 * header + one 9-byte interface descriptor) plus the string descriptors it
 * references, for testing the manual GET_DESCRIPTOR fallback. */
function buildDescriptors(interfaceName: string): { config: number[]; strings: Map<number, number[]> } {
  const nameIndex = 4;
  const config = [
    9, 0x02, 18, 0x00, 0x01, 0x01, 0x00, 0x80, 50, // configuration descriptor
    9, 0x04, 0x00, 0x00, 0x00, 0xfe, 0x01, 0x02, nameIndex, // interface descriptor
  ];
  const strings = new Map<number, number[]>();
  strings.set(0, [4, 0x03, 0x09, 0x04]); // LANGID = 0x0409 (English US)
  const nameBytes: number[] = [2 + interfaceName.length * 2, 0x03];
  for (const ch of interfaceName) {
    const code = ch.charCodeAt(0);
    nameBytes.push(code & 0xff, (code >> 8) & 0xff);
  }
  strings.set(nameIndex, nameBytes);
  return { config, strings };
}

/** Same protocol simulation as MockDfuDevice, but leaves
 * USBAlternateInterface.interfaceName null (as some real devices/browser
 * combinations do) so flashStm32Dfu must fall back to fetching the
 * memory-layout string manually via GET_DESCRIPTOR. */
class MockDfuDeviceWithoutAutoResolvedNames extends MockDfuDevice {
  private readonly descriptors: { config: number[]; strings: Map<number, number[]> };

  constructor(flashSize: number, interfaceName: string) {
    super(flashSize);
    this.descriptors = buildDescriptors(interfaceName);
    const iface = (this.configuration as unknown as { interfaces: { alternates: { interfaceName: string | null }[] }[] }).interfaces[0]!;
    iface.alternates[0]!.interfaceName = null;
  }

  override controlTransferIn(setup: USBControlTransferParameters, length: number): Promise<USBInTransferResult> {
    if (setup.requestType === "standard" && setup.request === 6) {
      const type = (setup.value >> 8) & 0xff;
      const index = setup.value & 0xff;
      const source = type === 0x02 ? this.descriptors.config : (this.descriptors.strings.get(index) ?? []);
      const bytes = source.slice(0, length);
      const buffer = new ArrayBuffer(bytes.length);
      const view = new DataView(buffer);
      bytes.forEach((b, i) => view.setUint8(i, b));
      return Promise.resolve({ status: "ok", data: view });
    }
    return super.controlTransferIn(setup, length);
  }
}

describe("flashStm32Dfu (browser did not auto-resolve interfaceName)", () => {
  it("falls back to GET_DESCRIPTOR to read the memory-layout string", async () => {
    const device = new MockDfuDeviceWithoutAutoResolvedNames(FLASH_SIZE, `@Internal Flash /0x${FLASH_BASE.toString(16)}/2*002Kg`);
    const bytes = new Uint8Array(64).map((_, i) => i);

    const result = await flashStm32Dfu(device as unknown as USBDevice, bytes);

    expect(result.ok).toBe(true);
    expect(result.verified).toBe(true);
  });
});
