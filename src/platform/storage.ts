// 설정처럼 작은 값을 기기에 보관한다. 사생활 보호 모드 등에서 실패해도 앱은 계속 동작해야 한다.

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    const parsed = JSON.parse(raw)
    return typeof fallback === 'object' && fallback !== null ? { ...fallback, ...parsed } : parsed
  } catch {
    return fallback
  }
}

export function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 저장 실패는 무시한다.
  }
}
