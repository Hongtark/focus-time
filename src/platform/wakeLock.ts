// 화면 꺼짐 방지. 기기마다 지원이 달라(특히 아이폰) 여기에만 모아 둔다.

export interface WakeLockHandle {
  /** 지원되지 않거나 거부되면 false */
  active: boolean
  release(): void
}

export async function keepScreenOn(): Promise<WakeLockHandle> {
  if (!('wakeLock' in navigator)) return { active: false, release() {} }

  let sentinel: WakeLockSentinel | null = null
  let released = false

  const acquire = async () => {
    try {
      sentinel = await navigator.wakeLock.request('screen')
      return true
    } catch {
      return false
    }
  }

  // 다른 앱에 다녀오면 잠금이 풀리므로 화면이 다시 보일 때 재요청한다.
  const onVisible = () => {
    if (!released && document.visibilityState === 'visible') void acquire()
  }

  const active = await acquire()
  document.addEventListener('visibilitychange', onVisible)

  return {
    active,
    release() {
      released = true
      document.removeEventListener('visibilitychange', onVisible)
      void sentinel?.release()
    },
  }
}
