import type { NavigateResult } from '@agentfox/shared';
import type { ToolDefinition } from './index.js';

const navigateBackTool: ToolDefinition = {
  name: 'browser_navigate_back',
  description: 'Go back to the previous page in the history',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  action: 'navigate_back',

  formatResult(result: unknown) {
    if (!result || typeof result !== 'object') {
      return [
        {
          type: 'text' as const,
          text: 'Navigated back (no details returned)',
        },
      ];
    }
    const r = result as NavigateResult;
    return [
      {
        type: 'text' as const,
        text: `Navigated back to ${r.url ?? 'unknown'}\nTitle: ${r.title ?? ''}`,
      },
    ];
  },
};

export default navigateBackTool;
