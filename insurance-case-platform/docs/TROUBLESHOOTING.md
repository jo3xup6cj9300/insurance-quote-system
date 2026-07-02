# 故障排除

## 1. `node` 不是內部或外部命令

**原因**：Node.js 沒安裝好，或安裝後沒有重開 PowerShell。

**解法**：重新安裝 [Node.js LTS](https://nodejs.org/)，安裝完成後，關閉並重新打開 PowerShell 再試一次。

## 2. `npm` 不是內部或外部命令

**原因**：跟第 1 點同樣，通常是 Node.js/npm 沒有正確加入系統 PATH。

**解法**：重新安裝 Node.js LTS。

## 3. `npm install` 失敗

先試試看清除快取再重裝：

```powershell
npm cache clean --force
npm install
```

如果還是不行，刪除 `node_modules/` 和 `package-lock.json`，再重新安裝：

```powershell
rmdir /s /q node_modules
del package-lock.json
npm install
```

## 4. `EADDRINUSE: address already in use :::8787`

**原因**：Port 8787 已經被其他程式占用（可能是系統本身已經在背景執行）。

**解法**：修改 `.env`，把 Port 改成別的號碼：

```env
PORT=8788
```

然後改用這個網址打開：

```text
http://localhost:8788
```

## 5. PDF 無法產生

**可能原因**：

- 電腦沒有安裝 Chrome，也沒有安裝 Edge
- 系統自動偵測不到安裝路徑（例如安裝在非預設位置）

**解法**：在 `.env` 加上 `CHROME_PATH`，指向你電腦上實際的執行檔位置，例如：

```env
CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
```

或：

```env
CHROME_PATH=C:\Program Files\Microsoft\Edge\Application\msedge.exe
```

改完後要重新執行 `npm start` 才會生效。就算 PDF 沒有產生成功，JSON 與 Word（`.doc`）檔案還是會正常寫入案件資料夾，不會遺失資料。

## 6. 案件資料夾沒有出現

請依序檢查：

- 桌面是否真的有寫入權限（少數企業電腦會限制桌面寫入）
- 如果有建立 `config.json`，確認裡面的 `archiveRoot` 路徑是否正確、路徑中有沒有打錯字或非法字元
- 啟動系統時，終端機印出的 `Archive root = ...` 那一行路徑是否符合預期
- 執行 `npm start` 的終端機視窗有沒有出現紅字錯誤訊息

## 7. Supabase 連不上

請依序檢查：

- `.env` 裡的 `SUPABASE_URL` 是否正確、有沒有多打空白
- `.env` 裡的 `SUPABASE_SERVICE_ROLE_KEY` 是否正確、完整（這個 key 通常很長）
- 是否已經在 Supabase 的 SQL Editor 執行過本專案的 `database/schema.sql`
- 如果 `LOCAL_DEV_FALLBACK=false`，Supabase 一定要能正常連線，否則寫入案件會失敗並回傳錯誤訊息

## 8. 從 GitHub 下載後沒有 `node_modules`

這是正常現象，`node_modules/` 本來就不會上傳到 GitHub（檔案太大、且應該由套件版本自動安裝）。下載專案後請執行：

```powershell
npm install
```

## 9. 從 GitHub 下載後沒有 `.env`

這也是正常現象，`.env` 內含機密資訊，不會上傳到 GitHub。請執行：

```powershell
copy .env.example .env
```
