import { RAW_LABEL, type Live } from '../camera/useFocusCamera'
import type { JudgeSettings } from '../detector/focusJudge'
import type { SessionConfig, SessionSnapshot } from '../session/sessionEngine'
import { clock, duration, focusRate } from './format'

export type SessionStage = 'idle' | 'starting' | 'calibrating' | 'active'

interface Props {
  stage: SessionStage
  snap: SessionSnapshot
  /** 직전에 끝낸 세션. 없으면 null */
  summary: SessionSnapshot | null
  live: Live | null
  config: SessionConfig
  settings: JudgeSettings
  cameraError: string
  calibrationRetry: boolean
  onStart: () => void
  onEnd: () => void
  onBreakNow: () => void
  onResume: () => void
}

export function TimerPanel(p: Props) {
  if (p.stage !== 'active') {
    return (
      <section className="timer">
        {p.stage === 'idle' ? (
          <>
            <p className="plan">
              학습 {p.config.studyMin}분 · 휴식 {p.config.breakMin}분
            </p>
            <button className="primary big" onClick={p.onStart}>
              학습 시작
            </button>
            {p.cameraError && <p className="error">{p.cameraError}</p>}
            <p className="hint">
              폰을 거치대에 두고 시작하세요. 시작하면 3초 동안 공부 자세를 기록합니다.
              <br />
              영상은 기기 안에서만 분석되고 저장·전송되지 않습니다.
            </p>
          </>
        ) : (
          <>
            <p className="state">{p.stage === 'starting' ? '카메라 준비 중…' : '공부 자세를 3초간 유지하세요'}</p>
            {p.calibrationRetry && <p className="error">얼굴이 잘 보이지 않습니다. 폰 각도를 맞춰 주세요.</p>}
            <button onClick={p.onEnd}>취소</button>
          </>
        )}
        {p.stage === 'idle' && p.summary && (
          <div className="card summary">
            <h2>방금 끝낸 학습</h2>
            <Stats snap={p.summary} />
          </div>
        )}
      </section>
    )
  }

  const { snap, live } = p
  const j = live?.judgement

  let tone: 'focused' | 'warning' | 'distracted' | 'rest' = 'focused'
  let state = '집중 중'
  let time = clock(snap.blockRemainingMs)
  let caption = '남은 집중 시간'
  let progress = 1 - snap.blockRemainingMs / (p.config.studyMin * 60_000)

  if (snap.phase === 'break') {
    tone = 'rest'
    state = '휴식 중'
    time = clock(snap.breakRemainingMs)
    caption = '남은 휴식 시간'
    progress = 1 - snap.breakRemainingMs / (p.config.breakMin * 60_000)
  } else if (snap.phase === 'breakOver') {
    tone = 'warning'
    state = '휴식 끝'
    time = '00:00'
    caption = '자리에 앉으면 자동으로 시작합니다'
    progress = 1
  } else if (snap.paused) {
    tone = 'distracted'
    state = `일시정지 · ${RAW_LABEL[j?.reason ?? 'absent']}`
  } else if (j && j.raw !== 'focused') {
    tone = 'warning'
    state = `${RAW_LABEL[j.raw]} ${j.rawForSec.toFixed(0)}/${p.settings.graceSec}초`
  }

  return (
    <section className={`timer ${tone}`}>
      <p className="state">{state}</p>
      <p className="time">{time}</p>
      <p className="caption">{caption}</p>
      <div className="bar">
        <div style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }} />
      </div>

      <div className="card">
        <Stats snap={snap} />
      </div>

      <div className="actions">
        {snap.phase === 'study' && <button onClick={p.onBreakNow}>지금 휴식</button>}
        {snap.phase === 'break' && <button onClick={p.onResume}>휴식 건너뛰기</button>}
        {snap.phase === 'breakOver' && (
          <button className="primary" onClick={p.onResume}>
            바로 시작
          </button>
        )}
        <button onClick={p.onEnd}>학습 종료</button>
      </div>
    </section>
  )
}

function Stats({ snap }: { snap: SessionSnapshot }) {
  return (
    <dl className="metrics">
      <div>
        <dt>총 집중 시간</dt>
        <dd>{duration(snap.focusMs)}</dd>
      </div>
      <div>
        <dt>집중률</dt>
        <dd>{focusRate(snap.focusMs, snap.pausedMs)}</dd>
      </div>
      <div>
        <dt>중단 횟수</dt>
        <dd>{snap.interruptions}회</dd>
      </div>
      <div>
        <dt>중단 시간</dt>
        <dd>{duration(snap.pausedMs)}</dd>
      </div>
      <div>
        <dt>완료한 학습 구간</dt>
        <dd>{snap.sets}회</dd>
      </div>
    </dl>
  )
}
