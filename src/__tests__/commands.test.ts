import { runCommand } from '../commands'
import { THIS_COMPUTER } from '../constants'
import { NotSignedInError } from '../errors'
import { getAccent } from '../format'
import { loadSession, openClient, saveSession } from '../session'
import { appRecord, fakeClient, logRecord, page } from './fixtures'

// Never the real credential store: runCommand reads the session for your accent before anything else
jest.mock('../session', () => ({ ...jest.requireActual('../session'), openClient: jest.fn(), loadSession: jest.fn(async () => null), saveSession: jest.fn(async () => undefined) }))
jest.mock('../mcp', () => ({ serveMcp: jest.fn(async () => undefined) }))

let stdout = ''
let stderr = ''

beforeEach(() => {
  stdout = ''
  stderr = ''
  process.exitCode = undefined
  jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout += String(chunk)
    return true
  })
  jest.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr += String(chunk)
    return true
  })
  jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    stdout += `${args.join(' ')}\n`
  })
})

afterEach(() => {
  jest.restoreAllMocks()
})

const twoApps = () => page([appRecord(), appRecord({ id: 'app-2', name: 'Locked', encryptedKey: null, retentionDays: 7 })])

describe('lumber', () => {
  it('prints its version', async () => {
    expect(await runCommand(['--version'])).toBe(0)
    expect(stdout.trim()).toBe('0.0.0')
  })

  it('lists its commands with no command', async () => {
    expect(await runCommand([])).toBe(0)
    expect(stdout).toMatch(/logs \[apps\.\.\.\]/)
    expect(stdout).toMatch(/claude mcp add lumber -- lumber mcp/)
  })

  it('exits 2 for a mistake on the command line', async () => {
    expect(await runCommand(['nope'])).toBe(2)
    expect(stderr).toMatch(/Unknown command: nope/)
    expect(await runCommand(['logs', '--nope'])).toBe(2)
    expect(await runCommand(['logs', '--level', 'loud'])).toBe(2)
    expect(stderr).toMatch(/No level named "loud"/)
  })

  it('says to sign in, exiting 1', async () => {
    jest.mocked(openClient).mockRejectedValue(new NotSignedInError())
    expect(await runCommand(['apps'])).toBe(1)
    expect(stderr).toMatch(/Run `lumber login` first/)
  })

  it('lists apps, and as JSON', async () => {
    jest.mocked(openClient).mockResolvedValue(fakeClient({ '/apps': twoApps }))
    expect(await runCommand(['apps'])).toBe(0)
    expect(stdout).toMatch(new RegExp(`Locked .*locked: no key on ${THIS_COMPUTER} · kept 7 days`))
    stdout = ''
    expect(await runCommand(['apps', '--json'])).toBe(0)
    expect(
      stdout
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line).name)
    ).toEqual(['Locked', 'Lumber-Test'])
  })

  it('says who is signed in and what this computer reads, taking up a new accent', async () => {
    jest.mocked(openClient).mockResolvedValue(fakeClient({ '/apps': twoApps, '/me': () => ({ data: { email: 'jay@example.com', color: '#60A5FA' }, metadata: { requestId: 'r', durationMs: 1 } }) }))
    expect(await runCommand(['status'])).toBe(0)
    expect(stdout).toMatch(/Signed in as jay@example.com/)
    expect(stdout).toMatch(/reads 1 of 2 apps/)
    expect(saveSession).toHaveBeenCalledWith(expect.objectContaining({ color: '#60A5FA' }))
    expect(getAccent()).toBe('#60A5FA')
  })

  it('draws in your saved accent from the start', async () => {
    jest.mocked(loadSession).mockResolvedValueOnce({ userId: 'user-1', email: 'jay@example.com', token: 'jwt', privateKey: 'k', color: '#E879F9' })
    expect(await runCommand(['--version'])).toBe(0)
    expect(getAccent()).toBe('#E879F9')
  })

  it('prints logs oldest at the bottom, with the filters', async () => {
    const client = fakeClient({ '/apps': twoApps, '/logs': () => page([logRecord('b', '2026-10-29T10:00:05.000Z', { level: 3 }), logRecord('a', '2026-10-29T10:00:00.000Z', { level: 3 })], 'more') })
    jest.mocked(openClient).mockResolvedValue(client)
    expect(await runCommand(['logs', 'lumber-test', '-l', 'error', '-n', '2', '-s', '2026-10-29'])).toBe(0)
    const lines = stdout.trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines.every((line) => /ERROR Payment retry scheduled$/.test(line))).toBe(true)
    expect(client.calls[1].params).toEqual(expect.objectContaining({ appIds: 'app-1', levels: '3,4', limit: 2, from: new Date(2026, 9, 29).toISOString() }))
    expect(stderr).toMatch(/Older logs match too/)
  })

  it('prints logs as JSON lines', async () => {
    jest.mocked(openClient).mockResolvedValue(fakeClient({ '/apps': twoApps, '/logs': () => page([logRecord('a', '2026-10-29T10:00:00.000Z')]) }))
    expect(await runCommand(['logs', 'Lumber-Test', '--json'])).toBe(0)
    expect(JSON.parse(stdout.trim())).toEqual(expect.objectContaining({ id: 'a', message: 'Payment retry scheduled', app: 'Lumber-Test' }))
  })

  it('says when nothing matches', async () => {
    jest.mocked(openClient).mockResolvedValue(fakeClient({ '/apps': twoApps, '/logs': () => page([]) }))
    expect(await runCommand(['logs', '-g', 'refund'])).toBe(0)
    expect(stderr).toMatch(/No logs match/)
  })

  it('turns down tail with a time, since it follows from now', async () => {
    expect(await runCommand(['tail', '--since', '1h'])).toBe(2)
    expect(stderr).toMatch(/Unknown Option: --since/)
  })

  it('starts the MCP server', async () => {
    const { serveMcp } = jest.requireMock('../mcp') as { serveMcp: jest.Mock }
    expect(await runCommand(['mcp'])).toBe(0)
    expect(serveMcp).toHaveBeenCalled()
  })
})
