# QMK Browser Flasher

A browser-based tool for flashing compiled QMK firmware (`.bin`/`.hex`) to a
keyboard's microcontroller using WebUSB/WebHID, without a native app like QMK
Toolbox. Chromium-based browsers only (Chrome/Edge/Brave) — see
[`plan.md`](plan.md) for full scope, architecture, and milestones.

**Status**: M0 — repo scaffold. No protocol is implemented yet.

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
