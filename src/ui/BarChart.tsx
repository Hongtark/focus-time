import { useState } from 'react'

export interface Bar {
  /** 막대를 구분하는 값 */
  key: string
  /** 축 아래에 쓰는 짧은 이름. 빈 문자열이면 생략한다 */
  tick: string
  /** 분 단위 값 */
  minutes: number
  /** 막대를 골랐을 때 보여줄 설명 */
  detail: string
}

interface Props {
  bars: Bar[]
  /** 아무 막대도 고르지 않았을 때의 안내 */
  hint: string
  label: string
}

/** 눈금 간격 후보(분). 눈금이 4개를 넘지 않는 가장 작은 간격을 고른다. */
const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 180, 240, 360, 480]

function scale(maxMinutes: number): { top: number; ticks: number[] } {
  const step = STEPS.find((s) => maxMinutes / s <= 4) ?? 720
  const top = Math.max(step, Math.ceil(maxMinutes / step) * step)
  const ticks: number[] = []
  for (let v = step; v <= top; v += step) ticks.push(v)
  return { top, ticks }
}

function minutesLabel(m: number): string {
  // 눈금 자리가 좁아 "1시간 30분" 대신 "90분"으로 쓴다.
  return m >= 60 && m % 60 === 0 ? `${m / 60}시간` : `${m}분`
}

/** 한 가지 값만 보여주는 세로 막대 그래프. 막대를 누르거나 올리면 위쪽에 그 값이 나온다. */
export function BarChart({ bars, hint, label }: Props) {
  const [picked, setPicked] = useState<string | null>(null)
  const { top, ticks } = scale(Math.max(1, ...bars.map((b) => b.minutes)))
  const current = bars.find((b) => b.key === picked)

  return (
    <figure className="chart" aria-label={label}>
      <figcaption className={current ? 'readout on' : 'readout'}>{current ? current.detail : hint}</figcaption>
      <div className="plot" onPointerLeave={() => setPicked(null)}>
        {ticks.map((t) => (
          <div className="grid" key={t} style={{ bottom: `${(t / top) * 100}%` }}>
            <span>{minutesLabel(t)}</span>
          </div>
        ))}
        <div className="bars">
          {bars.map((b) => (
            // 막대보다 넓은 칸 전체가 누르는 영역이다.
            <button
              key={b.key}
              type="button"
              className={b.key === picked ? 'col picked' : 'col'}
              aria-label={b.detail}
              onPointerEnter={() => setPicked(b.key)}
              onFocus={() => setPicked(b.key)}
              onClick={() => setPicked(b.key)}
            >
              <i style={{ height: `${(b.minutes / top) * 100}%` }} />
            </button>
          ))}
        </div>
      </div>
      <div className="ticks" aria-hidden="true">
        {bars.map((b) => (
          <span key={b.key}>{b.tick}</span>
        ))}
      </div>
    </figure>
  )
}
