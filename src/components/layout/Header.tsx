import type { Language } from '../../i18n'

interface HeaderProps {
  lang: Language
  onToggleLanguage: () => void
  onOpenSettings: () => void
  onOpenHistory: () => void
  onLogoClick: () => void
}

export function Header({ lang, onToggleLanguage, onOpenSettings, onOpenHistory, onLogoClick }: HeaderProps) {
  return (
    <header className="header">
      <button className="header-title" onClick={onLogoClick}>
        <h1>{lang === 'ja' ? 'ピタッとレンズ' : 'Pitatto Lens'}</h1>
        <span className="header-subtitle">
          {lang === 'ja'
            ? 'PDF読み上げ用OCR（NDLOCR-Lite Web 改変版）'
            : 'Read-Aloud OCR (Modified NDLOCR-Lite Web)'}
        </span>
      </button>
      <div className="header-actions">
        <button className="btn-icon" onClick={onOpenHistory} title={lang === 'ja' ? '処理履歴' : 'History'}>
          📋
        </button>
        <button className="btn-icon" onClick={onOpenSettings} title={lang === 'ja' ? '設定' : 'Settings'}>
          ⚙️
        </button>
        <button className="btn-lang" onClick={onToggleLanguage}>
          {lang === 'ja' ? 'English' : '日本語'}
        </button>
      </div>
    </header>
  )
}
