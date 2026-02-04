import type { EvaluateResult } from '@agentfox/shared';
import type { ToolDefinition } from './index.js';

const evaluateTool: ToolDefinition = {
  name: 'browser_evaluate',
  description: 'Evaluate JavaScript expression on page or element',
  inputSchema: {
    type: 'object',
    properties: {
      function: {
        type: 'string',
        description:
          '() => { /* code */ } or (element) => { /* code */ } when element is provided',
      },
      ref: {
        type: 'string',
        description:
          'Exact target element reference from the page snapshot',
      },
      element: {
        type: 'string',
        description:
          'Human-readable element description used to obtain permission to interact with the element',
      },
    },
    required: ['function'],
  },
  action: 'evaluate',

  formatResult(result: unknown) {
    if (!result || typeof result !== 'object') {
      return [{ type: 'text' as const, text: 'Evaluation completed' }];
    }
    const r = result as EvaluateResult;
    const valueStr =
      r.value === undefined
        ? 'undefined'
        : JSON.stringify(r.value, null, 2);
    return [{ type: 'text' as const, text: valueStr }];
  },
};

export default evaluateTool;
