import { useState } from 'react'
import type { OCRResult, ProcessedImage } from '../../types/ocr'
import { downloadText, copyToClipboard } from '../../utils/textExport'
import { buildSearchablePdf, downloadPdf, type ExportPage, type Orientation } from '../../utils/exporters/pdfExport'
import { buildEpub, downloadBlob } from '../../utils/exporters/epubExport'
import { buildDocx } from '../../utils/exporters/docxExport'

type ExportFormat = 'txt' | 'pdf' | 'epub' | 'docx'

interface ResultActionsProps {
  results: OCRResult[]
  currentResult: OCRResult | null
  processedImages: ProcessedImage[]
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

export function ResultActions({ results, currentResult, processedImages, lang }: ResultActionsProps) {
  const [copied, setCopied] = useState(false)
  const [includeFileName, setIncludeFileName] = useState(false)
  const [ignoreNewlines, setIgnoreNewlines] = useState(false)
  const [orientation, setOrientation] = useState<Orientation>('auto')
  const [format, setFormat] = useState<ExportFormat>('pdf')
  const [txtCurrentOnly, setTxtCurrentOnly] = useState(false)
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
    setExporting(true)
    try {
      const n = Math.min(results.length, processedImages.length)

      if (format === 'txt') {
        if (txtCurrentOnly && currentResult) {
          downloadText(buildText(currentResult), currentResult.fileName)
        } else {
          downloadText(results.map((r) => buildText(r)).join('\n\n'), baseName)
        }
      } else if (format === 'pdf') {
        const pages: ExportPage[] = []
        for (let i = 0; i < n; i++) {
          const img = processedImages[i].imageData
          const blocks = [...results[i].textBlocks].sort((a, b) => a.readingOrder - b.readingOrder)
          pages.push({ pngBytes: await imageDataToPngBytes(img), width: img.width, height: img.height, blocks })
        }
        const bytes = await buildSearchablePdf(pages, { orientation })
        downloadPdf(bytes, baseName)
      } else if (format === 'epub') {
        const pages = results.slice(0, n).map((r, i) => ({ fileName: r.fileName, pageLabel: pageLabel(i), blocks: r.textBlocks }))
        downloadBlob(await buildEpub(pages, { title: baseName }), `${baseName}.epub`)
      } else {
        const pages = results.slice(0, n).map((r, i) => ({ fileName: r.fileName, pageLabel: pageLabel(i), blocks: r.textBlocks }))
        downloadBlob(await buildDocx(pages, { title: baseName }), `${baseName}.docx`)
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
        <button className="btn btn-primary" onClick={handleCopy} disabled={!currentResult}>
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
            <option value="pdf">{lang === 'ja' ? '透明テキスト付きPDF（検索・読み上げ・レイアウト保持）' : 'Searchable PDF'}</option>
            <option value="epub">{lang === 'ja' ? 'ePub（読み上げ向け・リフロー）' : 'ePub'}</option>
            <option value="docx">{lang === 'ja' ? '見出し付きWord（.docx）' : 'Word (.docx)'}</option>
          </select>
        </label>

        {format === 'pdf' && (
          <label className="result-actions-option">
            {lang === 'ja' ? '組み方向：' : 'Writing mode: '}
            <select value={orientation} onChange={(e) => setOrientation(e.target.value as Orientation)}>
              <option value="auto">{lang === 'ja' ? '自動判定' : 'Auto'}</option>
              <option value="vertical">{lang === 'ja' ? '縦書き' : 'Vertical'}</option>
              <option value="horizontal">{lang === 'ja' ? '横書き' : 'Horizontal'}</option>
            </select>
          </label>
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

        <button className="btn btn-primary" onClick={handleExport} disabled={results.length === 0 || exporting}>
          {exporting
            ? (lang === 'ja' ? '作成中…' : 'Creating…')
            : (lang === 'ja' ? '書き出す' : 'Export')}
        </button>
      </div>
    </div>
  )
}
