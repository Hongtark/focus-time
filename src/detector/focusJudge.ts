// 집중 판별 로직. 카메라·브라우저와 무관한 순수 계산이라 단독으로 시험할 수 있다.

/** 한 번의 얼굴 측정값 */
export interface FaceSample {
  /** 측정 시각(ms) */
  t: number
  /** 얼굴이 화면에 잡혔는지 */
  present: boolean
  /** 좌우 회전(도). 부호는 방향, 판별에는 기준값과의 차이만 쓴다 */
  yaw: number
  /** 상하 회전(도). 양수 = 고개 숙임 */
  pitch: number
  /** 눈 감김 정도 0~1 (양쪽 중 덜 감긴 쪽) */
  eyesClosed: number
}

export interface Baseline {
  yaw: number
  pitch: number
}

export interface JudgeSettings {
  /** 기준 자세에서 좌우로 이만큼(도) 넘게 돌리면 비집중 */
  yawLimit: number
  /** 기준 자세보다 위로 이만큼(도) 넘게 들면 비집중 */
  pitchUpLimit: number
  /** 기준 자세보다 아래로 이만큼(도) 넘게 숙이면 비집중 */
  pitchDownLimit: number
  /** 눈 감김 값이 이 이상이면 감은 것으로 본다 */
  blinkThreshold: number
  /** 눈을 이 시간(초) 넘게 감고 있으면 졸음으로 본다 */
  eyesClosedSec: number
  /** 비집중 자세가 이 시간(초) 이어져야 일시정지한다 */
  graceSec: number
  /** 집중 자세가 이 시간(초) 이어져야 다시 집중으로 본다 */
  recoverSec: number
}

export const DEFAULT_SETTINGS: JudgeSettings = {
  yawLimit: 30,
  pitchUpLimit: 20,
  pitchDownLimit: 35,
  blinkThreshold: 0.6,
  eyesClosedSec: 3,
  graceSec: 7,
  recoverSec: 1,
}

/** 지금 이 순간의 자세 */
export type RawState = 'focused' | 'absent' | 'turned' | 'eyesClosed'
/** 유예 시간을 적용한 최종 판정 */
export type Verdict = 'focused' | 'distracted'

export interface Judgement {
  raw: RawState
  verdict: Verdict
  /** verdict가 distracted일 때 그 원인 */
  reason: RawState | null
  /** 기준 자세와의 차이(도). 얼굴이 없으면 null */
  dYaw: number | null
  dPitch: number | null
  /** 현재 raw 상태가 이어진 시간(초) */
  rawForSec: number
}

export class FocusJudge {
  private verdict: Verdict = 'focused'
  private reason: RawState | null = null
  private raw: RawState = 'focused'
  private rawSince = 0
  private eyesClosedSince: number | null = null
  private started = false

  update(s: FaceSample, base: Baseline, cfg: JudgeSettings): Judgement {
    let raw: RawState = 'focused'
    let dYaw: number | null = null
    let dPitch: number | null = null

    if (!s.present) {
      raw = 'absent'
      this.eyesClosedSince = null
    } else {
      dYaw = s.yaw - base.yaw
      dPitch = s.pitch - base.pitch
      if (s.eyesClosed >= cfg.blinkThreshold) {
        if (this.eyesClosedSince === null) this.eyesClosedSince = s.t
      } else {
        this.eyesClosedSince = null
      }
      if (Math.abs(dYaw) > cfg.yawLimit || dPitch > cfg.pitchDownLimit || -dPitch > cfg.pitchUpLimit) {
        raw = 'turned'
      } else if (
        this.eyesClosedSince !== null &&
        (s.t - this.eyesClosedSince) / 1000 >= cfg.eyesClosedSec
      ) {
        raw = 'eyesClosed'
      }
    }

    if (!this.started || raw !== this.raw) {
      // 비집중 종류만 바뀐 경우(예: 고개 돌림 → 자리 비움)는 유예 시간을 다시 세지 않는다.
      const stillDistracted = this.started && raw !== 'focused' && this.raw !== 'focused'
      if (!stillDistracted) this.rawSince = s.t
      this.raw = raw
      this.started = true
    }
    const rawForSec = (s.t - this.rawSince) / 1000

    if (raw === 'focused') {
      if (this.verdict === 'distracted' && rawForSec >= cfg.recoverSec) {
        this.verdict = 'focused'
        this.reason = null
      }
    } else {
      // 졸음은 이미 eyesClosedSec만큼 기다렸으므로 유예 없이 바로 반영한다.
      if (this.verdict === 'focused' && (raw === 'eyesClosed' || rawForSec >= cfg.graceSec)) {
        this.verdict = 'distracted'
      }
      if (this.verdict === 'distracted') this.reason = raw
    }

    return { raw, verdict: this.verdict, reason: this.reason, dYaw, dPitch, rawForSec }
  }

  reset() {
    this.verdict = 'focused'
    this.reason = null
    this.raw = 'focused'
    this.started = false
    this.eyesClosedSince = null
  }
}
