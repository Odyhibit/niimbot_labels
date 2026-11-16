# Little Label Studio

## Try it here https://odyhibit.github.io/niimbot_labels/

A static, browser-only editor for QR, text, and simple artwork labels, printing directly to a Niimbot Bluetooth printer using [iscarelli/niimbot-web-bluetooth](https://github.com/iscarelli/niimbot-web-bluetooth).

No backend, accounts, API keys, CDN dependencies, or USB connection. The driver, QR generator, and model registry are committed under `vendor/`. Labels and drafts are processed locally. Drafts and roll mappings stay in browser storage; export a design JSON to move it to another browser. Uploaded SVG files are rasterized as images, never inserted into the page.

## Run locally

```sh
npm start
```

Open **http://localhost:8080** in desktop Chrome or Edge. Python 3 is needed for this development server. No `npm install` is necessary to run the app: all browser dependencies are already included. Opening `index.html` with `file://` will not work; the printer registry is fetched over HTTP.

1. Turn on the printer, load your roll, and close other apps or tabs connected to it.
2. Click **Connect printer** and select your printer. The chooser filters by the selected printer model’s Bluetooth name prefix. Select your printer model before connecting; B1 and B1 Pro share the B1 prefix, and identification distinguishes them after pairing. The app identifies the model and selects its protocol and resolution.
3. Confirm the paper dimensions. The initial size is **50 × 30 mm**, width across the printhead and length along the feed. These are physical roll dimensions, not the orientation of your text. Use the rotation control for sideways designs.
4. Enter QR content, write text, or upload/draw artwork. Use **Use drawing** to apply the drawing pad. The preview shows the black-and-white label, with a choice of upright as used or as printed. Text shrinks to fit; very long text may become small. Use a test label to check legibility.
5. Choose copies and density, then **Print label**. Check the first label before making more copies.

Bluetooth printing needs Web Bluetooth and HTTPS or localhost. Desktop Chrome/Edge are the intended browsers. Safari and Firefox cannot print through native Web Bluetooth; PNG export and editing remain available. On iOS the upstream driver documents Bluefy support, but this app has not been checked on a phone.

## Publish on GitHub Pages

The app works at a repository subpath such as `https://YOURNAME.github.io/niimbot_labels/`; all local assets use relative URLs.

1. Push this folder to a GitHub repository, on a branch named **main**.
2. Under **Settings → Pages → Build and deployment**, choose **GitHub Actions** as the source.
3. The included `.github/workflows/pages.yml` runs tests, copies the static app into `dist/`, and deploys it. Run **Deploy to GitHub Pages** manually in the Actions tab if needed.
4. Open the HTTPS Pages URL in Chrome/Edge on the laptop with Bluetooth.

Alternatively, choose **Deploy from a branch**, **main**, **/ (root)**. The committed app files can be served directly without a build. Disable the Actions workflow if using this alternative so there is only one deployment route.

Nothing has been published automatically; this folder has no configured GitHub repository or remote.

## Label sizes and calibration

The app supports the seven models in the pinned driver registry: B1, B1 Pro, B2 Pro, M2-H, D11_H, D110, and N1. Unknown models are rejected rather than sent a guessed print protocol. The B1 is used for disconnected preview only; connecting identifies your actual printer. Additional models in a newer upstream release require an intentional driver/registry update and geometry review.

- Start with 50 × 30 mm. Presets and custom width/length are available (5–100 mm across, 5–200 mm along the feed). These input limits are app limits, **not** a claim that your printer can take every listed size. Only load stock your hardware supports.
- Calibrated registry sizes are selected by **model and dimensions**, not DPI alone. For uncalibrated sizes the app converts mm to pixels and limits width to the model's usable head width. A read-only `0xDC [0x03]` query can further lower that limit when the printer reports it. The M2-H keeps the upstream ribbon safety margin.
- Shaded sides in the preview represent the part of the physical label outside the usable print band. Artwork is fitted into the printable bitmap so it is not silently cut off at the head. The PNG contains only the printable band, not these physical blank sides.
- Feed offset is in millimetres and defaults to zero, with no hidden shift. Positive moves artwork down as printed (right in the upright view at 90°). Model/size-specific corrections are available through **Use model feed preset**, off by default because upstream registration measurements may not suit your unit and roll. This also applies to older saved designs without an explicit preset setting. Across-head offset moves the print right/left in printer coordinates. Both offsets move the entire page, including its thin border. The nudge arrows always use **As printed** directions, regardless of artwork rotation, and move the page 0.1 mm per click. Nudging switches the preview to **As printed**. Offsets can crop pixels at an edge; the app reports when the border exceeds the printable bitmap. Increase **Border inset** to leave more room without changing QR size. The head cannot print beyond its physical width. Calibration is baked into both preview and PNG, and the driver receives `offsetY: 0` to avoid applying it twice.
- QR layouts give the code more room than the caption. New designs start with a 1 mm outer margin; **Use compact margins** reduces it to 0.5 mm for an existing design. **QR only** gives the code the largest available square. Generated and imported grid codes use a compact one-module white quiet zone.
- QR rendering uses integer pixels and a one-module white quiet zone. This compact setting relies on additional clear paper around the code; check scanning on the actual label. Imported image files keep any quiet zone already in their pixels. Too-dense QRs (less than 2 pixels per module) are rejected. That minimum is a rendering guard, not a guarantee of scanning on your stock; scan your first printed code. Use **QR only**, a shorter URL, or larger labels for dense content.
- Artwork keeps its aspect ratio, composites transparency onto white, and uses the threshold slider to produce 1-bit output. **Crisp** scaling (the default) uses nearest-neighbor sampling and integer destination coordinates for QR codes and line art; **Smooth** enables interpolation for photos. Imports keep their original pixel dimensions up to the 25-megapixel limit. Crisp scaling preserves hard edges but does not guarantee equal-sized QR modules at every scale; test the printed code, including any hidden data. Uploaded art can have an optional heading/details caption. SVGs with external resources or missing intrinsic dimensions may need to be exported as PNG first.

## Custom QR mode and compact grid transfer

Use **QR code** to generate an ordinary QR from text. Use **Custom QR** for an existing module pattern from your own tools. Custom QR has no content field or encoding settings; it draws the supplied modules directly, keeping hidden data intact. Captions, layout, margins, rotation, paper size, and printer settings remain editable. The renderer adds a one-module white quiet zone and scales each module to a whole number of printer pixels. It does not decode or regenerate the symbol.

A grid link automatically selects Custom QR. You can also paste the link in that tab or import a grid JSON file containing `{ "size": 21, "data": "..." }`. The grid must exclude the quiet zone. PNG links continue to open in Artwork using crisp image scaling.

Compact transfer format:

```text
#grid=21&data=<base64url-packed-grid>&name=Custom+QR
```

- `grid`: module width, from 21 to 177 in steps of 4 (standard QR versions 1–40).
- `data`: unpadded base64url of the packed bytes. Black is 1, white is 0. Flatten rows left to right, top to bottom; pack bits most-significant first, with no per-row padding. Zero-pad only the last byte. The width specifies the exact meaningful bit count.
- `name`: optional display name, up to 120 characters.

The receiver checks byte count, canonical encoding, and zero padding before accepting a grid. Drafts and exported designs retain the packed grid, including when switching between ordinary QR and Custom QR tabs. Imported patterns are not changed by editing the ordinary QR content field in its separate tab.

`image-transfer.js` exports `packQrGrid(modules)`, `unpackQrGrid(grid)`, and `createLabelGridUrl(printerUrl, modules, name)` for integration. `modules` is the generator's original square array of booleans or 0/1 values. For example, from a source app that has a local copy of the helper:

```js
import { createLabelGridUrl } from './image-transfer.js';
// Inside a button click handler, with the original generated module array:
window.open(
  createLabelGridUrl('https://YOURNAME.github.io/niimbot_labels/', modules, 'Stego QR'),
  '_blank',
  'noopener',
);
```

This helper packs the existing pattern; it does not read a payload or encode a new QR. The source tools still need their sending button wired to their original module arrays. No other project was modified.

## Send an image from another QR app

The label app accepts a base64 PNG, JPEG, or WebP in the URL fragment:

```text
https://YOURNAME.github.io/niimbot_labels/#image=<URL-encoded data URL>&name=My+QR
```

Use **`#image`**, not `?image`. A fragment is processed in the browser and is not sent in the HTTP request to GitHub Pages. The image is still contained in the link, so anyone with the link has the image. After successful import the app removes the fragment from the current address with `history.replaceState`.

Add this function to a source QR tool and call it directly from a button click, passing the original PNG data URL (for `qr_ec_stego`, `encodeResult.dataUrl`). Replace the label app URL with your actual deployment URL:

```js
function sendToLabelPrinter(imageDataUrl) {
  const url = new URL('https://YOURNAME.github.io/niimbot_labels/');
  url.hash = new URLSearchParams({
    image: imageDataUrl,
    name: 'Custom QR',
  }).toString();
  if (url.href.length > 128 * 1024) {
    alert('Image link is too large. Download the PNG and upload it in Artwork.');
    return;
  }
  window.open(url.href, '_blank', 'noopener');
}
// In the generator’s button handler:
// sendToLabelPrinter(encodeResult.dataUrl);
```

`URLSearchParams` escapes base64 `+`, `/`, and `=` correctly. `image-transfer.js` also exports `createLabelImageUrl(printerUrl, imageDataUrl, name)` for tools that prefer a reusable module. The receiver and helper are implemented here; the source QR apps have not been edited.

The app selects Artwork with **Crisp** scaling, clears sample captions and the border, retains your paper size/orientation, and shows the image for review. It never pairs or prints automatically. URL import happens when the page loads. Unsupported image formats or bad images leave the existing draft intact and report an error.

The 128 KiB encoded-link limit is an app limit, not a universal browser guarantee. Small black-and-white QR PNGs are a good fit; large images should use the existing file upload. Links can also be truncated by chat or other sharing tools. A future `postMessage` handoff could avoid long URLs for larger images.

## Use a label in portrait orientation

Keep the physical paper size at **50 × 30 mm** for the starter roll. Under **Artwork orientation**, choose **90° clockwise** (or **90° counterclockwise**). Text, QR codes, and artwork are laid out in the turned orientation and rotated into the actual print bitmap. This produces a label you can turn and use upright as **30 × 50 mm**.

Changing artwork rotation switches the preview to **Upright · as used**. Choosing 90° or 270° changes a side-by-side QR layout to **QR above text**; you can explicitly choose side-by-side afterward. Stacked captions are vertically centered in the remaining space between the actual QR or artwork (plus its spacing gap) and the bottom margin.

The default **Upright · as used** preview shows the finished portrait label with readable text. Switch **View label** to **As printed · across printer head** to see the rotated text in the printer's orientation. This view switch does not change the print job. PNG export stays in the printer's orientation and includes the rotated text. Orientation is saved with drafts and exported designs.

## RFID / roll memory

**Read tag** asks the connected printer for heartbeat and consumable information. A readable tag can report a product barcode, serial, usage, and capacity. It **does not include dimensions**. The official app looks dimensions up remotely; this app does not call that service.

For a new barcode, choose the actual width/length and click **Remember size**, or successfully print once. On a later connection or explicit **Read tag**, the app restores the remembered size and reports that change. Memory is by product barcode, not the unique serial of a roll. It is scoped to this app path and browser. A draft export includes its size and artwork, but not the roll-memory database.

Many printers/rolls do not respond to RFID reads. Printing still works with manual size selection. Status fields have varying evidence in the upstream driver; the details panel retains the decoded evidence and raw bytes. Used/capacity values are reported as provided, not presented as a reliable remaining-label estimate or used to block printing. A status read failure clears the current tag so a later print cannot accidentally save a size against a stale barcode.

A tag check before printing detects a change from the previously read barcode and stops for review. Always confirm the loaded physical roll, especially with unreadable or untagged stock.

## Development and checks

Node 22+ is recommended for development and CI.

```sh
npm ci
npm test
npm run build
```

`dist/` contains only public static assets. Runtime uses no Node packages or external services.

Tests exercise geometry, model-specific calibration, QR decoding from rendered bitmaps (including UTF-8, layouts, and rotations), monochrome conversion, aspect ratio, design validation, and the actual UI print path with a mocked driver, DOM, and native canvas. They check exact bitmap handoff, copies/density, RFID recall, changed-roll review, and failed jobs. They do **not** test real Bluetooth hardware or browser layout. Physical printing and a visual check in a real browser are still required; no connected browser was available during implementation.

App structure:

- `index.html`, `styles.css`: responsive editor interface.
- `app.js`: editor state, import/export, draft storage, roll memory, and Bluetooth orchestration.
- `label.js`: geometry, print bitmap generation, and design validation.
- `image-transfer.js`: image-link creation and fragment parsing.
- `vendor/`: pinned browser dependencies, source attribution, and licenses.

To update vendor files intentionally, install the new package versions and copy their browser sources and registry into `vendor/`. Update `vendor/README.md`, review the upstream geometry changes, and rerun tests. Installing packages alone does not replace the committed browser assets.

If a print fails or times out, some labels may already have printed. Check the paper before retrying. The app disconnects after a print error so the next attempt starts with identification. The upstream driver handles pacing on macOS; this app keeps its defaults.
