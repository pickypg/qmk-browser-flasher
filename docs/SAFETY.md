# Safety

Flashing firmware directly to a keyboard's microcontroller carries a real
risk of bricking the device if interrupted or given a malformed image. This
document tracks the safeguards this project relies on, what they actually
cover, and what they don't — kept current as each protocol is implemented
and tested against real hardware, not written speculatively up front.

## Verification policy

- Every flash writes, then reads the same range back and byte-compares it
  (`src/core/verify.ts`'s `verifyFlash`) before reporting success —
  `flashStm32Dfu` (`src/protocols/stm32-dfu.ts`) always does this, and
  reports `ok: false` honestly on a mismatch rather than treating "the
  writes didn't error" as success.
- The "flash" action is gated behind an explicit confirmation checkbox in
  the UI ("I understand this will erase and overwrite the keyboard's
  firmware") before the flash button is enabled.
- What verification does **not** cover: whether the firmware file itself is
  correct or intended for this specific board. The tool checks that it fits
  within the detected flash size, and — since 2026-08-05 — scans the file
  for its own embedded USB device descriptor (`src/core/firmware-parser/
  usb-descriptor.ts`) to show an advisory warning if it looks like it's for
  a different board than the one selected. This is a heuristic byte-pattern
  scan over a raw binary, not a real container format with a checksum, so
  it's silent (no false alarm) whenever detection is ambiguous — it
  reduces this risk, it doesn't eliminate it, and it never blocks
  flashing.

## Bricking risk by protocol

Bricking risk depends on where a chip's bootloader physically lives
relative to the flash region a protocol writes to — this is chip/protocol
architecture, not something this tool controls, so it's tracked per
protocol rather than claimed as a blanket guarantee.

| Protocol             | Bricking risk from this tool | Why |
| --------------------- | ----------------------------- | --- |
| `stm32-dfu`            | Low                            | The ST DFU bootloader lives in a separate system memory region (~`0x1FFFxxxx`), not in the application flash region this tool writes to (`0x08000000`+). A botched or interrupted flash can't corrupt the bootloader itself — **the chip's ROM bootloader is always intact**. This is a property of STM32's bootloader design specifically. |
| `avr-dfu` / `halfkay` / `caterina` / `uf2-picoboot` | Not yet researched | Not implemented yet (see `plan.md` §7) — bootloader/flash layout for these hasn't been investigated, so no claim is made either way. Update this row when each one ships. |

### The chip's bootloader being intact isn't the same as being able to *reach* it

Found via real hardware testing, 2026-08-05: the ROM bootloader itself
being safe doesn't mean the documented way of *entering* it survives an
interrupted flash — that depends on the specific board's
`bootloaderEntry` mechanism (`src/board-db/boards.json`):

- **`reset-button`**: hardware-level, independent of anything in
  application flash. Unaffected by this risk.
- **`magic-key`** (e.g. the NuPhy Air75 V2's hold-Esc-while-plugging-in):
  implemented in QMK's `bootmagic`, which runs as part of the
  *application* firmware's own early startup code. If a flash operation
  is interrupted after erasing the page(s) containing the vector
  table/early boot code but before rewriting them, that code — including
  the magic-key check itself — is gone until reflashed. The chip's DFU
  bootloader is still there, but nothing is left to trigger jumping into
  it via software.
- **`hid-command`**: same category as `magic-key`, arguably more fragile
  — depends on more of the application (USB/HID stack, command handling)
  surviving intact, not just an early matrix read.

**Mitigation**: `flashStm32Dfu` erases and writes each chunk together —
erase the page(s) it needs, then immediately write it — rather than
erasing everything the image needs up front and writing afterward. This
keeps the "erased but not yet rewritten" window to at most one chunk
instead of the whole image. It does not eliminate the risk: an
interruption during the very first chunk can still leave the vector table
erased with nothing rewritten yet. For a `magic-key`/`hid-command` board,
recovery in that specific case means a hardware-level fallback (a
physical reset/BOOT0 path) if the board has one — check the board's own
documentation, since this tool can't discover or use one automatically.

## Every failure is safe to retry from scratch

This part holds for every protocol here, not just `stm32-dfu`, because it
follows from the write sequence itself: each flash page is erased
immediately before it's rewritten, so a page is never left in a mixed
old/new state. Concretely:

- **A verification mismatch** (readback didn't match what was written):
  re-flashing writes and re-erases every page again — nothing from the
  failed attempt carries over.
- **A mid-flash disconnect**: the UI tries to detect this specifically (via
  WebUSB's `disconnect` event, `watchForDisconnect` in
  `src/core/device-picker.ts`) and show a "keyboard disconnected" screen
  with a one-click path back to pairing, rather than a raw protocol error.
  This is best-effort, not guaranteed — confirmed on real hardware that a
  disconnect can surface as an ordinary transfer failure (e.g. a stall)
  before the `disconnect` event fires, so the generic error screen can
  show instead. Either way, whatever partial state the flash was left in,
  restarting from scratch is safe for the same erase-before-write reason
  above.
- **A protocol error mid-flash** (e.g. an unexpected DFU status): also
  safe to retry, same reasoning — nothing was left half-written that a
  fresh attempt won't overwrite anyway.

## Known open risks

- **Windows WinUSB driver requirement**: DFU devices on Windows may need a
  Zadig-based driver swap; not solvable purely in-browser (see `plan.md`
  Section 9).
- **Firmware/board mismatch**: see "What verification does not cover"
  above — partially mitigated by the advisory warning, but ultimately
  still on the user, since the warning is heuristic and never blocks.
