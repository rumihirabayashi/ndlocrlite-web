interface FooterProps {
  lang: 'ja' | 'en'
  githubUrl?: string
}

export function Footer({ lang, githubUrl = 'https://github.com/yuta1984/ndlocrlite-web' }: FooterProps) {
  return (
    <footer className="footer">
      <div className="footer-privacy">
        <span className="privacy-icon">🔒</span>
        {lang === 'ja' ? (
          <span>
            このシステムは{' '}
            <a href="https://www.npmjs.com/package/onnxruntime-web" target="_blank" rel="noopener noreferrer">
              ONNX Web Runtime
            </a>{' '}
            技術を使用しており、Webブラウザで完結して動作します。選択した画像とOCR結果はあなたのPCの外部には送信されません。
          </span>
        ) : (
          <span>
            This system uses{' '}
            <a href="https://www.npmjs.com/package/onnxruntime-web" target="_blank" rel="noopener noreferrer">
              ONNX Web Runtime
            </a>{' '}
            and runs entirely in your browser. Selected images and OCR results are never sent to any external server.
          </span>
        )}
      </div>
      <div className="footer-derivative">
        {lang === 'ja' ? (
          <span className="footer-attribution-text">
            本ツールは{' '}
            <a href="https://github.com/yuta1984/ndlocrlite-web" target="_blank" rel="noopener noreferrer">
              NDLOCR-Lite Web
            </a>
            （橋本雄太氏・{' '}
            <a href="https://creativecommons.org/licenses/by/4.0/deed.ja" target="_blank" rel="noopener noreferrer">
              CC BY 4.0
            </a>
            ）を{' '}
            <a href="https://rumihirabayashi.com/" target="_blank" rel="noopener noreferrer" className="link-derivative">
              平林ルミ
            </a>
            が改変したものです。追加機能：透明テキスト付きPDF・ePub・見出し付きWordの書き出し、認識結果の校正編集、作業の一時保存。
          </span>
        ) : (
          <span className="footer-attribution-text">
            A modified version of{' '}
            <a href="https://github.com/yuta1984/ndlocrlite-web" target="_blank" rel="noopener noreferrer">
              NDLOCR-Lite Web
            </a>
            {' '}(by Yuta Hashimoto,{' '}
            <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">
              CC BY 4.0
            </a>
            ) modified by{' '}
            <a href="https://rumihirabayashi.com/" target="_blank" rel="noopener noreferrer" className="link-derivative">
              Rumi Hirabayashi
            </a>
            . Added: searchable PDF / ePub / Word export, on-screen proofreading, and autosave.
          </span>
        )}
      </div>
      <div className="footer-attribution">
        {lang === 'ja' ? (
          <span className="footer-attribution-text">
            OCRエンジンには、国立国会図書館（NDL Lab）が開発した{' '}
            <a href="https://github.com/ndl-lab/ndlocr-lite" target="_blank" rel="noopener noreferrer">
              NDLOCR-Lite
            </a>{' '}
            のモデルを使用しています。
          </span>
        ) : (
          <span className="footer-attribution-text">
            The OCR engine uses models from{' '}
            <a href="https://github.com/ndl-lab/ndlocr-lite" target="_blank" rel="noopener noreferrer">
              NDLOCR-Lite
            </a>
            , developed by the National Diet Library of Japan (NDL Lab).
          </span>
        )}
      </div>
      <div className="footer-meta">
        <span className="footer-author">
          {lang === 'ja' ? (
            <>
              原作（NDLOCR-Lite Web）作成者:{' '}
              <a href="https://x.com/yuta1984" target="_blank" rel="noopener noreferrer">
                橋本雄太
              </a>
              （国立歴史民俗博物館、国立国会図書館 非常勤調査員）
            </>
          ) : (
            <>
              Original (NDLOCR-Lite Web) by{' '}
              <a href="https://x.com/yuta1984" target="_blank" rel="noopener noreferrer">
                Yuta Hashimoto
              </a>
              {' '}(National Museum of Japanese History / NDL)
            </>
          )}
        </span>
        <a
          href={githubUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="footer-github"
        >
          {lang === 'ja' ? '原作のGitHubリポジトリ' : 'Original GitHub Repository'} ↗
        </a>
      </div>
    </footer>
  )
}
