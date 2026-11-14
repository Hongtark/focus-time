/** 남은 시간 표시용: 44:59 */
export function clock(ms: number): string {
  const total = Math.ceil(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** 누적 시간 표시용: 1시간 23분, 12분 5초 */
export function duration(ms: number): string {
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}시간 ${m}분`
  if (m > 0) return `${m}분 ${s}초`
  return `${s}초`
}

/** 집중률(%): 집중 시간 ÷ (집중 + 중단) */
export function focusRate(focusMs: number, pausedMs: number): string {
  const total = focusMs + pausedMs
  return total > 0 ? `${Math.round((focusMs / total) * 100)}%` : '-'
}
