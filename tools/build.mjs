// Construit dist/minecraft.html : un seul fichier HTML autonome (JS + CSS intégrés)
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const minify = !process.argv.includes('--dev');

// worker (génération, maillage, sons) : intégré sous forme de texte, lancé depuis une URL blob
const wres = await build({
  entryPoints: [join(root, 'src/worker/worker.js')],
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  minify,
  write: false,
  legalComments: 'none',
  logLevel: 'warning',
});
const workerSrc = wres.outputFiles[0].text;
const res = await build({
  entryPoints: [join(root, 'src/main.js')],
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  minify,
  write: false,
  legalComments: 'none',
  logLevel: 'warning',
  define: { __WORKER_SRC__: JSON.stringify(workerSrc) },
  logOverride: { 'empty-import-meta': 'silent' },
});
console.log('worker', (workerSrc.length / 1024).toFixed(0) + ' Ko');
const js = res.outputFiles[0].text;
const css = readFileSync(join(root, 'style.css'), 'utf8');
let html = readFileSync(join(root, 'index.html'), 'utf8');
html = html.replace('<link rel="stylesheet" href="style.css">', () => `<style>\n${css}\n</style>`);
html = html.replace('<script type="module" src="src/main.js"></script>', () => `<script>\n${js.replace(/<\/script/gi, '<\\/script')}\n</script>`);
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/minecraft.html'), html);
console.log('dist/minecraft.html', (html.length / 1024).toFixed(0) + ' Ko');
