import { mkdir, rm, cp } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true });
await mkdir('dist');
for (const file of ['index.html', 'styles.css', 'app.js', 'label.js', 'image-transfer.js', 'vendor', '.nojekyll']) {
  await cp(file, `dist/${file}`, { recursive: true });
}
console.log('Static site built in dist/');
