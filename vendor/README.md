# Vendored dependencies

These are local copies of open-source packages. The deployed site does not load scripts from a third-party CDN.

- **niimbot-web-bluetooth 2.6.0**, Dimitri Carelli, MIT. Source: https://github.com/iscarelli/niimbot-web-bluetooth . Files copied without modification from the npm package: `src/niimbot.js`, `src/label-size.js`, `src/label-memory.js`, `registry.json`, and `LICENSE`. The npm release is intentionally pinned; GitHub main may contain newer printer entries.
- **qrcode-generator 2.0.4**, Kazuhiko Arase, MIT. Source: https://github.com/kazuhikoarase/qrcode-generator . `dist/qrcode.js` and `dist/qrcode_UTF8.js` are copied without modification. Copyright and license notice are retained in each source file. `qrcode_UTF8.js` enables UTF-8 encoding.

Exact package integrity hashes are recorded in `package-lock.json`.
