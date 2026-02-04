import type { CommandResponse as _CommandResponse } from '@agentfox/shared';

// Re-export shared types used in the server
export type {
  Command,
  CommandResponse,
  ActionType,
  AccessibilityNode,
  IpcMessage,
  NavigateParams,
  NavigateResult,
  ClickParams,
  TypeParams,
  PressKeyParams,
  HoverParams,
  FillFormParams,
  SelectOptionParams,
  EvaluateParams,
  EvaluateResult,
  WaitForParams,
  WaitForResult,
  TabsParams,
  TabsResult,
  TabInfo,
  ScreenshotParams,
  ScreenshotResult,
  ResizeParams,
  SnapshotResult,
} from '@agentfox/shared';

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
  resolve: (response: _CommandResponse) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}
