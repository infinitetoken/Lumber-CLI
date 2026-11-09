import { hostname } from 'node:os'

import type { DeviceLinkCreateBody, DeviceLinkCreatedRecord, DeviceLinkRecord, UserRecord } from '@infinitetoken/lumber-kit'
import { Color, input } from 'termkit'

import { THIS_COMPUTER } from './constants'
import { storeName } from './credentials'
import { generateKeyPair, publicKeyOf, unwrap } from './crypto'
import { ApiError, UsageError } from './errors'
import { capitalize, lumberSpinner, say as log, useAccent } from './format'
import { answerLinkCode, deliveryChecksOut, type LinkParties, parseCode } from './linkCode'
import { clearSession, loadSession, request, saveSession } from './session'

const say = (text = '') => process.stdout.write(`${text}\n`)
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const POLL_MS = 3000

const EXPIRED = 'The link request expired. Run `lumber login` again for a new one.'

const sameKey = (privateKey: string, publicKey: string): boolean => {
  try {
    return publicKeyOf(privateKey) === publicKey
  } catch {
    return false
  }
}

const countdown = (ms: number) => {
  const left = Math.max(0, Math.round(ms / 1000))
  return Color.faint(`expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`)
}

// What this computer's answer kept, to check the key that comes back
type Answered = { parties: LinkParties; holderMessage: string; claimantMessage: string; secret: string }

// Sends the code typed in, asking again for a typo (the check digit catches one) or before any device shows a code for
// this request. Returns once the answer is with the server: from there a wrong code ends the request, one guess each.
const answer = async (token: string, me: UserRecord, linkId: string, publicKey: string, expiresAt: number): Promise<Answered> => {
  for (;;) {
    const typed = await input('Code', { required: true, inline: true })
    if (typeof typed !== 'string') throw new UsageError('Cancelled.')
    if (Date.now() >= expiresAt) throw new UsageError(EXPIRED)
    const code = parseCode(typed)
    if (!code) {
      log.warn("That isn't the whole code. Check each digit and type it again.")
      continue
    }
    const { data: link } = await request<DeviceLinkRecord>(`/device-links/${linkId}`, { token }).catch((err: unknown) => {
      if (err instanceof ApiError && err.status === 404) throw new UsageError(EXPIRED)
      throw err
    })
    if (link.status !== 'pending') throw new UsageError('This link request is over. Run `lumber login` again for a new one.')
    if (!link.sid || !link.holderMessage) {
      log.warn(`No device is showing a code for this request yet. Tap ${Color.bold('Show Code')} in Lumber on a device that has your account key, then type the code it shows.`)
      continue
    }
    const parties = { sid: link.sid, linkId, userId: me.id }
    const { answer: body, secret } = answerLinkCode(parties, code, link.holderMessage, publicKey)
    try {
      // The answer alone: the secret never leaves this computer
      await request(`/device-links/${linkId}/answer`, { method: 'POST', token, body })
      return { parties, holderMessage: link.holderMessage, claimantMessage: body.claimantMessage, secret }
    } catch (err) {
      // Answered already, and not from here: nothing that comes back could be checked
      if (err instanceof ApiError && err.status === 409) throw new UsageError('This link request was already answered. Run `lumber login` again for a new one.')
      if (err instanceof ApiError && (err.status === 410 || err.status === 404)) throw new UsageError(EXPIRED)
      throw err
    }
  }
}

// Links this computer as a device, as Link This Device does on a phone: the request carries the public half of a one-off
// keypair; a device that has the account key shows a 7-digit code for it, typed in here; that device checks the answer,
// whose tag covers this computer's key, and only then wraps the account key to it, with a tag from the code's secret this
// computer checks. The server carries the exchange but never sees the code, so it can't choose the key the account key goes
// to, nor hand this computer a key of its own.
const link = async (token: string, me: UserRecord): Promise<string> => {
  const pair = generateKeyPair()
  const deviceName = `Lumber CLI on ${hostname().replace(/\.local$/, '')}`
  const body: DeviceLinkCreateBody = { deviceName, platform: 'cli', publicKey: pair.publicKey }
  const { data: created } = await request<DeviceLinkCreatedRecord>('/device-links', { method: 'POST', token, body })
  const expiresAt = new Date(created.expiresAt).getTime()

  say()
  say(`To read your logs, ${THIS_COMPUTER} needs your account key from a device that has it.`)
  say(`Open Lumber on your phone or Mac. It asks to link ${Color.bold(deviceName)}: tap ${Color.bold('Show Code')} there`)
  say(`(or open ${Color.bold('Account > Link another device')}), and type the code it shows. The request lasts 10 minutes.`)
  say()

  const answered = await answer(token, me, created.id, pair.publicKey, expiresAt)

  const spinner = lumberSpinner('Checking the code on your other device', { suffix: countdown(expiresAt - Date.now()) })
  spinner.start()
  try {
    for (let tick = 1; ; tick++) {
      if (tick > 1) await sleep(1000)
      spinner.suffix(countdown(expiresAt - Date.now()))
      if (Date.now() >= expiresAt) throw new UsageError(EXPIRED)
      if (tick % (POLL_MS / 1000) !== 1) continue
      let status: DeviceLinkRecord
      try {
        status = (await request<DeviceLinkRecord>(`/device-links/${created.id}`, { token })).data
      } catch (err) {
        // A dropped connection doesn't end the wait; the next poll tries again
        if (err instanceof ApiError && err.status === 0) continue
        if (err instanceof ApiError && err.status === 404) throw new UsageError(EXPIRED)
        throw err
      }
      if (status.status === 'failed') throw new UsageError("The code didn't match, which ends the request. Run `lumber login` again, and type the code shown for the new one.")
      if (status.status === 'denied') throw new UsageError('The link was turned down. Run `lumber login` again to try again.')
      if (status.status === 'approved' && status.encryptedKey) {
        // Only a key the device that showed the code sent: the server never has the secret its tag is made from
        const { parties, holderMessage, claimantMessage, secret } = answered
        if (!status.deliveryTag || !deliveryChecksOut(parties, secret, holderMessage, claimantMessage, status.encryptedKey, status.deliveryTag)) {
          throw new Error("The key that came back didn't come from a device that showed the code, so nothing was saved.")
        }
        const accountKey = unwrap(status.encryptedKey, pair.privateKey)
        if (!me.publicKey || !sameKey(accountKey, me.publicKey)) throw new Error("The key that came back isn't this account's key, so nothing was saved.")
        spinner.stop()
        return accountKey
      }
    }
  } catch (err) {
    spinner.stop()
    throw err
  }
}

export const login = async (): Promise<void> => {
  const stored = await loadSession()
  const email = await input('Email', { default: stored?.email, required: true, inline: true })
  if (typeof email !== 'string') throw new UsageError('Cancelled.')
  const password = await input('Password', { mask: true, required: true, inline: true })
  if (typeof password !== 'string') throw new UsageError('Cancelled.')

  const spinner = lumberSpinner('Signing in')
  spinner.start()
  let token: string
  let me: UserRecord
  try {
    token = (await request<{ token: string }>('/token', { method: 'POST', body: { email, password } })).data.token
    me = (await request<UserRecord>('/me', { token })).data
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) throw new UsageError('Incorrect email or password.')
    throw err
  } finally {
    spinner.stop()
  }
  if (!me.publicKey) throw new UsageError('This account has no account key yet. Open Lumber on your phone or Mac first: it sets one up.')

  // The same person signing in again keeps the key this computer was linked with, unless the account's key was replaced
  if (stored?.userId === me.id && sameKey(stored.privateKey, me.publicKey)) {
    await saveSession({ userId: me.id, email: me.email, token, privateKey: stored.privateKey, color: me.color ?? null })
    useAccent(me.color)
    log.succeed(`Signed in as ${me.email}`)
    return
  }

  const privateKey = await link(token, me)
  await saveSession({ userId: me.id, email: me.email, token, privateKey, color: me.color ?? null })
  useAccent(me.color)
  log.succeed(`Linked. ${capitalize(THIS_COMPUTER)} can read ${me.email}'s logs: try ${Color.bold('lumber apps')}`)
}

export const logout = async (): Promise<void> => {
  const stored = await loadSession()
  await clearSession()
  if (stored) log.succeed(`Signed out ${stored.email} and removed ${THIS_COMPUTER}'s account key from ${storeName()}. Signing in again needs a new link.`)
  else log.info('Not signed in.')
}
