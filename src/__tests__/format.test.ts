import { THIS_COMPUTER } from '../constants'
import { formatLog, formatTime, getAccent, useAccent } from '../format'
import type { Log } from '../logs'

const log: Log = { id: 'a', app: 'Lumber-Test', appId: 'app-1', level: 'error', time: new Date(2026, 9, 29, 9, 5, 7).toISOString(), message: 'Payment failed\nretrying', requestId: 'req-42', metadata: { orderId: 'ord-7' } }

describe('formatLog', () => {
  it('writes a log as a terminal line, continuing a message under itself', () => {
    expect(formatLog(log)).toBe(`2026-10-29 09:05:07 ERROR Payment failed\n${' '.repeat(26)}retrying`)
  })

  it('names the app when several are listed, after a mark in its color', () => {
    expect(formatLog({ ...log, message: 'x' }, { showApp: true })).toBe('2026-10-29 09:05:07 ERROR [Lumber-Test] x')
    // A square, or # where the terminal can't draw one (a non-UTF-8 locale)
    expect(formatLog({ ...log, message: 'x' }, { showApp: true, appColor: '#8B5CF6' })).toMatch(/^2026-10-29 09:05:07 ERROR (■|#) Lumber-Test x$/)
  })

  it('adds the fields under it when verbose', () => {
    const lines = formatLog({ ...log, message: 'x' }, { verbose: true }).split('\n')
    expect(lines.map((line) => line.trim())).toEqual(['2026-10-29 09:05:07 ERROR x', 'id       a', 'request  req-42', 'metadata {', 'orderId: ord-7', '}'])
  })

  it('says when a log is locked', () => {
    expect(formatLog({ ...log, message: null, locked: true })).toContain(`encrypted: ${THIS_COMPUTER} has no key for this app`)
  })

  it('uses your accent when it is a color, and amber otherwise', () => {
    useAccent('#abc')
    expect(getAccent()).toBe('#AABBCC')
    useAccent('#60a5fa')
    expect(getAccent()).toBe('#60A5FA')
    useAccent('teal')
    expect(getAccent()).toBe('#FBBF24')
    useAccent(null)
    expect(getAccent()).toBe('#FBBF24')
  })

  it('writes local time zero-padded', () => {
    expect(formatTime(new Date(2026, 0, 2, 3, 4, 5).toISOString())).toBe('2026-01-02 03:04:05')
  })
})
