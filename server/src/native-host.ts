/**
 * Native Messaging Host Relay
 *
 * This process is launched by Firefox when the extension calls
 * `browser.runtime.connectNative('agentfox')`. It bridges two protocols:
 *
 *   Firefox (stdin/stdout)  <-->  MCP Server (Unix socket IPC)
 *
 * Native messaging framing (Firefox):
 *   [4 bytes: uint32 LE length] [N bytes: JSON payload]
 *
 * IPC framing (MCP server):
 *   [4 bytes: uint32 BE length] [N bytes: JSON payload]
 *
 * Data flow:
 *   MCP Server --[IPC: Command]--> NM Host --[stdout]--> Firefox
 *   MCP Server <--[IPC: Response]-- NM Host <--[stdin]-- Firefox
 *
 * IMPORTANT: stdout is reserved exclusively for native messaging.
 * All logging MUST go to stderr.
 */

import type { Command, CommandResponse } from '@agentfox/shared';
import { IpcClient, getDefaultSocketPath } from './ipc.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Interval (ms) between IPC connection health checks. */
const HEALTH_CHECK_INTERVAL_MS = 1000;

// ---------------------------------------------------------------------------
// Logging -- everything goes to stderr, stdout is sacred
// ---------------------------------------------------------------------------

function log(message: string): void {
  process.stderr.write(`[agentfox-nm-host] ${message}\n`);
}

function logError(message: string, error?: unknown): void {
  const errorDetail =
    error instanceof Error ? error.message : String(error ?? '');
  process.stderr.write(
    `[agentfox-nm-host] ERROR: ${message}${errorDetail ? ': ' + errorDetail : ''}\n`,
  );
}

// ---------------------------------------------------------------------------
// Native Messaging Protocol (stdin/stdout) -- 4-byte uint32 LE framing
// ---------------------------------------------------------------------------

/**
 * Reads native messaging framed messages from a readable stream.
 *
 * Each message is framed as:
 *   [4 bytes: uint32 LE length] [N bytes: JSON payload]
 *
 * Handles partial reads by accumulating data into an internal buffer.
 * Yields parsed JSON objects as they become complete.
 */
async function* readNativeMessages(
  stream: NodeJS.ReadableStream,
): AsyncGenerator<unknown> {
  let buffer = Buffer.alloc(0);

  for await (const chunk of stream) {
    buffer = Buffer.concat([buffer, chunk as Buffer]);

    // Process as many complete messages as available in the buffer
    while (buffer.length >= 4) {
      const messageLength = buffer.readUInt32LE(0);

      // Sanity check: native messaging has a 1MB limit
      if (messageLength > 1024 * 1024) {
        throw new Error(
          `Native message length ${messageLength} exceeds 1MB limit`,
        );
      }

      // Not enough data yet for the full message -- wait for more
      if (buffer.length < 4 + messageLength) {
        break;
      }

      // Extract and parse the message
      const jsonBytes = buffer.subarray(4, 4 + messageLength);
      buffer = buffer.subarray(4 + messageLength);

      try {
        const message: unknown = JSON.parse(jsonBytes.toString('utf-8'));
        yield message;
      } catch (err) {
        logError('Failed to parse native message JSON, skipping', err);
      }
    }
  }
}

/**
 * Writes a native messaging framed message to stdout.
 *
 * Serializes the data as JSON, prepends a 4-byte uint32 LE length prefix,
 * and writes to stdout. Returns a promise that resolves when the write
 * completes (or the data is flushed).
 */
function writeNativeMessage(data: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const json = JSON.stringify(data);
    const payload = Buffer.from(json, 'utf-8');

    const header = Buffer.alloc(4);
    header.writeUInt32LE(payload.length, 0);

    const frame = Buffer.concat([header, payload]);

    process.stdout.write(frame, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Main relay logic
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log('Starting native messaging host relay');

  // Ensure stdin is flowing (it starts paused in Node.js)
  process.stdin.resume();

  // Track whether we're shutting down to avoid duplicate cleanup
  let shuttingDown = false;
  let ipc: IpcClient | null = null;

  function shutdown(reason: string): void {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`Shutting down: ${reason}`);

    try {
      ipc?.close();
    } catch {
      // Ignore errors during cleanup
    }

    // Give a brief moment for any final writes to stderr, then exit
    setTimeout(() => process.exit(0), 50);
  }

  // --- Create IPC client with command handler ---
  // When the MCP server sends a command over IPC, relay it to Firefox via stdout.
  // Writes are serialized through a promise chain to prevent interleaving
  // under backpressure (H4 fix).
  let writeChain = Promise.resolve();
  const socketPath = getDefaultSocketPath();
  log(`Connecting to MCP server at ${socketPath}`);

  ipc = new IpcClient({
    socketPath,
    onCommand: (command: Command): void => {
      log(`Relaying command to Firefox: ${command.action} (id: ${command.id})`);
      writeChain = writeChain
        .then(() => writeNativeMessage(command))
        .catch((error) => {
          logError('Failed to write command to stdout', error);
          shutdown('stdout write failed');
        });
    },
  });

  // --- Connect to MCP server ---
  try {
    await ipc.connect();
    log('Connected to MCP server');
  } catch (error) {
    logError('Failed to connect to MCP server', error);
    process.exit(1);
  }

  // --- Monitor IPC connection health ---
  // The IpcClient doesn't expose an onDisconnect callback, so we poll
  // the connected property to detect when the MCP server goes away.
  const healthCheckInterval = setInterval(() => {
    if (!ipc?.connected) {
      clearInterval(healthCheckInterval);
      shutdown('IPC connection lost (MCP server stopped)');
    }
  }, HEALTH_CHECK_INTERVAL_MS);

  // --- stdin -> IPC: Relay responses from Firefox to MCP server ---
  try {
    for await (const message of readNativeMessages(process.stdin)) {
      const response = message as CommandResponse;

      if (!response.id) {
        logError('Received message from Firefox without id, skipping');
        continue;
      }

      log(
        `Relaying response from Firefox: id=${response.id} success=${response.success}`,
      );

      try {
        ipc.sendResponse(response);
      } catch (error) {
        logError('Failed to send response over IPC', error);
        // Don't shutdown on individual send failures -- if the IPC
        // connection is truly gone, the health check will catch it
      }
    }
  } catch (error) {
    logError('Error reading from stdin', error);
  }

  // stdin closed -- Firefox disconnected the native messaging port
  clearInterval(healthCheckInterval);
  shutdown('stdin closed (Firefox disconnected)');
}

// --- Process-level error handlers ---

process.on('uncaughtException', (error) => {
  logError('Uncaught exception', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logError('Unhandled rejection', reason);
  process.exit(1);
});

// --- Run ---
main().catch((error) => {
  logError('Fatal error in main', error);
  process.exit(1);
});
