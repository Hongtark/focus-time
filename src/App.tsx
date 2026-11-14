import { useCallback, useEffect, useRef, useState } from 'react'
import { createFaceDetector, type FaceDetector } from './detector/faceDetector'
import {
  DEFAULT_SETTINGS,
  FocusJudge,
  type Baseline,
  type FaceSample,
  type Judgement,
  type JudgeSettings,
  type RawState,
} from './detector/focusJudge'
import { load, save } from './platform/storage'
import { keepScreenOn, type WakeLockHandle } from './platform/wakeLock'

/** 판별 간격(ms). 초당 5회면 자세 변화를 잡기에 충분하고 발열이 적다. */
const DETECT_INTERVAL_MS = 200
const CALIBRATION_MS = 3000
const LOG_LIMIT = 30

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
  const [baseline, setBaseline] = useState<Baseline | null>(() => load<Baseline | null>('baseline', null))
  const [calibrating, setCalibrating] = useState(false)
  const [info, setInfo] = useState({ delegate: '', wakeLock: false })

  // 판별 루프는 한 번 시작하면 계속 도므로 최신 설정은 ref로 읽는다.
  const settingsRef = useRef(settings)
  const baselineRef = useRef(baseline)
  const calibRef = useRef<{ until: number; samples: FaceSample[] } | null>(null)
  const cleanupRef = useRef<() => void>(() => {})

  useEffect(() => {
    settingsRef.current = settings
    save('settings', settings)
  }, [settings])
  useEffect(() => {
    baselineRef.current = baseline
    if (baseline) save('baseline', baseline)
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

      const tick = () => {
        if (video.readyState < 2 || document.visibilityState !== 'visible') return
        const t = performance.now()
        const sample = detector!.detect(video, t)

        const calib = calibRef.current
        if (calib) {
          if (sample.present) calib.samples.push(sample)
          if (t >= calib.until) {
            calibRef.current = null
            setCalibrating(false)
            if (calib.samples.length >= 5) {
              const avg = (f: (s: FaceSample) => number) =>
                calib.samples.reduce((a, s) => a + f(s), 0) / calib.samples.length
              const b = { yaw: avg((s) => s.yaw), pitch: avg((s) => s.pitch) }
              baselineRef.current = b
              setBaseline(b)
              judge.reset()
              lastVerdict = 'focused'
              addLog(`기준 자세 저장 (좌우 ${b.yaw.toFixed(0)}°, 상하 ${b.pitch.toFixed(0)}°)`, 'info')
            } else {
              addLog('기준 자세 저장 실패: 얼굴이 잘 보이지 않았습니다', 'info')
            }
          }
        }

        const base = baselineRef.current ?? { yaw: 0, pitch: 0 }
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
        setLive({ sample, judgement, fps })
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
    setPhase('idle')
  }, [])

  const calibrate = () => {
    calibRef.current = { until: performance.now() + CALIBRATION_MS, samples: [] }
    setCalibrating(true)
  }

  const j = live?.judgement
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
        <p className="sub">1단계 · 카메라 인식과 판별 기준값 확인</p>
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
