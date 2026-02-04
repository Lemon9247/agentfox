import type { ToolDefinition } from './index.js';

const waitTool: ToolDefinition = {
  name: 'browser_wait_for',
  description:
    'Wait for text to appear or disappear or a specified time to pass',
  inputSchema: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'The text to wait for',
      },
      textGone: {
        type: 'string',
        description: 'The text to wait for to disappear',
      },
      time: {
        type: 'number',
        description: 'The time to wait in seconds',
      },
    },
  },
  action: 'wait_for',

  formatResult(result: unknown) {
    if (result && typeof result === 'object' && 'matched' in result) {
      const r = result as { matched: boolean };
      return [
        {
          type: 'text' as const,
          text: r.matched
            ? 'Wait condition met'
            : 'Wait condition timed out',
        },
      ];
    }
    return [{ type: 'text' as const, text: 'Wait completed' }];
  },
};

export default waitTool;
