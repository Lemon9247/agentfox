import type { ActionType, ScreenshotResult } from '@agentfox/shared';
import type { ToolDefinition } from './index.js';

const screenshotTool: ToolDefinition = {
  name: 'browser_take_screenshot',
  description: 'Take a screenshot of the current page',
  inputSchema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['png', 'jpeg'],
        description: 'Image format for the screenshot. Default is png.',
      },
    },
  },
  action: 'screenshot' as ActionType,

  formatResult(result: unknown) {
    const r = result as ScreenshotResult;
    return [
      {
        type: 'image' as const,
        data: r.data,
        mimeType: r.mimeType,
      },
    ];
  },
};

export default screenshotTool;
