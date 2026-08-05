# Supported Boards

Any board using ST's `stm32-dfu` factory bootloader should work with this
tool automatically — chip parameters (flash address/size/page size) are
read live from the device itself (see `docs/PROTOCOL_NOTES.md`), not
looked up from per-board data. `src/board-db/boards.json` below is a
reference list of boards this has actually been checked against, plus
their bootloader-entry instructions — not a required allowlist.

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

\* The Air75 V2 also has a physical reset button under the Caps Lock
switch, confirmed via real-hardware disconnect testing — useful as a
fallback since the Esc trick is a software check in the application
firmware and can be temporarily unreachable right after an interrupted
flash (see `docs/SAFETY.md`). Only Esc is exposed in the UI's
instructions today; `BootloaderEntryMethod` only models one method per
board currently.

Board/bootloader-entry facts sourced from the locally-checked-out
`nuphy-qmk-firmware` and `keychron-qmk-firmware` repos (QMK forks,
GPL-2/3 — facts only, no code copied):
`keyboards/nuphy/air75_v2/ansi/keyboard.json` and
`keyboards/keychron/k1_pro/info.json` for processor/bootloader, and
(Air75 V2 only, before live detection was added) `platforms/chibios/
mcu_selection.mk` + `STM32F072xB.ld` for flash size/address.

Note: in DFU mode, *every* STM32 board enumerates under the same generic
ST bootloader ID (`0483:DF11`) — there is no way to tell from USB alone
which specific board is connected, so the paired-device display shows the
bootloader's own generic name rather than guessing a board name from this
list.

No AVR, HalfKay, Caterina, or UF2/PICOBOOT boards are supported yet — see
`docs/PROTOCOL_NOTES.md` for research already done on AVR DFU ahead of
that milestone.
