// 학습·휴식 전환 알림. 기기마다 되는 것이 달라(아이폰은 진동 불가) 여기에만 모아 둔다.

let ctx: AudioContext | null = null

/**
 * 브라우저는 사용자가 화면을 누른 뒤에만 소리를 허용한다.
 * 「학습 시작」 버튼을 누를 때 한 번 불러 두면 이후 알림음이 난다.
 */
export function unlockAudio(): void {
  try {
    // 예전 아이폰은 webkit 접두사가 붙은 이름만 제공한다.
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    ctx ??= new Ctor()
    void ctx.resume()
  } catch {
    // 소리를 못 내도 화면 표시와 진동으로 알릴 수 있다.
  }
}

export type AlertKind = 'breakStart' | 'breakEnd'

/** [주파수(Hz), 길이(초)] 목록 */
const TUNES: Record<AlertKind, [number, number][]> = {
  // 내려가는 음: 쉬어도 된다
  breakStart: [
    [880, 0.25],
    [660, 0.25],
    [523, 0.5],
  ],
  // 올라가는 음을 두 번: 다시 시작
  breakEnd: [
    [523, 0.2],
    [660, 0.2],
    [880, 0.4],
    [523, 0.2],
    [660, 0.2],
    [880, 0.4],
  ],
}

export function alertUser(kind: AlertKind): void {
  try {
    navigator.vibrate?.(kind === 'breakStart' ? [300, 150, 300] : [200, 100, 200, 100, 500])
  } catch {
    // 진동 미지원
  }
  if (!ctx) return
  try {
    void ctx.resume()
    let at = ctx.currentTime + 0.05
    for (const [freq, len] of TUNES[kind]) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(0.4, at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + len)
      osc.connect(gain).connect(ctx.destination)
      osc.start(at)
      osc.stop(at + len + 0.02)
      at += len + 0.05
    }
  } catch {
    // 소리 재생 실패는 무시한다.
  }
}
