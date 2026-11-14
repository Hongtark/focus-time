import { useCallback, useEffect, useRef, useState } from 'react'
import { useFocusCamera, type FocusCamera } from './camera/useFocusCamera'
import { DEFAULT_SETTINGS, type Judgement, type JudgeSettings } from './detector/focusJudge'
import { alertUser, unlockAudio } from './platform/alert'
import { requestPersistentStorage } from './platform/install'
import { load, save } from './platform/storage'
import { recordFromSnapshot, type SessionRecord } from './records/stats'
import { addRecord, recoverActive, saveActive } from './records/store'
import { DEFAULT_SESSION, SessionEngine, type SessionConfig, type SessionEvent } from './session/sessionEngine'
import { SettingsPanel } from './ui/SettingsPanel'
import { StatsPanel } from './ui/StatsPanel'
import { TimerPanel, type SessionStage } from './ui/TimerPanel'

/** 화면에 표시해 폰이 최신 배포본을 열었는지 확인하는 용도 */
const APP_VERSION = '0.4.0'
/** 학습·휴식 전환을 화면 전체로 알리는 시간. 무음 모드이거나 진동이 없는 기기(아이폰)를 위한 것이다. */
const FLASH_MS = 12_000
/** 진행 중인 학습을 이 간격으로 중간 저장한다 */
const AUTOSAVE_MS = 5000

type Tab = 'timer' | 'stats' | 'settings'

export default function App() {
  const [tab, setTab] = useState<Tab>('timer')
  const [settings, setSettings] = useState<JudgeSettings>(() => load('settings', DEFAULT_SETTINGS))
  const [config, setConfig] = useState<SessionConfig>(() => load('session', DEFAULT_SESSION))
  const [stage, setStage] = useState<SessionStage>('idle')
  const [calibrationRetry, setCalibrationRetry] = useState(false)

  const engineRef = useRef(new SessionEngine())
  const [snap, setSnap] = useState(() => engineRef.current.snapshot(Date.now(), config))
  const [summary, setSummary] = useState<typeof snap | null>(null)
  // 지난번에 끝내지 못하고 닫힌 학습이 있으면 이때 기록으로 옮겨진다.
  const [records, setRecords] = useState<SessionRecord[]>(() => recoverActive())
  const [activeRecord, setActiveRecord] = useState<SessionRecord | null>(null)
  const lastSaveRef = useRef(0)
  const [flash, setFlash] = useState('')
  const flashTimerRef = useRef(0)

  const showFlash = useCallback((text: string) => {
    setFlash(text)
    clearTimeout(flashTimerRef.current)
    flashTimerRef.current = window.setTimeout(() => setFlash(''), FLASH_MS)
  }, [])

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
        showFlash('휴식 시간입니다')
        cam?.setDetecting(false) // 휴식 중에는 판별을 쉬어 배터리를 아낀다.
        cam?.addLog('휴식 시작')
      } else if (ev === 'breakEnd') {
        alertUser('breakEnd')
        showFlash('휴식 끝! 다시 시작할 시간입니다')
        cam?.setDetecting(true)
        cam?.addLog('휴식 끝')
      } else if (ev === 'studyStart') {
        cam?.setDetecting(true)
        cam?.addLog('학습 시작')
        setFlash('')
      }
    }
  }, [showFlash])

  const onTick = useCallback(
    (j: Judgement | null, now: number) => {
      const engine = engineRef.current
      if (engine.snapshot(now, configRef.current).phase === 'idle') return
      handleEvents(engine.tick(now, j && { raw: j.raw, verdict: j.verdict }, configRef.current))
      const next = engine.snapshot(now, configRef.current)
      setSnap(next)
      if (now - lastSaveRef.current >= AUTOSAVE_MS) {
        lastSaveRef.current = now
        const rec = recordFromSnapshot(next, now)
        saveActive(rec)
        setActiveRecord(rec)
      }
    },
    [handleEvents],
  )

  const cam = useFocusCamera({ settingsRef, onTick })
  camRef.current = cam

  // 페이지가 닫히거나 가려지는 순간의 상태까지 남긴다.
  useEffect(() => {
    const flush = () => {
      const now = Date.now()
      const last = engineRef.current.snapshot(now, configRef.current)
      if (last.phase !== 'idle') saveActive(recordFromSnapshot(last, now))
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', flush)
    }
  }, [])

  const startSession = async () => {
    const runId = ++runIdRef.current
    unlockAudio() // 버튼을 누른 이 순간에만 소리 허용을 받을 수 있다.
    void requestPersistentStorage()
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
    lastSaveRef.current = now
    setSnap(engineRef.current.snapshot(now, configRef.current))
    cam.addLog('학습 시작')
    setStage('active')
  }

  const endSession = () => {
    runIdRef.current++
    const engine = engineRef.current
    const now = Date.now()
    const last = engine.snapshot(now, configRef.current)
    if (last.phase !== 'idle') {
      setSummary(last)
      setRecords(addRecord(recordFromSnapshot(last, now)))
    }
    setActiveRecord(null)
    setFlash('')
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
  const cameraOn = running || cam.phase === 'loading'
  const stageClass = ['stage', tab === 'timer' ? 'compact' : '', cameraOn && tab !== 'stats' ? '' : 'hidden', tone]
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
          <button className={tab === 'stats' ? 'on' : ''} onClick={() => setTab('stats')}>
            통계
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

      {flash && (
        <button className="flash" onClick={() => setFlash('')}>
          {flash}
          <small>화면을 누르면 닫힙니다</small>
        </button>
      )}
      {stage === 'active' && running && !cam.info.wakeLock && tab === 'timer' && (
        <p className="notice">
          이 브라우저는 화면 꺼짐 방지를 지원하지 않습니다. 폰 설정에서 화면 자동 잠금을 「안 함」으로 바꿔 두세요.
        </p>
      )}

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
      ) : tab === 'stats' ? (
        <StatsPanel records={records} active={activeRecord} onRecords={setRecords} />
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
