// Agent Fox Firefox Extension — Background Script
// Central hub: connects to native messaging host, routes commands to
// browser APIs or content scripts, and relays responses back.

import type {
  Command,
  CommandResponse,
  ContentRequest,
  ContentResponse,
  ActionType,
  TabInfo,
} from '@agentfox/shared';

// ============================================================
// Minimal Firefox WebExtension API type declarations
// ============================================================

declare namespace browser {
  namespace runtime {
    function connectNative(application: string): Port;
    const lastError: { message: string } | undefined;
  }
  namespace tabs {
    function query(queryInfo: {
      active?: boolean;
      currentWindow?: boolean;
    }): Promise<Tab[]>;
    function update(
      tabId: number,
      updateProperties: { url?: string; active?: boolean },
    ): Promise<Tab>;
    function create(createProperties: { url?: string }): Promise<Tab>;
    function remove(tabIds: number | number[]): Promise<void>;
    function goBack(tabId?: number): Promise<void>;
    function captureVisibleTab(
      windowId: number | null,
      options?: { format?: string; quality?: number },
    ): Promise<string>;
    function sendMessage(
      tabId: number,
      message: unknown,
    ): Promise<unknown>;
  }
  namespace windows {
    function update(
      windowId: number,
      updateInfo: { width?: number; height?: number },
    ): Promise<Window>;
  }

  interface Port {
    name: string;
    onMessage: Event<(message: unknown) => void>;
    onDisconnect: Event<(port: Port) => void>;
    postMessage(message: unknown): void;
    error?: { message: string };
  }

  interface Event<T> {
    addListener(callback: T): void;
    removeListener(callback: T): void;
  }

  interface Tab {
    id?: number;
    index: number;
    url?: string;
    title?: string;
    active: boolean;
    windowId: number;
    status?: string;
  }

  interface Window {
    id?: number;
  }

  namespace browserAction {
    function setBadgeText(details: { text: string }): Promise<void>;
    function setBadgeBackgroundColor(details: { color: string }): Promise<void>;
    function setTitle(details: { title: string }): Promise<void>;
  }
}

// ============================================================
// Constants
// ============================================================

const NM_APP_NAME = 'agentfox';
const MAX_RECONNECT_RETRIES = 5;
const BASE_RECONNECT_DELAY_MS = 1000;

/** Actions that require forwarding to the content script */
const CONTENT_SCRIPT_ACTIONS: ReadonlySet<ActionType> = new Set([
  'snapshot',
  'click',
  'type',
  'press_key',
  'hover',
  'fill_form',
  'select_option',
  'evaluate',
  'wait_for',
]);

// ============================================================
// State
// ============================================================

let port: browser.Port | null = null;
let reconnectAttempts = 0;

// ============================================================
// Helpers
// ============================================================

function log(...args: unknown[]): void {
  console.log('[AgentFox:bg]', ...args);
}

function logError(...args: unknown[]): void {
  console.error('[AgentFox:bg]', ...args);
}

/**
 * Get the currently active tab in the current window.
 * Note: `currentWindow: true` means only the browser window the extension
 * considers "current" is queried. In multi-window setups, this may not be
 * the window the user is visually focused on.
 */
async function getActiveTab(): Promise<browser.Tab> {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tabs.length || tabs[0].id === undefined) {
    throw new Error('No active tab found');
  }
  return tabs[0];
}

/** Build and send a CommandResponse to the native messaging port */
function sendResponse(
  nmPort: browser.Port,
  id: string,
  success: boolean,
  result?: unknown,
  error?: string,
): void {
  const response: CommandResponse = { id, success };
  if (result !== undefined) response.result = result;
  if (error !== undefined) response.error = error;
  try {
    nmPort.postMessage(response);
  } catch (err) {
    logError('Failed to send response:', err);
  }
}

/** Forward a command to the active tab's content script */
async function forwardToContentScript(
  command: Command,
): Promise<ContentResponse> {
  const tab = await getActiveTab();
  const tabId = tab.id!;

  const request: ContentRequest = {
    type: 'content-request',
    id: command.id,
    action: command.action,
    params: command.params,
  };

  let response: unknown;
  try {
    response = await browser.tabs.sendMessage(tabId, request);
  } catch (err) {
    // Content script may not be loaded (e.g. about:blank, internal pages,
    // or the content script hasn't injected yet)
    const message =
      err instanceof Error ? err.message : String(err);
    return {
      type: 'content-response',
      id: command.id,
      success: false,
      error: `Content script unavailable in this tab: ${message}`,
    };
  }

  // Validate the response shape
  if (
    response &&
    typeof response === 'object' &&
    'type' in response &&
    (response as ContentResponse).type === 'content-response'
  ) {
    return response as ContentResponse;
  }

  return {
    type: 'content-response',
    id: command.id,
    success: false,
    error: 'Invalid response from content script',
  };
}

// ============================================================
// Tab-level command handlers
// ============================================================

/** Wait for a tab to finish loading (status === 'complete') */
function waitForTabLoad(tabId: number, timeoutMs = 30000): Promise<void> {
  return new Promise((resolve, reject) => {
    function cleanup() {
      clearTimeout(timeout);
      browser.tabs.onUpdated.removeListener(onUpdated);
      browser.tabs.onRemoved.removeListener(onRemoved);
    }

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Tab load timed out'));
    }, timeoutMs);

    // Reject immediately if the tab is closed during navigation
    function onRemoved(removedTabId: number) {
      if (removedTabId === tabId) {
        cleanup();
        reject(new Error('Tab was closed during navigation'));
      }
    }

    // Declare listener with the correct Firefox onUpdated signature
    function onUpdated(
      updatedTabId: number,
      changeInfo: { status?: string },
    ) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        cleanup();
        resolve();
      }
    }

    browser.tabs.onUpdated.addListener(onUpdated);
    browser.tabs.onRemoved.addListener(onRemoved);

    // Check if already complete (handles about:blank, cached pages)
    browser.tabs.query({ currentWindow: true }).then(tabs => {
      const tab = tabs.find(t => t.id === tabId);
      if (tab?.status === 'complete') {
        cleanup();
        resolve();
      }
    });
  });
}

async function handleNavigate(
  command: Command & { action: 'navigate' },
): Promise<{ url: string; title: string }> {
  const { params } = command;
  const tab = await getActiveTab();
  const tabId = tab.id!;

  // Start navigation
  await browser.tabs.update(tabId, { url: params.url });

  // Wait for load to complete
  await waitForTabLoad(tabId);

  // Re-query the tab to get the final URL/title (may have redirected)
  const [updatedTab] = await browser.tabs.query({
    active: true,
    currentWindow: true,
  });

  return {
    url: updatedTab?.url || params.url,
    title: updatedTab?.title || '',
  };
}

async function handleNavigateBack(): Promise<{ url: string; title: string }> {
  const tab = await getActiveTab();
  const tabId = tab.id!;
  const urlBefore = tab.url || '';

  await browser.tabs.goBack(tabId);

  // Brief pause to let any navigation start
  await new Promise((r) => setTimeout(r, 50));

  // Re-query to check if navigation actually occurred
  const [checkTab] = await browser.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (checkTab?.url === urlBefore && checkTab?.status === 'complete') {
    // URL didn't change -- no back history; return current state immediately
    // instead of waiting for a load event that will never fire
    return {
      url: checkTab.url || '',
      title: checkTab.title || '',
    };
  }

  await waitForTabLoad(tabId);

  const [updatedTab] = await browser.tabs.query({
    active: true,
    currentWindow: true,
  });

  return {
    url: updatedTab?.url || '',
    title: updatedTab?.title || '',
  };
}

async function handleScreenshot(
  command: Command & { action: 'screenshot' },
): Promise<{ data: string; mimeType: string }> {
  const { params } = command;
  const format = params.type || 'png';
  const mimeType = `image/${format}`;

  // captureVisibleTab returns a data: URI
  const dataUri = await browser.tabs.captureVisibleTab(null, { format });

  // Strip the data URI prefix to get raw base64
  const prefix = `data:${mimeType};base64,`;
  const data = dataUri.startsWith(prefix)
    ? dataUri.slice(prefix.length)
    : dataUri;

  return { data, mimeType };
}

async function handleTabs(
  command: Command & { action: 'tabs' },
): Promise<unknown> {
  const { params } = command;

  switch (params.action) {
    case 'list': {
      // Note: only tabs in the current window are listed. Multi-window
      // workflows are not visible to the agent.
      const allTabs = await browser.tabs.query({ currentWindow: true });
      const tabs: TabInfo[] = allTabs.map((t) => ({
        index: t.index,
        title: t.title || '',
        url: t.url || '',
        active: t.active,
      }));
      return { tabs };
    }

    case 'new': {
      const newTab = await browser.tabs.create({});
      return {
        index: newTab.index,
        title: newTab.title || '',
        url: newTab.url || '',
        active: newTab.active,
      };
    }

    case 'close': {
      if (params.index !== undefined) {
        // Find the tab at the specified index
        const allTabs = await browser.tabs.query({ currentWindow: true });
        const target = allTabs.find((t) => t.index === params.index);
        if (!target || target.id === undefined) {
          throw new Error(`No tab found at index ${params.index}`);
        }
        await browser.tabs.remove(target.id);
      } else {
        // Close the active tab
        const tab = await getActiveTab();
        await browser.tabs.remove(tab.id!);
      }
      return {};
    }

    case 'select': {
      if (params.index === undefined) {
        throw new Error('Tab index is required for select action');
      }
      const allTabs = await browser.tabs.query({ currentWindow: true });
      const target = allTabs.find((t) => t.index === params.index);
      if (!target || target.id === undefined) {
        throw new Error(`No tab found at index ${params.index}`);
      }
      await browser.tabs.update(target.id, { active: true });
      return {
        index: target.index,
        title: target.title || '',
        url: target.url || '',
        active: true,
      };
    }

    default:
      throw new Error(`Unknown tabs action: ${params.action}`);
  }
}

async function handleClose(): Promise<Record<string, never>> {
  const tab = await getActiveTab();
  await browser.tabs.remove(tab.id!);
  return {};
}

async function handleResize(
  command: Command & { action: 'resize' },
): Promise<Record<string, never>> {
  const { params } = command;
  const tab = await getActiveTab();
  await browser.windows.update(tab.windowId, {
    width: params.width,
    height: params.height,
  });
  return {};
}

async function handleSavePdf(
  command: Command & { action: 'save_pdf' },
): Promise<{ saved: boolean; status: string }> {
  const { params } = command;
  const pageSettings: {
    headerLeft?: string;
    headerRight?: string;
    footerLeft?: string;
    footerRight?: string;
  } = {};
  if (params.headerLeft) pageSettings.headerLeft = params.headerLeft;
  if (params.headerRight) pageSettings.headerRight = params.headerRight;
  if (params.footerLeft) pageSettings.footerLeft = params.footerLeft;
  if (params.footerRight) pageSettings.footerRight = params.footerRight;

  const status = await browser.tabs.saveAsPDF(pageSettings);
  return {
    saved: status === 'saved' || status === 'replaced',
    status,
  };
}

// ============================================================
// Command dispatcher
// ============================================================

async function handleCommand(
  nmPort: browser.Port,
  command: Command,
): Promise<void> {
  log(`Received command: ${command.action} [${command.id}]`);

  try {
    // Content-script actions: forward to the active tab
    if (CONTENT_SCRIPT_ACTIONS.has(command.action)) {
      const contentResponse = await forwardToContentScript(command);
      sendResponse(
        nmPort,
        command.id,
        contentResponse.success,
        contentResponse.result,
        contentResponse.error,
      );
      return;
    }

    // Tab-level actions: handle directly
    let result: unknown;

    switch (command.action) {
      case 'navigate':
        result = await handleNavigate(command);
        break;

      case 'navigate_back':
        result = await handleNavigateBack();
        break;

      case 'screenshot':
        result = await handleScreenshot(command);
        break;

      case 'tabs':
        result = await handleTabs(command);
        break;

      case 'close':
        result = await handleClose();
        break;

      case 'resize':
        result = await handleResize(command);
        break;

      case 'save_pdf':
        result = await handleSavePdf(command);
        break;

      default:
        // Should not happen given the discriminated union, but handle gracefully
        sendResponse(
          nmPort,
          command.id,
          false,
          undefined,
          `Unknown action: ${(command as Command).action}`,
        );
        return;
    }

    sendResponse(nmPort, command.id, true, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError(`Error handling ${command.action} [${command.id}]:`, err);
    sendResponse(nmPort, command.id, false, undefined, message);
  }
}

// ============================================================
// Native messaging connection management
// ============================================================

function connect(): void {
  log(`Connecting to native host '${NM_APP_NAME}'...`);

  try {
    port = browser.runtime.connectNative(NM_APP_NAME);
  } catch (err) {
    logError('Failed to connect to native host:', err);
    scheduleReconnect();
    return;
  }

  // Capture the port reference at connection time so listeners don't
  // depend on the mutable module-level `port` variable (C2 fix)
  const currentPort = port;

  currentPort.onMessage.addListener((message: unknown) => {
    // Connection is proven healthy once we receive a message (H2 fix)
    reconnectAttempts = 0;

    // Runtime validation: ensure message is a well-formed Command
    if (
      !message ||
      typeof message !== 'object' ||
      !('id' in message) ||
      !('action' in message) ||
      typeof (message as Record<string, unknown>).id !== 'string' ||
      typeof (message as Record<string, unknown>).action !== 'string'
    ) {
      logError('Received malformed command:', message);
      return;
    }
    const command = message as Command;

    // Fire-and-forget: handleCommand manages its own error handling
    handleCommand(currentPort, command);
  });

  currentPort.onDisconnect.addListener((disconnectedPort: browser.Port) => {
    const error = disconnectedPort.error;
    logError(
      'Native messaging port disconnected:',
      error ? error.message : 'unknown reason',
    );
    port = null;

    // Update browser action badge to show disconnected status
    browser.browserAction.setBadgeText({ text: '' });
    browser.browserAction.setTitle({ title: 'Agent Fox - Disconnected' });

    scheduleReconnect();
  });

  log('Connected to native host.');
  reconnectAttempts = 0;

  // Update browser action badge to show connected status
  browser.browserAction.setBadgeText({ text: 'ON' });
  browser.browserAction.setBadgeBackgroundColor({ color: '#10B981' });
  browser.browserAction.setTitle({ title: 'Agent Fox - Connected' });
}

function scheduleReconnect(): void {
  if (reconnectAttempts >= MAX_RECONNECT_RETRIES) {
    logError(
      `Max reconnection attempts (${MAX_RECONNECT_RETRIES}) reached. Giving up.`,
    );
    return;
  }

  const delay = BASE_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts);
  reconnectAttempts++;
  log(
    `Scheduling reconnect attempt ${reconnectAttempts}/${MAX_RECONNECT_RETRIES} in ${delay}ms...`,
  );
  setTimeout(connect, delay);
}

// ============================================================
// Additional browser type declarations for tabs events
// (needed by waitForTabLoad helper)
// ============================================================

declare namespace browser.tabs {
  const onUpdated: {
    addListener(
      callback: (
        tabId: number,
        changeInfo: { status?: string },
        tab: browser.Tab,
      ) => void,
    ): void;
    removeListener(
      callback: (
        tabId: number,
        changeInfo: { status?: string },
        tab: browser.Tab,
      ) => void,
    ): void;
  };

  const onRemoved: {
    addListener(callback: (tabId: number) => void): void;
    removeListener(callback: (tabId: number) => void): void;
  };

  function saveAsPDF(pageSettings: {
    headerLeft?: string;
    headerRight?: string;
    footerLeft?: string;
    footerRight?: string;
  }): Promise<string>;
}

// ============================================================
// Entry point
// ============================================================

log('Background script loaded.');
connect();
