import type { UserRecord } from '@infinitetoken/lumber-kit'
import { Color, Program, type Spinner, Table } from 'termkit'

import { type App, loadApps, pickApps } from './apps'
import { VERSION } from './constants'
import { ApiError, NotSignedInError, UsageError } from './errors'
import { appName, formatJson, formatLog, formatTime, lumberSpinner, say, THEME, type Tone, toned, useAccent } from './format'
import { login, logout } from './login'
import { DEFAULT_SCAN, type Log, parseLevels, searchLogs } from './logs'
import { serveMcp } from './mcp'
import { type Client, loadSession, openClient, saveSession } from './session'
import { followLogs } from './tail'
import { parseTime } from './time'

const out = (text: string): void => void process.stdout.write(`${text}\n`)
const note = (text: string): void => void process.stderr.write(`${Color.faint(text)}\n`)

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`

// A spinner for a wait, cleared before anything prints. Spinner draws nothing when stdout isn't a terminal, so piped
// and --json output stay clean.
const during = async <T>(text: string, work: (spinner: Spinner) => Promise<T>): Promise<T> => {
  const spinner = lumberSpinner(text)
  spinner.start()
  try {
    return await work(spinner)
  } finally {
    spinner.stop()
  }
}

const openApps = (wanted: string[] = []): Promise<{ client: Client; apps: App[] }> =>
  during('Loading apps', async () => {
    const client = await openClient()
    return { client, apps: pickApps(await loadApps(client), wanted) }
  })

type ListOptions = { apps?: string[]; level?: string; grep?: string; lines?: number; verbose?: boolean; json?: boolean }

// The app is named on each line only when several are listed, in its own color
const printer = ({ json, verbose }: ListOptions, apps: App[]) => {
  const colors = new Map(apps.map((app) => [app.id, app.color]))
  return (log: Log): string => (json ? formatJson(log) : formatLog(log, { showApp: apps.length > 1, appColor: colors.get(log.appId), verbose }))
}

const status = async () => {
  const { client, apps } = await openApps()
  const { data: me } = await client.get<UserRecord>('/me')
  // A fresh look at the account, so an accent picked in the app shows here now rather than at tomorrow's refresh
  if ((me.color ?? null) !== (client.session.color ?? null)) {
    await saveSession({ ...client.session, color: me.color ?? null })
    useAccent(me.color)
  }
  const readable = apps.filter((app) => app.key).length
  say.succeed(`Signed in as ${Color.bold(me.email)}`)
  if (readable === apps.length) say.info(`This Mac reads all ${plural(apps.length, 'app')}`)
  else say.warn(`This Mac reads ${readable} of ${plural(apps.length, 'app')}: the rest wait for someone who has their keys to share them`)
}

const apps = async ({ json }: { json?: boolean }) => {
  const { apps: list } = await openApps()
  if (json) {
    for (const app of list) out(JSON.stringify({ id: app.id, name: app.name, color: app.color, readable: !!app.key, retentionDays: app.retentionDays, logsCappedUntil: app.logsCappedUntil }))
    return
  }
  if (!list.length) return say.info('No apps yet.')
  new Table(
    list.map((app) => ({
      name: appName(app.name, app.color, 'bold'),
      id: Color.faint(app.id),
      notes: [!app.key && Color.hex(THEME.warn)('locked: no key on this Mac'), app.retentionDays && `kept ${app.retentionDays} days`, app.logsCappedUntil && new Date(app.logsCappedUntil) > new Date() && Color.hex(THEME.error)(`monthly limit reached until ${formatTime(app.logsCappedUntil)}`)].filter(Boolean).join(' · ')
    })),
    {
      columns: [
        { key: 'name', title: 'App' },
        { key: 'id', title: 'Id' },
        { key: 'notes', title: '' }
      ],
      separator: '  '
    }
  ).print()
}

const lines = (value: number | undefined, fallback: number): number => {
  if (value === undefined) return fallback
  if (value < 0) throw new UsageError('--lines takes 0 or more.')
  return value
}

const logs = async (options: ListOptions & { since?: string; until?: string }) => {
  // The command line is checked before anything is asked of Lumber
  const levels = parseLevels(options.level)
  const since = options.since ? parseTime(options.since) : undefined
  const until = options.until ? parseTime(options.until) : undefined
  const limit = lines(options.lines, 100)
  const { client, apps: picked } = await openApps(options.apps)
  const found = await during('Reading logs', (spinner) =>
    searchLogs(client, {
      apps: picked,
      levels,
      since,
      until,
      text: options.grep,
      limit,
      onPage: (scanned) => options.grep && spinner.suffix(Color.faint(`${scanned.toLocaleString()} read`))
    })
  )
  const print = printer(options, picked)
  for (const log of [...found.logs].reverse()) out(print(log))
  if (!found.logs.length) note(found.more ? `No match in the newest ${found.scanned.toLocaleString()} logs; narrow with --since to look further back.` : 'No logs match.')
  else if (found.more) note(options.grep && found.scanned >= DEFAULT_SCAN ? `Stopped after reading back ${found.scanned.toLocaleString()} logs; narrow with --since for older matches.` : 'Older logs match too: raise --lines or narrow with --since.')
}

const tail = async (options: ListOptions & { quiet?: boolean }) => {
  const levels = parseLevels(options.level)
  const limit = lines(options.lines, 10)
  const { client, apps: picked } = await openApps(options.apps)
  if (!picked.length) throw new UsageError('No apps to follow.')
  const print = printer(options, picked)
  const since = new Date()
  const history = await during('Reading logs', () => searchLogs(client, { apps: picked, levels, text: options.grep, limit }))
  for (const log of [...history.logs].reverse()) out(print(log))

  // In a terminal the connection's state stays on a line under the logs, which print above it; piped, or as JSON, the
  // logs go to stdout alone and the state to stderr
  const pinned = process.stdout.isTTY && !options.json && !options.quiet ? lumberSpinner(`Following ${picked.length === 1 ? appName(picked[0].name, picked[0].color, 'bold') : Color.bold(plural(picked.length, 'app'))}`, { suffix: `${Color.faint('·')} ${toned('waiting', 'connecting')}` }) : null
  pinned?.start()
  const show = (log: Log) => (pinned ? pinned.log(print(log), '') : out(print(log)))
  const tell = (text: string, tone: Tone) => (pinned ? pinned.suffix(`${Color.faint('·')} ${toned(tone, text)}`) : !options.quiet && process.stderr.write(`${toned(tone, text)}\n`))

  await new Promise<void>((resolve) => {
    const end = () => {
      stop()
      pinned?.stop()
      resolve()
    }
    const stop = followLogs(client, {
      apps: picked,
      levels,
      text: options.grep,
      since,
      seen: history.logs.map((log) => log.id),
      onLog: show,
      onStatus: tell,
      onError: (err) => {
        // A session that ended stops following; anything else is retried at the next poll
        if (err instanceof NotSignedInError) {
          end()
          process.stderr.write(`${err.message}\n`)
          process.exitCode = 1
        } else tell(err instanceof Error ? err.message : String(err), 'trouble')
      }
    })
    // Ahead of termkit's own SIGINT handler, which exits at once, so the pinned line is cleared first
    process.prependOnceListener('SIGINT', end)
  })
}

const listOptions = [Program.option('l', 'level', '<level>', 'A level and above (warn), or exact levels (info,warn): debug, info, warn, error, fatal'), Program.option('g', 'grep', '<text>', 'Only logs containing this text, ignoring case'), Program.option('v', 'verbose', null, 'Show ids, context and metadata under each log'), Program.option(null, 'json', null, 'One JSON object per log, for scripts and agents')]

const program = Program.command('lumber')
  .version(VERSION)
  .description('Read your Lumber logs, decrypted on this Mac. Apps are names (any case) or ids; none means every app. Add Lumber to Claude Code with: claude mcp add lumber -- lumber mcp')
  .commands([
    Program.command('login')
      .description('Sign in and link this Mac (approved from a device that has your account key)')
      .action(() => login()),
    Program.command('logout')
      .description("Sign out and remove this Mac's account key")
      .action(() => logout()),
    Program.command('status')
      .description("Who's signed in and which apps this Mac can read")
      .action(() => status()),
    Program.command('apps')
      .description('Your apps')
      .option(null, 'json', null, 'One JSON object per app')
      .action((options) => apps(options as { json?: boolean })),
    Program.command('logs', '[apps...]')
      .description('The newest logs, oldest at the bottom')
      .options(listOptions)
      .option('n', 'lines', '<lines:integer>', 'How many logs (default 100)')
      .option('s', 'since', '<time>', 'From an age (15m, 2h, 3d), a day (2026-10-29) or an ISO time')
      .option('u', 'until', '<time>', 'Up to an age, a day or an ISO time')
      .action((options) => logs(options as ListOptions)),
    Program.command('tail', '[apps...]')
      .description('Follow new logs as they arrive')
      .options(listOptions)
      .option('n', 'lines', '<lines:integer>', 'How many recent logs to show first (default 10)')
      .option('q', 'quiet', null, 'No connection state')
      .action((options) => tail(options as ListOptions)),
    Program.command('mcp')
      .description('Serve the same reads to an AI agent over MCP (stdio)')
      .action(() => serveMcp())
  ])

const fail = (message: string) => process.stderr.write(`${Color.hex(THEME.error)('✖')} ${message}\n`)

// Runs a command line (without node and the script) and gives the exit code. A command that keeps running (tail,
// mcp) resolves once it ends or, for mcp, once it's serving.
export const runCommand = async (argv: string[]): Promise<number> => {
  try {
    // Your accent colors the help and prompts too, so it's read before anything draws
    useAccent((await loadSession().catch(() => null))?.color)
    await program.parse(['node', 'lumber', ...argv])
    return Number(process.exitCode ?? 0)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    fail(message)
    // A mistake on the command line, ours or termkit's own (an unknown command or option, a value it can't read)
    if (err instanceof UsageError || err instanceof SyntaxError || /^(Unknown|Missing|Invalid) /.test(message)) return 2
    if (err instanceof NotSignedInError || err instanceof ApiError) return 1
    if (err instanceof Error && err.stack) process.stderr.write(`${err.stack}\n`)
    return 1
  }
}
