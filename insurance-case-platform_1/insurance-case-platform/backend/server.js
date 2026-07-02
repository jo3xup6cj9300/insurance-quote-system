const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { createClient } = require("@supabase/supabase-js");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const app = express();
const PORT = Number(process.env.PORT || 8787);

// ── 歸檔根目錄（ARCHIVE_ROOT）──────────────────────────────
// V6 規則：固定使用桌面路徑，不受 .env 殘留設定干擾。
// 唯一例外：config.json 裡明確指定 archiveRoot 時才允許覆蓋（給進階使用者自訂）。
// 使用 os.homedir() 動態取得目前登入使用者，不寫死帳號名稱。
const CONFIG_PATH = path.join(__dirname, "..", "config.json");
const DESKTOP_DEFAULT_ARCHIVE_ROOT = path.join(os.homedir(), "Desktop", "保險報價案件");

function loadArchiveRootFromConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
      if (config && typeof config.archiveRoot === "string" && config.archiveRoot.trim()) {
        return config.archiveRoot.trim();
      }
    }
  } catch (e) {
    console.warn("[CONFIG] 讀取 config.json 失敗，改用桌面預設路徑：", e.message);
  }
  return null;
}

const ARCHIVE_ROOT = loadArchiveRootFromConfig() || DESKTOP_DEFAULT_ARCHIVE_ROOT;

// 啟動時確保歸檔根目錄存在
try {
  fs.mkdirSync(ARCHIVE_ROOT, { recursive: true });
} catch (e) {
  console.error("[ARCHIVE_ROOT] 建立歸檔根目錄失敗：", ARCHIVE_ROOT, e.message);
}

const LOCAL_DEV_FALLBACK = String(process.env.LOCAL_DEV_FALLBACK || "").toLowerCase() === "true";
const PDF_RENDER_TIMEOUT_MS = Number(process.env.PDF_RENDER_TIMEOUT_MS || 15000);
const DATA_DIR = path.join(__dirname, "data");
const LOCAL_DB = path.join(DATA_DIR, "quote_drafts.json");
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
].filter(Boolean);

app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.use(express.static(path.join(__dirname, "..", "frontend")));

// ── Supabase 嚴格判斷 ─────────────────────────────────────

function isValidSupabaseConfig() {
  const url = (process.env.SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  return Boolean(
    url &&
    key &&
    url.startsWith("https://") &&
    !url.includes("your-project") &&
    !url.includes("example") &&
    !url.includes("localhost") &&
    !key.includes("your-service-role-key") &&
    !key.includes("example")
  );
}

const supabaseEnabled = isValidSupabaseConfig();
const supabase = supabaseEnabled
  ? createClient(
      process.env.SUPABASE_URL.trim(),
      process.env.SUPABASE_SERVICE_ROLE_KEY.trim()
    )
  : null;

// ── 工具函數 ──────────────────────────────────────────────

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }

function safeFileName(input) {
  return String(input || "未命名")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "")
    .slice(0, 80) || "未命名";
}

function parsePolicyStartDate(periodText) {
  const text = String(periodText || "");
  const m = text.match(/(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})/);
  if (!m) return null;
  const yyyy = Number(m[1]), mm = Number(m[2]), dd = Number(m[3]);
  if (!yyyy || !mm || !dd) return null;
  return new Date(Date.UTC(yyyy, mm - 1, dd));
}

function toRocDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    const now = new Date();
    return `${now.getFullYear() - 1911}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  }
  return `${date.getUTCFullYear() - 1911}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
}

function toIsoDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

// 險種對照表：未來新增險種只需要在這裡加一行，不用改其他架構程式碼
const INSURANCE_TYPE_MAP = [
  { match: (t) => t.includes("商火") || t.includes("火"), label: "火險" },
  { match: (t) => t.includes("公共"), label: "公共意外險" },
  // 未來可擴充：{ match: (t) => t.includes("雇主"), label: "雇主責任險" },
  // 未來可擴充：{ match: (t) => t.includes("工程"), label: "工程險" },
  // 未來可擴充：{ match: (t) => t.includes("貨物"), label: "貨物險" },
];

function insuranceTypeName(caseData) {
  const type = String(caseData?.insuranceType || "");
  for (const item of INSURANCE_TYPE_MAP) {
    if (item.match(type)) return item.label;
  }
  return safeFileName(type || "未分類險種");
}

// ════════════════════════════════════════════════════════════
// ArchiveManager — 唯一資料夾與檔案管理器（V6）
//
// 規則：任何地方都不能自己組路徑（不能自己寫 path.join 拼資料夾）。
// 所有 Fire / Liability / 未來新增的險種，全部只能透過這個物件
// 來建立公司資料夾、年度資料夾、案件資料夾，以及寫入 Word/PDF/JSON。
//
// 最終資料夾結構：
//   Desktop\保險報價案件\
//     公司名稱\
//       115年\
//         火險1\
//           1150701公司名稱_火險(標的物地址)_原始報價單.doc
//           1150701公司名稱_火險(標的物地址)_原始報價單.pdf
//           1150701公司名稱_火險(標的物地址)_caseData.json
//         火險2\
//         公共意外險1\
// ════════════════════════════════════════════════════════════

const ArchiveManager = {
  // 桌面歸檔根目錄，永遠固定，不受 .env 殘留值干擾
  root: ARCHIVE_ROOT,

  // 第一層：公司資料夾。已存在就直接用，不存在才建立，永遠不會出現 (1) (2) 重複資料夾。
  findOrCreateCompanyFolder(companyName) {
    const safeName = safeFileName(companyName || "未命名公司");
    const companyDir = path.join(this.root, safeName);
    ensureDir(companyDir);
    return companyDir;
  },

  // 第二層：保單年度資料夾（民國年，從保單起始日自動判斷）。已存在就直接用。
  getYearFolder(companyDir, caseData) {
    const period = caseData.policyPeriod || caseData.insurancePeriod || "";
    const startDate = parsePolicyStartDate(period);
    const rocDate = toRocDate(startDate);
    const rocYear = `${rocDate.slice(0, 3)}年`;
    const yearDir = path.join(companyDir, rocYear);
    ensureDir(yearDir);
    return { yearDir, rocYear, rocDate, startDate };
  },

  // 第三層：案件資料夾自動編號（險種+流水號，如 火險1、火險2）。
  // 在年度資料夾下尋找符合「險種+數字」的子資料夾，取最大編號 +1，缺號不回收。
  getNextCaseFolder(yearDir, typeName) {
    let entries = [];
    try {
      entries = fs.readdirSync(yearDir, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name);
    } catch (_) {
      entries = [];
    }
    const pattern = new RegExp(`^${typeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d+)$`);
    let maxNum = 0;
    for (const name of entries) {
      const m = name.match(pattern);
      if (m) {
        const n = Number(m[1]);
        if (n > maxNum) maxNum = n;
      }
    }
    const nextNum = maxNum + 1;
    const folderName = `${typeName}${nextNum}`;
    return { folderName, caseDir: path.join(yearDir, folderName) };
  },

  // 正式檔名規則（恢復原本規則）：
  //   保單起始日(1150701) + 公司名稱 + 險種 + (第一個標的物地址或共N處) + 原始報價單
  // 例：1150701範例汽車服務股份有限公司_火險(台北市中正區忠孝東路100號)_原始報價單.doc
  buildFileBaseName(caseData, companyName, typeName, rocDate) {
    const locations = Array.isArray(caseData.locations) ? caseData.locations : [];
    const addressPart = firstAddressLabel(locations);
    return `${rocDate}${companyName}_${typeName}(${addressPart})_原始報價單`;
  },

  // 新增案件：完整跑過 公司資料夾 → 年度資料夾 → 案件資料夾(自動編號) → 檔名
  createNewCase(caseData) {
    const applicant = caseData.applicant || {};
    const companyName = safeFileName(applicant.companyName || caseData.companyName || "未命名公司");
    const typeName = insuranceTypeName(caseData);

    const companyDir = this.findOrCreateCompanyFolder(companyName);
    const { yearDir, rocYear, rocDate, startDate } = this.getYearFolder(companyDir, caseData);
    const { folderName, caseDir } = this.getNextCaseFolder(yearDir, typeName);
    ensureDir(caseDir);

    const fileBaseName = this.buildFileBaseName(caseData, companyName, typeName, rocDate);

    return {
      companyName, typeName, companyDir, yearDir, rocYear, rocDate, startDate,
      caseFolderName: folderName, caseDir, fileBaseName,
      locations: Array.isArray(caseData.locations) ? caseData.locations : []
    };
  },

  // 修改既有案件：只允許同一 CaseIdentity 覆蓋同一個既有資料夾。
  // 身分不同會在 PUT 入口改走新增案件流程；這裡絕不 rename、絕不搬移資料夾。
  getExistingCase(existing, caseData) {
    const caseDir = existing.archive_path || existing.case_data?.archive?.path;
    if (!caseDir || !fs.existsSync(caseDir)) {
      const err = new Error(`找不到既有案件資料夾，無法覆蓋：${caseDir || ""}`);
      err.status = 404;
      throw err;
    }
    const applicant = caseData.applicant || {};
    const companyName = safeFileName(applicant.companyName || caseData.companyName || "未命名公司");
    const typeName = insuranceTypeName(caseData);
    const period = caseData.policyPeriod || caseData.insurancePeriod || "";
    const startDate = parsePolicyStartDate(period);
    const rocDate = toRocDate(startDate);
    const fileBaseName = this.buildFileBaseName(caseData, companyName, typeName, rocDate);

    return {
      companyName, typeName,
      companyDir: existing.company_folder || existing.case_data?.archive?.companyDir || path.dirname(path.dirname(caseDir)),
      yearDir: existing.year_folder || existing.case_data?.archive?.yearDir || path.dirname(caseDir),
      rocYear: existing.case_data?.archive?.policyYear || path.basename(path.dirname(caseDir)),
      caseFolderName: existing.case_folder_name || existing.case_data?.archive?.caseFolderName || path.basename(caseDir),
      caseDir, fileBaseName, rocDate, startDate,
      locations: Array.isArray(caseData.locations) ? caseData.locations : []
    };
  },

  // 寫入 JSON / Word / PDF 到指定案件資料夾，固定檔名（依 fileBaseName），覆蓋舊檔。
  // 若案件資料夾內有「舊檔名」殘留（例如地址變動造成檔名變了），會一併清掉，
  // 確保資料夾內永遠只有一組對應目前最新資料的檔案。
  async saveCaseFiles(caseData, caseDir, fileBaseName) {
    ensureDir(caseDir);
    if (!fs.existsSync(caseDir)) {
      throw new Error(`案件資料夾建立失敗：${caseDir}`);
    }

    // 清除資料夾內舊檔名殘留（避免地址/公司/年度變動後新舊檔案並存）
    try {
      const existingFiles = fs.readdirSync(caseDir);
      for (const f of existingFiles) {
        const isGeneratedFile =
          f === "caseData.json" ||
          f === "原始報價單.doc" ||
          f === "原始報價單.pdf" ||
          f.endsWith("_caseData.json") ||
          f.endsWith(".doc") ||
          f.endsWith(".pdf");
        if (isGeneratedFile && !f.startsWith(fileBaseName)) {
          try { fs.unlinkSync(path.join(caseDir, f)); } catch (_) {}
        }
      }
    } catch (_) {}

    const wordPath     = path.join(caseDir, `${fileBaseName}.doc`);
    const caseDataPath = path.join(caseDir, `${fileBaseName}_caseData.json`);
    const pdfPath       = path.join(caseDir, `${fileBaseName}.pdf`);
    const tmpHtmlPath  = path.join(os.tmpdir(), `ins-quote-${Date.now()}-${Math.random().toString(16).slice(2)}.html`);

    // 1. JSON（一定要成功；固定檔名，寫入即覆蓋舊檔，不新增）
    try {
      fs.writeFileSync(caseDataPath, JSON.stringify(caseData, null, 2), "utf8");
    } catch (e) {
      throw new Error(`JSON 寫入失敗：${caseDataPath}（${e.message}）`);
    }
    if (!fs.existsSync(caseDataPath)) {
      throw new Error(`JSON 寫入失敗（檔案不存在）：${caseDataPath}`);
    }

    // 2. 產生正確排版 HTML（Fire / Liability 共用同一個分流函式 buildOriginalQuoteHtml）
    const pdfHtml  = buildOriginalQuoteHtml(caseData, false);
    const wordHtml = buildOriginalQuoteHtml(caseData, true);

    // 3. Word（固定檔名，寫入即覆蓋舊檔）
    try {
      fs.writeFileSync(wordPath, "\ufeff" + wordHtml, "utf8");
    } catch (e) {
      throw new Error(`Word 寫入失敗，檔案可能正在開啟中，請先關閉 Word 後再重新儲存：${wordPath}（${e.message}）`);
    }
    if (!fs.existsSync(wordPath)) {
      throw new Error(`Word 寫入失敗（檔案不存在）：${wordPath}`);
    }

    // 4. PDF（固定檔名，寫入即覆蓋舊檔；PDF 失敗不影響 JSON / Word 已成功寫入，只警告不拋例外）
    let finalPdfPath = null;
    let pdfResult = { ok: false, reason: "not attempted" };
    try {
      fs.writeFileSync(tmpHtmlPath, pdfHtml, "utf8");
      pdfResult = await generatePdfWithBrowser(tmpHtmlPath, pdfPath);
      if (pdfResult.ok && fs.existsSync(pdfPath)) {
        finalPdfPath = pdfPath;
      } else {
        finalPdfPath = null;
        if (pdfResult.ok) pdfResult = { ok: false, reason: "PDF 寫入後檔案不存在" };
      }
    } catch (pdfErr) {
      console.warn("[PDF] generation failed, continuing without PDF:", pdfErr.message);
      pdfResult = { ok: false, reason: pdfErr.message };
    } finally {
      try { if (fs.existsSync(tmpHtmlPath)) fs.unlinkSync(tmpHtmlPath); } catch (_) {}
    }

    return { wordPath, caseDataPath, pdfPath: finalPdfPath, pdfResult };
  }
};

function quoteNoPrefix(caseData) {
  const type = String(caseData?.insuranceType || "");
  if (type.includes("商火") || type.includes("火")) return "FIRE";
  if (type.includes("公共")) return "LIAB";
  return "CASE";
}

function firstAddressLabel(locations) {
  if (!Array.isArray(locations) || locations.length === 0) return "未填地址";
  if (locations.length > 1) return `共${locations.length}處`;
  const loc = locations[0] || {};
  return safeFileName(loc.address || loc.siteAddress || loc.locationAddress || "未填地址");
}

// ── 案件身分指紋（caseIdentity）─────────────────────────────
// 用來判斷「這次儲存到底是同一案件的修改，還是應該視為新案件」。
// 只有公司名稱、要保人通訊地址、主要風險地址、險種「全部相同」時才允許覆蓋既有資料夾，
// 只要任一不同，一律視為新案件，必須走新增流程、建立新的案件資料夾。

function normalizeIdentityValue(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/　/g, "")
    .trim();
}

function normalize(value) {
  return normalizeIdentityValue(value);
}

function getInsuranceType(caseData) {
  return caseData?.insuranceType || insuranceTypeName(caseData);
}

function getCompanyName(caseData) {
  const applicant = caseData?.applicant || {};
  return applicant.companyName || caseData?.companyName || "";
}

function getApplicantAddress(caseData) {
  const applicant = caseData?.applicant || {};
  return applicant.mailingAddress || applicant.address || applicant.commAddr || "";
}

// 取得「主要風險地址」的原始文字（不模糊化成「共N處」，因為身分比對需要精確文字）：
// 商火 → 第一個標的物地址；公共意外險 → 第一個營業處所地址
function getPrimaryRiskAddress(caseData) {
  const locations = Array.isArray(caseData.locations) ? caseData.locations : [];
  if (!locations.length) return "";
  const loc = locations[0] || {};
  return loc.address || loc.siteAddress || loc.locationAddress || "";
}

function getPolicyStartDate(caseData) {
  const period = caseData?.policyPeriod || caseData?.insurancePeriod || "";
  const startDate = parsePolicyStartDate(period);
  return toIsoDate(startDate) || "";
}

function getPolicyYearFolderName(caseData) {
  const period = caseData?.policyPeriod || caseData?.insurancePeriod || "";
  const startDate = parsePolicyStartDate(period);
  const rocDate = toRocDate(startDate);
  return `${rocDate.slice(0, 3)}年`;
}

function stableIdentityString(value) {
  return normalizeIdentityValue(JSON.stringify(value || []));
}

function buildInsuredIdentity(caseData) {
  const insured = caseData?.insured || {};
  return stableIdentityString({
    sameAsApplicant: Boolean(insured.sameAsApplicant),
    companyName: insured.companyName || "",
    taxId: insured.taxId || "",
    representative: insured.representative || "",
    phone: insured.phone || "",
    mailingAddress: insured.mailingAddress || insured.address || insured.commAddr || ""
  });
}

function buildLocationsIdentity(caseData) {
  const typeName = getInsuranceType(caseData);
  const isLiability = String(typeName || "").includes("公共");
  const locations = Array.isArray(caseData?.locations) ? caseData.locations : [];
  const normalizedLocations = locations.map((loc, index) => isLiability
    ? {
        index,
        name: loc.siteName || loc.name || "",
        address: loc.address || loc.siteAddress || loc.locationAddress || "",
        area: loc.ping || loc.area || "",
        usage: loc.usageNature || loc.usage || "",
        signboard: loc.signboard || "",
        elevator: loc.elevator || "",
        paintBooth: loc.paintOvenCount || loc.paintBooth || "",
        repairShop: loc.repairShop || "",
        floors: loc.floorCount || loc.floors || "",
        fireReceiver: loc.fireReceiver || "",
        sprinkler: loc.sprinkler || "",
        outdoorParking: loc.outdoorParking || ""
      }
    : {
        index,
        name: loc.siteName || loc.name || "",
        address: loc.address || loc.siteAddress || loc.locationAddress || "",
        usage: loc.usageNature || loc.usage || "",
        structure: loc.structure || "",
        repairShop: loc.repairShop || loc.hasGarage || loc.garage || ""
      });
  return stableIdentityString(normalizedLocations);
}

function buildCaseIdentity(caseData) {
  return {
    insuranceType: normalizeIdentityValue(getInsuranceType(caseData)),
    companyName: normalizeIdentityValue(getCompanyName(caseData)),
    applicantAddress: normalizeIdentityValue(getApplicantAddress(caseData)),
    insuredIdentity: buildInsuredIdentity(caseData),
    policyStartDate: normalizeIdentityValue(getPolicyStartDate(caseData)),
    policyYear: normalizeIdentityValue(getPolicyYearFolderName(caseData)),
    locationsIdentity: buildLocationsIdentity(caseData)
  };
}

function isSameCaseIdentity(a, b) {
  if (!a || !b) return false;
  return a.insuranceType === b.insuranceType
    && a.companyName === b.companyName
    && a.applicantAddress === b.applicantAddress
    && a.insuredIdentity === b.insuredIdentity
    && a.policyStartDate === b.policyStartDate
    && a.policyYear === b.policyYear
    && a.locationsIdentity === b.locationsIdentity;
}


function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, ch =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[ch])
  );
}

function stripBracketText(v) {
  let text = String(v ?? "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  let prev;
  do {
    prev = text;
    text = text.replace(/\s*[\(（][^()（）]*[\)）]/g, "").trim();
  } while (text !== prev);
  return text.replace(/\s*[\(（][^()（）]*$/, "").trim();
}

function clauseText(clause) {
  if (clause && typeof clause === "object") {
    const code = String(clause.code || clause.id || clause.no || "").trim();
    const title = String(clause.title || clause.name || clause.clauseTitle || clause.text || clause.label || clause.description || "").trim();
    return stripBracketText(`${code}${code && title ? " " : ""}${title}`.trim() || JSON.stringify(clause));
  }
  if (typeof clause === "number") return String(clause);
  return stripBracketText(clause || "");
}

function money(v) {
  if (v === null || v === undefined || v === "" || v === 0 || v === "0") return "";
  const n = Number(String(v).replace(/,/g, ""));
  if (isNaN(n)) return esc(v);
  return n.toLocaleString("zh-TW");
}

// ── 五欄互相包含（含建築物/含營業裝修/含機器設備/含營業生財/含貨物）通用邏輯 ──
const FIRE_AMOUNT_FIELDS = [
  { field: "building", label: "建築物" },
  { field: "decoration", label: "營業裝修" },
  { field: "machinery", label: "機器設備" },
  { field: "equipment", label: "營業生財" },
  { field: "goods", label: "貨物" },
];

function normalizeCoverageText(value) {
  return String(value || "")
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/\s+/g, "")
    .trim();
}

function getIncludedTargets(value) {
  const text = normalizeCoverageText(value);
  const targets = [];
  for (const item of FIRE_AMOUNT_FIELDS) {
    if (text.includes(`含${item.label}`)) targets.push(item.field);
  }
  return targets;
}

function stripIncludedNotes(value) {
  let text = String(value || "");
  for (const item of FIRE_AMOUNT_FIELDS) {
    text = text
      .replace(new RegExp(`\\(\\s*含\\s*${item.label}\\s*\\)`, "g"), "")
      .replace(new RegExp(`（\\s*含\\s*${item.label}\\s*）`, "g"), "")
      .replace(new RegExp(`含\\s*${item.label}`, "g"), "");
  }
  return text.trim();
}

function buildIncludedByMap(location) {
  const includedBy = {};
  for (const source of FIRE_AMOUNT_FIELDS) {
    const raw = location[source.field];
    const targets = getIncludedTargets(raw);
    for (const targetField of targets) {
      if (targetField !== source.field) includedBy[targetField] = source.label;
    }
  }
  return includedBy;
}

// 計算欄位實際金額：永遠解析「這個欄位自己輸入的數字」（去掉含註記文字後取數字部分）。
// 注意：「含在XXX」只是顯示用標籤（告知使用者這個空欄位的金額已寫在哪個欄位），
// 絕對不能因為這個欄位被別的欄位標記「含在」就把它自己本身輸入的金額歸零，
// 否則會造成「A 欄位寫了金額且帶有(含B)，B 欄位自己也有輸入金額」這種情況下，
// B 欄位的金額被誤判消失（多重/循環含在標記時尤其明顯）。
function fireAmountNumber(location, field) {
  const raw = location[field];
  const cleaned = stripIncludedNotes(raw).replace(/,/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

// 顯示用：如果這個欄位本身沒有自己的金額、且被其他欄位標記「含在」，才顯示「含在XXX」；
// 只要這個欄位自己有輸入金額，就一定顯示自己的金額（即使同時也被標記含在，金額優先）。
function formatFireAmountCell(location, field) {
  const n = fireAmountNumber(location, field);
  if (n) return money(n);
  const includedBy = buildIncludedByMap(location);
  if (includedBy[field]) return `含在${includedBy[field]}`;
  return "-";
}

// ── 正確版面 HTML 產生器 ──────────────────────────────────

function buildFireOriginalQuoteHtml(caseData, forWord = false) {
  const applicant = caseData.applicant || {};
  const companyName = applicant.companyName || caseData.companyName || "";
  const taxId = applicant.taxId || caseData.taxId || "";
  const rep = applicant.representative || applicant.rep || "";
  const tel = applicant.tel || applicant.phone || "";
  const addr = applicant.mailingAddress || applicant.address || applicant.commAddr || "";
  const period = caseData.policyPeriod || caseData.insurancePeriod || "";
  const bank = applicant.mortgageBank || caseData.mortgageBank || "";
  const typeName = insuranceTypeName(caseData);
  const today = new Date().toLocaleDateString("zh-TW");
  const industry = caseData.industry || caseData.industryType || "";
  const themeColor = /^#[0-9a-fA-F]{6}$/.test(caseData.theme?.color || "") ? caseData.theme.color : "#fff200";
  const themeText = /^#[0-9a-fA-F]{3,6}$/.test(caseData.theme?.text || "") ? caseData.theme.text : "#111";

  // 被保險人（前端格式：caseData.insured = {sameAsApplicant:true} 或 {sameAsApplicant:false, companyName:...}）
  const insuredObj = caseData.insured || {};
  const sameAsApplicant = insuredObj.sameAsApplicant !== false;
  const insuredName = sameAsApplicant
    ? "要保人同被保險人"
    : (insuredObj.companyName || insuredObj.name || "");

  // 承保危險事故（前端固定輸出火災／爆炸引起之火災／閃電雷擊，這裡保持一致）
  const perils = Array.isArray(caseData.perils) && caseData.perils.length
    ? caseData.perils
    : ["火災", "爆炸引起之火災", "閃電雷擊"];
  const perilsHtml = perils.map(p => `<span style="margin-right:16px">${esc(p)}</span>`).join("");

  // 標的物與保額
  const locations = Array.isArray(caseData.locations) ? caseData.locations : [];
  let totalSum = 0;
  const locRows = locations.map((loc, i) => {
    const building = fireAmountNumber(loc, "building");
    const deco = fireAmountNumber(loc, "decoration");
    const machine = fireAmountNumber(loc, "machinery");
    const equip = fireAmountNumber(loc, "equipment");
    const goods = fireAmountNumber(loc, "goods");
    const subtotal = building + deco + machine + equip + goods;
    totalSum += subtotal;
    const structure = loc.structure || loc.buildingStructure || "";
    const hasGarage = loc.hasGarage || loc.repairShop === "是" || loc.repairShop === true || false;
    const usage = loc.usageNature || loc.usage || loc.useType || loc.occupancy || "";
    const locAddr = loc.address || loc.siteAddress || loc.locationAddress || "";
    const name = loc.siteName || loc.name || `標的物 ${i + 1}`;
    return `<tr>
      <td style="text-align:center">${i + 1}</td>
      <td>${esc(name)}</td>
      <td>${esc(locAddr)}</td>
      <td>${esc(usage)}</td>
      <td class="money">${esc(formatFireAmountCell(loc, "building"))}</td>
      <td class="money">${esc(formatFireAmountCell(loc, "decoration"))}</td>
      <td class="money">${esc(formatFireAmountCell(loc, "machinery"))}</td>
      <td class="money">${esc(formatFireAmountCell(loc, "equipment"))}</td>
      <td class="money">${esc(formatFireAmountCell(loc, "goods"))}</td>
      <td style="text-align:center">${hasGarage ? "是" : ""}</td>
      <td class="money">${money(subtotal)}</td>
      <td>${esc(structure)}</td>
    </tr>`;
  }).join("");

  // 自負額
  const deductible = caseData.deductible || "";

  // 天災保額 / 天災限額：前端公式為 火險保額 X%：金額 = totalSum * percent / 100
  const natPercent = Number(caseData.naturalDisaster?.percent || caseData.natDisasterPercent || 0);
  const natLimitPercent = Number(caseData.naturalDisaster?.limitPercent || caseData.natDisasterLimit || 0);
  const naturalCoverNames = new Set(["地震險", "颱風及洪水險"]);

  function addonKey(name) {
    return String(name || "").replace(/\s+/g, "").trim();
  }

  function isNaturalAddon(name) {
    return naturalCoverNames.has(addonKey(name));
  }

  // 判斷此附加險是否使用「依上方設定」比例
  function isDefaultAddonPercent(value) {
    if (value === null || value === undefined) return true;
    const v = String(value).trim();
    return v === "" || v === "依上方設定";
  }

  // 解析附加險個別比例文字，支援 "火險保額 80%"、"80%"、"80"、80（number）
  function parseAddonPercent(value) {
    if (value === null || value === undefined) return 0;
    const m = String(value).match(/\d+(\.\d+)?/);
    return m ? Number(m[0]) : 0;
  }

  // 將 addonCovers 分類成三組：
  // enabledAddons：全部有勾選的附加險
  // defaultPercentAddons：勾選且使用「依上方設定」比例 → 套用上方 addonPercent，不可列入排除清單
  // specialPercentAddons：勾選且有自己的個別比例 → 才是要被排除的特殊比例附加險
  function classifyAddons(covers) {
    const enabledAddons = (covers || []).filter(c => c && c.on !== false && c.name);
    const defaultPercentAddons = enabledAddons.filter(c => isDefaultAddonPercent(c.amount));
    const specialPercentAddons = enabledAddons.filter(c => !isDefaultAddonPercent(c.amount));
    return { enabledAddons, defaultPercentAddons, specialPercentAddons };
  }

  // 附加險：addonCovers 每列 {on, name, amount}
  const addonPercent = Number(caseData.addonPercent || 0);
  const addonCovers = Array.isArray(caseData.addonCovers) ? caseData.addonCovers : [];
  const fireAddons = caseData.fireAddons && typeof caseData.fireAddons === "object" ? caseData.fireAddons : null;
  console.log("[BACKEND FIRE received additionalCoverages]", caseData.additionalCoverages || addonCovers);
  console.log("[BACKEND FIRE received summary]", caseData.additionalCoverageSummary || null);

  function buildRatioGroupedRows(rows) {
    const enabled = (rows || []).filter(c => c && c.name && Number(c.ratio || 0));
    if (!enabled.length) return [];
    const groups = new Map();
    enabled.forEach((c, index) => {
      const ratio = Number(c.ratio || 0);
      const key = String(ratio);
      if (!groups.has(key)) groups.set(key, { ratio, coverages: [], firstOrder: index });
      groups.get(key).coverages.push(c);
    });
    return [...groups.values()].sort((a, b) => a.firstOrder - b.firstOrder).map(g => ({
      label: g.coverages.map(c => c.name).join("、"),
      percent: g.ratio,
      amount: totalSum * g.ratio / 100,
      coverages: g.coverages.map(c => c.name),
      isBaseGroup: g.coverages.length > 1
    }));
  }

  function buildNaturalRowsFromCovers(covers, defaultPercent) {
    return buildRatioGroupedRows((covers || [])
      .filter(c => c && c.on !== false && c.name && isNaturalAddon(c.name))
      .map(c => ({
        name: c.name,
        ratio: isDefaultAddonPercent(c.amount) ? Number(defaultPercent || 0) : parseAddonPercent(c.amount)
      })));
  }

  function buildNaturalRows(names, percent) {
    return buildRatioGroupedRows((names || []).map(name => ({ name, ratio: Number(percent || 0) })));
  }

  const selectedNaturalNames = fireAddons?.natural?.selected?.length
    ? fireAddons.natural.selected
    : addonCovers.filter(c => c && c.on !== false && c.name && isNaturalAddon(c.name)).map(c => c.name);

  const naturalCoverageRows = Array.isArray(fireAddons?.summary?.naturalRows) && fireAddons.summary.naturalRows.length
    ? fireAddons.summary.naturalRows
    : (buildNaturalRowsFromCovers(addonCovers, natPercent).length
      ? buildNaturalRowsFromCovers(addonCovers, natPercent)
      : buildNaturalRows(selectedNaturalNames, natPercent));

  const naturalLimitRows = Array.isArray(fireAddons?.summary?.naturalLimitRows) && fireAddons.summary.naturalLimitRows.length
    ? fireAddons.summary.naturalLimitRows
    : buildNaturalRows(selectedNaturalNames, natLimitPercent);

  function effectiveAdditionalCoverages() {
    if (Array.isArray(fireAddons?.nonNatural?.items) && fireAddons.nonNatural.items.length) {
      return fireAddons.nonNatural.items
        .filter(c => c && c.name)
        .map(c => {
          const ratio = Number(c.effectiveRatio ?? c.percent ?? 0);
          return { name: c.name, ratio, amount: totalSum * ratio / 100 };
        });
    }
    if (Array.isArray(caseData.additionalCoverages) && caseData.additionalCoverages.length) {
      return caseData.additionalCoverages
        .filter(c => c && c.enabled !== false && c.name && !isNaturalAddon(c.name))
        .map(c => {
          const ratio = Number(c.effectiveRatio ?? c.ratio ?? 0);
          return { name: c.name, ratio, amount: totalSum * ratio / 100 };
        });
    }
    return addonCovers
      .filter(c => c && c.on !== false && c.name && !isNaturalAddon(c.name))
      .map(c => {
        const ratio = isDefaultAddonPercent(c.amount) ? addonPercent : parseAddonPercent(c.amount);
        return { name: c.name, ratio, amount: totalSum * ratio / 100 };
      });
  }

  function buildAdditionalCoverageSummaryFromEffectiveRows(rows) {
    if (!rows.length) {
      return [];
    }
    const groups = new Map();
    rows.forEach((c, index) => {
      const ratio = Number(c.ratio || 0);
      const key = String(ratio);
      if (!groups.has(key)) groups.set(key, { ratio, coverages: [], firstOrder: index });
      groups.get(key).coverages.push(c);
    });
    const grouped = [...groups.values()].sort((a, b) => a.firstOrder - b.firstOrder);

    if (grouped.length === 1) {
      const g = grouped[0];
      return [{
        label: "其餘附加險比例",
        percent: g.ratio,
        amount: totalSum * g.ratio / 100,
        coverages: g.coverages.map(c => c.name),
        isBaseGroup: true
      }];
    }

    const maxCount = Math.max(...grouped.map(g => g.coverages.length));
    const winners = grouped.filter(g => g.coverages.length === maxCount);
    if (maxCount > 1 && winners.length === 1) {
      const base = winners[0];
      const exceptions = grouped.filter(g => g !== base);
      const exceptionNames = exceptions.flatMap(g => g.coverages.map(c => c.name));
      return [{
        label: `除${exceptionNames.join("、")}以外之其餘附加險比例`,
        percent: base.ratio,
        amount: totalSum * base.ratio / 100,
        coverages: base.coverages.map(c => c.name),
        excludedCoverages: exceptionNames,
        isBaseGroup: true
      }].concat(exceptions.map(g => ({
        label: g.coverages.map(c => c.name).join("、"),
        percent: g.ratio,
        amount: totalSum * g.ratio / 100,
        coverages: g.coverages.map(c => c.name),
        isBaseGroup: false
      })));
    }

    return grouped.map(g => ({
      label: g.coverages.map(c => c.name).join("、"),
      percent: g.ratio,
      amount: totalSum * g.ratio / 100,
      coverages: g.coverages.map(c => c.name),
      isBaseGroup: false
    }));
  }

  // 先建立資料陣列，再逐列 render。為避免前端第二次操作殘留舊 summary，
  // 後端永遠以最新 caseData.additionalCoverages / addonCovers 重新分組，不直接信任舊 summary。
  let addonRowsData = buildAdditionalCoverageSummaryFromEffectiveRows(effectiveAdditionalCoverages());

  function summaryRowsHtml(rows) {
    return (rows || []).map(r =>
      `<tr><td class="label">${esc(r.label)}</td><td>火險保額 ${r.percent}%：${money(r.amount)}</td></tr>`
    ).join("");
  }

  const naturalCoverageHtml = summaryRowsHtml(naturalCoverageRows);
  const naturalLimitHtml = summaryRowsHtml(naturalLimitRows);
  const addonsHtml = summaryRowsHtml(addonRowsData);
  const selectedAddonNames = Array.isArray(fireAddons?.summary?.selectedNames) && fireAddons.summary.selectedNames.length
    ? fireAddons.summary.selectedNames
    : addonCovers.filter(c => c && c.on !== false && c.name).map(c => c.name);
  const selectedAddonsHtml = selectedAddonNames.length
    ? `<tr><td>${esc(selectedAddonNames.join("、"))}</td></tr>`
    : "";

  const remarks = caseData.remarks || caseData.notes || "";

  // SB 附加條款 → 兩欄
  const sbTerms = Array.isArray(caseData.clauses) ? caseData.clauses : [];
  let sbHtml = "";
  if (sbTerms.length) {
    const mid = Math.ceil(sbTerms.length / 2);
    const left = sbTerms.slice(0, mid);
    const right = sbTerms.slice(mid);
    const maxRows = Math.max(left.length, right.length);
    const sbRows = Array.from({ length: maxRows }, (_, i) => `
      <tr>
        <td style="width:50%;padding:3px 8px">${left[i] ? `${i + 1}. ${esc(clauseText(left[i]))}` : ""}</td>
        <td style="width:50%;padding:3px 8px">${right[i] ? `${mid + i + 1}. ${esc(clauseText(right[i]))}` : ""}</td>
      </tr>`).join("");
    sbHtml = `
      <div class="section-title">SB 附加條款</div>
      <table><tbody>${sbRows}</tbody></table>`;
  }

  // 原始報價單內部用報價欄位，不使用報價彙整的三家公司比較表。
  const insurerQuote = caseData.insurerQuote || {};
  const insurerQuoteHtml = `
<div class="section-title">保險公司報價</div>
<table class="info-table"><tbody>
  <tr><td class="label" style="width:140px">保險公司</td><td>${esc(insurerQuote.insuranceCompany || insurerQuote.company || insurerQuote.insurer || "")}</td></tr>
  <tr><td class="label">保險費(NT$)</td><td>${esc(money(insurerQuote.premium || insurerQuote.fee || ""))}</td></tr>
  <tr><td class="label">佣金率(%)</td><td>${esc(insurerQuote.commissionRate || insurerQuote.commission || "")}</td></tr>
</tbody></table>`;

  // Word 特定樣式
  const wordPageStyle = forWord ? `
@page WordSection1 {
  size: 841.95pt 595.35pt;
  mso-page-orientation: landscape;
  margin: 22.7pt 22.7pt 22.7pt 22.7pt;
}
div.WordSection1 { page: WordSection1; }` : "";

  const html = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<title>${esc(companyName)}原始報價單</title>
<style>
${wordPageStyle}
@page {
  size: A4 landscape;
  margin: 8mm;
}
*, *::before, *::after { box-sizing: border-box; }
html, body {
  margin: 0; padding: 0; width: 100%;
  font-family: "Microsoft JhengHei", "Noto Sans TC", Arial, sans-serif;
  font-size: 11px;
  color: #172438;
  line-height: 1.4;
}
.document { width: 100%; }
.doc-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 6px;
}
.doc-title { font-size: 16px; font-weight: 700; }
.doc-meta { text-align: right; font-size: 11px; color: #444; }
table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  margin-bottom: 2px;
}
th, td {
  border: 1px solid #b8c4cf;
  padding: 5px 6px;
  vertical-align: middle;
  word-break: normal;
  overflow-wrap: break-word;
  font-size: 11px;
}
th { background: ${themeColor}; color: ${themeText}; font-weight: 700; text-align: center; }
.label { background: #eef5f9; font-weight: 700; white-space: nowrap; }
.money { text-align: right; white-space: nowrap; }
.no-break { white-space: nowrap; }
.section-title {
  background: ${themeColor};
  color: ${themeText};
  font-weight: 700;
  padding: 6px 8px;
  border: 1px solid #b8c4cf;
  margin-top: 8px;
  margin-bottom: 0;
  font-size: 12px;
}
.info-table td { padding: 5px 8px; }
</style>
</head>
<body>
<div class="${forWord ? "WordSection1 " : ""}document">

<div class="doc-header">
  <div>
    <div class="doc-title">商業火災保險報價單</div>
    ${industry ? `<div>產業別：${esc(industry)}</div>` : ""}
  </div>
  <div class="doc-meta">製表日期：${today}</div>
</div>

<div class="section-title">要保人資訊</div>
<table class="info-table">
  <colgroup><col style="width:12%"><col style="width:38%"><col style="width:12%"><col style="width:38%"></colgroup>
  <tbody>
    <tr>
      <td class="label">公司名稱</td><td>${esc(companyName)}</td>
      <td class="label">統一編號</td><td>${esc(taxId)}</td>
    </tr>
    <tr>
      <td class="label">代表人</td><td>${esc(rep)}</td>
      <td class="label">電話</td><td>${esc(tel)}</td>
    </tr>
    <tr>
      <td class="label">通訊地址</td><td colspan="3">${esc(addr)}</td>
    </tr>
    <tr>
      <td class="label">保險期間</td><td colspan="3">${esc(period)}</td>
    </tr>
    ${bank ? `<tr><td class="label">抵押銀行</td><td colspan="3">${esc(bank)}</td></tr>` : ""}
  </tbody>
</table>

<div class="section-title">被保險人資訊</div>
<table class="info-table">
  <tbody>
    <tr><td class="label" style="width:12%">被保險人</td><td>${esc(insuredName)}</td></tr>
  </tbody>
</table>

${perilsHtml ? `
<div class="section-title">承保內容</div>
<table class="info-table"><tbody>
  <tr><td>${perilsHtml}</td></tr>
</tbody></table>` : ""}

<div class="section-title">標的物與保額</div>
<table>
  <colgroup>
    <col style="width:3%">
    <col style="width:8%">
    <col style="width:15%">
    <col style="width:9%">
    <col style="width:7%">
    <col style="width:7%">
    <col style="width:7%">
    <col style="width:7%">
    <col style="width:6%">
    <col style="width:4%">
    <col style="width:8%">
    <col style="width:19%">
  </colgroup>
  <thead>
    <tr>
      <th>#</th><th>名稱</th><th>標的物地址</th><th>使用性質</th>
      <th>建築物</th><th>營業裝修</th><th>機器設備</th><th>營業生財</th><th>貨物</th>
      <th>修理廠</th><th>小計</th><th>建築結構</th>
    </tr>
  </thead>
  <tbody>
    ${locRows}
    <tr>
      <td colspan="10" class="label" style="text-align:right">火險總保額</td>
      <td class="money" style="font-weight:700">${money(totalSum)}</td>
      <td></td>
    </tr>
  </tbody>
</table>

<div class="section-title">附加險種</div>
<table class="info-table"><tbody>
  ${selectedAddonsHtml || `<tr><td>無</td></tr>`}
</tbody></table>

${deductible ? `
<div class="section-title">自負額</div>
<table class="info-table"><tbody>
  <tr><td>${esc(deductible)}</td></tr>
</tbody></table>` : ""}

<div class="section-title">天災保額</div>
<table class="info-table"><tbody>
  ${naturalCoverageHtml || `<tr><td>無</td></tr>`}
</tbody></table>

<div class="section-title">天災限額</div>
<table class="info-table"><tbody>
  ${naturalLimitHtml || `<tr><td>無</td></tr>`}
</tbody></table>

<div class="section-title">其餘附加險</div>
<table class="info-table">
  <colgroup><col style="width:30%"><col style="width:70%"></colgroup>
  <tbody>
  ${addonsHtml || `<tr><td>-</td></tr>`}
  </tbody>
</table>

${remarks ? `
<div class="section-title">備註</div>
<table class="info-table"><tbody>
  <tr><td>${esc(remarks)}</td></tr>
</tbody></table>` : ""}

${sbHtml}

${insurerQuoteHtml}

</div>
</body>
</html>`;

  return html;
}

// ── 公共意外險原始報價單 builder ───────────────────────────

function buildLiabilityOriginalQuoteHtml(caseData, forWord = false) {
  const applicant = caseData.applicant || {};
  const companyName = applicant.companyName || caseData.companyName || "";
  const taxId = applicant.taxId || caseData.taxId || "";
  const rep = applicant.representative || applicant.rep || "";
  const tel = applicant.tel || applicant.phone || "";
  const addr = applicant.mailingAddress || applicant.address || applicant.commAddr || "";
  const period = caseData.policyPeriod || caseData.insurancePeriod || "";
  const today = new Date().toLocaleDateString("zh-TW");
  const themeColor = /^#[0-9a-fA-F]{6}$/.test(caseData.theme?.color || "") ? caseData.theme.color : "#fff200";
  const themeText = /^#[0-9a-fA-F]{3,6}$/.test(caseData.theme?.text || "") ? caseData.theme.text : "#111";

  // 被保險人
  const insuredObj = caseData.insured || {};
  const sameAsApplicant = insuredObj.sameAsApplicant !== false;
  const insuredHtml = sameAsApplicant
    ? `<table class="info-table"><tbody><tr><td>要保人同被保險人</td></tr></tbody></table>`
    : `<table class="info-table">
        <colgroup><col style="width:12%"><col style="width:38%"><col style="width:12%"><col style="width:38%"></colgroup>
        <tbody>
          <tr><td class="label">公司名稱</td><td>${esc(insuredObj.companyName || "")}</td><td class="label">統一編號</td><td>${esc(insuredObj.taxId || "")}</td></tr>
          <tr><td class="label">代表人</td><td>${esc(insuredObj.representative || "")}</td><td class="label">電話</td><td>${esc(insuredObj.phone || "")}</td></tr>
          <tr><td class="label">通訊地址</td><td colspan="3">${esc(insuredObj.mailingAddress || insuredObj.address || "")}</td></tr>
        </tbody>
      </table>`;

  // 處所資料：相容多種欄位命名
  function dashIfEmpty(v) {
    const t = String(v ?? "").trim();
    return t === "" ? "-" : t;
  }
  const locations = Array.isArray(caseData.locations) ? caseData.locations : [];
  const locRows = locations.map((loc, i) => {
    const name = loc.name || loc.siteName || loc.locationName || "";
    const locAddr = loc.address || loc.siteAddress || loc.locationAddress || "";
    const area = loc.area || loc.ping || "";
    const usage = loc.usage || loc.usageNature || "";
    const signboard = loc.signboard || "";
    const elevator = loc.elevator || "";
    const paintBooth = loc.paintBooth ?? loc.oven ?? loc.bakingRoom ?? loc.paintOvenCount ?? "";
    const repairShop = loc.repairShop || "";
    const floors = loc.floors || loc.floor || loc.floorCount || "";
    const fireReceiver = loc.fireReceiver || loc.fireAlarmPanel || "";
    const sprinkler = loc.sprinkler || loc.fireSprinkler || "";
    const outdoorParking = loc.outdoorParking || loc.parking || "";
    return `<tr>
      <td style="text-align:center">${i + 1}</td>
      <td>${esc(dashIfEmpty(name))}</td>
      <td>${esc(dashIfEmpty(locAddr))}</td>
      <td style="text-align:right">${esc(dashIfEmpty(area))}</td>
      <td>${esc(dashIfEmpty(usage))}</td>
      <td style="text-align:center">${esc(dashIfEmpty(signboard))}</td>
      <td style="text-align:center">${esc(dashIfEmpty(elevator))}</td>
      <td style="text-align:center">${esc(dashIfEmpty(paintBooth))}</td>
      <td style="text-align:center">${esc(dashIfEmpty(repairShop))}</td>
      <td style="text-align:center">${esc(dashIfEmpty(floors))}</td>
      <td style="text-align:center">${esc(dashIfEmpty(fireReceiver))}</td>
      <td style="text-align:center">${esc(dashIfEmpty(sprinkler))}</td>
      <td style="text-align:center">${esc(dashIfEmpty(outdoorParking))}</td>
    </tr>`;
  }).join("");

  // 報價額度：相容 caseData.limits / caseData.coverages 兩種命名，且不寫死任何金額
  const limitsObj = caseData.limits || caseData.coverages || {};
  const personInjury = limitsObj.personInjury ?? limitsObj.perPersonInjury ?? caseData.limitPersonInjury ?? "";
  const accidentInjury = limitsObj.accidentInjury ?? limitsObj.perAccidentInjury ?? caseData.limitAccidentInjury ?? "";
  const propertyDamage = limitsObj.propertyDamage ?? caseData.limitPropertyDamage ?? "";
  const aggregate = limitsObj.aggregate ?? limitsObj.aggregateLimit ?? caseData.limitAggregate ?? "";
  const deductible = limitsObj.deductible ?? caseData.deductible ?? "";
  const limitRows = [
    ["每一人體傷", personInjury],
    ["每一事故體傷", accidentInjury],
    ["每一事故財損", propertyDamage],
    ["最高賠償限額", aggregate],
    ["自負額", deductible],
  ].map(([label, val]) => `<tr><td class="label" style="width:140px">${esc(label)}</td><td>${esc(dashIfEmpty(val))}</td></tr>`).join("");

  // 附加條款：clauses 可能是純字串陣列，也可能是物件陣列
  const clauseTerms = Array.isArray(caseData.clauses) ? caseData.clauses : [];
  const clauseRows = clauseTerms.map((c, i) => `<li>${esc(clauseText(c))}</li>`).join("") || "<li>無</li>";

  const remarks = caseData.remarks || caseData.notes || "";

  // 保險公司報價（與商火共用同一格式：保險公司 / 保險費(NT$) / 佣金率(%)）
  const insurerQuote = caseData.insurerQuote || {};
  const insurerQuoteHtml = `
<div class="section-title">保險公司報價</div>
<table class="info-table"><tbody>
  <tr><td class="label" style="width:140px">保險公司</td><td>${esc(insurerQuote.insuranceCompany || insurerQuote.company || insurerQuote.insurer || "")}</td></tr>
  <tr><td class="label">保險費(NT$)</td><td>${esc(money(insurerQuote.premium || insurerQuote.fee || ""))}</td></tr>
  <tr><td class="label">佣金率(%)</td><td>${esc(insurerQuote.commissionRate || insurerQuote.commission || "")}</td></tr>
</tbody></table>`;

  const wordPageStyle = forWord ? `
@page WordSection1 {
  size: 841.95pt 595.35pt;
  mso-page-orientation: landscape;
  margin: 22.7pt 22.7pt 22.7pt 22.7pt;
}
div.WordSection1 { page: WordSection1; }` : "";

  const html = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<title>${esc(companyName)}原始報價單</title>
<style>
${wordPageStyle}
@page { size: A4 landscape; margin: 8mm; }
*, *::before, *::after { box-sizing: border-box; }
html, body {
  margin: 0; padding: 0; width: 100%;
  font-family: "Microsoft JhengHei", "Noto Sans TC", Arial, sans-serif;
  font-size: 11px; color: #172438; line-height: 1.4;
}
.document { width: 100%; }
.doc-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px; }
.doc-title { font-size: 16px; font-weight: 700; }
.doc-meta { text-align: right; font-size: 11px; color: #444; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; margin-bottom: 2px; }
th, td { border: 1px solid #b8c4cf; padding: 5px 6px; vertical-align: middle; word-break: normal; overflow-wrap: break-word; font-size: 11px; }
th { background: ${themeColor}; color: ${themeText}; font-weight: 700; text-align: center; }
.label { background: #eef5f9; font-weight: 700; white-space: nowrap; }
.section-title { background: ${themeColor}; color: ${themeText}; font-weight: 700; padding: 6px 8px; border: 1px solid #b8c4cf; margin-top: 8px; margin-bottom: 0; font-size: 12px; }
.info-table td { padding: 5px 8px; }
</style>
</head>
<body>
<div class="${forWord ? "WordSection1 " : ""}document">

<div class="doc-header">
  <div><div class="doc-title">處所公共意外責任保險報價單</div></div>
  <div class="doc-meta">製表日期：${today}</div>
</div>

<div class="section-title">要保人資訊</div>
<table class="info-table">
  <colgroup><col style="width:12%"><col style="width:38%"><col style="width:12%"><col style="width:38%"></colgroup>
  <tbody>
    <tr><td class="label">公司名稱</td><td>${esc(companyName)}</td><td class="label">統一編號</td><td>${esc(taxId)}</td></tr>
    <tr><td class="label">代表人</td><td>${esc(rep)}</td><td class="label">電話</td><td>${esc(tel)}</td></tr>
    <tr><td class="label">通訊地址</td><td colspan="3">${esc(addr)}</td></tr>
    <tr><td class="label">保險期間</td><td colspan="3">${esc(period)}</td></tr>
  </tbody>
</table>

<div class="section-title">被保險人資訊</div>
${insuredHtml}

<div class="section-title">公共意外險處所資料</div>
<table>
  <colgroup>
    <col style="width:3%"><col style="width:10%"><col style="width:16%"><col style="width:6%">
    <col style="width:13%"><col style="width:6%"><col style="width:6%"><col style="width:6%">
    <col style="width:7%"><col style="width:6%"><col style="width:8%"><col style="width:8%"><col style="width:5%">
  </colgroup>
  <thead>
    <tr>
      <th>#</th><th>名稱</th><th>處所地址</th><th>坪數</th><th>使用性質</th><th>招牌</th><th>電梯</th>
      <th>烤漆爐</th><th>修理廠</th><th>樓層</th><th>火災受信總機</th><th>消防撒水系統</th><th>室外停車場</th>
    </tr>
  </thead>
  <tbody>
    ${locRows || `<tr><td colspan="13" style="text-align:center">尚未輸入處所資料</td></tr>`}
  </tbody>
</table>

<div class="section-title">報價額度</div>
<table class="info-table"><tbody>${limitRows}</tbody></table>

<div class="section-title">附加條款</div>
<table class="info-table"><tbody><tr><td><ol style="margin:0;padding-left:18px">${clauseRows}</ol></td></tr></tbody></table>

${remarks ? `
<div class="section-title">備註</div>
<table class="info-table"><tbody>
  <tr><td>${esc(remarks)}</td></tr>
</tbody></table>` : ""}

${insurerQuoteHtml}

</div>
</body>
</html>`;

  return html;
}

// ── 原始報價單分流入口：依險種呼叫對應 builder ────────────

function buildOriginalQuoteHtml(caseData, forWord = false) {
  const type = String(caseData?.insuranceType || "");
  if (type.includes("公共")) {
    return buildLiabilityOriginalQuoteHtml(caseData, forWord);
  }
  return buildFireOriginalQuoteHtml(caseData, forWord);
}

// ── 本機 fallback DB ──────────────────────────────────────

function readLocalDrafts() {
  ensureDir(DATA_DIR);
  if (!fs.existsSync(LOCAL_DB)) {
    fs.writeFileSync(LOCAL_DB, "[]", "utf8");
    return [];
  }
  try { return JSON.parse(fs.readFileSync(LOCAL_DB, "utf8")); }
  catch { return []; }
}

function writeLocalDraft(row) {
  const rows = readLocalDrafts();
  rows.unshift(row);
  fs.writeFileSync(LOCAL_DB, JSON.stringify(rows, null, 2), "utf8");
}

function updateLocalDraft(id, updates) {
  const rows = readLocalDrafts();
  const idx = rows.findIndex(r => r.id === id);
  if (idx === -1) return null;
  rows[idx] = { ...rows[idx], ...updates, updated_at: new Date().toISOString() };
  fs.writeFileSync(LOCAL_DB, JSON.stringify(rows, null, 2), "utf8");
  return rows[idx];
}

function filterLocalDrafts(query) {
  const q = String(query.q || "").trim().toLowerCase();
  const insuranceType = String(query.insuranceType || "").trim();
  return readLocalDrafts().filter(row => {
    const haystack = [row.quote_no, row.company_name, row.tax_id, row.insurance_type].join(" ").toLowerCase();
    if (q && !haystack.includes(q)) return false;
    if (insuranceType && row.insurance_type !== insuranceType) return false;
    return true;
  }).slice(0, 50);
}

// ── PDF 產生（Chrome headless，不含頁首頁尾）────────────

function fileUrl(filePath) { return pathToFileURL(filePath).href; }

function generatePdfWithBrowser(htmlPath, pdfPath) {
  const browsers = CHROME_CANDIDATES.filter(c => fs.existsSync(c));
  if (!browsers.length) return Promise.resolve({ ok: false, reason: "Chrome/Edge executable not found" });

  const { execFile } = require("child_process");

  function run(browser) {
    const userDataDir = path.join(os.tmpdir(), `ins-pdf-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    ensureDir(userDataDir);
    const args = [
      "--headless=new",
      "--disable-gpu",
      "--disable-gpu-sandbox",
      "--disable-dev-shm-usage",
      "--disable-extensions",
      "--disable-background-networking",
      "--no-first-run",
      "--no-default-browser-check",
      "--print-to-pdf-no-header",         // 移除瀏覽器頁首頁尾
      `--user-data-dir=${userDataDir}`,
      `--print-to-pdf=${pdfPath}`,
      fileUrl(htmlPath)
    ];
    return new Promise(resolve => {
      execFile(browser, args, { timeout: PDF_RENDER_TIMEOUT_MS }, error => {
        try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) {}
        if (error) return resolve({ ok: false, browser, reason: error.message });
        resolve({ ok: fs.existsSync(pdfPath), browser, reason: fs.existsSync(pdfPath) ? null : "PDF file was not created" });
      });
    });
  }

  return browsers.reduce(
    (chain, browser) => chain.then(async result => result?.ok ? result : run(browser)),
    Promise.resolve(null)
  ).then(result => result || { ok: false, reason: "PDF generation did not run" });
}

// ── Supabase / 本機 CRUD ──────────────────────────────────

const VALID_STATUSES = ["draft","sent_to_insurer","received_quotes","summary_completed","waiting_customer","converted","cancelled"];

async function insertDraft(row) {
  if (supabase) {
    const { data, error } = await supabase.from("quote_drafts").insert(row).select("*").single();
    if (error) throw error;
    return { provider: "supabase", data };
  }
  if (!LOCAL_DEV_FALLBACK) {
    const err = new Error("Supabase 尚未設定。請填入 SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY，或設 LOCAL_DEV_FALLBACK=true。");
    err.status = 503; throw err;
  }
  const localRow = { id: `local-${Date.now()}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...row };
  writeLocalDraft(localRow);
  return { provider: "local_dev_fallback", data: localRow };
}

async function searchDrafts(query) {
  if (supabase) {
    let builder = supabase.from("quote_drafts")
      .select("id,quote_no,company_name,tax_id,insurance_type,insurance_period,status,archive_path,created_at,case_data")
      .order("created_at", { ascending: false }).limit(50);
    if (query.insuranceType) builder = builder.eq("insurance_type", query.insuranceType);
    if (query.q) {
      const q = `%${String(query.q).trim()}%`;
      builder = builder.or(`company_name.ilike.${q},tax_id.ilike.${q},quote_no.ilike.${q}`);
    }
    const { data, error } = await builder;
    if (error) throw error;
    return { provider: "supabase", data };
  }
  return { provider: "local_dev_fallback", data: filterLocalDrafts(query) };
}

async function patchDraftStatus(id, status) {
  if (!VALID_STATUSES.includes(status)) {
    const err = new Error(`無效的 status 值：${status}`); err.status = 400; throw err;
  }
  if (supabase) {
    const { data, error } = await supabase.from("quote_drafts")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id).select("id,quote_no,company_name,status,updated_at").single();
    if (error) throw error;
    if (!data) { const err = new Error("找不到該案件"); err.status = 404; throw err; }
    return { provider: "supabase", data };
  }
  if (!LOCAL_DEV_FALLBACK) {
    const err = new Error("Supabase 尚未設定。"); err.status = 503; throw err;
  }
  const updated = updateLocalDraft(id, { status });
  if (!updated) { const err = new Error("找不到該案件（本機）"); err.status = 404; throw err; }
  return { provider: "local_dev_fallback", data: updated };
}

async function getDraftById(id) {
  if (supabase) {
    const { data, error } = await supabase.from("quote_drafts").select("*").eq("id", id).single();
    if (error) return null;
    return data;
  }
  const rows = readLocalDrafts();
  return rows.find(r => r.id === id) || null;
}

async function updateDraftRecord(id, row) {
  if (supabase) {
    const { data, error } = await supabase.from("quote_drafts")
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq("id", id).select("*").single();
    if (error) throw error;
    if (!data) { const err = new Error("找不到該案件"); err.status = 404; throw err; }
    return { provider: "supabase", data };
  }
  if (!LOCAL_DEV_FALLBACK) {
    const err = new Error("Supabase 尚未設定。"); err.status = 503; throw err;
  }
  const updated = updateLocalDraft(id, row);
  if (!updated) { const err = new Error("找不到該案件（本機）"); err.status = 404; throw err; }
  return { provider: "local_dev_fallback", data: updated };
}

// ── 共用：把 caseData + 寫檔結果組成要存進 database 的 row（新增與更新都呼叫這個）
function buildDraftRow(caseData, caseInfo, fileResult) {
  const now = new Date();
  const prefix = quoteNoPrefix(caseData);
  const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const timePart = `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  const quoteNo = caseData.quoteNo || `${prefix}-${datePart}-${timePart}`;
  const caseIdentity = buildCaseIdentity(caseData);

  return {
    quote_no: quoteNo,
    company_name: caseData.applicant?.companyName || caseData.companyName || "",
    tax_id: caseData.applicant?.taxId || caseData.taxId || "",
    insurance_type: caseData.insuranceType || caseInfo.typeName,
    insurance_period: caseData.policyPeriod || caseData.insurancePeriod || "",
    policy_start_date: toIsoDate(caseInfo.startDate),
    policy_end_date: null,
    locations: caseInfo.locations,
    status: "draft",
    archive_path: caseInfo.caseDir,
    case_folder_name: caseInfo.caseFolderName,
    company_folder: caseInfo.companyDir,
    year_folder: caseInfo.yearDir,
    original_quote_html_path: null,
    original_quote_word_path: fileResult.wordPath,
    original_quote_pdf_path: fileResult.pdfPath,
    case_data: {
      ...caseData,
      archive: {
        root: ARCHIVE_ROOT,
        companyDir: caseInfo.companyDir,
        yearDir: caseInfo.yearDir,
        path: caseInfo.caseDir,
        caseFolderName: caseInfo.caseFolderName,
        caseIdentity,
        originalQuoteHtmlPath: null,
        originalQuoteWordPath: fileResult.wordPath,
        originalQuotePdfPath: fileResult.pdfPath,
        originalQuotePdfStatus: fileResult.pdfResult,
        caseDataPath: fileResult.caseDataPath
      }
    }

  };
}

// ── API 路由 ──────────────────────────────────────────────

app.get("/api/health", (req, res) => {
  const mode = supabaseEnabled ? "supabase" : (LOCAL_DEV_FALLBACK ? "local_fallback" : "no_storage");
  res.json({ ok: true, supabaseEnabled, localDevFallback: LOCAL_DEV_FALLBACK, mode, archiveRoot: ARCHIVE_ROOT });
});

async function createQuoteDraftAsNew(caseData, res, options = {}) {
  const identityChanged = Boolean(options.identityChanged);
  const previousDraftId = options.previousDraftId || null;

  console.log(identityChanged
    ? "[QUOTE SAVE] method = PUT → identity changed, create NEW case"
    : "[QUOTE SAVE] method = POST（新增案件，currentDraftId 為 null）");
  console.log("[QUOTE SAVE] company =", caseData?.applicant?.companyName || caseData?.companyName || "(空白)");
  console.log("[QUOTE SAVE] insuranceType =", caseData?.insuranceType || "(未指定)");

  const caseInfo = ArchiveManager.createNewCase(caseData);
  console.log("[QUOTE SAVE] 公司資料夾 =", caseInfo.companyDir);
  console.log("[QUOTE SAVE] 年度資料夾 =", caseInfo.yearDir);
  console.log("[QUOTE SAVE] 新建案件資料夾 =", caseInfo.caseDir, `（${caseInfo.caseFolderName}）`);
  console.log("[QUOTE SAVE] 檔名 =", caseInfo.fileBaseName);

  const fileResult = await ArchiveManager.saveCaseFiles(caseData, caseInfo.caseDir, caseInfo.fileBaseName);
  const row = buildDraftRow(caseData, caseInfo, fileResult);
  const result = await insertDraft(row);

  res.json({
    ok: true,
    provider: result.provider,
    draft: result.data,
    draftId: result.data?.id,
    identityChanged,
    previousDraftId,
    caseFolderName: caseInfo.caseFolderName,
    archive: {
      path: caseInfo.caseDir,
      paths: { word: fileResult.wordPath, pdf: fileResult.pdfPath, json: fileResult.caseDataPath, html: null },
      pdfStatus: fileResult.pdfResult
    }
  });
}

// POST /api/quote-drafts — 新增案件（沒有 draftId 時呼叫）
app.post("/api/quote-drafts", async (req, res, next) => {
  try {
    const caseData = req.body?.caseData;
    if (!caseData || typeof caseData !== "object") {
      return res.status(400).json({ error: "caseData is required" });
    }
    await createQuoteDraftAsNew(caseData, res);
  } catch (error) {
    next(error);
  }
});

// PUT /api/quote-drafts/:id — 更新既有案件（currentDraftId 存在時呼叫，代表修改案件不是新增）
// 規則：先比對 CaseIdentity。完全相同才覆蓋；任一身分欄位不同就新增案件。
// 絕不 rename、絕不搬移舊案件資料夾。
app.put("/api/quote-drafts/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const caseData = req.body?.caseData;
    if (!caseData || typeof caseData !== "object") {
      return res.status(400).json({ error: "caseData is required" });
    }

    const existing = await getDraftById(id);
    if (!existing) {
      const err = new Error(`找不到案件 id=${id}，無法更新`);
      err.status = 404;
      throw err;
    }

    console.log("[QUOTE SAVE] method = PUT（嘗試修改既有案件）");
    console.log("[QUOTE SAVE] id =", id);
    console.log("[QUOTE SAVE] company =", caseData?.applicant?.companyName || caseData?.companyName || "(空白)");
    console.log("[QUOTE SAVE] insuranceType =", caseData?.insuranceType || "(未指定)");
    console.log("[QUOTE SAVE] 案件資料夾 =", existing.archive_path);

    const oldIdentity = existing.case_data ? buildCaseIdentity(existing.case_data) : existing.case_data?.archive?.caseIdentity;
    const newIdentity = buildCaseIdentity(caseData);
    if (!isSameCaseIdentity(oldIdentity, newIdentity)) {
      console.log("[QUOTE SAVE] 案件身分已變更，不覆蓋、不搬移，改建立新案件資料夾");
      console.log("[QUOTE SAVE] oldIdentity =", JSON.stringify(oldIdentity));
      console.log("[QUOTE SAVE] newIdentity =", JSON.stringify(newIdentity));
      return createQuoteDraftAsNew(caseData, res, { identityChanged: true, previousDraftId: id });
    }

    console.log("[QUOTE SAVE] ✓ 案件身分相同，覆蓋原案件資料夾");

    // 修改案件：全部透過 ArchiveManager 完成（沿用既有 caseDir，不重新計算路徑）
    const caseInfo = ArchiveManager.getExistingCase(existing, caseData);
    console.log("[QUOTE SAVE] 檔名 =", caseInfo.fileBaseName);

    const fileResult = await ArchiveManager.saveCaseFiles(caseData, caseInfo.caseDir, caseInfo.fileBaseName);
    const row = buildDraftRow(caseData, caseInfo, fileResult);

    const result = await updateDraftRecord(id, row);
    res.json({
      ok: true,
      provider: result.provider,
      draft: result.data,
      draftId: id,
      identityChanged: false,
      caseFolderName: caseInfo.caseFolderName,
      archive: {
        path: caseInfo.caseDir,
        paths: { word: fileResult.wordPath, pdf: fileResult.pdfPath, json: fileResult.caseDataPath, html: null },
        pdfStatus: fileResult.pdfResult
      }
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/quote-drafts
app.get("/api/quote-drafts", async (req, res, next) => {
  try {
    const result = await searchDrafts(req.query);
    res.json({ ok: true, ...result });
  } catch (error) { next(error); }
});

// PATCH /api/quote-drafts/:id/status
app.patch("/api/quote-drafts/:id/status", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: "status is required" });
    const result = await patchDraftStatus(id, status);
    res.json({ ok: true, ...result });
  } catch (error) { next(error); }
});

// ── 錯誤處理 ──────────────────────────────────────────────

app.use((error, req, res, next) => {
  console.error("[ERROR]", error.message, error.details || "");
  res.status(error.status || 500).json({
    error: error.message || "Internal Server Error",
    details: error.details || null,
    hint: error.hint || null
  });
});

app.listen(PORT, () => {
  console.log(`\nInsurance Case Platform API listening on http://localhost:${PORT}`);
  console.log(`Supabase enabled = ${supabaseEnabled}`);
  if (!supabaseEnabled) {
    const url = (process.env.SUPABASE_URL || "").trim();
    const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
    if (url.includes("your-project") || key.includes("your-service-role-key")) {
      console.log("Supabase config invalid, using local fallback.");
    }
    if (!LOCAL_DEV_FALLBACK) {
      console.log("Supabase disabled and LOCAL_DEV_FALLBACK is not true. API writes will return 503.");
    }
  }
  console.log(`Local fallback enabled = ${LOCAL_DEV_FALLBACK}`);
  console.log(`Archive root = ${ARCHIVE_ROOT}`);
  console.log(`Archive root 來源 = ${
    loadArchiveRootFromConfig() ? "config.json（自訂路徑）"
    : "桌面預設路徑（Desktop\\保險報價案件，強制固定，不受 .env 殘留設定影響）"
  }`);
  console.log("");
});




