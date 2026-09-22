# 部署紀錄

日期：2026-09-22

- 公開網站：https://c04u41125.github.io/kai981-km-bot/
- 儲存庫：https://github.com/c04u41125/kai981-km-bot
- 首次發布工作流程：https://github.com/c04u41125/kai981-km-bot/actions/runs/35730196792
- 發布結果：Success；已實際開啟網站，確認品牌首頁與「後端尚未設定」狀態。
- 發布來源：main 分支，GitHub Actions，僅上傳 public 目錄。
- 自動化測試：依使用者要求未執行。

## 尚未完成

Cloudflare 未登入，因此尚未建立 D1、發布 Worker 或設定 LINE Secrets。LINE Channel 與官方帳號連結也尚未設定。前端公開發布成功不代表 LINE Bot 已可使用。

完成 Cloudflare 登入後，部署 Worker／D1，將 Worker 的 PUBLIC_ORIGIN 設為 https://c04u41125.github.io，再將 Worker 公開網址填入 GitHub Actions variable API_BASE_URL 並重新執行 Pages 部署。

LINE 憑證僅放入 Cloudflare Worker Secrets，不可上傳 GitHub 或貼到對話。未設定 ADMIN_LINE_USER_IDS 前，所有管理命令預設拒絕。
