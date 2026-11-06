// Bundles the plugin sandbox code and the UI (inlined into a single HTML file).
import { build, context } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const watch = process.argv.includes('--watch');
await mkdir('dist', { recursive: true });

const pluginOpts = {
  entryPoints: ['src/plugin/main.ts'],
  bundle: true,
  outfile: 'dist/code.js',
  target: 'es2017', // Figma's sandbox: keep syntax conservative
  format: 'iife',
  logLevel: 'info',
};

async function buildUi() {
  const result = await build({
    entryPoints: ['src/ui/ui.ts'],
    bundle: true,
    write: false,
    target: 'es2020',
    format: 'iife',
    minify: false,
  });
  const js = result.outputFiles[0].text;
  const css = await readFile('src/ui/ui.css', 'utf8');
  const html = await readFile('src/ui/index.html', 'utf8');
  const out = html
    .replace('/*__CSS__*/', () => css)
    .replace('/*__JS__*/', () => js.replace(/<\/script>/g, '<\\/script>'));
  await writeFile('dist/ui.html', out);
  console.log('  dist/ui.html');
}

if (watch) {
  const ctx = await context(pluginOpts);
  await ctx.watch();
  const uiCtx = await context({
    entryPoints: ['src/ui/ui.ts'], bundle: true, write: false,
    plugins: [{ name: 'inline', setup(b) { b.onEnd(() => buildUi()); } }],
  });
  await uiCtx.watch();
} else {
  await build(pluginOpts);
  await buildUi();
}
