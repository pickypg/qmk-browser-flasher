import { beforeEach, describe, expect, it } from "vitest";

import { parseDfuSeMemoryLayout } from "../../src/protocols/dfuse-memory-layout.js";
import { encodeErasePage, encodeMassErase, encodeSetAddress, flashStm32Dfu, planErasePages } from "../../src/protocols/stm32-dfu.js";
import type { FlashStepEvent } from "../../src/types/index.js";

const DFU_DNLOAD = 1;
const DFU_UPLOAD = 2;
const DFU_GETSTATUS = 3;
const DFU_ABORT = 6;

/** Fixed transaction number stm32-dfu.ts uses for data blocks (mirrors its
 * internal DATA_TRANSACTION, not exported). */
const DATA_TRANSACTION = 2;

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
  /** When true, the next DFU_DNLOAD stalls instead of succeeding — for
   * simulating a mid-flash protocol failure (a stall is what a real
   * disconnect/bus error surfaces as, per the real-hardware testing that
   * found this). Cleared automatically after firing once. */
  failNextDownload = false;
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

    if (setup.request === DFU_DNLOAD && this.failNextDownload) {
      this.failNextDownload = false;
      return Promise.resolve({ status: "stall", bytesWritten: 0 });
    }

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

  it("reports phase-ordered step events, one row's worth of start/ok per phase with live progress in between", async () => {
    const bytes = new Uint8Array(PAGE_SIZE + 16); // spans 2 pages
    const events: FlashStepEvent[] = [];

    await flashStm32Dfu(device as unknown as USBDevice, bytes, (event) => events.push(event));

    const firstIndexOf = (phase: FlashStepEvent["phase"]) => events.findIndex((e) => e.phase === phase);
    expect(firstIndexOf("preparing")).toBeLessThan(firstIndexOf("flashing"));
    expect(firstIndexOf("flashing")).toBeLessThan(firstIndexOf("verifying"));
    expect(firstIndexOf("verifying")).toBeLessThan(firstIndexOf("finishing"));

    const preparingEvents = events.filter((e) => e.phase === "preparing");
    expect(preparingEvents.every((e) => e.current === undefined && e.total === undefined)).toBe(true);

    // Exactly one start/ok pair for the whole combined erase+write phase,
    // no matter how many pages/chunks it takes underneath — erase and
    // write are reported as a single "flashing" step since they always
    // run together now, so the progress bar's phase label doesn't flip
    // between "Erasing"/"Writing" on every chunk.
    expect(events.filter((e) => e.phase === "flashing" && (e.status === "start" || e.status === "ok"))).toHaveLength(2);

    // One combined "Page 0x..." progress event per chunk (not separate
    // erase/write ones — reporting them separately made the live activity
    // indicator flicker between two messages for every chunk).
    const flashingProgress = events.filter((e) => e.phase === "flashing" && e.status === "progress");
    expect(flashingProgress.every((e) => e.detail?.startsWith("Page 0x"))).toBe(true);
    expect(flashingProgress).toHaveLength(2); // one per chunk
    expect(flashingProgress.at(-1)).toMatchObject({ current: bytes.length, total: bytes.length });

    const verifyingProgress = events.filter((e) => e.phase === "verifying" && e.status === "progress");
    expect(verifyingProgress.at(-1)).toMatchObject({ current: bytes.length, total: bytes.length });

    const finishingEvents = events.filter((e) => e.phase === "finishing");
    expect(finishingEvents.every((e) => e.current === undefined && e.total === undefined)).toBe(true);
  });

  it("interleaves erase and write per chunk, so an interruption never leaves many pages erased before any are rewritten", async () => {
    const bytes = new Uint8Array(PAGE_SIZE + 16); // spans 2 pages / 2 chunks

    await flashStm32Dfu(device as unknown as USBDevice, bytes);

    const eraseIndices = device.commands
      .map((command, index) => ({ command, index }))
      .filter(({ command }) => command.request === DFU_DNLOAD && command.value === 0 && command.bytes?.[0] === 0x41)
      .map(({ index }) => index);
    const firstWriteIndex = device.commands.findIndex(
      (command) => command.request === DFU_DNLOAD && command.value === DATA_TRANSACTION && (command.bytes?.length ?? 0) > 0,
    );

    expect(eraseIndices).toHaveLength(2);
    // The first chunk's write happens before the second page even gets
    // erased — i.e. each page's replacement is written right away, not
    // after every page in the image has already been wiped.
    expect(firstWriteIndex).toBeGreaterThan(eraseIndices[0]!);
    expect(firstWriteIndex).toBeLessThan(eraseIndices[1]!);
  });

  it("resolves the flashing step to error (not stuck 'Running…') when the very first erase fails", async () => {
    const bytes = new Uint8Array(64);
    device.failNextDownload = true;
    const events: FlashStepEvent[] = [];

    await expect(flashStm32Dfu(device as unknown as USBDevice, bytes, (event) => events.push(event))).rejects.toThrow(/stall/);

    const flashingError = events.find((e) => e.phase === "flashing" && e.status === "error");
    expect(flashingError?.error).toMatch(/stall/);
  });

  it("reports a verifying error event when the readback does not match, without throwing away the finishing steps", async () => {
    device.corruptReadback = true;
    const bytes = new Uint8Array(64).fill(0xaa);
    const events: FlashStepEvent[] = [];

    await flashStm32Dfu(device as unknown as USBDevice, bytes, (event) => events.push(event));

    const verifyingError = events.find((e) => e.phase === "verifying" && e.status === "error");
    expect(verifyingError?.error).toMatch(/did not match/);
    expect(events.some((e) => e.phase === "finishing" && e.label === "Leaving DFU mode" && e.status === "ok")).toBe(true);
  });
});

describe("planErasePages", () => {
  const segments = parseDfuSeMemoryLayout(`@Internal Flash /0x${FLASH_BASE.toString(16)}/2*002Kg`);

  it("returns a single page for a range within it", () => {
    expect(planErasePages(segments, FLASH_BASE, FLASH_BASE + 63)).toEqual([FLASH_BASE]);
  });

  it("returns every distinct page a range spans, in ascending order", () => {
    expect(planErasePages(segments, FLASH_BASE, FLASH_BASE + PAGE_SIZE + 15)).toEqual([FLASH_BASE, FLASH_BASE + PAGE_SIZE]);
  });

  it("throws when the range extends past the described segments", () => {
    expect(() => planErasePages(segments, FLASH_BASE, FLASH_BASE + FLASH_SIZE)).toThrow(/No flash segment covers/);
  });

  it("handles a range crossing a non-uniform sector-size boundary (synthetic STM32F4-style)", () => {
    // 4 * 16KB, then 1 * 64KB, then 7 * 128KB — same shape exercised in
    // dfuse-memory-layout.test.ts. "Wider chip-parameter coverage" here
    // means logic-verified against this shape, not hardware-verified —
    // no F4-family board has been tested against this project yet.
    const nonUniform = parseDfuSeMemoryLayout(`@Internal Flash /0x${FLASH_BASE.toString(16)}/04*016Kg,01*064Kg,07*128Kg`);
    const sixteenKb = 16 * 1024;
    const sixtyFourKb = 64 * 1024;

    // A range spanning all four 16KB sectors plus a few bytes into the
    // single 64KB sector immediately after them.
    const pages = planErasePages(nonUniform, FLASH_BASE, FLASH_BASE + 4 * sixteenKb + 16);

    expect(pages).toEqual([
      FLASH_BASE,
      FLASH_BASE + sixteenKb,
      FLASH_BASE + 2 * sixteenKb,
      FLASH_BASE + 3 * sixteenKb,
      FLASH_BASE + 4 * sixteenKb,
    ]);
    expect(pages).toHaveLength(5);
    // Confirms the differently-sized page was picked up correctly, not
    // just another 16KB page reused past the boundary.
    expect(nonUniform.find((s) => s.start === pages[4])?.pageSizeBytes).toBe(sixtyFourKb);
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
