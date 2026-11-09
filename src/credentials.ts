import { spawn } from 'node:child_process'

import { StoreUnavailableError } from './errors'

// The session (token and account key) is one secret in the system's own credential store, under the same names on
// each: the Keychain on macOS, Windows Credential Manager, and the Secret Service (GNOME Keyring, KWallet) on Linux.
// Never a file: where there's no store, lumber says so and stops.
export const SERVICE = 'Lumber CLI'
export const ACCOUNT = 'session'

export type SecretStore = { read: () => Promise<string | null>; write: (value: string) => Promise<void>; remove: () => Promise<void> }

// What it's called where lumber runs, for messages
export const storeName = (platform: NodeJS.Platform = process.platform): string => (platform === 'darwin' ? 'the Keychain' : platform === 'win32' ? 'Windows Credential Manager' : 'your keyring')

export const UNSUPPORTED = "lumber runs on macOS, Windows and Linux, where it keeps your account key in the system's own credential store."
export const NO_SECRET_SERVICE = 'lumber keeps your account key in the Secret Service (GNOME Keyring or KWallet), and none is running here. Start one, or run lumber in a desktop session that has one: it never saves your key to a file.'

// macOS: a generic password in the login keychain, through the system's own `security` tool. An item it creates
// trusts `security`, which Apple signs, so reading it back never prompts. A native module would make node the trusted
// app instead, and Homebrew's node is signed ad hoc, so macOS knows it only by its hash and asks again after every
// node upgrade.
const NOT_FOUND = 44

const security = (args: string[], input?: string): Promise<{ code: number; stdout: string; stderr: string }> =>
  new Promise((resolve, reject) => {
    // Only `security -i` reads stdin. Piping it to the others raced them: one that had already exited closed the
    // pipe, and the write that ended it raised EPIPE with no handler, which crashed the command (seen on
    // `lumber apps`, 2026-11-06)
    const child = spawn('/usr/bin/security', args, { stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }))
    if (input !== undefined) {
      // An exit before it reads shows as a non-zero code and stderr, which the callers report
      child.stdin?.on('error', () => undefined)
      child.stdin?.end(input)
    }
  })

export const keychainStore = (service = SERVICE, account = ACCOUNT): SecretStore => ({
  read: async () => {
    const { code, stdout, stderr } = await security(['find-generic-password', '-s', service, '-a', account, '-w'])
    if (code === NOT_FOUND) return null
    if (code !== 0) throw new Error(`Couldn't read the Keychain: ${stderr.trim()}`)
    return Buffer.from(stdout.trim(), 'base64').toString('utf8')
  },
  // Written through `security -i`, which reads its command from stdin, so the secret never shows in the process list
  // the way an argument would. Base64 keeps it free of the quotes and spaces that command line would have to escape.
  write: async (value) => {
    const command = `add-generic-password -U -s "${service}" -a ${account} -l "${service}" -j "Session and account key for the lumber command" -w ${Buffer.from(value).toString('base64')}\n`
    const { code, stderr } = await security(['-i'], command)
    if (code !== 0 || stderr.trim()) throw new Error(`Couldn't save to the Keychain: ${stderr.trim()}`)
  },
  remove: async () => {
    const { code, stderr } = await security(['delete-generic-password', '-s', service, '-a', account])
    if (code !== 0 && code !== NOT_FOUND) throw new Error(`Couldn't remove it from the Keychain: ${stderr.trim()}`)
  }
})

// Windows and Linux, through @napi-rs/keyring. Neither store trusts a program by its binary, so a node upgrade
// changes nothing. It's loaded only here, so a Mac never loads the native module.
export type Keyring = Pick<typeof import('@napi-rs/keyring'), 'AsyncEntry'>

export const keyringStore = (platform: 'win32' | 'linux', service = SERVICE, account = ACCOUNT, load: () => Promise<Keyring> = () => import('@napi-rs/keyring')): SecretStore => {
  const entry = async () => {
    const { AsyncEntry } = await load()
    try {
      // Pinned to the Secret Service: left to choose, the module falls back to the kernel keyring, which forgets
      // everything at reboot. It connects here, so a Linux with no Secret Service fails here.
      return new AsyncEntry(service, account, { linux: { store: 'secret-service' } })
    } catch (err) {
      if (platform === 'linux') throw new StoreUnavailableError(NO_SECRET_SERVICE)
      throw err
    }
  }
  const name = storeName(platform)
  const attempt = async <T>(what: string, action: () => Promise<T>): Promise<T> => {
    try {
      return await action()
    } catch (err) {
      if (err instanceof StoreUnavailableError) throw err
      throw new Error(`Couldn't ${what} ${name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return {
    read: () =>
      attempt('read', async () => {
        const secret = await (await entry()).getSecret()
        return secret ? Buffer.from(secret).toString('utf8') : null
      }),
    // Bytes rather than a password, which Windows keeps as UTF-16 in a blob of at most 2,560 bytes: as UTF-8 the
    // session takes half that
    write: (value) => attempt('save to', async () => (await entry()).setSecret(Buffer.from(value, 'utf8'))),
    // Removing one that isn't there is fine
    remove: () => attempt('remove it from', async () => void (await (await entry()).deleteCredential()))
  }
}

const unsupported = async (): Promise<never> => {
  throw new StoreUnavailableError(UNSUPPORTED)
}

export const storeFor = (platform: NodeJS.Platform, service = SERVICE, account = ACCOUNT): SecretStore => {
  if (platform === 'darwin') return keychainStore(service, account)
  if (platform === 'win32' || platform === 'linux') return keyringStore(platform, service, account)
  return { read: unsupported, write: unsupported, remove: unsupported }
}

const store = storeFor(process.platform)

export const readSecret = (): Promise<string | null> => store.read()
export const writeSecret = (value: string): Promise<void> => store.write(value)
export const deleteSecret = (): Promise<void> => store.remove()
