# GitHub Pages 部署

前端改以 GitHub Pages 發布，Worker 與 D1 程式一併保存在儲存庫。GitHub Pages 僅能提供靜態網頁，LINE Webhook、管理功能與報名仍需部署 Cloudflare Worker / D1。

## 設定

1. 將專案根目錄內容上傳到目標儲存庫的 `main` 分支；不可上傳 `node_modules/`、`.dev.vars`、`.wrangler/` 或任何真實憑證。
2. 儲存庫 Settings → Pages → Build and deployment → Source 選 **GitHub Actions**。
3. Settings → Secrets and variables → Actions → **Variables** 可設定公開變數：
   - `API_BASE_URL`：已部署的 Worker HTTPS origin，不加尾端斜線。
   - `LINE_ADD_FRIEND_URL`：官方帳號的公開加入好友連結，可留空。
4. 在 Actions 選 **Deploy GitHub Pages** → **Run workflow**；往後推送 `main` 會重新部署。此流程只發布網站，不執行自動化測試，也不建立 Cloudflare 資源。
5. Worker 的 `PUBLIC_ORIGIN` 應設為 `https://你的帳號.github.io`，不要包含儲存庫路徑。Pages 網址通常為 `https://你的帳號.github.io/儲存庫名稱/`。

尚未設定 `API_BASE_URL` 時，網站會明確顯示「後端尚未設定」，不連向訪客電腦的 localhost，也不假裝已能查詢或報名。填好變數後需重新執行部署流程。

LINE Channel Secret、Access Token、管理員白名單仍只設定於 Worker Secrets，不要放到 GitHub 公開 Variables 或前端程式。Cloudflare 設定步驟見 README。

`public/_headers` 是 Cloudflare Pages 的設定，GitHub Pages 不會套用；前端仍以 textContent 呈現資料，沒有瀏覽器端管理憑證或寫入介面。

官方依據：[GitHub Pages 自訂工作流程](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。
