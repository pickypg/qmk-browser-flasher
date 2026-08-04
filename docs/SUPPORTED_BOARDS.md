# Supported Boards

| Board           | Protocol      | Chip         | Bootloader entry                 |
| --------------- | ------------- | ------------ | --------------------------------- |
| NuPhy Air75 V2  | `stm32-dfu`   | STM32F072xB  | Hold `Esc` while connecting USB   |

Chip/bootloader data (`src/chip-db/chips.json`, `src/board-db/boards.json`)
for the Air75 V2 was sourced from the locally-checked-out
`nuphy-qmk-firmware` repo (a QMK fork, GPL-2/3 — facts only, no code
copied): `keyboards/nuphy/air75_v2/ansi/keyboard.json` for the processor/
bootloader/app-mode USB IDs, and `platforms/chibios/mcu_selection.mk` +
the `STM32F072xB.ld` linker script for flash size/address. See
`docs/PROTOCOL_NOTES.md` for the STM32 DfuSe protocol details.

Verified against real hardware (2026-08-04): a NuPhy Air75 V2 running
custom QMK firmware was successfully re-flashed end-to-end (erase,
program, readback-verify, reboot into the new firmware) via this tool's
dev build.

Note: the bootloader-mode USB ID (`0483:DF11`) is ST's generic factory
bootloader identity, shared by *any* STM32 DFU-bootloader board — not
specific to NuPhy. Other STM32-based QMK boards using the same
`stm32-dfu` bootloader type likely work with this tool already, but only
the Air75 V2 has been verified so far.

No AVR, HalfKay, Caterina, or UF2/PICOBOOT boards are supported yet — see
`docs/PROTOCOL_NOTES.md` for research already done on AVR DFU ahead of
that milestone.
