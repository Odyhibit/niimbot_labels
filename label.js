import { unpackQrGrid } from './image-transfer.js';
// Geometry and bitmap rendering are independent of Bluetooth and the editor UI.
export const MODEL_SIZES = {
  b1: ['T50x30_b1', 'T30x45_b1', 'T25x38_b1'],
  b1pro: ['T50x30', 'T40x60', 'T30x45', 'T25x38'],
  b2pro: ['T50x30_b2pro'], m2h: ['T50x30_m2h'],
  d11h: ['T15x30', 'T12x22'], d110: ['T15x50'], n1: ['T14x50'],
};
export const HEADS = { b1: 384, b1pro: 576, b2pro: 576, m2h: 567, d11h: 144, d110: 96, n1: 96 };
export function geometry(registry, key, width, height, head) {
  const model = registry.models[key];
  if (!model || !Number.isFinite(width) || !Number.isFinite(height) || width < 5 || width > 100 || height < 5 || height > 200) throw new Error('Use a width of 5–100 mm and a length of 5–200 mm.');
  const calibrated = (MODEL_SIZES[key] || []).map(id => registry.sizes[id]).find(s => s && s.w_mm === width && s.h_mm === height);
  const limit = Math.min(HEADS[key] || head || 384, head || Infinity);
  const w_px = Math.min(calibrated?.w_px || Math.round(width * model.dpi / 25.4), limit);
  const h_px = calibrated?.h_px || Math.round(height * model.dpi / 25.4);
  return { w_px, h_px, offset_y_px: calibrated?.offset_y_px || 0, dpi: model.dpi,
    w_mm: width, h_mm: height, printable_mm: w_px * 25.4 / model.dpi, calibrated: !!calibrated };
}
function textBlock(ctx, lines, box, fontPx, align = 'center') {
  if (!lines.length) return;
  let size = fontPx;
  for (; size >= 5; size -= .5) {
    const widest = Math.max(...lines.map((line, i) => { ctx.font = `${i === 0 ? 700 : 400} ${size * (i === 0 ? 1 : .75)}px sans-serif`; return ctx.measureText(line).width; }));
    if (widest <= box.w && lines.length * size * 1.2 <= box.h) break;
  }
  if (size < 5) throw new Error('Text does not fit. Shorten the text, reduce margins, or use a larger label.');
  let y = box.y + (align === 'top' ? 0 : (box.h - lines.length * size * 1.2) / 2);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  lines.forEach((line, i) => { ctx.font = `${i === 0 ? 700 : 400} ${size * (i === 0 ? 1 : .75)}px sans-serif`; ctx.fillText(line, box.x + box.w / 2, y + size * .6); y += size * 1.2; });
}
export function renderLabel(canvas, spec, geo, qrFactory, artwork, createCanvas = () => document.createElement('canvas')) {
  canvas.width = geo.w_px; canvas.height = geo.h_px;
  const rotated = spec.rotation === 90 || spec.rotation === 270;
  const work = createCanvas(); work.width = rotated ? canvas.height : canvas.width; work.height = rotated ? canvas.width : canvas.height;
  const ctx = work.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, work.width, work.height); ctx.fillStyle = '#000'; ctx.strokeStyle = '#000';
  const px = geo.dpi / 25.4, m = Math.round(spec.margin * px), gap = Math.round(1.5 * px);
  let box = { x: m, y: m, w: work.width - 2 * m, h: work.height - 2 * m };
  if (box.w < 8 || box.h < 8) throw new Error('Margins leave too little space. Reduce the margin or increase the label size.');
  const lines = [spec.title.trim(), ...spec.subtitle.split('\n').map(s => s.trim())].filter(Boolean);
  let qrInfo = null;
  if (spec.mode === 'qr' || spec.mode === 'custom') {
    if (spec.mode === 'qr' && !spec.qr.trim()) throw new Error('Enter some QR content to preview and print.');
    let qr;
    if (spec.mode === 'custom') {
      if (!spec.grid) throw new Error('Import a custom QR grid to preview and print.');
      const modules = unpackQrGrid(spec.grid);
      qr = { getModuleCount: () => spec.grid.size, isDark: (r, c) => modules[r][c] };
    } else {
      try { qr = qrFactory(0, 'M'); qr.addData(spec.qr, 'Byte'); qr.make(); } catch { throw new Error('QR content is too long. Try a shorter link or text.'); }
    }
    const hasText = lines.length && spec.layout !== 'only';
    const side = hasText && spec.layout === 'side';
    const qrBox = { ...box, w: side ? Math.floor(box.w * .60) : box.w, h: hasText && !side ? Math.floor(box.h * .80) : box.h };
    if (hasText) {
      if (side) {
        const minTextWidth = Math.ceil(Math.max(...lines.map((line, i) => {
          ctx.font = `${i === 0 ? 700 : 400} ${i === 0 ? 5 : 3.75}px sans-serif`;
          return ctx.measureText(line).width;
        })));
        qrBox.w = Math.min(qrBox.w, box.w - gap - minTextWidth);
      } else {
        qrBox.h = Math.min(qrBox.h, box.h - gap - lines.length * 6);
      }
    }
    const quiet = 1; // Compact printed quiet zone; surrounding stock supplies extra clearance.
    const count = qr.getModuleCount(), scale = Math.floor(Math.min(qrBox.w, qrBox.h) / (count + 2 * quiet));
    if (scale < 2) throw new Error('QR is too dense for this space. Shorten its content, use QR only, or choose a larger label.');
    const total = (count + 2 * quiet) * scale, x = Math.round(qrBox.x + (qrBox.w - total) / 2), y = Math.round(qrBox.y + (qrBox.h - total) / 2);
    for (let r = 0; r < count; r++) for (let c = 0; c < count; c++) if (qr.isDark(r, c)) ctx.fillRect(x + (c + quiet) * scale, y + (r + quiet) * scale, scale, scale);
    qrInfo = { modulePx: scale, moduleMm: scale / px, modules: count };
    if (hasText) {
      const captionY = y + total + gap;
      textBlock(ctx, lines, side
        ? { x: box.x + qrBox.w + gap, y: box.y, w: box.w - qrBox.w - gap, h: box.h }
        : { x: box.x, y: captionY, w: box.w, h: box.y + box.h - captionY },
      spec.fontSize * px);
    }
  } else if (spec.mode === 'text') {
    if (!lines.length) throw new Error('Add a heading or details to print a text label.');
    textBlock(ctx, lines, box, spec.fontSize * px);
  } else {
    if (!artwork) throw new Error('Upload artwork or use the drawing pad to make an art label.');
    const captionH = lines.length ? Math.min(box.h * .3, lines.length * spec.fontSize * px * 1.2) : 0;
    const available = box.h - captionH - (captionH ? gap : 0);
    const factor = Math.min(box.w / artwork.width, available / artwork.height);
    if (available < 8) throw new Error('Artwork and caption need more room. Reduce text or margins.');
    const crisp = spec.imageScaling !== 'smooth';
    ctx.imageSmoothingEnabled = !crisp;
    const width = crisp ? Math.max(1, Math.round(artwork.width * factor)) : artwork.width * factor;
    const height = crisp ? Math.max(1, Math.round(artwork.height * factor)) : artwork.height * factor;
    const x = box.x + (box.w - width) / 2, y = box.y + (available - height) / 2;
    ctx.drawImage(artwork, crisp ? Math.round(x) : x, crisp ? Math.round(y) : y, width, height);
    if (captionH) {
      const captionY = (crisp ? Math.round(y) : y) + height + gap;
      textBlock(ctx, lines, { x: box.x, y: captionY, w: box.w, h: box.y + box.h - captionY }, spec.fontSize * px);
    }
  }
  const out = canvas.getContext('2d'); out.fillStyle = '#fff'; out.fillRect(0, 0, canvas.width, canvas.height);
  const offset = (spec.modelCalibration ? geo.offset_y_px : 0) + Math.round(spec.offset * px);
  out.save(); out.translate(canvas.width / 2, canvas.height / 2); out.rotate(spec.rotation * Math.PI / 180); out.drawImage(work, -work.width / 2, -work.height / 2); out.restore();
  // Construct the complete page before applying printer registration. Border,
  // QR, and caption must move together; translation does not stretch modules.
  if (spec.border) {
    const inset = Math.max(1, Math.round((spec.borderInset ?? spec.margin / 2) * px));
    const thickness = Math.max(1, Math.round(px * .2));
    if (2 * inset + thickness >= Math.min(canvas.width, canvas.height)) throw new Error('Border inset leaves too little room. Reduce the border inset.');
    const width = canvas.width - 2 * inset, height = canvas.height - 2 * inset;
    out.fillStyle = '#000';
    out.fillRect(inset, inset, width, thickness);
    out.fillRect(inset, canvas.height - inset - thickness, width, thickness);
    out.fillRect(inset, inset, thickness, height);
    out.fillRect(canvas.width - inset - thickness, inset, thickness, height);
  }
  const offsetX = Math.round((spec.offsetX ?? 0) * px);
  if (offsetX || offset) {
    const page = createCanvas(); page.width = canvas.width; page.height = canvas.height;
    page.getContext('2d').drawImage(canvas, 0, 0);
    out.fillStyle = '#fff'; out.fillRect(0, 0, canvas.width, canvas.height);
    out.drawImage(page, offsetX, offset);
  }
  const borderInset = Math.max(1, Math.round((spec.borderInset ?? spec.margin / 2) * px));
  const borderClipped = Boolean(spec.border && (Math.abs(offsetX) > borderInset || Math.abs(offset) > borderInset));
  const pixels = out.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const lum = .299 * pixels.data[i] + .587 * pixels.data[i + 1] + .114 * pixels.data[i + 2];
    const v = lum < (spec.mode === 'image' ? spec.threshold : 160) ? 0 : 255;
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = v; pixels.data[i + 3] = 255;
  }
  out.putImageData(pixels, 0, 0);
  return { qrInfo, offset, offsetX, borderClipped };
}
export function validateDesign(value) {
  if (!value || value.version !== 1 || !value.design || typeof value.design !== 'object') throw new Error('Choose a Little Label Studio design JSON file.');
  const d = value.design;
  if (!['qr', 'custom', 'text', 'image'].includes(d.mode) || !['side', 'stack', 'only'].includes(d.layout)) throw new Error('Invalid design layout.');
  for (const [key, max] of [['qr', 1800], ['title', 120], ['subtitle', 500]]) if (typeof d[key] !== 'string' || d[key].length > max) throw new Error(`Invalid ${key} in design.`);
  for (const [key, min, max] of [['width', 5, 100], ['height', 5, 200], ['fontSize', 1.5, 15], ['margin', .5, 10], ['offset', -5, 5], ['threshold', 1, 254]]) if (!Number.isFinite(d[key]) || d[key] < min || d[key] > max) throw new Error(`Invalid ${key} in design.`);
  if (![0, 90, 180, 270].includes(d.rotation) || typeof d.border !== 'boolean') throw new Error('Invalid design settings.');
  if (d.grid != null) unpackQrGrid(d.grid);
  if (d.customName != null && (typeof d.customName !== 'string' || d.customName.length > 120)) throw new Error('Invalid custom QR name.');
  for (const [key, min, max] of [['offsetX', -5, 5], ['borderInset', .1, 10]]) if (d[key] != null && (!Number.isFinite(d[key]) || d[key] < min || d[key] > max)) throw new Error(`Invalid ${key} in design.`);
  if (d.modelCalibration != null && typeof d.modelCalibration !== 'boolean') throw new Error('Invalid model calibration setting.');
  if (d.imageScaling != null && !['crisp', 'smooth'].includes(d.imageScaling)) throw new Error('Invalid image scaling.');
  if (d.art && (typeof d.art !== 'string' || d.art.length > 8_000_000 || !/^data:image\/(png|jpeg|webp);base64,/.test(d.art))) throw new Error('Invalid artwork in design.');
  return { ...d };
}
