import type { ClientToServerEvents, LogRecord, ServerToClientEvents } from '@infinitetoken/lumber-kit'
import { io, type Socket } from 'socket.io-client'

import type { App } from './apps'
import { SOCKET_URL } from './constants'
import type { Tone } from './format'
import { LEVELS, type Log, logsSince, matchesText, readLog } from './logs'
import type { Client } from './session'

export const POLL_MS = 5000
// How far before the newest log seen a catch-up starts, for logs written around the same moment; ids weed out repeats
const OVERLAP_MS = 5000
const SEEN_CAP = 10_000

export type TailOptions = {
  apps: App[]
  levels?: number[]
  text?: string
  // Where following starts; logs from here on that arrive late are caught up on connecting
  since: Date
  // Ids already shown (the history printed before following)
  seen?: Iterable<string>
  onLog: (log: Log) => void
  onStatus: (text: string, tone: Tone) => void
  onError: (err: unknown) => void
}

// Follows new logs: over the socket for apps whose team's plan streams them live (Dev and up), by asking the API every
// few seconds for the rest (Hobby, or every app while the socket can't connect), and after any gap (a dropped
// connection, a sleeping Mac) by asking for everything since the newest log seen.
export const followLogs = (client: Client, { apps, levels, text, since, seen: shown = [], onLog, onStatus, onError }: TailOptions): (() => void) => {
  const byId = new Map(apps.map((app) => [app.id, app]))
  const seen = new Set(shown)
  let newest = since.getTime()
  let polled: App[] = []
  let pollTimer: NodeJS.Timeout | null = null
  let catchingUp = false

  const deliver = (log: Log) => {
    if (seen.has(log.id)) return
    seen.add(log.id)
    if (seen.size > SEEN_CAP) seen.delete(seen.values().next().value as string)
    newest = Math.max(newest, new Date(log.time).getTime())
    if (levels && !levels.includes(LEVELS.indexOf(log.level))) return
    if (!matchesText(log, text)) return
    onLog(log)
  }

  const catchUp = async (from: App[]) => {
    if (!from.length || catchingUp) return
    catchingUp = true
    try {
      for (const log of await logsSince(client, from, levels, new Date(newest - OVERLAP_MS))) deliver(log)
    } catch (err) {
      onError(err)
    } finally {
      catchingUp = false
    }
  }

  const poll = (next: App[]) => {
    polled = next
    if (pollTimer) clearInterval(pollTimer)
    pollTimer = polled.length ? setInterval(() => void catchUp(polled), POLL_MS) : null
  }

  const names = (list: App[]) => list.map((app) => app.name).join(', ')

  const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(SOCKET_URL, {
    transports: ['websocket'],
    auth: { token: client.session.token },
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000
  })

  socket.on('connect', () => {
    socket.emit('listMyApps')
    // Whatever was written between the history and now, or while disconnected
    void catchUp(apps)
  })

  socket.on('myApps', ({ apps: live }) => {
    const liveIds = new Set(live.map((app) => app.id))
    const streamed = apps.filter((app) => liveIds.has(app.id))
    const rest = apps.filter((app) => !liveIds.has(app.id))
    poll(rest)
    // Named only when they differ: following one app, or all of them live, it's just "live"
    const checking = `checking every ${POLL_MS / 1000}s (no live streaming on its plan)`
    onStatus(!rest.length ? 'live' : !streamed.length ? checking : `live: ${names(streamed)} · ${checking}: ${names(rest)}`, streamed.length ? 'live' : 'quiet')
  })

  socket.on('log:created', (record) => {
    const app = byId.get(record.appId)
    if (app) deliver(readLog({ ...record, updatedAt: record.updatedAt ?? record.createdAt } as LogRecord, app))
  })

  socket.on('disconnect', (reason) => {
    if (reason === 'io client disconnect') return
    onStatus(`disconnected (${reason}), reconnecting`, 'waiting')
    poll(apps)
  })

  socket.on('connect_error', (err) => {
    if (polled.length !== apps.length) {
      onStatus(`can't reach live updates (${err.message}); checking every ${POLL_MS / 1000}s until it can`, 'waiting')
      poll(apps)
    }
  })

  return () => {
    if (pollTimer) clearInterval(pollTimer)
    socket.disconnect()
  }
}
