# QMK Browser Flasher

A browser-based tool for flashing compiled QMK firmware (`.bin`/`.hex`/`.uf2`)
to a keyboard's microcontroller using WebUSB/WebHID, without a native app like
QMK Toolbox. Chromium-based browsers only (Chrome/Edge/Brave) — see
[`plan.md`](plan.md) for full scope, architecture, and milestones.

**Status**: STM32 DfuSe boards (e.g. NuPhy Air75 V2) and RP2040 boards over
its PICOBOOT USB interface (e.g. Adafruit MacroPad RP2040) can both be
flashed end-to-end, verified on real hardware — see
[`docs/SUPPORTED_BOARDS.md`](docs/SUPPORTED_BOARDS.md) for what's been
tested and [`docs/SAFETY.md`](docs/SAFETY.md) for bricking risk and
recovery. HalfKay/Teensy and Caterina/AVR109 support are planned but
blocked on hardware to test against (see `plan.md` §7).

## Development

```sh
npm install
npm run dev         # start the Vite dev server
npm run build       # typecheck + production build
npm run test        # run the test suite once
npm run test:watch  # run tests in watch mode
npm run lint        # lint with ESLint
npm run typecheck   # tsc --noEmit
```

WebUSB/WebHID require a secure context; `npm run dev` serves over
`localhost`, which browsers treat as secure.

## Project layout

See [`plan.md`](plan.md) Section 4 for the full module breakdown, and
[`docs/`](docs/) for supported-board, protocol, and safety notes as they're
written.

## License

MIT — see [`LICENSE`](LICENSE). Third-party notices are tracked in
[`docs/THIRD_PARTY_NOTICES.md`](docs/THIRD_PARTY_NOTICES.md).
