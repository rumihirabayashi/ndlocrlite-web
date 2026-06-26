interface FooterProps {
  lang: 'ja' | 'en'
  githubUrl?: string
}

export function Footer({ lang, githubUrl = 'https://github.com/yuta1984/ndlocrlite-web' }: FooterProps) {
  return (
    <footer className="footer">
      {lang === 'ja' ? (
        <>
          <p className="footer-attribution">
            スキャンした資料や写真を、縦書きにも強い日本語OCRで読み取り、検索・コピー・読み上げができる
            <strong>透明テキスト付きPDF</strong>・ePub・見出し付きWordに書き出せます。
          </p>
          <p className="footer-attribution footer-attribution-text">
            本ツールは{' '}
            <a href={githubUrl} target="_blank" rel="noopener noreferrer">
              NDLOCR-Lite Web
            </a>
            （橋本雄太氏・国立歴史民俗博物館、国立国会図書館 非常勤調査員・
            <a href="https://creativecommons.org/licenses/by/4.0/deed.ja" target="_blank" rel="noopener noreferrer">
              CC BY 4.0
            </a>
            ）を改変したものです。
          </p>
          <p className="footer-attribution footer-attribution-text">
            OCRエンジンには、国立国会図書館（NDL Lab）が開発した{' '}
            <a href="https://github.com/ndl-lab/ndlocr-lite" target="_blank" rel="noopener noreferrer">
              NDLOCR-Lite
            </a>
            {' '}のモデルを使用しています。
          </p>
          <div className="footer-privacy">
            <span className="privacy-icon">🔒</span>
            <span>
              ※このシステムは{' '}
              <a href="https://www.npmjs.com/package/onnxruntime-web" target="_blank" rel="noopener noreferrer">
                ONNX Web Runtime
              </a>{' '}
              技術を使用しており、Webブラウザで完結して動作します。選択した画像とOCR結果はあなたのPCの外部には送信されません。
            </span>
          </div>
          <div className="footer-meta">
            <span className="footer-author">
              改変者：
              <a href="https://rumihirabayashi.com/" target="_blank" rel="noopener noreferrer" className="link-derivative">
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
            </span>
            <a href={githubUrl} target="_blank" rel="noopener noreferrer" className="footer-github">
              原作のGitHubリポジトリ ↗
            </a>
          </div>
        </>
      ) : (
        <>
          <p className="footer-attribution">
            Recognize scanned documents and photos with a Japanese OCR that handles vertical text,
            and export them as searchable <strong>PDF with hidden text</strong>, ePub, or Word with
            headings.
          </p>
          <p className="footer-attribution footer-attribution-text">
            This tool is a modified version of{' '}
            <a href={githubUrl} target="_blank" rel="noopener noreferrer">
              NDLOCR-Lite Web
            </a>
            {' '}(by Yuta Hashimoto — National Museum of Japanese History; part-time researcher,
            National Diet Library —{' '}
            <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">
              CC BY 4.0
            </a>
            ).
          </p>
          <p className="footer-attribution footer-attribution-text">
            The OCR engine uses models from{' '}
            <a href="https://github.com/ndl-lab/ndlocr-lite" target="_blank" rel="noopener noreferrer">
              NDLOCR-Lite
            </a>
            , developed by the National Diet Library of Japan (NDL Lab).
          </p>
          <div className="footer-privacy">
            <span className="privacy-icon">🔒</span>
            <span>
              ※ It runs entirely in your web browser using{' '}
              <a href="https://www.npmjs.com/package/onnxruntime-web" target="_blank" rel="noopener noreferrer">
                ONNX Web Runtime
              </a>
              . The images you select and the OCR results are never sent outside your computer.
            </span>
          </div>
          <div className="footer-meta">
            <span className="footer-author">
              Modified by{' '}
              <a href="https://rumihirabayashi.com/" target="_blank" rel="noopener noreferrer" className="link-derivative">
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
            </span>
            <a href={githubUrl} target="_blank" rel="noopener noreferrer" className="footer-github">
              Original GitHub repository ↗
            </a>
          </div>
        </>
      )}
    </footer>
  )
}
