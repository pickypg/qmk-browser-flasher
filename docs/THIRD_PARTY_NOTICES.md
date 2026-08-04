# Third-Party Notices

This project is MIT-licensed. It references, and in some cases may adapt,
protocol implementations and data from other projects. Each entry below
lists what was used, from where, and under what license — updated as
dependencies and ported code are added (see `plan.md` Section 8).

## npm dependencies

Runtime and dev dependencies are enumerated in `package.json` /
`package-lock.json`. Full license texts can be regenerated at any time with:

```sh
npx license-checker --production --summary
```

_(No dependency license audit has been run yet — this project has not left
M0 scaffolding.)_

## Reference implementations

None of the projects below have had any code copied into this repository.
Each was read only to confirm wire-protocol facts (command bytes, USB
IDs, memory layout) that are independently reimplemented in TypeScript —
see the "Status" column and `docs/PROTOCOL_NOTES.md` for what was
verified from each.

| Project           | Used for                                   | License              | Status                                                                                     |
| ------------------ | ------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------- |
| `dfu-util`         | STM32 DfuSe command bytes (`src/dfuse.c`)   | GPL-2.0                | Consulted for M1 (`src/protocols/stm32-dfu.ts`) — facts only, no code copied                |
| `nuphy-qmk-firmware` | NuPhy Air75 V2 chip/board data              | GPL-2/3 (QMK fork)     | Consulted for M1 (`src/chip-db/chips.json`, `src/board-db/boards.json`) — data only          |
| `dfu-programmer`   | Atmel AVR DFU command bytes (`src/atmel.c`) | GPL-2.0                | Consulted ahead of the AVR DFU milestone (not yet implemented) — facts only, no code copied |
| `webdfu`           | AVR DFU protocol reference (original plan)  | ISC                    | Not yet used — AVR DFU milestone not started                                                |
| QMK Firmware       | General chip/board parameter reference      | Mixed (GPLv2/MIT/BSD/Apache, per-file) | Consulted via the `nuphy-qmk-firmware` fork so far; upstream `qmk_firmware` not yet used directly |

## Per-file attribution

Any module that is a substantial port/adaptation of copyleft code will carry
a header comment citing the original project, file, and license, in
addition to the entry above. `src/protocols/stm32-dfu.ts` carries a
comment citing `dfu-util`/AN3156 per this policy, even though no code was
copied, since the command bytes were cross-checked against it.
