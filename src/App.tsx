import { useCallback, useEffect, useRef, useState } from 'react'
import { useFocusCamera, type FocusCamera } from './camera/useFocusCamera'
import { DEFAULT_SETTINGS, type Judgement, type JudgeSettings } from './detector/focusJudge'
import { alertUser, unlockAudio } from './platform/alert'
import { load, save } from './platform/storage'
import { DEFAULT_SESSION, SessionEngine, type SessionConfig, type SessionEvent } from './session/sessionEngine'
import { SettingsPanel } from './ui/SettingsPanel'
import { TimerPanel, type SessionStage } from './ui/TimerPanel'

/** 화면에 표시해 폰이 최신 배포본을 열었는지 확인하는 용도 */
const APP_VERSION = '0.2.0'

type Tab = 'timer' | 'settings'

export default function App() {
  const [tab, setTab] = useState<Tab>('timer')
  const [settings, setSettings] = useState<JudgeSettings>(() => load('settings', DEFAULT_SETTINGS))
  const [config, setConfig] = useState<SessionConfig>(() => load('session', DEFAULT_SESSION))
  const [stage, setStage] = useState<SessionStage>('idle')
  const [calibrationRetry, setCalibrationRetry] = useState(false)

  const engineRef = useRef(new SessionEngine())
  const [snap, setSnap] = useState(() => engineRef.current.snapshot(Date.now(), config))
  const [summary, setSummary] = useState<typeof snap | null>(null)

  // 판별 루프는 한 번 시작하면 계속 도므로 최신 값은 ref로 읽는다.
  const settingsRef = useRef(settings)
  const configRef = useRef(config)
  const camRef = useRef<FocusCamera | null>(null)
  /** 시작 절차(카메라 준비 → 기준 자세)가 도중에 취소됐는지 가리는 번호 */
  const runIdRef = useRef(0)

  useEffect(() => {
    settingsRef.current = settings
    save('settings', settings)
  }, [settings])
  useEffect(() => {
    configRef.current = config
    save('session', config)
  }, [config])

  const handleEvents = useCallback((events: SessionEvent[]) => {
    const cam = camRef.current
    for (const ev of events) {
      if (ev === 'breakStart') {
        alertUser('breakStart')
        cam?.setDetecting(false) // 휴식 중에는 판별을 쉬어 배터리를 아낀다.
        cam?.addLog('휴식 시작')
      } else if (ev === 'breakEnd') {
        alertUser('breakEnd')
        cam?.setDetecting(true)
        cam?.addLog('휴식 끝')
      } else if (ev === 'studyStart') {
        cam?.setDetecting(true)
        cam?.addLog('학습 시작')
      }
    }
  }, [])

  const onTick = useCallback(
    (j: Judgement | null, now: number) => {
      const engine = engineRef.current
      if (engine.snapshot(now, configRef.current).phase === 'idle') return
      handleEvents(engine.tick(now, j && { raw: j.raw, verdict: j.verdict }, configRef.current))
      setSnap(engine.snapshot(now, configRef.current))
    },
    [handleEvents],
  )

  const cam = useFocusCamera({ settingsRef, onTick })
  camRef.current = cam

  const startSession = async () => {
    const runId = ++runIdRef.current
    unlockAudio() // 버튼을 누른 이 순간에만 소리 허용을 받을 수 있다.
    setSummary(null)
    setCalibrationRetry(false)
    setStage('starting')
    if (!(await cam.start())) {
      if (runIdRef.current === runId) setStage('idle')
      return
    }
    if (runIdRef.current !== runId) return
    setStage('calibrating')
    while (!(await cam.calibrate())) {
      if (runIdRef.current !== runId) return
      setCalibrationRetry(true)
    }
    if (runIdRef.current !== runId) return
    setCalibrationRetry(false)
    const now = Date.now()
    engineRef.current.start(now)
    setSnap(engineRef.current.snapshot(now, configRef.current))
    cam.addLog('학습 시작')
    setStage('active')
  }

  const endSession = () => {
    runIdRef.current++
    const engine = engineRef.current
    const last = engine.snapshot(Date.now(), configRef.current)
    if (last.phase !== 'idle') setSummary(last)
    engine.end()
    cam.stop()
    setCalibrationRetry(false)
    setStage('idle')
  }

  const breakNow = () => {
    const now = Date.now()
    handleEvents(engineRef.current.startBreak(now, configRef.current))
    setSnap(engineRef.current.snapshot(now, configRef.current))
  }

  const resume = () => {
    const now = Date.now()
    handleEvents(engineRef.current.resumeStudy(now))
    setSnap(engineRef.current.snapshot(now, configRef.current))
  }

  const running = cam.phase === 'running'
  const j = cam.live?.judgement
  const judging = running && (stage !== 'active' || snap.phase !== 'break')
  const tone = !judging || !j ? '' : j.verdict === 'distracted' ? 'distracted' : j.raw !== 'focused' ? 'warning' : 'focused'
  // 타이머 화면에서는 카메라가 켜져 있을 때만 작은 미리보기로 보여준다.
  const stageClass = ['stage', tab === 'timer' ? 'compact' : '', running || cam.phase === 'loading' ? '' : 'hidden', tone]
    .filter(Boolean)
    .join(' ')

  return (
    <main>
      <header>
        <div>
          <h1>집중 타이머</h1>
          <p className="sub">v{APP_VERSION}</p>
        </div>
        <nav>
          <button className={tab === 'timer' ? 'on' : ''} onClick={() => setTab('timer')}>
            타이머
          </button>
          <button className={tab === 'settings' ? 'on' : ''} onClick={() => setTab('settings')}>
            설정
          </button>
        </nav>
      </header>

      <section className={stageClass}>
        {/* playsInline·muted는 아이폰에서 영상이 전체 화면으로 튀지 않게 하는 데 필요하다 */}
        <video ref={cam.videoRef} playsInline muted />
        {cam.calibrating && <div className="overlay">공부 자세를 3초간 유지하세요</div>}
        {cam.phase === 'loading' && <div className="overlay">카메라와 인식 모델을 불러오는 중…</div>}
      </section>

      {tab === 'timer' ? (
        <TimerPanel
          stage={stage}
          snap={snap}
          summary={summary}
          live={cam.live}
          config={config}
          settings={settings}
          cameraError={cam.error}
          calibrationRetry={calibrationRetry}
          onStart={() => void startSession()}
          onEnd={endSession}
          onBreakNow={breakNow}
          onResume={resume}
        />
      ) : (
        <SettingsPanel
          cam={cam}
          sessionActive={stage !== 'idle'}
          config={config}
          onConfig={setConfig}
          settings={settings}
          onSettings={setSettings}
        />
      )}
    </main>
  )
}
