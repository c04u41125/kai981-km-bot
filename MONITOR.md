# Funbox 新品與 M.M小舖補貨群組推播

## M.M小舖補貨監控（2026-10-09 新增）

來源：https://mmtoyshop.com/category/%F0%9F%8C%80%E6%88%B0%E9%AC%A5%E9%99%80%E8%9E%BA

每分鐘隨既有 Worker Cron 掃描整個分類（所有分頁，最多 20 頁／500 件）。讀取商品卡的實際按鈕文字，只有已記錄「補貨中」的商品改成可點擊「直接購買」或「加入購物車」才通知。首次掃描與首次發現的商品只建立基準；持續有貨不重複通知；再次觀測到補貨中，再恢復有貨時可再次通知。沒有出現在完整分類的商品設為未知，重新出現不推測為補貨。

沿用 monitor_subscriptions，已啟用的群組部署後自動納入。管理員在群組 @Bot 使用 `/monitor on`、`/monitor off` 同時控制兩家商品通知；`/monitor status` 會顯示兩家最近成功時間與來源錯誤。公開 `/api/monitor` 的 `mmtoy` 欄位不含群組或使用者 ID。

訊息格式：`M.M小舖補貨通知/商品名稱/價格/商品連結`，另附狀態變更說明。商品卡可購買不代表每個規格都有貨，也不保證通知送達時仍有庫存。輪詢間短暫補貨、商店快取、LINE 配額與待送量都可能造成漏報或延遲。

全頁成功且商品總數、分頁及唯一 ID 一致才以 D1 batch 提交狀態與通知。HTTP 失敗、無法辨識或矛盾按鈕、空清單與格式變更保留舊狀態並記錄錯誤；不把失敗當成缺貨。每次補貨週期使用獨立去重鍵，沿用 LINE retry key 與 outbox。Funbox 掃描失敗仍會嘗試 M.M小舖；M.M小舖讀取失敗不阻止既有待送訊息。

部署前先套用 `migrations/0008_mm_restock.sql`，再部署含 `src/mm-monitor.js` 的 Worker。無新增 Secret 或公開寫入 API。依使用者要求未執行自動化測試；上線後需確認 mmtoy.initialized、known_products 與 last_success，實際補貨推播仍需等待真實狀態變更驗收。

## Funbox 新品監控

來源：https://shop.funbox.com.tw/categories/XI/KB 。使用該頁自身的公開 JSON 分類介面，每分鐘由 Cloudflare Worker Cron 檢查，不依賴電腦或 Codex 自動化。這是高頻輪詢，不能保證秒級即時；來源快取、排程、網路、LINE 配額及待送量可能延遲通知。

「新品」代表分類首次發現的商品 ID，不等於確認的官方上架時間。首次完整掃描只建基準、不推播舊品。改名、補貨、下架後重新出現不重送。指定分類可能包含兌換商品，全部納入，不推測庫存、價格或可購買狀態。

## 部署與啟用

在專案目錄用 PowerShell：

```powershell
npx wrangler d1 migrations apply kai981-km --remote
npx wrangler deploy
```

Worker Secrets：`LINE_CHANNEL_SECRET`、`LINE_CHANNEL_ACCESS_TOKEN`、`ADMIN_LINE_USER_IDS`（逗號分隔）。實際值不要貼到對話或 GitHub。LINE Developers 的 Basic settings 可取得 Channel secret 與 Your user ID；Messaging API 分頁可取得已產生的長期 Access Token。將值自行填入 Cloudflare Worker Settings → Runtime variables and secrets，Type 選 Secret，再儲存／部署。

LINE 開啟 Use webhook、允許群組邀請，並確認 Webhook Verify 成功。將 `@507hpqoe` 加為好友後邀請至指定群組，由白名單管理員傳送：

```text
/monitor on
/monitor status
/monitor off
```

這三個指令只接受簽章有效、userId 在白名單的群組事件。目的地來自事件 groupId，不允許文字任意指定。未設定白名單預設拒絕；其他 `/admin` 指令仍限定私訊。訂閱不補發啟用前發現的商品；取消會取消待送，已在傳送中的訊息仍可能送達。D1 保存群組及管理員 ID，公開 `/api/monitor` 不公開這些 ID。

群組平常聊天不會被 Bot 處理、回覆或記錄；只有成員在訊息中明確 `@迴眾 KM Bot` 時，Bot 才會移除提及文字並處理剩餘內容。要啟用或查詢監測，也請在指令前先 @Bot。

## 可靠性與限制

- 每次完整掃描最多 20 頁，每頁 18 件。格式變更、空清單、重複分頁、HTTP 失敗或超過頁數上限時保留舊基準並記錄錯誤；超出範圍需調整程式。來源可能於翻頁期間變動，無法保證捕捉兩次掃描間短暫出現的商品。
- 首次基準、商品與通知在 D1 batch transaction 寫入。商品 ID 與群組／商品唯一限制去重。排程使用租約避免重疊。
- D1 outbox 每次最多發送 5 件，以 LINE `X-Line-Retry-Key` 重試同一通知。網路錯誤、429、5xx 下次重試；401/403 需修正憑證或配額。400/404 記為失敗。首次嘗試 23 小時後停止自動重試，避免超過 LINE 24 小時去重期限而重送。
- sent 表示 LINE API 接受，不保證收件者收到；失敗不自動補發。管理員可用 `/monitor status` 查看待送及失敗數。不要刪除已發現商品或通知去重紀錄來重試。
- 網站顯示最後成功時間，超過 15 分鐘提示延遲。程式不另外對掃描錯誤發送 LINE 告警，請查看狀態。
- Push 受 LINE 方案訊息額度限制，本專案不會自動購買／升級方案。

手動驗收尚未執行：非管理員訂閱應拒絕、群組 on/off、首次無舊品通知、新 ID 只發一次、429 使用相同 retry key 重試、off 取消待送。依使用者要求未執行自動化測試。

參考：[LINE Push API](https://developers.line.biz/en/reference/messaging-api/#send-push-message)、[LINE 重試](https://developers.line.biz/en/docs/messaging-api/retrying-api-request/)、[Cloudflare Cron](https://developers.cloudflare.com/workers/configuration/cron-triggers/)。

商店可能將缺貨按鈕改為自訂文字（例如 CX-17 的「驚不驚喜意不意外」）。這類保留 product-soldout 標記但文字不是「補貨中」的商品記為 unknown，不觸發補貨通知；不影響其他商品。mmtoy.unknown_products 可查看未知狀態筆數。
