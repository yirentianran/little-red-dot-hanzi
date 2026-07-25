# Character geometry source and license

## Prominent modification notice

On 2026-07-25, this project modified the upstream character geometry by extracting only the 428 unique characters used in the PEP Grade 4 Volume 1 curriculum, removing `radStrokes` and every other upstream field, adding `strokeCount`, sorting the character keys deterministically, and combining the selected records into the single file `data/characters.json`.

## Provenance

- npm package: `hanzi-writer-data` version `2.0.1` (installed as an exact development dependency)
- Repository: <https://github.com/chanind/hanzi-writer-data>
- Upstream data source: [Make Me a Hanzi](https://github.com/skishore/makemeahanzi), as documented by the package README and package metadata
- npm package integrity: `sha512-nbQwM+MaryGoq7pBMIZLCd3lFq03nXuJuwku1+6UbjL58uU+9OULVcMkoNvNuJSoIV7f1bbPRfD4D/LQa5S7qg==`
- npm package SHA-1: `09ce12eb1c47d86aeb33313e622f17ba5cbac1ad`

The npm package declares its license as `SEE LICENSE IN ARPHICPL.TXT`. Its unmodified license text is bundled at `node_modules/hanzi-writer-data/ARPHICPL.TXT` after dependency installation and is redistributed byte-for-byte in this repository as `data/ARPHICPL.TXT`.

The extracted geometry in `data/characters.json` is derived from that package and is distributed subject to the terms in `data/ARPHICPL.TXT`. In particular, Section 1 requires the license file to remain unaltered in distributed copies, and Section 2(a) requires a prominent notice describing how and when modified files were changed. This document records that modification; it does not replace or reinterpret the license text.
