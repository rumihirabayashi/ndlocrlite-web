/**
 * 表紙（ピタッとレンズ）用アイコン。
 * lucide-react は依存に無いため、lucide（MIT）のパスを参考にしたインラインSVGで実装。
 * 色は currentColor 継承（CSS側で緑を指定）、線は stroke ベース。
 */
type P = { className?: string }

const base = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

/** ロゴ：レンズ（スキャン枠＋虫めがね）の雰囲気 */
export function IconLogo({ className }: P) {
  return (
    <span
      className={className}
      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
    >
      {/* ScanText 風 */}
      <svg {...base}>
        <path d="M3 7V5a2 2 0 0 1 2-2h2" />
        <path d="M17 3h2a2 2 0 0 1 2 2v2" />
        <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
        <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
        <path d="M7 8h8" />
        <path d="M7 12h10" />
        <path d="M7 16h6" />
      </svg>
    </span>
  )
}

/** えらぶ（書類） — FileText 風 */
export const IconDoc = ({ className }: P) => (
  <svg {...base} className={className}>
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    <path d="M8 13h8" />
    <path d="M8 17h8" />
    <path d="M8 9h2" />
  </svg>
)

/** よみとる（スキャン-テキスト） — ScanText 風（ロゴと統一） */
export const IconScan = ({ className }: P) => (
  <svg {...base} className={className}>
    <path d="M3 7V5a2 2 0 0 1 2-2h2" />
    <path d="M17 3h2a2 2 0 0 1 2 2v2" />
    <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
    <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
    <path d="M7 8h8" />
    <path d="M7 12h10" />
    <path d="M7 16h6" />
  </svg>
)

/** かきだす（書き出し） — FileDown 風 */
export const IconExport = ({ className }: P) => (
  <svg {...base} className={className}>
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    <path d="M12 18v-6" />
    <path d="m9 15 3 3 3-3" />
  </svg>
)

/** 読み上げ（スピーカー） — Volume2 風（相互リンク用） */
export const IconSpeaker = ({ className }: P) => (
  <svg {...base} className={className}>
    <path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298Z" />
    <path d="M16 9a5 5 0 0 1 0 6" />
    <path d="M19.364 18.364a9 9 0 0 0 0-12.728" />
  </svg>
)

/** 外部リンク — ArrowUpRight 風 */
export const IconExternal = ({ className }: P) => (
  <svg {...base} className={className}>
    <path d="M7 7h10v10" />
    <path d="M7 17 17 7" />
  </svg>
)

/** GitHub マーク */
export const IconGithub = ({ className }: P) => (
  <svg {...base} className={className}>
    <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 .5 5 .5 5 .5c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 7.5c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
    <path d="M9 18c-4.51 2-5-2-7-2" />
  </svg>
)
