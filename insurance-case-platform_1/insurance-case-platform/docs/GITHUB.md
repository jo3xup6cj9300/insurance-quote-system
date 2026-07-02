# GitHub 操作說明

## 第一次推上 GitHub

先在 GitHub 網站上建立一個空的 repository（不要勾選自動建立 README，避免衝突），然後在專案資料夾裡執行：

```powershell
git init
git add .
git commit -m "Initial commit: insurance case platform"
git branch -M main
git remote add origin <你的 GitHub repo URL>
git push -u origin main
```

## 推上去之前一定要檢查

```powershell
git status
```

確認清單裡**不要**出現以下項目（如果出現，代表 `.gitignore` 設定有問題，或是不小心用 `git add -f` 強制加入了）：

- `.env`
- `node_modules/`
- `backend/data/quote_drafts.json` 或其他 `backend/data/*.json`
- `config.json`
- 真實客戶資料
- 真實 PDF / Word（.doc）產出檔案

## 之後更新專案

```powershell
git status
git add .
git commit -m "說明這次改了什麼"
git push
```

## 從 GitHub 下載到新電腦

```powershell
git clone <你的 GitHub repo URL>
cd insurance-case-platform
npm install
copy .env.example .env
npm start
```

打開瀏覽器：

```text
http://localhost:8787
```

如果需要自訂案件存放路徑，再另外執行：

```powershell
copy config.example.json config.json
notepad config.json
```

更完整的說明請看 [`SETUP.md`](SETUP.md)。
