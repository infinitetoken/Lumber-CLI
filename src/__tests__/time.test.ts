import { UsageError } from '../errors'
import { tokenNeedsRefresh } from '../session'
import { parseTime } from '../time'

describe('parseTime', () => {
  const now = new Date(2026, 9, 29, 14, 30)

  it('reads ages back from now', () => {
    expect(parseTime('15m', now).getTime()).toBe(now.getTime() - 15 * 60_000)
    expect(parseTime('2h', now).getTime()).toBe(now.getTime() - 2 * 3_600_000)
    expect(parseTime('1.5d', now).getTime()).toBe(now.getTime() - 36 * 3_600_000)
  })

  it('reads days as local midnight', () => {
    expect(parseTime('today', now)).toEqual(new Date(2026, 9, 29))
    expect(parseTime('yesterday', now)).toEqual(new Date(2026, 9, 28))
    expect(parseTime('2026-10-01', now)).toEqual(new Date(2026, 9, 1))
  })

  it('reads ISO times', () => {
    expect(parseTime('2026-10-29T07:00:00.000Z', now).toISOString()).toBe('2026-10-29T07:00:00.000Z')
  })

  it('turns down what it can not read', () => {
    expect(() => parseTime('last tuesday', now)).toThrow(UsageError)
  })
})

describe('tokenNeedsRefresh', () => {
  const token = (claims: object) => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`
  const now = Date.UTC(2026, 9, 29)
  const seconds = now / 1000

  it('keeps a token under a day old', () => {
    expect(tokenNeedsRefresh(token({ iat: seconds - 3600, exp: seconds + 30 * 86400 }), now)).toBe(false)
  })

  it('trades in a token over a day old', () => {
    expect(tokenNeedsRefresh(token({ iat: seconds - 2 * 86400, exp: seconds + 28 * 86400 }), now)).toBe(true)
  })
})
