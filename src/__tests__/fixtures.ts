import type { ApiResponse, AppRecord, LogRecord } from '@infinitetoken/lumber-kit'

import type { Client, Params } from '../session'

// An account key and an app key wrapped to it by the apps' own code (Lumber's encryptForPublicKey, noble's X25519,
// HKDF and AES-GCM), with fixed randomness so it can be checked byte for byte
export const ACCOUNT_PRIVATE_KEY = 'CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk='
export const ACCOUNT_PUBLIC_KEY = 'V9tLNZ8jrl4Ubk4lEgVnBHIlBjSMFQwUdT0Mkz0E1CE='
export const WRAPPED_APP_KEY = 'UKYUCbHd0DJemxa3AOcZ6XcsBwALG9d4bpB8ZT0gSV0DAwMDAwMDAwMDAwPtsg8KCbtELRhNEwgvcCsciUGHQKg3cwvlpml51rhAXAkho5Wi+q5Og+7IpE/d2TQDiWzfVwyMS3FTwTw='
export const APP_KEY = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc='

// Captured from a real request made by @infinitetoken/lumber 2.2.9 with APP_KEY:
// client.warn('Payment retry scheduled', { requestId: 'req-42', orderId: 'ord-7' })
export const PLUGIN_ENCRYPTED = {
  nonce: 'ka7vccMyvAk/SAuD',
  payload: '8CWiRd9TnawinhEfKYCpfxog9ufH0IDGiKTOW6whCRbLdNReLDQ37H/cFfRpVtEYfFzBmhtQsIBsythfK4t//2XrEz6gcQJllnl0LHUm9HluDyl9RvMqdmqQbW9P49RdeKNcQ0KDyFWRqtQHnbK7V9zqMi3UBmFAphaURBJHLvBzqBwtXuvgf2e28birsuIR31rr1m8dQUoi4nXCn+aiXB64iatL7VGelyIFoVGbcw==',
  keyVersion: 1
}

export const appRecord = (overrides: Partial<AppRecord> = {}): AppRecord => ({
  id: 'app-1',
  name: 'Lumber-Test',
  createdAt: '2026-07-10T00:00:00.000Z',
  updatedAt: '2026-07-10T00:00:00.000Z',
  encryptedKey: WRAPPED_APP_KEY,
  retentionDays: null,
  logsCappedUntil: null,
  logsStoppedUntil: null,
  ...overrides
})

export const logRecord = (id: string, createdAt: string, overrides: Partial<LogRecord> = {}): LogRecord => ({
  id,
  appId: 'app-1',
  level: 2,
  createdAt,
  updatedAt: createdAt,
  encrypted: PLUGIN_ENCRYPTED,
  ...overrides
})

type Route = (params: Params) => ApiResponse<unknown>

// A client answering from a table of paths, recording each request's params
export const fakeClient = (routes: Record<string, Route>): Client & { calls: { path: string; params: Params }[] } => {
  const calls: { path: string; params: Params }[] = []
  return {
    calls,
    session: { userId: 'user-1', email: 'jay@example.com', token: 'token', privateKey: ACCOUNT_PRIVATE_KEY },
    get: async <T>(path: string, params: Params = {}) => {
      calls.push({ path, params })
      const route = routes[path]
      if (!route) throw new Error(`No fake route for ${path}`)
      return route(params) as ApiResponse<T>
    }
  }
}

export const page = <T>(data: T[], cursor: string | null = null): ApiResponse<T[]> => ({ data, metadata: { requestId: 'r', durationMs: 1, cursor, hasMore: !!cursor, count: data.length } })
