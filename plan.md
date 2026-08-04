# QMK Browser Flasher — Project Plan

## 1. Goal

Build a browser-based tool, written in TypeScript (Chromium-only: Chrome/Edge/Brave
on macOS, Linux, and — with driver caveats — Windows) that takes a compiled QMK
firmware file (`.bin`/`.hex`/`.uf2`) and flashes it directly to a keyboard's
microcontroller using WebUSB/WebHID/WebSerial, without requiring a native app
like QMK Toolbox.

## 2. Non-Goals (v1)

- Not replacing QMK Configurator's compile step — this project assumes a
  firmware file already exists (downloaded from config.qmk.fm or built
  locally via `qmk compile`).
- Not supporting Firefox or Safari (no WebUSB/WebHID support).
- Not attempting full QMK Toolbox parity (no serial console/debug log
  viewer, no audio device tooling) in v1.
- UF2/RP2040 mass-storage-style bootloaders deferred to a later phase —
  significantly different transfer model (PICOBOOT) from the DFU/HID
  protocols targeted first.

## 3. Target Bootloader Protocols (in priority order)

| Protocol                     | Transport                         | Priority | Notes                                                                                                                                                                                              |
| ----------------------------- | --------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| STM32 DfuSe (ST factory bootloader) | WebUSB                      | —        | Not in the original priority list, but implemented first (M1) since it's the only protocol testable against real hardware (NuPhy Air75 V2, STM32F072). Standard USB DFU 1.1 + ST's AN3156 extension. |
| AVR DFU (Atmel/LUFA)       | WebUSB                            | P0       | Most common on classic AVR QMK boards; reference implementation exists (webdfu, JS — will need a TS port/rewrite) |
| HalfKay (Teensy)           | WebHID                            | P0       | Simple fixed-packet HID protocol, good first target                                                               |
| Caterina (AVR109/STK500v2) | WebSerial                         | P1       | Serial-based, not USB control transfers — different API                                                           |
| UF2 / PICOBOOT (RP2040)    | WebUSB (PICOBOOT) or mass-storage | P2       | Deferred; most complex, least standardized across vendors                                                         |

## 4. Architecture / Module Breakdown

```
qmk-browser-flasher/
├── src/
│   ├── core/
│   │   ├── device-picker.ts       # navigator.usb/hid.requestDevice wrapper, pairing UI hooks
│   │   ├── bootloader-detect.ts   # identify which protocol a connected device speaks
│   │   ├── firmware-parser/
│   │   │   ├── intel-hex.ts       # .hex parsing
│   │   │   ├── bin.ts             # raw .bin handling
│   │   │   └── uf2.ts             # (phase 2)
│   │   └── verify.ts              # post-write readback + checksum
│   ├── protocols/
│   │   ├── avr-dfu.ts             # DFU DNLOAD/GETSTATUS/ERASE/MANIFEST state machine
│   │   ├── halfkay.ts             # Teensy HID protocol
│   │   ├── caterina.ts            # AVR109/STK500v2 over WebSerial
│   │   └── uf2-picoboot.ts        # (phase 2)
│   ├── types/
│   │   └── index.ts               # shared interfaces: FlashableDevice, Protocol, ChipParams, BoardEntry, etc.
│   ├── chip-db/
│   │   └── chips.json             # per-MCU flash size, page size, memory offsets
│   ├── board-db/
│   │   └── boards.json            # per-board bootloader-entry method (reset button, magic key, HID command)
│   └── ui/
│       ├── flow.ts                # step-by-step flash flow / state machine
│       └── components/            # picker, progress bar, error/recovery screens
├── test/
│   ├── protocols/                 # unit tests against mocked USB/HID devices
│   └── fixtures/                  # sample .hex/.bin files for known boards
├── docs/
│   ├── SUPPORTED_BOARDS.md
│   ├── PROTOCOL_NOTES.md          # per-protocol implementation notes / spec links
│   ├── SAFETY.md                  # bricking risks, verification policy, disclaimers
│   └── THIRD_PARTY_NOTICES.md     # licenses for dependencies + ported/referenced code
├── tsconfig.json
├── LICENSE
├── PLAN.md                        # this file
└── README.md
```

## 5. Rough Effort Estimate (from prior discussion)

| Piece                                      | Est. lines        | Notes                                                                   |
| ------------------------------------------ | ----------------- | ----------------------------------------------------------------------- |
| Device pairing/permission UI               | 50–150            | Straightforward `requestDevice()` wrapper                               |
| AVR DFU protocol                           | 300–600           | Reference: webdfu (~<1000 total incl. UI)                               |
| HalfKay protocol                           | 150–300           | Simplest of the three P0/P1 protocols                                   |
| Caterina protocol                          | 300–500           | Requires WebSerial, not WebUSB/WebHID                                   |
| Bootloader-entry handling                  | 100–300           | Reset prompts + magic-key/board lookup table                            |
| Chip-parameter table                       | data, not logic   | Page size, flash size, offsets per MCU — sourced from QMK's own configs |
| Verification (readback/checksum)           | 100–200           | Not optional — this is how bricking gets avoided                        |
| Shared infra (detection, parsing, retries) | 300–500           |                                                                         |
| **Happy-path total (P0 only)**             | **~1,200–2,500**  | Works for tested boards on the happy path                               |
| **Robust / production-quality total**      | **~3,000–5,000+** | Adds edge cases, failure recovery, wider chip coverage                  |

## 6. TypeScript Notes

- `strict: true` in `tsconfig.json` from the start — protocol code deals in
  raw byte buffers and fixed-size packets, where type-checked offsets/lengths
  catch a real class of bugs before they hit hardware.
- Declare shared domain types up front in `src/types/index.ts`
  (`FlashableDevice`, `Protocol`, `ChipParams`, `BoardEntry`, `FlashResult`,
  etc.) so protocol modules and UI code share one contract.
- `chips.json` / `boards.json` stay as JSON data files, but should be typed
  via `resolveJsonModule` (or loaded and validated into typed objects at
  startup) rather than treated as `any`.
- WebUSB/WebHID/WebSerial don't have official TS lib types bundled with
  TypeScript itself — pull in community `@types` packages or vendor a
  `.d.ts` for these APIs as part of M0.

## 7. Milestones

1. **M0 — Repo scaffold & tooling** ✅: package.json, tsconfig.json (strict
   mode on), bundler (Vite recommended for WebUSB/HID demo apps, has
   first-class TS support), `@types/w3c-web-usb` / `@types/w3c-web-hid` and
   Web Serial API type declarations, lint/test setup, empty module stubs
   matching the tree above, `LICENSE` file, and a starter
   `docs/THIRD_PARTY_NOTICES.md` (see Section 8).
2. **M1 — STM32 DfuSe happy path** ✅: pair with a device already in DFU
   mode, parse a `.bin`, flash a NuPhy Air75 V2 (STM32F072), verify via
   readback. Retargeted from the originally-planned AVR DFU happy path
   since the Air75 V2 was the hardware actually available to test against
   — see the STM32 DfuSe row added to Section 3 and `docs/PROTOCOL_NOTES.md`.
   Verified end-to-end on real hardware 2026-08-04.
3. **M2 — HalfKay support**: same happy-path flow for a Teensy-based board.
4. **M3 — Bootloader-entry UX**: reset-button instructions + magic-key jump
   where supported, board lookup table.
5. **M4 — Caterina/WebSerial support**.
6. **M5 — Hardening**: error recovery on mid-flash disconnect, wider
   chip-parameter coverage, safety docs.
7. **M6 (stretch)** — UF2/RP2040 support.

## 8. Licensing & Attribution

This project touches other people's code and protocol work at several
points, so license hygiene needs to be handled deliberately, not
after-the-fact.

- **Project license**: pick and commit a `LICENSE` file at repo root before
  any code lands (M0). QMK Firmware itself is licensed mostly under GPLv2,
  with some code under MIT, Modified BSD, Apache, and GPLv3 — if this tool
  references, adapts, or links against any QMK source (e.g. chip/board
  parameter values pulled from `qmk_firmware`'s config files), the license
  of the _originating_ files must be checked individually rather than
  assumed, since QMK is multi-licensed internally.
- **Third-party reference implementations**: `webdfu` (referenced in
  Section 5 as a starting reference for the AVR DFU protocol) has its own
  license — confirm it before porting or adapting any of its logic into
  `src/protocols/avr-dfu.ts`, and carry its copyright notice forward in that
  file's header if terms require attribution, per its license.
- **Per-file attribution**: any module that is a substantial port/adaptation
  of GPLv2 (or other copyleft) code — e.g. protocol state machines lifted
  from QMK Toolbox, `qmk_firmware`, or `webdfu` — gets a header comment
  citing the original project, file, and license, not just a blanket
  mention in the README.
- **chip-db / board-db data**: if `chips.json` / `boards.json` values are
  derived from QMK's own `rules.mk`/`config.h` data (flash size, page size,
  bootloader type per board), note the source and QMK's license in
  `docs/SUPPORTED_BOARDS.md`, since this is derived data, not independently
  authored.
- **THIRD_PARTY_NOTICES.md**: maintain a running notices file in `docs/`
  that lists every dependency and reference implementation used, alongside
  its license — covers both npm dependencies (via `license-checker` or
  similar, run in CI) and any hand-ported protocol code.
- **GPLv2 copyleft implications**: if any GPLv2-licensed code is
  incorporated directly (not just referenced for protocol understanding),
  confirm whether that requires this project's own license to be
  GPLv2-compatible — this is a decision to make explicitly at M0, not
  something to discover after writing protocol code.

## 9. Open Risks / Decisions to Revisit

- Windows WinUSB driver requirement for DFU devices — v1 may need to
  document a Zadig-based workaround rather than solve it in-browser.
- How much per-board metadata to maintain vs. relying on user-supplied
  chip/bootloader selection.
- Whether to gate "flash" as a genuinely irreversible action behind an
  extra confirmation step, given bricking risk.
