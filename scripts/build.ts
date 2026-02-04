import * as esbuild from 'esbuild';
import { cpSync, mkdirSync } from 'fs';
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

async function build() {
  // Ensure output dirs exist
  mkdirSync(resolve(ROOT, 'extension/dist'), { recursive: true });
  mkdirSync(resolve(ROOT, 'server/dist'), { recursive: true });

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

    // Copy extension static files to dist
    cpSync(
      resolve(ROOT, 'extension/manifest.json'),
      resolve(ROOT, 'extension/dist/manifest.json'),
    );

    const iconsDir = resolve(ROOT, 'extension/icons');
    const distIconsDir = resolve(ROOT, 'extension/dist/icons');
    try {
      cpSync(iconsDir, distIconsDir, { recursive: true });
    } catch {
      // Icons may not exist yet
    }

    console.log('Build complete.');
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
