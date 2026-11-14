// 홈 화면 설치와 오프라인 준비. 안드로이드와 아이폰의 방식이 달라 여기에만 모아 둔다.
import { useEffect, useState } from 'react'

/** 크롬이 "설치할 수 있다"고 알려 줄 때 주는 이벤트 */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function registerServiceWorker(): void {
  // 개발 서버에서는 캐시가 수정 사항을 가리므로 배포본에서만 켠다.
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // 등록에 실패해도 온라인에서는 그대로 쓸 수 있다.
    })
  })
}

/** 이미 홈 화면에서 앱으로 열렸는지 */
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

export function isIOS(): boolean {
  // 아이패드는 자신을 Mac이라고 소개하므로 터치 지원 여부로 가린다.
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
}

/**
 * 기록이 브라우저의 자동 정리로 지워지지 않도록 요청한다.
 * 받아들일지는 브라우저가 정하며(설치된 앱이면 대체로 허용), 결과를 돌려준다.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false
    return (await navigator.storage.persisted()) || (await navigator.storage.persist())
  } catch {
    return false
  }
}

export type InstallState =
  | { kind: 'installed' }
  /** 버튼 한 번으로 설치할 수 있다(안드로이드 크롬 등) */
  | { kind: 'prompt'; install: () => Promise<void> }
  /** 사용자가 공유 메뉴에서 직접 추가해야 한다(아이폰) */
  | { kind: 'ios' }
  /** 브라우저 메뉴에서 설치해야 하거나 지원하지 않는다 */
  | { kind: 'manual' }

export function useInstall(): InstallState {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(isStandalone)

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault() // 브라우저의 자동 안내 대신 설정 화면의 버튼으로 띄운다.
      setPrompt(e as InstallPromptEvent)
    }
    const onInstalled = () => {
      setInstalled(true)
      setPrompt(null)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  if (installed) return { kind: 'installed' }
  if (prompt) {
    return {
      kind: 'prompt',
      install: async () => {
        await prompt.prompt()
        if ((await prompt.userChoice).outcome === 'accepted') setInstalled(true)
        setPrompt(null)
      },
    }
  }
  return isIOS() ? { kind: 'ios' } : { kind: 'manual' }
}
