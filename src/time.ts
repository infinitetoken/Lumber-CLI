import { UsageError } from './errors'

const UNITS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }

// A time from the command line or an agent: an age (`30s`, `15m`, `2h`, `3d`, `1w`), `today` or `yesterday` (local
// midnight), a local day (`2026-10-29`), or any date and time JavaScript reads (`2026-10-29T14:00`, an ISO time)
export const parseTime = (value: string, now = new Date()): Date => {
  const trimmed = value.trim().toLowerCase()
  const age = trimmed.match(/^(\d+(?:\.\d+)?)\s*([smhdw])$/)
  if (age) return new Date(now.getTime() - Number(age[1]) * UNITS[age[2]])
  if (trimmed === 'today' || trimmed === 'yesterday') {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    if (trimmed === 'yesterday') day.setDate(day.getDate() - 1)
    return day
  }
  const day = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (day) return new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]))
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new UsageError(`Can't read "${value}" as a time. Use an age like 15m, 2h or 3d, a day like 2026-10-29, or an ISO time.`)
  return parsed
}
