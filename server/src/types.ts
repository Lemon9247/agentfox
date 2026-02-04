import type { CommandResponse } from '@agentfox/shared';

export type * from '@agentfox/shared';

/** Configuration for the MCP server */
export interface ServerConfig {
  /** Path to the Unix socket for IPC */
  socketPath: string;
  /** Default timeout for commands in milliseconds */
  defaultTimeout: number;
}

/** Tracks a pending command waiting for a response */
export interface PendingCommand {
  id: string;
  resolve: (response: CommandResponse) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}
