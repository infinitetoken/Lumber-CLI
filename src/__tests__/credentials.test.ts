import { EventEmitter } from 'node:events'

import { checkStore, keychainStore, type Keyring, keyringStore, NO_SECRET_SERVICE, type SecretStore, storeFor, UNSUPPORTED } from '../credentials'
import { StoreUnavailableError } from '../errors'

// Each store is tested directly, wherever the tests run, so none of this pretends to be another system.
// credentialStore.test.ts runs the real store of the system it's on (in CI, all three).

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

describe('the Keychain (macOS)', () => {
  beforeEach(() => {
    mockRuns.length = 0
  })

  it('reads the session back from base64', async () => {
    mockRuns.push({ args: ['find-generic-password', '-s', 'Lumber CLI', '-a', 'session', '-w'], input: null, reply: { code: 0, stdout: `${Buffer.from('{"a":1}').toString('base64')}\n` } })
    expect(await keychainStore().read()).toBe('{"a":1}')
    // Piping stdin to a command that never reads it raced its exit into an unhandled EPIPE
    expect(mockRuns[0].stdin).toBe('ignore')
  })

  it('reads nothing when there is no item', async () => {
    mockRuns.push({ args: ['find-generic-password', '-s', 'Lumber CLI', '-a', 'session', '-w'], input: null, reply: { code: 44 } })
    expect(await keychainStore().read()).toBeNull()
  })

  it('writes through stdin, never an argument', async () => {
    mockRuns.push({ args: ['-i'], input: null, reply: { code: 0 } })
    await keychainStore().write('{"token":"secret"}')
    expect(mockRuns[0].input).toContain(`-w ${Buffer.from('{"token":"secret"}').toString('base64')}\n`)
    expect(mockRuns[0].input).toMatch(/^add-generic-password -U -s "Lumber CLI" -a session/)
    expect(mockRuns[0].stdin).toBe('pipe')
  })

  it("doesn't mind removing an item that isn't there", async () => {
    mockRuns.push({ args: ['delete-generic-password', '-s', 'Lumber CLI', '-a', 'session'], input: null, reply: { code: 44 } })
    await expect(keychainStore().remove()).resolves.toBeUndefined()
    expect(mockRuns[0].stdin).toBe('ignore')
  })

  it('says what the Keychain said when it fails', async () => {
    mockRuns.push({ args: ['find-generic-password', '-s', 'Lumber CLI', '-a', 'session', '-w'], input: null, reply: { code: 51, stderr: 'User interaction is not allowed.\n' } })
    await expect(keychainStore().read()).rejects.toThrow("Couldn't read the Keychain: User interaction is not allowed.")
  })
})

// A stand-in for @napi-rs/keyring's AsyncEntry, keeping one secret per service and account
const fakeKeyring = (fail?: { construct?: Error; read?: Error }) => {
  const saved = new Map<string, number[]>()
  const made: { service: string; account: string; options: unknown }[] = []
  class AsyncEntry {
    private readonly key: string
    constructor(service: string, account: string, options?: unknown) {
      if (fail?.construct) throw fail.construct
      made.push({ service, account, options })
      this.key = `${service}/${account}`
    }
    async getSecret() {
      if (fail?.read) throw fail.read
      return saved.get(this.key) ?? null
    }
    async setSecret(secret: Uint8Array) {
      saved.set(this.key, [...secret])
    }
    async deleteCredential() {
      return saved.delete(this.key)
    }
  }
  return { saved, made, load: async () => ({ AsyncEntry }) as unknown as Keyring }
}

describe('Windows Credential Manager and the Secret Service', () => {
  it('keeps the session as UTF-8 bytes under the same names as the Keychain', async () => {
    const keyring = fakeKeyring()
    const store = keyringStore('win32', undefined, undefined, keyring.load)
    expect(await store.read()).toBeNull()
    await store.write('{"email":"jé@example.com"}')
    expect(Buffer.from(keyring.saved.get('Lumber CLI/session')!).toString('utf8')).toBe('{"email":"jé@example.com"}')
    expect(await store.read()).toBe('{"email":"jé@example.com"}')
    await store.remove()
    expect(await store.read()).toBeNull()
    // Removing one that isn't there is fine
    await expect(store.remove()).resolves.toBeUndefined()
  })

  it('asks for the Secret Service on Linux, never the kernel keyring, which forgets at reboot', async () => {
    const keyring = fakeKeyring()
    await keyringStore('linux', undefined, undefined, keyring.load).read()
    expect(keyring.made).toEqual([{ service: 'Lumber CLI', account: 'session', options: { linux: { store: 'secret-service' } } }])
  })

  it('says plainly when Linux has no Secret Service', async () => {
    const keyring = fakeKeyring({ construct: new Error('Platform secure storage failure: D-Bus error: The name org.freedesktop.secrets was not provided by any .service files') })
    const read = keyringStore('linux', undefined, undefined, keyring.load).read()
    await expect(read).rejects.toThrow(NO_SECRET_SERVICE)
    await expect(read).rejects.toBeInstanceOf(StoreUnavailableError)
  })

  it('names the store when it fails', async () => {
    await expect(keyringStore('win32', undefined, undefined, fakeKeyring({ read: new Error('Element not found.') }).load).read()).rejects.toThrow("Couldn't read Windows Credential Manager: Element not found.")
    await expect(keyringStore('linux', undefined, undefined, fakeKeyring({ read: new Error('Collection is locked') }).load).read()).rejects.toThrow("Couldn't read your keyring: Collection is locked")
  })
})

describe('storeFor', () => {
  it('says where lumber runs anywhere else', async () => {
    await expect(storeFor('aix').read()).rejects.toThrow(UNSUPPORTED)
    await expect(storeFor('freebsd').write('x')).rejects.toBeInstanceOf(StoreUnavailableError)
  })
})

describe('checkStore', () => {
  const memory = (broken?: 'write' | 'remove'): SecretStore & { value: string | null } => {
    const store = {
      value: null as string | null,
      read: async () => store.value,
      write: async (value: string) => void (store.value = broken === 'write' ? value.slice(1) : value),
      remove: async () => void (broken === 'remove' || (store.value = null))
    }
    return store
  }

  it('saves, reads back, replaces and removes a test item, leaving nothing behind', async () => {
    const store = memory()
    await expect(checkStore(store)).resolves.toBeUndefined()
    expect(store.value).toBeNull()
  })

  it('says which step the store got wrong', async () => {
    await expect(checkStore(memory('write'))).rejects.toThrow('gave back something else after saving')
    const sticky = memory('remove')
    sticky.value = 'left over'
    await expect(checkStore(sticky)).rejects.toThrow('gave back something else before saving')
  })
})
