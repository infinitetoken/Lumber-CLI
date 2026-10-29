import { DEFAULT_ACCENT, isValidColor, LogLevel, logLevelColors, logLevelNameToLevel } from '@infinitetoken/lumber-kit'
import { Color, config, configure, Log as Logger, markup, Spinner, type SpinnerOptions } from 'termkit'

import type { Log } from './logs'

// The apps' palette (Lumber-Kit's): the level colors for info, warnings and errors, and the green of the connection
// dot on your avatar. Color (cosmetic) leaves text plain when stdout isn't a terminal, so piped output carries no
// escape codes.
export const THEME = { live: '#4ADE80', info: logLevelColors[LogLevel.Info], warn: logLevelColors[LogLevel.Warn], error: logLevelColors[LogLevel.Error] } as const

const sixDigits = (hex: string) => (hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex)

// A quarter of the way to black, for the spinner to breathe into, as the default amber deepens toward the icon's
// darker amber
const deepen = (hex: string) =>
  `#${[1, 3, 5]
    .map((i) =>
      Math.round(parseInt(hex.slice(i, i + 2), 16) * 0.75)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`

// Your accent, as the apps theme everything with it: the account's color (saved with the session), or amber
let accent: string = DEFAULT_ACCENT

export const getAccent = (): string => accent

export const useAccent = (color: string | null | undefined): void => {
  accent = color && isValidColor(color) ? sixDigits(color).toUpperCase() : DEFAULT_ACCENT
  configure({ color: accent as `#${string}` })
}

useAccent(null)

const DONE_COLORS = { successColor: THEME.live, failColor: THEME.error, warnColor: THEME.warn, infoColor: THEME.info }

// termkit's spinner, breathing between your accent and a deeper shade of it, and its log, with the apps' green, red,
// amber and blue marks
export const lumberSpinner = (text: string, options: SpinnerOptions = {}): Spinner => new Spinner(text, { colors: [accent, deepen(accent)], colorCycle: 0.5, ...DONE_COLORS, ...options })
export const say = new Logger(DONE_COLORS)

// An app's name after a square in its own color (its color, or its name's: Lumber-Kit's resolveAppColor), a square
// as its avatar is. The color goes on the mark, not the name: on a light terminal most app colors are too faint to
// read as text (amber and lime about 2:1 on white), and the name in the terminal's own color reads on any background.
export const appName = (name: string, color: string, style: 'bold' | 'faint' | 'plain' = 'plain'): string => {
  const mark = Color.hex(color)(config.glyphs ? '■' : '#')
  return `${mark} ${style === 'bold' ? Color.bold(name) : style === 'faint' ? Color.faint(name) : name}`
}

// The connection's state as the apps color it: live green, waiting amber, trouble red, and anything routine faint
export type Tone = 'live' | 'waiting' | 'trouble' | 'quiet'
const TONES: Record<Exclude<Tone, 'quiet'>, string> = { live: THEME.live, waiting: THEME.warn, trouble: THEME.error }
export const toned = (tone: Tone, text: string): string => (tone === 'quiet' ? Color.faint(text) : Color.hex(TONES[tone])(text))

const pad = (n: number) => String(n).padStart(2, '0')

// Local time, 24-hour and zero-padded so the columns line up, as the log list draws it
export const formatTime = (iso: string): string => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export const formatLevel = (level: Log['level']): string => Color.bold.hex(logLevelColors[logLevelNameToLevel[level]])(level.toUpperCase().padEnd(5))

const LEAD = ' '.repeat(26)
const indent = (text: string, by: string) => text.split('\n').join(`\n${by}`)

// `2026-10-29 19:15:44 ERROR [Lumber-Test] message`, the app only when more than one is listed, and with `verbose`
// the id, IDs, context and metadata under it
export const formatLog = (log: Log, { showApp = false, appColor, verbose = false }: { showApp?: boolean; appColor?: string; verbose?: boolean } = {}): string => {
  const app = appColor ? appName(log.app, appColor, 'faint') : Color.faint(`[${log.app}]`)
  const head = [Color.faint(formatTime(log.time)), formatLevel(log.level), ...(showApp ? [app] : [])].join(' ')
  const message = log.locked ? Color.faint('encrypted: this Mac has no key for this app') : indent(log.message ?? '', LEAD)
  if (!verbose) return `${head} ${message}`
  const fields: [string, unknown][] = [
    ['id', log.id],
    ['request', log.requestId],
    ['trace', log.traceId],
    ['context', log.context],
    ['metadata', log.metadata]
  ]
  const lines = fields.filter(([, value]) => value !== undefined).map(([key, value]) => `${LEAD}${Color.faint(key.padEnd(9))}${typeof value === 'string' ? value : indent(markup(value), `${LEAD}${' '.repeat(9)}`)}`)
  return [`${head} ${message}`, ...lines].join('\n')
}

export const formatJson = (log: Log): string => JSON.stringify(log)
