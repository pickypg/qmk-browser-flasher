import { verifyFlash } from "../core/verify.js";
import type { FlashPhase, FlashResult, FlashStepEvent } from "../types/index.js";
import { type DfuSeSegment, findSegment, parseDfuSeMemoryLayout } from "./dfuse-memory-layout.js";
import { findInterfaceStringIndex, getConfigurationDescriptor, getDefaultLangId, getStringDescriptor } from "./usb-descriptors.js";

// ST "DfuSe" USB DFU extension (AN3156/AN2606), as used by the STM32 ROM
// bootloader. Command bytes verified against dfu-util's src/dfuse.c
// (GPL-2.0, read for the wire-protocol facts only — nothing here is
// ported from it). Chip flash layout (base address, size, page size) is
// read live from the device's own DfuSe memory-layout descriptor string
// (see dfuse-memory-layout.ts) rather than a per-chip data table — no
// board-specific data is needed to flash a genuine ST DFU bootloader.
// See docs/PROTOCOL_NOTES.md.

const DFU_DNLOAD = 1;
const DFU_UPLOAD = 2;
const DFU_GETSTATUS = 3;
const DFU_CLRSTATUS = 4;
const DFU_ABORT = 6;

const STATE_DFU_IDLE = 2;
const STATE_DFU_DNBUSY = 4;
const STATE_DFU_DNLOAD_IDLE = 5;
const STATE_DFU_MANIFEST = 7;
const STATE_DFU_ERROR = 10;

const STATUS_OK = 0;

const DEFAULT_TRANSFER_SIZE = 2048;
/** Fixed transaction number for data blocks — address is always set
 * explicitly beforehand, so no address-offset encoding via wValue is needed. */
const DATA_TRANSACTION = 2;

/** USB interface class/subclass for "Application Specific" / DFU, per the
 * USB DFU 1.1 spec — used to find the right interface rather than assuming
 * it's the device's first (a DFU-capable device can expose others). */
const DFU_INTERFACE_CLASS = 0xfe;
const DFU_INTERFACE_SUBCLASS = 0x01;

/** Every STM32 part maps its main flash here — this is architectural, not
 * board- or chip-specific, so it's safe to use as a fixed lookup key into
 * the device's own reported memory segments. */
const STM32_FLASH_BASE = 0x08000000;

interface DfuStatus {
  readonly status: number;
  readonly pollTimeoutMs: number;
  readonly state: number;
}

export function encodeSetAddress(address: number): Uint8Array {
  return encodeSpecialCommand(0x21, address);
}

export function encodeErasePage(address: number): Uint8Array {
  return encodeSpecialCommand(0x41, address);
}

export function encodeMassErase(): Uint8Array {
  return new Uint8Array([0x41]);
}

function encodeSpecialCommand(command: number, address: number): Uint8Array {
  return new Uint8Array([command, address & 0xff, (address >>> 8) & 0xff, (address >>> 16) & 0xff, (address >>> 24) & 0xff]);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function findDfuInterface(device: USBDevice): { interfaceNumber: number; alternateSetting: number } {
  const interfaces = device.configuration?.interfaces ?? [];
  for (const iface of interfaces) {
    for (const alt of iface.alternates) {
      if (alt.interfaceClass === DFU_INTERFACE_CLASS && alt.interfaceSubclass === DFU_INTERFACE_SUBCLASS) {
        return { interfaceNumber: iface.interfaceNumber, alternateSetting: alt.alternateSetting };
      }
    }
  }
  throw new Error("No DFU interface found on device");
}

function tryParseFlashSegments(name: string, alternateSetting: number, seen: string[]): { alternateSetting: number; segments: DfuSeSegment[] } | undefined {
  let segments: DfuSeSegment[];
  try {
    segments = parseDfuSeMemoryLayout(name);
  } catch (error) {
    seen.push(`alt ${alternateSetting}: "${name}" failed to parse (${error instanceof Error ? error.message : String(error)})`);
    return undefined;
  }
  if (findSegment(segments, STM32_FLASH_BASE)) {
    return { alternateSetting, segments };
  }
  seen.push(`alt ${alternateSetting}: "${name}" parsed but doesn't cover 0x${STM32_FLASH_BASE.toString(16)}`);
  return undefined;
}

/** Finds the DFU alternate setting whose memory-layout descriptor covers
 * the main flash region, and returns its parsed segments. A DfuSe device
 * can expose several alternates (Internal Flash, Option Bytes, OTP, ...);
 * this doesn't assume which ordinal is which, it reads each descriptor. */
export async function findFlashAlternate(device: USBDevice, interfaceNumber: number): Promise<{ alternateSetting: number; segments: DfuSeSegment[] }> {
  const iface = device.configuration?.interfaces.find((i) => i.interfaceNumber === interfaceNumber);
  const alternates = iface?.alternates ?? [];
  const seen: string[] = [];

  // Fast path: the browser already resolved the string descriptors.
  for (const alt of alternates) {
    if (!alt.interfaceName) {
      continue;
    }
    const found = tryParseFlashSegments(alt.interfaceName, alt.alternateSetting, seen);
    if (found) {
      return found;
    }
  }

  // Fallback: WebUSB's automatic string-descriptor resolution
  // (USBAlternateInterface.interfaceName) is a SHOULD, not a MUST — some
  // devices/browsers leave it null. Fetch it manually via GET_DESCRIPTOR.
  const unresolved = alternates.filter((alt) => !alt.interfaceName);
  if (unresolved.length > 0) {
    const configDescriptor = await getConfigurationDescriptor(device);
    const langId = await getDefaultLangId(device);
    for (const alt of unresolved) {
      const stringIndex = findInterfaceStringIndex(configDescriptor, interfaceNumber, alt.alternateSetting);
      if (!stringIndex) {
        seen.push(`alt ${alt.alternateSetting}: no iInterface string index in the configuration descriptor`);
        continue;
      }
      const name = await getStringDescriptor(device, stringIndex, langId);
      const found = tryParseFlashSegments(name, alt.alternateSetting, seen);
      if (found) {
        return found;
      }
    }
  }

  throw new Error(`No DfuSe alternate setting describes the main flash region (${alternates.length} alternate(s) seen: ${seen.join("; ") || "none"})`);
}

async function withContext<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label}: ${message}`, { cause: error });
  }
}

async function dfuDownload(device: USBDevice, interfaceNumber: number, transaction: number, data?: Uint8Array): Promise<void> {
  const setup: USBControlTransferParameters = {
    requestType: "class",
    recipient: "interface",
    request: DFU_DNLOAD,
    value: transaction,
    index: interfaceNumber,
  };
  const result = data ? await device.controlTransferOut(setup, data as BufferSource) : await device.controlTransferOut(setup);
  if (result.status !== "ok") {
    throw new Error(`DFU_DNLOAD failed: ${result.status}`);
  }
}

async function dfuUpload(device: USBDevice, interfaceNumber: number, transaction: number, length: number): Promise<Uint8Array> {
  const result = await device.controlTransferIn(
    { requestType: "class", recipient: "interface", request: DFU_UPLOAD, value: transaction, index: interfaceNumber },
    length,
  );
  if (result.status !== "ok" || !result.data) {
    throw new Error(`DFU_UPLOAD failed: ${result.status}`);
  }
  return new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength);
}

async function dfuGetStatus(device: USBDevice, interfaceNumber: number): Promise<DfuStatus> {
  const result = await device.controlTransferIn(
    { requestType: "class", recipient: "interface", request: DFU_GETSTATUS, value: 0, index: interfaceNumber },
    6,
  );
  if (result.status !== "ok" || !result.data || result.data.byteLength < 6) {
    throw new Error(`DFU_GETSTATUS failed: ${result.status}`);
  }
  const view = result.data;
  return {
    status: view.getUint8(0),
    pollTimeoutMs: view.getUint8(1) | (view.getUint8(2) << 8) | (view.getUint8(3) << 16),
    state: view.getUint8(4),
  };
}

async function dfuClearStatus(device: USBDevice, interfaceNumber: number): Promise<void> {
  const result = await device.controlTransferOut({ requestType: "class", recipient: "interface", request: DFU_CLRSTATUS, value: 0, index: interfaceNumber });
  if (result.status !== "ok") {
    throw new Error(`DFU_CLRSTATUS failed: ${result.status}`);
  }
}

async function dfuAbort(device: USBDevice, interfaceNumber: number): Promise<void> {
  const result = await device.controlTransferOut({ requestType: "class", recipient: "interface", request: DFU_ABORT, value: 0, index: interfaceNumber });
  if (result.status !== "ok") {
    throw new Error(`DFU_ABORT failed: ${result.status}`);
  }
}

/** Clears any leftover dfuERROR state from a previous session before this
 * run sends its first command — a fresh DFU-mode entry should already be
 * dfuIDLE, but this makes that an assertion rather than an assumption. */
async function ensureIdle(device: USBDevice, interfaceNumber: number): Promise<void> {
  let status = await dfuGetStatus(device, interfaceNumber);
  if (status.state === STATE_DFU_ERROR) {
    await dfuClearStatus(device, interfaceNumber);
    status = await dfuGetStatus(device, interfaceNumber);
  }
  if (status.state !== STATE_DFU_IDLE) {
    throw new Error(`Device not in dfuIDLE before flashing (state=${status.state}, status=${status.status})`);
  }
}

/** Runs a DfuSe special command (SET_ADDRESS/ERASE_PAGE/MASS_ERASE) and
 * waits through its busy -> OK -> idle sequence. */
async function runSpecialCommand(device: USBDevice, interfaceNumber: number, command: Uint8Array): Promise<void> {
  await dfuDownload(device, interfaceNumber, 0, command);

  let status = await dfuGetStatus(device, interfaceNumber);
  if (status.state !== STATE_DFU_DNBUSY) {
    throw new Error(`Unexpected DFU state after command: ${status.state}`);
  }
  await sleep(status.pollTimeoutMs);

  status = await dfuGetStatus(device, interfaceNumber);
  if (status.status !== STATUS_OK) {
    throw new Error(`DFU command failed with status ${status.status}`);
  }
  await sleep(status.pollTimeoutMs);

  await dfuAbort(device, interfaceNumber);
  status = await dfuGetStatus(device, interfaceNumber);
  if (status.state !== STATE_DFU_IDLE) {
    throw new Error(`Failed to return to dfuIDLE after command: ${status.state}`);
  }
}

/** Writes one data block and waits for it to finish programming. */
async function writeBlock(device: USBDevice, interfaceNumber: number, data: Uint8Array): Promise<void> {
  await dfuDownload(device, interfaceNumber, DATA_TRANSACTION, data);

  let status: DfuStatus;
  do {
    status = await dfuGetStatus(device, interfaceNumber);
    await sleep(status.pollTimeoutMs);
  } while (status.state !== STATE_DFU_DNLOAD_IDLE && status.state !== STATE_DFU_ERROR && status.state !== STATE_DFU_MANIFEST);

  if (status.status !== STATUS_OK) {
    throw new Error(`DFU program failed with status ${status.status}`);
  }
}

/** Triggers dfuMANIFEST (device resets into the newly-flashed application).
 * The device can vanish from the bus mid-sequence once it resets, so
 * failures here are expected sometimes and are not treated as fatal by
 * the caller — the flash itself is already done and verified by this point. */
async function leaveDfuMode(device: USBDevice, interfaceNumber: number): Promise<void> {
  await dfuDownload(device, interfaceNumber, DATA_TRANSACTION);

  let status: DfuStatus;
  do {
    status = await dfuGetStatus(device, interfaceNumber);
    await sleep(status.pollTimeoutMs);
  } while (status.state !== STATE_DFU_DNLOAD_IDLE && status.state !== STATE_DFU_ERROR && status.state !== STATE_DFU_MANIFEST);
}

/** Returns every distinct page-start address that overlaps [start, end],
 * walking segment-by-segment so a page-size change partway through
 * (non-uniform sector chips) is handled correctly rather than assuming one
 * flat page size. Pure and side-effect-free so the total page count is
 * known before any erase command is sent. */
export function planErasePages(segments: readonly DfuSeSegment[], start: number, end: number): number[] {
  const pages: number[] = [];
  const seen = new Set<number>();
  let cursor = start;
  while (cursor <= end) {
    const segment = findSegment(segments, cursor);
    if (!segment) {
      throw new Error(`No flash segment covers address 0x${cursor.toString(16)}`);
    }
    const pageStart = segment.start + Math.floor((cursor - segment.start) / segment.pageSizeBytes) * segment.pageSizeBytes;
    if (!seen.has(pageStart)) {
      seen.add(pageStart);
      pages.push(pageStart);
    }
    cursor = pageStart + segment.pageSizeBytes;
  }
  return pages;
}

/** Runs one named operation, reporting its start/ok/error as a
 * FlashStepEvent around it. Multi-step operations (erase/write/verify)
 * report their own "progress" events with live current/total from inside
 * `fn` — this only brackets the overall start/ok/error, so a step log can
 * render one row per named operation regardless of how many device
 * round-trips it takes underneath. */
async function runPhaseStep<T>(onStep: ((event: FlashStepEvent) => void) | undefined, phase: FlashPhase, label: string, fn: () => Promise<T>): Promise<T> {
  onStep?.({ phase, label, status: "start" });
  try {
    const result = await fn();
    onStep?.({ phase, label, status: "ok" });
    return result;
  } catch (error) {
    onStep?.({ phase, label, status: "error", error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

export async function flashStm32Dfu(device: USBDevice, bytes: Uint8Array, onStep?: (event: FlashStepEvent) => void): Promise<FlashResult> {
  const { interfaceNumber } = findDfuInterface(device);
  const { alternateSetting, segments } = await findFlashAlternate(device, interfaceNumber);
  await device.selectAlternateInterface(interfaceNumber, alternateSetting);

  const flashStart = Math.min(...segments.map((s) => s.start));
  const flashEnd = Math.max(...segments.map((s) => s.end));
  const totalFlashSize = flashEnd - flashStart + 1;
  const totalBytes = bytes.length;

  if (totalBytes > totalFlashSize) {
    throw new Error(`Firmware (${totalBytes} bytes) is larger than the device's flash (${totalFlashSize} bytes)`);
  }

  await runPhaseStep(onStep, "preparing", "Checking device state", () => withContext("Checking device state", () => ensureIdle(device, interfaceNumber)));

  const pages = planErasePages(segments, flashStart, flashStart + totalBytes - 1);
  await runPhaseStep(onStep, "erasing", "Erasing flash", async () => {
    for (let i = 0; i < pages.length; i++) {
      const pageStart = pages[i]!;
      const pageLabel = `Erasing page 0x${pageStart.toString(16)}`;
      await withContext(pageLabel, () => runSpecialCommand(device, interfaceNumber, encodeErasePage(pageStart)));
      onStep?.({ phase: "erasing", label: "Erasing flash", status: "progress", current: i + 1, total: pages.length, detail: pageLabel });
    }
  });

  await runPhaseStep(onStep, "writing", "Writing firmware", async () => {
    for (let offset = 0; offset < totalBytes; offset += DEFAULT_TRANSFER_SIZE) {
      const address = flashStart + offset;
      const chunk = bytes.subarray(offset, Math.min(offset + DEFAULT_TRANSFER_SIZE, totalBytes));
      const writeLabel = `Writing block at 0x${address.toString(16)}`;

      await withContext(`Setting address 0x${address.toString(16)}`, () => runSpecialCommand(device, interfaceNumber, encodeSetAddress(address)));
      await withContext(writeLabel, () => writeBlock(device, interfaceNumber, chunk));

      onStep?.({ phase: "writing", label: "Writing firmware", status: "progress", current: offset + chunk.length, total: totalBytes, detail: writeLabel });
    }
  });

  const readback = new Uint8Array(totalBytes);
  await runPhaseStep(onStep, "verifying", "Verifying firmware", async () => {
    await withContext("Setting address for readback", () => runSpecialCommand(device, interfaceNumber, encodeSetAddress(flashStart)));
    let transaction = DATA_TRANSACTION;
    for (let offset = 0; offset < totalBytes; offset += DEFAULT_TRANSFER_SIZE) {
      const length = Math.min(DEFAULT_TRANSFER_SIZE, totalBytes - offset);
      const readLabel = `Reading block at offset 0x${offset.toString(16)}`;
      const block = await withContext(readLabel, () => dfuUpload(device, interfaceNumber, transaction, length));
      readback.set(block, offset);
      transaction += 1;
      onStep?.({ phase: "verifying", label: "Verifying firmware", status: "progress", current: offset + length, total: totalBytes, detail: readLabel });
    }
  });

  const verified = verifyFlash(bytes, readback);
  if (!verified) {
    onStep?.({
      phase: "verifying",
      label: "Verifying firmware",
      status: "error",
      current: totalBytes,
      total: totalBytes,
      error: "Readback did not match what was written",
    });
  }

  // DFU_UPLOAD leaves the device in dfuUPLOAD-IDLE, which doesn't accept
  // DFU_DNLOAD directly — ABORT first to return to dfuIDLE.
  await runPhaseStep(onStep, "finishing", "Returning to dfuIDLE after readback", () =>
    withContext("Returning to dfuIDLE after readback", () => dfuAbort(device, interfaceNumber)),
  );

  // The flash write is already done and verified above; failing to leave
  // DFU mode (e.g. the device resets mid-handshake) shouldn't overwrite
  // that result with a false failure.
  try {
    await runPhaseStep(onStep, "finishing", "Leaving DFU mode", () => leaveDfuMode(device, interfaceNumber));
  } catch {
    // Best-effort: the user can still power-cycle the board manually.
  }

  return { ok: verified, bytesWritten: totalBytes, verified };
}
