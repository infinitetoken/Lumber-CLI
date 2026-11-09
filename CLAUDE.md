# Lumber-CLI

`@infinitetoken/lumber-cli`: the `lumber` command, which reads Lumber logs in the terminal and serves them to AI agents over MCP, decrypted on the computer it runs on. Part of the Lumber suite (`../Lumber/CLAUDE.md` has the whole picture); the backlog entry it came from is `../Lumber/.planning/ROADMAP.md` Phase 999.1. Built 2026-10-29 for Chris, Lumber's first real user, ahead of launch: read-only, no `export` yet. macOS only until 0.3.0 (2026-11-09), which added Windows and Linux.

## Commands

```bash
npm run verify    # lint, test, typecheck, build
npm run build     # tsup into dist/cli.mjs (the bin)
node dist/cli.mjs help
```

## CI

`ci.yml` runs the shared `npm-ci.yml` (lint, test, typecheck, build on Linux) and a `test` job on macOS, Windows and Linux runners with `LUMBER_STORE_TEST=1`, which turns on `credentialStore.test.ts`: it saves, reads, replaces and removes a "Lumber CLI test" item in the runner's real store (never the session's own name). On Linux it first checks that `lumber status` with no Secret Service says so, then runs the tests under `dbus-run-session` with a GNOME Keyring unlocked by a throwaway password. `LUMBER_STORE_TEST=1 npx jest credentialStore` does the same against your own store (on a Mac, the login keychain, through `security`, so no prompt). A Linux container reproduces the Linux job: `node:22-bookworm`, `apt-get install gnome-keyring dbus`, then the same `dbus-run-session` line.

## Releasing

`npm run release:patch` (or `:minor` / `:major`): `preversion` runs verify, `npm version` tags, `release` pushes with tags, and the shared publish workflow (`infinitetoken/Workflows`' `npm-publish.yml`, the same `ci.yml` and `publish.yml` as Lumber-Node, Lumber-Kit and the rest of the fleet) publishes with npm's trusted publishing, no token. The repo is public since 2026-11-09, so npm attaches provenance. `npm version` also runs the `version` script (`scripts/server-json.cjs`), which sets `server.json`'s versions to the new one and stages it into the version commit.

Then, for each release:

- **Homebrew** (`infinitetoken/homebrew-tap`, `../Homebrew-Tap`, public): its `bump.yml` checks npm every six hours and moves `Formula/lumber.rb` to the new tarball once Homebrew has installed, tested and audited it there, so nothing is needed. `gh workflow run bump.yml -R infinitetoken/homebrew-tap` bumps it now. A lumber running from Homebrew's Cellar tells people to `brew upgrade lumber`.
- **MCP Registry** (`com.infinitetoken/lumber`, `mcpName` in package.json, which the registry checks against npm): `mcp-publisher login dns --domain infinitetoken.com --private-key "$(security find-generic-password -s 'MCP Registry' -a infinitetoken.com -w)"`, then `mcp-publisher publish` from this folder, after npm has the version. The key is Ed25519, kept only in Jay's login keychain ("MCP Registry" / infinitetoken.com); its public half is the `v=MCPv1; k=ed25519; p=...` TXT record on infinitetoken.com's apex at DNSimple. A new key means a new TXT record (and removing the old one). `mcp-publisher validate` checks `server.json` first.

The first publish (0.1.0) has to be by hand, from Jay's Mac (`npm publish`, with his npm 2FA): npm only lets a package that already exists name a trusted publisher. Then on npmjs.com, the package's settings, Trusted Publisher: GitHub Actions, `infinitetoken` / `Lumber-CLI`, workflow `publish.yml`.

package.json has no `os` field: it runs on macOS, Windows and Linux, and `credentials.ts` says so anywhere else (`UNSUPPORTED`).

## Layout

- `cli.ts`: the bin's entry, nothing else. `commands.ts`: termkit's `Program` (commands, options, help), spinners and output, and `runCommand(argv)` giving the exit code (2 for a mistake on the command line, 1 otherwise).
- `session.ts`: the session in the credential store (`credentials.ts`), `request` (fetch to the API, a 401 with a token is `NotSignedInError`) and `openClient`, which reads the store each time and trades a token over a day old for a fresh one (`POST /token/refresh`), as the apps' `useSessionKeeper` does.
- `credentials.ts` (since 0.3.0; `keychain.ts` before): the session in the system's own credential store, always service "Lumber CLI", account "session", never a file. `storeFor(platform)` picks:
  - macOS, `keychainStore`: a generic password (base64 of the session JSON) through `/usr/bin/security`, as before 0.3.0, so Jay's and Chris's logins carried over untouched. Written with `security -i` reading its command from stdin, so the secret never shows in the process list. An item `security` creates trusts `security` (Apple signed, so its designated requirement survives macOS updates), so reads never prompt. A native module stays off the Mac on purpose: an item it creates trusts node, and Homebrew's node is signed ad hoc (`codesign -d -r-` gives `cdhash H"..."`), so every `brew upgrade node` would bring the Keychain prompt back, and reading the existing items would prompt once too.
  - Windows and Linux, `keyringStore`: `@napi-rs/keyring`'s `AsyncEntry`, imported only there, so a Mac never loads the native module. UTF-8 bytes through `setSecret`, since Windows keeps a password as UTF-16 in a blob of at most 2,560 bytes. Windows names it `session.Lumber CLI` (the store's `user.service`), with the store's default Enterprise persistence, which roams only on a domain with roaming profiles; neither store trusts by binary, so a node upgrade prompts nothing. Linux pins `{ linux: { store: 'secret-service' } }`: left to choose, the module falls back to the kernel keyring, which forgets at reboot. The Secret Service connects when the entry is made, so a Linux with none fails there, as `StoreUnavailableError` with `NO_SECRET_SERVICE` (exit 1, no stack).
  - `THIS_COMPUTER` (constants.ts) is "this Mac" on macOS and "this computer" elsewhere, and `storeName` names the store in messages.
- `crypto.ts`: Node's own crypto, no noble: X25519 keys as raw 32 bytes in base64, wrapped in fixed DER prefixes for Node; `unwrap` is the apps' ECIES (sender key, IV, tag, ciphertext; HKDF-SHA256, info `lumber-v1`, empty salt, which equals noble's undefined salt); `decryptWire` is AES-GCM with the tag first. `crypto.test.ts` checks both against vectors from the plugin and the app's own noble code.
- `login.ts`: sign in, then link as a device, as the phones' Link This Device does (since 2026-10-29, 0.1.1 showed a QR of the long code instead): a one-off keypair, `POST /device-links` (`platform: 'cli'`), then a `Code` prompt for the 7 digits a device holding the account key shows (it asks again for a typo, which the check digit catches, or when no device is showing a code for the request yet), the answer (`POST /device-links/:id/answer`, the answer alone: the secret the code gave stays here), polling every 3s until approved, failed (a wrong code, which ends the request) or denied, and two checks on the key that came back before anything is saved: its `deliveryTag` was made from that secret, so a device that showed the code sent it and not the server (since 2026-10-30), and it's the account's (its public half equals `/me`'s `publicKey`). A 409 on the answer means someone else answered the request, whose key couldn't be checked, so it stops there. The same person signing in again keeps the stored key. The CLI no longer shows the long code, so the device showing the code needs the 2026-10-29 app.
- `linkCode.ts`: the new device's half of the apps' link exchange (Lumber's `linkExchange.ts` over `keyCheck.ts`: CPace on ristretto255, DST `lumber-device-link-v1`, bound to the request id and user id, lowercased), with the code's Damm check digit. It only answers and checks the tag on the key that comes back (`deliveryChecksOut`), so it needs only the generator, the shared secret and the two tags. Node's crypto has no ristretto255, so it uses `@noble/curves` and `@noble/hashes`, which ship only ES modules: `jest.config.cjs` has ts-jest compile them (`allowJs`, `transformIgnorePatterns` letting `@noble/` through), since Jest can't require them on Node 22. `linkCode.test.ts` pins its answer to a request Lumber's own code started (`exchangeVector.test.ts` there checks the same answer with its `verifyLinkAnswer`) and checks the tag Lumber's code makes for it, as does Lumber-Worker's demo code, so change all three together.
- `apps.ts`, `logs.ts`: apps with their keys unwrapped; log search (newest first, paging back, text matched locally up to `DEFAULT_SCAN` logs) and `logsSince` (forward, for catching up).
- `tail.ts`: `followLogs`, the socket (`listMyApps` says which apps stream live) plus polling every 5s for the rest, catching up from the newest log seen (less 5s, ids weeding out repeats) on every connect.
- `mcp.ts`: `list_apps`, `search_logs`, `wait_for_logs` (polls `logsSince`, groups by app, level and message, returns `next_after` a millisecond past the newest) and `list_notes`, all read-only. Every tool and the server's instructions say log text is untrusted data.
- `update.ts` (since 0.2.2): the update notice. `runCommand` starts `startUpdateCheck` before a command and calls its `finish` after, which writes the notice to stderr. It fetches `registry.npmjs.org/@infinitetoken/lumber-cli/latest` (about 3 KB, 0.2s) when the last check is a day old, in parallel with the command, and `finish` aborts a check still running rather than waiting, so a command never takes longer (a fast one like `--version` just drops it and asks next run). The answer, when it last asked and when it last said so live in `lumber-cli/update.json` in the system's cache folder (`cacheDir`: `~/Library/Caches`, `%LOCALAPPDATA%`, or `$XDG_CACHE_HOME` or `~/.cache`); the notice shows at most once a day. It says `brew upgrade lumber` when lumber runs from Homebrew's Cellar (`installedWithHomebrew`, the real path of `argv[1]`), and `npm install -g` otherwise. Only at a terminal (stderr is a TTY), never for `mcp` (stdio is the protocol) or `tail` (runs until Ctrl-C, which termkit exits on), under `CI`, or with `LUMBER_NO_UPDATE_CHECK`. A prerelease never reads as newer. Jay's own `lumber` is linked to this checkout, so it reports this checkout's version.

## termkit

The CLI is on Jay's `termkit` (Program, input, Spinner, Table, markup, Color). It writes everything to stdout, so:

- `lumber mcp` must never touch a Spinner, `log` or Table: stdout is the MCP protocol there.
- Spinners stop without a message. Spinner draws nothing when stdout isn't a terminal, but its completion messages would still land in piped or `--json` output.
- `tail` in a terminal keeps a Spinner as a status line and prints logs above it with `spinner.log(line, '')`; piped or `--json`, logs go straight to stdout and the state to stderr.
- termkit treats `help` or `version` anywhere in argv as asking for them, so `lumber logs -g help` prints help. `-g Help` searches (the match ignores case).
- termkit's color module calls `process.exit()` on SIGINT; `tail` uses `prependOnceListener` to clear its status line first.
- termkit 2.4.12's parse errors still carry an em dash (`Invalid value "abc"`, then the dash, then `expected an integer`); TermKit's main has the fix, unreleased as of 2026-10-29.

## Colors

The apps' look, from Lumber-Kit: level colors (`logLevelColors`), each app's name after a square in its own color (`resolveAppColor`: its color, or its name's; the color is on the square, not the name, since most app colors are about 2:1 on a light terminal's white), and your accent for the spinner (breathing into a shade a quarter darker), help, tables and prompts (`useAccent`, through termkit's `configure`). Your accent is `/me`'s `color`, saved in the session at sign-in, at each daily token refresh and by `lumber status`, and read by `runCommand` before anything draws; amber (`DEFAULT_ACCENT`) without one. `live` is the green of the apps' connection dot, connecting amber, trouble red.

The colors and name hash are Lumber-Kit's since 0.5.2 (`^0.5.2` here); the app re-exports the same ones, so an app is the same color in both.

## Not built

`export` to NDJSON (past retention), standalone binaries with no Node (for winget, apt and a Scoop bucket), a local cache, and showing notes in `lumber logs`.
