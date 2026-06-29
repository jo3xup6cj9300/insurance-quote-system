# 保險報價整合系統 — 單機版 SKILL

## 一、專案概述

本系統是一個**純前端單檔 HTML 單機版**保險報價工具，點兩下即可開啟，不需要伺服器、不需要網路、不需要安裝任何套件。

**檔案名稱：** `保險報價整合系統_單機版.html`

**包含三個模組：**
1. 🔥 商火報價（Commercial Fire）
2. 🏢 公共意外險報價（Premises Public Liability）
3. 📋 報價彙整（Quote Summary）

---

## 二、系統架構

### 單檔 SPA 設計

所有模組在同一個 HTML 檔案內，以 `display:none / display:block` 切換畫面，不使用：
- iframe
- window.location 跳頁
- 多 HTML 互跳
- assets 資料夾依賴
- 任何外部 API（無 OCR、無 OpenAI、無 Vision）

### 頁面結構

```
<div id="page-home">   首頁三入口
<div id="page-fire">   商火報價模組
<div id="page-liability">  公共意外險模組
<div id="page-summary">    報價彙整模組
```

### JS 命名規則（避免衝突）

每個模組的 ID 和函式都有前綴：
- 商火：`f-` 前綴（`f$()` 函式）
- 公共意外險：`l-` 前綴（`l$()` 函式）
- 報價彙整：`s-` 前綴（`s$()` 函式）

### 共用工具函式

```js
escHtml(v)       // HTML 跳脫
plainStr(v)      // 去除前後空白
numVal(v)        // 字串轉數字（含千分位）
fmtNum(v)        // 數字格式化
todayStr()       // 今日日期 yyyy/mm/dd
stripEnglish(t)  // 移除含英文字母的括號（保留中文括號）
dlFile(name, content, type)  // 觸發下載
safeFileName(t)  // 安全檔名
```

---

## 三、模組說明

### 3-1 商火報價（f- 前綴）

**左側輸入欄位：**
- 輸出主題色（5色＋自訂顏色）
- 要保人資訊：產業別、要保人同被保險人、公司名稱、統一編號、代表人、電話、通訊地址、保險期間、抵押銀行
- 被保險人資訊（勾選「要保人同被保險人」時隱藏）
- 標的物地址與保額：建築物、營業裝修、機器設備、營業生財、貨物、建築結構、是否有修理廠（汽車業專用）
- 自負額、天災險保額比例、天災保險限額、其他附加險比例、備註
- 附加險種與保額（15 個預設險種，可新增）
- SB 附加條款（74 個條款，全部鋪開顯示，可自動建議/全選/清空/自訂）
- 保險公司報價（內部用）：保險公司名稱、保險費 NT$、佣金率 %

**右側輸出（原始報價單）：**
- 要保人資訊、被保險人資訊
- 本保險契約所承保之危險事故
- 標的物與保額表格（含小計、火險總保額）
- 自負額、天災保額、天災限額、附加險
- 備註
- SB 附加條款清單（兩欄，只顯示中文，去除英文括號）
- 保險公司報價（保險公司、保險費 NT$、佣金率 %）

**按鈕功能：**
- 帶入範例、清空、產生報價單、列印/存成 PDF、下載 caseData.json

**SB 附加條款邏輯：**
- 74 個條款，依標的物（建築物/營業裝修/機器設備/營業生財/存貨）自動建議
- `cleanClauseTitle()` = `stripEnglish()` — 移除含英文字母的括號
- 保留純中文括號，例如「商標附加條款(適用於高級名牌或商標之貨物)」

---

### 3-2 公共意外險報價（l- 前綴）

**左側輸入欄位：**
- 輸出主題色
- 要保人資訊：要保人同被保險人、公司名稱、統一編號、代表人、電話、通訊地址、保險期間
- 被保險人資訊（選擇同要保人時隱藏）
- 處所資料（可新增多筆）：名稱、坪數、處所地址、使用性質、招牌、電梯、烤漆爐數量、修理廠、樓層數、火災受信總機、消防撒水系統、室外停車場
- 報價額度：每一人體傷、每一事故體傷、每一事故財損、最高賠償限額、自負額
- 附加條款（5 個預設＋可自訂）
- 備註
- 保險公司報價（內部用）：保險公司名稱、保險費 NT$、佣金率 %

**右側輸出（原始報價單）：**
- 要保人資訊、被保險人資訊
- 處所資料表格（13 欄）
- 報價額度、附加條款、備註
- 保險公司報價（保險公司、保險費 NT$、佣金率 %）

**按鈕功能：**
- 帶入範例、清空、產生報價單、列印/存成 PDF、下載 caseData.json

---

### 3-3 報價彙整（s- 前綴）

**左側輸入：**
- 輸出主題色（可覆蓋 caseData 帶入的主題）
- 讀取 caseData.json（支援商火與公共意外險兩種格式）
- 案件類型：新件 / 續保件（續保件額外顯示去年資料欄位）
- 報價家數：1～5 家（動態增減欄位）
- 各家：保險公司名稱、保險費
- 共同報價說明（一個 textarea，不分公司）
- 各家備註

**右側輸出（客戶版彙整報價單）：**
- 標題：保險報價彙整表 ＋ 製表日期 ＋ 險種
- 上半部：沿用 caseData 的原始報價單資料（要保人、被保險人、標的物/處所等）
- 下半部：保險公司報價比較表

**報價比較表格式：**

| 項目 | 保險公司1 | 保險公司2 | 保險公司3 |
|------|-----------|-----------|-----------|
| 保險公司 | xxx | xxx | xxx |
| 保險費 | xxx | xxx | xxx |
| 報價說明 | colspan=家數（共同欄） | | |
| 備註 | xxx | xxx | xxx |

**客戶版限制（不得顯示）：**
- 佣金、佣金率、佣金金額
- 內部備註
- insurerQuote 欄位

**按鈕功能：**
- 帶入範例、清空（清空輸入＋OUTPUT）、產生彙整報價單、匯出 Word、列印/存成 PDF

---

## 四、caseData.json 規格

### 商火格式（`schemaVersion: "caseData.fire.v1"`）

```json
{
  "schemaVersion": "caseData.fire.v1",
  "insuranceType": "商火",
  "createdAt": "ISO8601",
  "quoteNo": "FIRE-YYYYMMDD-HHmm",
  "applicant": {
    "companyName": "",
    "taxId": "",
    "representative": "",
    "phone": "",
    "mailingAddress": ""
  },
  "insured": { "sameAsApplicant": true },
  "industry": "汽車業",
  "insurancePeriod": "",
  "mortgageBank": "",
  "policyPeriod": "",
  "locations": [
    {
      "siteName": "", "repairShop": "是/否",
      "address": "", "usageNature": "", "structure": "",
      "building": "", "decoration": "", "machinery": "",
      "equipment": "", "goods": ""
    }
  ],
  "totalFireAmount": 0,
  "deductible": "",
  "naturalDisaster": { "percent": "100", "limitPercent": "100" },
  "addonPercent": "50",
  "addonCovers": [{ "on": true, "name": "", "amount": "" }],
  "clauses": [{ "code": "SB001", "title": "..." }],
  "remarks": "",
  "insurerQuote": {
    "insuranceCompany": "",
    "premium": "",
    "commissionRate": ""
  },
  "theme": { "color": "#fff200", "text": "#111" }
}
```

### 公共意外險格式（`schemaVersion: "caseData.v1"`）

```json
{
  "schemaVersion": "caseData.v1",
  "source": "premises-public-liability",
  "insuranceType": "公共意外險",
  "createdAt": "ISO8601",
  "policyPeriod": "",
  "applicant": { "companyName": "", "taxId": "", "representative": "", "phone": "", "mailingAddress": "" },
  "insured": { "sameAsApplicant": true, "label": "要保人同被保險人" },
  "locations": [
    {
      "siteName": "", "address": "", "ping": "",
      "usageNature": "", "signboard": "有/無", "elevator": "有/無",
      "paintOvenCount": "", "repairShop": "有/無", "floorCount": "",
      "fireReceiver": "有/無", "sprinkler": "有/無", "outdoorParking": "有/無"
    }
  ],
  "limits": {
    "personInjury": "", "accidentInjury": "",
    "propertyDamage": "", "aggregate": "", "deductible": ""
  },
  "clauses": ["附加條款名稱"],
  "remarks": "",
  "insurerQuote": {
    "insuranceCompany": "",
    "premium": "",
    "commissionRate": ""
  },
  "theme": { "color": "#fff200", "text": "#111" }
}
```

### 抵押銀行欄位相容性

報價彙整讀取時，依序嘗試以下欄位（任一有值即採用）：
```js
data.mortgageBank || data.mortgage_bank || data.mortgageBankName || data.bank || data.mortgage?.bank
```

---

## 五、主題色系統

### 設計

每個模組各自獨立的主題色，預設黃色。

```js
const moduleTheme = {
  f: {color:"#fff200", text:"#111"},  // 商火
  l: {color:"#fff200", text:"#111"},  // 公共意外險
  s: {color:"#fff200", text:"#111"},  // 報價彙整
};
```

### 預設主題

| 名稱 | 背景色 | 文字色 |
|------|--------|--------|
| 黃色（預設）| `#fff200` | `#111` |
| 藍色 | `#2f5f7c` | `#fff` |
| 綠色 | `#2e7d32` | `#fff` |
| 灰色 | `#555555` | `#fff` |
| 紅色 | `#b42318` | `#fff` |
| 自訂 | color picker | 自動計算亮度 |

### 套用範圍

- 網頁預覽：`.quote h3`、`.quote th`（透過 CSS 變數 `--theme`、`--theme-text`）
- 列印/PDF：同網頁預覽
- Word 匯出：inline style 直接寫入 `background:${tc};color:${tt}`
- caseData.json：記錄 `theme.color` 和 `theme.text`
- 報價彙整讀取 caseData 時自動套用原始主題色（可手動覆蓋）

### 文字色自動判斷（自訂顏色時）

```js
const lum = (0.299*r + 0.587*g + 0.114*b) / 255;
const text = lum > 0.55 ? '#111' : '#fff';
```

---

## 六、Word 匯出規格

### 頁面設定

- A4 直向（portrait）
- 邊距 4mm（用 mso XML `@page Section1` 強制撐滿）
- 使用 `xmlns:o` / `xmlns:w` Word XML 命名空間

### 關鍵技術

Word 不支援 CSS Grid / Flex，全部改用 `<table width="100%">`：

```html
<!-- 標題列 -->
<table width="100%" border="0" cellspacing="0" cellpadding="0">
  <tr>
    <td>保險報價彙整表（左）</td>
    <td style="text-align:right">製表日期（右）</td>
  </tr>
</table>

<!-- 區塊標題（主題色滿版） -->
<table width="100%" ...>
  <tr><td style="background:${tc};color:${tt}">區塊名稱</td></tr>
</table>

<!-- 資料表（標籤＋數值並排） -->
<table width="100%" ...>
  <tr>
    <td style="width:90px;background:#eef5f9;font-weight:700">公司名稱</td>
    <td>範例公司</td>
    <td style="width:90px;background:#eef5f9;font-weight:700">統一編號</td>
    <td>00000000</td>
  </tr>
</table>
```

### 客戶版限制

Word 匯出的報價彙整表**不得顯示**：佣金、佣金率、佣金金額、內部備註、insurerQuote

---

## 七、SB 附加條款英文去除規則

### stripEnglish 函式邏輯

```js
function stripEnglish(text) {
  let t = String(text ?? "").replace(/[\r\n]+/g," ").replace(/\s+/g," ").trim();
  // 只移除含英文字母的括號，保留純中文括號
  let prev;
  do {
    prev = t;
    t = t.replace(/\s*[\(（][^()（）]*[A-Za-z][^()（）]*[\)）]/g, "").trim();
  } while (t !== prev);
  // 處理未閉合的英文括號（SB030、SB040）
  t = t.replace(/\s*[\(（][^()（）]*[A-Za-z][^()（）]*$/, "").trim();
  return t;
}
```

### 轉換範例

| 原始 | 轉換後 |
|------|--------|
| `SB001 重置成本附加條款(REPLACEMENT COST CLAUSE)` | `SB001 重置成本附加條款` |
| `SB025 商標附加條款(適用於高級名牌或商標之貨物)(BRAND OR TRADEMARK CLAUSE)` | `SB025 商標附加條款(適用於高級名牌或商標之貨物)` |
| `SB038 責任解除附加條款(甲型)(LOSS PAYABLE CLAUSE)` | `SB038 責任解除附加條款(甲型)` |
| `SB040 貨物水險(50/50)附加條款(MARINE CARGO INSURANCE (50/50 CLAUSE)` | `SB040 貨物水險(50/50)附加條款` |
| `SB030 電腦系統當機...附加條款(DATA PROCESSING...` （未閉合）| `SB030 電腦系統當機...附加條款` |

---

## 八、注意事項與禁止修改項目

### 不要做的事

- 不要加 OCR
- 不要加 OpenAI / Azure / Gemini API
- 不要加 Vision
- 不要讀 PDF
- 不要做第二套系統
- 不要把四個頁面拆成多個 HTML 檔案
- 不要加 iframe
- 不要用 window.location 跳頁
- 不要在客戶版顯示佣金

### 客戶版（報價彙整輸出）絕對不顯示

- 佣金 / 佣金率 / 佣金金額
- `insurerQuote` 任何欄位
- 內部備註

### 原始報價單（商火/公共意外）可以顯示

- 保險公司名稱
- 保險費 NT$
- 佣金率 %（內部版用）

---

## 九、修改此系統時的標準流程

1. **讀取 SKILL.md**（本文件），了解架構限制
2. **確認修改範圍**：只改特定模組，不影響其他模組
3. **ID 命名規則**：商火用 `f-`，公共意外用 `l-`，報價彙整用 `s-`
4. **輸出三個地方同步**：網頁預覽 + 列印PDF + Word 匯出
5. **caseData 同步**：有新欄位要加入 caseData 結構
6. **客戶版保護**：報價彙整輸出永遠不顯示佣金相關資料
7. **主題色**：所有輸出都要套用 `getTheme(prefix)` 取得當前主題

---

## 十、版本歷程摘要

| 版次 | 主要變更 |
|------|----------|
| v1 | 初始四檔案版本（index.html + assets/） |
| v2 | 合併為單機版 HTML |
| v3 | 公共意外險中文亂碼修復 |
| v4 | SB 附加條款英文括號去除 |
| v5 | 報價彙整：報價家數 1～5 可調；Word 匯出排版改善 |
| v6 | 抵押銀行欄位補入報價彙整；stripEnglish 保留中文括號 |
| v7 | 主題色系統（5色＋自訂）同步預覽/PDF/Word/caseData |
| v8 | SB 條款清單改為全部鋪開（移除滾輪）；補回保險公司報價輸出區塊 |
| v9 | 報價彙整新增清空功能 |
