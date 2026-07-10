import { useRef, useState } from 'react'
import type { Language } from '../i18n'
import { DirectoryPicker } from './upload/DirectoryPicker'
import {
  IconLogo,
  IconDoc,
  IconScan,
  IconExport,
} from './Icons'
import { Footer } from './layout/Footer'

// iPad/iPhone判定（iPadOS 13+のSafariはUAが「Macintosh」を名乗るためタッチ点数で判別）。
// iOS 17以前のWebKitはWASMメモリ予約のバグがあり（iOS 18で修正済み）、
// 該当端末にだけ使い方の注意書きを表示する
const isIOS =
  /iPhone|iPad/.test(navigator.userAgent) ||
  (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)

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

        {/* iPad/iPhone利用者向けの注意書き（iOS 17以前のWebKitバグへの案内。該当端末にのみ表示） */}
        {isIOS && (
          <p className="lens-ios-note">
            {ja
              ? 'iPad・iPhoneでお使いの場合：iPadOS/iOS 18以降を推奨します。動作が不安定なときは、このタブを閉じて新しいタブで開き直してください（再読み込みでは改善しません）。'
              : 'On iPad / iPhone: iPadOS/iOS 18 or later is recommended. If the app becomes unstable, close this tab and reopen the page in a new tab (reloading does not help).'}
          </p>
        )}
      </div>

      <Footer lang={lang} />
    </div>
  )
}
