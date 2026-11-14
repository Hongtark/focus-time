// 서비스 워커: 한 번 열어 본 뒤에는 인터넷 없이도 앱이 뜨게 한다.
// 빌드할 때 vite.config.ts가 아래 __자리표시__ 를 실제 값으로 바꿔 sw.js로 내보낸다.

const BUILD = '__BUILD__'
/** 화면을 이루는 작은 파일들. 배포할 때마다 새로 받는다. */
const SHELL = __SHELL__
/** 인식 엔진처럼 크고 잘 안 바뀌는 파일들. 배포와 무관하게 한 번만 받는다. */
const HEAVY = __HEAVY__
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

const SHELL_CACHE = `shell-${BUILD}`
const HEAVY_CACHE = 'heavy-v1'

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL_CACHE)
      await shell.addAll(SHELL)
      // 큰 파일은 받다가 실패해도 설치를 막지 않는다. 나중에 쓰일 때 다시 받아 채운다.
      const heavy = await caches.open(HEAVY_CACHE)
      await Promise.allSettled(
        [...HEAVY, MODEL_URL].map(async (url) => {
          if (!(await heavy.match(url, { ignoreVary: true }))) await heavy.add(url)
        }),
      )
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name !== SHELL_CACHE && name !== HEAVY_CACHE) await caches.delete(name)
      }
      await self.clients.claim()
    })(),
  )
})

function isHeavy(url) {
  return url.href === MODEL_URL || (url.origin === self.location.origin && url.pathname.includes('/mediapipe-'))
}

async function cacheFirst(cacheName, request) {
  const cache = await caches.open(cacheName)
  // 서버가 Vary 헤더를 붙이면 같은 주소라도 못 찾는 경우가 있어, 주소만으로 찾는다.
  const hit = await cache.match(request, { ignoreVary: true })
  if (hit) return hit
  const res = await fetch(request)
  if (res.ok) await cache.put(request, res.clone())
  return res
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)

  if (isHeavy(url)) {
    event.respondWith(cacheFirst(HEAVY_CACHE, request))
    return
  }
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    // 온라인이면 항상 최신 화면을, 끊겼으면 저장해 둔 화면을 보여준다.
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(request)
          if (res.ok) (await caches.open(SHELL_CACHE)).put('./', res.clone())
          return res
        } catch {
          return (await caches.match('./', { ignoreVary: true })) ?? Response.error()
        }
      })(),
    )
    return
  }
  event.respondWith(cacheFirst(SHELL_CACHE, request))
})
