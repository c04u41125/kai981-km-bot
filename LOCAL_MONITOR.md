# FUNBOX 本機備援（2026-11-17）

原 Worker 讀取持續 HTTP 403；間隔重試三次、調整標頭及改用店鋪轉址的公開分類 URL 後仍失敗。雲端瀏覽器可以讀取，但免費每日用量無法支撐全天每分鐘監控。這兩款商品沒有被去重忽略，也不是群組取消訂閱。

經使用者同意，已安裝 Windows 每分鐘備援，沿用 Worker、D1 和 LINE 通知，沒有升級方案。**這台電腦須開機、登入原 Windows 帳號且連網；鎖定螢幕可以，休眠、關機、登出會停止本機讀取。** 無法保證抓到兩次掃描之間短暫上架的商品。

## 本機操作

- 排程：`KAI981-Funbox-Monitor`，每分鐘、隱藏視窗、避免重疊。
- 程式：`%LOCALAPPDATA%\KAI981Monitor\monitor-local.ps1`，來自 `scripts/monitor-local.ps1`。
- 最新結果：同資料夾 `status.json`，不記錄憑證或簽章。
- 密鑰：同資料夾 `relay-secret.dpapi`，由 Windows DPAPI 綁定使用者加密；不可直接複製至另一台電腦。
- 對應 Worker Secret：`MONITOR_RELAY_SECRET`。本機沒有 LINE 憑證。

```powershell
Get-ScheduledTaskInfo -TaskName 'KAI981-Funbox-Monitor'
Get-Content "$env:LOCALAPPDATA\KAI981Monitor\status.json"
# 暫停／恢復
Disable-ScheduledTask -TaskName 'KAI981-Funbox-Monitor'
Enable-ScheduledTask -TaskName 'KAI981-Funbox-Monitor'
Start-ScheduledTask -TaskName 'KAI981-Funbox-Monitor'
```

更新程式時，將 `scripts/monitor-local.ps1` 以 UTF-8 BOM 寫入本機位置，以支援 Windows PowerShell 5.1。密鑰不提交 Git；換電腦需重新配對密鑰。已安裝的環境不用重設。

## 流程與安全

只讀公開分類，最多 20 頁、每頁 18 件。403／502／503／504 或網路錯誤最多三次間隔重試；429 不密集重試。完整清單才提交。

`POST /internal/monitor/snapshot` 先驗證原始 body 的 HMAC-SHA256 再解析；未設定 Secret 或簽章無效拒絕。限制 4 MB、正負兩分鐘時效、遞增來源時間戳、商品 ID、名稱長度、FUNBOX 商品連結、完整分頁及唯一商品 ID。舊快照不能覆蓋新快照。

本機與雲端共用 D1 租約、交易與通知去重。90 秒內有本機成功快照時，Cron 不重複抓取，仍處理待送通知。本機失聯會回到雲端直接讀取及有限額的瀏覽器備援；不代表雲端 403 已解決。

`/monitor status` 顯示讀取方式、台灣時間及超過三分鐘未更新警示。`/api/monitor` 提供 `health`、`stale`、`transport`、`last_local_success`、`last_cloud_error`；本機正常時，歷史雲端錯誤不是本機失敗。

部署順序：套用 `0019_monitor_browser.sql`、`0020_monitor_local_relay.sql`，設定 Worker Secret，部署，再安裝相同密鑰與本機排程。依使用者要求未執行自動化測試，以真實掃描、D1、LINE API 和 Windows 排程執行結果驗證。

首次完整掃描 7 件商品，新增 UX-10 `/products/bb93954` 及 CX-11 `/products/bb09877`，各兩個群組的通知均取得 LINE HTTP 200；表示 LINE 接受推播，不保證已讀或仍有庫存。
