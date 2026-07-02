# 保險案件平台 Insurance Case Platform

## 這是什麼系統

這是一套產險案件生命週期管理系統，用來處理：

- 商火（商業火災保險）報價
- 公共意外險報價
- 報價彙整（多家保險公司報價比較）
- 原始報價資料儲存（案件草稿）
- 案件資料夾自動歸檔
- PDF / Word（.doc）檔案產生

## 系統需求

- Windows 10 或 Windows 11
- Node.js 18 以上，建議安裝 Node.js LTS 版本
- Google Chrome 或 Microsoft Edge（用來把報價單轉成 PDF）
- Git（如果要從 GitHub clone 專案；用下載 ZIP 的方式也可以不裝）
- 可選：Supabase 帳號與專案（不裝也能用本機模式）

## 第一次下載後怎麼使用

1. 從 GitHub 下載或 clone 專案
2. 進入專案資料夾
3. 執行 `npm install`
4. 複製 `.env.example` 成 `.env`
5. 視情況修改 `.env`（本機測試通常不用改）
6. 視情況複製 `config.example.json` 成 `config.json`（想自訂案件存放位置才需要）
7. 執行 `npm start`
8. 打開瀏覽器輸入 `http://localhost:8787`

## Windows 完整指令

用 `git clone` 下載：

```powershell
git clone <你的 GitHub repo URL>
cd insurance-case-platform
npm install
copy .env.example .env
npm start
```

如果是下載 ZIP：

```powershell
cd 下載後解壓縮的資料夾
npm install
copy .env.example .env
npm start
```

## 啟動後網址

```text
http://localhost:8787
```

啟動成功時，終端機（黑色視窗）會印出目前的模式（本機模式或 Supabase）、案件歸檔路徑、Port 等資訊，方便你確認系統是否正常。

## 本機模式：沒有 Supabase 也能用

`.env` 裡設定：

```env
LOCAL_DEV_FALLBACK=true
```

- 不需要 Supabase 也能開啟系統、產生報價單、儲存案件
- 案件資料暫存在 `backend/data/quote_drafts.json`
- 適合單機測試、單人使用
- 不適合多人同時共用（沒有共用資料庫）

## 正式模式：使用 Supabase

`.env` 裡設定：

```env
LOCAL_DEV_FALLBACK=false
SUPABASE_URL=你的 Supabase 專案網址
SUPABASE_SERVICE_ROLE_KEY=你的 Supabase service role key
```

步驟：

1. 到 [Supabase](https://supabase.com/) 建立一個新專案
2. 打開 Supabase 的 SQL Editor，貼上並執行本專案的 `database/schema.sql`
3. 在 Supabase 專案設定裡找到 Project URL 與 `service_role` key，填入 `.env`
4. 重新啟動 `npm start`

## 環境變數說明

| 變數 | 說明 |
|---|---|
| PORT | 後端服務 Port，預設 8787 |
| SUPABASE_URL | Supabase 專案網址（正式模式必填） |
| SUPABASE_SERVICE_ROLE_KEY | Supabase service role key（正式模式必填，絕對不能外流） |
| LOCAL_DEV_FALLBACK | 沒有 Supabase 時是否用本機 JSON 暫存資料 |
| CHROME_PATH | 手動指定 Chrome/Edge 執行檔位置（通常不用填） |
| PDF_RENDER_TIMEOUT_MS | PDF 產生等待逾時（毫秒） |
| ARCHIVE_ROOT | 目前版本不生效，案件歸檔路徑請改用 `config.json`，詳見下方 |

完整說明請看 [`docs/ENV.md`](docs/ENV.md)。

## 案件資料夾儲存位置

- 沒有 `config.json` 時，系統固定存到目前登入使用者的桌面：`Desktop\保險報價案件`
- 想存到 D 槽、外接硬碟或 NAS，請複製根目錄的 `config.example.json` 成 `config.json`，並修改裡面的 `archiveRoot`
- `config.json` 是每台電腦自己的設定，不應該推上 GitHub（已列在 `.gitignore`）

## PDF 產生說明

系統會呼叫本機安裝的 Chrome 或 Edge（headless 模式）把報價單轉成 PDF。多數情況不用設定，系統會自動偵測常見安裝路徑。如果 PDF 一直產生不出來，通常是系統找不到 Chrome/Edge，請在 `.env` 設定 `CHROME_PATH`，詳見 [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md)。

## 常見問題

完整版請看 [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md)，至少包含：

- `npm` 或 `node` 不是內部或外部命令
- `npm install` 失敗
- Port 8787 被占用
- PDF 沒有產生
- 案件資料夾沒有出現
- Supabase 連不上
- 從 GitHub 下載後缺少 `node_modules`

## 不要上傳到 GitHub 的東西

以下內容都已經在 `.gitignore` 排除，正常操作不會被提交：

- `.env`（含真實 Supabase key）
- `node_modules/`
- `backend/data/*.json`（本機測試/案件草稿資料）
- `config.json`（每台電腦自己的歸檔路徑設定）
- 產出的 PDF / Word（.doc）/ HTML 案件檔案
- 真實客戶資料

提交前建議先執行 `git status` 確認，詳見 [`docs/GITHUB.md`](docs/GITHUB.md)。

## 專案結構

```txt
insurance-case-platform/
├─ README.md
├─ package.json
├─ package-lock.json
├─ .env.example
├─ .gitignore
├─ config.example.json
├─ backend/
│  ├─ server.js
│  └─ data/
│     └─ .gitkeep
├─ database/
│  └─ schema.sql
├─ docs/
│  ├─ SETUP.md
│  ├─ ENV.md
│  ├─ GITHUB.md
│  └─ TROUBLESHOOTING.md
└─ frontend/
   └─ index.html
```

## 相關文件

- 詳細安裝步驟（換電腦時照著做）：[`docs/SETUP.md`](docs/SETUP.md)
- 環境變數完整說明：[`docs/ENV.md`](docs/ENV.md)
- GitHub 推送與更新操作：[`docs/GITHUB.md`](docs/GITHUB.md)
- 故障排除：[`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md)
