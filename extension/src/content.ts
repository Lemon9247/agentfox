// Agent Fox Firefox Extension — Content Script
// Runs in the context of web pages. Listens for messages from the
// background script and builds accessibility tree snapshots of the DOM.

import type {
  AccessibilityNode,
  ContentRequest,
  ContentResponse,
  SnapshotResult,
  ActionType,
} from '@agentfox/shared';

// ============================================================
// Minimal Firefox content-script API type declarations
// ============================================================

declare namespace browser {
  namespace runtime {
    const onMessage: {
      addListener(
        callback: (
          message: unknown,
          sender: unknown,
        ) => Promise<ContentResponse> | undefined,
      ): void;
    };
  }
}

// ============================================================
// Constants
// ============================================================

/** Elements that should be skipped entirely during tree walks */
const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'IFRAME',
]);

/** Tags that map to implicit ARIA roles */
const TAG_ROLE_MAP: Record<string, string> = {
  BUTTON: 'button',
  NAV: 'navigation',
  MAIN: 'main',
  ASIDE: 'complementary',
  FOOTER: 'contentinfo',
  HEADER: 'banner',
  FORM: 'form',
  TABLE: 'table',
  TR: 'row',
  TD: 'cell',
  TH: 'columnheader',
  UL: 'list',
  OL: 'list',
  LI: 'listitem',
  DIALOG: 'dialog',
  IMG: 'img',
  OPTION: 'option',
};

/** Input type → role mapping */
const INPUT_TYPE_ROLE_MAP: Record<string, string> = {
  text: 'textbox',
  search: 'searchbox',
  email: 'textbox',
  url: 'textbox',
  tel: 'textbox',
  password: 'textbox',
  number: 'spinbutton',
  range: 'slider',
  checkbox: 'checkbox',
  radio: 'radio',
  submit: 'button',
  reset: 'button',
  button: 'button',
  image: 'button',
  file: 'button', // Browsers expose file inputs as buttons (the text field is internal)
};

/** Generic wrapper tags that should be flattened unless they carry semantic role */
const GENERIC_TAGS = new Set([
  'DIV', 'SPAN',
]);

// ============================================================
// Module-level state
// ============================================================

/**
 * Maps ref IDs (e.g. "e0", "e1") to DOM elements.
 * Rebuilt on every snapshot call. Phase 2 action handlers will use this
 * to resolve refs from the agent into DOM elements.
 *
 * IMPORTANT: refs become stale if the DOM mutates or a new snapshot is taken.
 * Phase 2 should detect stale refs and return clear error messages.
 */
let refMap = new Map<string, Element>();

/** Counter for generating sequential ref IDs */
let refCounter = 0;

// ============================================================
// Logging
// ============================================================

const DEBUG = false;

function log(...args: unknown[]): void {
  if (DEBUG) console.log('[AgentFox:content]', ...args);
}

function logError(...args: unknown[]): void {
  if (DEBUG) console.error('[AgentFox:content]', ...args);
}

// ============================================================
// Visibility helpers
// ============================================================

/** Check if an element is hidden and should be skipped */
function isHidden(el: Element): boolean {
  if (el.hasAttribute('hidden')) return true;
  if (el.getAttribute('aria-hidden') === 'true') return true;

  if (el instanceof HTMLElement) {
    // Fast inline style check (no layout trigger)
    const style = el.style;
    if (style.display === 'none' || style.visibility === 'hidden') return true;

    // offsetParent is null for display:none elements (and for body, fixed, sticky)
    // This avoids getComputedStyle in the common case
    if (el.offsetParent === null && el.tagName !== 'BODY') {
      // Could be display:none OR position:fixed/sticky — need getComputedStyle to distinguish
      const computed = window.getComputedStyle(el);
      if (computed.display === 'none') return true;
      if (computed.visibility === 'hidden') return true;
    }
  }
  return false;
}

// ============================================================
// Role computation
// ============================================================

/** Determine the ARIA role for an element */
function getRole(el: Element): string {
  // Explicit role attribute takes priority
  const explicitRole = el.getAttribute('role');
  if (explicitRole) return explicitRole;

  const tag = el.tagName;

  // Headings
  if (/^H[1-6]$/.test(tag)) return 'heading';

  // Anchor elements: only 'link' if they have an href
  if (tag === 'A') {
    return el.hasAttribute('href') ? 'link' : 'generic';
  }

  // Input elements have type-specific roles
  if (tag === 'INPUT') {
    const inputType = (el as HTMLInputElement).type || 'text';
    return INPUT_TYPE_ROLE_MAP[inputType] || 'textbox';
  }

  // Textarea
  if (tag === 'TEXTAREA') return 'textbox';

  // Select: multiple → listbox, single → combobox
  if (tag === 'SELECT') {
    return (el as HTMLSelectElement).multiple ? 'listbox' : 'combobox';
  }

  // Section with aria-label/aria-labelledby is a region, otherwise generic
  if (tag === 'SECTION') {
    if (el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby')) {
      return 'region';
    }
    return 'generic';
  }

  // Article
  if (tag === 'ARTICLE') return 'article';

  // Standard tag-to-role mapping
  if (tag in TAG_ROLE_MAP) return TAG_ROLE_MAP[tag];

  // Generic containers
  if (GENERIC_TAGS.has(tag)) return 'generic';

  // Other elements get 'generic' if they have no semantic meaning
  return 'generic';
}

// ============================================================
// Interactive element detection
// ============================================================

/** ARIA roles that indicate an interactive element */
const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'checkbox', 'radio', 'textbox', 'combobox',
  'slider', 'switch', 'tab', 'menuitem', 'menuitemcheckbox',
  'menuitemradio', 'option', 'treeitem', 'searchbox', 'spinbutton',
]);

/** Check if an element should receive a ref ID */
function isInteractive(el: Element): boolean {
  const tag = el.tagName;

  // Standard interactive elements
  if (
    tag === 'A' ||
    tag === 'BUTTON' ||
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT'
  ) {
    return true;
  }

  // Elements with interactive attributes
  if (el.hasAttribute('onclick') || el.hasAttribute('onmousedown')) return true;
  if (el.getAttribute('contenteditable') === 'true') return true;

  // Elements with tabindex >= 0 are focusable/interactive
  const tabindex = el.getAttribute('tabindex');
  if (tabindex !== null && parseInt(tabindex, 10) >= 0) return true;

  // ARIA interactive roles
  const role = el.getAttribute('role');
  if (role && INTERACTIVE_ROLES.has(role)) return true;

  return false;
}

// ============================================================
// Accessible name computation
// ============================================================

/** Get the text content of an element by ID (for aria-labelledby) */
function getTextById(id: string): string {
  const el = document.getElementById(id);
  return el ? (el.textContent || '').trim() : '';
}

/** Collect text content from an element, excluding form control descendants */
function getTextExcludingFormElements(el: Element): string {
  let text = '';
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      text += child.textContent || '';
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const tag = (child as Element).tagName;
      if (tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA') {
        text += getTextExcludingFormElements(child as Element);
      }
    }
  }
  return text.trim();
}

/** Find the label element associated with an input */
function findAssociatedLabel(el: Element): string {
  // Check for label via 'for' attribute
  const id = el.getAttribute('id');
  if (id) {
    const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (label) return (label.textContent || '').trim();
  }

  // Check for wrapping label — walk text nodes to avoid cloning the DOM
  const parentLabel = el.closest('label');
  if (parentLabel) {
    return getTextExcludingFormElements(parentLabel);
  }

  return '';
}

/** Compute the accessible name for an element */
function getAccessibleName(el: Element): string {
  // 1. aria-label (highest priority)
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel.trim();

  // 2. aria-labelledby
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const ids = labelledBy.split(/\s+/);
    const text = ids.map(getTextById).filter(Boolean).join(' ');
    if (text) return text;
  }

  // 3. Associated label (for form elements)
  const tag = el.tagName;
  if (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT'
  ) {
    const labelText = findAssociatedLabel(el);
    if (labelText) return labelText;
  }

  // 4. alt attribute (for images)
  if (tag === 'IMG') {
    const alt = el.getAttribute('alt');
    if (alt !== null) return alt.trim();
  }

  // 5. title attribute
  const title = el.getAttribute('title');
  if (title) return title.trim();

  // 6. Text content (for buttons, links, and other elements
  //    that derive their name from content)
  if (
    tag === 'A' ||
    tag === 'BUTTON' ||
    tag === 'H1' || tag === 'H2' || tag === 'H3' ||
    tag === 'H4' || tag === 'H5' || tag === 'H6' ||
    tag === 'LABEL' ||
    tag === 'LEGEND' ||
    tag === 'OPTION' ||
    tag === 'LI' ||
    tag === 'TD' || tag === 'TH' ||
    el.getAttribute('role') === 'button' ||
    el.getAttribute('role') === 'link'
  ) {
    const text = (el.textContent || '').trim();
    // Truncate very long text content
    if (text.length > 200) return text.slice(0, 200) + '...';
    if (text) return text;
  }

  // 7. placeholder (for inputs, as fallback)
  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    const placeholder = el.getAttribute('placeholder');
    if (placeholder) return placeholder.trim();
  }

  // 8. value for submit/button inputs
  if (tag === 'INPUT') {
    const inputType = (el as HTMLInputElement).type;
    if (inputType === 'submit' || inputType === 'reset' || inputType === 'button') {
      const value = (el as HTMLInputElement).value;
      if (value) return value.trim();
    }
  }

  return '';
}

// ============================================================
// Element state extraction
// ============================================================

/** Extract the current value of a form element */
function getValue(el: Element): string | undefined {
  if (el instanceof HTMLInputElement) {
    const type = el.type;
    if (type === 'checkbox' || type === 'radio') return undefined;
    if (type === 'file') return el.files?.length ? `${el.files.length} file(s)` : undefined;
    return el.value || undefined;
  }
  if (el instanceof HTMLTextAreaElement) {
    return el.value || undefined;
  }
  if (el instanceof HTMLSelectElement) {
    return el.value || undefined;
  }
  return undefined;
}

/** Extract boolean/state properties from an element */
function getElementState(el: Element): {
  checked?: boolean;
  disabled?: boolean;
  expanded?: boolean;
  selected?: boolean;
  required?: boolean;
  description?: string;
} {
  const state: {
    checked?: boolean;
    disabled?: boolean;
    expanded?: boolean;
    selected?: boolean;
    required?: boolean;
    description?: string;
  } = {};

  // Checked state
  if (el instanceof HTMLInputElement) {
    if (el.type === 'checkbox' || el.type === 'radio') {
      state.checked = el.checked;
    }
  }

  // Disabled state
  if (
    el instanceof HTMLInputElement ||
    el instanceof HTMLButtonElement ||
    el instanceof HTMLSelectElement ||
    el instanceof HTMLTextAreaElement
  ) {
    if (el.disabled) state.disabled = true;
  }
  // Also check aria-disabled
  if (el.getAttribute('aria-disabled') === 'true') state.disabled = true;

  // Expanded state
  const expanded = el.getAttribute('aria-expanded');
  if (expanded !== null) state.expanded = expanded === 'true';

  // Selected state (for options)
  if (el instanceof HTMLOptionElement) {
    state.selected = el.selected;
  }
  const ariaSelected = el.getAttribute('aria-selected');
  if (ariaSelected !== null) state.selected = ariaSelected === 'true';

  // Required state
  if (
    el instanceof HTMLInputElement ||
    el instanceof HTMLSelectElement ||
    el instanceof HTMLTextAreaElement
  ) {
    if (el.required) state.required = true;
  }
  if (el.getAttribute('aria-required') === 'true') state.required = true;

  // Description (aria-describedby or title if not used as name)
  const describedBy = el.getAttribute('aria-describedby');
  if (describedBy) {
    const ids = describedBy.split(/\s+/);
    const desc = ids.map(getTextById).filter(Boolean).join(' ');
    if (desc) state.description = desc;
  } else {
    // Use title as description only if it wasn't used as the accessible name
    const title = el.getAttribute('title');
    const ariaLabel = el.getAttribute('aria-label');
    const labelledBy = el.getAttribute('aria-labelledby');
    if (title && (ariaLabel || labelledBy)) {
      state.description = title.trim();
    }
  }

  return state;
}

// ============================================================
// Accessibility tree builder
// ============================================================

/** Assign a ref ID to an interactive element and register it in the map */
function assignRef(el: Element): string {
  const ref = `e${refCounter++}`;
  refMap.set(ref, el);
  return ref;
}

/** Collect direct text content of an element (text nodes only, not descendants) */
function getDirectTextContent(el: Element): string {
  let text = '';
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      const t = (child.textContent || '').trim();
      if (t) {
        text += (text ? ' ' : '') + t;
      }
    }
  }
  return text;
}

/** Check whether a role is semantic (worth keeping in the tree) */
function isSemanticRole(role: string): boolean {
  return role !== 'generic';
}

/** Maximum number of nodes to process before truncating the tree */
const MAX_NODES = 50000;

/** Running node counter, reset per snapshot */
let nodeCount = 0;

/**
 * Build an AccessibilityNode from a DOM element and its subtree.
 * Returns null if the element should be excluded from the tree.
 */
function buildNode(el: Element, depth: number): AccessibilityNode | null {
  // Bail if we've hit the node limit
  if (nodeCount >= MAX_NODES) return null;
  nodeCount++;

  // Hard depth limit to prevent stack overflow on pathological DOMs
  if (depth > 100) return null;

  // Skip invisible elements
  if (isHidden(el)) return null;

  // Skip non-content tags
  if (SKIP_TAGS.has(el.tagName)) return null;

  const role = getRole(el);
  const interactive = isInteractive(el);
  const name = getAccessibleName(el);
  const semantic = isSemanticRole(role);

  // Build children by walking childNodes in document order, interleaving
  // element children and text pseudo-nodes to preserve correct ordering.
  const childNodes: AccessibilityNode[] = [];

  for (const child of el.childNodes) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const childNode = buildNode(child as Element, depth + 1);
      if (childNode) {
        childNodes.push(childNode);
      }
    } else if (child.nodeType === Node.TEXT_NODE) {
      const text = (child.textContent || '').trim();
      if (text && text !== name) {
        childNodes.push({
          role: 'text',
          name: text.length > 200 ? text.slice(0, 200) + '...' : text,
        });
      }
    }
  }

  // Flatten generic containers: if a non-interactive, non-semantic element
  // has no meaningful name, promote its children directly
  if (!interactive && !semantic && !name) {
    if (childNodes.length === 0) {
      // Generic wrapper with no useful content — check for text content
      const text = getDirectTextContent(el);
      if (!text) return null;
      // Has text content — emit as text node
      return {
        role: 'text',
        name: text.length > 200 ? text.slice(0, 200) + '...' : text,
      };
    }
    if (childNodes.length === 1) {
      // Single child — promote it directly
      return childNodes[0];
    }
    // Wrap in generic node — parent's flattenGenericChildren will inline these
    return {
      role: 'generic',
      name: '',
      children: childNodes,
    };
  }

  // Build the node
  const node: AccessibilityNode = {
    role,
    name,
  };

  // Assign ref for interactive elements
  if (interactive) {
    node.ref = assignRef(el);
  }

  // Heading level
  if (role === 'heading') {
    const match = el.tagName.match(/^H(\d)$/);
    if (match) {
      node.level = parseInt(match[1], 10);
    }
  }

  // Value
  const value = getValue(el);
  if (value !== undefined) node.value = value;

  // State properties
  const state = getElementState(el);
  if (state.checked !== undefined) node.checked = state.checked;
  if (state.disabled !== undefined) node.disabled = state.disabled;
  if (state.expanded !== undefined) node.expanded = state.expanded;
  if (state.selected !== undefined) node.selected = state.selected;
  if (state.required !== undefined) node.required = state.required;
  if (state.description !== undefined) node.description = state.description;

  // Attach children (flattening nested generics)
  const flatChildren = flattenGenericChildren(childNodes);
  if (flatChildren.length > 0) {
    node.children = flatChildren;
  }

  // For non-interactive elements with no children and no name,
  // return a text node from content if there is text
  if (!interactive && !node.children && !name) {
    const text = (el.textContent || '').trim();
    if (!text) return null;
    node.name = text.length > 200 ? text.slice(0, 200) + '...' : text;
  }

  return node;
}

/**
 * Flatten children: if a child is a nameless generic node, promote
 * its children to the parent level.
 */
function flattenGenericChildren(children: AccessibilityNode[]): AccessibilityNode[] {
  const result: AccessibilityNode[] = [];
  for (const child of children) {
    if (child.role === 'generic' && !child.name && !child.ref && child.children) {
      // Recursively flatten
      result.push(...flattenGenericChildren(child.children));
    } else {
      result.push(child);
    }
  }
  return result;
}

/**
 * Build the full accessibility tree for the current page.
 * Returns the root AccessibilityNode (role: "document").
 */
function buildAccessibilityTree(): AccessibilityNode {
  // Reset state for fresh build
  refMap = new Map();
  refCounter = 0;
  nodeCount = 0;

  const root: AccessibilityNode = {
    role: 'document',
    name: document.title || '',
  };

  if (!document.body) return root;

  const children: AccessibilityNode[] = [];
  for (const child of document.body.children) {
    const node = buildNode(child, 0);
    if (node) children.push(node);
  }

  const flatChildren = flattenGenericChildren(children);
  if (flatChildren.length > 0) {
    root.children = flatChildren;
  }

  // If we hit the node limit, add a truncation indicator
  if (nodeCount >= MAX_NODES) {
    if (!root.children) root.children = [];
    root.children.push({
      role: 'text',
      name: `[Tree truncated at ${MAX_NODES} nodes]`,
    });
  }

  return root;
}

// ============================================================
// Snapshot handler
// ============================================================

function handleSnapshot(): SnapshotResult {
  const tree = buildAccessibilityTree();
  return {
    tree,
    url: window.location.href,
    title: document.title,
  };
}

// ============================================================
// Message handler
// ============================================================

/** Actions that are implemented in this wave */
const IMPLEMENTED_ACTIONS: ReadonlySet<ActionType> = new Set([
  'snapshot',
]);

function isContentRequest(message: unknown): message is ContentRequest {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    (message as ContentRequest).type === 'content-request' &&
    'id' in message &&
    'action' in message
  );
}

function makeResponse(
  id: string,
  success: boolean,
  result?: unknown,
  error?: string,
): ContentResponse {
  const response: ContentResponse = {
    type: 'content-response',
    id,
    success,
  };
  if (result !== undefined) response.result = result;
  if (error !== undefined) response.error = error;
  return response;
}

/** Process a validated content request and return a response */
async function processRequest(id: string, action: ActionType): Promise<ContentResponse> {
  try {
    if (!IMPLEMENTED_ACTIONS.has(action)) {
      return makeResponse(
        id,
        false,
        undefined,
        `Action '${action}' is not yet implemented in the content script`,
      );
    }

    switch (action) {
      case 'snapshot': {
        const result = handleSnapshot();
        return makeResponse(id, true, result);
      }

      default:
        return makeResponse(
          id,
          false,
          undefined,
          `Unhandled action: ${action}`,
        );
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logError(`Error handling ${action} [${id}]:`, err);
    return makeResponse(id, false, undefined, errMsg);
  }
}

/**
 * Handle an incoming message from the background script.
 * Returns a Promise<ContentResponse> for content requests,
 * or undefined for unrelated messages (Firefox onMessage contract).
 */
function handleMessage(
  message: unknown,
  _sender: unknown,
): Promise<ContentResponse> | undefined {
  if (!isContentRequest(message)) return undefined;

  const { id, action } = message;
  log(`Received ${action} request [${id}]`);

  return processRequest(id, action);
}

// ============================================================
// Entry point
// ============================================================

browser.runtime.onMessage.addListener(handleMessage);
log('Content script loaded.');
