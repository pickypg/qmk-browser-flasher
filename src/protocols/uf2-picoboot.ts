import { verifyFlash } from "../core/verify.js";
import type { FlashPhase, FlashResult, FlashStepEvent } from "../types/index.js";

// RP2040's PICOBOOT interface — a vendor-specific USB interface the ROM
// bootloader exposes alongside its mass-storage (UF2 drag-and-drop)
// interface, with direct erase/write/read commands over bulk transfers.
// The same interface picotool talks to. Command bytes, transfer
// sequencing, and the exclusive-access/exit-XIP ordering requirement
// below were verified against raspberrypi/pico-sdk's
// src/common/boot_picoboot_headers/include/boot/picoboot.h (struct
// layout, command IDs, status codes) and raspberrypi/picotool's
// picoboot_connection/picoboot_connection.c + picoboot_connection_cxx.cpp
// (the actual bulk-transfer flow) — both BSD-3-Clause, read for
// wire-protocol facts only, nothing copied. See docs/PROTOCOL_NOTES.md.

const PICOBOOT_MAGIC = 0x431fd10b;

const PC_EXCLUSIVE_ACCESS = 0x01;
const PC_REBOOT = 0x02;
const PC_FLASH_ERASE = 0x03;
const PC_WRITE = 0x05;
const PC_EXIT_XIP = 0x06;
const PC_READ = 0x84;

/** Vendor/interface control requests — separate from the bulk command
 * protocol above. RESET clears any stuck state left over from a previous
 * session; CMD_STATUS (unused here) returns a real error code when a
 * bulk transfer stalls. */
const PICOBOOT_IF_RESET = 0x41;

const CMD_LENGTH = 32;

/** Every RP2040 chip maps its flash here — this is architectural, not
 * board-specific, matching STM32_FLASH_BASE's role in stm32-dfu.ts. */
export const RP2040_FLASH_BASE = 0x10000000;

/** hardware/flash.h: erase granularity — FLASH_ERASE's addr/size must
 * both be sector-aligned/sector-multiples. */
const SECTOR_SIZE = 4096;
/** hardware/flash.h: write granularity — WRITE's addr/size must both be
 * page-aligned/page-multiples. */
const PAGE_SIZE = 256;

/** addressmap.h SRAM_END — used as the stack pointer for the post-flash
 * reboot into the newly-flashed application. */
const RP2040_SRAM_END = 0x20042000;

interface PicobootInterface {
  readonly interfaceNumber: number;
  readonly outEndpoint: number;
  readonly inEndpoint: number;
}

/** Finds RP2040's PICOBOOT interface: vendor-specific (class 0xFF) with
 * exactly two bulk endpoints, one IN and one OUT — found by scanning
 * rather than assuming an ordinal, same discipline as
 * stm32-dfu.ts's findDfuInterface. */
export function findPicobootInterface(device: USBDevice): PicobootInterface {
  const interfaces = device.configuration?.interfaces ?? [];
  for (const iface of interfaces) {
    for (const alt of iface.alternates) {
      if (alt.interfaceClass !== 0xff || alt.endpoints.length !== 2) {
        continue;
      }
      const out = alt.endpoints.find((ep) => ep.direction === "out" && ep.type === "bulk");
      const inEp = alt.endpoints.find((ep) => ep.direction === "in" && ep.type === "bulk");
      if (out && inEp) {
        return { interfaceNumber: iface.interfaceNumber, outEndpoint: out.endpointNumber, inEndpoint: inEp.endpointNumber };
      }
    }
  }
  throw new Error("No PICOBOOT interface found on device");
}

function buildCommand(token: number, cmdId: number, cmdSize: number, transferLength: number, args: readonly number[]): Uint8Array {
  const buf = new Uint8Array(CMD_LENGTH);
  const view = new DataView(buf.buffer);
  view.setUint32(0, PICOBOOT_MAGIC, true);
  view.setUint32(4, token, true);
  buf[8] = cmdId;
  buf[9] = cmdSize;
  view.setUint16(10, 0, true);
  view.setUint32(12, transferLength, true);
  buf.set(args.slice(0, 16), 16);
  return buf;
}

function encodeRange(addr: number, size: number): number[] {
  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setUint32(0, addr, true);
  new DataView(buf.buffer).setUint32(4, size, true);
  return Array.from(buf);
}

let nextToken = 1;

/** Runs one PICOBOOT command: send the 32-byte command packet, then (if
 * dTransferLength != 0) a data phase in the direction cmdId's high bit
 * indicates (IN for e.g. PC_READ, OUT for e.g. PC_WRITE), then a
 * zero-length ack in the opposite direction — confirmed against
 * picoboot_connection.c's picoboot_cmd(). Returns the read data, if any. */
async function runCommand(
  device: USBDevice,
  outEp: number,
  inEp: number,
  cmdId: number,
  cmdSize: number,
  args: readonly number[],
  dataOut?: Uint8Array,
  readLength?: number,
): Promise<Uint8Array | undefined> {
  const transferLength = dataOut ? dataOut.length : (readLength ?? 0);
  const cmd = buildCommand(nextToken++, cmdId, cmdSize, transferLength, args);

  const cmdResult = await device.transferOut(outEp, cmd as BufferSource);
  if (cmdResult.status !== "ok") {
    throw new Error(`Failed to send PICOBOOT command 0x${cmdId.toString(16)}: ${cmdResult.status}`);
  }

  let received: Uint8Array | undefined;
  const isReadShaped = (cmdId & 0x80) !== 0;
  if (transferLength > 0) {
    if (isReadShaped) {
      const dataResult = await device.transferIn(inEp, transferLength);
      if (dataResult.status !== "ok" || !dataResult.data) {
        throw new Error(`Failed to read PICOBOOT response data for 0x${cmdId.toString(16)}: ${dataResult.status}`);
      }
      received = new Uint8Array(dataResult.data.buffer, dataResult.data.byteOffset, dataResult.data.byteLength);
    } else {
      const outResult = await device.transferOut(outEp, dataOut! as BufferSource);
      if (outResult.status !== "ok") {
        throw new Error(`Failed to send PICOBOOT command data for 0x${cmdId.toString(16)}: ${outResult.status}`);
      }
    }
  }

  // Ack is in the opposite direction from the data phase (or, for
  // no-data commands, opposite the command's own bCmdId shape).
  if (isReadShaped) {
    await device.transferOut(outEp, new Uint8Array(0));
  } else {
    await device.transferIn(inEp, 1);
  }

  return received;
}

async function withContext<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label}: ${message}`, { cause: error });
  }
}

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

/** Clears any stuck state left over from a previous session — best-effort,
 * a fresh bootloader entry shouldn't need this but it's cheap insurance,
 * same reasoning as stm32-dfu.ts's ensureIdle. */
async function resetInterface(device: USBDevice, iface: PicobootInterface): Promise<void> {
  try {
    await device.clearHalt("in", iface.inEndpoint);
  } catch {
    // not halted — fine
  }
  try {
    await device.clearHalt("out", iface.outEndpoint);
  } catch {
    // not halted — fine
  }
  const result = await device.controlTransferOut({ requestType: "vendor", recipient: "interface", request: PICOBOOT_IF_RESET, value: 0, index: iface.interfaceNumber });
  if (result.status !== "ok") {
    throw new Error(`PICOBOOT_IF_RESET failed: ${result.status}`);
  }
}

/** Mandatory before FLASH_ERASE/WRITE — WRITE hangs without it (confirmed
 * via raspberrypi/pico-feedback #59), sent once per session, not per
 * chunk. */
async function exclusiveAccess(device: USBDevice, iface: PicobootInterface, exclusive: boolean): Promise<void> {
  await runCommand(device, iface.outEndpoint, iface.inEndpoint, PC_EXCLUSIVE_ACCESS, 1, [exclusive ? 1 : 0]);
}

/** Mandatory before FLASH_ERASE/WRITE — WRITE silently corrupts data with
 * no error without it (confirmed via the same issue), sent once per
 * session. */
async function exitXip(device: USBDevice, iface: PicobootInterface): Promise<void> {
  await runCommand(device, iface.outEndpoint, iface.inEndpoint, PC_EXIT_XIP, 0, []);
}

async function flashErase(device: USBDevice, iface: PicobootInterface, addr: number, size: number): Promise<void> {
  await runCommand(device, iface.outEndpoint, iface.inEndpoint, PC_FLASH_ERASE, 8, encodeRange(addr, size));
}

async function writeFlash(device: USBDevice, iface: PicobootInterface, addr: number, buffer: Uint8Array): Promise<void> {
  await runCommand(device, iface.outEndpoint, iface.inEndpoint, PC_WRITE, 8, encodeRange(addr, buffer.length), buffer);
}

async function readFlash(device: USBDevice, iface: PicobootInterface, addr: number, length: number): Promise<Uint8Array> {
  const data = await runCommand(device, iface.outEndpoint, iface.inEndpoint, PC_READ, 8, encodeRange(addr, length), undefined, length);
  if (!data) {
    throw new Error("PICOBOOT READ returned no data");
  }
  return data;
}

/** dPC=0 means "boot normally from the flash vector table", not a literal
 * jump address — confirmed against picotool's own load-and-execute path,
 * which uses this exact form for booting into a freshly-flashed image. */
async function reboot(device: USBDevice, iface: PicobootInterface, pc: number, sp: number, delayMs: number): Promise<void> {
  const buf = new Uint8Array(12);
  const view = new DataView(buf.buffer);
  view.setUint32(0, pc, true);
  view.setUint32(4, sp, true);
  view.setUint32(8, delayMs, true);
  await runCommand(device, iface.outEndpoint, iface.inEndpoint, PC_REBOOT, 12, Array.from(buf));
}

export async function flashUf2Picoboot(device: USBDevice, bytes: Uint8Array, onStep?: (event: FlashStepEvent) => void): Promise<FlashResult> {
  if (bytes.length === 0) {
    throw new Error("Firmware is empty");
  }

  const iface = findPicobootInterface(device);
  const flashStart = RP2040_FLASH_BASE;
  const totalBytes = bytes.length;

  await runPhaseStep(onStep, "preparing", "Resetting PICOBOOT interface", () => withContext("Resetting PICOBOOT interface", () => resetInterface(device, iface)));
  await runPhaseStep(onStep, "preparing", "Gaining exclusive access", () => withContext("Gaining exclusive access", () => exclusiveAccess(device, iface, true)));
  await runPhaseStep(onStep, "preparing", "Exiting flash execute-in-place mode", () => withContext("Exiting XIP", () => exitXip(device, iface)));

  // Erase and write are interleaved per sector, same reasoning as
  // stm32-dfu.ts: keeps the "erased but not yet rewritten" window to at
  // most one sector instead of the whole image. RP2040's sector size is
  // architecturally uniform (unlike some non-uniform-sector STM32
  // parts), so this needs no page-planning table.
  const label = "Flashing firmware";
  onStep?.({ phase: "flashing", label, status: "start", current: 0, total: totalBytes });

  try {
    for (let offset = 0; offset < totalBytes; offset += SECTOR_SIZE) {
      const address = flashStart + offset;
      const chunkLen = Math.min(SECTOR_SIZE, totalBytes - offset);

      const eraseLabel = `Erasing sector 0x${address.toString(16)}`;
      await withContext(eraseLabel, () => flashErase(device, iface, address, SECTOR_SIZE));
      onStep?.({ phase: "flashing", label, status: "progress", current: offset, total: totalBytes, detail: eraseLabel });

      // WRITE requires a page(256)-multiple size — pad the final,
      // possibly-short chunk with 0xFF (the erased-flash fill value),
      // which only ever extends past the real firmware's end within the
      // same already-erased sector, so it's inert.
      const writeLen = Math.ceil(chunkLen / PAGE_SIZE) * PAGE_SIZE;
      const writeBuf = new Uint8Array(writeLen).fill(0xff);
      writeBuf.set(bytes.subarray(offset, offset + chunkLen));

      const writeLabel = `Writing sector at 0x${address.toString(16)}`;
      await withContext(writeLabel, () => writeFlash(device, iface, address, writeBuf));
      onStep?.({ phase: "flashing", label, status: "progress", current: offset + chunkLen, total: totalBytes, detail: writeLabel });
    }
    onStep?.({ phase: "flashing", label, status: "ok", current: totalBytes, total: totalBytes });
  } catch (error) {
    onStep?.({ phase: "flashing", label, status: "error", error: error instanceof Error ? error.message : String(error) });
    throw error;
  }

  const readback = new Uint8Array(totalBytes);
  await runPhaseStep(onStep, "verifying", "Verifying firmware", async () => {
    for (let offset = 0; offset < totalBytes; offset += SECTOR_SIZE) {
      const length = Math.min(SECTOR_SIZE, totalBytes - offset);
      const readLabel = `Reading block at offset 0x${offset.toString(16)}`;
      const block = await withContext(readLabel, () => readFlash(device, iface, flashStart + offset, length));
      readback.set(block, offset);
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

  // The flash write is already done and verified above; the device
  // resets during reboot and can vanish mid-handshake, so a failure here
  // shouldn't overwrite that result with a false failure — same
  // best-effort treatment as stm32-dfu.ts's leaveDfuMode.
  try {
    await runPhaseStep(onStep, "finishing", "Rebooting into application", () => reboot(device, iface, 0, RP2040_SRAM_END, 500));
  } catch {
    // Best-effort: the user can still power-cycle the board manually.
  }

  return { ok: verified, bytesWritten: totalBytes, verified };
}
