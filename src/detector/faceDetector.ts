// MediaPipe Face Landmarker를 감싸 영상 한 장에서 FaceSample 하나를 뽑아낸다.
// 분석은 모두 기기 안에서 이뤄지고 영상은 어디로도 전송되지 않는다.
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import type { FaceSample } from './focusJudge'
import { IDENTITY, rotFromMatrix4 } from './pose'

declare const __MEDIAPIPE_VERSION__: string

// 인식 엔진은 앱과 같은 주소에서 받는다(scripts/copy-wasm.mjs가 복사해 둔다).
const WASM_URL = new URL(`mediapipe-${__MEDIAPIPE_VERSION__}`, document.baseURI).href
// 인식 모델은 구글 서버에서 받고, 서비스 워커가 저장해 두어 다음부터는 오프라인에서도 쓴다.
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

export type Delegate = 'GPU' | 'CPU'

export interface FaceDetector {
  detect(video: HTMLVideoElement, t: number): FaceSample
  close(): void
  /** 실제로 선택된 연산 장치 */
  delegate: Delegate
}

export async function createFaceDetector(prefer: Delegate = 'GPU'): Promise<FaceDetector> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL)
  const make = (delegate: Delegate) =>
    FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    })

  let delegate = prefer
  let landmarker: FaceLandmarker
  try {
    landmarker = await make(prefer)
  } catch (e) {
    if (prefer === 'CPU') throw e
    delegate = 'CPU'
    landmarker = await make('CPU')
  }

  return {
    delegate,
    detect(video, t) {
      const res = landmarker.detectForVideo(video, t)
      const matrix = res.facialTransformationMatrixes?.[0]?.data
      if (!res.faceLandmarks?.length || !matrix) {
        return { t, present: false, rot: IDENTITY, eyesClosed: 0 }
      }
      const shapes = res.faceBlendshapes?.[0]?.categories ?? []
      const score = (name: string) => shapes.find((c) => c.categoryName === name)?.score ?? 0
      // 한쪽 눈만 감은 경우(윙크, 가림)는 졸음이 아니므로 덜 감긴 쪽을 쓴다.
      const eyesClosed = Math.min(score('eyeBlinkLeft'), score('eyeBlinkRight'))
      return { t, present: true, rot: rotFromMatrix4(matrix), eyesClosed }
    },
    close() {
      landmarker.close()
    },
  }
}
