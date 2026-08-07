# Protocol Notes

Per-protocol implementation notes and spec references, filled in as each
protocol is implemented (see `plan.md` Section 3 for priority order).

## Firmware file formats

`.bin` (`src/core/firmware-parser/bin.ts`) and `.hex`/Intel HEX
(`src/core/firmware-parser/intel-hex.ts`) are both accepted. Both parsers
are intentionally **protocol-agnostic** — they know nothing about STM32
or any other chip, just the file format itself, returning a plain
`FirmwareImage {bytes, startAddress}`. A `.bin` has no embedded address at
all (`main.ts` supplies `STM32_FLASH_BASE` as its `startAddress`, since
that's the only protocol implemented so far), while `.hex` declares its
own via Extended Linear/Segment Address records — real example confirmed
locally: `:020000040800F2` → upper 16 bits `0800` → base `0x08000000`,
exactly STM32's flash base. `main.ts` cross-checks a parsed `.hex`'s
`startAddress` against `stm32-dfu.ts`'s exported `STM32_FLASH_BASE` and
rejects a mismatch with a clear error — that check belongs in `main.ts`
(the STM32-specific caller), not the parser, since a future non-STM32
protocol could legitimately have a different base address.

Gaps between Intel HEX data records are filled with **`0x00`, not
`0xFF`** — confirmed by parsing a real `.hex`/`.bin` pair from the same
build (`nuphy-qmk-firmware`'s `claude_test` target) and diffing the
result: zero byte differences once `0x00` was used, versus mismatches at
`0xFF`. This matches what `arm-none-eabi-objcopy -O binary` itself
zero-fills between ELF sections — an "erased flash is 0xFF" assumption
would have been wrong here.

Also found via that same diff: the reference `.bin` was 16 bytes longer
than the `.hex`-derived image, all in a trailing block starting with the
ASCII bytes `"UFD"`. That's `dfu-util`'s `dfu-suffix` tool, run only on
the `.bin` build target (`nuphy-qmk-firmware`'s
`builddefs/common_rules.mk`) — it appends a 16-byte DFU suffix (VID/PID/
CRC metadata for command-line `dfu-util` users), which is not firmware
content and was never meant to be flashed. The `.hex` build target never
gets one, so excluding it is correct.

**Detected, validated, and stripped as of 2026-08-05**
(`src/core/firmware-parser/dfu-suffix.ts`): `main.ts` no longer flashes
this suffix. `findDfuSuffix` looks for the format (`bcdDevice(2,LE)
idProduct(2,LE) idVendor(2,LE) bcdDFU(2,LE) "UFD" bLength(1)=16
CRC32(4,LE)`), anchored on the `"UFD"` signature and `bLength`, same
"don't guess on an ambiguous anchor" discipline as
`usb-descriptor.ts`/`intel-hex.ts` — most `.bin` files won't have one,
and that's not an error. When found, its CRC32 (over everything but the
CRC field itself) is checked before stripping the 16 bytes — a
corrupted/truncated file now gets caught *before* it ever reaches the
device, which readback verification alone can't do. The CRC32 variant
needed empirical trial: standard poly `0xEDB88320`, init `0xFFFFFFFF`,
but **without** the final inversion most CRC-32 implementations (zlib,
PNG, gzip) apply — confirmed by brute-force matching against the real
embedded CRC value in the same NuPhy `.bin` used throughout this
document. The suffix's VID/PID is the same generic ST bootloader ID as
`usbVendorId`/`usbProductId` elsewhere in this project (not the board's
own), so it's an integrity check only — it doesn't feed the
mismatch-warning logic, which stays on `findUsbDeviceDescriptor`.

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

`BoardEntry` (`src/types/index.ts`) still carries this generic
`usbVendorId`/`usbProductId` pair for reference, but it's a separate
concept from `hidVendorId`/`hidProductId` added for opt-in WebHID board
detection (`src/core/board-detect.ts`): those are the board's own IDs
while running its normal application firmware, specific enough to
actually distinguish boards (unlike the shared bootloader-mode ID
above), and are used only to preselect instructions in the UI — never
for pairing or flashing.

**The same board-specific IDs are also recoverable straight from a
compiled `.bin`**, with no device connected at all: any USB-capable
firmware embeds its own 18-byte USB device descriptor as literal bytes
in flash (`src/core/firmware-parser/usb-descriptor.ts`), since the USB
stack needs that table regardless of protocol. Confirmed empirically
against a real compiled NuPhy Air75 V2 build — `bLength=18,
bDescriptorType=DEVICE, bcdUSB=2.00, maxPacket=64, idVendor=0x19F5,
idProduct=0x3246, bcdDevice=0x0120` — with `bcdDevice` (0x0120 =
"1.2.0") independently matching `keyboard.json`'s `device_version`
field, which rules out a coincidental byte match. `findUsbDeviceDescriptor`
scans for this shape (anchored on `bLength`/`bDescriptorType`, sanity-
checked on `bMaxPacketSize0`/string indices/`bNumConfigurations` to
avoid false positives) and only returns a result when exactly one
distinct candidate is found — used to preselect/cross-check the board in
`board-db` against what's about to be flashed, purely advisory (see
`docs/SAFETY.md`).

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
event reports one combined message per chunk ("Page 0x...", rendered by
the progress bar as "Flashing: Page 0x...") rather than separate
erase/write messages — an earlier version emitted both, which made the
live activity indicator flicker between the two on every chunk, and a
version right after that fixed the flicker but repeated the phase word
("Flashing: Flashing page 0x..."). `current`/`total` track bytes written,
so the number only advances once a chunk's write completes.

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

## UF2 / PICOBOOT (RP2040)

Target: `src/protocols/uf2-picoboot.ts` (WebUSB) and
`src/core/firmware-parser/uf2.ts` (`.uf2` file parsing). Implemented
2026-08-06 against protocol facts verified from source (see citations
below), unit-tested against a simulated PICOBOOT device, and confirmed
end-to-end on real hardware (an Adafruit MacroPad RP2040) the same day —
see M6 in `plan.md`.

QMK Toolbox's RP2040 support works by copying the `.uf2` file onto the
`RPI-RP2` mass-storage drive the ROM bootloader exposes — not reachable
from a browser (no WebUSB/File System Access API path to an arbitrary
mounted mass-storage volume). RP2040's ROM bootloader also exposes a
second, vendor-specific USB interface called **PICOBOOT** — the same one
`picotool` talks to — with direct erase/write/read commands over ordinary
bulk transfers, reachable via WebUSB. That's what's implemented here.

Command bytes, transfer sequencing, and the ordering requirements below
were cross-checked against `raspberrypi/pico-sdk`'s
`src/common/boot_picoboot_headers/include/boot/picoboot.h` (struct
layout, command IDs, status codes) and `raspberrypi/picotool`'s
`picoboot_connection/picoboot_connection.c` + `picoboot_connection_cxx.cpp`
(the actual bulk-transfer flow) — both BSD-3-Clause, **read for
wire-protocol facts only, nothing copied**, same policy as the
`dfu-util`/`dfu-programmer` citations above.

**Bootloader USB ID**: `2E8A:0003` (Raspberry Pi Trading Ltd / "RP2
Boot"), confirmed against `raspberrypi/usb-pid`. Same generic-ID
situation as STM32's `0483:DF11` — every RP2040 board in BOOTSEL mode
enumerates identically, so board identity can't come from this.

**Interface**: vendor-specific (`bInterfaceClass = 0xFF`), exactly two
bulk endpoints (one IN, one OUT) — found by scanning
`device.configuration.interfaces` for that shape, not assumed ordinal,
same discipline as `findDfuInterface`/`findFlashAlternate`.

**Command packet** (`picoboot_cmd`, 32 bytes, all multi-byte fields LE):

```
dMagic(4)=0x431fd10b  dToken(4)  bCmdId(1)  bCmdSize(1)  _unused(2)  dTransferLength(4)  args[16]
```

Command IDs used here: `PC_EXCLUSIVE_ACCESS=0x01` (`args`: `bExclusive`
u8), `PC_REBOOT=0x02` (`dPC(4) dSP(4) dDelayMS(4)`),
`PC_FLASH_ERASE=0x03` (`dAddr(4) dSize(4)`), `PC_WRITE=0x05` (same args
as erase; `dSize == dTransferLength`), `PC_EXIT_XIP=0x06` (no args, no
transfer), `PC_READ=0x84` (same args as erase/write; the high bit set on
a command id means an IN-direction data phase).

**Transfer sequence per command**, confirmed from
`picoboot_connection.c`'s `picoboot_cmd()`: send the 32-byte command via
bulk OUT → if `dTransferLength != 0`, a data phase in the direction the
command id's high bit indicates (bulk IN for `PC_READ`, bulk OUT for
`PC_WRITE`) → then a zero-length **ack in the opposite direction** (bulk
OUT ZLP for IN-shaped commands, bulk IN ZLP for OUT-shaped/no-data
commands).

**Control requests** (vendor/interface recipient, separate from the bulk
command protocol above): `PICOBOOT_IF_RESET = 0x41` (OUT, no data —
clears any stuck state from a previous session; paired with `clearHalt`
on both bulk endpoints first) and `PICOBOOT_IF_CMD_STATUS = 0x42` (IN, 16
bytes: `dToken(4) dStatusCode(4) bCmdId(1) bInProgress(1) pad(6)`) — the
latter isn't used by this implementation (errors are surfaced from the
bulk transfer's own status instead), but is documented here for anyone
extending this to decode a real `picoboot_status` error code.

**Status codes** (`enum picoboot_status`, 0–17): `OK=0`, `UNKNOWN_CMD=1`,
`INVALID_CMD_LENGTH=2`, `INVALID_TRANSFER_LENGTH=3`, `INVALID_ADDRESS=4`,
`BAD_ALIGNMENT=5`, `INTERLEAVED_WRITE=6`, `REBOOTING=7`,
`UNKNOWN_ERROR=8`, `INVALID_STATE=9`, `NOT_PERMITTED=10`,
`INVALID_ARG=11`, `BUFFER_TOO_SMALL=12`, `PRECONDITION_NOT_MET=13`,
`MODIFIED_DATA=14`, `INVALID_DATA=15`, `NOT_FOUND=16`,
`UNSUPPORTED_MODIFICATION=17`.

**Mandatory ordering** — confirmed via `raspberrypi/pico-feedback` issue
#59 and `picoboot::connection`'s constructor/destructor, not obvious from
the header alone: `WRITE` **hangs** if `EXCLUSIVE_ACCESS` wasn't sent
first, and **silently corrupts data with no error** if `EXIT_XIP` wasn't
sent first. Both are session-level — sent once at the start of a flash,
not per chunk (`flashUf2Picoboot`'s `"preparing"` phase).

**Flash addressing**: `dAddr` for `FLASH_ERASE`/`WRITE`/`READ` is the
full XIP address (`0x10000000`+, `RP2040_FLASH_BASE`), not a
flash-relative offset — confirmed via the same pico-feedback issue.

**Constants** (`hardware/flash.h`, `addressmap.h`): `FLASH_SECTOR_SIZE =
4096` (erase granularity — `FLASH_ERASE`'s `dAddr`/`dSize` must both be
sector-aligned/sector-multiples), `FLASH_PAGE_SIZE = 256` (write
granularity, same rule for `WRITE`), `SRAM_END = 0x20042000` (used as the
stack pointer for the post-flash reboot).

**Reboot into the new firmware**: `PC_REBOOT` with `dPC=0` (boot normally
from the flash vector table — not a literal jump address), `dSP=SRAM_END
(0x20042000)`, `dDelayMS=500` — the same form `picotool`'s own
load-and-execute path uses. `PC_REBOOT2` exists and is what current
`picotool` prefers, but needs a `dFlags` enum not defined in `picoboot.h`
itself plus RP2350-era model detection this project has no reason to
carry; classic `PC_REBOOT` is simpler and sufficient for RP2040-only
scope.

**Erase/write chunking**: unlike STM32 (some parts have non-uniform
sector sizes, handled by `planErasePages`), RP2040's sector size is
architecturally uniform, so `flashUf2Picoboot` erases and writes exactly
one `4096`-byte sector per chunk, interleaved (erase immediately followed
by writing that sector), same reasoning as `stm32-dfu.ts` — keeps the
"erased but not yet rewritten" window to at most one sector. The final
chunk of an image not landing on a 256-byte boundary is padded with
`0xFF` (the erased-flash fill value) up to the next page boundary before
`WRITE`, since `WRITE`'s size must be a page multiple; the padding only
ever extends past the real firmware's end within the already-erased
target sector, so it's inert.

**Known scope gap**: PICOBOOT has no simple command to query the
device's actual physical flash size (would require executing code
on-device to read the flash chip's JEDEC ID, which `picotool` does but is
significantly more machinery than STM32's live memory-layout descriptor
string gives for free). This implementation doesn't attempt it — an
oversized image simply fails with a real protocol error instead of a
pre-flight message. Not expected to matter for real QMK-sized firmware on
a 2MB+ Pico-class board.

### UF2 file format

Confirmed against `microsoft/uf2`'s spec/`uf2families.json`. 512-byte
blocks, each:

```
magicStart0(4)=0x0A324655  magicStart1(4)=0x9E5D5157  flags(4)  targetAddr(4)
payloadSize(4)  blockNo(4)  numBlocks(4)  familyID(4)  data(476)  magicEnd(4)=0x0AB16F30
```

Flag `0x00000001` = "not main flash, skip this block"; `0x00002000` =
the `familyID` field is populated (cross-checked against RP2040's family
ID, `0xE48BFF56`, when present — a file tagged for a different family
throws rather than silently flashing the wrong image).
`src/core/firmware-parser/uf2.ts`'s `parseUf2` assembles the flash-bound
blocks into one contiguous `FirmwareImage`, throwing on any gap/overlap
between blocks — real QMK RP2040 builds are a single contiguous image, so
this is a format-sanity check, not a feature.
