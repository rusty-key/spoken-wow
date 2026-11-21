# Fonts

Kept in the repo because `next/font/google` downloads at build time, and it crashes the build when
Google answers with a font URL that has no file extension, which it does on some CI runs.

All three are under the SIL Open Font License, whose text sits beside each one.

- `geist-sans.woff2`: `dist/fonts/geist-sans/Geist-Variable.woff2` from the `geist` npm package, 1.9.0.
- `noto-sans-latin.woff2`: Google Fonts' `latin` subset of Noto Sans, v42.
- `cinzel-latin.woff2`: Google Fonts' `latin` subset of Cinzel, v26.
