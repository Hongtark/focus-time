import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, FocusJudge, type FaceSample } from './focusJudge'
import { relativeAngles, rotFromAngles } from './pose'

// 폰이 아래에서 올려다보는 상황: 기준 자세 자체가 크게 기울어 있다.
const base = rotFromAngles(8, -35, 5)
/** 기준 자세에서 좌우 yaw도, 상하 pitch도 움직인 자세 */
const pose = (yaw: number, pitch: number) => {
  const r = rotFromAngles(yaw, pitch)
  const b = base
  const out = new Array<number>(9)
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) out[i * 3 + j] = b[i * 3] * r[j] + b[i * 3 + 1] * r[3 + j] + b[i * 3 + 2] * r[6 + j]
  return out
}
const cfg = { ...DEFAULT_SETTINGS, graceSec: 5, recoverSec: 1, eyesClosedSec: 3 }

function sample(tSec: number, over: Partial<FaceSample> = {}): FaceSample {
  return { t: tSec * 1000, present: true, rot: base, eyesClosed: 0, ...over }
}

/** from초부터 to초까지 0.2초 간격으로 넣고 마지막 판정을 돌려준다 */
function feed(j: FocusJudge, from: number, to: number, over: Partial<FaceSample> = {}) {
  let last = j.update(sample(from, over), base, cfg)
  for (let t = from + 0.2; t <= to + 1e-9; t += 0.2) last = j.update(sample(t, over), base, cfg)
  return last
}

describe('FocusJudge', () => {
  it('기준 자세면 집중', () => {
    const j = new FocusJudge()
    expect(feed(j, 0, 10).verdict).toBe('focused')
  })

  it('잠깐 고개를 돌리는 것은 유예 시간 안이면 집중 유지', () => {
    const j = new FocusJudge()
    feed(j, 0, 2)
    const r = feed(j, 2.2, 6, { rot: pose(50, 0) })
    expect(r.raw).toBe('turned')
    expect(r.verdict).toBe('focused')
    expect(feed(j, 6.2, 8).verdict).toBe('focused')
  })

  it('유예 시간을 넘기면 비집중, 돌아오면 recoverSec 뒤 집중', () => {
    const j = new FocusJudge()
    feed(j, 0, 2)
    const r = feed(j, 2.2, 8, { rot: pose(50, 0) })
    expect(r.verdict).toBe('distracted')
    expect(r.reason).toBe('turned')
    expect(j.update(sample(8.2), base, cfg).verdict).toBe('distracted')
    expect(feed(j, 8.4, 9.6).verdict).toBe('focused')
  })

  it('자리 비움', () => {
    const j = new FocusJudge()
    feed(j, 0, 1)
    const r = feed(j, 1.2, 7, { present: false })
    expect(r.verdict).toBe('distracted')
    expect(r.reason).toBe('absent')
  })

  it('고개 돌림에서 자리 비움으로 바뀌어도 유예 시간은 이어서 센다', () => {
    const j = new FocusJudge()
    feed(j, 0, 1)
    feed(j, 1.2, 4, { rot: pose(50, 0) })
    const r = feed(j, 4.2, 6.4, { present: false })
    expect(r.verdict).toBe('distracted')
  })

  it('눈 깜빡임은 무시, 오래 감으면 졸음', () => {
    const j = new FocusJudge()
    feed(j, 0, 1)
    expect(feed(j, 1.2, 1.6, { eyesClosed: 0.9 }).raw).toBe('focused')
    feed(j, 1.8, 3)
    const r = feed(j, 3.2, 6.4, { eyesClosed: 0.9 })
    expect(r.raw).toBe('eyesClosed')
    expect(r.verdict).toBe('distracted')
  })

  it('위로 드는 것과 아래로 숙이는 것의 한계가 다르다', () => {
    const j = new FocusJudge()
    // 아래로 30도: 허용(35)
    expect(j.update(sample(0, { rot: pose(0, 30) }), base, cfg).raw).toBe('focused')
    // 위로 30도: 한계(20) 초과
    expect(j.update(sample(0.2, { rot: pose(0, -30) }), base, cfg).raw).toBe('turned')
  })

  it('기울어진 기준 자세에서도 상대 각도가 정확하다', () => {
    const rel = relativeAngles(base, pose(25, -12))
    expect(rel.yaw).toBeCloseTo(25, 5)
    expect(rel.pitch).toBeCloseTo(-12, 5)
    const same = relativeAngles(base, base)
    expect(Math.abs(same.yaw) + Math.abs(same.pitch)).toBeLessThan(1e-6)
  })
})
