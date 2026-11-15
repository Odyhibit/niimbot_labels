import { readImageFragment, readGridFragment, unpackQrGrid } from './image-transfer.js';
import { geometry, renderLabel, validateDesign, HEADS } from './label.js';
const $ = id => document.getElementById(id);
const storageKey = `little-label-studio:${location.pathname.replace(/index\.html$/, '')}`;
const defaults = { mode: 'qr', qr: 'https://example.com', layout: 'side', title: 'A place for everything', subtitle: 'And everything in its place.\nEST. 2026', fontSize: 3, margin: 1, border: false, rotation: 0, threshold: 160, offset: 0, width: 50, height: 30, art: null, imageScaling: 'crisp' };
const fields = { imageScaling: 'image-scaling', qr: 'qr', layout: 'layout', title: 'title', subtitle: 'subtitle', fontSize: 'font-size', margin: 'margin', border: 'border', rotation: 'rotation', threshold: 'threshold', offset: 'offset', width: 'width', height: 'height' };
const numeric = new Set(['fontSize','margin','rotation','threshold','offset','width','height']);
let registry, design = { ...defaults }, artwork = null, connected = false, busy = false, valid = false, currentGeo, head = null, tag = null, memory;
function message(text, error = false) { $('message').textContent = text; $('message').classList.toggle('error', error); }
function syncControls() {
  for (const el of document.querySelectorAll('input,textarea,select,button')) el.disabled = busy;
  $('connect').hidden = connected; $('disconnect').hidden = !connected;
  $('connect').disabled = busy || !window.Niimbot?.isSupported() || !window.isSecureContext;
  $('model').disabled = busy || connected;
  $('print').disabled = busy || !connected || !valid;
  $('download').disabled = busy || !valid;
  $('read-roll').disabled = busy || !connected;
  $('remember-roll').disabled = busy || !tag?.barCode || !valid;
  $('connection-state').textContent = connected ? '● Connected' : '○ Disconnected';
  $('connection-state').classList.toggle('online', connected);
}
async function operation(action) {
  if (busy) return;
  busy = true; syncControls();
  try { await action(); } catch (e) { message(e.name === 'NotFoundError' ? 'Pairing canceled. Connect again whenever you’re ready.' : e.message || String(e), true); }
  finally { busy = false; syncControls(); }
}
function persist() {
  try { localStorage.setItem(`${storageKey}:draft`, JSON.stringify({ version: 1, design })); } catch { /* Export is available when browser storage is full or blocked. */ }
}
function updatePreset() {
  $('preset').value = [...$('preset').options].some(o => o.value === `${design.width},${design.height}`) ? `${design.width},${design.height}` : 'custom';
}
function updateUI() {
  for (const [key, id] of Object.entries(fields)) {
    if (key === 'border') $(id).checked = design[key]; else $(id).value = design[key] ?? defaults[key];
  }
  for (const tab of document.querySelectorAll('[data-mode]')) {
    const active = tab.dataset.mode === design.mode; tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
    $(`panel-${tab.dataset.mode}`).hidden = !active;
  }
  $('qr-layout-controls').hidden = !['qr', 'custom'].includes(design.mode);
  $('custom-info').textContent = design.grid ? `${design.customName || 'Custom QR'} · ${design.grid.size} × ${design.grid.size} modules. Pattern preserved; label settings remain editable.` : 'Import a grid from your QR tool. The modules stay fixed while you edit the label layout.';
  $('text-fields').hidden = ['qr', 'custom'].includes(design.mode) && design.layout === 'only';
  $('threshold-value').textContent = design.threshold;
  updatePreset(); render();
}
function renderPreview() {
  const source = $('preview'), display = $('display-preview');
  const upright = $('preview-view').value === 'used';
  const sideways = design.rotation === 90 || design.rotation === 270;
  const swapped = upright && sideways;
  const w = swapped ? design.height : design.width, h = swapped ? design.width : design.height;
  display.width = swapped ? source.height : source.width;
  display.height = swapped ? source.width : source.height;
  const ctx = display.getContext('2d');
  ctx.save(); ctx.translate(display.width / 2, display.height / 2);
  // Undo the print rotation only in the presentation canvas. The print bitmap
  // remains in the printer's coordinates, including its calibration and offset.
  if (upright) ctx.rotate(-design.rotation * Math.PI / 180);
  ctx.drawImage(source, -source.width / 2, -source.height / 2); ctx.restore();
  const printed = Math.min(100, (currentGeo?.printable_mm || design.width) / design.width * 100);
  display.style.width = swapped ? '100%' : `${printed}%`;
  display.style.height = swapped ? `${printed}%` : '100%';
  $('label-paper').style.aspectRatio = `${w}/${h}`;
  $('label-paper').style.maxWidth = `${Math.min(410, 250 * w / h)}px`;
  $('width-ruler').textContent = upright ? `${w} mm · as used` : `${design.width} mm across head`;
  $('preview-dimensions').textContent = `${w} × ${h} mm · ${upright ? 'as used' : 'as printed'}`;
  const usedWidth = sideways ? design.height : design.width, usedHeight = sideways ? design.width : design.height;
  $('orientation-note').textContent = design.rotation === 0
    ? 'Artwork prints upright in the loaded roll orientation.'
    : `Used upright: ${usedWidth} × ${usedHeight} mm. Text and artwork print rotated ${design.rotation}° on the ${design.width} × ${design.height} mm roll. Keep the paper dimensions as loaded.`;
  display.setAttribute('aria-label', `${upright ? 'Upright label as used' : 'Label as printed'}, ${w} by ${h} millimetres`);
}
function render() {
  valid = false;
  try {
    validateDesign({ version: 1, design });
    for (const id of Object.values(fields)) if (!$(id).checkValidity()) throw new Error('Check the highlighted field values before printing.');
    currentGeo = geometry(registry, $('model').value, design.width, design.height, head);
    const result = renderLabel($('preview'), design, currentGeo, window.qrcode, artwork);
    renderPreview();
    $('geometry-info').textContent = `${currentGeo.w_px} × ${currentGeo.h_px} px · ${currentGeo.dpi} dpi${result.qrInfo ? ` · QR dot ${result.qrInfo.moduleMm.toFixed(2)} mm` : ''}`;
    const clipped = design.width - currentGeo.printable_mm;
    $('size-note').textContent = `${currentGeo.calibrated ? 'Calibrated size for this model.' : 'Custom geometry; check the first label on paper.'}${clipped > .2 ? ` Printable width is ${currentGeo.printable_mm.toFixed(1)} mm; the shaded edges will stay blank.` : ''} Feed correction: ${result.offset} px.`;
    $('render-error').hidden = true; valid = true;
  } catch (e) {
    // Clear the previous bitmap so invalid edits cannot look printable.
    const ctx = $('preview').getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, $('preview').width, $('preview').height);
    renderPreview();
    $('render-error').textContent = e.message; $('render-error').hidden = false;
  }
  syncControls();
}
function download(data, type, name) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function loadImage(src) {
  return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('This image could not be opened. Try a PNG or JPEG.')); image.src = src; });
}
async function rasterize(src) {
  const image = await loadImage(src);
  if (image.width * image.height > 25_000_000) throw new Error('Image is too large. Resize it below 25 megapixels.');
  const canvas = document.createElement('canvas');
  canvas.width = image.width; canvas.height = image.height;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return { image: canvas, data: canvas.toDataURL('image/png') };
}
function summarizeStatus(status) {
  const rfid = status?.decoded?.rfid;
  tag = rfid?.tagPresent && rfid.barCode ? rfid : null;
  $('status-details').textContent = JSON.stringify({ decoded: status?.decoded, confidence: status?.confidence, raw: status?.raw }, (key, value) => value instanceof Uint8Array ? [...value] : value, 2) || 'No response.';
  $('roll-info').textContent = tag ? `Barcode ${tag.barCode}${tag.usedPaper != null ? ` · reported used: ${tag.usedPaper}` : ''}${tag.capacity != null ? ` / capacity: ${tag.capacity}` : ''}. Status fields may be inferred for this model.` : 'No readable roll barcode. Set the label size manually; printing is still available.';
  syncControls();
}
async function readRoll(restore = false) {
  tag = null;
  try {
    const status = await Niimbot.getStatus(); summarizeStatus(status);
    const saved = tag && memory.recall(tag.barCode);
    if (restore && saved && Number.isFinite(saved.w_mm) && Number.isFinite(saved.h_mm)) {
      design.width = saved.w_mm; design.height = saved.h_mm; updateUI(); persist();
      message(`Restored ${saved.w_mm} × ${saved.h_mm} mm for roll ${tag.barCode}. Check the preview before printing.`);
    }
  } catch (e) { tag = null; $('roll-info').textContent = `Roll status unavailable: ${e.message}. You can still set the size manually.`; }
}
async function connectPrinter() {
  message('Choose your printer in the Bluetooth dialog…');
  try {
    const info = await Niimbot.identify({ ...registry.models[$('model').value], name_prefixes: [] });
    const match = Object.entries(registry.models).find(([, model]) => model.id === info?.modelId);
    if (!match) { await Niimbot.disconnect(); throw new Error(`Printer model ${info?.modelId ?? 'unknown'} is not in this driver’s tested registry. Printing is disabled.`); }
    $('model').value = match[0]; $('density').value = match[1].density || 3;
    head = null;
    try {
      const report = await Niimbot.probe(0xdc, [0x03], 600);
      if (report?.cmd === 0xde && report.data?.length >= 6) {
        const reported = report.data[4] * 256 + report.data[5];
        if (reported >= 32 && reported <= 1200) head = reported;
      }
    } catch { /* Known model head remains the fallback. */ }
    connected = true; render(); message(`${match[1].label} connected. Confirm the roll size before printing.`);
    // Listen on the granted device when this optional browser API is available.
    try { for (const device of await navigator.bluetooth.getDevices?.() || []) if (device.gatt?.connected) device.addEventListener('gattserverdisconnected', () => {
      connected = false; head = null; tag = null; $('roll-info').textContent = 'Printer disconnected. Reconnect to read the roll.'; syncControls(); message('Bluetooth disconnected. Reconnect before printing.', true);
    }, { once: true }); } catch { /* Errors also report a dropped connection at print time. */ }
    await readRoll(true);
  } catch (e) { connected = false; head = null; tag = null; try { await Niimbot.disconnect(); } catch {} throw e; }
}
async function printLabel() {
  if (!connected || !valid) return;
  const copies = Number($('copies').value);
  if (!Number.isInteger(copies) || copies < 1 || copies > 100) throw new Error('Choose a whole number of copies from 1 to 100.');
  const previousBarcode = tag?.barCode;
  await readRoll(false);
  if (tag?.barCode && previousBarcode && tag.barCode !== previousBarcode) { message('The roll changed. Read the tag and confirm its size before printing.', true); return; }
  render(); if (!valid) return;
  const snapshot = { ...design }, size = { ...currentGeo, offset_y_px: 0 };
  message('Preparing print…');
  try {
    // Offset is already baked into the bitmap so PNG, preview, and print agree.
    await Niimbot.printImage($('preview').toDataURL('image/png'), { model: registry.models[$('model').value], size, offsetY: 0, copies, density: Number($('density').value), onProgress: text => message(text === 'ok' ? 'Printer confirmed the job.' : text) });
    if (tag?.barCode) memory.remember(tag.barCode, { size: `mm:${snapshot.width}x${snapshot.height}`, w_mm: snapshot.width, h_mm: snapshot.height });
    message('Printer confirmed the job. Check your label before printing more.');
  } catch (e) {
    connected = false; tag = null; try { await Niimbot.disconnect(); } catch {}
    throw new Error(`${e.message} Some labels may have printed. Check the paper before retrying, then reconnect.`);
  }
}
function acceptGrid(incoming) {
  unpackQrGrid(incoming.grid);
  design = { ...design, mode: 'custom', grid: incoming.grid, customName: incoming.name || 'Custom QR', title: '', subtitle: '', border: false };
  updateUI(); persist();
  message('Custom QR received. Its original pattern is preserved. Check the size and orientation before printing.');
}
async function init() {
  const response = await fetch('./vendor/niimbot/registry.json'); if (!response.ok) throw new Error('Could not load the printer registry.'); registry = await response.json();
  for (const [key, model] of Object.entries(registry.models)) { const option = document.createElement('option'); option.value = key; option.textContent = model.label; $('model').append(option); }
  $('model').value = 'b1';
  memory = NiimbotLabelMemory.create({ key: `${storageKey}:rolls` });
  $('driver-version').textContent = `v${Niimbot.VERSION}`;
  if (!window.isSecureContext || !Niimbot.isSupported()) { $('compatibility').hidden = false; $('compatibility').textContent = 'Bluetooth printing needs Chrome or Edge on desktop, over HTTPS or localhost. You can still design and export labels here.'; }
  try { const draft = JSON.parse(localStorage.getItem(`${storageKey}:draft`)); if (draft) { const loaded = validateDesign(draft); const image = loaded.art ? await loadImage(loaded.art) : null; design = loaded; artwork = image; } } catch { /* An invalid draft does not prevent startup. */ }
  for (const [key, id] of Object.entries(fields)) $(id).addEventListener('input', () => {
    design[key] = key === 'border' ? $(id).checked : numeric.has(key) ? Number($(id).value) : $(id).value;
    if (key === 'layout') $('text-fields').hidden = ['qr', 'custom'].includes(design.mode) && design.layout === 'only';
    $('threshold-value').textContent = design.threshold; updatePreset(); render(); persist();
  });
  for (const tab of document.querySelectorAll('[data-mode]')) {
    tab.addEventListener('click', () => { design.mode = tab.dataset.mode; updateUI(); persist(); });
    tab.addEventListener('keydown', e => { if (!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return; e.preventDefault(); const tabs = [...document.querySelectorAll('[data-mode]')]; const index = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (tabs.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length; tabs[index].click(); tabs[index].focus(); });
  }
  $('load-grid-link').addEventListener('click', () => operation(async () => {
    const value = $('grid-link').value.trim();
    const incoming = readGridFragment(value.startsWith('#') ? value : new URL(value).hash);
    if (!incoming) throw new Error('Paste a custom QR link containing #grid and data.');
    acceptGrid(incoming); $('grid-link').value = '';
  }));
  $('import-grid').addEventListener('click', () => $('grid-file').click());
  $('grid-file').addEventListener('change', () => operation(async () => {
    const file = $('grid-file').files[0]; $('grid-file').value = ''; if (!file) return;
    if (file.size > 16000) throw new Error('Grid JSON is too large.');
    const grid = JSON.parse(await file.text()); acceptGrid({ grid, name: file.name.slice(0, 120) });
  }));
  $('compact-qr').addEventListener('click', () => { design.margin = .5; updateUI(); persist(); });
  $('preview-view').addEventListener('change', renderPreview);
  $('preset').addEventListener('change', () => { if ($('preset').value === 'custom') { $('width').focus(); return; } [design.width, design.height] = $('preset').value.split(',').map(Number); updateUI(); persist(); });
  $('model').addEventListener('change', () => { head = null; $('density').value = registry.models[$('model').value].density; render(); });
  $('connect').addEventListener('click', () => operation(connectPrinter));
  $('disconnect').addEventListener('click', () => operation(async () => { await Niimbot.disconnect(); connected = false; tag = null; head = null; $('roll-info').textContent = 'Connect to read the roll’s RFID tag.'; message('Disconnected. Your design is still here.'); render(); }));
  $('read-roll').addEventListener('click', () => operation(async () => { message('Reading roll tag…'); await readRoll(true); if (!tag) message('No readable tag. Use the size controls above.'); else if (!memory.recall(tag.barCode)) message('New roll barcode. Set its size, then choose Remember size.'); }));
  $('remember-roll').addEventListener('click', () => { if (tag?.barCode && valid) message(memory.remember(tag.barCode, { size: `mm:${design.width}x${design.height}`, w_mm: design.width, h_mm: design.height }) ? `Remembered ${design.width} × ${design.height} mm for this barcode.` : 'Browser storage is unavailable. This roll size could not be remembered.', !memory.recall(tag.barCode)); });
  $('print').addEventListener('click', () => operation(printLabel));
  $('download').addEventListener('click', () => { if (valid) $('preview').toBlob(blob => { if (blob) download(blob, 'image/png', `label-${design.width}x${design.height}.png`); }); });
  $('export-design').addEventListener('click', () => download(JSON.stringify({ version: 1, design }, null, 2), 'application/json', 'label-design.json'));
  $('import-design').addEventListener('click', () => $('design-file').click());
  $('design-file').addEventListener('change', () => operation(async () => {
    const file = $('design-file').files[0]; $('design-file').value = ''; if (!file) return;
    if (file.size > 8_000_000) throw new Error('Design file is too large (8 MB maximum).');
    const loaded = validateDesign(JSON.parse(await file.text())); const art = loaded.art ? await rasterize(loaded.art) : null;
    design = loaded; artwork = art?.image || null; if (art) design.art = art.data; updateUI(); persist(); message('Design imported. Confirm the loaded size matches your roll.');
  }));
  $('art-file').addEventListener('change', () => operation(async () => {
    const file = $('art-file').files[0]; $('art-file').value = ''; if (!file) return;
    if (!['image/png','image/jpeg','image/webp','image/svg+xml'].includes(file.type) || file.size > 5_000_000) throw new Error('Choose a PNG, JPEG, WebP, or SVG under 5 MB.');
    const url = URL.createObjectURL(file); try { const art = await rasterize(url); artwork = art.image; design.art = art.data; $('art-name').textContent = file.name; render(); persist(); } finally { URL.revokeObjectURL(url); }
  }));
  const draw = $('drawing'), ctx = draw.getContext('2d');
  function clearDrawing() { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, draw.width, draw.height); }
  clearDrawing(); let drawing = false;
  function point(e) { const r = draw.getBoundingClientRect(); return [(e.clientX - r.left) * draw.width / r.width, (e.clientY - r.top) * draw.height / r.height]; }
  draw.addEventListener('pointerdown', e => { if (busy) return; drawing = true; draw.setPointerCapture(e.pointerId); const [x,y] = point(e); ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x + .1,y); ctx.strokeStyle = $('eraser').checked ? '#fff' : '#000'; ctx.lineWidth = $('eraser').checked ? 24 : 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(); });
  draw.addEventListener('pointermove', e => { if (!drawing || busy) return; ctx.lineTo(...point(e)); ctx.stroke(); });
  for (const event of ['pointerup','pointercancel','lostpointercapture']) draw.addEventListener(event, () => { drawing = false; });
  $('use-drawing').addEventListener('click', () => { const copy = document.createElement('canvas'); copy.width = draw.width; copy.height = draw.height; copy.getContext('2d').drawImage(draw,0,0); artwork = copy; design.art = copy.toDataURL(); $('art-name').textContent = 'Your drawing'; render(); persist(); });
  $('clear-art').addEventListener('click', () => { artwork = null; design.art = null; clearDrawing(); $('art-name').textContent = 'Or sketch something below.'; render(); persist(); });
  $('reset').addEventListener('click', () => { const { width, height } = design; design = { ...defaults, width, height }; artwork = null; clearDrawing(); $('art-name').textContent = 'Or sketch something below.'; updateUI(); persist(); message('Fresh design. Paper size kept for the loaded roll.'); });
  updateUI();
  if (location.hash) await operation(async () => {
    const custom = readGridFragment(location.hash);
    if (custom) { acceptGrid(custom); history.replaceState(null, '', location.pathname + location.search); return; }
    const incoming = readImageFragment(location.hash);
    if (!incoming) return;
    const art = await rasterize(incoming.image);
    design = { ...design, mode: 'image', title: '', subtitle: '', border: false, imageScaling: 'crisp', art: art.data };
    artwork = art.image;
    $('art-name').textContent = incoming.name;
    updateUI(); persist();
    history.replaceState(null, '', location.pathname + location.search);
    message('Image received. Check the label size and orientation, then connect and print.');
  });
}
init().catch(e => { message(`App could not start: ${e.message}. Serve this folder over localhost or GitHub Pages, then reload.`, true); $('compatibility').hidden = false; $('compatibility').textContent = 'The app could not load. Check that the vendor files are included and open it through a web server.'; });
