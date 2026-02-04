import type { ActionType } from '@agentfox/shared';

// ============================================================
// Tool Definition Interface
// ============================================================

/** Content item types returned by MCP tool handlers */
export type McpContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

/**
 * A tool definition describes one MCP tool: its name, schema, what
 * Command action it maps to, and how to format the extension's result
 * into MCP content.
 */
export interface ToolDefinition {
  /** MCP tool name (e.g. "browser_navigate") */
  name: string;
  /** Human-readable description shown to the model */
  description: string;
  /** JSON Schema for the tool's input parameters */
  inputSchema: Record<string, unknown>;
  /** The Command.action this tool maps to */
  action: ActionType;
  /** Convert the CommandResponse.result into an MCP content array */
  formatResult: (result: unknown) => McpContent[];
}

// ============================================================
// Tool Registry
// ============================================================

import navigateTool from './navigate.js';
import navigateBackTool from './navigate-back.js';
import snapshotTool from './snapshot.js';
import screenshotTool from './screenshot.js';
import { clickTool, typeTool, pressKeyTool, hoverTool } from './interact.js';
import { fillFormTool, selectOptionTool } from './form.js';
import tabsTool from './tabs.js';
import closeTool from './close.js';
import resizeTool from './resize.js';
import evaluateTool from './evaluate.js';
import waitTool from './wait.js';

/** All registered tool definitions */
export const tools: ToolDefinition[] = [
  navigateTool,
  navigateBackTool,
  snapshotTool,
  screenshotTool,
  clickTool,
  typeTool,
  pressKeyTool,
  hoverTool,
  fillFormTool,
  selectOptionTool,
  tabsTool,
  closeTool,
  resizeTool,
  evaluateTool,
  waitTool,
];

/** Map for O(1) tool lookups by name. Built at module load time. */
const toolMap = new Map<string, ToolDefinition>();
for (const tool of tools) {
  if (toolMap.has(tool.name)) {
    throw new Error(`Duplicate tool name: ${tool.name}`);
  }
  toolMap.set(tool.name, tool);
}

/** Look up a tool by its MCP name. Returns undefined if not found. */
export function getToolByName(name: string): ToolDefinition | undefined {
  return toolMap.get(name);
}
