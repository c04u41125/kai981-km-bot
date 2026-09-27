# 部署紀錄

日期：2026-09-22

- 官網：https://c04u41125.github.io/KAI-981/
- Bot 專案頁：https://c04u41125.github.io/kai981-km-bot/
- 儲存庫：https://github.com/c04u41125/kai981-km-bot
- 首次發布工作流程：https://github.com/c04u41125/kai981-km-bot/actions/runs/35730196792
- 發布結果：Success；已實際開啟網站，確認品牌首頁與「後端尚未設定」狀態。
- 發布來源：main 分支，GitHub Actions，僅上傳 public 目錄。
- 自動化測試：依使用者要求未執行。

## 尚未完成

Worker 與 D1 已部署，兩份 migration 均已套用。LINE Secrets、Channel 與官方帳號連結尚未設定，LINE Bot 尚不可使用。

- Worker：https://kai981-km-bot.kai981-km-bot.workers.dev
- Webhook：https://kai981-km-bot.kai981-km-bot.workers.dev/webhook
- D1：kai981-km（APAC）
- Worker 版本：f49161f2-913e-4893-81e2-39bcad688f6a
- PUBLIC_ORIGIN：https://c04u41125.github.io
- GitHub Actions variable API_BASE_URL 已填入 Worker 公開網址。

LINE 憑證僅放入 Cloudflare Worker Secrets，不可上傳 GitHub 或貼到對話。未設定 ADMIN_LINE_USER_IDS 前，所有管理命令預設拒絕。

## 2026-09-27 更新

- Worker 新版本：31928625-8b4b-4e50-9fac-5266094625c4。
- 遠端 D1 migration 0003_product_monitor.sql 套用成功。
- 已部署每 5 分鐘 Funbox 分類監測排程；首次建基準，不發舊商品。
- LINE 官方帳號 @507hpqoe / Channel 2011703455 已建立，Webhook 網址已儲存，允許群組邀請已啟用，自動回應已關閉。
- LINE Secrets 仍未設定；Use webhook 與 Verify 待憑證完成後處理。尚未有群組訂閱或實際推播驗收。
- 新增 MONITOR.md、src/monitor.js、migration；修改 worker.js、wrangler.toml、public/index.html、public/app.js、README.md 與本紀錄。
- 未執行自動化測試。
