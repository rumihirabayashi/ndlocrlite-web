import type { OCRResult, TextBlock } from '../../types/ocr'

interface ResultPanelProps {
  result: OCRResult | null
  selectedBlock: TextBlock | null
  selectedPageBlockText?: string | null
  onEditBlock?: (block: TextBlock, newText: string) => void
  lang: 'ja' | 'en'
}

export function ResultPanel({ result, selectedBlock, onEditBlock, lang }: ResultPanelProps) {
  if (!result) {
    return (
      <div className="result-panel empty">
        <p>{lang === 'ja' ? '結果なし' : 'No results'}</p>
      </div>
    )
  }

  // 読み順に並べた行（そのまま編集できる一覧にする）
  const lines = [...result.textBlocks].sort((a, b) => a.readingOrder - b.readingOrder)

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
                ? '認識結果は、各行をそのまま編集できます（修正はPDF・ePub・Word・コピーに反映されます）'
                : 'Edit any line directly. Edits apply to PDF / ePub / Word / copy.'}
            </div>
            <ol className="line-editor">
              {lines.map((b) => {
                const isActive = selectedBlock?.readingOrder === b.readingOrder
                const rows = Math.max(1, b.text.split('\n').length)
                return (
                  <li key={b.readingOrder} className={`line-row${isActive ? ' active' : ''}`}>
                    <textarea
                      className="line-edit"
                      value={b.text}
                      rows={rows}
                      onChange={(e) => onEditBlock(b, e.target.value)}
                      spellCheck={false}
                    />
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
