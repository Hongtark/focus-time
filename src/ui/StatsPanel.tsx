import { useMemo, useRef, useState } from 'react'
import {
  DAY_START_HOUR,
  dailySeries,
  dayKey,
  hourlySeries,
  totals,
  type SessionRecord,
  type Totals,
} from '../records/stats'
import { deleteAllRecords, exportRecords, importRecords } from '../records/store'
import { BarChart, type Bar } from './BarChart'
import { duration } from './format'

interface Props {
  records: SessionRecord[]
  /** 진행 중인 학습. 통계에는 포함하되 목록에는 '진행 중'으로 표시한다 */
  active: SessionRecord | null
  onRecords: (r: SessionRecord[]) => void
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']
const RECENT_LIMIT = 10

const pct = (rate: number | null) => (rate === null ? '-' : `${Math.round(rate * 100)}%`)
const md = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`
const hm = (ts: number) => new Date(ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })

export function StatsPanel({ records, active, onRecords }: Props) {
  const [days, setDays] = useState<7 | 30>(7)
  const [message, setMessage] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const now = Date.now()

  const all = useMemo(() => (active ? [...records, active] : records), [records, active])
  const series = useMemo(() => dailySeries(all, days, now), [all, days, now])
  const firstKey = series[0].key
  const inPeriod = useMemo(() => all.filter((r) => dayKey(r.startedAt) >= firstKey), [all, firstKey])
  const period = totals(inPeriod)
  const today = series[series.length - 1]
  const studiedDays = series.filter((d) => d.focusMs > 0).length

  const dayBars: Bar[] = series.map((d, i) => ({
    key: d.key,
    // 7일은 요일을 모두, 30일은 5일 간격으로만 표시한다.
    tick: days === 7 ? WEEKDAYS[d.date.getDay()] : (series.length - 1 - i) % 5 === 0 ? md(d.date) : '',
    minutes: d.focusMs / 60_000,
    detail: `${md(d.date)} (${WEEKDAYS[d.date.getDay()]}) · 집중 ${duration(d.focusMs)} · 집중률 ${pct(d.rate)} · 중단 ${d.interruptions}회`,
  }))

  const hourBars: Bar[] = hourlySeries(inPeriod).map((h) => {
    const total = h.focusMs + h.pausedMs
    return {
      key: String(h.hour),
      tick: h.hour % 3 === 1 ? `${h.hour}시` : '',
      minutes: h.focusMs / 60_000,
      detail: `${h.hour}시대 · 집중 ${duration(h.focusMs)} · 집중률 ${pct(total > 0 ? h.focusMs / total : null)}`,
    }
  })

  const recent = [...all].reverse().slice(0, RECENT_LIMIT)

  const onImport = async (file: File | undefined) => {
    if (!file) return
    try {
      const { records: merged, added } = importRecords(await file.text())
      onRecords(merged)
      setMessage(`기록 ${added}건을 가져왔습니다.`)
    } catch (e) {
      setMessage(`가져오지 못했습니다: ${e instanceof Error ? e.message : String(e)}`)
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  const onDeleteAll = () => {
    if (!window.confirm(`기록 ${records.length}건을 모두 지웁니다. 되돌릴 수 없습니다. 계속할까요?`)) return
    deleteAllRecords()
    onRecords([])
    setMessage('기록을 모두 지웠습니다.')
  }

  return (
    <>
      <section className="card">
        <h2>오늘</h2>
        <TotalsGrid t={today} />
        <p className="hint">하루는 새벽 {DAY_START_HOUR}시에 바뀝니다. 그 전의 공부는 전날로 셉니다.</p>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>최근 {days}일</h2>
          <div className="seg" role="group" aria-label="기간">
            <button className={days === 7 ? 'on' : ''} onClick={() => setDays(7)}>
              7일
            </button>
            <button className={days === 30 ? 'on' : ''} onClick={() => setDays(30)}>
              30일
            </button>
          </div>
        </div>
        <TotalsGrid t={period} />
        <dl className="metrics extra">
          <div>
            <dt>공부한 날</dt>
            <dd>
              {studiedDays}일 / {days}일
            </dd>
          </div>
          <div>
            <dt>공부한 날 평균</dt>
            <dd>{studiedDays > 0 ? duration(period.focusMs / studiedDays) : '-'}</dd>
          </div>
        </dl>

        <h3>일별 집중 시간</h3>
        <BarChart bars={dayBars} label="일별 집중 시간" hint="막대를 누르면 그날의 기록이 나옵니다." />
        <details>
          <summary>표로 보기</summary>
          <table>
            <thead>
              <tr>
                <th>날짜</th>
                <th>집중</th>
                <th>집중률</th>
                <th>중단</th>
              </tr>
            </thead>
            <tbody>
              {[...series].reverse().map((d) => (
                <tr key={d.key}>
                  <td>
                    {md(d.date)} ({WEEKDAYS[d.date.getDay()]})
                  </td>
                  <td>{d.focusMs > 0 ? duration(d.focusMs) : '-'}</td>
                  <td>{pct(d.rate)}</td>
                  <td>{d.sessions > 0 ? `${d.interruptions}회` : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>

        <h3>시간대별 집중 시간</h3>
        <BarChart bars={hourBars} label="시간대별 집중 시간" hint="막대를 누르면 그 시간대의 기록이 나옵니다." />
      </section>

      <section className="card">
        <h2>최근 학습</h2>
        {recent.length === 0 ? (
          <p className="hint">아직 기록이 없습니다. 학습을 끝내면 여기에 쌓입니다.</p>
        ) : (
          <ul className="sessions">
            {recent.map((r) => {
              const total = r.focusMs + r.pausedMs
              return (
                <li key={r.startedAt}>
                  <div>
                    <b>
                      {md(new Date(r.startedAt))} {hm(r.startedAt)}
                    </b>
                    {r === active && <span className="live">진행 중</span>}
                  </div>
                  <span>
                    집중 {duration(r.focusMs)} · {pct(total > 0 ? r.focusMs / total : null)} · 중단 {r.interruptions}회
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>기록 관리</h2>
        <p className="hint">
          기록은 이 기기의 브라우저 안에만 있습니다. 폰을 바꾸거나 브라우저 데이터를 지우기 전에 파일로 내보내 두세요.
        </p>
        <div className="actions">
          <button onClick={() => exportRecords(records)} disabled={records.length === 0}>
            파일로 내보내기
          </button>
          <button onClick={() => fileRef.current?.click()}>파일에서 가져오기</button>
          <button className="danger" onClick={onDeleteAll} disabled={records.length === 0}>
            모두 지우기
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => void onImport(e.target.files?.[0])}
        />
        {message && <p className="notice">{message}</p>}
      </section>
    </>
  )
}

function TotalsGrid({ t }: { t: Totals }) {
  return (
    <dl className="metrics">
      <div>
        <dt>집중 시간</dt>
        <dd>{duration(t.focusMs)}</dd>
      </div>
      <div>
        <dt>집중률</dt>
        <dd>{pct(t.rate)}</dd>
      </div>
      <div>
        <dt>중단</dt>
        <dd>
          {t.interruptions}회 · {duration(t.pausedMs)}
        </dd>
      </div>
      <div>
        <dt>최장 연속 집중</dt>
        <dd>{t.longestFocusMs > 0 ? duration(t.longestFocusMs) : '-'}</dd>
      </div>
    </dl>
  )
}
