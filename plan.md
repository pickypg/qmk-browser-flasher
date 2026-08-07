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
- Not supporting RP2040's mass-storage (`.uf2` drag-and-drop) bootloader
  path at all — not reachable from a browser. RP2040 support (M6) instead
  targets its separate PICOBOOT USB interface, WebUSB-reachable like the
  DFU/HID protocols targeted first.

## 3. Target Bootloader Protocols (in priority order)

| Protocol                     | Transport                         | Priority | Notes                                                                                                                                                                                              |
| ----------------------------- | --------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| STM32 DfuSe (ST factory bootloader) | WebUSB                      | —        | Not in the original priority list, but implemented first (M1) since it's the only protocol testable against real hardware (NuPhy Air75 V2, STM32F072). Standard USB DFU 1.1 + ST's AN3156 extension. |
| AVR DFU (Atmel/LUFA)       | WebUSB                            | P0       | Most common on classic AVR QMK boards; reference implementation exists (webdfu, JS — will need a TS port/rewrite) |
| HalfKay (Teensy)           | WebHID                            | P0       | Simple fixed-packet HID protocol, good first target                                                               |
| Caterina (AVR109/STK500v2) | WebSerial                         | P1       | Serial-based, not USB control transfers — different API                                                           |
| UF2 / PICOBOOT (RP2040)    | WebUSB (PICOBOOT)                 | P2       | Implemented (M6) — mass-storage half of the pair (drag-and-drop `.uf2`) turned out not to matter once PICOBOOT covered the WebUSB path |

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
   Verified end-to-end on real hardware 2026-08-04. Its chip-parameter
   lookup was later replaced with live on-device detection (reading the
   DfuSe memory-layout USB string descriptor instead of a per-board data
   table) after adding a second board exposed a real bug: every ST DFU
   bootloader shares the same generic USB ID, so a second per-chip
   data-table entry keyed by that ID would silently collide with the
   first and apply the wrong chip's page size. Firmware-format support
   was extended 2026-08-05 to Intel HEX (`.hex`) alongside `.bin` —
   unlike `.bin`, a `.hex` file declares its own base address per record,
   which is now cross-checked against `stm32-dfu.ts`'s
   `STM32_FLASH_BASE` before flashing, a validation `.bin` never had
   anything to check against. Verified against a real `.hex`/`.bin` pair
   from the same build (byte-for-byte identical once gaps were filled
   with `0x00`, matching what `arm-none-eabi-objcopy` itself does — an
   initial `0xFF`/"erased flash" assumption was wrong). A related finding
   — the reference `.bin` carries a 16-byte `dfu-util` DFU suffix, which
   was being flashed along with the real firmware since the `.bin` path
   had no suffix awareness — was fixed the same day: `findDfuSuffix`
   (`src/core/firmware-parser/dfu-suffix.ts`) detects, CRC32-validates
   (catching a corrupted/truncated download before it ever reaches the
   device), and strips a real suffix before flashing. See
   `docs/PROTOCOL_NOTES.md` for the verified byte layout and CRC32
   variant (empirically confirmed, not assumed).
3. **M2 — HalfKay support**: same happy-path flow for a Teensy-based
   board. Blocked: no Teensy/HalfKay hardware available to test against.
4. **M3 — Bootloader-entry UX** ✅: reset-button/magic-key instructions
   (informational only — WebUSB alone can only ever see a device already
   in DFU mode, so entry itself can't be automated or detected that way)
   plus the `board-db` lookup backing them. Shipped 2026-08-05 alongside a
   broader UI pass (dark theme, drag/drop firmware upload, live
   phase-based progress bar, step-log table) — see `docs/PROTOCOL_NOTES.md`.
   Extended 2026-08-05 with two opt-in detection paths that preselect the
   right instructions without waiting on a manual pick: a "Detect my
   keyboard" button (WebHID — a board's own USB IDs are specific enough to
   identify it while running normally, unlike the shared DFU-mode ID; a
   separate permission grant from pairing, so it's gated behind an
   explicit click rather than prompting automatically), and passive
   detection straight from a dropped-in firmware file (compiled firmware
   embeds its own USB device descriptor as literal bytes — confirmed
   empirically against a real build; see `docs/PROTOCOL_NOTES.md`), which
   also now warns (advisory, non-blocking) if the loaded firmware doesn't
   match the selected board.
5. **M4 — Caterina/WebSerial support**. Blocked: no AVR109/Caterina
   hardware available to test against.
6. **M5 — Hardening** ✅: error recovery on mid-flash disconnect
   (`watchForDisconnect` + a retry-capable error screen), wider
   chip-parameter coverage (non-uniform-sector-size test coverage; no F4
   hardware to verify against beyond that), safety docs (`docs/SAFETY.md`
   rewritten with a per-protocol bricking-risk table). Shipped
   2026-08-05. A real regression was found and fixed via the user's own
   live disconnect testing during this milestone, not hypothesized:
   erase and write had been batched (erase everything, then write
   everything) purely to collapse a step-log row count, which widened the
   window where an interrupted flash could leave a board's software
   bootloader-entry trigger (e.g. a magic-key check, itself part of the
   application firmware) erased with nothing rewritten yet. Fixed by
   interleaving erase+write per chunk again, validated twice on real
   hardware (once requiring the board's physical reset button before the
   fix, once with the software trigger still working after the fix).
7. **M6 (stretch)** — UF2/RP2040 support ✅: unblocked once the user had
   real RP2040 hardware to test against (an Adafruit MacroPad RP2040).
   Targets RP2040's **PICOBOOT** USB interface over WebUSB — the same one
   `picotool` talks to — rather than the mass-storage `.uf2` drag-and-drop
   path QMK Toolbox uses, since Chrome has no API for writing into an
   arbitrary mounted mass-storage volume. Protocol facts (command struct,
   status codes, the exclusive-access/exit-XIP ordering requirement,
   flash/write alignment constants) were verified against
   `raspberrypi/pico-sdk`'s and `raspberrypi/picotool`'s own source
   (BSD-3-Clause, facts only — same citation discipline as the
   `dfu-util`/`dfu-programmer` citations elsewhere in this project), not
   guessed. Architecturally simpler than `stm32-dfu` in one respect —
   RP2040's flash layout (base address, sector/page size) is fixed rather
   than read live, so there's no per-chip memory-layout descriptor to
   parse — but genuinely new in another: this is the first time two
   protocols with different flash address spaces have coexisted, so
   `main.ts` gained an explicit firmware/device address-space mismatch
   check that couldn't have mattered before. Also added: `.uf2` file
   parsing (`src/core/firmware-parser/uf2.ts`, block-format validation
   against `microsoft/uf2`'s spec) and a `raspberrypi/usb-pid`-confirmed
   generic RP2040 bootloader ID (`2E8A:0003`) alongside STM32's in
   `device-picker.ts`. Board data for the Adafruit MacroPad RP2040
   (`board-db/boards.json`) sourced directly from upstream
   `qmk_firmware`'s `keyboards/adafruit/macropad`, not a fork this time.
   A known, accepted gap: unlike `stm32-dfu`, this doesn't query the
   device's actual physical flash size before writing (PICOBOOT has no
   simple command for it) — an oversized image fails with a real protocol
   error instead of a pre-flight message; see `docs/SAFETY.md`. Landed
   2026-08-06 with full unit-test coverage against a simulated PICOBOOT
   device (`test/protocols/uf2-picoboot.test.ts`,
   `test/core/firmware-parser/uf2.test.ts`) and confirmed end-to-end on
   the user's real MacroPad RP2040 the same day.

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
