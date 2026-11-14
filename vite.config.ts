import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const mediapipeVersion: string = JSON.parse(
  readFileSync('node_modules/@mediapipe/tasks-vision/package.json', 'utf8'),
).version

/**
 * 빌드 결과물 목록을 넣어 서비스 워커(sw.js)를 만든다.
 * 목록이 바뀌면 캐시 이름도 바뀌어, 새 배포본이 예전 파일과 섞이지 않는다.
 */
function serviceWorker(): Plugin {
  return {
    name: 'focus-timer-sw',
    apply: 'build',
    generateBundle(_, bundle) {
      const shell = [
        './',
        'manifest.webmanifest',
        'icons/icon-192.png',
        'icons/icon-512.png',
        ...Object.keys(bundle).filter((f) => f.startsWith('assets/')),
      ]
      const heavy = [
        `mediapipe-${mediapipeVersion}/vision_wasm_internal.js`,
        `mediapipe-${mediapipeVersion}/vision_wasm_internal.wasm`,
      ]
      const build = createHash('sha256').update(shell.join('|')).digest('hex').slice(0, 10)
      const source = readFileSync('src/sw.template.js', 'utf8')
        .replace('__BUILD__', build)
        .replace('__SHELL__', JSON.stringify(shell))
        .replace('__HEAVY__', JSON.stringify(heavy))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

// base를 상대 경로로 두어 GitHub Pages의 /저장소이름/ 아래에서도 그대로 동작한다.
export default defineConfig({
  base: './',
  plugins: [react(), serviceWorker()],
  define: {
    __MEDIAPIPE_VERSION__: JSON.stringify(mediapipeVersion),
  },
})
