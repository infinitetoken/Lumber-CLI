# @infinitetoken/lumber-cli

Read your [Lumber](https://lumber.infinitetoken.com) logs from the terminal, and let an AI agent read them over MCP. Logs are decrypted on your computer with your own account key, so Lumber's servers still can't read them.

Runs on macOS, Windows and Linux. It reads; it never changes anything in Lumber.

## Installation

```bash
npm install -g @infinitetoken/lumber-cli
```

The package is scoped: the unscoped `lumber` and `lumber-cli` on npm are someone else's.

Or with Homebrew, on macOS or Linux. This repo is the tap:

```bash
brew tap infinitetoken/lumber https://github.com/infinitetoken/Lumber-CLI
```

```bash
brew install infinitetoken/lumber/lumber
```

Naming it in full the first time is what has Homebrew trust the formula. Update with `brew upgrade lumber`.

## Signing in

```bash
lumber login
```

Signs in with your Lumber email and password, then links this computer the way a new phone links: open Lumber on a phone or Mac that already has your account key (your phone gets a notification, and the Mac app asks when you switch to it, or open Account > Link another device), tap Show Code, and type the 7-digit code at the `Code` prompt. That device checks the code and sends your account key. The request lasts 10 minutes, and a wrong code ends it. The other device needs an up-to-date Lumber app.

The session and your account key are kept in your system's own credential store, never in a file:

- macOS: your login keychain, the "Lumber CLI" item.
- Windows: Credential Manager, the generic credential `session.Lumber CLI`.
- Linux: the Secret Service, which GNOME Keyring and KWallet provide, the "Lumber CLI" item. A desktop session has one; on a server or over SSH with none running, `lumber` says so and stops.

The session renews itself each day you use it, so it only ends after 30 days without running `lumber`; signing in again then, as the same person, needs no new link. `lumber logout` removes both.

## Commands

```bash
lumber status                          # who's signed in, which apps this computer can read
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
- `help` anywhere on the command line shows help, so `lumber logs -g help` prints help rather than searching. Search for `-g Help` instead: the match ignores case.
- When a newer version is on npm, a command run at a terminal says so after its output, at most once a day, with the command to update. It asks npm at most once a day, while the command runs, so it never slows one down. `tail`, `mcp`, piped output and CI never check; `LUMBER_NO_UPDATE_CHECK=1` turns it off.

The output takes the apps' colors: spinners, help and prompts in your accent (the one you picked in Lumber's Account screen), levels in their colors, and a square in each app's color before its name. Piped or with `--json`, it's plain text.

## AI agents (MCP)

`lumber mcp` serves the same reads as MCP tools over stdio, using the session `lumber login` saved.

Claude Code:

```bash
claude mcp add lumber -- lumber mcp
```

On Windows, npm installs `lumber` as a `.cmd` file, which an agent can only start through `cmd`:

```bash
claude mcp add lumber -- cmd /c lumber mcp
```

Claude Desktop, in its `claude_desktop_config.json` (on macOS and Linux, use the full path `which lumber` prints, since the app doesn't read your shell's PATH):

```json
{
  "mcpServers": {
    "lumber": { "command": "/opt/homebrew/bin/lumber", "args": ["mcp"] }
  }
}
```

On Windows:

```json
{
  "mcpServers": {
    "lumber": { "command": "cmd", "args": ["/c", "lumber", "mcp"] }
  }
}
```

Tools:

- `list_apps`: your apps, and whether this computer can read each one.
- `search_logs`: the newest logs matching apps, a level, a time range and text.
- `wait_for_logs`: waits for new logs (errors and fatals unless told otherwise) and returns them grouped by message, with a `next_after` to pass back, so an agent can watch in a loop without missing or repeating any.
- `list_notes`: what people wrote about an app's logs, with who wrote it.

### Letting an agent watch for errors

Nothing watches unless you start it. In Claude Code, ask something like:

> Watch Lumber-Test for errors with wait_for_logs. When one comes in, find the cause in this repo and fix it, leaving the change for me to review.

Or have it follow `lumber tail Lumber-Test -l error --json -q`, which prints one line per error.

Log messages, context and metadata are written by your app and the people using it: a form field, a URL or a crafted request can end up in a log. Every tool says so to the agent, but an agent that can edit your code is reading text anyone could have written. Keep its changes for review rather than letting it deploy.

## How it stays private

Each app's logs are encrypted with its own key before they leave your servers (AES-256-GCM). The server keeps a copy of each app key wrapped to each person's account key, which it can't unwrap. Linking hands this computer your account key, wrapped by the approving device to a key this computer made for the link. The code you type ties that key to the link, and the account key comes back tagged with a secret only the code gives, so the server can neither choose where your account key goes nor hand this computer a key of its own. Then each command fetches the ciphertext and decrypts it here.

## Requirements

- macOS, Windows, or Linux with a Secret Service (GNOME Keyring or KWallet).
- Node 20 or later.
- A Lumber account, and a phone or Mac where Lumber already has your account key, to show the code that links this computer.

## Publishing

Tag a release to trigger the publish workflow:

```sh
npm run release:patch   # or release:minor / release:major: verifies, tags and pushes
```

## License

MIT
