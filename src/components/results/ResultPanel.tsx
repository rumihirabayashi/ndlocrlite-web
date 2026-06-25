import type { OCRResult, TextBlock } from '../../types/ocr'
import { detectLineWarnings } from '../../utils/lineWarnings'

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
