import { mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXTENSION_ID = 'agentfox@willow.sh';
const NM_HOST_NAME = 'agentfox';

const USAGE = `Agent Fox — AI browser agent for Firefox

Usage: agentfox <command>

Commands:
  setup    Install native messaging host and show MCP config

Options:
  --help   Show this help message
`;

/**
 * Resolve the absolute path to a sibling bin script.
 * At runtime, import.meta.url points to server/dist/cli.js.
 * Bin scripts live at server/bin/<name>.
 */
function resolveBinPath(name: string): string {
  const distDir = dirname(fileURLToPath(import.meta.url));
  const binPath = resolve(distDir, '..', 'bin', name);
  // Resolve symlinks to get the canonical absolute path
  return realpathSync(binPath);
}

/**
 * Get the platform-specific directory for native messaging host manifests.
 */
function getNativeMessagingHostDir(): string {
  const home = homedir();
  const plat = platform();

  if (plat === 'linux') {
    return join(home, '.mozilla', 'native-messaging-hosts');
  }
  if (plat === 'darwin') {
    return join(home, 'Library', 'Application Support', 'Mozilla', 'NativeMessagingHosts');
  }

  console.log(`Error: Unsupported platform "${plat}". Only Linux and macOS are supported.`);
  process.exit(1);
}

/**
 * Generate the native messaging host manifest JSON.
 */
function generateManifest(nmHostPath: string): string {
  const manifest = {
    name: NM_HOST_NAME,
    description: 'Agent Fox native messaging host',
    path: nmHostPath,
    type: 'stdio',
    allowed_extensions: [EXTENSION_ID],
  };
  return JSON.stringify(manifest, null, 2);
}

/**
 * The `setup` subcommand: installs the NM host manifest and prints MCP config.
 */
function setup(): void {
  // Resolve bin paths
  const nmHostPath = resolveBinPath('agentfox-nm-host');
  const mcpPath = resolveBinPath('agentfox-mcp');

  // Determine manifest location
  const nmHostDir = getNativeMessagingHostDir();
  const manifestPath = join(nmHostDir, `${NM_HOST_NAME}.json`);

  // Write the native messaging host manifest
  mkdirSync(nmHostDir, { recursive: true });
  writeFileSync(manifestPath, generateManifest(nmHostPath) + '\n');

  console.log(`Native messaging host manifest installed at: ${manifestPath}`);
  console.log();

  // Print Claude Code MCP config
  console.log('Add the following to your Claude Code MCP settings:');
  console.log();
  console.log(JSON.stringify({
    mcpServers: {
      agentfox: {
        command: 'node',
        args: [mcpPath],
      },
    },
  }, null, 2));
  console.log();

  // Print extension installation instructions
  const distDir = dirname(fileURLToPath(import.meta.url));
  const extensionDistDir = resolve(distDir, '..', '..', 'extension', 'dist');
  console.log('To install the extension:');
  console.log(`  1. Open Firefox and navigate to about:debugging#/runtime/this-firefox`);
  console.log(`  2. Click "Load Temporary Add-on..."`);
  console.log(`  3. Select any file in: ${extensionDistDir}`);
}

/**
 * Main entry point — parse args and dispatch subcommand.
 */
function main(): void {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    console.log(USAGE);
    return;
  }

  if (command === 'setup') {
    setup();
    return;
  }

  console.log(`Unknown command: ${command}`);
  console.log();
  console.log(USAGE);
  process.exit(1);
}

main();
