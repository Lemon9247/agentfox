// ============================================================
// Command Protocol — messages between MCP server and extension
// ============================================================

/** Actions the MCP server can request from the extension */
export type ActionType =
  | 'navigate'
  | 'navigate_back'
  | 'snapshot'
  | 'screenshot'
  | 'click'
  | 'type'
  | 'press_key'
  | 'hover'
  | 'fill_form'
  | 'select_option'
  | 'evaluate'
  | 'wait_for'
  | 'tabs'
  | 'close'
  | 'resize';

/** Command sent from MCP server to extension via native messaging */
export interface Command {
  id: string;
  action: ActionType;
  params: Record<string, unknown>;
}

/** Response from extension back to MCP server */
export interface CommandResponse {
  id: string;
  success: boolean;
  result?: unknown;
  error?: string;
}

// ============================================================
// Accessibility Tree — page representation for AI agents
// ============================================================

/** A node in the accessibility tree sent in snapshot responses */
export interface AccessibilityNode {
  /** ARIA role or semantic role (button, link, textbox, heading, etc.) */
  role: string;
  /** Accessible name (text content, aria-label, alt text, etc.) */
  name: string;
  /** Unique ref ID for interactive elements (e.g., "e1", "e2") */
  ref?: string;
  /** Current value for form elements */
  value?: string;
  /** Heading level (1-6) for heading roles */
  level?: number;
  /** Checkbox/radio checked state */
  checked?: boolean;
  /** Whether the element is disabled */
  disabled?: boolean;
  /** Whether a collapsible element is expanded */
  expanded?: boolean;
  /** Whether an option is selected */
  selected?: boolean;
  /** Whether the element is required */
  required?: boolean;
  /** Description text (aria-describedby, title, etc.) */
  description?: string;
  /** Child nodes */
  children?: AccessibilityNode[];
}

// ============================================================
// Tool Parameter Types — typed params for each action
// ============================================================

export interface NavigateParams {
  url: string;
}

export interface ClickParams {
  ref: string;
  /** Human-readable element description */
  element?: string;
  button?: 'left' | 'right' | 'middle';
  modifiers?: Array<'Alt' | 'Control' | 'Meta' | 'Shift'>;
  doubleClick?: boolean;
}

export interface TypeParams {
  ref: string;
  text: string;
  /** Whether to press Enter after typing */
  submit?: boolean;
  /** Whether to type one character at a time */
  slowly?: boolean;
  /** Human-readable element description */
  element?: string;
}

export interface PressKeyParams {
  key: string;
}

export interface HoverParams {
  ref: string;
  element?: string;
}

export interface FillFormParams {
  fields: Array<{
    ref: string;
    name: string;
    type: 'textbox' | 'checkbox' | 'radio' | 'combobox' | 'slider';
    value: string;
  }>;
}

export interface SelectOptionParams {
  ref: string;
  values: string[];
  element?: string;
}

export interface EvaluateParams {
  /** JavaScript function body to execute */
  function: string;
  /** Optional element ref to pass to the function */
  ref?: string;
  element?: string;
}

export interface WaitForParams {
  /** Text to wait for to appear */
  text?: string;
  /** Text to wait for to disappear */
  textGone?: string;
  /** Time to wait in seconds */
  time?: number;
}

export interface TabsParams {
  action: 'list' | 'new' | 'close' | 'select';
  /** Tab index for close/select */
  index?: number;
}

export interface ScreenshotParams {
  type?: 'png' | 'jpeg';
  fullPage?: boolean;
  /** Optional element ref to screenshot */
  ref?: string;
  element?: string;
}

export interface ResizeParams {
  width: number;
  height: number;
}

// ============================================================
// Result Types — typed results for each action
// ============================================================

export interface NavigateResult {
  url: string;
  title: string;
}

export interface SnapshotResult {
  tree: AccessibilityNode;
  url: string;
  title: string;
}

export interface ScreenshotResult {
  /** Base64-encoded image data */
  data: string;
  mimeType: 'image/png' | 'image/jpeg';
}

export interface TabInfo {
  index: number;
  title: string;
  url: string;
  active: boolean;
}

export interface TabsResult {
  tabs: TabInfo[];
}

export interface EvaluateResult {
  value: unknown;
}

export interface WaitForResult {
  matched: boolean;
}

// ============================================================
// IPC Types — communication between MCP server and NM host
// ============================================================

/** Message sent over the Unix socket between MCP server and NM host */
export interface IpcMessage {
  type: 'command' | 'response' | 'ping' | 'pong';
  payload: Command | CommandResponse | null;
}

// ============================================================
// Extension Internal Messages — between background and content
// ============================================================

/** Message from background script to content script */
export interface ContentRequest {
  type: 'content-request';
  id: string;
  action: ActionType;
  params: Record<string, unknown>;
}

/** Response from content script to background script */
export interface ContentResponse {
  type: 'content-response';
  id: string;
  success: boolean;
  result?: unknown;
  error?: string;
}
