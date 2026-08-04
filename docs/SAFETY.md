# Safety

Flashing firmware directly to a keyboard's microcontroller carries a real
risk of bricking the device if interrupted or given a malformed image. This
document tracks the safeguards this project relies on, and their current
status.

## Verification policy

- Every flash operation must be followed by a readback/checksum verification
  step (`src/core/verify.ts`) before reporting success. Not yet implemented.
- The "flash" action is intended to be gated behind an explicit confirmation
  step given the bricking risk (see `plan.md` Section 9) — not yet decided.

## Known risks

- **Mid-flash disconnect**: recovery behavior not yet designed (planned for
  M5 — see `plan.md` Section 7).
- **Windows WinUSB driver requirement**: DFU devices on Windows may need a
  Zadig-based driver swap; not solvable purely in-browser (see `plan.md`
  Section 9).

This document will grow with concrete recovery steps as each protocol is
implemented and tested against real hardware.
