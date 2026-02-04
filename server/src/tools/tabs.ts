import type { TabInfo, TabsResult } from '@agentfox/shared';
import type { ToolDefinition } from './index.js';

const tabsTool: ToolDefinition = {
  name: 'browser_tabs',
  description: 'List, create, close, or select a browser tab',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'new', 'close', 'select'],
        description: 'Operation to perform',
      },
      index: {
        type: 'number',
        description:
          'Tab index, used for close/select. If omitted for close, current tab is closed.',
      },
    },
    required: ['action'],
  },
  action: 'tabs',

  formatResult(result: unknown) {
    if (!result || typeof result !== 'object') {
      return [{ type: 'text' as const, text: 'Tab operation completed' }];
    }

    // If result has a 'tabs' array, it's a list result
    if ('tabs' in result) {
      const r = result as TabsResult;
      if (!r.tabs || r.tabs.length === 0) {
        return [{ type: 'text' as const, text: 'No tabs found' }];
      }
      const lines = r.tabs.map(
        (t: TabInfo) =>
          `${t.active ? '* ' : '  '}[${t.index}] ${t.title} (${t.url})`,
      );
      return [{ type: 'text' as const, text: lines.join('\n') }];
    }

    // Single tab result (new, select)
    const t = result as TabInfo;
    if (t.index !== undefined) {
      return [
        {
          type: 'text' as const,
          text: `Tab [${t.index}] ${t.title || ''} (${t.url || ''})`,
        },
      ];
    }

    return [{ type: 'text' as const, text: 'Tab operation completed' }];
  },
};

export default tabsTool;
