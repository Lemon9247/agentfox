// Re-export shared types used in the extension
export type {
  Command,
  CommandResponse,
  ActionType,
  AccessibilityNode,
  ContentRequest,
  ContentResponse,
  NavigateParams,
  ClickParams,
  TypeParams,
  PressKeyParams,
  HoverParams,
  FillFormParams,
  SelectOptionParams,
  EvaluateParams,
  WaitForParams,
  TabsParams,
  ScreenshotParams,
  ResizeParams,
  SnapshotResult,
  ScreenshotResult,
  TabInfo,
  TabsResult,
} from '@agentfox/shared';

/** Map of ref IDs to DOM elements, maintained per page */
export type RefMap = Map<string, Element>;

/** Options for building the accessibility tree */
export interface SnapshotOptions {
  /** Maximum depth to traverse */
  maxDepth?: number;
  /** Only include elements in the visible viewport */
  viewportOnly?: boolean;
  /** Include non-interactive elements */
  includeDecorative?: boolean;
}
