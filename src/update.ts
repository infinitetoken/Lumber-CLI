import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'

import { Color } from 'termkit'

import { getAccent } from './format'

// Saying when a newer lumber is on npm, without slowing a command down: the registry is asked at most once a day,
// while the command runs, and a check still going when the command ends is dropped and tried next time. The answer
// is kept in a small file, so the other runs that day read it from there.
export const PACKAGE = '@infinitetoken/lumber-cli'
const LATEST_URL = `https://registry.npmjs.org/${PACKAGE}/latest`
const DAY_MS = 24 * 60 * 60 * 1000

// When it last asked, what npm said, and when it last said so here
export type UpdateState = { checkedAt?: number; latest?: string; notifiedAt?: number }

// Where each system keeps caches: ~/Library/Caches on macOS, %LOCALAPPDATA% on Windows, and $XDG_CACHE_HOME or
// ~/.cache on Linux
export const cacheDir = (platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env, home = homedir()): string => {
  if (platform === 'darwin') return join(home, 'Library', 'Caches')
  if (platform === 'win32') return env.LOCALAPPDATA || join(home, 'AppData', 'Local')
  return env.XDG_CACHE_HOME && isAbsolute(env.XDG_CACHE_HOME) ? env.XDG_CACHE_HOME : join(home, '.cache')
}

export const updateFile = (): string => join(cacheDir(), 'lumber-cli', 'update.json')

// Homebrew keeps what it installs in its Cellar, so a lumber running from there updates with brew: installing it again
// with npm would only add a second copy
export const installedWithHomebrew = (script = process.argv[1]): boolean => {
  try {
    return /[\\/]Cellar[\\/]lumber[\\/]/.test(realpathSync(script))
  } catch {
    return false
  }
}

export const updateCommand = (homebrew = installedWithHomebrew()): string => (homebrew ? 'brew upgrade lumber' : `npm install -g ${PACKAGE}`)

const readState = (file: string): UpdateState => {
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'))
    return value && typeof value === 'object' ? (value as UpdateState) : {}
  } catch {
    return {}
  }
}

const writeState = (file: string, state: UpdateState): void => {
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(state))
  } catch {
    // A notice is a nicety: a cache that can't be written only means asking again next time
  }
}

const parts = (version: string): number[] | null => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim())
  return match ? match.slice(1).map(Number) : null
}

// Plain releases only: a prerelease or anything unexpected never reads as newer
export const isNewer = (latest: string, current: string): boolean => {
  const a = parts(latest)
  const b = parts(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return false
}

export const updateNotice = (latest: string, current: string, command = updateCommand()): string => `${Color.hex(getAccent())('↑')} lumber ${Color.bold(latest)} is out (you have ${current}). Update with ${Color.bold(command)}`

type CheckOptions = { version: string; file?: string; now?: () => number; fetch?: typeof fetch }

// Starts a check if the last one is a day old, and gives back what to say once the command is done: a notice when a
// newer version is out and none was shown in the last day, else null
export const startUpdateCheck = ({ version, file = updateFile(), now = Date.now, fetch: get = fetch }: CheckOptions): { finish: () => Promise<string | null> } => {
  const state = readState(file)
  const read = JSON.stringify(state)
  const controller = new AbortController()
  let checking: Promise<void> | null = null
  if (!state.checkedAt || now() - state.checkedAt >= DAY_MS) {
    checking = get(LATEST_URL, { signal: controller.signal, headers: { Accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) return
        const { version: latest } = (await response.json()) as { version?: unknown }
        if (typeof latest === 'string') Object.assign(state, { checkedAt: now(), latest })
      })
      .catch(() => undefined)
  }

  return {
    finish: async () => {
      // Never waited on: an unfinished check is dropped, so the process ends with the command
      controller.abort()
      await checking
      const show = !!state.latest && isNewer(state.latest, version) && (!state.notifiedAt || now() - state.notifiedAt >= DAY_MS)
      if (show) state.notifiedAt = now()
      if (JSON.stringify(state) !== read) writeState(file, state)
      return show && state.latest ? updateNotice(state.latest, version) : null
    }
  }
}

// Only for a person at a terminal: not under CI, not for the MCP server (its stdio is the protocol, and an agent can't
// update anything) nor tail (which runs until stopped), and not when turned off with LUMBER_NO_UPDATE_CHECK
export const checksForUpdates = (argv: string[], env: NodeJS.ProcessEnv = process.env): boolean => !!process.stderr.isTTY && !env.CI && !env.LUMBER_NO_UPDATE_CHECK && !['mcp', 'tail'].includes(argv[0])
