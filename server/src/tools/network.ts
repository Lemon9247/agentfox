import type { NetworkRequestsResult, NetworkRequestInfo } from '@agentfox/shared';
import type { ToolDefinition } from './index.js';

const networkTool: ToolDefinition = {
  name: 'browser_network_requests',
  description:
    "Monitor network requests. Use 'start' to begin recording, 'stop' to stop, 'get' to retrieve recorded requests, 'clear' to clear the buffer.",
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['start', 'stop', 'get', 'clear'],
        description:
          "Action to perform: 'start' begins recording, 'stop' stops recording, 'get' retrieves recorded requests, 'clear' clears the buffer.",
      },
      filter: {
        type: 'string',
        description: 'URL pattern to filter requests (substring match)',
      },
    },
    required: ['action'],
  },
  action: 'network_requests',

  formatResult(result: unknown) {
    if (!result || typeof result !== 'object') {
      return [
        {
          type: 'text' as const,
          text: 'Network request operation completed (no details returned)',
        },
      ];
    }

    const r = result as NetworkRequestsResult;

    // If we have requests, format them as a table
    if (r.requests) {
      if (r.requests.length === 0) {
        return [
          {
            type: 'text' as const,
            text: `No requests recorded. Recording: ${r.recording ? 'active' : 'stopped'}`,
          },
        ];
      }

      const lines = [
        `Requests (${r.requests.length}):`,
        'Method | Status | Type | URL',
        '-------|--------|------|----',
      ];

      for (const req of r.requests as NetworkRequestInfo[]) {
        lines.push(
          `${req.method} | ${req.statusCode} | ${req.type} | ${req.url}`,
        );
      }

      lines.push('', `Recording: ${r.recording ? 'active' : 'stopped'}`);

      return [{ type: 'text' as const, text: lines.join('\n') }];
    }

    // Status message for start/stop/clear
    const parts: string[] = [];
    if (r.recording !== undefined) {
      parts.push(`Recording: ${r.recording ? 'active' : 'stopped'}`);
    }
    if (r.count !== undefined) {
      parts.push(`Buffered requests: ${r.count}`);
    }
    return [
      { type: 'text' as const, text: parts.join('\n') || 'OK' },
    ];
  },
};

export default networkTool;
