import { RAW_LABEL, type FocusCamera } from '../camera/useFocusCamera'
import { DEFAULT_SETTINGS, type JudgeSettings } from '../detector/focusJudge'
import { anglesFromRot } from '../detector/pose'
import { DEFAULT_SESSION, type SessionConfig } from '../session/sessionEngine'

interface Props {
  cam: FocusCamera
  sessionActive: boolean
  config: SessionConfig
  onConfig: (c: SessionConfig) => void
  settings: JudgeSettings
  onSettings: (s: JudgeSettings) => void
}

const SLIDERS: { key: keyof JudgeSettings; label: string; min: number; max: number; step: number; unit: string }[] = [
  { key: 'graceSec', label: '일시정지까지 유예', min: 1, max: 30, step: 1, unit: '초' },
  { key: 'yawLimit', label: '좌우 허용 각도', min: 10, max: 60, step: 1, unit: '°' },
  { key: 'pitchUpLimit', label: '위로 허용 각도', min: 5, max: 50, step: 1, unit: '°' },
  { key: 'pitchDownLimit', label: '아래로 허용 각도', min: 10, max: 70, step: 1, unit: '°' },
  { key: 'eyesClosedSec', label: '졸음 판정 시간', min: 1, max: 15, step: 1, unit: '초' },
  { key: 'blinkThreshold', label: '눈 감김 기준', min: 0.3, max: 0.9, step: 0.05, unit: '' },
]

export function SettingsPanel({ cam, sessionActive, config, onConfig, settings, onSettings }: Props) {
  const { live, info } = cam
  const j = live?.judgement
  const abs = live?.sample.present ? anglesFromRot(live.sample.rot) : null
  const running = cam.phase === 'running'

  return (
    <>
      <section className="card">
        <h2>시간</h2>
        <Stepper
          label="학습 시간"
          value={config.studyMin}
          min={5}
          max={120}
          onChange={(v) => onConfig({ ...config, studyMin: v })}
        />
        <Stepper
          label="휴식 시간"
          value={config.breakMin}
          min={1}
          max={60}
          onChange={(v) => onConfig({ ...config, breakMin: v })}
        />
        <button onClick={() => onConfig(DEFAULT_SESSION)}>기본값으로 (45분 / 15분)</button>
        {sessionActive && <p className="hint">진행 중인 학습에도 바로 적용됩니다.</p>}
      </section>

      <section className="card">
        <h2>기준 자세</h2>
        <p className="hint">학습을 시작할 때마다 자동으로 다시 잡습니다. 도중에 자세나 폰 위치를 바꿨다면 눌러 주세요.</p>
        <div className="actions">
          {running ? (
            <>
              <button className="primary" onClick={() => void cam.calibrate()} disabled={cam.calibrating}>
                기준 자세 다시 잡기
              </button>
              {!sessionActive && <button onClick={cam.stop}>카메라 끄기</button>}
            </>
          ) : (
            <button className="primary" onClick={() => void cam.start()} disabled={cam.phase === 'loading'}>
              카메라 켜고 시험하기
            </button>
          )}
        </div>
        {cam.error && <p className="error">{cam.error}</p>}
      </section>

      <section className="card">
        <h2>판별 기준</h2>
        {SLIDERS.map((s) => (
          <label className="slider" key={s.key}>
            <span>
              {s.label}
              <b>
                {settings[s.key]}
                {s.unit}
              </b>
            </span>
            <input
              type="range"
              min={s.min}
              max={s.max}
              step={s.step}
              value={settings[s.key]}
              onChange={(e) => onSettings({ ...settings, [s.key]: Number(e.target.value) })}
            />
          </label>
        ))}
        <button onClick={() => onSettings(DEFAULT_SETTINGS)}>기본값으로</button>
      </section>

      {running && (
        <section className="card">
          <h2>측정값</h2>
          {cam.tickError && <p className="notice error-box">{cam.tickError}</p>}
          <dl className="metrics">
            <Metric label="현재 자세" value={j ? RAW_LABEL[j.raw] : '-'} />
            <Metric label="좌우 차이" value={fmtDeg(j?.dYaw)} limit={`±${settings.yawLimit}°`} />
            <Metric
              label="상하 차이 (+숙임)"
              value={fmtDeg(j?.dPitch)}
              limit={`-${settings.pitchUpLimit}° ~ +${settings.pitchDownLimit}°`}
            />
            <Metric
              label="눈 감김"
              value={live?.sample.present ? live.sample.eyesClosed.toFixed(2) : '-'}
              limit={`${settings.blinkThreshold.toFixed(2)} 이상`}
            />
            <Metric label="판별 속도" value={live ? `${live.fps.toFixed(1)}회/초` : '-'} />
            <Metric label="연산 / 화면 유지" value={`${info.delegate} / ${info.wakeLock ? '켜짐' : '미지원'}`} />
            <Metric
              label="카메라 기준 각도"
              value={abs ? `${abs.yaw.toFixed(0)} / ${abs.pitch.toFixed(0)} / ${abs.roll.toFixed(0)}` : '-'}
            />
            <Metric label="판별 횟수 / 영상 크기" value={live ? `${live.frames} / ${live.video}` : '-'} />
          </dl>
          <p className="hint">카메라 기준 각도는 좌우 / 상하 / 기울기 순서입니다.</p>
          <button className="wide" onClick={() => cam.switchDelegate(info.delegate === 'GPU' ? 'CPU' : 'GPU')}>
            연산 장치를 {info.delegate === 'GPU' ? 'CPU' : 'GPU'}로 바꾸기
          </button>
        </section>
      )}

      <section className="card">
        <h2>판정 기록</h2>
        {cam.log.length === 0 ? (
          <p className="hint">아직 기록이 없습니다.</p>
        ) : (
          <ul className="log">
            {cam.log.map((l, i) => (
              <li key={i} className={l.kind}>
                <time>{l.time}</time>
                {l.text}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}

function Stepper(p: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  const set = (v: number) => p.onChange(Math.min(p.max, Math.max(p.min, v)))
  return (
    <div className="stepper">
      <span>{p.label}</span>
      <div>
        <button aria-label={`${p.label} 5분 줄이기`} onClick={() => set(p.value - 5)}>
          −5
        </button>
        <button aria-label={`${p.label} 1분 줄이기`} onClick={() => set(p.value - 1)}>
          −1
        </button>
        <b>{p.value}분</b>
        <button aria-label={`${p.label} 1분 늘리기`} onClick={() => set(p.value + 1)}>
          +1
        </button>
        <button aria-label={`${p.label} 5분 늘리기`} onClick={() => set(p.value + 5)}>
          +5
        </button>
      </div>
    </div>
  )
}

function Metric({ label, value, limit }: { label: string; value: string; limit?: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {value}
        {limit && <small>허용 {limit}</small>}
      </dd>
    </div>
  )
}

function fmtDeg(v: number | null | undefined): string {
  if (v === null || v === undefined) return '-'
  return `${v > 0 ? '+' : ''}${v.toFixed(0)}°`
}
