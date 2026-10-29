import { decryptWire, generateKeyPair, publicKeyOf, unwrap } from '../crypto'
import { ACCOUNT_PRIVATE_KEY, ACCOUNT_PUBLIC_KEY, APP_KEY, PLUGIN_ENCRYPTED, WRAPPED_APP_KEY } from './fixtures'

describe('crypto', () => {
  it('decrypts a log the Node plugin sent', () => {
    const payload = JSON.parse(decryptWire(PLUGIN_ENCRYPTED, APP_KEY)) as { message: string; requestId: string; metadata: Record<string, unknown> }
    expect(payload.message).toBe('Payment retry scheduled')
    expect(payload.requestId).toBe('req-42')
    expect(payload.metadata).toEqual(expect.objectContaining({ orderId: 'ord-7' }))
  })

  it('turns down a log with its ciphertext changed', () => {
    const raw = Buffer.from(PLUGIN_ENCRYPTED.payload, 'base64')
    raw[raw.length - 1] ^= 1
    expect(() => decryptWire({ ...PLUGIN_ENCRYPTED, payload: raw.toString('base64') }, APP_KEY)).toThrow()
  })

  it('unwraps an app key the apps wrapped', () => {
    expect(unwrap(WRAPPED_APP_KEY, ACCOUNT_PRIVATE_KEY)).toBe(APP_KEY)
  })

  it("can't unwrap with another key", () => {
    expect(() => unwrap(WRAPPED_APP_KEY, generateKeyPair().privateKey)).toThrow()
  })

  it('works out a public key as the apps do', () => {
    expect(publicKeyOf(ACCOUNT_PRIVATE_KEY)).toBe(ACCOUNT_PUBLIC_KEY)
  })

  it('makes raw 32-byte keypairs that belong together', () => {
    const { privateKey, publicKey } = generateKeyPair()
    expect(Buffer.from(privateKey, 'base64')).toHaveLength(32)
    expect(Buffer.from(publicKey, 'base64')).toHaveLength(32)
    expect(publicKeyOf(privateKey)).toBe(publicKey)
  })
})
