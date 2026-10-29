import { nameColor } from '@infinitetoken/lumber-kit'

import { type App, loadApps, pickApps } from '../apps'
import { UsageError } from '../errors'
import { APP_KEY, appRecord, fakeClient, page } from './fixtures'

const app = (id: string, name: string): App => ({ id, name, color: nameColor(name), retentionDays: null, logsCappedUntil: null, key: null })

describe('loadApps', () => {
  it('unwraps each app key with the account key and colors each app as its avatar does, sorted by name', async () => {
    const client = fakeClient({
      '/apps': () => page([appRecord({ id: 'b', name: 'Web', retentionDays: 7, color: '#123456' }), appRecord({ id: 'a', name: 'Billing', encryptedKey: null }), appRecord({ id: 'c', name: 'Api', encryptedKey: 'bm90IGEga2V5' })])
    })
    expect(await loadApps(client)).toEqual([
      { id: 'c', name: 'Api', color: nameColor('Api'), retentionDays: null, logsCappedUntil: null, key: null },
      { id: 'a', name: 'Billing', color: '#22C55E', retentionDays: null, logsCappedUntil: null, key: null },
      { id: 'b', name: 'Web', color: '#123456', retentionDays: 7, logsCappedUntil: null, key: APP_KEY }
    ])
  })
})

describe('pickApps', () => {
  const apps = [app('1', 'Lumber-Test'), app('2', 'Billing'), app('3', 'web'), app('4', 'Web')]

  it('takes every app when none are named', () => {
    expect(pickApps(apps, [])).toBe(apps)
  })

  it('finds apps by id, by name and by name in any case', () => {
    expect(pickApps(apps, ['2', 'lumber-test', 'Web']).map((a) => a.id)).toEqual(['2', '1', '4'])
  })

  it('names each app once', () => {
    expect(pickApps(apps, ['Billing', '2'])).toHaveLength(1)
  })

  it('says which names are ambiguous or missing', () => {
    expect(() => pickApps(apps, ['WEB'])).toThrow(/More than one app/)
    expect(() => pickApps(apps, ['Shop'])).toThrow(UsageError)
    expect(() => pickApps(apps, ['Shop'])).toThrow(/Lumber-Test, Billing/)
  })
})
