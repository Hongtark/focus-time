// 얼굴 인식 엔진(wasm)을 설치된 패키지에서 public/으로 복사한다.
// 외부 CDN 대신 앱과 같은 주소에서 내려받게 해 오프라인에서도 동작하도록 하기 위함이다.
// 폴더 이름에 버전을 넣어, 패키지를 올리면 예전 캐시와 섞이지 않게 한다.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkgDir = join(root, 'node_modules/@mediapipe/tasks-vision')
const { version } = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
const dest = join(root, 'public', `mediapipe-${version}`)

for (const name of readdirSync(join(root, 'public'))) {
  if (name.startsWith('mediapipe-') && name !== `mediapipe-${version}`) {
    rmSync(join(root, 'public', name), { recursive: true })
  }
}
if (!existsSync(dest)) {
  mkdirSync(dest, { recursive: true })
  cpSync(join(pkgDir, 'wasm'), dest, { recursive: true })
  console.log(`copied mediapipe wasm ${version}`)
}
