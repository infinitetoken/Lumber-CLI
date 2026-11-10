import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { cacheDir, checksForUpdates, howInstalled, installedWithHomebrew, isNewer, startUpdateCheck, updateHint, updateNotice, type UpdateState } from '../update'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 10, 6, 12)

let file = ''
const save = (state: UpdateState) => writeFileSync(file, JSON.stringify(state))
const saved = (): UpdateState => JSON.parse(readFileSync(file, 'utf8')) as UpdateState
const npmSays = (version: string) => jest.fn(async () => new Response(JSON.stringify({ name: '@infinitetoken/lumber-cli', version }))) as unknown as typeof fetch

beforeEach(() => {
  file = join(mkdtempSync(join(tmpdir(), 'lumber-update-')), 'update.json')
})

describe('isNewer', () => {
  it('compares each part as a number', () => {
    expect(isNewer('0.2.10', '0.2.9')).toBe(true)
    expect(isNewer('1.0.0', '0.9.9')).toBe(true)
    expect(isNewer('0.2.1', '0.2.1')).toBe(false)
    expect(isNewer('0.2.0', '0.2.1')).toBe(false)
  })

  it('never takes a prerelease or anything unexpected for newer', () => {
    expect(isNewer('0.3.0-beta.1', '0.2.1')).toBe(false)
    expect(isNewer('latest', '0.2.1')).toBe(false)
  })
})

describe('startUpdateCheck', () => {
  it('asks npm on a first run and says a newer version is out', async () => {
    const get = npmSays('0.3.0')
    const notice = await startUpdateCheck({ version: '0.2.1', file, now: () => NOW, fetch: get }).finish()
    expect(get).toHaveBeenCalledTimes(1)
    expect(notice).toContain('lumber 0.3.0 is out (you have 0.2.1)')
    expect(notice).toContain('npm install -g @infinitetoken/lumber-cli')
    expect(saved()).toEqual({ checkedAt: NOW, latest: '0.3.0', notifiedAt: NOW })
  })

  it('asks at most once a day, and says so at most once a day', async () => {
    save({ checkedAt: NOW - 1000, latest: '0.3.0', notifiedAt: NOW - 1000 })
    const get = npmSays('0.3.0')
    expect(await startUpdateCheck({ version: '0.2.1', file, now: () => NOW, fetch: get }).finish()).toBeNull()
    expect(get).not.toHaveBeenCalled()

    // A day on, it asks again, and says it again
    expect(await startUpdateCheck({ version: '0.2.1', file, now: () => NOW + DAY, fetch: get }).finish()).toContain('0.3.0 is out')
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('says it from the saved answer the first time in a day, without asking', async () => {
    save({ checkedAt: NOW - 1000, latest: '0.3.0' })
    const get = npmSays('0.3.0')
    expect(await startUpdateCheck({ version: '0.2.1', file, now: () => NOW, fetch: get }).finish()).toContain('0.3.0 is out')
    expect(get).not.toHaveBeenCalled()
  })

  it('says nothing when this is the latest', async () => {
    expect(await startUpdateCheck({ version: '0.3.0', file, now: () => NOW, fetch: npmSays('0.3.0') }).finish()).toBeNull()
    expect(saved()).toEqual({ checkedAt: NOW, latest: '0.3.0' })
  })

  it('never waits on npm: a check the command outruns is dropped and asked again next time', async () => {
    let signal: AbortSignal | undefined
    const get = jest.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          signal = init?.signal ?? undefined
          signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })
    ) as unknown as typeof fetch
    expect(await startUpdateCheck({ version: '0.2.1', file, now: () => NOW, fetch: get }).finish()).toBeNull()
    expect(signal?.aborted).toBe(true)
    expect(() => readFileSync(file)).toThrow()
  })

  it('shrugs off npm failing', async () => {
    const down = jest.fn(async () => new Response('', { status: 503 })) as unknown as typeof fetch
    expect(await startUpdateCheck({ version: '0.2.1', file, now: () => NOW, fetch: down }).finish()).toBeNull()
    const offline = jest.fn(async () => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch
    expect(await startUpdateCheck({ version: '0.2.1', file, now: () => NOW, fetch: offline }).finish()).toBeNull()
  })

  it('reads a broken saved file as nothing saved', async () => {
    writeFileSync(file, 'not json')
    expect(await startUpdateCheck({ version: '0.2.1', file, now: () => NOW, fetch: npmSays('0.3.0') }).finish()).toContain('0.3.0 is out')
  })
})

describe('cacheDir', () => {
  it("is each system's own cache folder", () => {
    expect(cacheDir('darwin', {}, '/Users/jay')).toBe(join('/Users/jay', 'Library', 'Caches'))
    expect(cacheDir('win32', { LOCALAPPDATA: 'C:\\Users\\jay\\AppData\\Local' }, 'C:\\Users\\jay')).toBe('C:\\Users\\jay\\AppData\\Local')
    expect(cacheDir('linux', {}, '/home/jay')).toBe(join('/home/jay', '.cache'))
    expect(cacheDir('linux', { XDG_CACHE_HOME: '/var/cache/jay' }, '/home/jay')).toBe('/var/cache/jay')
    // The spec ignores a relative one
    expect(cacheDir('linux', { XDG_CACHE_HOME: 'cache' }, '/home/jay')).toBe(join('/home/jay', '.cache'))
  })
})

describe('updateHint', () => {
  it('updates with brew when Homebrew installed it, and npm otherwise', () => {
    const prefix = mkdtempSync(join(tmpdir(), 'lumber-brew-'))
    const cellar = join(prefix, 'Cellar', 'lumber', '0.3.0', 'libexec', 'lib', 'node_modules', '@infinitetoken', 'lumber-cli', 'dist')
    mkdirSync(cellar, { recursive: true })
    writeFileSync(join(cellar, 'cli.mjs'), '')
    expect(installedWithHomebrew(join(cellar, 'cli.mjs'))).toBe(true)
    // The bin Homebrew links is followed to where it lives (Homebrew is never on Windows, where a link needs an admin)
    if (process.platform !== 'win32') {
      mkdirSync(join(prefix, 'bin'))
      symlinkSync(join(cellar, 'cli.mjs'), join(prefix, 'bin', 'lumber'))
      expect(installedWithHomebrew(join(prefix, 'bin', 'lumber'))).toBe(true)
    }
    expect(installedWithHomebrew(join(tmpdir(), 'nowhere', 'lumber'))).toBe(false)
    expect(howInstalled(false, process.execPath, join(cellar, 'cli.mjs'))).toBe('homebrew')
    expect(howInstalled(false, process.execPath, join(tmpdir(), 'nowhere', 'lumber'))).toBe('npm')
    expect(updateHint('homebrew')).toBe('Update with brew upgrade lumber')
    expect(updateHint('npm')).toBe('Update with npm install -g @infinitetoken/lumber-cli')
    expect(updateNotice('0.3.0', '0.2.2', 'homebrew')).toContain('Update with brew upgrade lumber')
  })

  it('tells the standalone lumber how Scoop or winget installed it, or where to download it', () => {
    expect(howInstalled(true, 'C:\\Users\\jay\\scoop\\apps\\lumber\\0.4.0\\lumber.exe')).toBe('scoop')
    expect(howInstalled(true, 'C:\\ProgramData\\scoop\\apps\\lumber\\current\\lumber.exe')).toBe('scoop')
    expect(howInstalled(true, 'C:\\Users\\jay\\AppData\\Local\\Microsoft\\WinGet\\Packages\\InfiniteToken.LumberCLI_Microsoft.Winget.Source_8wekyb3d8bbwe\\lumber.exe')).toBe('winget')
    expect(howInstalled(true, 'C:\\Program Files\\WinGet\\Packages\\InfiniteToken.LumberCLI_Microsoft.Winget.Source_8wekyb3d8bbwe\\lumber.exe')).toBe('winget')
    expect(howInstalled(true, 'C:\\Tools\\lumber.exe')).toBe('download')
    expect(howInstalled(true, '/usr/local/bin/lumber')).toBe('download')
    // Even from a Homebrew-looking place: only npm's lumber is ever in the Cellar
    expect(howInstalled(true, '/opt/homebrew/Cellar/lumber/0.4.0/bin/lumber')).toBe('download')
    expect(updateHint('scoop')).toBe('Update with scoop update lumber')
    expect(updateHint('winget')).toBe('Update with winget upgrade InfiniteToken.LumberCLI')
    expect(updateHint('download')).toBe('Download it from https://github.com/infinitetoken/Lumber-CLI/releases/latest')
  })
})

describe('checksForUpdates', () => {
  const tty = (value: boolean) => Object.defineProperty(process.stderr, 'isTTY', { value, configurable: true })
  afterEach(() => tty(false))

  it('checks for a person at a terminal', () => {
    tty(true)
    expect(checksForUpdates(['logs'], {})).toBe(true)
    expect(checksForUpdates([], {})).toBe(true)
  })

  it('never for the MCP server, tail, CI, a pipe or when turned off', () => {
    tty(true)
    expect(checksForUpdates(['mcp'], {})).toBe(false)
    expect(checksForUpdates(['tail', 'Lumber-Test'], {})).toBe(false)
    expect(checksForUpdates(['logs'], { CI: 'true' })).toBe(false)
    expect(checksForUpdates(['logs'], { LUMBER_NO_UPDATE_CHECK: '1' })).toBe(false)
    tty(false)
    expect(checksForUpdates(['logs'], {})).toBe(false)
  })
})
