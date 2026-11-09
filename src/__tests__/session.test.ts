import { ApiError, NotSignedInError } from '../errors'
import { openClient, request } from '../session'
import { ACCOUNT_PRIVATE_KEY } from './fixtures'

let mockStored: string | null = null
jest.mock('../credentials', () => ({
  readSecret: async () => mockStored,
  writeSecret: async (value: string) => {
    mockStored = value
  },
  deleteSecret: async () => {
    mockStored = null
  }
}))

const token = (ageSeconds: number) => {
  const iat = Math.floor(Date.now() / 1000) - ageSeconds
  return `x.${Buffer.from(JSON.stringify({ iat, exp: iat + 30 * 86400 })).toString('base64url')}.y`
}

const store = (jwt: string | null) => {
  mockStored = JSON.stringify({ userId: 'user-1', email: 'jay@example.com', token: jwt, privateKey: ACCOUNT_PRIVATE_KEY })
}

const reply = (status: number, body: unknown) => jest.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

beforeEach(() => {
  mockStored = null
})

describe('request', () => {
  it('sends the token and reads the answer', async () => {
    global.fetch = reply(200, { data: [1], metadata: {} })
    expect((await request<number[]>('/apps', { token: 'jwt' })).data).toEqual([1])
    expect(jest.mocked(global.fetch).mock.calls[0][1]).toEqual(expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer jwt' }) }))
  })

  it('reads a turned down token as signed out', async () => {
    global.fetch = reply(401, { message: 'Unauthorized' })
    await expect(request('/apps', { token: 'jwt' })).rejects.toBeInstanceOf(NotSignedInError)
  })

  it("passes the API's own message on", async () => {
    global.fetch = reply(403, { message: 'One or more appIds are not accessible' })
    await expect(request('/logs', { token: 'jwt' })).rejects.toEqual(new ApiError(403, 'One or more appIds are not accessible'))
  })

  it("says when Lumber can't be reached", async () => {
    global.fetch = jest.fn(async () => {
      throw new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND') })
    }) as typeof fetch
    await expect(request('/apps')).rejects.toThrow(/Couldn't reach Lumber .*ENOTFOUND/)
  })
})

describe('openClient', () => {
  it('needs a session', async () => {
    await expect(openClient()).rejects.toBeInstanceOf(NotSignedInError)
    store(null)
    await expect(openClient()).rejects.toBeInstanceOf(NotSignedInError)
  })

  it('uses a fresh token as it is', async () => {
    const jwt = token(60)
    store(jwt)
    global.fetch = reply(200, { data: [], metadata: {} })
    const client = await openClient()
    await client.get('/logs', { appIds: 'a,b', levels: undefined, limit: 5 })
    expect(String(jest.mocked(global.fetch).mock.calls[0][0])).toBe('https://api.lumber.infinitetoken.com/logs?appIds=a%2Cb&limit=5')
    expect(client.session.token).toBe(jwt)
  })

  it('trades a token over a day old for a fresh one and keeps it', async () => {
    store(token(2 * 86400))
    global.fetch = reply(201, { data: { token: 'fresh' } })
    expect((await openClient()).session.token).toBe('fresh')
    expect(JSON.parse(mockStored!).token).toBe('fresh')
  })

  it('takes the account accent along with a fresh token', async () => {
    store(token(2 * 86400))
    global.fetch = jest.fn(async (url: string | URL | Request) => (String(url).endsWith('/me') ? new Response(JSON.stringify({ data: { id: 'user-1', color: '#60A5FA' } })) : new Response(JSON.stringify({ data: { token: 'fresh' } }), { status: 201 }))) as typeof fetch
    expect((await openClient()).session.color).toBe('#60A5FA')
    expect(JSON.parse(mockStored!)).toEqual(expect.objectContaining({ token: 'fresh', color: '#60A5FA' }))
  })

  it('forgets a token the API turns down, keeping the key', async () => {
    store(token(2 * 86400))
    global.fetch = reply(401, { message: 'Unauthorized' })
    await expect(openClient()).rejects.toBeInstanceOf(NotSignedInError)
    expect(JSON.parse(mockStored!)).toEqual(expect.objectContaining({ token: null, privateKey: ACCOUNT_PRIVATE_KEY }))
  })

  it('carries on with the old token when the refresh fails otherwise', async () => {
    const old = token(2 * 86400)
    store(old)
    global.fetch = reply(503, { message: 'Down' })
    expect((await openClient()).session.token).toBe(old)
  })
})
