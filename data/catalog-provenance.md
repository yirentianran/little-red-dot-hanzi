# Independent catalog provenance

This release is independently arranged and is not aligned to a textbook or publisher sequence.

## Fixed source

- Unicode Unihan version: 17.0.0
- Snapshot: `data/sources/Unihan-17.0.0.zip`
- SHA-256: `f7a48b2b545acfaa77b2d607ae28747404ce02baefee16396c5d2d7a8ef34b5e`
- License: Unicode-3.0, bundled in `data/UNICODE_LICENSE.txt`
- Properties: `kTGH`, `kHanyuPinlu`, `kMandarin`, `kTotalStrokes`

## Generation method

1. Select `kTGH=2013:1..3500`.
2. Sort by the sum of `kHanyuPinlu` frequencies descending, total strokes ascending, then `kTGH` index ascending.
3. Keep the first 3000 characters.
4. Allocate term quotas as 400 characters per term for grades 1-2, 225 per term for grades 3-4, and 125 per term for grades 5-6.
5. Use ranks 2051-2275 for `g4-fall`, divided into 15 sets of 15.
6. Choose the highest-frequency `kHanyuPinlu` reading. If it has no tone mark, use the first tone-marked `kMandarin` reading; if `kHanyuPinlu` is absent, use the first `kMandarin` reading.

`scripts/build-catalog-index.mjs` implements this process. Normal builds read the fixed local snapshot and do not access the network.

The two words for each character are original editorial selections in `data/catalog-editorial.json`. `data/review-checklist.json` must record human review of readings, words, and audio before a release build is allowed.
