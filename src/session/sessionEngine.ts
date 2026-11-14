// 학습 세션의 시간 규칙. 화면·카메라와 무관한 순수 계산이라 단독으로 시험할 수 있다.
import type { RawState, Verdict } from '../detector/focusJudge'

export interface SessionConfig {
  /** 한 번에 집중할 시간(분) */
  studyMin: number
  /** 쉬는 시간(분) */
  breakMin: number
}

export const DEFAULT_SESSION: SessionConfig = { studyMin: 45, breakMin: 15 }

/**
 * idle      세션 없음
 * study     학습 중 (집중이면 누적, 비집중이면 일시정지)
 * break     휴식 중
 * breakOver 휴식이 끝나 학습자가 돌아오기를 기다리는 중
 */
export type SessionPhase = 'idle' | 'study' | 'break' | 'breakOver'

export type SessionEvent = 'paused' | 'resumed' | 'breakStart' | 'breakEnd' | 'studyStart'

export interface FocusInput {
  raw: RawState
  verdict: Verdict
}

export interface SessionSnapshot {
  phase: SessionPhase
  /** 세션 전체 집중 시간 */
  focusMs: number
  /** 세션 전체 중단 시간 */
  pausedMs: number
  /** 중단 횟수 */
  interruptions: number
  /** 끝까지 채운 학습 구간 수 */
  sets: number
  /** 지금 학습 구간에서 채운 집중 시간 */
  blockFocusMs: number
  /** 지금 학습 구간의 남은 집중 시간 */
  blockRemainingMs: number
  /** 휴식 남은 시간 */
  breakRemainingMs: number
  /** 학습 중 일시정지 상태인지 */
  paused: boolean
  startedAt: number
}

/** 한 번의 tick이 인정하는 최대 시간. 화면이 꺼져 있던 동안을 집중 시간으로 치지 않기 위함이다. */
const MAX_TICK_MS = 1000
/** 휴식이 끝난 뒤 공부 자세가 이만큼 이어지면 자동으로 학습을 시작한다 */
const AUTO_RESUME_MS = 2000

export class SessionEngine {
  private phase: SessionPhase = 'idle'
  private focusMs = 0
  private pausedMs = 0
  private interruptions = 0
  private sets = 0
  private blockFocusMs = 0
  private paused = false
  /** 자세는 벗어났지만 아직 유예 중이라 집중으로 세고 있는 시간. 일시정지가 확정되면 되돌린다. */
  private pendingMs = 0
  private breakEndsAt = 0
  private readySince: number | null = null
  private lastTick = 0
  private startedAt = 0

  start(now: number) {
    this.phase = 'study'
    this.focusMs = this.pausedMs = this.interruptions = this.sets = 0
    this.startedAt = now
    this.beginStudy(now)
  }

  end() {
    this.phase = 'idle'
  }

  /** 학습 중에 바로 휴식으로 넘어간다 */
  startBreak(now: number, cfg: SessionConfig): SessionEvent[] {
    if (this.phase !== 'study') return []
    return this.beginBreak(now, cfg)
  }

  /** 휴식을 건너뛰거나, 휴식이 끝난 뒤 바로 학습을 시작한다 */
  resumeStudy(now: number): SessionEvent[] {
    if (this.phase !== 'break' && this.phase !== 'breakOver') return []
    this.phase = 'study'
    this.beginStudy(now)
    return ['studyStart']
  }

  /** input이 null이면 그 시점에 판별 결과가 없다는 뜻이다(휴식 중, 화면 꺼짐 등). */
  tick(now: number, input: FocusInput | null, cfg: SessionConfig): SessionEvent[] {
    const events: SessionEvent[] = []
    const elapsed = Math.max(0, now - this.lastTick)
    this.lastTick = now

    if (this.phase === 'study') {
      const dt = Math.min(elapsed, MAX_TICK_MS)
      // 관찰하지 못한 시간은 집중으로 인정하지 않고 중단 시간에 더한다.
      this.pausedMs += elapsed - dt
      if (!input) {
        this.pausedMs += dt
        return events
      }
      if (input.verdict === 'focused') {
        if (this.paused) {
          this.paused = false
          events.push('resumed')
        }
        this.focusMs += dt
        this.blockFocusMs += dt
        this.pendingMs = input.raw === 'focused' ? 0 : this.pendingMs + dt
      } else {
        if (!this.paused) {
          this.paused = true
          this.interruptions++
          // 유예 시간 동안 집중으로 세었던 부분을 중단 시간으로 옮긴다.
          const back = Math.min(this.pendingMs, this.blockFocusMs)
          this.focusMs -= back
          this.blockFocusMs -= back
          this.pausedMs += back
          this.pendingMs = 0
          events.push('paused')
        }
        this.pausedMs += dt
      }
      if (this.blockFocusMs >= cfg.studyMin * 60_000) {
        this.sets++
        events.push(...this.beginBreak(now, cfg))
      }
    } else if (this.phase === 'break') {
      if (now >= this.breakEndsAt) {
        this.phase = 'breakOver'
        this.readySince = null
        events.push('breakEnd')
      }
    } else if (this.phase === 'breakOver') {
      if (input?.raw === 'focused') {
        this.readySince ??= now
        if (now - this.readySince >= AUTO_RESUME_MS) events.push(...this.resumeStudy(now))
      } else {
        this.readySince = null
      }
    }
    return events
  }

  snapshot(now: number, cfg: SessionConfig): SessionSnapshot {
    return {
      phase: this.phase,
      focusMs: this.focusMs,
      pausedMs: this.pausedMs,
      interruptions: this.interruptions,
      sets: this.sets,
      blockFocusMs: this.blockFocusMs,
      blockRemainingMs: Math.max(0, cfg.studyMin * 60_000 - this.blockFocusMs),
      breakRemainingMs: this.phase === 'break' ? Math.max(0, this.breakEndsAt - now) : 0,
      paused: this.phase === 'study' && this.paused,
      startedAt: this.startedAt,
    }
  }

  private beginStudy(now: number) {
    this.blockFocusMs = 0
    this.pendingMs = 0
    this.paused = false
    this.lastTick = now
  }

  private beginBreak(now: number, cfg: SessionConfig): SessionEvent[] {
    this.phase = 'break'
    this.paused = false
    this.breakEndsAt = now + cfg.breakMin * 60_000
    return ['breakStart']
  }
}
