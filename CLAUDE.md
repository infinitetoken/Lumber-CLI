# Lumber-CLI

`@infinitetoken/lumber-cli`: the `lumber` command, which reads Lumber logs in the terminal and serves them to AI agents over MCP, decrypted on the Mac it runs on. Part of the Lumber suite (`../Lumber/CLAUDE.md` has the whole picture); the backlog entry it came from is `../Lumber/.planning/ROADMAP.md` Phase 999.1. Built 2026-10-29 for Chris, Lumber's first real user, ahead of launch: macOS only, read-only, no `export` yet.

## Commands

```bash
npm run verify    # lint, test, typecheck, build
npm run build     # tsup into dist/cli.mjs (the bin)
node dist/cli.mjs help
```

## Layout

- `cli.ts`: the bin's entry, nothing else. `commands.ts`: termkit's `Program` (commands, options, help), spinners and output, and `runCommand(argv)` giving the exit code (2 for a mistake on the command line, 1 otherwise).
- `session.ts`: the session in the Keychain, `request` (fetch to the API, a 401 with a token is `NotSignedInError`) and `openClient`, which reads the Keychain each time and trades a token over a day old for a fresh one (`POST /token/refresh`), as the apps' `useSessionKeeper` does.
- `keychain.ts`: one generic password ("Lumber CLI" / "session", base64 of the session JSON) through `/usr/bin/security`. Written with `security -i` reading its command from stdin, so the secret never shows in the process list. An item `security` creates trusts `security`, so reads never prompt, even after Node is upgraded (a native keychain module would trust the node binary and prompt on every upgrade).
- `crypto.ts`: Node's own crypto, no noble: X25519 keys as raw 32 bytes in base64, wrapped in fixed DER prefixes for Node; `unwrap` is the apps' ECIES (sender key, IV, tag, ciphertext; HKDF-SHA256, info `lumber-v1`, empty salt, which equals noble's undefined salt); `decryptWire` is AES-GCM with the tag first. `crypto.test.ts` checks both against vectors from the plugin and the app's own noble code.
- `login.ts`: sign in, then link as a device, as the phones' Link This Device does: a one-off keypair, `POST /device-links` (platform `web`, since the API only takes ios, android or web), a QR of `lumber://account/approve-link?code=<id>|<public key>` plus the code itself, polling every 3s until approved, and a check that the key that came back is the account's (its public half equals `/me`'s `publicKey`). The same person signing in again keeps the stored key.
- `apps.ts`, `logs.ts`: apps with their keys unwrapped; log search (newest first, paging back, text matched locally up to `DEFAULT_SCAN` logs) and `logsSince` (forward, for catching up).
- `tail.ts`: `followLogs`, the socket (`listMyApps` says which apps stream live) plus polling every 5s for the rest, catching up from the newest log seen (less 5s, ids weeding out repeats) on every connect.
- `mcp.ts`: `list_apps`, `search_logs`, `wait_for_logs` (polls `logsSince`, groups by app, level and message, returns `next_after` a millisecond past the newest) and `list_notes`, all read-only. Every tool and the server's instructions say log text is untrusted data.

## termkit

The CLI is on Jay's `termkit` (Program, input, Spinner, Table, markup, Color). It writes everything to stdout, so:
- `lumber mcp` must never touch a Spinner, `log` or Table: stdout is the MCP protocol there.
- Spinners stop without a message. Spinner draws nothing when stdout isn't a terminal, but its completion messages would still land in piped or `--json` output.
- `tail` in a terminal keeps a Spinner as a status line and prints logs above it with `spinner.log(line, '')`; piped or `--json`, logs go straight to stdout and the state to stderr.
- termkit treats `help` or `version` anywhere in argv as asking for them, so `lumber logs -g help` prints help. `-g Help` searches (the match ignores case).
- termkit's color module calls `process.exit()` on SIGINT; `tail` uses `prependOnceListener` to clear its status line first.
- termkit 2.4.12's messages still carry em dashes (`Invalid value "abc" — expected an integer`); TermKit's main has the fix, unreleased as of 2026-10-29.

## Colors

The apps' look, from Lumber-Kit: level colors (`logLevelColors`), each app's name after a square in its own color (`resolveAppColor`: its color, or its name's; the color is on the square, not the name, since most app colors are about 2:1 on a light terminal's white), and your accent for the spinner (breathing into a shade a quarter darker), help, tables and prompts (`useAccent`, through termkit's `configure`). Your accent is `/me`'s `color`, saved in the session at sign-in, at each daily token refresh and by `lumber status`, and read by `runCommand` before anything draws; amber (`DEFAULT_ACCENT`) without one. `live` is the green of the apps' connection dot, connecting amber, trouble red.

The colors and name hash are Lumber-Kit's since 0.5.2 (`^0.5.2` here); the app re-exports the same ones, so an app is the same color in both.

## Not built

`export` to NDJSON (past retention), Linux and Windows (keychains: `@napi-rs/keyring` or `secret-tool`/DPAPI), a local cache, and showing notes in `lumber logs`.
