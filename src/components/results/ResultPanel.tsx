import type { OCRResult, TextBlock } from '../../types/ocr'

/**
 * 目視で気づきにくい誤りを自動検出し、行ごとの警告ラベルを返す。
 * - continuity: 前行が文末（。！？）なのに、この行が文頭に来ない助詞等で始まる＝読み順の乱れ疑い
 * - bracket: 鉤括弧/丸括弧の対応が取れていない（閉じ過多 or 開きっぱなし）
 */
function detectLineWarnings(lines: TextBlock[]): string[][] {
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

interface ResultPanelProps {
  result: OCRResult | null
  selectedBlock: TextBlock | null
  selectedPageBlockText?: string | null
  onEditBlock?: (block: TextBlock, newText: string) => void
  onMoveBlock?: (block: TextBlock, dir: 'up' | 'down') => void
  lang: 'ja' | 'en'
}

export function ResultPanel({ result, selectedBlock, onEditBlock, onMoveBlock, lang }: ResultPanelProps) {
  if (!result) {
    return (
      <div className="result-panel empty">
        <p>{lang === 'ja' ? '結果なし' : 'No results'}</p>
      </div>
    )
  }

  // 読み順に並べた行（そのまま編集できる一覧にする）
  const lines = [...result.textBlocks].sort((a, b) => a.readingOrder - b.readingOrder)
  const warnings = detectLineWarnings(lines)
  const warnCount = warnings.filter((w) => w.length > 0).length
  const warnLabel = (w: string[]) => {
    const parts: string[] = []
    if (w.includes('continuity')) parts.push(lang === 'ja' ? '前の行とつながらない可能性（読み順を確認）' : 'May not connect to previous line (check order)')
    if (w.includes('bracket')) parts.push(lang === 'ja' ? '括弧の対応が取れていない可能性' : 'Unbalanced brackets')
    return parts.join(' / ')
  }

  return (
    <div className="result-panel">
      <div className="result-header">
        <span className="result-filename">{result.fileName}</span>
        <span className="result-stats">
          {result.textBlocks.length}
          {lang === 'ja' ? ' 行' : ' lines'}
          {' · '}
          {(result.processingTimeMs / 1000).toFixed(1)}s
        </span>
      </div>

      <div className="result-text">
        {lines.length === 0 ? (
          <p className="no-text">
            {lang === 'ja' ? 'テキストが検出されませんでした' : 'No text detected'}
          </p>
        ) : onEditBlock ? (
          <>
            <div className="edit-hint">
              {lang === 'ja'
                ? '各行はそのまま編集でき、↑↓で読み順を入れ替えられます（PDF・ePub・Word・コピーに反映）'
                : 'Edit lines directly; reorder with ↑↓. Applies to PDF / ePub / Word / copy.'}
            </div>
            {warnCount > 0 && (
              <div className="warn-summary">
                {lang === 'ja'
                  ? `⚠️ 要確認の箇所が ${warnCount} 件あります（読み順・括弧の乱れの疑い。⚠️の行を確認してください）`
                  : `⚠️ ${warnCount} line(s) flagged for review (possible order/bracket issues)`}
              </div>
            )}
            <ol className="line-editor">
              {lines.map((b, i) => {
                const isActive = selectedBlock?.readingOrder === b.readingOrder
                const rows = Math.max(1, b.text.split('\n').length)
                const w = warnings[i]
                return (
                  <li key={b.readingOrder} className={`line-row${isActive ? ' active' : ''}${w.length ? ' line-warn' : ''}`}>
                    {w.length > 0 && (
                      <span className="line-warn-mark" title={warnLabel(w)}>⚠️</span>
                    )}
                    <textarea
                      className="line-edit"
                      value={b.text}
                      rows={rows}
                      onChange={(e) => onEditBlock(b, e.target.value)}
                      spellCheck={false}
                    />
                    {onMoveBlock && (
                      <span className="line-move">
                        <button
                          type="button"
                          className="line-move-btn"
                          onClick={() => onMoveBlock(b, 'up')}
                          disabled={i === 0}
                          title={lang === 'ja' ? '上へ（読み順を前に）' : 'Move up'}
                        >↑</button>
                        <button
                          type="button"
                          className="line-move-btn"
                          onClick={() => onMoveBlock(b, 'down')}
                          disabled={i === lines.length - 1}
                          title={lang === 'ja' ? '下へ（読み順を後に）' : 'Move down'}
                        >↓</button>
                      </span>
                    )}
                  </li>
                )
              })}
            </ol>
          </>
        ) : (
          <pre className="full-text">{result.fullText}</pre>
        )}
      </div>
    </div>
  )
}
