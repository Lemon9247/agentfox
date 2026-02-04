import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as net from 'node:net';
import type { Command, CommandResponse, IpcMessage } from '@agentfox/shared';
import type { PendingCommand, ServerConfig } from './types.js';

// ============================================================
// Socket path resolution
// ============================================================

/** Returns the default Unix socket path for IPC communication. */
export function getDefaultSocketPath(): string {
  const xdgRuntime = process.env['XDG_RUNTIME_DIR'];
  if (xdgRuntime) {
    return `${xdgRuntime}/agentfox.sock`;
  }
  return `/tmp/agentfox-${process.getuid?.() ?? process.pid}.sock`;
}

// ============================================================
// Length-prefix framing helpers
// ============================================================

/**
 * Encodes a message as a length-prefixed frame.
 * Format: [4 bytes uint32 BE length][N bytes JSON payload]
 */
function encodeFrame(message: IpcMessage): Buffer {
  const json = JSON.stringify(message);
  const payload = Buffer.from(json, 'utf-8');
  const frame = Buffer.alloc(4 + payload.length);
  frame.writeUInt32BE(payload.length, 0);
  payload.copy(frame, 4);
  return frame;
}

/**
 * Accumulates data from a stream and yields complete framed messages.
 * Handles partial reads across TCP-style stream boundaries.
 */
class FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0);

  /** Append incoming data and extract any complete messages. */
  push(data: Buffer): IpcMessage[] {
    if (this.buffer.length === 0) {
      this.buffer = data;
    } else {
      this.buffer = Buffer.concat([this.buffer, data]);
    }
    const messages: IpcMessage[] = [];

    while (this.buffer.length >= 4) {
      const messageLength = this.buffer.readUInt32BE(0);

      // Guard against absurd lengths (> 64 MB)
      if (messageLength > 64 * 1024 * 1024) {
        throw new Error(`Frame too large: ${messageLength} bytes`);
      }

      if (this.buffer.length < 4 + messageLength) {
        // Not enough data yet for the full message
        break;
      }

      const json = this.buffer.subarray(4, 4 + messageLength).toString('utf-8');
      this.buffer = this.buffer.subarray(4 + messageLength);
      messages.push(JSON.parse(json) as IpcMessage);
    }

    return messages;
  }

  /** Reset the internal buffer. */
  reset(): void {
    this.buffer = Buffer.alloc(0);
  }
}

// ============================================================
// IpcServer — created by the MCP server process
// ============================================================

export interface IpcServerEvents {
  'client-connected': [];
  'client-disconnected': [];
  'error': [Error];
}

export class IpcServer extends EventEmitter<IpcServerEvents> {
  private readonly socketPath: string;
  private readonly defaultTimeout: number;
  private server: net.Server | null = null;
  private client: net.Socket | null = null;
  private decoder = new FrameDecoder();
  private readonly pending = new Map<string, PendingCommand>();

  /** Tracks whether any client has ever successfully connected. */
  private _hasEverConnected = false;

  /** Heartbeat interval timer. */
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  /** Timer for awaiting a pong response. */
  private pongTimeout: ReturnType<typeof setTimeout> | null = null;
  /** Whether we are waiting for a pong from the client. */
  private awaitingPong = false;

  constructor(config: ServerConfig) {
    super();
    this.socketPath = config.socketPath;
    this.defaultTimeout = config.defaultTimeout;
  }

  /** Whether a client (the NM host) is currently connected. */
  get connected(): boolean {
    return this.client !== null;
  }

  /** Whether any client has ever connected since this server started. */
  get hasEverConnected(): boolean {
    return this._hasEverConnected;
  }

  /**
   * Wait for a client to connect, with a timeout.
   * Resolves immediately if a client is already connected.
   * Rejects if no client connects within the specified timeout.
   */
  waitForConnection(timeoutMs: number): Promise<void> {
    if (this.client) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const onConnected = (): void => {
        clearTimeout(timer);
        resolve();
      };

      const timer = setTimeout(() => {
        this.removeListener('client-connected', onConnected);
        reject(new Error(`No client connected within ${timeoutMs}ms`));
      }, timeoutMs);

      this.once('client-connected', onConnected);
    });
  }

  /** Start listening on the Unix domain socket. */
  async start(): Promise<void> {
    // Clean up stale socket file
    try {
      fs.unlinkSync(this.socketPath);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }

    return new Promise<void>((resolve, reject) => {
      const server = net.createServer((socket) => {
        this.handleConnection(socket);
      });

      server.on('error', (err) => {
        this.emit('error', err);
        reject(err);
      });

      server.listen(this.socketPath, () => {
        this.server = server;

        // Replace the startup error handler with a runtime-only handler
        // so the dead `reject` reference is not held in the closure
        server.removeAllListeners('error');
        server.on('error', (err) => {
          this.emit('error', err);
        });

        resolve();
      });
    });
  }

  /** Send a command to the connected NM host and wait for the response. */
  sendCommand(command: Command): Promise<CommandResponse> {
    if (!this.client) {
      return Promise.reject(new Error('No client connected'));
    }

    const message: IpcMessage = { type: 'command', payload: command };
    const frame = encodeFrame(message);

    return new Promise<CommandResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(command.id);
        reject(new Error(`Command ${command.id} timed out after ${this.defaultTimeout}ms`));
      }, this.defaultTimeout);

      const pending: PendingCommand = {
        id: command.id,
        resolve,
        reject,
        timeout,
      };

      this.pending.set(command.id, pending);

      this.client!.write(frame, (err) => {
        if (err) {
          clearTimeout(timeout);
          this.pending.delete(command.id);
          reject(err);
        }
      });
    });
  }

  /** Shut down the server and clean up all resources. */
  close(): void {
    // Stop heartbeat
    this.stopHeartbeat();

    // Reject all pending commands
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('IPC server closing'));
    }
    this.pending.clear();

    // Disconnect client
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }

    // Close the server
    if (this.server) {
      this.server.close();
      this.server = null;
    }

    // Remove socket file
    try {
      fs.unlinkSync(this.socketPath);
    } catch {
      // Ignore cleanup errors
    }

    this.decoder.reset();
  }

  // ---- Heartbeat ----

  private static readonly HEARTBEAT_INTERVAL_MS = 15_000;
  private static readonly PONG_TIMEOUT_MS = 5_000;

  /** Start the heartbeat interval. Sends a ping every 15 seconds. */
  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatInterval = setInterval(() => {
      if (!this.client || this.awaitingPong) {
        return;
      }

      this.awaitingPong = true;
      const ping: IpcMessage = { type: 'ping', payload: null };
      this.client.write(encodeFrame(ping));

      this.pongTimeout = setTimeout(() => {
        // No pong received in time — consider client dead
        this.awaitingPong = false;
        if (this.client) {
          this.emit('error', new Error('Heartbeat timeout: no pong received'));
          this.client.destroy();
        }
      }, IpcServer.PONG_TIMEOUT_MS);
      this.pongTimeout.unref();
    }, IpcServer.HEARTBEAT_INTERVAL_MS);
    this.heartbeatInterval.unref();
  }

  /** Stop the heartbeat interval and clear pending pong timer. */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
    this.awaitingPong = false;
  }

  private handleConnection(socket: net.Socket): void {
    // Only allow one client at a time
    if (this.client) {
      socket.destroy();
      return;
    }

    this.client = socket;
    this._hasEverConnected = true;
    this.decoder.reset();
    this.startHeartbeat();
    this.emit('client-connected');

    socket.on('data', (data: Buffer) => {
      let messages: IpcMessage[];
      try {
        messages = this.decoder.push(data);
      } catch (err) {
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
        socket.destroy();
        return;
      }

      for (const msg of messages) {
        this.handleMessage(msg, socket);
      }
    });

    socket.on('close', () => {
      this.stopHeartbeat();
      this.client = null;
      this.decoder.reset();

      // Reject all pending commands -- the client is gone
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('Client disconnected'));
      }
      this.pending.clear();

      this.emit('client-disconnected');
    });

    socket.on('error', (err) => {
      this.emit('error', err);
    });
  }

  private handleMessage(msg: IpcMessage, socket: net.Socket): void {
    switch (msg.type) {
      case 'response': {
        const pending = this.pending.get(msg.payload.id);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pending.delete(msg.payload.id);
          pending.resolve(msg.payload);
        }
        break;
      }

      case 'ping': {
        const pong: IpcMessage = { type: 'pong', payload: null };
        socket.write(encodeFrame(pong));
        break;
      }

      case 'pong': {
        // Heartbeat response received — client is alive
        this.awaitingPong = false;
        if (this.pongTimeout) {
          clearTimeout(this.pongTimeout);
          this.pongTimeout = null;
        }
        break;
      }

      default:
        // Ignore unexpected message types on the server side
        break;
    }
  }
}

// ============================================================
// IpcClient — created by the Native Messaging host process
// ============================================================

export interface IpcClientOptions {
  socketPath: string;
  onCommand: (command: Command) => void;
  /** Called when the socket closes or errors after a successful connection. */
  onDisconnect?: (reason: string) => void;
}

export class IpcClient {
  private readonly socketPath: string;
  private readonly onCommand: (command: Command) => void;
  private readonly onDisconnect?: (reason: string) => void;
  private socket: net.Socket | null = null;
  private decoder = new FrameDecoder();

  constructor(options: IpcClientOptions) {
    this.socketPath = options.socketPath;
    this.onCommand = options.onCommand;
    this.onDisconnect = options.onDisconnect;
  }

  /** Whether the client is connected to the IPC server. */
  get connected(): boolean {
    return this.socket !== null && !this.socket.destroyed;
  }

  /** Connect to the IPC server's Unix domain socket. */
  connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const socket = net.createConnection(this.socketPath, () => {
        this.socket = socket;
        resolve();
      });

      socket.on('error', (err) => {
        if (!this.socket) {
          // Connection phase: reject the promise
          reject(err);
        } else {
          // Post-connection: notify via callback
          this.onDisconnect?.(`Socket error: ${err.message}`);
        }
      });

      socket.on('data', (data: Buffer) => {
        let messages: IpcMessage[];
        try {
          messages = this.decoder.push(data);
        } catch {
          // Framing error -- disconnect
          socket.destroy();
          return;
        }

        for (const msg of messages) {
          this.handleMessage(msg);
        }
      });

      socket.on('close', () => {
        const wasConnected = this.socket !== null;
        this.socket = null;
        this.decoder.reset();
        if (wasConnected) {
          this.onDisconnect?.('Socket closed');
        }
      });
    });
  }

  /** Send a response back to the MCP server. */
  sendResponse(response: CommandResponse): void {
    if (!this.socket || this.socket.destroyed) {
      throw new Error('Not connected to IPC server');
    }

    const message: IpcMessage = { type: 'response', payload: response };
    this.socket.write(encodeFrame(message), (err) => {
      if (err) {
        this.onDisconnect?.(`Write error: ${err.message}`);
      }
    });
  }

  /** Close the connection to the IPC server. */
  close(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.decoder.reset();
  }

  private handleMessage(msg: IpcMessage): void {
    switch (msg.type) {
      case 'command': {
        this.onCommand(msg.payload);
        break;
      }

      case 'ping': {
        const pong: IpcMessage = { type: 'pong', payload: null };
        if (this.socket && !this.socket.destroyed) {
          this.socket.write(encodeFrame(pong));
        }
        break;
      }

      default:
        // Ignore unexpected message types on the client side
        break;
    }
  }
}
