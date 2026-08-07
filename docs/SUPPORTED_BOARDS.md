# Supported Boards

Any board using ST's `stm32-dfu` factory bootloader should work with this
tool automatically — chip parameters (flash address/size/page size) are
read live from the device itself (see `docs/PROTOCOL_NOTES.md`), not
looked up from per-board data. Likewise, any RP2040-based board should
work over `uf2-picoboot` automatically — its flash layout is
architectural, not per-chip, so there's nothing to look up there either.
`src/board-db/boards.json` below is a reference list of boards this has
actually been checked against, plus their bootloader-entry instructions —
not a required allowlist.

Bootloader-entry instructions can't be detected from WebUSB alone (it
only ever sees a device already in bootloader mode), but the UI has an
opt-in "Detect my keyboard" button that uses WebHID instead, matching
the board's own USB IDs while it's running normally. That needs a board
to have its `hidVendorId`/`hidProductId` populated in `boards.json`,
which today is just the NuPhy Air75 V2 — Keychron K1 Pro ships in four
VID/PID variants (ANSI/ISO × RGB/White) and none has been verified
against real hardware, so none is guessed.

| Board            | Protocol    | MCU          | Bootloader entry                 | Verified on real hardware |
| ----------------- | ----------- | ------------ | --------------------------------- | --------------------------- |
| NuPhy Air75 V2    | `stm32-dfu` | STM32F072xB  | Hold `Esc` while connecting USB\* | Yes (2026-08-04)            |
| Keychron K1 Pro   | `stm32-dfu` | STM32L432    | Reset button under the spacebar   | Not yet                     |
| Adafruit MacroPad RP2040 | `uf2-picoboot` | RP2040 | Double-press the reset button on the side† | Yes (2026-08-06) |

\* The Air75 V2 also has a physical reset button under the Caps Lock
switch, confirmed via real-hardware disconnect testing — useful as a
fallback since the Esc trick is a software check in the application
firmware and can be temporarily unreachable right after an interrupted
flash (see `docs/SAFETY.md`). Only Esc is exposed in the UI's
instructions today; `BootloaderEntryMethod` only models one method per
board currently.

† The MacroPad RP2040 also enters the bootloader by holding the rotary
encoder's push-button on power-up, or via bootmagic/the `QK_BOOT` keycode
if mapped — same `BootloaderEntryMethod`-only-models-one-method
limitation as above, so only the reset-button method is shown in the UI.
Board data (USB IDs, processor, bootloader entry) sourced from
`qmk_firmware`'s own `keyboards/adafruit/macropad/keyboard.json` and
`readme.md` upstream (GPL-2/3 — facts only, no code copied), not a fork
this time since the board is supported directly in mainline QMK.

Board/bootloader-entry facts sourced from the locally-checked-out
`nuphy-qmk-firmware` and `keychron-qmk-firmware` repos (QMK forks,
GPL-2/3 — facts only, no code copied):
`keyboards/nuphy/air75_v2/ansi/keyboard.json` and
`keyboards/keychron/k1_pro/info.json` for processor/bootloader, and
(Air75 V2 only, before live detection was added) `platforms/chibios/
mcu_selection.mk` + `STM32F072xB.ld` for flash size/address.

Note: in bootloader mode, *every* STM32 board enumerates under the same
generic ST bootloader ID (`0483:DF11`), and every RP2040 board under the
same generic `2E8A:0003` — there is no way to tell from USB alone which
specific board is connected, so the paired-device display shows the
bootloader's own generic name rather than guessing a board name from this
list.

No AVR, HalfKay, or Caterina boards are supported yet — see
`docs/PROTOCOL_NOTES.md` for research already done on AVR DFU ahead of
that milestone.
