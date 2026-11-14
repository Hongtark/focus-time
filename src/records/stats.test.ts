import { describe, expect, it } from 'vitest'
import { dailySeries, dayKey, hourlySeries, isRecord, mergeRecords, totals, type SessionRecord } from './stats'

const at = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min).getTime()

function rec(startedAt: number, over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    startedAt,
    endedAt: startedAt + 3_600_000,
    focusMs: 45 * 60_000,
    pausedMs: 15 * 60_000,
    interruptions: 3,
    sets: 1,
    longestFocusMs: 20 * 60_000,
    byHour: {},
    ...over,
  }
}

describe('dayKey', () => {
  it('새벽 4시 전의 공부는 전날로 묶는다', () => {
    expect(dayKey(at(2026, 11, 14, 23, 30))).toBe('2026-11-14')
    expect(dayKey(at(2026, 11, 15, 1, 30))).toBe('2026-11-14')
    expect(dayKey(at(2026, 11, 15, 3, 59))).toBe('2026-11-14')
    expect(dayKey(at(2026, 11, 15, 4, 0))).toBe('2026-11-15')
  })

  it('월이 바뀌는 새벽도 전날이다', () => {
    expect(dayKey(at(2026, 12, 1, 2, 0))).toBe('2026-11-30')
  })
})

describe('통계', () => {
  it('합계와 집중률', () => {
    const t = totals([rec(0), rec(1, { focusMs: 15 * 60_000, pausedMs: 5 * 60_000, longestFocusMs: 30 * 60_000 })])
    expect(t.focusMs).toBe(60 * 60_000)
    expect(t.interruptions).toBe(6)
    expect(t.rate).toBeCloseTo(0.75)
    expect(t.longestFocusMs).toBe(30 * 60_000)
    expect(totals([]).rate).toBeNull()
  })

  it('일별 합계: 기록 없는 날은 0, 새벽 기록은 전날에 들어간다', () => {
    const now = at(2026, 11, 15, 10)
    const days = dailySeries([rec(at(2026, 11, 14, 22)), rec(at(2026, 11, 15, 2)), rec(at(2026, 11, 15, 9))], 7, now)
    expect(days).toHaveLength(7)
    expect(days[6].key).toBe('2026-11-15')
    expect(days[6].sessions).toBe(1)
    expect(days[5].key).toBe('2026-11-14')
    expect(days[5].sessions).toBe(2)
    expect(days[0].key).toBe('2026-11-09')
    expect(days[0].focusMs).toBe(0)
  })

  it('새벽 2시에 보면 오늘은 아직 전날이다', () => {
    const days = dailySeries([], 7, at(2026, 11, 15, 2))
    expect(days[6].key).toBe('2026-11-14')
  })

  it('시간대별 합계는 4시부터 시작한다', () => {
    const hours = hourlySeries([rec(0, { byHour: { 4: [1000, 0], 3: [500, 200] } }), rec(1, { byHour: { 4: [2000, 100] } })])
    expect(hours[0]).toEqual({ hour: 4, focusMs: 3000, pausedMs: 100 })
    expect(hours[23]).toEqual({ hour: 3, focusMs: 500, pausedMs: 200 })
  })
})

describe('가져오기', () => {
  it('형식 검사', () => {
    expect(isRecord(rec(0))).toBe(true)
    expect(isRecord({ startedAt: 1 })).toBe(false)
    expect(isRecord('x')).toBe(false)
  })

  it('같은 기록은 한 번만, 시작 시각 순으로', () => {
    const merged = mergeRecords([rec(200), rec(100)], [rec(200), rec(300)])
    expect(merged.map((r) => r.startedAt)).toEqual([100, 200, 300])
  })
})
