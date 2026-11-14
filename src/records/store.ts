// 학습 기록을 기기 안에 보관한다. 서버로는 아무것도 보내지 않는다.
// 기록은 한 건에 수백 바이트라 localStorage로 충분하고, 페이지가 닫히는 순간에도 바로 쓸 수 있다.
import { isRecord, mergeRecords, type SessionRecord } from './stats'

const RECORDS_KEY = 'records'
/** 진행 중인 학습의 중간 저장본. 페이지가 갑자기 닫혀도 여기까지는 남는다. */
const ACTIVE_KEY = 'activeSession'
/** 이보다 짧은 학습은 잘못 누른 것으로 보고 저장하지 않는다 */
const MIN_RECORD_MS = 5000

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function loadRecords(): SessionRecord[] {
  const list = read<unknown[]>(RECORDS_KEY, [])
  return Array.isArray(list) ? mergeRecords(list.filter(isRecord), []) : []
}

function worthKeeping(r: SessionRecord): boolean {
  return r.focusMs + r.pausedMs >= MIN_RECORD_MS
}

/** 끝난 학습을 기록에 더하고 전체 목록을 돌려준다 */
export function addRecord(r: SessionRecord): SessionRecord[] {
  const all = worthKeeping(r) ? mergeRecords(loadRecords(), [r]) : loadRecords()
  write(RECORDS_KEY, all)
  clearActive()
  return all
}

export function saveActive(r: SessionRecord): void {
  write(ACTIVE_KEY, r)
}

export function clearActive(): void {
  try {
    localStorage.removeItem(ACTIVE_KEY)
  } catch {
    // 무시
  }
}

/** 지난번에 끝내지 못하고 닫힌 학습이 있으면 기록으로 옮긴다 */
export function recoverActive(): SessionRecord[] {
  const r = read<unknown>(ACTIVE_KEY, null)
  return isRecord(r) ? addRecord(r) : loadRecords()
}

export function deleteAllRecords(): void {
  write(RECORDS_KEY, [])
  clearActive()
}

interface ExportFile {
  app: 'focus-timer'
  version: 1
  exportedAt: string
  records: SessionRecord[]
}

/** 기록을 파일로 내려받는다 */
export function exportRecords(records: SessionRecord[]): void {
  const file: ExportFile = { app: 'focus-timer', version: 1, exportedAt: new Date().toISOString(), records }
  const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `focus-timer-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 내보낸 파일의 내용을 지금 기록에 합친다. 새로 들어온 건수를 돌려준다. */
export function importRecords(text: string): { records: SessionRecord[]; added: number } {
  const data = JSON.parse(text) as unknown
  const list = Array.isArray(data) ? data : (data as Partial<ExportFile>)?.records
  if (!Array.isArray(list)) throw new Error('집중 타이머에서 내보낸 파일이 아닙니다.')
  const incoming = list.filter(isRecord)
  const before = loadRecords()
  const merged = mergeRecords(before, incoming)
  if (!write(RECORDS_KEY, merged)) throw new Error('기기에 저장하지 못했습니다.')
  return { records: merged, added: merged.length - before.length }
}
