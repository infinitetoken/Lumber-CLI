import { EventEmitter } from 'node:events'

import { formatLog, formatTime, getAccent, useAccent } from '../format'
import { deleteSecret, NOT_MACOS, readSecret, writeSecret } from '../keychain'
import type { Log } from '../logs'

const log: Log = { id: 'a', app: 'Lumber-Test', appId: 'app-1', level: 'error', time: new Date(2026, 9, 29, 9, 5, 7).toISOString(), message: 'Payment failed\nretrying', requestId: 'req-42', metadata: { orderId: 'ord-7' } }

describe('formatLog', () => {
  it('writes a log as a terminal line, continuing a message under itself', () => {
    expect(formatLog(log)).toBe(`2026-10-29 09:05:07 ERROR Payment failed\n${' '.repeat(26)}retrying`)
  })

  it('names the app when several are listed, after a mark in its color', () => {
    expect(formatLog({ ...log, message: 'x' }, { showApp: true })).toBe('2026-10-29 09:05:07 ERROR [Lumber-Test] x')
    // A square, or # where the terminal can't draw one (a non-UTF-8 locale)
    expect(formatLog({ ...log, message: 'x' }, { showApp: true, appColor: '#8B5CF6' })).toMatch(/^2026-10-29 09:05:07 ERROR (■|#) Lumber-Test x$/)
  })

  it('adds the fields under it when verbose', () => {
    const lines = formatLog({ ...log, message: 'x' }, { verbose: true }).split('\n')
    expect(lines.map((line) => line.trim())).toEqual(['2026-10-29 09:05:07 ERROR x', 'id       a', 'request  req-42', 'metadata {', 'orderId: ord-7', '}'])
  })

  it('says when a log is locked', () => {
    expect(formatLog({ ...log, message: null, locked: true })).toContain('encrypted: this Mac has no key for this app')
  })

  it('uses your accent when it is a color, and amber otherwise', () => {
    useAccent('#abc')
    expect(getAccent()).toBe('#AABBCC')
    useAccent('#60a5fa')
    expect(getAccent()).toBe('#60A5FA')
    useAccent('teal')
    expect(getAccent()).toBe('#FBBF24')
    useAccent(null)
    expect(getAccent()).toBe('#FBBF24')
  })

  it('writes local time zero-padded', () => {
    expect(formatTime(new Date(2026, 0, 2, 3, 4, 5).toISOString())).toBe('2026-01-02 03:04:05')
  })
})

const mockRuns: { args: string[]; input: string | null; stdin?: string; reply: { code: number; stdout?: string; stderr?: string } }[] = []
jest.mock('node:child_process', () => ({
  spawn: (_cmd: string, args: string[], options: { stdio: string[] }) => {
    const run = mockRuns.find((r) => r.args.join(' ') === args.join(' ') || (args[0] === '-i' && r.args[0] === '-i'))!
    run.stdin = options.stdio[0]
    const exit = () =>
      setImmediate(() => {
        if (run.reply.stdout) child.stdout.emit('data', Buffer.from(run.reply.stdout))
        if (run.reply.stderr) child.stderr.emit('data', Buffer.from(run.reply.stderr))
        child.emit('close', run.reply.code)
      })
    const stdin = Object.assign(new EventEmitter(), {
      end: (input: string) => {
        run.input = input
        exit()
      }
    })
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), stdin: run.stdin === 'pipe' ? stdin : null })
    if (run.stdin !== 'pipe') exit()
    return child
  }
}))

describe('keychain', () => {
  const platform = process.platform
  const setPlatform = (value: string) => Object.defineProperty(process, 'platform', { value, configurable: true })

  // CI runs on Linux, where the Keychain doesn't exist; these run as if on a Mac
  beforeEach(() => {
    mockRuns.length = 0
    setPlatform('darwin')
  })

  afterEach(() => setPlatform(platform))

  it('says it runs on macOS anywhere else', async () => {
    setPlatform('linux')
    await expect(readSecret()).rejects.toThrow(NOT_MACOS)
  })

  it('reads the session back from base64', async () => {
    mockRuns.push({ args: ['find-generic-password', '-s', 'Lumber CLI', '-a', 'session', '-w'], input: null, reply: { code: 0, stdout: `${Buffer.from('{"a":1}').toString('base64')}\n` } })
    expect(await readSecret()).toBe('{"a":1}')
    // Piping stdin to a command that never reads it raced its exit into an unhandled EPIPE
    expect(mockRuns[0].stdin).toBe('ignore')
  })

  it('reads nothing when there is no item', async () => {
    mockRuns.push({ args: ['find-generic-password', '-s', 'Lumber CLI', '-a', 'session', '-w'], input: null, reply: { code: 44 } })
    expect(await readSecret()).toBeNull()
  })

  it('writes through stdin, never an argument', async () => {
    mockRuns.push({ args: ['-i'], input: null, reply: { code: 0 } })
    await writeSecret('{"token":"secret"}')
    expect(mockRuns[0].input).toContain(`-w ${Buffer.from('{"token":"secret"}').toString('base64')}\n`)
    expect(mockRuns[0].input).toMatch(/^add-generic-password -U -s "Lumber CLI" -a session/)
    expect(mockRuns[0].stdin).toBe('pipe')
  })

  it("doesn't mind removing an item that isn't there", async () => {
    mockRuns.push({ args: ['delete-generic-password', '-s', 'Lumber CLI', '-a', 'session'], input: null, reply: { code: 44 } })
    await expect(deleteSecret()).resolves.toBeUndefined()
    expect(mockRuns[0].stdin).toBe('ignore')
  })
})
