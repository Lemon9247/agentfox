import * as esbuild from 'esbuild';
import { cpSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const watching = process.argv.includes('--watch');

// Extension build config — IIFE for browser context
const extensionConfig: esbuild.BuildOptions = {
  entryPoints: [
    resolve(ROOT, 'extension/src/background.ts'),
    resolve(ROOT, 'extension/src/content.ts'),
  ],
  bundle: true,
  outdir: resolve(ROOT, 'extension/dist'),
  format: 'iife',
  platform: 'browser',
  target: ['firefox115'],
  sourcemap: true,
};

// Server build config — ESM for Node.js
const serverConfig: esbuild.BuildOptions = {
  entryPoints: [
    resolve(ROOT, 'server/src/mcp-server.ts'),
    resolve(ROOT, 'server/src/native-host.ts'),
    resolve(ROOT, 'server/src/cli.ts'),
  ],
  bundle: true,
  outdir: resolve(ROOT, 'server/dist'),
  format: 'esm',
  platform: 'node',
  target: ['node20'],
  sourcemap: true,
  external: ['@modelcontextprotocol/sdk'],
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
};

function copyStaticFiles() {
  const extDist = resolve(ROOT, 'extension/dist');
  mkdirSync(extDist, { recursive: true });

  cpSync(
    resolve(ROOT, 'extension/manifest.json'),
    resolve(extDist, 'manifest.json'),
  );

  const iconsDir = resolve(ROOT, 'extension/icons');
  if (existsSync(iconsDir)) {
    cpSync(iconsDir, resolve(extDist, 'icons'), { recursive: true });
  }
}

async function build() {
  mkdirSync(resolve(ROOT, 'extension/dist'), { recursive: true });
  mkdirSync(resolve(ROOT, 'server/dist'), { recursive: true });

  // Always copy static files (needed for both watch and production)
  copyStaticFiles();

  if (watching) {
    const extCtx = await esbuild.context(extensionConfig);
    const srvCtx = await esbuild.context(serverConfig);
    await Promise.all([extCtx.watch(), srvCtx.watch()]);
    console.log('Watching for changes...');
  } else {
    await Promise.all([
      esbuild.build(extensionConfig),
      esbuild.build(serverConfig),
    ]);
    console.log('Build complete.');
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
