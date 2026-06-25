import type { OCRResult, TextBlock } from '../types/ocr'

/**
 * 目視で気づきにくい誤りを自動検出し、行ごとの警告ラベルを返す。
 * - continuity: 前行が文末（。！？）なのに、この行が文頭に来ない助詞等で始まる＝読み順の乱れ疑い
 * - bracket: 鉤括弧/丸括弧の対応が取れていない（閉じ過多 or 開きっぱなし）
 *
 * 引数 lines は読み順（readingOrder）に並んでいることを前提とする。
 */
export function detectLineWarnings(lines: TextBlock[]): string[][] {
  const warns: string[][] = lines.map(() => [])
  const sentenceEnd = /[。！？!?][」』）)]*$/
  // 文頭に来ない文字で始まる（格助詞・読点・閉じ括弧など）
  const cantStart = /^[、。，．をにがはへと」』）)]/
  for (let i = 1; i < lines.length; i++) {
    const prev = (lines[i - 1].text || '').trim()
    const cur = (lines[i].text || '').trim()
    if (prev && cur && sentenceEnd.test(prev) && cantStart.test(cur)) {
      warns[i].push('continuity')
    }
  }
  // 括弧の対応（ペアごとにページ内で深さを追跡）
  const pairs: [string, string][] = [['「', '」'], ['『', '』'], ['（', '）'], ['(', ')']]
  for (const [open, close] of pairs) {
    let depth = 0
    let lastOpenLine = -1
    for (let i = 0; i < lines.length; i++) {
      for (const ch of lines[i].text || '') {
        if (ch === open) { depth++; lastOpenLine = i }
        else if (ch === close) {
          depth--
          if (depth < 0) { if (!warns[i].includes('bracket')) warns[i].push('bracket'); depth = 0 }
        }
      }
    }
    if (depth > 0 && lastOpenLine >= 0 && !warns[lastOpenLine].includes('bracket')) {
      warns[lastOpenLine].push('bracket')
    }
  }
  return warns
}

/** 1ページ（OCRResult）の要確認行の件数を返す。サムネイル等の一覧表示用。 */
export function countPageWarnings(result: OCRResult | null | undefined): number {
  if (!result) return 0
  const lines = [...result.textBlocks].sort((a, b) => a.readingOrder - b.readingOrder)
  const warnings = detectLineWarnings(lines)
  return warnings.filter((w) => w.length > 0).length
}
