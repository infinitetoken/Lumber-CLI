import type { ApiResponse, UserRecord } from '@infinitetoken/lumber-kit'

import { API_URL } from './constants'
import { ApiError, NotSignedInError } from './errors'
import { deleteSecret, readSecret, writeSecret } from './keychain'

// The token is null once signed out by the API; the account key stays, so signing in again as the same person
// needs no new link. `color` is the account's accent, kept from /me at sign-in and each daily refresh.
export type Session = { userId: string; email: string; token: string | null; privateKey: string; color?: string | null }

export const loadSession = async (): Promise<Session | null> => {
  const raw = await readSecret()
  if (!raw) return null
  try {
    const session = JSON.parse(raw) as Session
    return typeof session.userId === 'string' && typeof session.privateKey === 'string' ? session : null
  } catch {
    return null
  }
}

export const saveSession = (session: Session): Promise<void> => writeSecret(JSON.stringify(session))
export const clearSession = (): Promise<void> => deleteSecret()

export type Params = Record<string, string | number | null | undefined>

const queryString = (params?: Params): string => {
  const entries = Object.entries(params ?? {}).filter((entry): entry is [string, string | number] => entry[1] != null && entry[1] !== '')
  return entries.length ? `?${new URLSearchParams(entries.map(([key, value]) => [key, String(value)])).toString()}` : ''
}

export const request = async <T>(path: string, { method = 'GET', body, token }: { method?: string; body?: unknown; token?: string | null } = {}): Promise<ApiResponse<T>> => {
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  } catch (err) {
    throw new ApiError(0, `Couldn't reach Lumber at ${API_URL} (${err instanceof Error ? (err.cause instanceof Error ? err.cause.message : err.message) : String(err)})`)
  }
  // Sign in's own 401 (a wrong password) carries no token
  if (res.status === 401 && token) throw new NotSignedInError('Your Lumber session ended. Run `lumber login` to sign in again.')
  const json = (await res.json().catch(() => null)) as (ApiResponse<T> & { message?: string }) | null
  if (!res.ok || !json) throw new ApiError(res.status, json?.message ?? `Lumber answered ${res.status}`)
  return json
}

// Tokens last 30 days from their last refresh, so trading one over a day old for a fresh one, as the apps do
// (useSessionKeeper), means a session only ends on a Mac where lumber goes unused for 30 days.
const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000

export const tokenNeedsRefresh = (token: string, now = Date.now()): boolean => {
  try {
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as { iat?: number }
    return !claims.iat || now - claims.iat * 1000 > REFRESH_AFTER_MS
  } catch {
    return false
  }
}

export type Client = {
  session: Session & { token: string }
  get: <T>(path: string, params?: Params) => Promise<ApiResponse<T>>
}

// The signed-in session, read from the Keychain each time, so an MCP server that outlives a `lumber login` uses the
// new one
export const openClient = async (): Promise<Client> => {
  const stored = await loadSession()
  if (!stored?.token) throw new NotSignedInError()
  const session = { ...stored, token: stored.token }
  if (tokenNeedsRefresh(session.token)) {
    try {
      const { data } = await request<{ token: string }>('/token/refresh', { method: 'POST', token: session.token })
      session.token = data.token
      // The accent rides along, so one picked in the app reaches the CLI within a day
      session.color = (await request<UserRecord>('/me', { token: session.token }).catch(() => null))?.data.color ?? session.color ?? null
      await saveSession(session)
    } catch (err) {
      if (err instanceof NotSignedInError) {
        await saveSession({ ...session, token: null })
        throw err
      }
      // Anything else (offline, a server error) leaves a token with weeks still on it to try again next time
    }
  }
  return { session, get: (path, params) => request(`${path}${queryString(params)}`, { token: session.token }) }
}
