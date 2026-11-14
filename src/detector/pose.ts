// 고개 방향 계산. 회전은 3x3 행렬(행 우선, 길이 9)로 다룬다.
// 각도 분해는 R = Ry(yaw)·Rx(pitch)·Rz(roll), pitch 양수 = 고개 숙임.

export type Rot = number[]

const RAD = Math.PI / 180

export interface Angles {
  yaw: number
  pitch: number
  roll: number
}

export const IDENTITY: Rot = [1, 0, 0, 0, 1, 0, 0, 0, 1]

/** MediaPipe의 4x4 변환 행렬(열 우선)에서 회전 부분만 꺼낸다 */
export function rotFromMatrix4(m: ArrayLike<number>): Rot {
  return [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]]
}

export function anglesFromRot(r: Rot): Angles {
  return {
    yaw: Math.atan2(r[2], r[8]) / RAD,
    pitch: Math.asin(Math.max(-1, Math.min(1, -r[5]))) / RAD,
    roll: Math.atan2(r[3], r[4]) / RAD,
  }
}

export function rotFromAngles(yawDeg: number, pitchDeg: number, rollDeg = 0): Rot {
  const [cy, sy] = [Math.cos(yawDeg * RAD), Math.sin(yawDeg * RAD)]
  const [cp, sp] = [Math.cos(pitchDeg * RAD), Math.sin(pitchDeg * RAD)]
  const [cr, sr] = [Math.cos(rollDeg * RAD), Math.sin(rollDeg * RAD)]
  const ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy]
  const rx = [1, 0, 0, 0, cp, -sp, 0, sp, cp]
  const rz = [cr, -sr, 0, sr, cr, 0, 0, 0, 1]
  return mul(mul(ry, rx), rz)
}

/**
 * 기준 자세에서 현재 자세까지의 회전(base⁻¹·cur).
 * 각도끼리 빼지 않고 회전 자체를 비교하므로, 폰이 아래에서 올려다보거나 기울어져 있어도 값이 틀어지지 않는다.
 */
export function relativeAngles(base: Rot, cur: Rot): Angles {
  return anglesFromRot(mul(transpose(base), cur))
}

/** 여러 측정 중 평균에 가장 가까운 것을 대표로 고른다 */
export function representative(rots: Rot[]): Rot {
  const mean = IDENTITY.map((_, i) => rots.reduce((a, r) => a + r[i], 0) / rots.length)
  let best = rots[0]
  let bestDist = Infinity
  for (const r of rots) {
    const d = r.reduce((a, v, i) => a + (v - mean[i]) ** 2, 0)
    if (d < bestDist) {
      bestDist = d
      best = r
    }
  }
  return best
}

function mul(a: Rot, b: Rot): Rot {
  const out = new Array<number>(9)
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) out[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]
  return out
}

function transpose(a: Rot): Rot {
  return [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]]
}
