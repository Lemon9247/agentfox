import type { GetCookiesResult, CookieInfo } from '@agentfox/shared';
import type { ToolDefinition } from './index.js';

const cookiesTool: ToolDefinition = {
  name: 'browser_get_cookies',
  description: 'Get cookies for the current page or a specific URL',
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'URL to get cookies for. If omitted, uses the current page URL.',
      },
      domain: {
        type: 'string',
        description: 'Filter cookies by domain (alternative to url)',
      },
    },
  },
  action: 'get_cookies',

  formatResult(result: unknown) {
    if (!result || typeof result !== 'object') {
      return [
        {
          type: 'text' as const,
          text: 'No cookie data returned',
        },
      ];
    }
    const r = result as GetCookiesResult;
    if (!r.cookies || r.cookies.length === 0) {
      return [
        {
          type: 'text' as const,
          text: 'No cookies found',
        },
      ];
    }
    const lines = r.cookies.map((c: CookieInfo) => {
      let line = `${c.name}=${c.value} (domain: ${c.domain}, path: ${c.path}`;
      if (c.secure) line += ', secure';
      if (c.httpOnly) line += ', httpOnly';
      line += `, sameSite: ${c.sameSite}`;
      if (c.expirationDate !== undefined) {
        line += `, expires: ${new Date(c.expirationDate * 1000).toISOString()}`;
      }
      line += ')';
      return line;
    });
    return [
      {
        type: 'text' as const,
        text: `Cookies (${r.cookies.length}):\n${lines.join('\n')}`,
      },
    ];
  },
};

export default cookiesTool;
