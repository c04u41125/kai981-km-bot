# 迴眾 KM Bot · KAI 9.81

SAME GRAVITY DIFFERENT MOVES

第一階段可串接 LINE 的團隊知識與活動報名專案。前端為 Cloudflare Pages 靜態網站，後端為 Cloudflare Worker，資料存於 Cloudflare D1。不使用生成式 AI。

本次檢查的原始工作目錄只有空的 `outputs/`、`work/`，沒有 `AGENTS.md`、README 或既有 `kai981-km-bot/index.html`。因此本版依已提供的品牌文字新建米白、墨黑、萊姆綠介面，並非對不存在的原型進行視覺還原。前端入口為 `public/index.html`。

**目前狀態：已安裝套件並產生 package-lock.json；依最新需求加入 GitHub Pages 部署工作流程，已建立 GitHub 儲存庫 c04u41125/kai981-km-bot，正在設定發布。尚未部署，未建立任何雲端資源、未執行自動化測試、未與真實 LINE Channel 連線驗證。**

前端部署 GitHub Pages 請先看 [GITHUB_DEPLOY.md](GITHUB_DEPLOY.md)。下方 Cloudflare 說明仍適用於 Worker 與 D1；前端的 Cloudflare Pages 發布步驟可略過。

## 專案檔案

```text
kai981-km-bot/
├─ src/worker.js                    # Webhook、簽章、查詢、報名、白名單管理
├─ migrations/0001_schema.sql       # 資料表、唯一限制、索引
├─ migrations/0002_confirmed_knowledge.sql # 四筆已確認知識
├─ public/index.html                # Pages 首頁
├─ public/styles.css                # 品牌視覺與手機版
├─ public/app.js                    # 唯讀 API 串接
├─ public/config.js                 # 公開 URL 設定
├─ public/_headers                  # Pages 安全標頭
├─ .dev.vars.example                # 本機秘密設定範本
├─ .gitignore
├─ package.json
├─ wrangler.toml
├─ pages/wrangler.toml              # Pages 獨立設定，避免誤用 Worker main
├─ MANUAL_CHECKLIST.md              # 手動驗收步驟（未執行）
└─ README.md
```

## 1. Windows PowerShell 本機啟動

先安裝目前受 Wrangler 支援的 Node.js LTS（建議 Node.js 22 或更新的 LTS）及 npm。以下指令皆在**本專案根目錄**執行，不是上層工作目錄。

```powershell
git clone https://github.com/c04u41125/kai981-km-bot.git
Set-Location kai981-km-bot
npm install
Copy-Item .dev.vars.example .dev.vars
notepad .dev.vars
npm run db:local
npm run dev
```

`npm install` 會建立 `package-lock.json`；請保留並提交鎖檔，以固定之後安裝的版本。上述指令由你自行執行；本次交付沒有執行。

Worker 預設位於 `http://localhost:8787`。範本中的秘密值為佔位文字；未填真實 LINE 憑證時仍可使用本機知識與活動唯讀 API，但不能完成真實 LINE 訊息驗證／回覆。`.dev.vars` 不會上傳成正式 Secrets，也不可提交 Git。

在**第二個 PowerShell 視窗**切換到同一專案目錄：

```powershell
npm run dev:web
```

開啟 `http://localhost:8788`。前端 `public/config.js` 預設指向本機 Worker；Worker `PUBLIC_ORIGIN` 預設允許 `http://localhost:8788`。請一致使用 `localhost`，不要混用 `127.0.0.1`。本機 D1 與遠端 D1 完全分開，初始化只會建立四筆知識，不會捏造活動。

## 2. 建立 LINE Official Account 與 Messaging API Channel

1. 在 LINE Official Account Manager 建立官方帳號。
2. 進入帳號「設定」→「Messaging API」，啟用 Messaging API，選擇正確 Provider。再到 LINE Developers Console 開啟對應 Messaging API Channel。
3. 在 **Basic settings** 取得 Channel secret；在 **Messaging API** 取得／簽發 Channel access token。秘密值只填在本機 `.dev.vars` 或 Cloudflare Secrets，不要放到前端、Git 或聊天對話。
4. 在管理員可確認的 LINE Developers 帳號資料／可信任的 LINE 身分管理流程取得管理員的 LINE User ID。不可用顯示名稱或自行輸入的文字作為身分。管理員必須屬於同一 Provider 的 LINE 身分範圍；其餘人的 ID 由你的管理流程核對後再加入。
5. `ADMIN_LINE_USER_IDS` 用逗號分隔精確 User ID；空值或未設定會拒絕所有管理操作。這是 Bot 操作權限，**不代表已自動完成隊規的管理層表決**。管理員應先完成既定表決，再更新已確認資料。

目前 LINE 官方流程是從 Official Account Manager 啟用 Messaging API，詳見 [Build a bot](https://developers.line.biz/en/docs/messaging-api/building-bot/)。

## 3. 建立 Cloudflare D1（由你自行操作）

下列指令會登入 Cloudflare 並建立雲端資源；只有你準備好時才執行。

```powershell
npx wrangler login
npx wrangler d1 create kai981-km
```

將回傳的 database UUID 填入 `wrangler.toml` 的 `database_id`，binding 保留 `DB`。範本的全零 UUID 只供本機設定佔位。接著初始化遠端資料庫：

```powershell
npx wrangler d1 migrations apply DB --remote
```

不要將本機報名測試資料誤當作正式資料匯入。官方文件：[D1 建立流程](https://developers.cloudflare.com/d1/get-started/)、[D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)。

## 4. 設定 Worker Secrets 與發布（本次未執行）

下列命令會互動式要求秘密值，請直接在本機 CLI 輸入；不要把值直接附在命令列上或貼入對話。`wrangler secret put` 是遠端寫入動作；若詢問建立尚不存在的 Worker，請先確認專案名稱正確，再自行決定執行。

```powershell
npx wrangler secret put LINE_CHANNEL_SECRET
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
npx wrangler secret put ADMIN_LINE_USER_IDS
```

也可以在 Cloudflare Dashboard → Workers & Pages → 對應 Worker → Settings → Variables and Secrets 新增上述 **Secret**，不要建立為公開前端變數。若有正式與測試環境，分別配置資料庫與 Channel 憑證。

準備上線時，自行執行：

```powershell
npx wrangler deploy
```

取得 Worker HTTPS URL，例如 `https://kai981-km-bot.<你的子網域>.workers.dev`。確認 Worker 的 `DB` binding 指向正確 D1。Secrets 必須在驗證真實 Webhook 前完成設定。

## 5. Pages 前端與公開 URL

1. 修改 `public/config.js`：`API_BASE_URL` 改為上一步 Worker HTTPS URL，`LINE_ADD_FRIEND_URL` 改為官方帳號公開加入好友連結（支援 `https://line.me/...` 或 `https://lin.ee/...`）。這兩個值都不是 Secret。
2. 前端沒有編譯步驟，輸出目錄就是 `public`。本專案提供獨立 `pages/wrangler.toml`，避免 Pages 誤用 Worker 設定。可由你執行以下 Direct Upload 指令：

```powershell
npx wrangler pages deploy --cwd pages --project-name kai981-km-bot-web
```

3. 將 `wrangler.toml` 的 `PUBLIC_ORIGIN` 改為真正的 Pages origin，例如 `https://kai981-km-bot-web.pages.dev`，不加尾端斜線，再自行重新部署 Worker。使用自訂網域就填自訂 origin；本版一次只允許一個前端 origin。
4. 正式環境可將 `public/_headers` 的 `connect-src` 收斂成 `'self' https://你的-worker-domain`，移除開發用的 localhost。每次修改前端後都需由你重新發布 Pages。

Pages **只能發布 `public/`**，不要把專案根目錄或 `.dev.vars` 上傳。前端沒有管理表單、沒有寫入 API，也不接受由瀏覽器傳來的 LINE User ID 作為報名身分。

## 6. LINE Webhook 與群組設定

在 LINE Developers Console → Channel → Messaging API：

1. Webhook URL 填入 `https://你的-worker-domain/webhook`，儲存。
2. 點擊 **Verify**。LINE 會傳送已簽章且 `events: []` 的驗證請求；Worker 驗證後回 200。這只證明 Webhook 可達與簽章可驗證，不代表 Reply API 已驗收。
3. 啟用 **Use webhook**，並啟用 **Webhook redelivery**，讓暫時失敗的事件有機會重送。
4. 啟用 **Allow bot to join group chats**，再將官方帳號邀請到群組。
5. 建議關閉 Official Account Manager 的自動回應訊息；按需要關閉歡迎訊息，避免與 Bot 重複回覆。
6. 私訊 Bot「隊規」，再在群組傳送「品牌資料」，確認真正收到 Reply API 回覆。群組查詢不要求 @mention；Bot 會處理所有收到的有效文字，因此一般聊天中的未知文字也可能進入待補清單。

LINE 不能直接連到 localhost。本機可先做網頁查詢，真實 LINE Webhook 請在你自行準備的 HTTPS 測試 Worker 環境驗證；本專案沒有自動開啟公開 tunnel。

官方文件：[簽章驗證](https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/)、[Webhook 與重送](https://developers.line.biz/en/docs/messaging-api/receiving-messages/)、[群組設定](https://developers.line.biz/en/docs/messaging-api/group-chats/)。

## 7. 隊員操作

| 輸入 | 行為 |
| --- | --- |
| `隊規` | 回答三條已確認隊規與各自來源 |
| `新成員加入`、`如何加入`、`入隊` | 查詢新成員加入流程 |
| `品牌對外活動`、`對外活動` | 查詢至少兩位管理成員參與規定 |
| `管理事項`、`入群規範`、`衣服製作`、`上位製圖`、`成員調節`、`申辦比賽`、`對外對接`、`公關處理`、`表決` | 查詢管理層過半表決規定 |
| `品牌資料`、`隊名`、`品牌語`、`標語` | 查詢品牌確認資料 |
| `活動`、`查詢活動` | 查詢 D1 活動時間、地點、名額、開放狀態與正取／候補數 |
| `我要報名` | 只有一場可報名活動時直接要求姓名；多場先列選項 |
| `選擇 活動ID` | 在多場清單中選擇活動 |
| `姓名 王小明` | 完成報名，依剩餘名額列為正取或候補 |
| `我的報名` | 查詢同一 LINE 使用者的報名狀態 |
| `取消` | 結束目前報名對話，不會取消已完成的報名 |
| `說明` | 顯示指令 |

查詢採 NFKC、大小寫與常見空白／標點正規化後的**精確別名比對**，不以模糊關鍵字猜測複雜、否定或複合問句。未命中時回覆「目前沒有已確認資料」，LINE 問題會寫入待補清單；管理員確認答案後可新增別名。網頁查詢是唯讀，不會寫入待補清單。

對話以「使用者 + 個人／群組／多人聊天室」隔離，15 分鐘逾時。跨群組報同一場活動仍會被 `(activity_id, user_id)` 唯一限制擋下。不含 userId 的群組訊息可查詢知識，但不能報名；會提示改用私訊。群組中的姓名輸入與 Bot 回覆會被群組成員看到，可改用私訊重新開始報名。

只有 `status=open` 且開始時間尚未到達的活動接受報名。日期儲存為 UTC ISO 8601，顯示的 `Z` 代表 UTC，台灣時間為 UTC+8。活動列表一次最多讀取 30 場；第一階段適用小型活動清單。候補按報名記錄 `id` 順序，沒有自動遞補、取消報名、付款或推播功能；需要時由管理員另行協調，不能推測報名已獲准。

## 8. 管理員操作：只接受已簽章 LINE 私訊

以下指令只有 `ADMIN_LINE_USER_IDS` 白名單中的使用者可在 Bot **私訊**執行。群組一律拒絕管理操作，避免待補問題外洩。未設定白名單時預設拒絕。`POST /api/...` 不提供任何管理或報名寫入能力。

### 查看與處理待補問題

```text
/admin pending
/admin resolve 12
```

最多顯示最新 10 筆待補問題，長問題會縮短預覽。`resolve` 只標示問題已處理，不會自動創造答案；請先完成確認及知識更新。

### 新增／更新已確認知識

```text
/admin knowledge {"id":"confirmed-example","title":"已確認主題","answer":"填入經管理層確認的答案","aliases":["已確認主題","另一種問法"],"source":"填入真實隊規條目或會議紀錄"}
```

相同 id 會更新知識。必須有非空來源，答案最長 1200 字，別名 1–30 個。內建 `rule-join`、`rule-brand-event`、`rule-management`、`brand` 可按相同格式更新；`隊規` 彙整 id 以 `rule-` 開頭的條目。種子中的條號是本專案按使用者提供順序編排，**不是聲稱已有正式文件條號**。

### 新增活動與關閉報名

以下只是格式範例，**不會自動寫入資料庫，也不是已確認活動**。請換成真實確認的活動與未來時間後才傳送：

```text
/admin activity {"id":"training-01","title":"已確認活動名稱","starts_at":"2030-01-20T14:00:00+08:00","location":"已確認地點","capacity":20,"status":"open","source":"已核准活動公告編號"}
/admin close training-01
```

id 僅接受小寫英數、底線、連字號，最長 40 字。名額 1–10000；時間必須含時區且在未來。相同 id 不覆寫活動，避免修改名額造成既有正取資料失衡。第一階段提供新增與關閉，沒有一般活動修改 API；如必須修改活動時間／名額，應由具有 Cloudflare D1 權限的維護者先核對既有報名並備份，再處理異動。資料庫直接維護權限透過 Cloudflare 帳號權限管理，不經公開網站。

## 9. 安全、重送與資料一致性

- Webhook 先以原始 request bytes 及 `x-line-signature` 驗證 HMAC-SHA256，通過後才 JSON.parse。空 body、壞 JSON、缺 events 會拒絕；有效 `events: []` 回 200。非文字、空白文字、缺少 event ID／replyToken／合法來源的單筆事件忽略，避免反覆重送壞事件。
- 每次以收到的事件 replyToken 呼叫 LINE Reply API，群組回覆由 LINE 根據該 token 路由；不以自行提交的 groupId 或 userId 進行推播。
- `webhook_events.event_id` 為去重主鍵。所有事件異動與已組好的回覆在同一 `D1 batch()` transaction 中提交，每個異動都附加事件未處理條件。相同事件重送不重複建立報名、問題或管理異動。
- 正取數量判定與 INSERT 位於同一 SQL 寫入；D1 序列化交易與 `(activity_id,user_id)` 唯一限制避免超額正取及重複報名。活動關閉與時間限制在寫入時重新判斷。
- 回覆使用 30 秒租約避免併發發送，Reply API timeout 為 10 秒。網路錯誤、429、5xx 或設定錯誤會使 Webhook 回 503，等待 LINE 重送；已完成資料仍保留。HTTP 400 記為 `failed`，避免過期或已使用 replyToken 無限重試。LINE token 有時效，**無法保證每次重送都能補回訊息**，也不宣稱端到端 exactly-once。可用「我的報名」確認實際紀錄。
- 程式不記錄 Secret、原始 body、姓名或問題全文至 console；只記錄錯誤代碼、事件 ID 與 LINE HTTP status。D1 本身包含姓名、LINE User ID、待補問題、回覆內容與管理員稽核紀錄，應限制 Cloudflare 存取權並制定保存期限。
- 知識與活動 API 是**公開唯讀**；CORS 只是瀏覽器限制，不是身分驗證。不要在這兩種資料中放入未授權公開的私人資訊。報名姓名、使用者 ID、待補清單不由公開 API 返回。
- 本版不提供排程清理。過期 conversations 可由維護者清理；webhook_events 過早刪除會失去去重紀錄，應依團隊保存政策與重送期間保留。LINE 事件可能亂序，請等待 Bot 的下一步提示後再傳姓名，避免快速連發多次「我要報名」。

官方依據：[D1 batch 交易](https://developers.cloudflare.com/d1/worker-api/d1-database/)、[LINE Reply API](https://developers.line.biz/en/reference/messaging-api/#send-reply-message)。

## 10. 故障排除與驗收

| 狀況 | 先檢查 |
| --- | --- |
| Verify 得到 401 | Channel Secret 是否屬於同一 Channel；中介層是否改寫了原始 body |
| Verify 得到 503 | DB binding、Secrets、Worker logs；先確認 migrations 已套用 |
| Verify 成功但沒有文字回覆 | Access Token、Use webhook、自動回應設定與 `last_http_status` |
| 群組無法邀請 Bot | Allow bot to join group chats 是否已啟用 |
| 網頁連不到 Worker | config.js、PUBLIC_ORIGIN 是否精確一致，Worker 是否執行，是否已重新發布 |
| 無活動 | migrations 沒有活動種子；需管理員新增真正確認的活動 |
| 管理操作被拒絕 | 私訊、正確 LINE User ID、相同 Provider、Secret 白名單是否設定 |

完整手動操作步驟見 `MANUAL_CHECKLIST.md`。本次沒有執行其中步驟，也沒有執行任何自動化測試。上線前請先用獨立測試 Channel／D1 完成驗收，再自行決定發布。
