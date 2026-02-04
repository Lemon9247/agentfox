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
  | 'resize'
  | 'get_cookies'
  | 'get_bookmarks'
  | 'get_history'
  | 'network_requests'
  | 'save_pdf'
  | 'page_content';

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

/** At least one of text, textGone, or time must be provided */
export type WaitForParams =
  | { text: string; textGone?: undefined; time?: undefined }
  | { text?: undefined; textGone: string; time?: undefined }
  | { text?: undefined; textGone?: undefined; time: number }
  | { text: string; time: number; textGone?: undefined }
  | { textGone: string; time: number; text?: undefined };

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

export interface GetCookiesParams {
  url?: string;
}

export interface GetBookmarksParams {
  query?: string;
}

export interface GetHistoryParams {
  query?: string;
  maxResults?: number;
  startTime?: string;
  endTime?: string;
}

export interface NetworkRequestsParams {
  action: 'start' | 'stop' | 'get' | 'clear';
  filter?: string;
}

export interface SavePdfParams {
  headerLeft?: string;
  headerRight?: string;
  footerLeft?: string;
  footerRight?: string;
}

export interface PageContentParams {
  selector?: string;
}

/** No params needed */
export type EmptyParams = Record<string, never>;

// ============================================================
// Command — discriminated union keyed on action
// ============================================================

interface CommandBase {
  id: string;
}

/** Command sent from MCP server to extension via native messaging */
export type Command =
  | CommandBase & { action: 'navigate'; params: NavigateParams }
  | CommandBase & { action: 'navigate_back'; params: EmptyParams }
  | CommandBase & { action: 'snapshot'; params: EmptyParams }
  | CommandBase & { action: 'screenshot'; params: ScreenshotParams }
  | CommandBase & { action: 'click'; params: ClickParams }
  | CommandBase & { action: 'type'; params: TypeParams }
  | CommandBase & { action: 'press_key'; params: PressKeyParams }
  | CommandBase & { action: 'hover'; params: HoverParams }
  | CommandBase & { action: 'fill_form'; params: FillFormParams }
  | CommandBase & { action: 'select_option'; params: SelectOptionParams }
  | CommandBase & { action: 'evaluate'; params: EvaluateParams }
  | CommandBase & { action: 'wait_for'; params: WaitForParams }
  | CommandBase & { action: 'tabs'; params: TabsParams }
  | CommandBase & { action: 'close'; params: EmptyParams }
  | CommandBase & { action: 'resize'; params: ResizeParams }
  | CommandBase & { action: 'get_cookies'; params: GetCookiesParams }
  | CommandBase & { action: 'get_bookmarks'; params: GetBookmarksParams }
  | CommandBase & { action: 'get_history'; params: GetHistoryParams }
  | CommandBase & { action: 'network_requests'; params: NetworkRequestsParams }
  | CommandBase & { action: 'save_pdf'; params: SavePdfParams }
  | CommandBase & { action: 'page_content'; params: PageContentParams };

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

export interface CookieInfo {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string;
  expirationDate?: number;
}

export interface GetCookiesResult {
  cookies: CookieInfo[];
}

export interface BookmarkInfo {
  id: string;
  title: string;
  url?: string;
  dateAdded?: number;
}

export interface GetBookmarksResult {
  bookmarks: BookmarkInfo[];
}

export interface HistoryItem {
  url: string;
  title: string;
  visitCount: number;
  lastVisitTime: number;
}

export interface GetHistoryResult {
  items: HistoryItem[];
}

export interface NetworkRequestInfo {
  url: string;
  method: string;
  statusCode: number;
  type: string;
  timeStamp: number;
}

export interface NetworkRequestsResult {
  requests?: NetworkRequestInfo[];
  recording?: boolean;
  count?: number;
}

export interface SavePdfResult {
  saved: boolean;
  status: string;
}

export interface PageContentResult {
  text: string;
  url: string;
  title: string;
}

// ============================================================
// IPC Types — communication between MCP server and NM host
// ============================================================

/** Message sent over the Unix socket between MCP server and NM host */
export type IpcMessage =
  | { type: 'command'; payload: Command }
  | { type: 'response'; payload: CommandResponse }
  | { type: 'ping'; payload: null }
  | { type: 'pong'; payload: null };

// ============================================================
// Extension Internal Messages — between background and content
// ============================================================

/** Message from background script to content script */
export interface ContentRequest extends CommandBase {
  type: 'content-request';
  action: ActionType;
  params: Command['params'];
}

/** Response from content script to background script */
export interface ContentResponse {
  type: 'content-response';
  id: string;
  success: boolean;
  result?: unknown;
  error?: string;
}
