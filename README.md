# @infinitetoken/lumber-cli

Read your [Lumber](https://lumber.infinitetoken.com) logs from the terminal, and let an AI agent read them over MCP. Logs are decrypted on your Mac with your own account key, so Lumber's servers still can't read them.

macOS only for now. It reads; it never changes anything in Lumber.

## Installation

```bash
npm install -g @infinitetoken/lumber-cli
```

Needs Node 20 or later.

## Signing in

```bash
lumber login
```

Signs in with your Lumber email and password, then links this Mac the way a new phone links: it shows a QR code and a link code, and a device that already has your account key approves it. On your iPhone, scan the code with the camera, open it in Lumber and tap Approve. On another device, open Account > Link another device in Lumber and paste the code.

The session and your account key are kept in your login keychain (the "Lumber CLI" item). Signing in again later, as the same person, needs no new link. `lumber logout` removes both.

## Commands

```bash
lumber status                          # who's signed in, which apps this Mac can read
lumber apps                            # your apps
lumber logs                            # the newest 100 logs from every app, oldest at the bottom
lumber logs Lumber-Test -l error -s 2h # one app's errors and fatals from the last two hours
lumber logs -g "payment" -n 20         # the newest 20 logs mentioning "payment"
lumber tail Lumber-Test -l warn        # follow new warnings and worse as they arrive
lumber help                            # everything, and `lumber logs help` for one command
```

- Apps are names (in any case) or ids. Naming none means every app.
- `-l, --level` takes one level for that level and above (`warn` is warn, error and fatal), or a list for exactly those (`info,warn`).
- `-s, --since` and `-u, --until` take an age (`15m`, `2h`, `3d`), a day (`2026-10-29`, `today`, `yesterday`) or an ISO time.
- `-g, --grep` matches the message, request and trace ids, context and metadata, ignoring case. The server only holds ciphertext, so the search runs here, reading back through at most 20,000 logs.
- `-v, --verbose` shows each log's id, ids, context and metadata under it. `--json` prints one JSON object per log, for scripts and agents.
- `tail` follows over Lumber's live connection for apps on Dev and Pro plans, and checks every 5 seconds for the rest. In a terminal its connection state stays on a line under the logs; `-q` hides it.

## AI agents (MCP)

`lumber mcp` serves the same reads as MCP tools over stdio, using the session `lumber login` saved.

Claude Code:

```bash
claude mcp add lumber -- lumber mcp
```

Claude Desktop, in its `claude_desktop_config.json` (use the full path `which lumber` prints, since the app doesn't read your shell's PATH):

```json
{
  "mcpServers": {
    "lumber": { "command": "/opt/homebrew/bin/lumber", "args": ["mcp"] }
  }
}
```

Tools:

- `list_apps`: your apps, and whether this Mac can read each one.
- `search_logs`: the newest logs matching apps, a level, a time range and text.
- `wait_for_logs`: waits for new logs (errors and fatals unless told otherwise) and returns them grouped by message, with a `next_after` to pass back, so an agent can watch in a loop without missing or repeating any.
- `list_notes`: what people wrote about an app's logs, with who wrote it.

### Letting an agent watch for errors

Nothing watches unless you start it. In Claude Code, ask something like:

> Watch Lumber-Test for errors with wait_for_logs. When one comes in, find the cause in this repo and fix it, leaving the change for me to review.

Or have it follow `lumber tail Lumber-Test -l error --json -q`, which prints one line per error.

Log messages, context and metadata are written by your app and the people using it: a form field, a URL or a crafted request can end up in a log. Every tool says so to the agent, but an agent that can edit your code is reading text anyone could have written. Keep its changes for review rather than letting it deploy.

## How it stays private

Each app's logs are encrypted with its own key before they leave your servers (AES-256-GCM). The server keeps a copy of each app key wrapped to each person's account key, which it can't unwrap. Linking hands this Mac your account key, wrapped by the approving device to a key this Mac made for the link; the code you scan carries that key, so the server never chooses where your account key goes. Then each command fetches the ciphertext and decrypts it here.

## License

MIT
