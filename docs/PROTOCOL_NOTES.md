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

Reference chip data (`stm32f072xb` in `src/chip-db/chips.json`), sourced
from the locally-checked-out `nuphy-qmk-firmware` repo (a QMK fork,
GPL-2/3 — data only, no code copied): `platforms/chibios/mcu_selection.mk`
sets `MCU_LDSCRIPT = STM32F072xB`, and that linker script
(`lib/chibios/os/common/startup/ARMCMx/compilers/GCC/ld/STM32F072xB.ld`)
places `flash0` at `0x08000000` with `len = 128k`. The bootloader lives in
separate ROM (`STM32_BOOTLOADER_ADDRESS = 0x1FFFC800`), so there's no
bootloader carve-out in flash — the full 128 KB is application-writable.

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
