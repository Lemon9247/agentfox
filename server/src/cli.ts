import { existsSync, mkdirSync, writeFileSync, realpathSync, unlinkSync } from 'node:fs';
import * as net from 'node:net';
import { homedir, platform } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getDefaultSocketPath } from './ipc.js';

const EXTENSION_ID = 'agentfox@willow.sh';

// NM_HOST_NAME must match the manifest filename (per Mozilla native messaging spec)
const NM_HOST_NAME = 'agentfox';

const VERSION = '0.1.0';

// Resolved once at module scope and reused by all path-resolution helpers.
const DIST_DIR = dirname(fileURLToPath(import.meta.url));

const USAGE = `Agent Fox v${VERSION} — AI browser agent for Firefox

Usage: agentfox <command>

Commands:
  setup      Install native messaging host and show MCP config
  status     Check Agent Fox connectivity status
  uninstall  Remove native messaging host manifest

Options:
  -h, --help      Show this help message
  -v, --version   Show version number
`;

/**
 * Resolve the absolute path to a sibling bin script.
 * At runtime, import.meta.url points to server/dist/cli.js.
 * Bin scripts live at server/bin/<name>.
 */
function resolveBinPath(name: string): string {
  const binPath = resolve(DIST_DIR, '..', 'bin', name);
  // Resolve symlinks to get the canonical absolute path
  try {
    return realpathSync(binPath);
  } catch {
    throw new Error(
      `Could not find bin script at ${binPath}\nMake sure the project is built correctly.`,
    );
  }
}

/**
 * Get the platform-specific directory for native messaging host manifests.
 * Throws on unsupported platforms — callers handle the error.
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

  throw new Error(`Unsupported platform "${plat}". Only Linux and macOS are supported.`);
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
  return JSON.stringify(manifest, null, 2) + '\n';
}

/**
 * The `setup` subcommand: installs the NM host manifest and prints MCP config.
 */
function setup(): void {
  try {
    // Resolve bin paths
    const nmHostPath = resolveBinPath('agentfox-nm-host');
    const mcpPath = resolveBinPath('agentfox-mcp');

    // Determine manifest location
    const nmHostDir = getNativeMessagingHostDir();
    const manifestPath = join(nmHostDir, `${NM_HOST_NAME}.json`);

    // Write the native messaging host manifest
    try {
      mkdirSync(nmHostDir, { recursive: true });
      writeFileSync(manifestPath, generateManifest(nmHostPath));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to write manifest to ${manifestPath}\n${message}`);
    }

    console.log(`Native messaging host manifest installed at: ${manifestPath}`);
    console.log();

    // Print Claude Code MCP config
    console.log(
      'Add the following to your Claude Code settings (Settings > MCP Servers) or ~/.claude.json:',
    );
    console.log();
    console.log(JSON.stringify({
      mcpServers: {
        agentfox: {
          command: mcpPath,
        },
      },
    }, null, 2));
    console.log();

    // Print extension installation instructions
    const extensionDistDir = resolve(DIST_DIR, '..', '..', 'extension', 'dist');
    console.log('To install the extension:');
    if (!existsSync(extensionDistDir)) {
      console.warn(`  Warning: Extension dist not found at ${extensionDistDir}`);
      console.warn('  You may need to build the extension first: pnpm build');
    } else {
      console.log(`  1. Open Firefox and navigate to about:debugging#/runtime/this-firefox`);
      console.log(`  2. Click "Load Temporary Add-on..."`);
      console.log(`  3. Select any file in: ${extensionDistDir}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

/**
 * Try to connect to the Unix socket to see if the MCP server is running.
 * Returns true if a connection was established within 1 second.
 */
function checkSocketConnectivity(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(socketPath, () => {
      socket.destroy();
      resolve(true);
    });
    socket.setTimeout(1000);
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/**
 * The `status` subcommand: checks connectivity of Agent Fox components.
 */
async function status(): Promise<void> {
  console.log('Agent Fox Status');
  console.log('\u2500'.repeat(16));

  // Check native messaging host manifest
  try {
    const nmHostDir = getNativeMessagingHostDir();
    const manifestPath = join(nmHostDir, `${NM_HOST_NAME}.json`);
    if (existsSync(manifestPath)) {
      console.log(`NM host manifest: \u2713 Installed (${manifestPath})`);
    } else {
      console.log(`NM host manifest: \u2717 Not found (expected at ${manifestPath})`);
      console.log('                  Run "agentfox setup" to install');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`NM host manifest: \u2717 ${message}`);
  }

  // Check socket file and MCP server connectivity
  const socketPath = getDefaultSocketPath();
  if (existsSync(socketPath)) {
    const connected = await checkSocketConnectivity(socketPath);
    if (connected) {
      console.log(`MCP server:       \u2713 Running (socket: ${socketPath})`);
    } else {
      console.log(`MCP server:       \u2717 Socket exists but not responding (${socketPath})`);
    }
  } else {
    console.log(`MCP server:       \u2717 Not running (no socket at ${socketPath})`);
  }

  // Extension status — can't check from CLI
  console.log('Extension:        ? (cannot check from CLI)');
}

/**
 * The `uninstall` subcommand: removes the native messaging host manifest.
 */
function uninstall(): void {
  try {
    const nmHostDir = getNativeMessagingHostDir();
    const manifestPath = join(nmHostDir, `${NM_HOST_NAME}.json`);

    if (!existsSync(manifestPath)) {
      console.log(`Native messaging host manifest not found at: ${manifestPath}`);
      console.log('Nothing to remove.');
      return;
    }

    unlinkSync(manifestPath);
    console.log(`Removed native messaging host manifest: ${manifestPath}`);
    console.log();
    console.log('Note: To fully remove Agent Fox from Claude Code, also remove the');
    console.log('"agentfox" entry from your MCP servers configuration in ~/.claude.json');
    console.log('or Claude Code Settings > MCP Servers.');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

/**
 * Main entry point — parse args and dispatch subcommand.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    console.log(USAGE);
    return;
  }

  if (command === '--version' || command === '-v') {
    console.log(VERSION);
    return;
  }

  if (command === 'setup') {
    setup();
    return;
  }

  if (command === 'status') {
    await status();
    return;
  }

  if (command === 'uninstall') {
    uninstall();
    return;
  }

  console.error(`Unknown command: ${command}`);
  console.error();
  console.error(USAGE);
  process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
