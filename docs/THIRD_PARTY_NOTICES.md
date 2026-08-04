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

| Project      | Used for                        | License   | Status                                             |
| ------------ | -------------------------------- | --------- | --------------------------------------------------- |
| webdfu       | AVR DFU protocol reference       | TBD       | Not yet ported — license to be confirmed before use |
| QMK Firmware | Chip/board parameter reference   | Mixed (GPLv2/MIT/BSD/Apache, per-file) | Not yet consulted — data will be sourced and cited per-file when `chip-db`/`board-db` are populated |

## Per-file attribution

Any module that is a substantial port/adaptation of copyleft code will carry
a header comment citing the original project, file, and license, in
addition to the entry above.
