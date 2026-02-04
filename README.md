# Agent Fox

An MCP server and Firefox extension that lets Claude Code control your real Firefox browser — navigate pages, read accessibility trees, and take screenshots.

## How it works

```
Claude Code  <--stdio-->  MCP Server  <--Unix socket-->  NM Host  <--native messaging-->  Firefox Extension
```

The MCP server exposes browser tools over the [Model Context Protocol](https://modelcontextprotocol.io/). A native messaging host relays commands between the MCP server and a Firefox extension, which executes them against the actual browser using WebExtension APIs.

## Tools

| Tool | Description |
|------|-------------|
| `browser_navigate` | Navigate to a URL |
| `browser_navigate_back` | Go back to the previous page |
| `browser_snapshot` | Get the page's accessibility tree (text-based, like Playwright MCP) |
| `browser_take_screenshot` | Capture a screenshot of the visible tab |
| `browser_click` | Click an element on the page |
| `browser_type` | Type text into an editable element |
| `browser_press_key` | Press a keyboard key |
| `browser_hover` | Hover over an element |
| `browser_fill_form` | Fill multiple form fields at once |
| `browser_select_option` | Select an option in a dropdown |
| `browser_tabs` | List, create, close, or select browser tabs |
| `browser_close` | Close the current tab |
| `browser_resize` | Resize the browser window |
| `browser_evaluate` | Evaluate JavaScript on the page or an element |
| `browser_wait_for` | Wait for text to appear/disappear or a timeout |

## Prerequisites

- Node.js 18+
- Firefox 115+

## Setup

```bash
# Install dependencies and build
npm install
npm run build

# Install the native messaging host manifest and get MCP config
npx agentfox setup
```

The `setup` command does two things:

1. Writes a native messaging host manifest to `~/.mozilla/native-messaging-hosts/agentfox.json`
2. Prints the MCP server config to add to your Claude Code settings

### Load the extension

1. Open Firefox and go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on...**
3. Select any file in `extension/dist/`

> Temporary add-ons don't persist across Firefox restarts. You'll need to reload after restarting the browser.

### Configure Claude Code

Add the MCP server config printed by `agentfox setup` to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "agentfox": {
      "command": "/absolute/path/to/agentfox/server/bin/agentfox-mcp"
    }
  }
}
```

## Project structure

```
agentfox/
  shared/       Shared TypeScript types (Command, CommandResponse, etc.)
  server/       MCP server, native messaging host, CLI, and IPC layer
  extension/    Firefox WebExtension (background script + content script)
  scripts/      Build tooling
```

This is an npm workspaces monorepo. The `shared` package is a build-time dependency of both `server` and `extension`.

## Development

```bash
npm run dev     # Watch mode — rebuilds on changes
npm run build   # One-shot build
npm run clean   # Remove all build artifacts
npm run lint    # Type-check all packages
```

## Status

Active development. The core pipeline works end-to-end with a full set of interaction tools — navigation, clicking, typing, form filling, tab management, JavaScript evaluation, and more.