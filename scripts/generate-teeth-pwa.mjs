import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = file => readFileSync(resolve(root, file));
const html = read('tools/teeth-chart/index.html').toString();
const guide = read('tools/teeth-chart/save-locally/index.html').toString();
const urls = new Set([
  '/tools/teeth-chart/index.html', '/tools/teeth-chart/manifest.webmanifest',
  '/tools/teeth-chart/welcome-before-after.png', '/tools/teeth-chart/save-locally/',
  '/tools/teeth-chart/icons/icon-192.png', '/tools/teeth-chart/icons/icon-512.png',
  '/tools/teeth-chart/icons/apple-touch-icon.png'
]);
for (const source of [html, guide]) {
  for (const match of source.matchAll(/(?:src|href)="(\/[^"#]+)"/g)) {
    const url = match[1];
    if (/\.(?:js|css|png|ico)(?:\?|$)/.test(url)) urls.add(url);
  }
}
const assets = [...urls].sort();
const template = read('scripts/teeth-service-worker.template.js').toString();
const hash = createHash('sha256').update(template);
for (const url of assets) {
  const pathname = url.split('?')[0];
  hash.update(url).update(read(pathname.slice(1) + (pathname.endsWith('/') ? 'index.html' : '')));
}
const version = hash.digest('hex').slice(0, 16);
const worker = template.replace('__VERSION__', version).replace('__ASSETS__', JSON.stringify(assets, null, 2));
const output = resolve(root, 'tools/teeth-chart/service-worker.js');
if (process.argv.includes('--check')) {
  if (readFileSync(output, 'utf8') !== worker) throw new Error('Teeth Chart offline assets changed. Run npm run build:teeth-pwa.');
} else {
  writeFileSync(output, worker);
}
console.log(`Teeth Chart offline snapshot ${version}: ${assets.length} static assets. No chart data or API responses.`);
