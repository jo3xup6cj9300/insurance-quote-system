# 環境變數說明

所有環境變數都寫在專案根目錄的 `.env` 檔案裡。`.env` 不會上傳到 GitHub（已列在 `.gitignore`），每台電腦都要自己用 `.env.example` 複製一份出來。

| 變數 | 必填 | 預設值 | 說明 | 範例 |
|---|---|---|---|---|
| `PORT` | 否 | `8787` | 後端服務監聽的 Port | `8787` |
| `SUPABASE_URL` | 正式模式必填 | 無 | Supabase 專案網址 | `https://xxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | 正式模式必填 | 無 | Supabase service role key，高權限，絕對不能外流 | 不可公開 |
| `LOCAL_DEV_FALLBACK` | 否 | `true` | 沒有 Supabase 時，是否用本機 JSON（`backend/data/quote_drafts.json`）暫存案件資料 | `true` |
| `CHROME_PATH` | 否 | 自動偵測 | 手動指定 Chrome 或 Edge 執行檔位置，系統自動偵測不到時才需要填 | `C:\Program Files\Google\Chrome\Application\chrome.exe` |
| `PDF_RENDER_TIMEOUT_MS` | 否 | `15000` | PDF 產生的等待逾時（毫秒） | `15000` |
| `ARCHIVE_ROOT` | 不生效 | — | 見下方「案件歸檔路徑」說明 | — |

## 案件歸檔路徑：請用 `config.json`，不要用 `ARCHIVE_ROOT`

目前這個版本的 `backend/server.js` 為了避免舊的 `.env` 設定值造成案件被存到錯誤資料夾，已經改成固定規則：

1. 專案根目錄沒有 `config.json` → 固定存到目前登入使用者的桌面：`Desktop\保險報價案件`（不會去讀 `.env` 裡的 `ARCHIVE_ROOT`）
2. 專案根目錄有 `config.json`，且裡面有 `archiveRoot` 欄位 → 改存到 `config.json` 指定的路徑

也就是說，`.env` 裡的 `ARCHIVE_ROOT` 目前不會被讀取。`.env.example` 裡保留這個變數只是留紀錄、方便未來版本需要時使用，實際要改路徑請照以下步驟：

```powershell
copy config.example.json config.json
notepad config.json
```

把 `archiveRoot` 改成你要的路徑，例如：

```json
{
  "archiveRoot": "D:\\保險案件"
}
```

啟動系統時，終端機會印出目前實際使用的歸檔路徑與來源（`config.json（自訂路徑）` 或 `桌面預設路徑`），可以用這個訊息確認設定是否生效。

## 安全性重點

- `.env` 不可以推上 GitHub（已在 `.gitignore` 排除）
- `.env.example` 可以推上 GitHub（裡面沒有真實 key）
- `SUPABASE_SERVICE_ROLE_KEY` 是高權限 key，等同於資料庫的完整存取權限，絕對不能公開、不能貼到聊天室或程式碼裡
- 如果這個 repo 是 public（公開），一定要再三確認 `git status` 裡沒有出現 `.env`，才可以 `git push`
