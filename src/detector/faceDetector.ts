// MediaPipe Face Landmarker를 감싸 영상 한 장에서 FaceSample 하나를 뽑아낸다.
// 분석은 모두 기기 안에서 이뤄지고 영상은 어디로도 전송되지 않는다.
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import type { FaceSample } from './focusJudge'

// package.json의 @mediapipe/tasks-vision 버전과 맞춰야 한다.
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

const RAD2DEG = 180 / Math.PI

export interface FaceDetector {
  detect(video: HTMLVideoElement, t: number): FaceSample
  close(): void
  /** 실제로 선택된 연산 장치 */
  delegate: 'GPU' | 'CPU'
}

export async function createFaceDetector(): Promise<FaceDetector> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL)
  const make = (delegate: 'GPU' | 'CPU') =>
    FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    })

  let delegate: 'GPU' | 'CPU' = 'GPU'
  let landmarker: FaceLandmarker
  try {
    landmarker = await make('GPU')
  } catch {
    delegate = 'CPU'
    landmarker = await make('CPU')
  }

  return {
    delegate,
    detect(video, t) {
      const res = landmarker.detectForVideo(video, t)
      const matrix = res.facialTransformationMatrixes?.[0]?.data
      if (!res.faceLandmarks?.length || !matrix) {
        return { t, present: false, yaw: 0, pitch: 0, eyesClosed: 0 }
      }
      const { yaw, pitch } = eulerFromMatrix(matrix)
      const shapes = res.faceBlendshapes?.[0]?.categories ?? []
      const score = (name: string) => shapes.find((c) => c.categoryName === name)?.score ?? 0
      // 한쪽 눈만 감은 경우(윙크, 가림)는 졸음이 아니므로 덜 감긴 쪽을 쓴다.
      const eyesClosed = Math.min(score('eyeBlinkLeft'), score('eyeBlinkRight'))
      return { t, present: true, yaw, pitch, eyesClosed }
    },
    close() {
      landmarker.close()
    },
  }
}

/**
 * 4x4 변환 행렬(열 우선)에서 고개 각도를 구한다. R = Ry(yaw)·Rx(pitch)·Rz(roll)로 분해.
 * pitch는 양수가 고개 숙임이 되도록 잡았다.
 */
export function eulerFromMatrix(m: ArrayLike<number>): { yaw: number; pitch: number; roll: number } {
  const r02 = m[8]
  const r12 = m[9]
  const r22 = m[10]
  const r10 = m[1]
  const r11 = m[5]
  return {
    yaw: Math.atan2(r02, r22) * RAD2DEG,
    pitch: Math.asin(Math.max(-1, Math.min(1, -r12))) * RAD2DEG,
    roll: Math.atan2(r10, r11) * RAD2DEG,
  }
}
