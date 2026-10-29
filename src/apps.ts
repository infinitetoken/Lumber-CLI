import { type AppRecord, resolveAppColor } from '@infinitetoken/lumber-kit'

import { unwrap } from './crypto'
import { UsageError } from './errors'
import type { Client } from './session'

// An app with its key unwrapped, or null where this Mac can't read it: the server holds no copy for this person yet
// (Lumber's key sharing hasn't reached them), or the copy is for an account key this Mac doesn't have
export type App = {
  id: string
  name: string
  // Its own color, or its name's, as its avatar shows it
  color: string
  retentionDays: number | null
  logsCappedUntil: string | null
  key: string | null
}

const keyOf = (record: AppRecord, privateKey: string): string | null => {
  if (!record.encryptedKey) return null
  try {
    return unwrap(record.encryptedKey, privateKey)
  } catch {
    return null
  }
}

// An account has a few apps, so one page holds them all
export const loadApps = async (client: Client): Promise<App[]> => {
  const { data } = await client.get<AppRecord[]>('/apps', { limit: 1000 })
  return data
    .map((record) => ({
      id: record.id,
      name: record.name,
      color: resolveAppColor(record.name, record.color),
      retentionDays: record.retentionDays ?? null,
      logsCappedUntil: record.logsCappedUntil ?? null,
      key: keyOf(record, client.session.privateKey)
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

// Apps by id or name, the name in any case unless two apps differ only by case. Naming none means every app.
export const pickApps = (apps: App[], wanted: string[]): App[] => {
  if (!wanted.length) return apps
  const picked = wanted.map((want) => {
    const byIdOrName = apps.find((app) => app.id === want) ?? apps.find((app) => app.name === want)
    if (byIdOrName) return byIdOrName
    const anyCase = apps.filter((app) => app.name.toLowerCase() === want.toLowerCase())
    if (anyCase.length === 1) return anyCase[0]
    if (anyCase.length > 1) throw new UsageError(`More than one app is named "${want}" in some case: ${anyCase.map((app) => app.name).join(', ')}`)
    throw new UsageError(apps.length ? `No app named "${want}". Your apps: ${apps.map((app) => app.name).join(', ')}` : `No app named "${want}", and this account reads no apps.`)
  })
  return [...new Map(picked.map((app) => [app.id, app])).values()]
}
