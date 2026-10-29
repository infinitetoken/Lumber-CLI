import { type ApiResponse, type LogLevelName, logLevelToName, type LogPayload, type LogRecord } from '@infinitetoken/lumber-kit'

import type { App } from './apps'
import { decryptWire } from './crypto'
import { UsageError } from './errors'
import type { Client } from './session'

export const LEVELS: LogLevelName[] = ['debug', 'info', 'warn', 'error', 'fatal']

// One level is that level and above, as the apps' push thresholds read it; a list (`info,warn`) is exactly those
export const parseLevels = (value: string | undefined): number[] | undefined => {
  if (!value) return undefined
  const names = value
    .toLowerCase()
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
  const levels = names.map((name) => {
    const level = LEVELS.indexOf(name as LogLevelName)
    if (level < 0) throw new UsageError(`No level named "${name}". Levels: ${LEVELS.join(', ')}`)
    return level
  })
  if (levels.length === 1) return LEVELS.map((_, level) => level).filter((level) => level >= levels[0])
  return [...new Set(levels)].sort()
}

// A log as this Mac reads it. `message` is null and `locked` true when this Mac has no key for its app.
export type Log = {
  id: string
  app: string
  appId: string
  level: LogLevelName
  time: string
  message: string | null
  requestId?: string
  traceId?: string
  context?: Record<string, unknown>
  metadata?: Record<string, unknown>
  locked?: true
}

export const readLog = (record: LogRecord, app: App | undefined): Log => {
  const log: Log = { id: record.id, app: app?.name ?? record.appId, appId: record.appId, level: logLevelToName[record.level] ?? 'info', time: record.createdAt, message: null }
  if (!app?.key) return { ...log, locked: true }
  try {
    const payload = JSON.parse(decryptWire(record.encrypted, app.key)) as LogPayload
    return {
      ...log,
      message: payload.message,
      ...(payload.requestId ? { requestId: payload.requestId } : {}),
      ...(payload.traceId ? { traceId: payload.traceId } : {}),
      ...(payload.context && Object.keys(payload.context).length ? { context: payload.context } : {}),
      ...(payload.metadata && Object.keys(payload.metadata).length ? { metadata: payload.metadata } : {})
    }
  } catch {
    return { ...log, locked: true }
  }
}

// The server can't search ciphertext, so text is matched here, in the message, IDs, context and metadata, ignoring case
export const matchesText = (log: Log, text: string | undefined): boolean => {
  if (!text) return true
  const needle = text.toLowerCase()
  return [log.message, log.requestId, log.traceId, log.context && JSON.stringify(log.context), log.metadata && JSON.stringify(log.metadata)].some((field) => field?.toLowerCase().includes(needle))
}

const levelsParam = (levels: number[] | undefined): string | undefined => (levels && levels.length < LEVELS.length ? levels.join(',') : undefined)

const PAGE = 1000
// How many logs a text search reads back through before giving up, so a rare string doesn't page through a whole
// history
export const DEFAULT_SCAN = 20_000

export type LogSearch = {
  apps: App[]
  levels?: number[]
  since?: Date
  until?: Date
  text?: string
  limit: number
  scan?: number
  // Told how many logs have been read so far, after each page
  onPage?: (scanned: number) => void
}

// The newest matching logs, newest first. `more` says older ones match too (or might, past the scan).
export const searchLogs = async (client: Client, { apps, levels, since, until, text, limit, scan = DEFAULT_SCAN, onPage }: LogSearch): Promise<{ logs: Log[]; scanned: number; more: boolean }> => {
  const byId = new Map(apps.map((app) => [app.id, app]))
  const logs: Log[] = []
  let scanned = 0
  let cursor: string | null = null
  if (!apps.length || limit <= 0) return { logs, scanned, more: false }
  for (;;) {
    // Without text every log matches, so a page only needs as many as are still wanted
    const pageSize = text ? PAGE : Math.min(limit - logs.length, PAGE)
    const { data, metadata }: ApiResponse<LogRecord[]> = await client.get<LogRecord[]>('/logs', {
      appIds: apps.map((app) => app.id).join(','),
      levels: levelsParam(levels),
      from: since?.toISOString(),
      to: until?.toISOString(),
      limit: pageSize,
      cursor
    })
    scanned += data.length
    onPage?.(scanned)
    for (const [index, record] of data.entries()) {
      const log = readLog(record, byId.get(record.appId))
      if (!matchesText(log, text)) continue
      logs.push(log)
      if (logs.length === limit) return { logs, scanned, more: index < data.length - 1 || !!metadata.hasMore }
    }
    if (!metadata.hasMore || !metadata.cursor) return { logs, scanned, more: false }
    if (text && scanned >= scan) return { logs, scanned, more: true }
    cursor = metadata.cursor
  }
}

// Every log at or after a time, oldest first, for catching up. `from` takes logs at that exact time too, so a caller
// keeps the ids it has seen.
export const logsSince = async (client: Client, apps: App[], levels: number[] | undefined, after: Date): Promise<Log[]> => {
  const byId = new Map(apps.map((app) => [app.id, app]))
  const logs: Log[] = []
  let cursor: string | null = null
  if (!apps.length) return logs
  for (;;) {
    const { data, metadata }: ApiResponse<LogRecord[]> = await client.get<LogRecord[]>('/logs', {
      appIds: apps.map((app) => app.id).join(','),
      levels: levelsParam(levels),
      from: after.toISOString(),
      sort: 'asc',
      limit: PAGE,
      cursor
    })
    logs.push(...data.map((record) => readLog(record, byId.get(record.appId))))
    if (!metadata.hasMore || !metadata.cursor) return logs
    cursor = metadata.cursor
  }
}
