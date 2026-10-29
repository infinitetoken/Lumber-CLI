import { createCipheriv, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes } from 'node:crypto'

import { UsageError } from '../errors'
import { login, logout } from '../login'
import { ACCOUNT_PRIVATE_KEY, ACCOUNT_PUBLIC_KEY } from './fixtures'

let mockStored: string | null = null
jest.mock('../keychain', () => ({
  readSecret: async () => mockStored,
  writeSecret: async (value: string) => {
    mockStored = value
  },
  deleteSecret: async () => {
    mockStored = null
  }
}))
jest.mock('termkit', () => ({ ...jest.requireActual('termkit'), input: async (prompt: string) => (prompt === 'Email' ? 'jay@example.com' : 'password') }))

// The approving device's side: the account key wrapped to the public key in the link code, as approveLink does
const wrap = (plaintext: string, publicKey: string): string => {
  const eph = generateKeyPairSync('x25519')
  const recipient = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b656e032100', 'hex'), Buffer.from(publicKey, 'base64')]), format: 'der', type: 'spki' })
  const key = Buffer.from(hkdfSync('sha256', diffieHellman({ privateKey: eph.privateKey, publicKey: recipient }), Buffer.alloc(0), 'lumber-v1', 32))
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return Buffer.concat([eph.publicKey.export({ format: 'der', type: 'spki' }).subarray(12), iv, cipher.getAuthTag(), ct]).toString('base64')
}

type Reply = { status?: number; body: unknown }

const serve = (routes: Record<string, (body: Record<string, string>) => Reply>) => {
  const calls: { method: string; path: string; body: Record<string, string> }[] = []
  global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, string>) : {}
    calls.push({ method, path, body })
    const route = routes[`${method} ${path}`]
    if (!route) throw new Error(`No fake route for ${method} ${path}`)
    const { status = 200, body: reply } = route(body)
    return new Response(JSON.stringify(reply), { status })
  }) as typeof fetch
  return calls
}

const me = { data: { id: 'user-1', email: 'jay@example.com', publicKey: ACCOUNT_PUBLIC_KEY, color: '#60A5FA' } }

let stdout = ''

beforeEach(() => {
  mockStored = null
  stdout = ''
  jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout += String(chunk)
    return true
  })
  jest.useFakeTimers()
})

afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

const finish = async <T>(promise: Promise<T>): Promise<T> => {
  const settled = promise.then(
    (value) => ({ value }),
    (error: unknown) => ({ error })
  )
  await jest.advanceTimersByTimeAsync(10_000)
  const result = await settled
  if ('error' in result) throw result.error
  return result.value
}

const linkRoutes = (status: (publicKey: string) => Reply['body']) => {
  let publicKey = ''
  return {
    'POST /token': () => ({ status: 201, body: { data: { token: 'jwt' } } }),
    'GET /me': () => ({ body: me }),
    'POST /device-links': (body: Record<string, string>) => {
      publicKey = body.publicKey
      return { status: 201, body: { data: { id: 'link-1', expiresAt: new Date(Date.now() + 600_000).toISOString() } } }
    },
    'GET /device-links/link-1': () => ({ body: status(publicKey) })
  }
}

describe('login', () => {
  it('links this Mac from a code and keeps the account key', async () => {
    const calls = serve(linkRoutes((publicKey) => ({ data: { id: 'link-1', status: 'approved', encryptedKey: wrap(ACCOUNT_PRIVATE_KEY, publicKey) } })))
    await finish(login())
    expect(JSON.parse(mockStored!)).toEqual({ userId: 'user-1', email: 'jay@example.com', token: 'jwt', privateKey: ACCOUNT_PRIVATE_KEY, color: '#60A5FA' })
    const request = calls.find((call) => call.path === '/device-links')!
    expect(request.body).toEqual(expect.objectContaining({ platform: 'web', deviceName: expect.stringMatching(/^Lumber CLI on /) }))
    expect(stdout).toContain(`link-1|${request.body.publicKey}`)
    expect(stdout).toContain('Linked.')
  })

  it('signs the same person in again without a new link', async () => {
    mockStored = JSON.stringify({ userId: 'user-1', email: 'jay@example.com', token: null, privateKey: ACCOUNT_PRIVATE_KEY })
    const calls = serve(linkRoutes(() => ({})))
    await finish(login())
    expect(JSON.parse(mockStored!)).toEqual(expect.objectContaining({ token: 'jwt', privateKey: ACCOUNT_PRIVATE_KEY }))
    expect(calls.some((call) => call.path === '/device-links')).toBe(false)
  })

  it('says when the password is wrong', async () => {
    serve({ 'POST /token': () => ({ status: 401, body: { message: 'Incorrect email or password' } }) })
    await expect(finish(login())).rejects.toThrow(new UsageError('Incorrect email or password.'))
  })

  it('stops when the link is turned down', async () => {
    serve(linkRoutes(() => ({ data: { id: 'link-1', status: 'denied' } })))
    await expect(finish(login())).rejects.toThrow(/turned down/)
    expect(mockStored).toBeNull()
  })

  it("saves nothing when the key that comes back isn't the account's", async () => {
    const other = generateKeyPairSync('x25519').privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(16).toString('base64')
    serve(linkRoutes((publicKey) => ({ data: { id: 'link-1', status: 'approved', encryptedKey: wrap(other, publicKey) } })))
    await expect(finish(login())).rejects.toThrow(/isn't this account's key/)
    expect(mockStored).toBeNull()
  })
})

describe('logout', () => {
  it('removes the session', async () => {
    mockStored = JSON.stringify({ userId: 'user-1', email: 'jay@example.com', token: 'jwt', privateKey: ACCOUNT_PRIVATE_KEY })
    await logout()
    expect(mockStored).toBeNull()
    expect(stdout).toContain('Signed out jay@example.com')
  })
})
