# Cloudflare 移行メモ（2026-06-27 / 下ごしらえ）

2アプリ（ピタッとレンズ＝ndlocrlite-web ／ とんとんリーダー＝pdf-aloud）の
Cloudflare移行に向けた現状整理と、認証後にそのまま実行できる手順。

## 結論サマリ
- **とんとんリーダー**：Cloudflare Pages に**そのまま移行可能**（`_headers`=noindex、`_redirects`=SPA を準備済み）。
- **ピタッとレンズ**：⚠️ モデル（deim 38MB / parseq 35〜41MB）が **Cloudflare Pages の「1ファイル25MiB上限」を超える**ため、Pagesに**直接は載らない**。
  - 公式の回避策＝**大きいファイルは R2（オブジェクトストレージ）に置く**。
  - R2は**転送量無料**なので、Netlify課金の主因だった帯域コストが実質ゼロになる（むしろ好機）。
  - コードは既に `VITE_MODEL_BASE_URL`（.env）でモデルの配信元を切替可能 → R2へはこの値を変えるだけ。
  - 注意：COEP `require-corp` のため、R2側に **CORS** ＋ **`Cross-Origin-Resource-Policy: cross-origin`** ヘッダが必要（過去にR2のCORSで詰まった経緯あり。今回は自分のバケットなので設定可能）。

## 構成の選択肢
| 案 | 構成 | 手間 | 帯域コスト |
|----|------|------|-----------|
| A | 全部Netlify（Personal $9） | 最小（今のまま） | 帯域が主コスト |
| B（推奨） | アプリ本体はNetlify継続＋**モデルだけR2** | 中 | ほぼ0（R2 egress無料） |
| C | ピタッとレンズもCloudflare Pages＋モデルR2 | 大 | ほぼ0 |

→ まず **Personal $9 で運用継続**（即・正式URL）。帯域が伸びたら **案B（モデルをR2へ）** に移すのが低リスク。

## デプロイ手順（Cloudflareアカウント認証後にそのまま実行）

### とんとんリーダー（すぐ実行可）
1. cloudflare.com で無料アカウント作成
2. `cd /Users/Rumi/tools/pdf-aloud && npm run build`
3. `npx wrangler login`（ブラウザ認証）
4. `npx wrangler pages deploy dist --project-name=tonton-reader`
   → 仮URL：`https://tonton-reader.pages.dev`（noindex維持）

### ピタッとレンズ（モデルのR2化が前提）
1. R2バケット作成（例 `pitatto-lens-models`）→ `public/models/` の4ファイルをアップロード
2. 公開設定（Public Bucket もしくはカスタムドメイン）
3. **CORS** と **`Cross-Origin-Resource-Policy: cross-origin`** を付与（R2のCORS設定＋Transform Rules か 前段Worker）
4. `.env` の `VITE_MODEL_BASE_URL` を R2のURLに変更 → `npm run build`
5. アプリ本体は **Netlify継続** か `npx wrangler pages deploy dist --project-name=pitatto-lens`

## 共通の注意
- `_headers` の `X-Robots-Tag: noindex` は移行後も有効（テスト公開の非公開性は維持）。
- 相互リンクのURL（コードに直書き）は、移行で確定したURLに合わせて更新→再ビルドが必要。
- **正式公開時は独自サブドメイン**（例 `lens.rumihirabayashi.com` / `reader.rumihirabayashi.com`）を当てる。URLが固定でき、ホスティングを替えても共有先が変わらない。

## 私（Claude）が今できないこと＝要・本人操作
- Cloudflareアカウント作成・`wrangler login`（ブラウザ認証）
- R2バケット作成・公開・CORS/CORPヘッダ設定
- Netlify Personalの課金操作
→ これらが済めば、ビルド〜`wrangler pages deploy` は私が実行できます。
