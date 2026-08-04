import type { ChipParams, FirmwareImage, FlashProgress, FlashResult } from "../types/index.js";
import { verifyFlash } from "../core/verify.js";

// ST "DfuSe" USB DFU extension (AN3156/AN2606), as used by the STM32 ROM
// bootloader. Command bytes verified against dfu-util's src/dfuse.c
// (GPL-2.0, read for the wire-protocol facts only — nothing here is
// ported from it). See docs/PROTOCOL_NOTES.md.

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

export async function flashStm32Dfu(
  device: USBDevice,
  image: FirmwareImage,
  chip: ChipParams,
  onProgress?: (progress: FlashProgress) => void,
): Promise<FlashResult> {
  const { interfaceNumber } = findDfuInterface(device);
  const totalBytes = image.bytes.length;
  const pageSize = chip.pageSizeBytes;
  const erasedPages = new Set<number>();

  await withContext("Checking device state", () => ensureIdle(device, interfaceNumber));

  for (let offset = 0; offset < totalBytes; offset += DEFAULT_TRANSFER_SIZE) {
    const address = image.startAddress + offset;
    const chunk = image.bytes.subarray(offset, Math.min(offset + DEFAULT_TRANSFER_SIZE, totalBytes));

    const firstPage = Math.floor(address / pageSize) * pageSize;
    const lastPage = Math.floor((address + chunk.length - 1) / pageSize) * pageSize;
    for (let page = firstPage; page <= lastPage; page += pageSize) {
      if (!erasedPages.has(page)) {
        await withContext(`Erasing page 0x${page.toString(16)}`, () => runSpecialCommand(device, interfaceNumber, encodeErasePage(page)));
        erasedPages.add(page);
      }
    }

    await withContext(`Setting address 0x${address.toString(16)}`, () => runSpecialCommand(device, interfaceNumber, encodeSetAddress(address)));
    await withContext(`Writing block at 0x${address.toString(16)}`, () => writeBlock(device, interfaceNumber, chunk));

    onProgress?.({ bytesWritten: offset + chunk.length, totalBytes });
  }

  const readback = new Uint8Array(totalBytes);
  await withContext("Setting address for readback", () => runSpecialCommand(device, interfaceNumber, encodeSetAddress(image.startAddress)));
  let transaction = DATA_TRANSACTION;
  for (let offset = 0; offset < totalBytes; offset += DEFAULT_TRANSFER_SIZE) {
    const length = Math.min(DEFAULT_TRANSFER_SIZE, totalBytes - offset);
    const block = await withContext(`Reading block at offset 0x${offset.toString(16)}`, () => dfuUpload(device, interfaceNumber, transaction, length));
    readback.set(block, offset);
    transaction += 1;
  }

  const verified = verifyFlash(image, readback);

  // DFU_UPLOAD leaves the device in dfuUPLOAD-IDLE, which doesn't accept
  // DFU_DNLOAD directly — ABORT first to return to dfuIDLE.
  await withContext("Returning to dfuIDLE after readback", () => dfuAbort(device, interfaceNumber));

  // The flash write is already done and verified above; failing to leave
  // DFU mode (e.g. the device resets mid-handshake) shouldn't overwrite
  // that result with a false failure.
  try {
    await leaveDfuMode(device, interfaceNumber);
  } catch {
    // Best-effort: the user can still power-cycle the board manually.
  }

  return { ok: verified, bytesWritten: totalBytes, verified };
}
