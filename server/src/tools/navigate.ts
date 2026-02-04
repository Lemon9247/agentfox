import type { NavigateResult } from '@agentfox/shared';
import type { ToolDefinition } from './index.js';

const navigateTool: ToolDefinition = {
  name: 'browser_navigate',
  description: 'Navigate to a URL',
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to navigate to',
      },
    },
    required: ['url'],
  },
  action: 'navigate',

  formatResult(result: unknown) {
    if (!result || typeof result !== 'object') {
      return [
        {
          type: 'text' as const,
          text: 'Navigation completed (no details returned)',
        },
      ];
    }
    const r = result as NavigateResult;
    return [
      {
        type: 'text' as const,
        text: `Navigated to ${r.url ?? 'unknown'}\nTitle: ${r.title ?? ''}`,
      },
    ];
  },
};

export default navigateTool;
