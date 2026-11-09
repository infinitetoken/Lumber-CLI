import { createCipheriv, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes } from 'node:crypto'

import { ristretto255 } from '@noble/curves/ed25519.js'
import { hmac } from '@noble/hashes/hmac.js'
import { sha256, sha512 } from '@noble/hashes/sha2.js'

import { UsageError } from '../errors'
import { login, logout } from '../login'
import { ACCOUNT_PRIVATE_KEY, ACCOUNT_PUBLIC_KEY } from './fixtures'

let mockStored: string | null = null
jest.mock('../credentials', () => ({
  ...jest.requireActual('../credentials'),
  readSecret: async () => mockStored,
  writeSecret: async (value: string) => {
    mockStored = value
  },
  deleteSecret: async () => {
    mockStored = null
  }
}))
// What's typed at each Code prompt, in turn
let mockCodes: string[] = []
jest.mock('termkit', () => ({ ...jest.requireActual('termkit'), input: async (prompt: string) => (prompt === 'Email' ? 'jay@example.com' : prompt === 'Code' ? mockCodes.shift() : 'password') }))

// The approving device's side: the account key wrapped to the request's key once its code checks out, as the apps'
// finishDeviceLinks does
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

// A request and the code shown for it by the apps' own code (linkCode.test.ts and Lumber's exchangeVector.test.ts)
const LINK_ID = '347EFCE6-5E41-43C2-B653-722AAB3C4E88'
const USER_ID = '5F6F1632-0000-4000-8000-000000000001'
const SHOWN = { sid: 'W54dlsa804XUzhOteBDNxQ==', holderMessage: 'zMKOcstRzwBkAiqSII7GuXHwbGMZjco1kw2xBy/89is=' }
const CODE = '449 4554'

// The showing device's own half of that run, as the apps keep it sealed: it tags the key it sends back with the secret
// the code gave both sides (the apps' tagDelivery)
const HOLDER_SCALAR = 3118671342581577082690223759700405576621434252393237375620804575143862646188n
const DST = 'lumber-device-link-v1'
const BOUND = `${LINK_ID.toLowerCase()}|${USER_ID.toLowerCase()}`
const tagFor = (claimantMessage: string, encryptedKey: string): string => {
  const k = ristretto255.Point.fromBytes(Buffer.from(claimantMessage, 'base64')).multiply(HOLDER_SCALAR)
  const enc = (text: string) => new TextEncoder().encode(text)
  const secret = sha512(new Uint8Array([...enc(`${DST}|isk|${SHOWN.sid}|`), ...k.toBytes(), ...Buffer.from(SHOWN.holderMessage, 'base64'), ...Buffer.from(claimantMessage, 'base64')])).slice(0, 32)
  return Buffer.from(hmac(sha256, secret, enc(`${DST}|deliver|${SHOWN.sid}|${BOUND}|${SHOWN.holderMessage}|${claimantMessage}|${encryptedKey}`))).toString('base64')
}

const me = { data: { id: USER_ID, email: 'jay@example.com', publicKey: ACCOUNT_PUBLIC_KEY, color: '#60A5FA' } }

let stdout = ''

beforeEach(() => {
  mockStored = null
  mockCodes = [CODE]
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

// The server for one request: pending with no code showing until `shown`, then once answered, `after` (given the key
// the request carries, and how the showing device would tag a key sent back for the answer)
const linkRoutes = (after: (publicKey: string, tag: (encryptedKey: string) => string) => Reply['body'], { shown = true } = {}) => {
  let publicKey = ''
  let answered = false
  let claimantMessage = ''
  let reads = 0
  return {
    'POST /token': () => ({ status: 201, body: { data: { token: 'jwt' } } }),
    'GET /me': () => ({ body: me }),
    'POST /device-links': (body: Record<string, string>) => {
      publicKey = body.publicKey
      return { status: 201, body: { data: { id: LINK_ID, expiresAt: new Date(Date.now() + 600_000).toISOString() } } }
    },
    [`GET /device-links/${LINK_ID}`]: () => {
      reads++
      if (answered) return { body: after(publicKey, (encryptedKey) => tagFor(claimantMessage, encryptedKey)) }
      const showing = shown || reads > 1
      return { body: { data: { id: LINK_ID, status: 'pending', sid: showing ? SHOWN.sid : null, holderMessage: showing ? SHOWN.holderMessage : null } } }
    },
    [`POST /device-links/${LINK_ID}/answer`]: (body: Record<string, string>) => {
      answered = true
      claimantMessage = body.claimantMessage
      return { body: { data: null } }
    }
  }
}

// The showing device's approval: the account key wrapped to the request's key, tagged
const approvedWith =
  (privateKey: string) =>
  (publicKey: string, tag: (encryptedKey: string) => string): Reply['body'] => {
    const encryptedKey = wrap(privateKey, publicKey)
    return { data: { id: LINK_ID, status: 'approved', encryptedKey, deliveryTag: tag(encryptedKey) } }
  }

describe('login', () => {
  it('links this computer from the code another device shows, and keeps the account key', async () => {
    const calls = serve(linkRoutes(approvedWith(ACCOUNT_PRIVATE_KEY)))
    await finish(login())
    expect(JSON.parse(mockStored!)).toEqual({ userId: USER_ID, email: 'jay@example.com', token: 'jwt', privateKey: ACCOUNT_PRIVATE_KEY, color: '#60A5FA' })
    const request = calls.find((call) => call.path === '/device-links')!
    expect(request.body).toEqual(expect.objectContaining({ platform: 'cli', deviceName: expect.stringMatching(/^Lumber CLI on /) }))
    const answer = calls.find((call) => call.path.endsWith('/answer'))!
    expect(Buffer.from(answer.body.claimantMessage, 'base64')).toHaveLength(32)
    expect(Buffer.from(answer.body.tag, 'base64')).toHaveLength(32)
    expect(stdout).toContain('Show Code')
    expect(stdout).toContain('Linked.')
  })

  // The check digit catches a typo here, before it spends the request's one guess
  it('asks again for a mistyped code', async () => {
    mockCodes = ['449 4555', CODE]
    const calls = serve(linkRoutes(approvedWith(ACCOUNT_PRIVATE_KEY)))
    await finish(login())
    expect(calls.filter((call) => call.path.endsWith('/answer'))).toHaveLength(1)
    expect(stdout).toContain("That isn't the whole code")
  })

  it('asks again when no device is showing a code yet', async () => {
    mockCodes = [CODE, CODE]
    const calls = serve(linkRoutes(approvedWith(ACCOUNT_PRIVATE_KEY), { shown: false }))
    await finish(login())
    expect(stdout).toContain('No device is showing a code for this request yet')
    expect(calls.filter((call) => call.path.endsWith('/answer'))).toHaveLength(1)
    expect(mockStored).not.toBeNull()
  })

  it('stops when the code entered was wrong', async () => {
    serve(linkRoutes(() => ({ data: { id: LINK_ID, status: 'failed' } })))
    await expect(finish(login())).rejects.toThrow(/didn't match/)
    expect(mockStored).toBeNull()
  })

  it('signs the same person in again without a new link', async () => {
    mockStored = JSON.stringify({ userId: USER_ID, email: 'jay@example.com', token: null, privateKey: ACCOUNT_PRIVATE_KEY })
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
    serve(linkRoutes(() => ({ data: { id: LINK_ID, status: 'denied' } })))
    await expect(finish(login())).rejects.toThrow(/turned down/)
    expect(mockStored).toBeNull()
  })

  it("saves nothing when the key that comes back isn't the account's", async () => {
    const other = generateKeyPairSync('x25519').privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(16).toString('base64')
    serve(linkRoutes(approvedWith(other)))
    await expect(finish(login())).rejects.toThrow(/isn't this account's key/)
    expect(mockStored).toBeNull()
  })

  // A key the server wrapped itself to this computer carries no tag it could make: the secret came from the code
  it('saves nothing the showing device didn’t tag', async () => {
    serve(linkRoutes((publicKey) => ({ data: { id: LINK_ID, status: 'approved', encryptedKey: wrap(ACCOUNT_PRIVATE_KEY, publicKey) } })))
    await expect(finish(login())).rejects.toThrow(/didn't come from a device that showed the code/)
    expect(mockStored).toBeNull()
  })

  it('saves nothing tagged for another key', async () => {
    serve(linkRoutes((publicKey, tag) => ({ data: { id: LINK_ID, status: 'approved', encryptedKey: wrap(ACCOUNT_PRIVATE_KEY, publicKey), deliveryTag: tag('another key') } })))
    await expect(finish(login())).rejects.toThrow(/didn't come from a device that showed the code/)
    expect(mockStored).toBeNull()
  })
})

describe('logout', () => {
  it('removes the session', async () => {
    mockStored = JSON.stringify({ userId: USER_ID, email: 'jay@example.com', token: 'jwt', privateKey: ACCOUNT_PRIVATE_KEY })
    await logout()
    expect(mockStored).toBeNull()
    expect(stdout).toContain('Signed out jay@example.com')
  })
})
