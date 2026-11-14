// 학습 기록의 형식과 통계 계산. 저장 방식과 무관한 순수 계산이다.
import type { HourBuckets, SessionSnapshot } from '../session/sessionEngine'

/** 하루가 시작되는 시각. 새벽 4시 전의 공부는 전날로 묶는다. */
export const DAY_START_HOUR = 4

/** 학습 한 번(시작~종료)의 기록 */
export interface SessionRecord {
  /** 시작 시각(ms). 기록의 고유 번호로도 쓴다 */
  startedAt: number
  endedAt: number
  focusMs: number
  pausedMs: number
  interruptions: number
  /** 끝까지 채운 학습 구간 수 */
  sets: number
  /** 끊기지 않고 가장 오래 집중한 시간 */
  longestFocusMs: number
  /** 시각(0~23시)별 [집중 ms, 중단 ms] */
  byHour: HourBuckets
}

export function recordFromSnapshot(s: SessionSnapshot, endedAt: number): SessionRecord {
  return {
    startedAt: s.startedAt,
    endedAt,
    focusMs: Math.round(s.focusMs),
    pausedMs: Math.round(s.pausedMs),
    interruptions: s.interruptions,
    sets: s.sets,
    longestFocusMs: Math.round(s.longestFocusMs),
    byHour: s.byHour,
  }
}

/** 기록이 속하는 날짜(YYYY-MM-DD). 시작 시각 기준이며 새벽 공부는 전날이 된다. */
export function dayKey(ts: number): string {
  const d = new Date(ts - DAY_START_HOUR * 3_600_000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export interface Totals {
  focusMs: number
  pausedMs: number
  interruptions: number
  sessions: number
  longestFocusMs: number
  /** 집중 ÷ (집중 + 중단). 기록이 없으면 null */
  rate: number | null
}

export function totals(records: SessionRecord[]): Totals {
  const t = { focusMs: 0, pausedMs: 0, interruptions: 0, sessions: records.length, longestFocusMs: 0 }
  for (const r of records) {
    t.focusMs += r.focusMs
    t.pausedMs += r.pausedMs
    t.interruptions += r.interruptions
    t.longestFocusMs = Math.max(t.longestFocusMs, r.longestFocusMs)
  }
  const all = t.focusMs + t.pausedMs
  return { ...t, rate: all > 0 ? t.focusMs / all : null }
}

export interface DayStat extends Totals {
  key: string
  date: Date
}

/** 오늘을 마지막으로 하는 최근 days일의 일별 합계. 기록이 없는 날도 0으로 채운다. */
export function dailySeries(records: SessionRecord[], days: number, now: number): DayStat[] {
  const byDay = new Map<string, SessionRecord[]>()
  for (const r of records) {
    const k = dayKey(r.startedAt)
    const list = byDay.get(k)
    if (list) list.push(r)
    else byDay.set(k, [r])
  }
  const today = new Date(now - DAY_START_HOUR * 3_600_000)
  const out: DayStat[] = []
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
    // 정오로 잡아 dayKey의 4시간 보정에도 같은 날짜가 나오게 한다.
    const key = dayKey(date.getTime() + 12 * 3_600_000)
    out.push({ key, date, ...totals(byDay.get(key) ?? []) })
  }
  return out
}

export interface HourStat {
  hour: number
  focusMs: number
  pausedMs: number
}

/** 하루의 시작 시각부터 순서대로 24칸 */
export function hourlySeries(records: SessionRecord[]): HourStat[] {
  const out: HourStat[] = []
  for (let i = 0; i < 24; i++) out.push({ hour: (DAY_START_HOUR + i) % 24, focusMs: 0, pausedMs: 0 })
  for (const r of records) {
    for (const [h, [f, p]] of Object.entries(r.byHour ?? {})) {
      const slot = out[(Number(h) - DAY_START_HOUR + 24) % 24]
      slot.focusMs += f
      slot.pausedMs += p
    }
  }
  return out
}

/** 가져온 파일의 한 항목이 기록 형식에 맞는지 */
export function isRecord(v: unknown): v is SessionRecord {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return ['startedAt', 'endedAt', 'focusMs', 'pausedMs', 'interruptions'].every(
    (k) => typeof r[k] === 'number' && Number.isFinite(r[k]),
  )
}

/** 시작 시각이 같은 기록은 하나로 치고, 시작 시각 순으로 정렬한다 */
export function mergeRecords(a: SessionRecord[], b: SessionRecord[]): SessionRecord[] {
  const map = new Map<number, SessionRecord>()
  for (const r of [...a, ...b]) {
    // 가져온 파일에는 일부 항목이 없을 수 있어 기본값을 채운다.
    map.set(r.startedAt, {
      ...r,
      sets: r.sets ?? 0,
      longestFocusMs: r.longestFocusMs ?? 0,
      byHour: r.byHour ?? {},
    })
  }
  return [...map.values()].sort((x, y) => x.startedAt - y.startedAt)
}
