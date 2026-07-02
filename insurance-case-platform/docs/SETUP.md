# 安裝與啟動教學（給換電腦時照著做）

這份文件是給不熟程式的人，換一台新的 Windows 電腦時，一步一步照做就能把系統跑起來。

## 1. 安裝 Node.js

到 [https://nodejs.org/](https://nodejs.org/) 下載並安裝 **LTS 版本**，一路「下一步」安裝即可。

## 2. 檢查 Node.js 是否安裝成功

打開 PowerShell，輸入：

```powershell
node -v
npm -v
```

如果兩個指令都有印出版本號碼（例如 `v20.11.0`），代表安裝成功。如果出現「不是內部或外部命令」，代表安裝失敗或沒有重開 PowerShell，請見 [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md)。

## 3. 安裝 Git（如果要用 git clone 下載專案）

到 [https://git-scm.com/](https://git-scm.com/) 下載並安裝，一路「下一步」即可。如果你是用「下載 ZIP」的方式取得專案，可以跳過這步。

## 4. 取得專案

### 方式 A：用 git clone

```powershell
git clone <你的 GitHub repo URL>
cd insurance-case-platform
```

### 方式 B：下載 ZIP

從 GitHub 網頁上點「Code → Download ZIP」，解壓縮後，用 PowerShell `cd` 進入解壓縮後的資料夾。

## 5. 安裝套件

```powershell
npm install
```

這一步會下載專案需要的所有套件到 `node_modules/`（這個資料夾不會在 GitHub 上，所以每次下載專案後都要重新執行這一步）。

## 6. 建立 `.env`

```powershell
copy .env.example .env
```

本機測試通常不用修改內容，直接用預設值即可啟動。

## 7.（可選）建立 `config.json` 自訂案件存放位置

如果不想把案件存在預設的桌面資料夾，才需要做這一步：

```powershell
copy config.example.json config.json
notepad config.json
```

把裡面的 `archiveRoot` 改成你想要的路徑，例如：

```json
{
  "archiveRoot": "D:\\保險案件"
}
```

不需要自訂路徑的話可以跳過這步，系統預設會存到桌面的「保險報價案件」資料夾。

## 8. 啟動系統

```powershell
npm start
```

看到類似下面的訊息代表啟動成功：

```text
Insurance Case Platform API listening on http://localhost:8787
Local fallback enabled = true
Archive root = C:\Users\你的帳號\Desktop\保險報價案件
```

## 9. 打開系統

瀏覽器輸入：

```text
http://localhost:8787
```

## 10. 測試流程（確認一切正常）

1. 進入「商火報價」
2. 點「帶入範例」快速填入測試資料，或自行輸入一個測試公司名稱
3. 點「產生報價單」查看預覽
4. 點「儲存原始報價」
5. 檢查桌面是否出現「保險報價案件」資料夾（或你在 `config.json` 指定的路徑）
6. 打開該資料夾，確認案件子資料夾內有 JSON、Word（`.doc`）檔案；如果 Chrome/Edge 偵測正常，也會有 PDF 檔案

如果第 5、6 步沒有出現資料夾或檔案，請看 [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) 的「案件資料夾沒有產生」章節。
