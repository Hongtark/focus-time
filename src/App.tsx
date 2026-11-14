import { useCallback, useEffect, useRef, useState } from 'react'
import { createFaceDetector, type Delegate, type FaceDetector } from './detector/faceDetector'
import {
  DEFAULT_SETTINGS,
  FocusJudge,
  type Baseline,
  type FaceSample,
  type Judgement,
  type JudgeSettings,
  type RawState,
} from './detector/focusJudge'
import { anglesFromRot, IDENTITY, representative } from './detector/pose'
import { load, save } from './platform/storage'
import { keepScreenOn, type WakeLockHandle } from './platform/wakeLock'

/** 판별 간격(ms). 초당 5회면 자세 변화를 잡기에 충분하고 발열이 적다. */
const DETECT_INTERVAL_MS = 200
const CALIBRATION_MS = 3000
const LOG_LIMIT = 30
/** 판별 오류가 이만큼 연달아 나면 연산 장치를 CPU로 바꾼다 */
const ERRORS_BEFORE_CPU = 3
/** 화면에 표시해 폰이 최신 배포본을 열었는지 확인하는 용도 */
const APP_VERSION = '0.1.1'

const RAW_LABEL: Record<RawState, string> = {
  focused: '공부 자세',
  absent: '얼굴 안 보임',
  turned: '고개 돌림',
  eyesClosed: '눈 감음',
}

type Phase = 'idle' | 'loading' | 'running' | 'error'

interface LogEntry {
  time: string
  text: string
  kind: 'focused' | 'distracted' | 'info'
}

interface Live {
  sample: FaceSample
  judgement: Judgement
  fps: number
  /** 지금까지 판별한 횟수. 숫자가 멈춰 있으면 판별이 돌지 않는 것이다 */
  frames: number
  video: string
}

const SLIDERS: { key: keyof JudgeSettings; label: string; min: number; max: number; step: number; unit: string }[] = [
  { key: 'graceSec', label: '일시정지까지 유예', min: 1, max: 30, step: 1, unit: '초' },
  { key: 'yawLimit', label: '좌우 허용 각도', min: 10, max: 60, step: 1, unit: '°' },
  { key: 'pitchUpLimit', label: '위로 허용 각도', min: 5, max: 50, step: 1, unit: '°' },
  { key: 'pitchDownLimit', label: '아래로 허용 각도', min: 10, max: 70, step: 1, unit: '°' },
  { key: 'eyesClosedSec', label: '졸음 판정 시간', min: 1, max: 15, step: 1, unit: '초' },
  { key: 'blinkThreshold', label: '눈 감김 기준', min: 0.3, max: 0.9, step: 0.05, unit: '' },
]

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState('')
  const [live, setLive] = useState<Live | null>(null)
  const [log, setLog] = useState<LogEntry[]>([])
  const [settings, setSettings] = useState<JudgeSettings>(() => load('settings', DEFAULT_SETTINGS))
  const [baseline, setBaseline] = useState<Baseline | null>(() => load<Baseline | null>('baseline2', null))
  const [calibrating, setCalibrating] = useState(false)
  const [info, setInfo] = useState<{ delegate: Delegate | ''; wakeLock: boolean }>({ delegate: '', wakeLock: false })
  const [tickError, setTickError] = useState('')

  // 판별 루프는 한 번 시작하면 계속 도므로 최신 설정은 ref로 읽는다.
  const settingsRef = useRef(settings)
  const baselineRef = useRef(baseline)
  const calibRef = useRef<{ until: number; samples: FaceSample[] } | null>(null)
  const cleanupRef = useRef<() => void>(() => {})
  const switchDelegateRef = useRef<(d: Delegate) => void>(() => {})

  useEffect(() => {
    settingsRef.current = settings
    save('settings', settings)
  }, [settings])
  useEffect(() => {
    baselineRef.current = baseline
    if (baseline) save('baseline2', baseline)
  }, [baseline])
  useEffect(() => () => cleanupRef.current(), [])

  const addLog = useCallback((text: string, kind: LogEntry['kind']) => {
    const time = new Date().toLocaleTimeString('ko-KR', { hour12: false })
    setLog((prev) => [{ time, text, kind }, ...prev].slice(0, LOG_LIMIT))
  }, [])

  const start = useCallback(async () => {
    setPhase('loading')
    setError('')
    let stream: MediaStream | null = null
    let detector: FaceDetector | null = null
    let switching = false
    let wake: WakeLockHandle | null = null
    let timer = 0
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      })
      const video = videoRef.current!
      video.srcObject = stream
      await video.play()
      detector = await createFaceDetector()
      wake = await keepScreenOn()
      setInfo({ delegate: detector.delegate, wakeLock: wake.active })

      const judge = new FocusJudge()
      let lastVerdict = 'focused'
      let lastT = 0
      let fps = 0
      let frames = 0
      let errors = 0

      const switchDelegate = async (d: Delegate) => {
        if (switching) return
        switching = true
        try {
          const next = await createFaceDetector(d)
          detector?.close()
          detector = next
          errors = 0
          setTickError('')
          setInfo((i) => ({ ...i, delegate: next.delegate }))
          addLog(`연산 장치를 ${next.delegate}로 바꿈`, 'info')
        } catch (e) {
          setTickError(`연산 장치 전환 실패: ${e instanceof Error ? e.message : String(e)}`)
        } finally {
          switching = false
        }
      }
      switchDelegateRef.current = (d) => void switchDelegate(d)

      const tick = () => {
        if (switching || video.readyState < 2 || document.visibilityState !== 'visible') return
        const t = performance.now()
        let sample: FaceSample
        try {
          sample = detector!.detect(video, t)
          errors = 0
        } catch (e) {
          // 여기서 멈추면 화면이 마지막 판정에 얼어붙으므로 오류를 드러내고 CPU로 넘어간다.
          errors++
          setTickError(`판별 오류: ${e instanceof Error ? e.message : String(e)}`)
          if (errors >= ERRORS_BEFORE_CPU && detector!.delegate === 'GPU') void switchDelegate('CPU')
          return
        }
        frames++

        const calib = calibRef.current
        if (calib) {
          if (sample.present) calib.samples.push(sample)
          if (t >= calib.until) {
            calibRef.current = null
            setCalibrating(false)
            if (calib.samples.length >= 5) {
              const b = representative(calib.samples.map((s) => s.rot))
              const a = anglesFromRot(b)
              baselineRef.current = b
              setBaseline(b)
              judge.reset()
              lastVerdict = 'focused'
              addLog(`기준 자세 저장 (카메라 기준 좌우 ${a.yaw.toFixed(0)}°, 상하 ${a.pitch.toFixed(0)}°)`, 'info')
            } else {
              addLog(`기준 자세 저장 실패: 3초 동안 얼굴이 ${calib.samples.length}번만 잡혔습니다`, 'info')
            }
          }
        }

        const base = baselineRef.current ?? IDENTITY
        const judgement = judge.update(sample, base, settingsRef.current)
        if (judgement.verdict !== lastVerdict) {
          lastVerdict = judgement.verdict
          if (judgement.verdict === 'distracted') {
            addLog(`일시정지 — ${RAW_LABEL[judgement.reason ?? 'turned']}`, 'distracted')
          } else {
            addLog('집중 재개', 'focused')
          }
        }
        if (lastT) fps = fps * 0.8 + (1000 / (t - lastT)) * 0.2
        lastT = t
        setLive({ sample, judgement, fps, frames, video: `${video.videoWidth}×${video.videoHeight}` })
      }
      timer = window.setInterval(tick, DETECT_INTERVAL_MS)

      cleanupRef.current = () => {
        clearInterval(timer)
        stream?.getTracks().forEach((tr) => tr.stop())
        detector?.close()
        wake?.release()
      }
      setPhase('running')
      addLog('판별 시작', 'info')
    } catch (e) {
      clearInterval(timer)
      stream?.getTracks().forEach((tr) => tr.stop())
      detector?.close()
      wake?.release()
      setError(describeError(e))
      setPhase('error')
    }
  }, [addLog])

  const stop = useCallback(() => {
    cleanupRef.current()
    cleanupRef.current = () => {}
    if (videoRef.current) videoRef.current.srcObject = null
    setLive(null)
    setTickError('')
    setPhase('idle')
  }, [])

  const calibrate = () => {
    calibRef.current = { until: performance.now() + CALIBRATION_MS, samples: [] }
    setCalibrating(true)
  }

  const j = live?.judgement
  const abs = live?.sample.present ? anglesFromRot(live.sample.rot) : null
  const distracted = j?.verdict === 'distracted'
  // 유예 시간이 흐르는 중: 자세는 벗어났지만 아직 일시정지 전
  const warning = j && !distracted && j.raw !== 'focused'
  const statusClass = distracted ? 'distracted' : warning ? 'warning' : 'focused'
  const statusText = !j
    ? ''
    : distracted
      ? `일시정지 · ${RAW_LABEL[j.reason ?? 'turned']}`
      : warning
        ? `${RAW_LABEL[j.raw]} ${j.rawForSec.toFixed(0)}/${settings.graceSec}초`
        : '집중 중'

  return (
    <main>
      <header>
        <h1>집중 판별 시험</h1>
        <p className="sub">1단계 · 카메라 인식과 판별 기준값 확인 · v{APP_VERSION}</p>
      </header>

      <section className={`stage ${phase === 'running' ? statusClass : ''}`}>
        {/* playsInline·muted는 아이폰에서 영상이 전체 화면으로 튀지 않게 하는 데 필요하다 */}
        <video ref={videoRef} playsInline muted />
        {phase === 'running' && j && <div className="badge">{statusText}</div>}
        {calibrating && <div className="overlay">공부 자세를 3초간 유지하세요</div>}
        {phase === 'loading' && <div className="overlay">카메라와 인식 모델을 불러오는 중…</div>}
        {phase !== 'running' && phase !== 'loading' && (
          <div className="overlay">
            <button className="primary" onClick={start}>
              카메라 시작
            </button>
            {error && <p className="error">{error}</p>}
            <p className="hint">영상은 기기 안에서만 분석되고 저장·전송되지 않습니다.</p>
          </div>
        )}
      </section>

      {phase === 'running' && (
        <>
          <div className="actions">
            <button className="primary" onClick={calibrate} disabled={calibrating}>
              {baseline ? '기준 자세 다시 잡기' : '기준 자세 잡기'}
            </button>
            <button onClick={stop}>정지</button>
          </div>
          {tickError && <p className="notice error-box">{tickError}</p>}
          {!baseline && (
            <p className="notice">
              기준 자세가 없어 카메라 정면을 기준으로 판별 중입니다. 공부하는 자세를 취하고 「기준 자세 잡기」를
              누르세요.
            </p>
          )}

          <section className="card">
            <h2>측정값</h2>
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
            </dl>
            <h2 className="diag-title">진단용</h2>
            <dl className="metrics">
              <Metric
                label="카메라 기준 각도"
                value={abs ? `${abs.yaw.toFixed(0)} / ${abs.pitch.toFixed(0)} / ${abs.roll.toFixed(0)}` : '-'}
                limit={undefined}
              />
              <Metric label="판별 횟수 / 영상 크기" value={live ? `${live.frames} / ${live.video}` : '-'} />
            </dl>
            <p className="hint">카메라 기준 각도는 좌우 / 상하 / 기울기 순서입니다.</p>
            <button
              className="diag-btn"
              onClick={() => switchDelegateRef.current(info.delegate === 'GPU' ? 'CPU' : 'GPU')}
            >
              연산 장치를 {info.delegate === 'GPU' ? 'CPU' : 'GPU'}로 바꾸기
            </button>
          </section>
        </>
      )}

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
              onChange={(e) => setSettings({ ...settings, [s.key]: Number(e.target.value) })}
            />
          </label>
        ))}
        <button onClick={() => setSettings(DEFAULT_SETTINGS)}>기본값으로</button>
      </section>

      <section className="card">
        <h2>판정 기록</h2>
        {log.length === 0 ? (
          <p className="hint">아직 기록이 없습니다.</p>
        ) : (
          <ul className="log">
            {log.map((l, i) => (
              <li key={i} className={l.kind}>
                <time>{l.time}</time>
                {l.text}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
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

function describeError(e: unknown): string {
  if (!navigator.mediaDevices?.getUserMedia) {
    return '이 브라우저에서는 카메라를 쓸 수 없습니다. HTTPS 주소로 접속했는지 확인하세요.'
  }
  const name = e instanceof DOMException ? e.name : ''
  if (name === 'NotAllowedError') return '카메라 권한이 거부되었습니다. 브라우저 설정에서 카메라를 허용해 주세요.'
  if (name === 'NotFoundError') return '카메라를 찾을 수 없습니다.'
  if (name === 'NotReadableError') return '다른 앱이 카메라를 사용 중입니다.'
  return `시작하지 못했습니다: ${e instanceof Error ? e.message : String(e)}`
}
