import { useRef, useState } from 'react'
import type { Language } from '../i18n'
import { DirectoryPicker } from './upload/DirectoryPicker'
import {
  IconLogo,
  IconDoc,
  IconScan,
  IconExport,
  IconSpeaker,
  IconExternal,
  IconGithub,
} from './Icons'

interface WelcomeScreenProps {
  lang: Language
  onFilesSelected: (files: File[]) => void
  onToggleLanguage: () => void
  onOpenSettings: () => void
  onOpenHistory: () => void
  onPaste: () => void
  onSampleLoad: () => void
  disabled?: boolean
}

const ACCEPT =
  'image/jpeg,image/png,image/tiff,image/heic,image/heif,.tif,.tiff,.heic,.heif,application/pdf'

function acceptFiles(files: FileList | null): File[] {
  if (!files) return []
  return Array.from(files).filter((f) => {
    if (f.type === 'application/pdf' || f.type.startsWith('image/')) return true
    const ext = f.name.toLowerCase().split('.').pop()
    return ['tif', 'tiff', 'heic', 'heif'].includes(ext ?? '')
  })
}

export function WelcomeScreen({
  lang,
  onFilesSelected,
  onToggleLanguage,
  onOpenSettings,
  onOpenHistory,
  onPaste,
  onSampleLoad,
  disabled = false,
}: WelcomeScreenProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const ja = lang === 'ja'

  const pick = (files: FileList | null) => {
    if (disabled) return
    const accepted = acceptFiles(files)
    if (accepted.length > 0) onFilesSelected(accepted)
  }

  const hiddenInput = (
    <input
      ref={inputRef}
      type="file"
      multiple
      accept={ACCEPT}
      onChange={(e) => pick(e.target.files)}
      hidden
    />
  )

  return (
    <div className="lens-welcome">
      {/* ===== ブランドヒーロー ===== */}
      <header className="lens-head">
        <span className="lens-logo">
          <IconLogo />
        </span>
        <div className="lens-brand-text">
          <span className="lens-brand-name">{ja ? 'ピタッとレンズ' : 'Pitatto Lens'}</span>
          <div className="lens-brand-lines">
            <span className="lens-brand-catch">
              {ja
                ? '縦書きも、ピタッと読み取って透明テキストPDFに'
                : 'Vertical text, snapped into a searchable PDF'}
            </span>
            <span className="lens-brand-sub">
              {ja
                ? 'PDF読み上げ用OCR（NDLOCR-Lite Web 改変版）'
                : 'Read-Aloud OCR (Modified NDLOCR-Lite Web)'}
            </span>
          </div>
        </div>
        <div className="lens-actions">
          <button
            className="lens-btn-lang"
            onClick={onToggleLanguage}
            aria-label="language"
          >
            {ja ? 'English' : '日本語'}
          </button>
          <button
            className="lens-btn-icon"
            onClick={onOpenHistory}
            title={ja ? '処理履歴' : 'History'}
          >
            📋
          </button>
          <button
            className="lens-btn-icon"
            onClick={onOpenSettings}
            title={ja ? '設定' : 'Settings'}
          >
            ⚙️
          </button>
          <label className="lens-btn-open">
            {ja ? '画像／PDFを開く' : 'Open Image / PDF'}
            {hiddenInput}
          </label>
        </div>
      </header>

      {/* ===== メイン ===== */}
      <div className="lens-main">
        <label
          className={`lens-drop-card${dragOver ? ' over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            if (!disabled) setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            pick(e.dataTransfer.files)
          }}
        >
          <div className="lens-drop-icon">
            <IconDoc />
          </div>
          <div className="lens-drop-main">
            {ja ? '画像やPDFをひらく' : 'Open an image or PDF'}
          </div>
          <div className="lens-drop-sub">
            {ja
              ? 'クリック、または ここに ドラッグ＆ドロップ（JPG / PNG / TIFF / HEIC / PDF・Ctrl+V で貼り付け可）'
              : 'Click, or drag & drop here (JPG / PNG / TIFF / HEIC / PDF · Ctrl+V to paste)'}
          </div>
          {hiddenInput}
        </label>

        {/* 補助ボタン（フォルダ選択 / 貼り付け / サンプル） */}
        <div className="lens-sub-actions">
          <DirectoryPicker onFilesSelected={onFilesSelected} lang={lang} disabled={disabled} />
          <button className="btn btn-secondary" onClick={onPaste} disabled={disabled}>
            {ja ? 'クリップボードから貼り付け' : 'Paste from Clipboard'}
          </button>
          <button className="btn btn-secondary" onClick={onSampleLoad} disabled={disabled}>
            {ja ? 'サンプルを試す' : 'Try Sample'}
          </button>
        </div>

        {/* 3ステップ */}
        <div className="lens-steps" aria-hidden="true">
          <div className="lens-step">
            <div className="lens-step-ic">
              <IconDoc />
            </div>
            <div className="lens-step-label">{ja ? 'えらぶ' : 'Choose'}</div>
          </div>
          <div className="lens-step-arrow">→</div>
          <div className="lens-step">
            <div className="lens-step-ic">
              <IconScan />
            </div>
            <div className="lens-step-label">{ja ? 'よみとる' : 'Recognize'}</div>
          </div>
          <div className="lens-step-arrow">→</div>
          <div className="lens-step">
            <div className="lens-step-ic">
              <IconExport />
            </div>
            <div className="lens-step-label">{ja ? 'かきだす' : 'Export'}</div>
          </div>
        </div>
      </div>

      {/* ===== クレジットフッタ ===== */}
      <footer className="lens-credit">
        <div className="lens-credit-inner">
          <div className="lens-credit-text">
            {ja ? (
              <>
                <p>
                  スキャンした資料や写真を、縦書きにも強い日本語OCRで読み取り、検索・コピー・読み上げができる
                  <strong>透明テキスト付きPDF</strong>・ePub・見出し付きWordに書き出せます。
                </p>
                <p>
                  本ツールは{' '}
                  <a
                    href="https://github.com/yuta1984/ndlocrlite-web"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    NDLOCR-Lite Web
                  </a>
                  （橋本雄太氏・国立歴史民俗博物館、国立国会図書館 非常勤調査員・
                  <a
                    href="https://creativecommons.org/licenses/by/4.0/deed.ja"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    CC BY 4.0
                  </a>
                  ）を改変したものです。
                </p>
                <p>
                  OCRエンジンには、国立国会図書館（NDL Lab）が開発した{' '}
                  <a
                    href="https://github.com/ndl-lab/ndlocr-lite"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    NDLOCR-Lite
                  </a>
                  {' '}のモデルを使用しています。
                </p>
                <p>
                  ※このシステムは ONNX Web Runtime 技術を使用しており、Webブラウザで完結して動作します。選択した画像とOCR結果はあなたのPCの外部には送信されません。
                </p>
                <p className="lens-credit-author">
                  改変者：
                  <a href="https://rumihirabayashi.com" target="_blank" rel="noopener noreferrer">
                    平林ルミ
                  </a>
                  （
                  <a href="https://manabiplanet.com/" target="_blank" rel="noopener noreferrer">
                    学びプラネット合同会社
                  </a>
                  {' '}代表社員／
                  <a
                    href="https://www.p.u-tokyo.ac.jp/cbfe/"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    東京大学バリアフリー教育開発研究センター
                  </a>
                  {' '}特任助教）
                </p>
              </>
            ) : (
              <>
                <p>
                  Recognize scanned documents and photos with a Japanese OCR that handles vertical
                  text, and export them as searchable{' '}
                  <strong>PDF with hidden text</strong>, ePub, or Word with headings.
                </p>
                <p>
                  This tool is a modified version of{' '}
                  <a
                    href="https://github.com/yuta1984/ndlocrlite-web"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    NDLOCR-Lite Web
                  </a>
                  {' '}(by Yuta Hashimoto — National Museum of Japanese History; part-time
                  researcher, National Diet Library —{' '}
                  <a
                    href="https://creativecommons.org/licenses/by/4.0/"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    CC BY 4.0
                  </a>
                  ).
                </p>
                <p>
                  The OCR engine uses models from{' '}
                  <a
                    href="https://github.com/ndl-lab/ndlocr-lite"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    NDLOCR-Lite
                  </a>
                  , developed by the National Diet Library of Japan (NDL Lab).
                </p>
                <p>
                  ※ It runs entirely in your web browser using ONNX Web Runtime. The images you
                  select and the OCR results are never sent outside your computer.
                </p>
                <p className="lens-credit-author">
                  Modified by{' '}
                  <a href="https://rumihirabayashi.com" target="_blank" rel="noopener noreferrer">
                    Rumi Hirabayashi
                  </a>
                  {' '}(CEO,{' '}
                  <a href="https://manabiplanet.com/" target="_blank" rel="noopener noreferrer">
                    Manabi Planet LLC
                  </a>
                  {' '}/ Project Assistant Professor,{' '}
                  <a
                    href="https://www.p.u-tokyo.ac.jp/cbfe/"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Center for Barrier-Free Education, the University of Tokyo
                  </a>
                  )
                </p>
              </>
            )}
          </div>
          <div className="lens-credit-badges">
            <a
              className="lens-reader-badge"
              href="https://chimerical-torrone-ec5bf4.netlify.app"
              target="_blank"
              rel="noopener noreferrer"
            >
              <IconSpeaker className="lens-reader-badge-ic" />
              <span className="lens-reader-badge-text">
                <span className="lens-reader-badge-main">
                  {ja ? '読み上げるなら' : 'To read aloud'}
                </span>
                <span className="lens-reader-badge-sub">
                  {ja ? 'とんとんリーダー' : 'Tonton Reader'}
                </span>
              </span>
              <IconExternal className="lens-reader-badge-ext" />
            </a>
            <a
              className="lens-reader-badge lens-repo-badge"
              href="https://github.com/yuta1984/ndlocrlite-web"
              target="_blank"
              rel="noopener noreferrer"
            >
              <IconGithub className="lens-reader-badge-ic" />
              <span className="lens-reader-badge-text">
                <span className="lens-reader-badge-main">
                  {ja ? '原作リポジトリ' : 'Original repo'}
                </span>
                <span className="lens-reader-badge-sub">NDLOCR-Lite Web</span>
              </span>
              <IconExternal className="lens-reader-badge-ext" />
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}
