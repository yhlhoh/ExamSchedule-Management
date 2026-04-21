import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync } from 'node:fs';

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

const filesToCopy = [
  ['present/liquid-glass.html', 'public/present/liquid-glass.html'],
  ['present/liquid-glass-react/liquid-glass.css', 'public/present/liquid-glass-react/liquid-glass.css'],
  [bundledOut, 'public/present/liquid-glass-react/liquid-glass.js']
];

mkdirSync('public/present/liquid-glass-react', { recursive: true });
for (const [source, target] of filesToCopy) {
  if (!existsSync(source)) {
    throw new Error(`Missing required source file: ${source}`);
  }
  try {
    cpSync(source, target);
  } catch (error) {
    throw new Error(`Failed to copy ${source} -> ${target}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
