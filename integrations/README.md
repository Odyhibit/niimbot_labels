# QR encoder print button

`qr_ec_stego-print-label.patch` adds a 60% Download PNG / 40% Print label action row to the Encode tab in the sibling `qr_ec_stego` project. Print label uses smaller, muted styling and opens the label editor in a new tab. Both actions start disabled and become available after successful generation. Failed generation clears the prior result and disables both buttons.

The encoder returns its original module grid. A local browser helper packs that grid into the format accepted by Little Label Studio's Custom QR mode. No payload decoding or QR regeneration occurs. The helper is local to the encoder, so there is no runtime dependency on fetching scripts from the label app.

The destination is `https://odyhibit.github.io/niimbot_labels/`. Change `LABEL_PRINTER_URL` in `docs/js/app.js` if the label app is deployed elsewhere. The label app must be published before the link can work.

From this `niimbot_labels` folder, apply with:

```sh
cd ../qr_ec_stego
git apply ../niimbot_labels/integrations/qr_ec_stego-print-label.patch
```

The patch was prepared from the sibling project's current files and passed `git apply --check`. Its staged source passed JavaScript syntax checks and DOM/native-canvas integration checks: actual padding and ECC steganography generation, exact module-grid round-trip through the real label receiver, action enable/disable state, and failure handling. Both example transfer URLs were 176 characters. Browser layout and physical printing still need a check.

The sibling project was not modified: this session permits writes only inside `niimbot_labels` and temporary directories. Automatic approval review rejected the attempted sibling-project patch.
