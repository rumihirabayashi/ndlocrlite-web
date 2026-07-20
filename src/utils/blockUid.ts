import type { OCRResult, TextBlock } from '../types/ocr'

/**
 * 行の安定ID（uid）を生成する。
 * crypto.randomUUID() が使える環境ではそれを使い、無い環境（古いSafari等）は簡易フォールバック。
 */
export function genUid(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `uid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * OCRResult 内の各 TextBlock に uid を保証する（アプリ境界で1回だけ呼ぶ）。
 * すでに uid を持つ行はそのまま（IndexedDBから復元した新しいデータや、既に付与済みの行を壊さない）。
 * uid が無い行（ワーカー生成直後・uid未対応の旧データ）だけ新規付与する。
 * textBlocks に変更が無ければ元のオブジェクトをそのまま返す（不要な再レンダリングを避ける）。
 */
export function ensureBlockUids(result: OCRResult): OCRResult {
  if (!result.textBlocks || result.textBlocks.length === 0) return result
  let changed = false
  const textBlocks: TextBlock[] = result.textBlocks.map((b) => {
    if (b.uid) return b
    changed = true
    return { ...b, uid: genUid() }
  })
  return changed ? { ...result, textBlocks } : result
}
