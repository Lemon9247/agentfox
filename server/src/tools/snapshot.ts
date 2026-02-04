import type { ActionType, AccessibilityNode, SnapshotResult } from '@agentfox/shared';
import type { ToolDefinition } from './index.js';

/**
 * Render an accessibility tree into indented text, matching Playwright MCP's
 * output format so that downstream consumers (Claude, etc.) see a familiar
 * representation.
 *
 * Example output:
 *   - document [ref=e0]
 *     - heading "Page Title" [level=1]
 *     - navigation
 *       - link "Home" [ref=e1]
 */
function renderTree(node: AccessibilityNode, depth = 0): string {
  const indent = '  '.repeat(depth);
  let line = `${indent}- ${node.role}`;

  if (node.name) {
    line += ` "${node.name}"`;
  }

  // Collect attribute annotations
  const attrs: string[] = [];
  if (node.ref !== undefined) attrs.push(`ref=${node.ref}`);
  if (node.level !== undefined) attrs.push(`level=${node.level}`);
  if (node.checked !== undefined) attrs.push(`checked=${node.checked}`);
  if (node.disabled !== undefined) attrs.push(`disabled=${node.disabled}`);
  if (node.expanded !== undefined) attrs.push(`expanded=${node.expanded}`);
  if (node.selected !== undefined) attrs.push(`selected=${node.selected}`);
  if (node.required !== undefined) attrs.push(`required=${node.required}`);
  if (node.value !== undefined) attrs.push(`value="${node.value}"`);

  if (attrs.length > 0) {
    line += ` [${attrs.join(', ')}]`;
  }

  const lines = [line];

  if (node.children) {
    for (const child of node.children) {
      lines.push(renderTree(child, depth + 1));
    }
  }

  return lines.join('\n');
}

const snapshotTool: ToolDefinition = {
  name: 'browser_snapshot',
  description:
    'Capture accessibility snapshot of the current page, this is better than screenshot',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  action: 'snapshot' as ActionType,

  formatResult(result: unknown) {
    const r = result as SnapshotResult;
    const treeText = renderTree(r.tree);
    return [
      {
        type: 'text' as const,
        text: `Page: ${r.title}\nURL: ${r.url}\n\n${treeText}`,
      },
    ];
  },
};

export default snapshotTool;
