# Protocol Notes

Per-protocol implementation notes and spec references, filled in as each
protocol is implemented (see `plan.md` Section 3 for priority order).

## STM32 DfuSe (ST factory bootloader) — implemented in M1

Target: `src/protocols/stm32-dfu.ts`. Used by QMK's `stm32-dfu` bootloader
type, which jumps into the STM32 chip's factory ROM bootloader
(`platforms/chibios/bootloaders/stm32_dfu.c` in QMK — it isn't custom QMK
code, just a jump to `STM32_BOOTLOADER_ADDRESS`). That ROM bootloader
implements the standard USB DFU 1.1 class protocol plus ST's "DfuSe"
vendor extension, documented in ST application notes **AN3156** (DfuSe
protocol) and **AN2606** (bootloader selection). Command bytes below were
cross-checked against `dfu-util`'s `src/dfuse.c` (GPL-2.0, **read for the
wire-protocol facts only — no code copied**; DfuSe itself is ST's
published spec, so this is an independent implementation).

Bootloader-mode USB ID: VID `0x0483` (STMicroelectronics), PID `0xDF11`
("STM32 BOOTLOADER") — generic to *all* STM32 DFU-bootloader boards, not
board-specific.

All "special commands" go through standard `DFU_DNLOAD` (bRequest 1,
`wValue = 0`):

- **SET_ADDRESS**: `[0x21, addr&0xFF, (addr>>8)&0xFF, (addr>>16)&0xFF, (addr>>24)&0xFF]`
- **ERASE_PAGE**: `[0x41, addr&0xFF, (addr>>8)&0xFF, (addr>>16)&0xFF, (addr>>24)&0xFF]` (erases the page containing `addr`)
- **MASS_ERASE**: `[0x41]` (1 byte, no address)

After any special command: `DFU_GETSTATUS` (expect `bState == dfuDNBUSY`)
→ sleep `bwPollTimeout` ms → `DFU_GETSTATUS` again (expect `bStatus ==
OK`) → sleep again → `DFU_ABORT` (bRequest 6) → `DFU_GETSTATUS` (expect
`bState == dfuIDLE`).

**Write** (chunk size 2048 bytes, matching the STM32F0 family's uniform
2KB flash page size): for each chunk, `ERASE_PAGE` every page it spans
(skipping pages already erased this run), `SET_ADDRESS` to the chunk
start, then `DFU_DNLOAD` the data with `wValue = 2` — polling
`DFU_GETSTATUS` after until `bState` leaves `dfuDNBUSY`.

**Read** (verify): `SET_ADDRESS` once to the image start, then loop
`DFU_UPLOAD` (bRequest 2) with `wValue` incrementing from `2`, one call
per chunk.

**Leave DFU mode**: a zero-length `DFU_DNLOAD` (`wValue = 2`) followed by
one `DFU_GETSTATUS` triggers `dfuMANIFEST` and a reset into the
newly-flashed application.

### Chip parameters are read live, not stored

Flash base address, total size, and page size are **not** looked up from
any per-board or per-chip data file. ST's DFU bootloader publishes its
own memory layout as a USB interface string descriptor, per ST document
**UM0424** §4.3.2 — e.g. `"@Internal Flash /0x08000000/64*002Kg"` means:
base address `0x08000000`, `64` pages of `2` `K`ilobytes each, flags `g`
(readable+erasable+writable, decoded from `charCode & 0x7`). WebUSB
exposes this directly via `USBAlternateInterface.interfaceName`. Parsing
implemented in `src/protocols/dfuse-memory-layout.ts`, format verified
against `dfu-util`'s `src/dfuse_mem.c` (GPL-2.0, **read for the format
spec only — no code copied**).

**`interfaceName` isn't always populated.** The WebUSB spec only says it
SHOULD be resolved from the alternate setting's `iInterface` string
descriptor — confirmed on real hardware (NuPhy Air75 V2, Chrome/macOS)
that it can come back `null` on both alternates. `findFlashAlternate` in
`stm32-dfu.ts` falls back to fetching the string manually: a standard
`GET_DESCRIPTOR(CONFIGURATION)` to find the target alternate's
`iInterface` index (`src/protocols/usb-descriptors.ts` walks the raw
TLV-encoded descriptor bytes for this), then
`GET_DESCRIPTOR(STRING, index, langId)` for the actual string. These are
standard USB device requests (`requestType: "standard"`), not DFU- or
vendor-specific, so this works on any USB device regardless of protocol.

This means chip parameters work for *any* genuine ST DFU bootloader
without a data-entry step per board — confirmed against the NuPhy Air75
V2's real descriptor string (`64*002Kg`, matching what was previously
hardcoded from `nuphy-qmk-firmware`'s linker script: 128 KB at
`0x08000000`, no bootloader carve-out since the bootloader lives in
separate ROM at `0x1FFFC800`).

It also fixes a real bug the earlier hardcoded-per-board approach had:
every ST bootloader enumerates under the same generic ID (`0483:DF11`
below), so a second board's data entry, matched only by that ID, would
have collided with the first and silently applied the wrong chip's page
size — a real corruption risk, since flash pages that don't get an
explicit erase before being written just get ANDed with old contents
rather than cleanly overwritten.

**Non-uniform sector sizes** (e.g. the STM32F4 family's mixed 16KB/64KB/
128KB sectors, described as comma-separated groups in the same descriptor
string) are handled by both the parser and `planErasePages` in
`stm32-dfu.ts`, which walks per-segment page sizes rather than assuming
one flat size. This is presently **logic-verified only** — covered by
unit tests against a synthetic F4-shaped descriptor
(`test/protocols/stm32-dfu.test.ts`, `test/protocols/dfuse-memory-layout.test.ts`)
— not verified against real F4-family hardware, since none has been
available to test against so far.

### Progress reporting: phase-based step events, not a flat byte count

`flashStm32Dfu`'s optional callback takes a `FlashStepEvent` (see
`src/types/index.ts`), not a bare `{bytesWritten, totalBytes}` pair: each
event carries a `phase` (`preparing`/`flashing`/`verifying`/`finishing`),
a human-readable `label`, and a `status` of `start`/`progress`/`ok`/
`error`. `current`/`total` are present when there's a meaningful count for
that step (bytes written/read) and absent for one-shot steps (checking
device state, leaving DFU mode) — the UI treats the latter as
indeterminate rather than assuming 0%. `status: "progress"` fires once per
transfer chunk purely to animate a progress bar; `start`/`ok`/`error` are
sparse (one pair for the entire phase, not one per page/chunk) and are
what a step-log UI should render as rows. The still-stub protocols
(`avr-dfu.ts`, `halfkay.ts`, `caterina.ts`, `uf2-picoboot.ts`) share this
same `onStep` contract in their signatures for whenever they're
implemented.

Erase and write share a single `"flashing"` phase/row rather than two —
they always run interleaved per chunk now (erase the page(s) a chunk
needs, immediately write that chunk, then move on to the next), never as
separate batched passes, so treating them as one operation is accurate,
not just a UI simplification. (An earlier version of this UI did report
them as two independent phases; that made the progress bar's phase label
flip between "Erasing"/"Writing" on every chunk once erase+write were
interleaved, which is why they were merged.) `detail` on each `progress`
event still says which sub-step is active ("Erasing page 0x..." vs
"Writing block at 0x...") — `current`/`total` track bytes written, so the
number only advances once a chunk's write completes.

The interleaving itself matters for more than UI polish: if flashing is
interrupted, it keeps the window where a page sits erased-but-not-yet-
rewritten to at most one chunk, rather than the whole image. See
`docs/SAFETY.md` for why that window matters specifically for boards
using a software/magic-key bootloader-entry mechanism.

## AVR DFU (Atmel/LUFA) — researched, not yet implemented

Target: `src/protocols/avr-dfu.ts` (still a stub). Priority P0 per
`plan.md`, deferred past M1 because the AVR DFU protocol has no hardware
available to test against right now (see M1's rationale for targeting
STM32 DfuSe first instead).

This is **not** the standard USB-IF DFU class protocol — it's Atmel's own
vendor command set, documented in Atmel application note **doc7618**
("AT90USB/ATmegaxxU2/4/6 DFU Bootloader"). Command bytes below were
cross-checked against `dfu-programmer`'s `src/atmel.c` (GPL-2.0, **read
for the wire-protocol facts only — no code copied**).

All commands go through `DFU_DNLOAD` (bRequest 1, `wValue = 0`):

- **Select page** (send once before flashing; page = `address / 0x10000`, always `0` for a ≤64KB chip): `[0x06, 0x03, 0x00, page & 0xFF]`
- **Chip erase**: `[0x04, 0x00, 0xFF]`, then poll `DFU_GETSTATUS` until `bState` leaves `dfuDNBUSY`
- **Program block** (data ≤ 1024 bytes): a 32-byte control block + data + 16-byte footer in one `DFU_DNLOAD`:
  - control block: `[0x01, eeprom?1:0, startHi, startLo, endHi, endLo, 0×26]` (start/end are the block's byte offsets mod `0x10000`)
  - footer: 4-byte CRC (`0`, unused), `0x10` (footer length), `'D'`, `'F'`, `'U'`, `0x01, 0x10` (BCD DFU 1.1), `0xFF,0xFF` ×3 (VID/PID/firmware BCD, unused)
- **Read block** (verify, ≤ 1024 bytes): `DFU_DNLOAD` `[0x03, 0x00, startHi, startLo, endHi, endLo]`, then `DFU_UPLOAD` of `end - start + 1` bytes
- **Start application / reset**: `DFU_DNLOAD` `[0x04, 0x03, 0x00]`, then a zero-length `DFU_DNLOAD`

Reference chip: ATmega32U4, VID `0x03EB` (Atmel) / PID `0x2FF4`
(ATmega32U4 DFU bootloader). Flash: 32768 bytes total, top 4096 reserved
for the bootloader under QMK's `atmel-dfu`/`lufa-dfu`/`qmk-dfu`
(`BOOTLOADER_SIZE = 4096` in QMK's `bootloader.mk`) → application-writable
range `0x0000`–`0x6FFF`. Max DNLOAD/UPLOAD chunk: 1024 bytes.

## HalfKay (Teensy) — P0

Not yet implemented. Target: `src/protocols/halfkay.ts`.

## Caterina (AVR109/STK500v2) — P1

Not yet implemented. Target: `src/protocols/caterina.ts`.

## UF2 / PICOBOOT (RP2040) — P2, deferred

Not yet implemented. Target: `src/protocols/uf2-picoboot.ts`.
