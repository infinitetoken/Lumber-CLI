import type { App } from '../apps'
import type { Log } from '../logs'
import { followLogs } from '../tail'
import { APP_KEY, fakeClient, logRecord, page } from './fixtures'

const mockHandlers = new Map<string, (...args: unknown[]) => void>()
const mockSocket = { on: (event: string, handler: (...args: unknown[]) => void) => mockHandlers.set(event, handler), emit: jest.fn(), disconnect: jest.fn() }
jest.mock('socket.io-client', () => ({ io: jest.fn(() => mockSocket) }))

const live: App = { id: 'app-1', name: 'Lumber-Test', color: '#8B5CF6', retentionDays: null, logsCappedUntil: null, logsStoppedUntil: null, key: APP_KEY }
const hobby: App = { id: 'app-2', name: 'Side', color: '#F97316', retentionDays: 7, logsCappedUntil: null, logsStoppedUntil: null, key: APP_KEY }

const fire = (event: string, ...args: unknown[]) => mockHandlers.get(event)!(...args)

const start = (logsPages: () => ReturnType<typeof page>, levels?: number[]) => {
  const client = fakeClient({ '/logs': logsPages })
  const shown: Log[] = []
  const statuses: string[] = []
  const stop = followLogs(client, { apps: [live, hobby], levels, since: new Date('2026-10-29T10:00:00.000Z'), seen: ['old'], onLog: (log) => shown.push(log), onStatus: (text) => statuses.push(text), onError: jest.fn() })
  return { client, shown, statuses, stop }
}

beforeEach(() => {
  mockHandlers.clear()
  jest.clearAllMocks()
  jest.useFakeTimers()
})

afterEach(() => {
  jest.useRealTimers()
})

describe('followLogs', () => {
  it('catches up on connecting and asks which apps stream live', async () => {
    const { client, shown } = start(() => page([logRecord('old', '2026-10-29T09:59:58.000Z'), logRecord('gap', '2026-10-29T10:00:01.000Z')]))
    fire('connect')
    await jest.advanceTimersByTimeAsync(0)
    expect(mockSocket.emit).toHaveBeenCalledWith('listMyApps')
    expect(client.calls[0].params).toEqual(expect.objectContaining({ appIds: 'app-1,app-2', sort: 'asc', from: '2026-10-29T09:59:55.000Z' }))
    expect(shown.map((log) => log.id)).toEqual(['gap'])
  })

  it('shows live logs once each, at the levels asked for', () => {
    const { shown } = start(() => page([]), [3, 4])
    fire('log:created', logRecord('a', '2026-10-29T10:00:01.000Z', { level: 3 }))
    fire('log:created', logRecord('a', '2026-10-29T10:00:01.000Z', { level: 3 }))
    fire('log:created', logRecord('b', '2026-10-29T10:00:02.000Z', { level: 1 }))
    fire('log:created', logRecord('c', '2026-10-29T10:00:03.000Z', { appId: 'someone-elses' }))
    expect(shown.map((log) => [log.id, log.message])).toEqual([['a', 'Payment retry scheduled']])
  })

  it('checks apps without live streaming every few seconds', async () => {
    const { client, statuses } = start(() => page([]))
    fire('myApps', { apps: [{ id: 'app-1', name: 'Lumber-Test' }] })
    expect(statuses).toEqual(['live: Lumber-Test · checking every 5s (no live streaming on its plan): Side'])
    await jest.advanceTimersByTimeAsync(5000)
    expect(client.calls).toHaveLength(1)
    expect(client.calls[0].params.appIds).toBe('app-2')
  })

  it('checks every app while disconnected, and stops', async () => {
    const { client, statuses, stop } = start(() => page([]))
    fire('disconnect', 'transport close')
    expect(statuses).toEqual(['disconnected (transport close), reconnecting'])
    await jest.advanceTimersByTimeAsync(5000)
    expect(client.calls[0].params.appIds).toBe('app-1,app-2')
    stop()
    expect(mockSocket.disconnect).toHaveBeenCalled()
    await jest.advanceTimersByTimeAsync(10_000)
    expect(client.calls).toHaveLength(1)
  })
})
