import { useState } from 'react'
import type { OCRResult, ProcessedImage } from '../../types/ocr'
import { downloadText, copyToClipboard } from '../../utils/textExport'
import { buildSearchablePdf, downloadPdf, type ExportPage, type Orientation } from '../../utils/exporters/pdfExport'
import { buildEpub, downloadBlob } from '../../utils/exporters/epubExport'
import { buildDocx } from '../../utils/exporters/docxExport'

type ExportFormat = 'txt' | 'pdf' | 'epub' | 'docx'

// Word出力で選べるフォント。既定は「指定なし」＝各環境の標準日本語フォントで崩れを防ぐ。
// 名前付きフォントは環境に無いと代替される（崩れではなく字体の置換）。
const FONT_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '標準（指定なし・どの環境でも安全）' },
  { value: '游明朝', label: '游明朝（Mac/Windows）' },
  { value: '游ゴシック', label: '游ゴシック（Mac/Windows）' },
  { value: 'BIZ UDP明朝', label: 'BIZ UDP明朝（UD・Windows中心）' },
  { value: 'BIZ UDPゴシック', label: 'BIZ UDPゴシック（UD・Windows中心）' },
  { value: 'メイリオ', label: 'メイリオ（Windows）' },
  { value: 'ヒラギノ明朝 ProN', label: 'ヒラギノ明朝（Mac）' },
  { value: 'ヒラギノ角ゴシック', label: 'ヒラギノ角ゴシック（Mac）' },
]

interface ResultActionsProps {
  results: OCRResult[]
  currentResult: OCRResult | null
  processedImages: ProcessedImage[]
  orientation: Orientation
  /** PDF書き出しが可能か（履歴のテキストのみ表示時は画像が無いため false） */
  pdfAvailable?: boolean
  lang: 'ja' | 'en'
}

/** ImageData → PNG バイト列（PDF埋め込み用） */
async function imageDataToPngBytes(imageData: ImageData): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  canvas.width = imageData.width
  canvas.height = imageData.height
  canvas.getContext('2d')!.putImageData(imageData, 0, 0)
  const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), 'image/png'))
  return new Uint8Array(await blob.arrayBuffer())
}

export function ResultActions({ results, currentResult, processedImages, orientation, pdfAvailable = true, lang }: ResultActionsProps) {
  const [copied, setCopied] = useState(false)
  const [includeFileName, setIncludeFileName] = useState(false)
  const [ignoreNewlines, setIgnoreNewlines] = useState(false)
  const [format, setFormat] = useState<ExportFormat>('pdf')
  const [txtCurrentOnly, setTxtCurrentOnly] = useState(false)
  const [docxBodyFont, setDocxBodyFont] = useState('')      // 既定＝指定なし
  const [docxHeadingFont, setDocxHeadingFont] = useState('') // 既定＝指定なし
  const [exporting, setExporting] = useState(false)

  const applyOptions = (text: string) =>
    ignoreNewlines ? text.replace(/\n/g, '') : text

  const buildText = (result: OCRResult) =>
    applyOptions(includeFileName ? `=== ${result.fileName} ===\n${result.fullText}` : result.fullText)

  const handleCopy = async () => {
    const text = currentResult ? buildText(currentResult) : ''
    try {
      await copyToClipboard(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      alert(lang === 'ja' ? 'コピーに失敗しました' : 'Failed to copy')
    }
  }

  const baseName = (results[0]?.fileName ?? 'ocr')
    .replace(/\s*[（(]\s*p\.?\s*\d+\s*[)）]\s*$/i, '') // 末尾の「(p.1)」等を除去
    .replace(/\.[^/.]+$/, '')                          // 拡張子を除去
  const pageLabel = (i: number) => (processedImages[i]?.pageIndex ? `p.${processedImages[i].pageIndex}` : undefined)

  // 選択中の形式で書き出す
  const handleExport = async () => {
    if (results.length === 0) return
    if (format === 'pdf' && !pdfAvailable) return // 画像が無い履歴表示ではPDFを書き出さない
    setExporting(true)
    try {
      if (format === 'txt') {
        if (txtCurrentOnly && currentResult) {
          downloadText(buildText(currentResult), currentResult.fileName)
        } else {
          downloadText(results.map((r) => buildText(r)).join('\n\n'), baseName)
        }
      } else if (format === 'pdf') {
        // PDFは画像と対応する透明テキストを重ねる。認識失敗ページ（textBlocks空）は
        // 画像のみ（透明テキストなし）で含まれ、ページ順・ページ数は保たれる。
        const n = Math.min(results.length, processedImages.length)
        const pages: ExportPage[] = []
        for (let i = 0; i < n; i++) {
          const img = processedImages[i].imageData
          const blocks = [...results[i].textBlocks].sort((a, b) => a.readingOrder - b.readingOrder)
          pages.push({ pngBytes: await imageDataToPngBytes(img), width: img.width, height: img.height, blocks })
        }
        const bytes = await buildSearchablePdf(pages, { orientation })
        downloadPdf(bytes, baseName)
      } else if (format === 'epub') {
        // テキスト系は全ページを対象にする（失敗ページは空テキストのまま順序を保つ）。
        const pages = results.map((r, i) => ({ fileName: r.fileName, pageLabel: pageLabel(i), blocks: r.textBlocks }))
        downloadBlob(await buildEpub(pages, { title: baseName }), `${baseName}.epub`)
      } else {
        const pages = results.map((r, i) => ({ fileName: r.fileName, pageLabel: pageLabel(i), blocks: r.textBlocks }))
        downloadBlob(await buildDocx(pages, { title: baseName, bodyFont: docxBodyFont, headingFont: docxHeadingFont }), `${baseName}.docx`)
      }
    } catch (e) {
      console.error('Export failed:', e)
      alert(lang === 'ja' ? '書き出しに失敗しました' : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  const isText = format === 'txt'

  return (
    <div className="result-actions">
      {/* コピー（クリップボード） */}
      <div className="result-actions-buttons">
        <button className="btn btn-derivative" onClick={handleCopy} disabled={!currentResult}>
          {copied ? (lang === 'ja' ? 'コピーしました！' : 'Copied!') : (lang === 'ja' ? 'テキストをコピー' : 'Copy text')}
        </button>
      </div>

      {/* 出力形式を選んで書き出す */}
      <div className="result-actions-export">
        <div className="result-actions-export-title">
          {lang === 'ja' ? 'ファイルを書き出す' : 'Export file'}
        </div>
        <label className="result-actions-option">
          {lang === 'ja' ? '形式：' : 'Format: '}
          <select value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
            <option value="txt">{lang === 'ja' ? 'テキスト（.txt）' : 'Text (.txt)'}</option>
            <option value="pdf" disabled={!pdfAvailable}>{lang === 'ja' ? '透明テキスト付きPDF（検索・読み上げ・レイアウト保持）' : 'Searchable PDF'}</option>
            <option value="epub">{lang === 'ja' ? 'ePub（読み上げ向け・リフロー）' : 'ePub'}</option>
            <option value="docx">{lang === 'ja' ? '見出し付きWord（.docx）' : 'Word (.docx)'}</option>
          </select>
        </label>

        {format === 'pdf' && pdfAvailable && (
          <>
            <div className="selected-text-hint">
              {lang === 'ja'
                ? `組み方向：${orientation === 'vertical' ? '縦書き' : orientation === 'horizontal' ? '横書き' : '自動判定'}（認識時の設定を使用）`
                : `Writing mode: ${orientation} (set before recognition)`}
            </div>
          </>
        )}

        {format === 'pdf' && !pdfAvailable && (
          <div className="selected-text-hint">
            {lang === 'ja'
              ? '履歴からはテキストのみ利用できます。PDFの書き出しには画像が必要です（テキスト・ePub・Wordは書き出せます）。'
              : 'Only text is available from history. PDF export requires images (Text, ePub and Word are available).'}
          </div>
        )}

        {/* テキスト出力時のオプション */}
        {isText && (
          <>
            <label className="result-actions-option">
              <input type="checkbox" checked={includeFileName} onChange={(e) => setIncludeFileName(e.target.checked)} />
              {lang === 'ja' ? 'ファイル名を記載する' : 'Include file name'}
            </label>
            <label className="result-actions-option">
              <input type="checkbox" checked={ignoreNewlines} onChange={(e) => setIgnoreNewlines(e.target.checked)} />
              {lang === 'ja' ? '改行を無視する' : 'Ignore newlines'}
            </label>
            {results.length > 1 && (
              <label className="result-actions-option">
                <input type="checkbox" checked={txtCurrentOnly} onChange={(e) => setTxtCurrentOnly(e.target.checked)} />
                {lang === 'ja' ? '現在のページのみ' : 'Current page only'}
              </label>
            )}
          </>
        )}

        {format === 'docx' && (
          <>
            <label className="result-actions-option">
              {lang === 'ja' ? '見出しフォント：' : 'Heading font: '}
              <select value={docxHeadingFont} onChange={(e) => setDocxHeadingFont(e.target.value)}>
                {FONT_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </label>
            <label className="result-actions-option">
              {lang === 'ja' ? '本文フォント：' : 'Body font: '}
              <select value={docxBodyFont} onChange={(e) => setDocxBodyFont(e.target.value)}>
                {FONT_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </label>
            <div className="selected-text-hint">
              {lang === 'ja'
                ? '※「標準」はどの環境でも崩れません。フォント名を選ぶと、その書体が無い環境では自動で代替されます。'
                : 'Standard is safe everywhere. Named fonts are substituted where unavailable.'}
            </div>
          </>
        )}

        <button className="btn btn-derivative" onClick={handleExport} disabled={results.length === 0 || exporting || (format === 'pdf' && !pdfAvailable)}>
          {exporting
            ? (lang === 'ja' ? '作成中…' : 'Creating…')
            : (lang === 'ja' ? '書き出す' : 'Export')}
        </button>
      </div>
    </div>
  )
}
