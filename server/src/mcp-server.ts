import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { Command } from '@agentfox/shared';
import { IpcServer, getDefaultSocketPath } from './ipc.js';
import { tools, getToolByName } from './tools/index.js';
import type { ServerConfig } from './types.js';

// ============================================================
// Constants
// ============================================================

const SERVER_NAME = 'agentfox';
// TODO: read from package.json at build time
const SERVER_VERSION = '0.1.0';
const DEFAULT_TIMEOUT_MS = 30_000;
const CONNECTION_WAIT_MS = 5_000;

// ============================================================
// Logging — stderr only (stdout is the MCP protocol channel)
// ============================================================

function log(...args: unknown[]): void {
  process.stderr.write(`[AgentFox:mcp] ${args.map(String).join(' ')}\n`);
}

function logError(...args: unknown[]): void {
  process.stderr.write(`[AgentFox:mcp] ERROR: ${args.map(String).join(' ')}\n`);
}

// ============================================================
// Main
// ============================================================

export async function main(): Promise<void> {
  // ---- IPC Server (connects to the NM host / extension) ----
  const config: ServerConfig = {
    socketPath: getDefaultSocketPath(),
    defaultTimeout: DEFAULT_TIMEOUT_MS,
  };

  const ipcServer = new IpcServer(config);

  ipcServer.on('client-connected', () => {
    log('Extension connected via native messaging host');
  });
  ipcServer.on('client-disconnected', () => {
    log('Extension disconnected');
  });
  ipcServer.on('error', (err) => {
    logError('IPC error:', err.message);
  });

  await ipcServer.start();
  log(`IPC server listening on ${config.socketPath}`);

  // ---- MCP Server (talks to Claude Code over stdio) ----
  const mcpServer = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // ---- tools/list handler ----
  mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as {
          type: 'object';
          properties?: Record<string, unknown>;
          required?: string[];
        },
      })),
    };
  });

  // ---- tools/call handler ----
  mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    const tool = getToolByName(name);
    if (!tool) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    // If not connected, wait briefly for the client to connect.
    // This handles the race where the MCP server starts before Firefox/NM host.
    if (!ipcServer.connected) {
      try {
        log('Waiting for browser extension to connect...');
        await ipcServer.waitForConnection(CONNECTION_WAIT_MS);
        log('Browser extension connected after waiting');
      } catch {
        const message = ipcServer.hasEverConnected
          ? 'Browser extension disconnected. The Firefox extension or native messaging host may have stopped.'
          : 'Browser extension is not connected. Make sure Firefox is running with the Agent Fox extension installed.';
        return {
          content: [{ type: 'text', text: message }],
          isError: true,
        };
      }
    }

    // Build the Command for the extension.
    // The MCP SDK validates args against inputSchema before reaching this point,
    // so the action-params pairing is guaranteed correct. The discriminated union
    // cannot be constructed generically without a type assertion.
    const command = {
      id: crypto.randomUUID(),
      action: tool.action,
      params: args ?? {},
    } as Command;

    try {
      const response = await ipcServer.sendCommand(command);

      if (!response.success) {
        return {
          content: [
            { type: 'text', text: response.error ?? 'Command failed' },
          ],
          isError: true,
        };
      }

      return {
        content: tool.formatResult(response.result),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError(`Tool ${name} failed:`, message);
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  // ---- Graceful shutdown ----
  async function shutdown(): Promise<void> {
    log('Shutting down...');
    ipcServer.close();
    try {
      await mcpServer.close();
    } catch {
      /* ignore close errors */
    }
    process.exit(0);
  }

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  // ---- Connect transport and start ----
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  log('MCP server running on stdio');
}

// Entry point
main().catch((err) => {
  logError('Fatal:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
