import { IconSpeaker, IconExternal, IconGithub } from '../Icons'

interface FooterProps {
  lang: 'ja' | 'en'
}

export function Footer({ lang }: FooterProps) {
  const ja = lang === 'ja'
  return (
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
                <a href="https://github.com/yuta1984/ndlocrlite-web" target="_blank" rel="noopener noreferrer">
                  NDLOCR-Lite Web
                </a>
                （橋本雄太氏・国立歴史民俗博物館、国立国会図書館 非常勤調査員・
                <a href="https://creativecommons.org/licenses/by/4.0/deed.ja" target="_blank" rel="noopener noreferrer">
                  CC BY 4.0
                </a>
                ）を改変したものです。
              </p>
              <p>
                OCRエンジンには、国立国会図書館（NDL Lab）が開発した{' '}
                <a href="https://github.com/ndl-lab/ndlocr-lite" target="_blank" rel="noopener noreferrer">
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
                <a href="https://www.p.u-tokyo.ac.jp/cbfe/" target="_blank" rel="noopener noreferrer">
                  東京大学バリアフリー教育開発研究センター
                </a>
                {' '}特任助教）
              </p>
              <p className="lens-credit-date">公開日：2026/06/28</p>
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
                <a href="https://github.com/yuta1984/ndlocrlite-web" target="_blank" rel="noopener noreferrer">
                  NDLOCR-Lite Web
                </a>
                {' '}(by Yuta Hashimoto — National Museum of Japanese History; part-time
                researcher, National Diet Library —{' '}
                <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">
                  CC BY 4.0
                </a>
                ).
              </p>
              <p>
                The OCR engine uses models from{' '}
                <a href="https://github.com/ndl-lab/ndlocr-lite" target="_blank" rel="noopener noreferrer">
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
                <a href="https://www.p.u-tokyo.ac.jp/cbfe/" target="_blank" rel="noopener noreferrer">
                  Center for Barrier-Free Education, the University of Tokyo
                </a>
                )
              </p>
              <p className="lens-credit-date">Released: 2026/06/28</p>
            </>
          )}
        </div>
        <div className="lens-credit-badges">
          <a
            className="lens-reader-badge"
            href="https://tonton-reader.netlify.app"
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
  )
}
