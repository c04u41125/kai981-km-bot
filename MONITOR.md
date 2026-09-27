# Funbox 新品群組推播

來源：https://shop.funbox.com.tw/categories/XI/KB 。使用該頁自身的公開 JSON 分類介面，每 5 分鐘由 Cloudflare Worker Cron 檢查，不依賴電腦或 Codex 自動化。這是輪詢，不能保證秒級即時；來源快取、排程、網路、LINE 配額及待送量可能延遲通知。

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

## 可靠性與限制

- 每次完整掃描最多 20 頁，每頁 18 件。格式變更、空清單、重複分頁、HTTP 失敗或超過頁數上限時保留舊基準並記錄錯誤；超出範圍需調整程式。來源可能於翻頁期間變動，無法保證捕捉兩次掃描間短暫出現的商品。
- 首次基準、商品與通知在 D1 batch transaction 寫入。商品 ID 與群組／商品唯一限制去重。排程使用租約避免重疊。
- D1 outbox 每次最多發送 5 件，以 LINE `X-Line-Retry-Key` 重試同一通知。網路錯誤、429、5xx 下次重試；401/403 需修正憑證或配額。400/404 記為失敗。首次嘗試 23 小時後停止自動重試，避免超過 LINE 24 小時去重期限而重送。
- sent 表示 LINE API 接受，不保證收件者收到；失敗不自動補發。管理員可用 `/monitor status` 查看待送及失敗數。不要刪除已發現商品或通知去重紀錄來重試。
- 網站顯示最後成功時間，超過 15 分鐘提示延遲。程式不另外對掃描錯誤發送 LINE 告警，請查看狀態。
- Push 受 LINE 方案訊息額度限制，本專案不會自動購買／升級方案。

手動驗收尚未執行：非管理員訂閱應拒絕、群組 on/off、首次無舊品通知、新 ID 只發一次、429 使用相同 retry key 重試、off 取消待送。依使用者要求未執行自動化測試。

參考：[LINE Push API](https://developers.line.biz/en/reference/messaging-api/#send-push-message)、[LINE 重試](https://developers.line.biz/en/docs/messaging-api/retrying-api-request/)、[Cloudflare Cron](https://developers.cloudflare.com/workers/configuration/cron-triggers/)。
