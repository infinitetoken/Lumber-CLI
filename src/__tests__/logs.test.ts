import type { App } from '../apps'
import { UsageError } from '../errors'
import { logsSince, matchesText, parseLevels, readLog, searchLogs } from '../logs'
import { APP_KEY, fakeClient, logRecord, page } from './fixtures'

const app: App = { id: 'app-1', name: 'Lumber-Test', color: '#8B5CF6', retentionDays: null, logsCappedUntil: null, logsStoppedUntil: null, key: APP_KEY }

describe('parseLevels', () => {
  it('reads one level as it and those above it', () => {
    expect(parseLevels('warn')).toEqual([2, 3, 4])
    expect(parseLevels('FATAL')).toEqual([4])
  })

  it('reads a list as exactly those levels', () => {
    expect(parseLevels('warn,info')).toEqual([1, 2])
  })

  it('leaves no levels as every level', () => {
    expect(parseLevels(undefined)).toBeUndefined()
  })

  it('names the levels when one is wrong', () => {
    expect(() => parseLevels('warning')).toThrow(UsageError)
  })
})

describe('readLog', () => {
  it('decrypts a log with its app', () => {
    expect(readLog(logRecord('a', '2026-10-29T10:00:00.000Z'), app)).toEqual({
      id: 'a',
      app: 'Lumber-Test',
      appId: 'app-1',
      level: 'warn',
      time: '2026-10-29T10:00:00.000Z',
      message: 'Payment retry scheduled',
      requestId: 'req-42',
      context: expect.objectContaining({ hostname: expect.any(String) }),
      metadata: expect.objectContaining({ orderId: 'ord-7' })
    })
  })

  it('marks a log locked without its key', () => {
    expect(readLog(logRecord('a', '2026-10-29T10:00:00.000Z'), { ...app, key: null })).toEqual(expect.objectContaining({ message: null, locked: true }))
  })
})

describe('matchesText', () => {
  const log = readLog(logRecord('a', '2026-10-29T10:00:00.000Z'), app)

  it('finds text in the message, ids and metadata, ignoring case', () => {
    expect(matchesText(log, 'RETRY')).toBe(true)
    expect(matchesText(log, 'req-42')).toBe(true)
    expect(matchesText(log, 'ord-7')).toBe(true)
    expect(matchesText(log, 'refund')).toBe(false)
  })

  it('never matches a locked log on text', () => {
    expect(matchesText({ ...log, message: null, requestId: undefined, metadata: undefined, locked: true }, 'retry')).toBe(false)
  })
})

describe('searchLogs', () => {
  it('asks for only as many logs as wanted, with the filters', async () => {
    const client = fakeClient({ '/logs': () => page([logRecord('a', '2026-10-29T10:00:00.000Z'), logRecord('b', '2026-10-29T09:00:00.000Z')], '2026-10-29T09:00:00.000Z') })
    const found = await searchLogs(client, { apps: [app], levels: [3, 4], since: new Date('2026-10-28T00:00:00.000Z'), limit: 2 })
    expect(found.logs.map((log) => log.id)).toEqual(['a', 'b'])
    expect(found.more).toBe(true)
    expect(client.calls).toEqual([{ path: '/logs', params: expect.objectContaining({ appIds: 'app-1', levels: '3,4', from: '2026-10-28T00:00:00.000Z', limit: 2, cursor: null }) }])
  })

  it('leaves the levels out when every level is wanted', async () => {
    const client = fakeClient({ '/logs': () => page([]) })
    await searchLogs(client, { apps: [app], levels: [0, 1, 2, 3, 4], limit: 5 })
    expect(client.calls[0].params.levels).toBeUndefined()
  })

  it('pages back for text until it has enough', async () => {
    const pages = [page([logRecord('a', '2026-10-29T10:00:00.000Z', { encrypted: { nonce: 'x', payload: 'eA==', keyVersion: 1 } })], 'c1'), page([logRecord('b', '2026-10-29T09:00:00.000Z')], 'c2'), page([logRecord('c', '2026-10-29T08:00:00.000Z')])]
    const client = fakeClient({ '/logs': () => pages.shift()! })
    const found = await searchLogs(client, { apps: [app], text: 'retry', limit: 5 })
    expect(found.logs.map((log) => log.id)).toEqual(['b', 'c'])
    expect(found.more).toBe(false)
    expect(found.scanned).toBe(3)
    expect(client.calls.map((call) => [call.params.limit, call.params.cursor])).toEqual([
      [1000, null],
      [1000, 'c1'],
      [1000, 'c2']
    ])
  })

  it('stops reading back for text at the scan limit', async () => {
    const client = fakeClient({ '/logs': () => page([logRecord('a', '2026-10-29T10:00:00.000Z')], 'next') })
    const found = await searchLogs(client, { apps: [app], text: 'nothing like this', limit: 5, scan: 3 })
    expect(found).toEqual({ logs: [], scanned: 3, more: true })
  })

  it('asks for nothing without apps', async () => {
    const client = fakeClient({})
    expect(await searchLogs(client, { apps: [], limit: 5 })).toEqual({ logs: [], scanned: 0, more: false })
  })
})

describe('logsSince', () => {
  it('reads forward from a time through every page', async () => {
    const pages = [page([logRecord('a', '2026-10-29T10:00:00.000Z')], 'c1'), page([logRecord('b', '2026-10-29T10:00:01.000Z')])]
    const client = fakeClient({ '/logs': () => pages.shift()! })
    const logs = await logsSince(client, [app], [3, 4], new Date('2026-10-29T10:00:00.000Z'))
    expect(logs.map((log) => log.id)).toEqual(['a', 'b'])
    expect(client.calls[0].params).toEqual(expect.objectContaining({ from: '2026-10-29T10:00:00.000Z', sort: 'asc', levels: '3,4' }))
    expect(client.calls[1].params.cursor).toBe('c1')
  })
})
