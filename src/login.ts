import { hostname } from 'node:os'

import type { DeviceLinkCreatedRecord, DeviceLinkRecord, UserRecord } from '@infinitetoken/lumber-kit'
import QRCode from 'qrcode'
import { Color, input } from 'termkit'

import { approveLinkUrl } from './constants'
import { generateKeyPair, publicKeyOf, unwrap } from './crypto'
import { ApiError, UsageError } from './errors'
import { lumberSpinner, say as log, useAccent } from './format'
import { clearSession, loadSession, request, saveSession } from './session'

const say = (text = '') => process.stdout.write(`${text}\n`)
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const POLL_MS = 3000

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

// Links this Mac as a device, as Link This Device does on a phone: the request carries the public half of a one-off
// keypair, a device that has the account key wraps it to that key (Approve, from the code), and only this Mac can
// unwrap it. The code is read off this screen, so the server never chooses the key the account key goes to.
const link = async (token: string, me: UserRecord): Promise<string> => {
  const pair = generateKeyPair()
  const deviceName = `Lumber CLI on ${hostname().replace(/\.local$/, '')}`
  const { data: created } = await request<DeviceLinkCreatedRecord>('/device-links', { method: 'POST', token, body: { deviceName, platform: 'web', publicKey: pair.publicKey } })
  const code = `${created.id}|${pair.publicKey}`

  say()
  say('To read your logs, this Mac needs your account key from a device that has it.')
  say(`On your iPhone, scan this with the camera, open it in Lumber and tap ${Color.bold('Approve')}:`)
  say()
  say((await QRCode.toString(approveLinkUrl(code), { type: 'terminal', small: true })).trimEnd())
  say()
  say(`Or in Lumber on another device, open ${Color.bold('Account > Link another device')} and paste this code:`)
  say()
  say(`  ${code}`)
  say()

  const expiresAt = new Date(created.expiresAt).getTime()
  const spinner = lumberSpinner('Waiting for approval', { suffix: countdown(expiresAt - Date.now()) })
  spinner.start()
  try {
    for (let tick = 1; ; tick++) {
      await sleep(1000)
      spinner.suffix(countdown(expiresAt - Date.now()))
      if (Date.now() >= expiresAt) throw new UsageError('The link code expired. Run `lumber login` again for a new one.')
      if (tick % (POLL_MS / 1000)) continue
      let status: DeviceLinkRecord
      try {
        status = (await request<DeviceLinkRecord>(`/device-links/${created.id}`, { token })).data
      } catch (err) {
        // A dropped connection doesn't end the wait; the next poll tries again
        if (err instanceof ApiError && err.status === 0) continue
        throw err
      }
      if (status.status === 'denied') throw new UsageError('The link was turned down. Run `lumber login` again to try again.')
      if (status.status === 'approved' && status.encryptedKey) {
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

  // The same person signing in again keeps the key this Mac was linked with, unless the account's key was replaced
  if (stored?.userId === me.id && sameKey(stored.privateKey, me.publicKey)) {
    await saveSession({ userId: me.id, email: me.email, token, privateKey: stored.privateKey, color: me.color ?? null })
    useAccent(me.color)
    log.succeed(`Signed in as ${me.email}`)
    return
  }

  const privateKey = await link(token, me)
  await saveSession({ userId: me.id, email: me.email, token, privateKey, color: me.color ?? null })
  useAccent(me.color)
  log.succeed(`Linked. This Mac can read ${me.email}'s logs: try ${Color.bold('lumber apps')}`)
}

export const logout = async (): Promise<void> => {
  const stored = await loadSession()
  await clearSession()
  if (stored) log.succeed(`Signed out ${stored.email} and removed this Mac's account key from the Keychain. Signing in again needs a new link.`)
  else log.info('Not signed in.')
}
