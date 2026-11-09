import { randomBytes } from 'node:crypto'

import { ristretto255, ristretto255_hasher } from '@noble/curves/ed25519.js'
import { hmac } from '@noble/hashes/hmac.js'
import { sha256, sha512 } from '@noble/hashes/sha2.js'

// The new device's half of linking by a 7-digit code, the apps' linkExchange.ts and keyCheck.ts (CPace over
// ristretto255): a device holding the account key shows a code for this computer's request; the code typed in here answers
// it with a tag covering this computer's one-off public key, which that device checks before wrapping the account key to it.
// The server carries both messages but never sees the code, so it can't swap the key, and it gets one guess per request.
// The account key comes back tagged with the secret the code gave both sides, so the server can't hand this computer a key
// of its own either.
// Node's crypto has no ristretto255 or hash to curve, hence noble here. linkCode.test.ts pins a run against the apps' code.

const Point = ristretto255.Point
const DST = 'lumber-device-link-v1'
const encode = (text: string): Uint8Array => new TextEncoder().encode(text)

// Six digits and a Damm check digit, so a mistyped digit or two swapped neighbors is caught here rather than spending
// the request (the apps' newCode)
const CODE_DIGITS = 6
const DAMM = [
  [0, 3, 1, 7, 5, 9, 8, 6, 4, 2],
  [7, 0, 9, 2, 1, 5, 4, 8, 6, 3],
  [4, 2, 0, 6, 8, 7, 1, 3, 5, 9],
  [1, 7, 5, 0, 9, 8, 3, 4, 2, 6],
  [6, 1, 2, 3, 0, 4, 5, 9, 7, 8],
  [3, 6, 7, 4, 2, 0, 9, 5, 8, 1],
  [5, 8, 6, 9, 7, 2, 0, 1, 3, 4],
  [8, 9, 4, 5, 3, 6, 2, 0, 1, 7],
  [9, 4, 3, 8, 6, 1, 7, 2, 0, 5],
  [2, 5, 8, 1, 4, 3, 6, 7, 9, 0]
]
const damm = (digits: string): number => [...digits].reduce((interim, d) => DAMM[interim][Number(d)], 0)

// The digits of whatever was typed (spaces, dashes and the like dropped), if they make a whole code with a good check
// digit
export const parseCode = (raw: string): string | null => {
  const digits = raw.replace(/\D/g, '')
  return digits.length === CODE_DIGITS + 1 && damm(digits) === 0 ? digits : null
}

// The request and account the code is for, both bound into it
export type LinkParties = { sid: string; linkId: string; userId: string }

const bound = ({ linkId, userId }: LinkParties) => `${linkId.toLowerCase()}|${userId.toLowerCase()}`

const scalarFromBytes = (bytes: Uint8Array): bigint => bytes.reduceRight((n, b) => (n << 8n) | BigInt(b), 0n)

// 64 random bytes reduced by the group order
const randomScalar = (): bigint => {
  let scalar = 0n
  while (scalar === 0n) scalar = Point.Fn.create(scalarFromBytes(randomBytes(64)))
  return scalar
}

const base64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64')

// This computer's answer to the code shown for its request: the exchange's second message, and a tag over both messages and
// this computer's one-off public key under the secret the code gives. The secret stays here, to check the account key that
// comes back (deliveryChecksOut); only `answer` goes to the server. `scalar` is for tests.
export const answerLinkCode = (parties: LinkParties, code: string, holderMessage: string, publicKey: string, scalar = randomScalar()): { answer: { claimantMessage: string; tag: string }; secret: string } => {
  const generator = ristretto255_hasher.hashToCurve(encode(`${code}|${parties.sid}|${bound(parties)}`), { DST })
  const claimantMessage = base64(generator.multiply(scalar).toBytes())
  const holderPoint = Point.fromBytes(Buffer.from(holderMessage, 'base64'))
  if (holderPoint.is0()) throw new Error('Invalid link request')
  const k = holderPoint.multiply(scalar)
  if (k.is0()) throw new Error('Invalid link request')
  const key = sha512(new Uint8Array([...encode(`${DST}|isk|${parties.sid}|`), ...k.toBytes(), ...Buffer.from(holderMessage, 'base64'), ...Buffer.from(claimantMessage, 'base64')])).slice(0, 32)
  const tag = base64(hmac(sha256, key, encode(`${DST}|answer|${parties.sid}|${bound(parties)}|${holderMessage}|${claimantMessage}|${publicKey}`)))
  return { answer: { claimantMessage, tag }, secret: base64(key) }
}

// Whether the account key that came back was tagged with this computer's secret, so by the device that showed the code and
// not by the server, which never has it
export const deliveryChecksOut = (parties: LinkParties, secret: string, holderMessage: string, claimantMessage: string, encryptedKey: string, tag: string): boolean => base64(hmac(sha256, Buffer.from(secret, 'base64'), encode(`${DST}|deliver|${parties.sid}|${bound(parties)}|${holderMessage}|${claimantMessage}|${encryptedKey}`))) === tag
