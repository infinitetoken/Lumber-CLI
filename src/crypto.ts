import { createDecipheriv, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, type KeyObject } from 'node:crypto'

// X25519 keys travel as their raw 32 bytes in base64, as the apps keep them. Node takes them wrapped in DER, so these
// are the fixed prefixes that wrap a raw key as PKCS#8 (private) and SPKI (public).
const PKCS8_X25519 = Buffer.from('302e020100300506032b656e04220420', 'hex')
const SPKI_X25519 = Buffer.from('302a300506032b656e032100', 'hex')

const privateKeyFrom = (base64: string): KeyObject => createPrivateKey({ key: Buffer.concat([PKCS8_X25519, Buffer.from(base64, 'base64')]), format: 'der', type: 'pkcs8' })
const publicKeyFrom = (raw: Buffer): KeyObject => createPublicKey({ key: Buffer.concat([SPKI_X25519, raw]), format: 'der', type: 'spki' })
const rawPublicKey = (key: KeyObject): string => key.export({ format: 'der', type: 'spki' }).subarray(SPKI_X25519.length).toString('base64')

export const generateKeyPair = (): { privateKey: string; publicKey: string } => {
  const { privateKey, publicKey } = generateKeyPairSync('x25519')
  return { privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(PKCS8_X25519.length).toString('base64'), publicKey: rawPublicKey(publicKey) }
}

export const publicKeyOf = (privateKey: string): string => rawPublicKey(createPublicKey(privateKeyFrom(privateKey)))

// AES-256-GCM, with the tag given apart from the ciphertext
const open = (key: Buffer, iv: Buffer, tag: Buffer, ciphertext: Buffer): string => {
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

// A log's or note's text under its app's key. The wire puts the tag before the ciphertext (Lumber-Kit's LogEncrypted).
export const decryptWire = ({ nonce, payload }: { nonce: string; payload: string }, appKey: string): string => {
  const raw = Buffer.from(payload, 'base64')
  return open(Buffer.from(appKey, 'base64'), Buffer.from(nonce, 'base64'), raw.subarray(0, 16), raw.subarray(16))
}

// Something wrapped to an X25519 key, as the apps wrap app keys and the account key: the sender's one-off public
// key[32] | IV[12] | tag[16] | ciphertext, under HKDF-SHA256 of the shared secret with the info 'lumber-v1'
export const unwrap = (wrapped: string, privateKey: string): string => {
  const raw = Buffer.from(wrapped, 'base64')
  const shared = diffieHellman({ privateKey: privateKeyFrom(privateKey), publicKey: publicKeyFrom(raw.subarray(0, 32)) })
  const key = Buffer.from(hkdfSync('sha256', shared, Buffer.alloc(0), 'lumber-v1', 32))
  return open(key, raw.subarray(32, 44), raw.subarray(44, 60), raw.subarray(60))
}
