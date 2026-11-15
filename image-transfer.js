// Small-image handoff for static apps. The limit is our interoperability cap,
// not a promise about every browser, clipboard, or messaging service's URL limit.
export const MAX_IMAGE_LINK_LENGTH = 128 * 1024;
function checkImage(image) {
  if (typeof image !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) {
    throw new Error('Transfer a base64 PNG, JPEG, or WebP image.');
  }
}
export function createLabelImageUrl(printerUrl, image, name = 'Transferred image') {
  checkImage(image);
  const url = new URL(printerUrl);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Use an HTTP or HTTPS label app URL.');
  url.hash = new URLSearchParams({ image, name: String(name).slice(0, 120) }).toString();
  if (url.href.length > MAX_IMAGE_LINK_LENGTH) throw new Error('Image link is too large. Save the PNG and upload it in Artwork instead.');
  return url.href;
}
export function readImageFragment(hash) {
  if (!hash || !new URLSearchParams(hash.slice(1)).has('image')) return null;
  if (hash.length > MAX_IMAGE_LINK_LENGTH) throw new Error('Image link is too large. Save the PNG and upload it in Artwork instead.');
  const params = new URLSearchParams(hash.slice(1)), image = params.get('image');
  checkImage(image);
  return { image, name: (params.get('name') || 'Transferred image').slice(0, 120) };
}

// Row-major bits, black=1, MSB first; only the last byte is padded with zeros.
export function unpackQrGrid(grid) {
  if (!grid || !Number.isInteger(grid.size) || grid.size < 21 || grid.size > 177 || (grid.size - 21) % 4 !== 0) throw new Error('Grid width must be a QR size from 21 to 177 modules (steps of 4).');
  const { size, data } = grid, count = size * size;
  const bytesNeeded = Math.ceil(count / 8);
  if (typeof data !== 'string' || data.length !== Math.ceil(bytesNeeded * 8 / 6) || !/^[A-Za-z0-9_-]+$/.test(data)) throw new Error('Invalid packed QR grid length or base64url data.');
  const binary = atob(data.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - data.length % 4) % 4));
  if (binary.length !== bytesNeeded || btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '') !== data) throw new Error('Invalid packed QR grid encoding.');
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  const unused = bytesNeeded * 8 - count;
  if (unused && (bytes.at(-1) & ((1 << unused) - 1))) throw new Error('QR grid padding bits must be zero.');
  return Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) => Boolean(bytes[(y * size + x) >> 3] & (1 << (7 - (y * size + x) % 8)))));
}
export function packQrGrid(modules) {
  const size = modules?.length;
  if (!Number.isInteger(size) || size < 21 || size > 177 || (size - 21) % 4) throw new Error('Unsupported QR grid width.');
  const bytes = new Uint8Array(Math.ceil(size * size / 8));
  modules.forEach((row, y) => {
    if (!Array.isArray(row) || row.length !== size) throw new Error('QR grid must be square.');
    row.forEach((dark, x) => {
      if (![true, false, 0, 1].includes(dark)) throw new Error('QR modules must be booleans or 0/1.');
      if (dark) { const i = y * size + x; bytes[i >> 3] |= 1 << (7 - i % 8); }
    });
  });
  return { size, data: btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '') };
}
export function createLabelGridUrl(printerUrl, modules, name = 'Custom QR') {
  const grid = packQrGrid(modules), url = new URL(printerUrl);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Use an HTTP or HTTPS label app URL.');
  url.hash = new URLSearchParams({ grid: String(grid.size), data: grid.data, name: String(name).slice(0, 120) }).toString();
  return url.href;
}
export function readGridFragment(hash) {
  if (!hash) return null;
  if (hash.length > MAX_IMAGE_LINK_LENGTH) throw new Error('Transfer link is too large.');
  const params = new URLSearchParams(hash.slice(1));
  if (!params.has('grid')) return null;
  const grid = { size: Number(params.get('grid')), data: params.get('data') };
  unpackQrGrid(grid);
  return { grid, name: (params.get('name') || 'Custom QR').slice(0, 120) };
}
