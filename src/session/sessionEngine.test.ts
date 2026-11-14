import { describe, expect, it } from 'vitest'
import { SessionEngine, type FocusInput, type SessionEvent } from './sessionEngine'

const cfg = { studyMin: 1, breakMin: 1 }
const FOCUSED: FocusInput = { raw: 'focused', verdict: 'focused' }
const GRACE: FocusInput = { raw: 'turned', verdict: 'focused' }
const AWAY: FocusInput = { raw: 'turned', verdict: 'distracted' }

/** from초 다음 tick부터 to초까지 0.2초 간격으로 진행하고 그동안 나온 이벤트를 모은다 */
function run(e: SessionEngine, from: number, to: number, input: FocusInput | null): SessionEvent[] {
  const events: SessionEvent[] = []
  for (let ms = from * 1000 + 200; ms <= to * 1000; ms += 200) events.push(...e.tick(ms, input, cfg))
  return events
}

describe('SessionEngine', () => {
  it('집중하는 동안 시간이 쌓인다', () => {
    const e = new SessionEngine()
    e.start(0)
    run(e, 0, 30, FOCUSED)
    const s = e.snapshot(30_000, cfg)
    expect(s.focusMs).toBe(30_000)
    expect(s.blockRemainingMs).toBe(30_000)
    expect(s.interruptions).toBe(0)
  })

  it('일시정지되면 집중 시간이 멈추고 중단 횟수·시간이 쌓인다', () => {
    const e = new SessionEngine()
    e.start(0)
    run(e, 0, 10, FOCUSED)
    expect(run(e, 10, 20, AWAY)).toEqual(['paused'])
    expect(run(e, 20, 25, FOCUSED)).toEqual(['resumed'])
    run(e, 25, 30, AWAY)
    const s = e.snapshot(30_000, cfg)
    expect(s.focusMs).toBe(15_000)
    expect(s.pausedMs).toBe(15_000)
    expect(s.interruptions).toBe(2)
    expect(s.paused).toBe(true)
  })

  it('유예 시간에 센 집중 시간은 일시정지가 확정되면 중단 시간으로 옮긴다', () => {
    const e = new SessionEngine()
    e.start(0)
    run(e, 0, 10, FOCUSED)
    run(e, 10, 17, GRACE)
    expect(e.snapshot(17_000, cfg).focusMs).toBe(17_000)
    run(e, 17, 20, AWAY)
    const s = e.snapshot(20_000, cfg)
    expect(s.focusMs).toBe(10_000)
    expect(s.pausedMs).toBe(10_000)
  })

  it('유예 중에 자세가 돌아오면 그 시간은 집중으로 남는다', () => {
    const e = new SessionEngine()
    e.start(0)
    run(e, 0, 10, FOCUSED)
    run(e, 10, 14, GRACE)
    run(e, 14, 20, FOCUSED)
    run(e, 20, 21, AWAY)
    expect(e.snapshot(21_000, cfg).focusMs).toBe(20_000)
  })

  it('학습 시간을 채우면 휴식, 휴식이 끝나고 자리에 앉으면 다시 학습', () => {
    const e = new SessionEngine()
    e.start(0)
    expect(run(e, 0, 60, FOCUSED)).toEqual(['breakStart'])
    let s = e.snapshot(60_000, cfg)
    expect(s.phase).toBe('break')
    expect(s.sets).toBe(1)
    expect(s.breakRemainingMs).toBe(60_000)

    // 휴식 중에는 판별 결과가 없어도 시간이 흐른다.
    expect(run(e, 60, 120, null)).toEqual(['breakEnd'])
    expect(e.snapshot(120_000, cfg).phase).toBe('breakOver')

    // 자리에 없으면 기다린다.
    expect(run(e, 120, 130, { raw: 'absent', verdict: 'distracted' })).toEqual([])
    expect(run(e, 130, 133, FOCUSED)).toEqual(['studyStart'])
    s = e.snapshot(133_000, cfg)
    expect(s.phase).toBe('study')
    expect(s.blockFocusMs).toBeLessThan(1000)
    expect(s.pausedMs).toBe(0)
  })

  it('화면이 꺼져 있던 시간은 집중으로 치지 않는다', () => {
    const e = new SessionEngine()
    e.start(0)
    run(e, 0, 5, FOCUSED)
    e.tick(35_000, FOCUSED, cfg)
    const s = e.snapshot(35_000, cfg)
    expect(s.focusMs).toBe(6_000)
    expect(s.pausedMs).toBe(29_000)
  })

  it('지금 휴식 / 휴식 건너뛰기', () => {
    const e = new SessionEngine()
    e.start(0)
    run(e, 0, 10, FOCUSED)
    expect(e.startBreak(10_000, cfg)).toEqual(['breakStart'])
    expect(e.snapshot(10_000, cfg).sets).toBe(0)
    expect(e.resumeStudy(20_000)).toEqual(['studyStart'])
    run(e, 20, 25, FOCUSED)
    expect(e.snapshot(25_000, cfg).focusMs).toBe(15_000)
  })

  it('끊기지 않은 최장 집중 시간과 시간대별 합계를 센다', () => {
    const e = new SessionEngine()
    e.start(0)
    run(e, 0, 10, FOCUSED)
    run(e, 10, 17, GRACE)
    run(e, 17, 20, AWAY)
    run(e, 20, 26, FOCUSED)
    const s = e.snapshot(26_000, cfg)
    // 처음 10초가 최장. 유예 7초는 중단으로 넘어갔으므로 포함하지 않는다.
    expect(s.longestFocusMs).toBe(10_000)
    const hours = Object.values(s.byHour)
    expect(hours.reduce((a, h) => a + h[0], 0)).toBe(s.focusMs)
    expect(hours.reduce((a, h) => a + h[1], 0)).toBe(s.pausedMs)
  })
})
