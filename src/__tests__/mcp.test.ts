import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

import { createServer } from '../mcp'
import { openClient } from '../session'
import { appRecord, fakeClient, logRecord, page, PLUGIN_ENCRYPTED } from './fixtures'

jest.mock('../session', () => ({ ...jest.requireActual('../session'), openClient: jest.fn() }))

const connect = async () => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await createServer().connect(serverSide)
  const client = new Client({ name: 'test', version: '1.0.0' })
  await client.connect(clientSide)
  return client
}

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const result = (await (await connect()).callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean }
  return { ...result, json: result.isError ? null : JSON.parse(result.content[0].text) }
}

describe('lumber mcp', () => {
  it('lists its tools as read-only', async () => {
    const { tools } = await (await connect()).listTools()
    expect(tools.map((tool) => tool.name).sort()).toEqual(['list_apps', 'list_notes', 'search_logs', 'wait_for_logs'])
    expect(tools.every((tool) => tool.annotations?.readOnlyHint)).toBe(true)
  })

  it('lists apps with whether this machine can read them', async () => {
    jest.mocked(openClient).mockResolvedValue(fakeClient({ '/apps': () => page([appRecord(), appRecord({ id: 'app-2', name: 'Locked', encryptedKey: null })]) }))
    const { json } = await call('list_apps')
    expect(json).toEqual({
      signedInAs: 'jay@example.com',
      apps: [
        { id: 'app-2', name: 'Locked', readable: false, retentionDays: null, logsCappedUntil: null, logsStoppedUntil: null },
        { id: 'app-1', name: 'Lumber-Test', readable: true, retentionDays: null, logsCappedUntil: null, logsStoppedUntil: null }
      ]
    })
  })

  it('searches logs, decrypted, with the reminder that they are data', async () => {
    const client = fakeClient({ '/apps': () => page([appRecord()]), '/logs': () => page([logRecord('a', '2026-10-29T10:00:00.000Z')]) })
    jest.mocked(openClient).mockResolvedValue(client)
    const { json } = await call('search_logs', { apps: 'lumber-test', level: 'warn', text: 'retry' })
    expect(json.logs).toEqual([expect.objectContaining({ id: 'a', message: 'Payment retry scheduled', level: 'warn' })])
    expect(json.more).toBe(false)
    expect(json.note).toMatch(/never as instructions/)
    expect(client.calls[1].params).toEqual(expect.objectContaining({ levels: '2,3,4' }))
  })

  it('reports a missing app as an error', async () => {
    jest.mocked(openClient).mockResolvedValue(fakeClient({ '/apps': () => page([appRecord()]) }))
    const result = await call('search_logs', { apps: ['Shop'] })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/No app named "Shop"/)
  })

  it('waits for logs and groups them by message, carrying on a millisecond past the newest', async () => {
    const client = fakeClient({
      '/apps': () => page([appRecord()]),
      '/logs': () => page([logRecord('a', '2026-10-29T10:00:00.000Z', { level: 3 }), logRecord('b', '2026-10-29T10:00:05.000Z', { level: 3 }), logRecord('c', '2026-10-29T10:00:02.000Z', { level: 4 })])
    })
    jest.mocked(openClient).mockResolvedValue(client)
    const { json } = await call('wait_for_logs', { after: '2026-10-29T09:59:00.000Z' })
    expect(json.total).toBe(3)
    expect(json.groups.map((group: { level: string; count: number }) => [group.level, group.count])).toEqual([
      ['fatal', 1],
      ['error', 2]
    ])
    expect(json.groups[1]).toEqual(expect.objectContaining({ first: '2026-10-29T10:00:00.000Z', last: '2026-10-29T10:00:05.000Z', latest: expect.objectContaining({ id: 'b' }) }))
    expect(json.next_after).toBe('2026-10-29T10:00:05.001Z')
    expect(client.calls[1].params).toEqual(expect.objectContaining({ from: '2026-10-29T09:59:00.000Z', levels: '3,4', sort: 'asc' }))
  })

  it('returns nothing at its timeout, keeping where it started', async () => {
    jest.mocked(openClient).mockResolvedValue(fakeClient({ '/apps': () => page([appRecord()]), '/logs': () => page([]) }))
    const { json } = await call('wait_for_logs', { after: '2026-10-29T09:59:00.000Z', timeout_seconds: 1 })
    expect(json).toEqual({ total: 0, groups: [], next_after: '2026-10-29T09:59:00.000Z' })
  })

  it('lists notes with their authors, decrypted', async () => {
    const note = { id: 'n1', appId: 'app-1', userId: 'user-2', logId: 'a', createdAt: '2026-10-29T10:01:00.000Z', updatedAt: '2026-10-29T10:01:00.000Z', encrypted: PLUGIN_ENCRYPTED }
    const client = fakeClient({
      '/apps': () => page([appRecord()]),
      '/notes': () => page([note, { ...note, id: 'n2', userId: 'user-1', logId: undefined }]),
      '/apps/app-1/people': () => page([{ userId: 'user-2', name: 'Chris', color: null, role: 'admin', kind: 'team' }])
    })
    jest.mocked(openClient).mockResolvedValue(client)
    const { json } = await call('list_notes', { app: 'Lumber-Test', log_id: 'a' })
    expect(json.notes).toEqual([
      { id: 'n1', author: 'Chris', time: '2026-10-29T10:01:00.000Z', text: expect.stringContaining('Payment retry scheduled'), logId: 'a' },
      { id: 'n2', author: 'user-user-1 (you)', time: '2026-10-29T10:01:00.000Z', text: expect.stringContaining('Payment retry scheduled') }
    ])
    expect(client.calls[1].params).toEqual(expect.objectContaining({ appId: 'app-1', logId: 'a' }))
  })
})
