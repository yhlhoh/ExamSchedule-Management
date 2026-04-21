import { build } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';

const srcEntry = 'present/liquid-glass-react/liquid-glass.src.js';
const bundledOut = 'present/liquid-glass-react/liquid-glass.js';

await build({
  entryPoints: [srcEntry],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  minify: true,
  sourcemap: false,
  outfile: bundledOut
});

mkdirSync('public/present/liquid-glass-react', { recursive: true });
cpSync('present/liquid-glass.html', 'public/present/liquid-glass.html');
cpSync('present/liquid-glass-react/liquid-glass.css', 'public/present/liquid-glass-react/liquid-glass.css');
cpSync(bundledOut, 'public/present/liquid-glass-react/liquid-glass.js');
