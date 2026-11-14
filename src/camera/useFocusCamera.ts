// 카메라를 켜고 일정 간격으로 집중 여부를 판별하는 부품.
// 화면(타이머·설정)은 여기서 나오는 판정만 받아 쓴다.
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import { createFaceDetector, type Delegate, type FaceDetector } from '../detector/faceDetector'
import {
  FocusJudge,
  type Baseline,
  type FaceSample,
  type Judgement,
  type JudgeSettings,
  type RawState,
} from '../detector/focusJudge'
import { anglesFromRot, IDENTITY, representative } from '../detector/pose'
import { load, save } from '../platform/storage'
import { keepScreenOn, type WakeLockHandle } from '../platform/wakeLock'

/** 판별 간격(ms). 초당 5회면 자세 변화를 잡기에 충분하고 발열이 적다. */
const TICK_MS = 200
const CALIBRATION_MS = 3000
const LOG_LIMIT = 30
/** 판별 오류가 이만큼 연달아 나면 연산 장치를 CPU로 바꾼다 */
const ERRORS_BEFORE_CPU = 3

export const RAW_LABEL: Record<RawState, string> = {
  focused: '공부 자세',
  absent: '얼굴 안 보임',
  turned: '고개 돌림',
  eyesClosed: '눈 감음',
}

export type CameraPhase = 'idle' | 'loading' | 'running' | 'error'

export interface LogEntry {
  time: string
  text: string
  kind: 'focused' | 'distracted' | 'info'
}

export interface Live {
  sample: FaceSample
  judgement: Judgement
  fps: number
  /** 지금까지 판별한 횟수. 숫자가 멈춰 있으면 판별이 돌지 않는 것이다 */
  frames: number
  video: string
}

interface Options {
  settingsRef: MutableRefObject<JudgeSettings>
  /**
   * TICK_MS마다 불린다. 판별을 쉬는 중이거나 화면이 가려져 있으면 judgement는 null이다.
   * now는 Date.now() 기준이다.
   */
  onTick: (judgement: Judgement | null, now: number) => void
}

export function useFocusCamera({ settingsRef, onTick }: Options) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [phase, setPhase] = useState<CameraPhase>('idle')
  const [error, setError] = useState('')
  const [tickError, setTickError] = useState('')
  const [live, setLive] = useState<Live | null>(null)
  const [log, setLog] = useState<LogEntry[]>([])
  const [baseline, setBaseline] = useState<Baseline | null>(() => load<Baseline | null>('baseline2', null))
  const [calibrating, setCalibrating] = useState(false)
  const [info, setInfo] = useState<{ delegate: Delegate | ''; wakeLock: boolean }>({ delegate: '', wakeLock: false })

  const onTickRef = useRef(onTick)
  onTickRef.current = onTick
  const baselineRef = useRef(baseline)
  const calibRef = useRef<{ until: number; samples: FaceSample[]; done: (ok: boolean) => void } | null>(null)
  /** false면 얼굴 판별을 건너뛴다(휴식 중 배터리 절약) */
  const detectingRef = useRef(true)
  const judgeRef = useRef(new FocusJudge())
  const cleanupRef = useRef<() => void>(() => {})
  const switchDelegateRef = useRef<(d: Delegate) => void>(() => {})
  const phaseRef = useRef<CameraPhase>('idle')

  useEffect(() => () => cleanupRef.current(), [])

  const addLog = useCallback((text: string, kind: LogEntry['kind'] = 'info') => {
    const time = new Date().toLocaleTimeString('ko-KR', { hour12: false })
    setLog((prev) => [{ time, text, kind }, ...prev].slice(0, LOG_LIMIT))
  }, [])

  const start = useCallback(async (): Promise<boolean> => {
    if (phaseRef.current === 'running') return true
    if (phaseRef.current === 'loading') return false
    phaseRef.current = 'loading'
    setPhase('loading')
    setError('')
    let stream: MediaStream | null = null
    let detector: FaceDetector | null = null
    let wake: WakeLockHandle | null = null
    let timer = 0
    let switching = false
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

      const judge = judgeRef.current
      judge.reset()
      detectingRef.current = true
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
          addLog(`연산 장치를 ${next.delegate}로 바꿈`)
        } catch (e) {
          setTickError(`연산 장치 전환 실패: ${e instanceof Error ? e.message : String(e)}`)
        } finally {
          switching = false
        }
      }
      switchDelegateRef.current = (d) => void switchDelegate(d)

      const tick = () => {
        const now = Date.now()
        const canDetect =
          detectingRef.current && !switching && video.readyState >= 2 && document.visibilityState === 'visible'
        if (!canDetect) {
          lastT = 0
          onTickRef.current(null, now)
          return
        }
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
          onTickRef.current(null, now)
          return
        }
        frames++

        const calib = calibRef.current
        if (calib) {
          if (sample.present) calib.samples.push(sample)
          if (t >= calib.until) {
            calibRef.current = null
            setCalibrating(false)
            const ok = calib.samples.length >= 5
            if (ok) {
              const b = representative(calib.samples.map((s) => s.rot))
              const a = anglesFromRot(b)
              baselineRef.current = b
              setBaseline(b)
              save('baseline2', b)
              judge.reset()
              lastVerdict = 'focused'
              addLog(`기준 자세 저장 (카메라 기준 좌우 ${a.yaw.toFixed(0)}°, 상하 ${a.pitch.toFixed(0)}°)`)
            } else {
              addLog(`기준 자세 저장 실패: 3초 동안 얼굴이 ${calib.samples.length}번만 잡혔습니다`)
            }
            calib.done(ok)
          }
        }

        const judgement = judge.update(sample, baselineRef.current ?? IDENTITY, settingsRef.current)
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
        // 기준 자세를 재는 동안의 판정은 의미가 없으므로 넘기지 않는다.
        onTickRef.current(calibRef.current ? null : judgement, now)
      }
      timer = window.setInterval(tick, TICK_MS)

      cleanupRef.current = () => {
        clearInterval(timer)
        stream?.getTracks().forEach((tr) => tr.stop())
        detector?.close()
        wake?.release()
        calibRef.current?.done(false)
        calibRef.current = null
      }
      phaseRef.current = 'running'
      setPhase('running')
      addLog('카메라 시작')
      return true
    } catch (e) {
      clearInterval(timer)
      stream?.getTracks().forEach((tr) => tr.stop())
      detector?.close()
      wake?.release()
      setError(describeError(e))
      phaseRef.current = 'error'
      setPhase('error')
      return false
    }
  }, [addLog, settingsRef])

  const stop = useCallback(() => {
    cleanupRef.current()
    cleanupRef.current = () => {}
    if (videoRef.current) videoRef.current.srcObject = null
    setLive(null)
    setTickError('')
    setCalibrating(false)
    phaseRef.current = 'idle'
    setPhase('idle')
  }, [])

  /** 공부 자세를 3초간 기록해 기준으로 삼는다. 얼굴이 잘 안 잡히면 false. */
  const calibrate = useCallback((): Promise<boolean> => {
    if (phaseRef.current !== 'running') return Promise.resolve(false)
    calibRef.current?.done(false)
    setCalibrating(true)
    return new Promise((done) => {
      calibRef.current = { until: performance.now() + CALIBRATION_MS, samples: [], done }
    })
  }, [])

  const setDetecting = useCallback((on: boolean) => {
    if (on && !detectingRef.current) judgeRef.current.reset()
    detectingRef.current = on
  }, [])

  const switchDelegate = useCallback((d: Delegate) => switchDelegateRef.current(d), [])

  return {
    videoRef,
    phase,
    error,
    tickError,
    live,
    log,
    baseline,
    calibrating,
    info,
    start,
    stop,
    calibrate,
    setDetecting,
    switchDelegate,
    addLog,
  }
}

export type FocusCamera = ReturnType<typeof useFocusCamera>

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
