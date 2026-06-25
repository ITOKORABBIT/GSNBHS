// ============================================================
// HPNBHS + 美食地圖 合併版 Apps Script
// 部署方式：Google Apps Script → 部署 → 管理部署 → 更新至最新版本
//           部署類型：Web App，執行身分：我，存取：所有人
// ============================================================

function scriptConfig_() {
  var raw =
    PropertiesService.getScriptProperties().getProperty("GSNBHS_CONFIG_JSON");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error(
      "[scriptConfig_] GSNBHS_CONFIG_JSON parse error",
      e.toString(),
    );
    return {};
  }
}

var SCRIPT_CONFIG = scriptConfig_();

function scriptProp_(name, fallback) {
  var value = PropertiesService.getScriptProperties().getProperty(name);
  return value || SCRIPT_CONFIG[name] || fallback || "";
}

var SHEET_ID = scriptProp_("GSNBHS_SHEET_ID");
var SHEET_CASES = "案件清單";
var SHEET_STORES = "商店清單";
var SHEET_ADMINS = "管理員名單";
var SHEET_BULLETIN = "公佈欄";
var SHEET_RESIDENT_NOTES = "里民備註";
var SHEET_SURVEY_WALKIN_ATTENDANCE = "問券現場參加";

var GOOGLE_CLIENT_ID = scriptProp_("GSNBHS_GOOGLE_CLIENT_ID");
var REPORT_WEBHOOK_URL = scriptProp_("GSNBHS_REPORT_WEBHOOK_URL");
var DETAIL_BASE_URL = "https://gsnbhs.pages.dev/detail.html?id=";
var SURVEY_BASE_URL = "https://gsnbhs.pages.dev/survey";
var DEFAULT_REPORT_IMAGE_URL = "https://gsnbhs.pages.dev/assets/no-photo.svg";
var NBH_FOLDER_ID = scriptProp_("GSNBHS_NBH_FOLDER_ID"); // Photos/NBH — 里民通報照片
var STOR_FOLDER_ID = scriptProp_("GSNBHS_STOR_FOLDER_ID"); // Photos/STOR — 美食地圖商家照片
var BULLETIN_FOLDER_ID = scriptProp_("GSNBHS_BULLETIN_FOLDER_ID"); // Photos/BULLETIN — 公佈欄公告圖片
var SHEET_EVENTS = "活動清單";
var SHEET_SURVEYS = "問券清單";
var EVENT_IMG_FOLDER_ID = "13BP2StVXtnj49thEktezfjrs2uI1slT_";
var SRV_SESSION_PREFIX = "srv_session_";
var SRV_SESSION_TTL_SEC = 60 * 60 * 2; // 2 小時
var EVT_COL = {
  eventId: 1,
  eventName: 2,
  eventDate: 3,
  eventLocation: 4,
  description: 5,
  imageUrl: 6,
  status: 7,
  quota: 8,
  registeredCount: 9,
  requireConsent: 10,
  questions: 11,
  registrationSheet: 12,
  createdAt: 13,
  updatedAt: 14,
  createdBy: 15,
  registrationStart: 16,
  registrationEnd: 17,
  eventStart: 18,
  eventEnd: 19,
  mapUrl: 20,
  surveyId: 21,
  surveyTarget: 22,
  surveySentAt: 23,
  surveyDelay: 24,
};
var SESSION_TTL = 2592000;
var PUBLIC_CACHE_TTL = 60; // 公開頁面快取秒數
var PUBLIC_FORM_MIN_MS = 3000;
var PUBLIC_FORM_MAX_MS = 2 * 60 * 60 * 1000;
var PUBLIC_SUBMIT_COOLDOWN = 300;
var UPLOAD_RATE_LIMIT = 10;
var UPLOAD_RATE_WINDOW = 60;
var SCRIPT_CACHE_ = CacheService.getScriptCache();
var SCRIPT_PROPS_ = PropertiesService.getScriptProperties();
var LINE_CHANNEL_ACCESS_TOKEN_ =
  SCRIPT_PROPS_.getProperty("LINE_CHANNEL_ACCESS_TOKEN") ||
  SCRIPT_CONFIG.LINE_CHANNEL_ACCESS_TOKEN ||
  "";
var LINE_WEBHOOK_TOKEN_ =
  scriptProp_("GSNBHS_LINE_WEBHOOK_TOKEN") || scriptProp_("LINE_WEBHOOK_TOKEN");

// ══════════════════════════════════════════════
// 公開快取工具
// ══════════════════════════════════════════════

function invalidatePublicCache_(keys) {
  SCRIPT_CACHE_.removeAll(keys);
}

function invalidateEventCaches_(eventId) {
  var keys = ["pub_events"];
  if (eventId) {
    keys.push("evt_ctx_" + eventId);
    keys.push("evt_stats_" + eventId);
    keys.push("evt_regs_" + eventId);
  }
  invalidatePublicCache_(keys);
}

// 定時暖機（每 5 分鐘由 trigger 呼叫，防止 GAS 容器冷啟動）
// 設定方式：在 GAS 編輯器執行一次 setupKeepWarmTrigger()
function keepWarm() {
  CacheService.getScriptCache().put("_kw", "1", 300);
}

function setupKeepWarmTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "keepWarm") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger("keepWarm").timeBased().everyMinutes(5).create();
  Logger.log("keepWarm trigger 已設定，每 5 分鐘執行一次");
}

// ── 路由 ──
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    // ── LINE Webhook 入口（事件由 events 陣列判斷）──
    if (data.events && Array.isArray(data.events)) {
      if (!isValidLineWebhookRequest_(e)) {
        return jsonOut({ success: false, error: "Forbidden", code: 403 });
      }
      return handleLineWebhook(data);
    }

    switch (data.action) {
      // ── 通用 ──
      case "login":
        return handleLogin(data);
      case "refreshSession":
        return handleRefreshSession(data);
      case "submitReport":
        return handleSubmitReport(data);
      // ── 里民通報系統 ──
      case "getCases":
        return requireAdmin(data, handleGetCases);
      case "getCase":
        return requireAdmin(data, handleGetCase);
      case "updateReply":
        return requireAdmin(data, handleUpdateReply);
      case "uploadAdminPhoto":
        return requireAdmin(data, handleUploadPhoto);
      case "uploadBulletinImage":
        return requireAdmin(data, handleUploadBulletinImage);
      case "uploadReportPhoto":
        return handleReportPhotoUpload(data, e);
      case "uploadStorePhoto":
        return handleStorePublicUpload(data, e);
      // ── 活動報名系統 ──
      case "getEvents":
        return requireAdmin(data, handleGetEvents);
      case "getEvent":
        return requireAdmin(data, handleGetEvent);
      case "createEvent":
        return requireAdmin(data, handleCreateEvent);
      case "updateEvent":
        return requireAdmin(data, handleUpdateEvent);
      case "deleteEvent":
        return requireAdmin(data, handleDeleteEvent);
      case "updateEventStatus":
        return requireAdmin(data, handleUpdateEventStatus);
      case "getRegistrations":
        return requireAdmin(data, handleGetRegistrations);
      case "updateRegistration":
        return requireAdmin(data, handleUpdateRegistration);
      case "deleteRegistration":
        return requireAdmin(data, handleDeleteRegistration);
      case "checkInRegistration":
        return requireAdmin(data, handleCheckInRegistration);
      case "getEventStats":
        return requireAdmin(data, handleGetEventStats);
      case "uploadEventImage":
        return requireAdmin(data, handleUploadEventImage);
      // ── 問券系統 ──
      case "getSurveys":
        return requireAdmin(data, handleGetSurveys);
      case "getSurvey":
        return requireAdmin(data, handleGetSurvey);
      case "getSurveyPublic":
        return handleGetSurveyPublic(data);
      case "createSurvey":
        return requireAdmin(data, handleCreateSurvey);
      case "updateSurvey":
        return requireAdmin(data, handleUpdateSurvey);
      case "deleteSurvey":
        return requireAdmin(data, handleDeleteSurvey);
      case "submitRegistration":
        return handleSubmitRegistration(data);
      case "submitSurveyResponse":
        return handleSubmitSurveyResponse(data);
      case "getSurveyResponses":
        return requireAdmin(data, handleGetSurveyResponses);
      case "updateSurveyResidentNote":
        return requireAdmin(data, handleUpdateSurveyResidentNote);
      case "addSurveyWalkInAttendance":
        return requireAdmin(data, handleAddSurveyWalkInAttendance);
      case "getLineUserRegistrationHistory":
        return requireAdmin(data, handleGetLineUserRegistrationHistory);
      // ── 置頂功能 ──
      case "pinCase":
        return requireAdmin(data, handlePinCase);
      case "reorderCases":
        return requireAdmin(data, handleReorderCases);
      case "getAdmins":
        return requireSuperAdmin(data, handleGetAdmins);
      case "addAdmin":
        return requireSuperAdmin(data, handleAddAdmin);
      case "updateAdmin":
        return requireSuperAdmin(data, handleUpdateAdmin);
      case "deleteAdmin":
        return requireSuperAdmin(data, handleDeleteAdmin);
      default:
        return jsonOut({ success: false, error: "Unknown action" });
    }
  } catch (err) {
    console.error("[doPost error]", err.toString());
    return jsonOut({ success: false, error: "伺服器錯誤，請稍後再試" });
  }
}

function doGet(e) {
  return jsonOut({ success: false, error: "POST only" });
}

// ══════════════════════════════════════════════
// AUTH — 登入 & Session 管理
// ══════════════════════════════════════════════

function handleLogin(data) {
  var idToken = data.id_token;
  if (!idToken) return jsonOut({ success: false, error: "Missing id_token" });

  var payload = verifyGoogleToken(idToken);
  if (!payload) return jsonOut({ success: false, error: "Invalid token" });

  var email = (payload.email || "").toLowerCase().trim();
  var admin = checkAdmin(email);
  if (!admin.valid) return jsonOut({ success: false, error: "Not authorized" });

  var sessionToken = Utilities.getUuid();
  CacheService.getScriptCache().put(
    "sess_" + sessionToken,
    JSON.stringify({ email: email, name: admin.name, role: admin.role || "" }),
    SESSION_TTL,
  );

  return jsonOut({
    success: true,
    sessionToken: sessionToken,
    name: admin.name,
    email: email,
    role: admin.role || "",
  });
}

function verifyGoogleToken(idToken) {
  try {
    var url =
      "https://oauth2.googleapis.com/tokeninfo?id_token=" +
      encodeURIComponent(idToken);
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;
    var p = JSON.parse(res.getContentText());
    if (p.aud !== GOOGLE_CLIENT_ID) return null;
    if (p.email_verified === "false") return null;
    return p;
  } catch (e) {
    return null;
  }
}

function checkAdmin(email) {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_ADMINS);
  if (!sheet) return { valid: false };
  var data = sheet.getDataRange().getValues();
  // 管理員名單欄位（刪除 username/password 後）:
  // A(0)=display_name, B(1)=role, C(2)=active, D(3)=email
  for (var i = 1; i < data.length; i++) {
    var rowEmail = String(data[i][3] || "")
      .toLowerCase()
      .trim();
    var active = String(data[i][2] || "").toUpperCase();
    if (rowEmail === email && active === "TRUE") {
      return {
        valid: true,
        name: String(data[i][0] || ""),
        role: String(data[i][1] || ""),
      };
    }
  }
  return { valid: false };
}

function getSession(token) {
  if (!token) return null;
  var raw = CacheService.getScriptCache().get("sess_" + token);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function handleRefreshSession(data) {
  var sess = getSession(data.sessionToken);
  if (!sess)
    return jsonOut({ success: false, error: "Unauthorized", code: 401 });
  // 延長 TTL：重新寫入同一個 sessionToken
  CacheService.getScriptCache().put(
    "sess_" + data.sessionToken,
    JSON.stringify(sess),
    SESSION_TTL,
  );
  return jsonOut({ success: true });
}

function requireAdmin(data, handler) {
  var sess = getSession(data.sessionToken);
  if (!sess)
    return jsonOut({ success: false, error: "Unauthorized", code: 401 });
  data._session = sess;
  return handler(data);
}

function requireSuperAdmin(data, handler) {
  var sess = getSession(data.sessionToken);
  if (!sess)
    return jsonOut({ success: false, error: "Unauthorized", code: 401 });
  if (!isSuperAdminRole(sess.role))
    return jsonOut({ success: false, error: "Forbidden", code: 403 });
  data._session = sess;
  return handler(data);
}

function isValidLineWebhookRequest_(e) {
  if (!LINE_WEBHOOK_TOKEN_) {
    console.warn(
      "[line] GSNBHS_LINE_WEBHOOK_TOKEN 未設定，LINE webhook 仍接受未帶 token 的請求",
    );
    return true;
  }
  var p = (e && e.parameter) || {};
  return String(p.lineToken || p.token || "") === String(LINE_WEBHOOK_TOKEN_);
}

function normalizePublicUrl_(url) {
  var text = String(url || "").trim();
  if (!text) return "";
  if (!/^https?:\/\//i.test(text)) return "";
  return text;
}

function isSuperAdminRole(role) {
  var text = String(role || "").toLowerCase();
  return (
    text.indexOf("super") !== -1 ||
    text.indexOf("owner") !== -1 ||
    text.indexOf("root") !== -1 ||
    text.indexOf("超級") !== -1
  );
}

// ══════════════════════════════════════════════
// 里民通報系統 — 公開送出通報
// ══════════════════════════════════════════════

function handleSubmitReport(data) {
  var validationError = validatePublicReport_(data);
  if (validationError)
    return jsonOut({ success: false, error: validationError });

  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_CASES);
  if (!sheet) return jsonOut({ success: false, error: "Sheet not found" });

  var now = new Date();
  var nowText = Utilities.formatDate(now, "Asia/Taipei", "yyyy-MM-dd HH:mm");
  var caseId = nextCaseId_(sheet, "HP");
  var replyUrl = buildDetailUrl_(caseId);
  var photos = [
    String(data.photo1 || ""),
    String(data.photo2 || ""),
    String(data.photo3 || ""),
    String(data.photo4 || ""),
    String(data.photo5 || ""),
  ];
  var phoneText = toSheetText_(data.phone);
  var lineIdText = toSheetText_(data.lineId);

  sheet.appendRow([
    caseId,
    nowText,
    "新案件",
    String(data.cate || "").trim(),
    String(data.name || "").trim(),
    phoneText,
    lineIdText,
    String(data.title || "").trim(),
    String(data.desc || "").trim(),
    String(data.addr || "").trim(),
    String(data.map || "").trim(),
    String(data.case1999 || data["1999"] || "").trim(),
    photos[0],
    photos[1],
    photos[2],
    photos[3],
    photos[4],
    "",
    nowText,
    "", // replyTime, lastUpdate, replyContent
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "", // repPhoto1-10
    "",
    "",
    "FALSE",
    "",
    "",
    "",
    "",
    replyUrl,
    0, // handler, note, publicFlag…publicSummary, replyUrl, pinOrder
  ]);

  notifyNewReport_({
    caseId: caseId,
    reportTime: nowText,
    status: "新案件",
    cate: String(data.cate || "").trim(),
    name: String(data.name || "").trim(),
    phone: String(data.phone || "").trim(),
    lineId: String(data.lineId || "").trim(),
    title: String(data.title || "").trim(),
    desc: String(data.desc || "").trim(),
    addr: String(data.addr || "").trim(),
    map: String(data.map || "").trim(),
    case1999: String(data.case1999 || data["1999"] || "").trim(),
    photo1: photos[0] || DEFAULT_REPORT_IMAGE_URL,
    photo2: photos[1],
    photo3: photos[2],
    photo4: photos[3],
    photo5: photos[4],
    replyUrl: replyUrl,
    detailUrl: replyUrl,
  });

  return jsonOut({ success: true, caseId: caseId });
}

function validatePublicReport_(data) {
  if (String(data.website || "").trim()) return "bot_rejected";

  var formTs = parseInt(data.formTs || "0", 10);
  var elapsed = Date.now() - formTs;
  if (!formTs || elapsed < PUBLIC_FORM_MIN_MS || elapsed > PUBLIC_FORM_MAX_MS)
    return "form_expired";

  var requiredFields = ["name", "phone", "cate", "title", "desc", "addr"];
  for (var i = 0; i < requiredFields.length; i++) {
    if (!String(data[requiredFields[i]] || "").trim())
      return "missing_required_fields";
  }

  var phone = normalizePhone_(data.phone);
  if (!phone || phone.length < 8) return "invalid_phone";

  var title = String(data.title || "").trim();
  var addr = String(data.addr || "").trim();
  var rawKey = phone + "|" + title + "|" + addr;
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    rawKey,
    Utilities.Charset.UTF_8,
  );
  var dedupeKey =
    "r_" + Utilities.base64EncodeWebSafe(digest).replace(/=/g, "");
  var cache = CacheService.getScriptCache();
  if (cache.get(dedupeKey)) return "too_many_requests";
  cache.put(dedupeKey, "1", PUBLIC_SUBMIT_COOLDOWN);

  return "";
}

function normalizePhone_(phone) {
  return String(phone || "").replace(/[^\d]/g, "");
}

function toSheetText_(value) {
  var text = String(value || "").trim();
  return text ? "'" + text : "";
}

function nextCaseId_(sheet, prefix) {
  var all = sheet.getDataRange().getValues();
  var datePart = Utilities.formatDate(new Date(), "Asia/Taipei", "yyMMdd");
  var monthPart = datePart.substring(0, 4);
  var maxNum = 0;
  var idPattern = new RegExp(
    "^" + String(prefix || "HP") + "-?" + monthPart + "\\d{2}(\\d{3})$",
  );
  for (var i = 1; i < all.length; i++) {
    var candidates = [all[i][0], all[i][28]];
    for (var j = 0; j < candidates.length; j++) {
      var match = String(candidates[j] || "").match(idPattern);
      if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10) || 0);
    }
  }
  return (
    String(prefix || "HP") +
    datePart +
    Utilities.formatString("%03d", maxNum + 1)
  );
}

function buildDetailUrl_(caseId) {
  return DETAIL_BASE_URL + encodeURIComponent(String(caseId || ""));
}

function uploadPublicReportPhotos_(photos, caseId) {
  var result = ["", "", "", "", ""];
  var items = Array.isArray(photos) ? photos.slice(0, 5) : [];
  for (var i = 0; i < items.length; i++) {
    if (!items[i] || !items[i].base64) continue;
    try {
      result[i] = createUploadedFileUrl_(
        items[i].base64,
        items[i].mimeType || "image/jpeg",
        NBH_FOLDER_ID,
        String(caseId || "report") + "_" + (i + 1),
      );
    } catch (e) {
      console.error("[uploadPublicReportPhotos_]", e.toString());
    }
  }
  return result;
}

function notifyNewReport_(payload) {
  if (!REPORT_WEBHOOK_URL) return;
  try {
    UrlFetchApp.fetch(REPORT_WEBHOOK_URL, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
  } catch (err) {
    console.error("[notifyNewReport_]", err.toString());
  }
}

function createUploadedFileUrl_(base64, mimeType, folderId, fileNamePrefix) {
  if (!folderId) throw new Error("Folder ID not configured");
  var normalizedMime = String(mimeType || "image/jpeg")
    .toLowerCase()
    .split(";")[0]
    .trim();
  if (!ALLOWED_MIME[normalizedMime]) throw new Error("不支援的檔案類型");
  var ext = ALLOWED_MIME[normalizedMime];
  var safePrefix = String(fileNamePrefix || "photo").replace(
    /[^a-zA-Z0-9_-]/g,
    "_",
  );
  var fileName = safePrefix + "_" + new Date().getTime() + "." + ext;
  var b64 = String(base64 || "").replace(/^data:image\/\w+;base64,/, "");
  var blob = Utilities.newBlob(
    Utilities.base64Decode(b64),
    normalizedMime,
    fileName,
  );
  if (blob.getBytes().length > 5 * 1024 * 1024)
    throw new Error("檔案太大（上限 5MB）");
  var folder = DriveApp.getFolderById(folderId);
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return "https://lh3.googleusercontent.com/d/" + file.getId();
}

function handleGetCases(data) {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_CASES);
  if (!sheet) return jsonOut({ success: false, error: "Sheet not found" });
  var all = sheet.getDataRange().getValues();
  var cases = [];
  for (var i = 1; i < all.length; i++) {
    if (!all[i][0]) continue;
    cases.push(rowToCase(all[i]));
  }
  // 分頁支援：傳入 limit/offset 時只回傳該段，未傳則回傳全部（向下相容）
  var limit = parseInt(data.limit || "0", 10);
  var offset = parseInt(data.offset || "0", 10);
  var total = cases.length;
  if (limit > 0) {
    cases = cases.slice(offset, offset + limit);
    return jsonOut({
      success: true,
      cases: cases,
      total: total,
      offset: offset,
      limit: limit,
    });
  }
  return jsonOut({ success: true, cases: cases, total: total });
}

function handleGetCase(data) {
  var caseId = String(data.caseId || "");
  if (!caseId) return jsonOut({ success: false, error: "Missing caseId" });
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_CASES);
  if (!sheet) return jsonOut({ success: false, error: "Sheet not found" });
  var all = sheet.getDataRange().getValues();
  for (var i = 1; i < all.length; i++) {
    if (String(all[i][0]) === caseId) {
      return jsonOut({ success: true, caseData: rowToCase(all[i]) });
    }
  }
  return jsonOut({ success: false, error: "找不到案件: " + caseId });
}

function rowToCase(r) {
  return {
    caseId: String(r[0] || ""),
    reportTime: fmtDate(r[1]),
    status: String(r[2] || ""),
    category: String(r[3] || ""),
    name: String(r[4] || ""),
    phone: String(r[5] || ""),
    lineId: String(r[6] || ""),
    title: String(r[7] || ""),
    desc: String(r[8] || ""),
    addr: String(r[9] || ""),
    mapUrl: String(r[10] || ""),
    case1999: String(r[11] || ""),
    photo1: String(r[12] || ""),
    photo2: String(r[13] || ""),
    photo3: String(r[14] || ""),
    photo4: String(r[15] || ""),
    photo5: String(r[16] || ""),
    replyTime: fmtDate(r[17]),
    lastUpdate: fmtDate(r[18]),
    replyContent: String(r[19] || ""),
    repPhoto1: String(r[20] || ""),
    repPhoto2: String(r[21] || ""),
    repPhoto3: String(r[22] || ""),
    repPhoto4: String(r[23] || ""),
    repPhoto5: String(r[24] || ""),
    repPhoto6: String(r[25] || ""),
    repPhoto7: String(r[26] || ""),
    repPhoto8: String(r[27] || ""),
    repPhoto9: String(r[28] || ""),
    repPhoto10: String(r[29] || ""),
    handler: String(r[30] || ""),
    note: String(r[31] || ""),
    publicFlag: String(r[32] || ""),
    publicTitle: String(r[33] || ""),
    publicCate: String(r[34] || ""),
    publicLoc: String(r[35] || ""),
    publicSummary: String(r[36] || ""),
    replyUrl: String(r[37] || ""),
    pinOrder: Number(r[38] || 0), // AM欄：置頂順序（0=不置頂）
    sortOrder: Number(r[39] || 0), // AN欄：自訂顯示排序（0=未設定）
  };
}

// ══════════════════════════════════════════════
// 里民通報系統 — 里長回覆更新
// ══════════════════════════════════════════════

function handleUpdateReply(data) {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_CASES);
  if (!sheet) return jsonOut({ success: false, error: "Sheet not found" });

  var all = sheet.getDataRange().getValues();
  var rowIndex = -1;
  for (var i = 1; i < all.length; i++) {
    if (String(all[i][0]) === String(data.caseId)) {
      rowIndex = i + 1;
      break;
    }
  }
  if (rowIndex === -1)
    return jsonOut({ success: false, error: "找不到案件: " + data.caseId });

  var now = Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy-MM-dd HH:mm");
  var existingReplyTime = all[rowIndex - 1][17];

  sheet.getRange(rowIndex, 3).setValue(data.status || "");
  sheet
    .getRange(rowIndex, 18)
    .setValue(existingReplyTime ? existingReplyTime : now);
  sheet.getRange(rowIndex, 19).setValue(now);
  sheet.getRange(rowIndex, 20).setValue(data.reply_content || "");
  sheet.getRange(rowIndex, 21).setValue(data.reply_photo1 || "");
  sheet.getRange(rowIndex, 22).setValue(data.reply_photo2 || "");
  sheet.getRange(rowIndex, 23).setValue(data.reply_photo3 || "");
  sheet.getRange(rowIndex, 24).setValue(data.reply_photo4 || "");
  sheet.getRange(rowIndex, 25).setValue(data.reply_photo5 || "");
  sheet.getRange(rowIndex, 26).setValue(data.reply_photo6 || "");
  sheet.getRange(rowIndex, 27).setValue(data.reply_photo7 || "");
  sheet.getRange(rowIndex, 28).setValue(data.reply_photo8 || "");
  sheet.getRange(rowIndex, 29).setValue(data.reply_photo9 || "");
  sheet.getRange(rowIndex, 30).setValue(data.reply_photo10 || "");
  sheet.getRange(rowIndex, 31).setValue(data.handler || "");
  sheet.getRange(rowIndex, 32).setValue(data.PS || "");
  sheet.getRange(rowIndex, 33).setValue(data.public ? "是" : "否");
  sheet.getRange(rowIndex, 34).setValue(data.public_title || "");
  sheet.getRange(rowIndex, 35).setValue(data.public_category || "");
  sheet.getRange(rowIndex, 36).setValue(data.public_location || "");
  sheet.getRange(rowIndex, 37).setValue(data.public_content || "");

  invalidatePublicCache_([
    "pub_cases",
    "pub_case_" + String(data.caseId || ""),
  ]);
  return jsonOut({ success: true });
}

// ══════════════════════════════════════════════
// 照片上傳
// ══════════════════════════════════════════════

function handleUploadPhoto(data) {
  return doUpload(data, NBH_FOLDER_ID);
}
function handleUploadBulletinImage(data) {
  return doUpload(data, BULLETIN_FOLDER_ID, "bulletin");
}

var ALLOWED_MIME = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};
var ALLOWED_REFERERS = [
  "https://gsnbhs.pages.dev",
  "https://itokorabbit.github.io",
  "https://ommichi.github.io",
];
var UPLOAD_RATE_LIMIT = 10; // 每個來源網域每分鐘最多上傳次數
var UPLOAD_RATE_WINDOW = 60; // 秒

function checkPublicUploadAccess(data, e) {
  // Referer 來源驗證（GAS 沒有原生取 header 的方式，透過前端帶入 origin 參數）
  var origin = String(data.origin || "");
  if (origin) {
    var allowed = false;
    for (var i = 0; i < ALLOWED_REFERERS.length; i++) {
      if (origin.indexOf(ALLOWED_REFERERS[i]) === 0) {
        allowed = true;
        break;
      }
    }
    if (!allowed) return "不允許的來源網域";
  }
  // Rate Limiting：每分鐘最多 UPLOAD_RATE_LIMIT 次
  var rateKey =
    "rate_upload_" +
    String(origin || "unknown")
      .replace(/\W/g, "_")
      .substring(0, 60);
  var cache = CacheService.getScriptCache();
  var count = parseInt(cache.get(rateKey) || "0", 10);
  if (count >= UPLOAD_RATE_LIMIT) return "上傳次數過多，請稍後再試";
  cache.put(rateKey, String(count + 1), UPLOAD_RATE_WINDOW);
  return null;
}

function handleStorePublicUpload(data, e) {
  var err = checkPublicUploadAccess(data, e);
  if (err) return jsonOut({ success: false, error: err });
  return doUpload(data, STOR_FOLDER_ID);
}

function handleReportPhotoUpload(data, e) {
  var origin = String(data.origin || "");
  if (origin) {
    var allowed = false;
    for (var i = 0; i < ALLOWED_REFERERS.length; i++) {
      if (origin.indexOf(ALLOWED_REFERERS[i]) === 0) {
        allowed = true;
        break;
      }
    }
    if (!allowed) return jsonOut({ success: false, error: "不允許的來源網域" });
  }
  var rateKey =
    "rate_rpt_" +
    String(origin || "unknown")
      .replace(/\W/g, "_")
      .substring(0, 60);
  var cache = CacheService.getScriptCache();
  var cnt = parseInt(cache.get(rateKey) || "0", 10);
  if (cnt >= 500)
    return jsonOut({ success: false, error: "上傳次數過多，請稍後再試" });
  cache.put(rateKey, String(cnt + 1), 60);
  return doUpload(data, NBH_FOLDER_ID, "report");
}

function doUpload(data, folderId, fileNamePrefix) {
  if (!folderId)
    return jsonOut({ success: false, error: "Folder ID not configured" });
  var base64 = data.base64 || "";
  // MIME 類型白名單驗證（伺服器端，不信任客戶端傳入）
  var mimeType = String(data.mimeType || "image/jpeg")
    .toLowerCase()
    .split(";")[0]
    .trim();
  if (!ALLOWED_MIME[mimeType])
    return jsonOut({ success: false, error: "不支援的檔案類型" });
  var ext = ALLOWED_MIME[mimeType];
  var prefix = String(fileNamePrefix || "photo").replace(
    /[^a-zA-Z0-9_-]/g,
    "_",
  );
  var fileName = prefix + "_" + new Date().getTime() + "." + ext;
  var b64 = base64.replace(/^data:image\/\w+;base64,/, "");
  var blob = Utilities.newBlob(Utilities.base64Decode(b64), mimeType, fileName);
  if (blob.getBytes().length > 5 * 1024 * 1024) {
    return jsonOut({ success: false, error: "檔案太大（上限 5MB）" });
  }
  var folder = DriveApp.getFolderById(folderId);
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return jsonOut({
    success: true,
    url: "https://lh3.googleusercontent.com/d/" + file.getId(),
  });
}

// ══════════════════════════════════════════════
// 帳號管理
// ══════════════════════════════════════════════

function handleGetAdmins(data) {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_ADMINS);
  if (!sheet)
    return jsonOut({
      success: false,
      error: "Sheet not found: " + SHEET_ADMINS,
    });
  var rows = sheet.getDataRange().getValues();
  var admins = [];
  for (var i = 1; i < rows.length; i++) {
    if (!rows[i][0] && !rows[i][3]) continue;
    admins.push({
      display_name: String(rows[i][0] || ""),
      role: String(rows[i][1] || ""),
      active: String(rows[i][2] || "").toUpperCase() === "TRUE",
      email: String(rows[i][3] || ""),
    });
  }
  return jsonOut({ success: true, admins: admins });
}

function handleAddAdmin(data) {
  var email = (data.email || "").toLowerCase().trim();
  if (!email) return jsonOut({ success: false, error: "缺少 email" });
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_ADMINS);
  if (!sheet) return jsonOut({ success: false, error: "Sheet not found" });
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][3] || "").toLowerCase() === email)
      return jsonOut({ success: false, error: "此 email 已存在" });
  }
  sheet.appendRow([
    data.display_name || "",
    data.role || "管理員",
    data.active === false ? "FALSE" : "TRUE",
    email,
  ]);
  return jsonOut({ success: true });
}

function handleUpdateAdmin(data) {
  var email = (data.target_email || data.email || "").toLowerCase().trim();
  if (!email) return jsonOut({ success: false, error: "缺少 email" });
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_ADMINS);
  if (!sheet) return jsonOut({ success: false, error: "Sheet not found" });
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][3] || "").toLowerCase() !== email) continue;
    var row = i + 1;
    if (data.display_name !== undefined)
      sheet.getRange(row, 1).setValue(data.display_name);
    if (data.role !== undefined) sheet.getRange(row, 2).setValue(data.role);
    if (data.active !== undefined)
      sheet.getRange(row, 3).setValue(data.active ? "TRUE" : "FALSE");
    return jsonOut({ success: true });
  }
  return jsonOut({ success: false, error: "找不到帳號: " + email });
}

function handleDeleteAdmin(data) {
  var email = (data.target_email || data.email || "").toLowerCase().trim();
  if (!email) return jsonOut({ success: false, error: "缺少 email" });
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_ADMINS);
  if (!sheet) return jsonOut({ success: false, error: "Sheet not found" });
  var rows = sheet.getDataRange().getValues();
  for (var i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][3] || "").toLowerCase() === email) {
      sheet.deleteRow(i + 1);
      return jsonOut({ success: true });
    }
  }
  return jsonOut({ success: false, error: "找不到帳號: " + email });
}

// ══════════════════════════════════════════════
// 置頂功能
// ══════════════════════════════════════════════

function handlePinCase(data) {
  var caseId = String(data.caseId || "");
  if (!caseId) return jsonOut({ success: false, error: "Missing caseId" });
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_CASES);
  if (!sheet) return jsonOut({ success: false, error: "Sheet not found" });
  var all = sheet.getDataRange().getValues();
  for (var i = 1; i < all.length; i++) {
    if (String(all[i][0]) !== caseId) continue;
    sheet.getRange(i + 1, 30).setValue(Number(data.pinOrder || 0)); // AD欄
    invalidatePublicCache_(["pub_cases"]);
    return jsonOut({ success: true });
  }
  return jsonOut({ success: false, error: "找不到案件: " + caseId });
}

function handleReorderCases(data) {
  var orders = data.orders;
  if (!Array.isArray(orders) || !orders.length)
    return jsonOut({ success: false, error: "Missing orders" });
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_CASES);
  if (!sheet) return jsonOut({ success: false, error: "Sheet not found" });
  var all = sheet.getDataRange().getValues();
  var orderMap = {};
  for (var k = 0; k < orders.length; k++)
    orderMap[String(orders[k].caseId)] = Number(orders[k].sortOrder || 0);
  for (var i = 1; i < all.length; i++) {
    var cid = String(all[i][0] || "");
    if (orderMap.hasOwnProperty(cid))
      sheet.getRange(i + 1, 31).setValue(orderMap[cid]); // AE欄
  }
  invalidatePublicCache_(["pub_cases"]);
  return jsonOut({ success: true });
}

// ── 共用輸出 ──
function fmtDate(v) {
  if (!v) return "";
  if (v instanceof Date)
    return Utilities.formatDate(v, "Asia/Taipei", "yyyy-MM-dd HH:mm");
  return String(v);
}

function jsonOut(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

var LINE_REPLY_URL = "https://api.line.me/v2/bot/message/reply";

var BRLI_SESSION_PREFIX = "brli_session_";
var BRLI_SESSION_TTL_MS = 1000 * 60 * 60 * 6;
var BRLI_MAX_PHOTOS = 5;
var BRLI_PHOTO_FOLDER_ID = scriptProp_("BRLI_PHOTO_FOLDER_ID");
var BRLI_REPORT_CATEGORIES = [
  { label: "道路坑洞", value: "道路坑洞" },
  { label: "路燈故障", value: "路燈故障" },
  { label: "坍方落石", value: "坍方落石" },
  { label: "樹倒阻路", value: "樹倒阻路" },
  { label: "水溝排水", value: "水溝排水" },
  { label: "垃圾環境", value: "垃圾環境" },
  { label: "其他問題", value: "其他問題" },
];

function handleLineWebhook(data) {
  var events = data.events || [];
  for (var i = 0; i < events.length; i++) {
    try {
      handleLineEvent_(events[i]);
    } catch (err) {
      console.error(
        "[line event error]",
        err && err.toString ? err.toString() : err,
      );
    }
  }
  return jsonOut({ success: true });
}

function handleLineEvent_(event) {
  if (handleSurveyEvent_(event)) return;
  handleBrliReportEvent_(event);
}

function handleBrliReportEvent_(event) {
  if (!event || !event.replyToken || !event.source || !event.source.userId)
    return false;

  var userId = event.source.userId;
  var state = getBrliSession_(userId);
  var hasActiveSession = !!state.stage;

  if (event.type === "postback") {
    var data = parseLinePostbackData_(event.postback && event.postback.data);
    if (!hasActiveSession && !isBrliPostbackAction_(data.action)) return false;
    handleBrliPostback_(event, userId, state, data);
    return true;
  }

  if (event.type !== "message" || !event.message) return false;

  var message = event.message;
  if (message.type === "text") {
    var text = String(message.text || "").trim();
    if (
      !hasActiveSession &&
      !isBrliStartText_(text) &&
      !isBrliCancelText_(text)
    )
      return false;
    handleBrliText_(event, userId, state, text);
    return true;
  }

  if (message.type === "image") {
    if (!hasActiveSession) return false;
    handleBrliImage_(event, userId, state, message);
    return true;
  }

  if (message.type === "location") {
    if (!hasActiveSession) return false;
    handleBrliLocation_(event, userId, state, message);
    return true;
  }

  if (!hasActiveSession) return false;
  replyLine_(event.replyToken, [
    { type: "text", text: "目前請使用文字、照片或定位來完成通報。" },
  ]);
  return true;
}

function handleBrliText_(event, userId, state, text) {
  if (isBrliCancelText_(text)) {
    clearBrliSession_(userId);
    replyLine_(event.replyToken, [
      { type: "text", text: "已取消本次通報。需要時請再點「我要通報」。" },
    ]);
    return;
  }

  if (isBrliStartText_(text)) {
    saveBrliSession_(userId, { stage: "category", startedAt: Date.now() });
    replyLine_(event.replyToken, [buildBrliCategoryFlex_()]);
    return;
  }

  if (state.stage === "note") {
    state.note = text;
    state.stage = "confirm";
    saveBrliSession_(userId, state);
    replyLine_(event.replyToken, [buildBrliConfirmFlex_(state)]);
    return;
  }

  if (state.stage === "location") {
    state.manualLocation = text;
    state.stage = "confirm";
    saveBrliSession_(userId, state);
    replyLine_(event.replyToken, [buildBrliConfirmFlex_(state)]);
    return;
  }

  if (state.stage === "photo") {
    replyLine_(event.replyToken, [
      buildBrliPhotoPrompt_("請按下方「打開相機」拍照，或按「先略過照片」。"),
    ]);
    return;
  }

  replyLine_(event.replyToken, [
    {
      type: "text",
      text: "請點圖文選單的「我要通報」，或直接輸入「我要通報」開始。",
    },
  ]);
}

function handleBrliPostback_(event, userId, state, data) {
  var action = data.action || "";

  if (action === "report:start") {
    saveBrliSession_(userId, { stage: "category", startedAt: Date.now() });
    replyLine_(event.replyToken, [buildBrliCategoryFlex_()]);
    return;
  }

  if (action === "category") {
    var category = data.category || "其他問題";
    saveBrliSession_(userId, {
      stage: "photo",
      category: category,
      startedAt: state.startedAt || Date.now(),
    });
    replyLine_(event.replyToken, [
      buildBrliPhotoPrompt_("已選擇「" + category + "」。請拍一張現場照片。"),
    ]);
    return;
  }

  if (action === "photo:skip") {
    if (!getBrliPhotos_(state).length) state.photoSkipped = true;
    state.stage = "location";
    saveBrliSession_(userId, state);
    replyLine_(event.replyToken, [
      buildBrliLocationPrompt_("沒問題，接下來請提供發生位置。"),
    ]);
    return;
  }

  if (action === "note:add") {
    state.stage = "note";
    saveBrliSession_(userId, state);
    replyLine_(event.replyToken, [
      {
        type: "text",
        text: "請直接輸入補充說明，例如「靠近第 3 鄰產業道路轉彎處」。",
      },
    ]);
    return;
  }

  if (action === "location:retry") {
    state.stage = "location";
    delete state.location;
    delete state.manualLocation;
    saveBrliSession_(userId, state);
    replyLine_(event.replyToken, [
      buildBrliLocationPrompt_("請重新傳送發生位置。"),
    ]);
    return;
  }

  if (action === "submit") {
    var doneCard = buildBrliDoneFlex_(state);
    clearBrliSession_(userId);
    replyLine_(event.replyToken, [doneCard]);
    return;
  }

  if (action === "cancel") {
    clearBrliSession_(userId);
    replyLine_(event.replyToken, [{ type: "text", text: "已取消本次通報。" }]);
    return;
  }

  replyLine_(event.replyToken, [
    { type: "text", text: "目前無法辨識這個操作，請重新點「我要通報」。" },
  ]);
}

function handleBrliImage_(event, userId, state, message) {
  if (!state.category) {
    saveBrliSession_(userId, { stage: "category", startedAt: Date.now() });
    replyLine_(event.replyToken, [
      { type: "text", text: "照片已收到。請先補選通報類別。" },
      buildBrliCategoryFlex_(),
    ]);
    return;
  }

  var photos = getBrliPhotos_(state);
  if (photos.length >= BRLI_MAX_PHOTOS) {
    replyLine_(event.replyToken, [
      buildBrliLocationPrompt_(
        "目前最多可收 " + BRLI_MAX_PHOTOS + " 張照片，請接著提供發生位置。",
      ),
    ]);
    return;
  }

  var savedPhoto;
  try {
    savedPhoto = saveLineImageToDrive_(message.id, userId, photos.length + 1);
  } catch (err) {
    console.error(
      "[brli image save error]",
      err && err.toString ? err.toString() : err,
    );
    replyLine_(event.replyToken, [
      buildBrliPhotoPrompt_("照片暫時儲存失敗，請再拍一次或從相簿重新選擇。"),
    ]);
    return;
  }
  photos.push(savedPhoto);
  state.photos = photos;
  state.photoMessageId = message.id;
  state.photoSkipped = false;
  state.stage = "photo";
  saveBrliSession_(userId, state);
  replyLine_(event.replyToken, [buildBrliPhotoNextPrompt_(photos.length)]);
}

function handleBrliLocation_(event, userId, state, message) {
  if (!state.category) {
    state.stage = "category";
    state.startedAt = state.startedAt || Date.now();
    saveBrliSession_(userId, state);
    replyLine_(event.replyToken, [
      { type: "text", text: "定位已收到。請先補選通報類別。" },
      buildBrliCategoryFlex_(),
    ]);
    return;
  }

  state.location = {
    title: message.title || "",
    address: message.address || "",
    latitude: message.latitude,
    longitude: message.longitude,
  };
  state.stage = "confirm";
  saveBrliSession_(userId, state);
  replyLine_(event.replyToken, [buildBrliConfirmFlex_(state)]);
}

function buildBrliCategoryFlex_() {
  return {
    type: "flex",
    altText: "請選擇通報類別",
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "我要通報",
            weight: "bold",
            size: "xl",
            color: "#1F2937",
          },
          {
            type: "text",
            text: "請選擇最接近的問題類別",
            size: "sm",
            color: "#6B7280",
            margin: "sm",
          },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: BRLI_REPORT_CATEGORIES.map(function (item) {
          return {
            type: "button",
            style: "primary",
            height: "md",
            color: "#2563EB",
            action: {
              type: "postback",
              label: item.label,
              data:
                "action=category&category=" + encodeURIComponent(item.value),
              displayText: item.label,
            },
          };
        }),
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "button",
            style: "secondary",
            action: {
              type: "postback",
              label: "取消",
              data: "action=cancel",
              displayText: "取消通報",
            },
          },
        ],
      },
    },
  };
}

function buildBrliPhotoPrompt_(text) {
  return {
    type: "text",
    text:
      text +
      "\n\n請按下方「打開相機」，拍完後直接按傳送。最多可傳 " +
      BRLI_MAX_PHOTOS +
      " 張。",
    quickReply: {
      items: [
        { type: "action", action: { type: "camera", label: "打開相機" } },
        { type: "action", action: { type: "cameraRoll", label: "從相簿選" } },
        {
          type: "action",
          action: {
            type: "postback",
            label: "先略過照片",
            data: "action=photo:skip",
            displayText: "先略過照片",
          },
        },
      ],
    },
  };
}

function buildBrliPhotoNextPrompt_(count) {
  var items = [];
  if (count < BRLI_MAX_PHOTOS) {
    items.push({
      type: "action",
      action: { type: "camera", label: "再拍一張" },
    });
    items.push({
      type: "action",
      action: { type: "cameraRoll", label: "再選一張" },
    });
  }
  items.push({
    type: "action",
    action: { type: "location", label: "傳送位置" },
  });

  return {
    type: "text",
    text:
      "第 " +
      count +
      " 張照片已收到。\n\n可以繼續補照片，或按「傳送位置」提供發生地點。",
    quickReply: { items: items },
  };
}

function buildBrliLocationPrompt_(text) {
  return {
    type: "text",
    text:
      text +
      "\n\n請按下方「傳送目前位置」，LINE 會打開地圖，確認位置後按「傳送」。",
    quickReply: {
      items: [
        { type: "action", action: { type: "location", label: "傳送目前位置" } },
        {
          type: "action",
          action: {
            type: "postback",
            label: "補文字位置",
            data: "action=note:add",
            displayText: "我用文字說明位置",
          },
        },
      ],
    },
  };
}

function buildBrliConfirmFlex_(state) {
  var locationText = formatBrliLocationText_(state);
  var noteText = state.note ? state.note : "未填寫";
  var photos = getBrliPhotos_(state);
  var hasPhotoText = photos.length
    ? "已收到 " + photos.length + " 張照片"
    : state.photoSkipped
      ? "已略過照片"
      : "尚未收到";
  var bodyContents = [
    buildBrliKeyValueText_("類別", state.category || "未選擇"),
    buildBrliKeyValueText_("照片", hasPhotoText),
  ];
  var photoPreview = buildBrliPhotoPreview_(photos);
  if (photoPreview) bodyContents.push(photoPreview);
  bodyContents.push(buildBrliKeyValueText_("位置", locationText));
  bodyContents.push(buildBrliKeyValueText_("補充", noteText));

  return {
    type: "flex",
    altText: "請確認通報內容",
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "請確認通報內容",
            weight: "bold",
            size: "xl",
            color: "#1F2937",
          },
          {
            type: "text",
            text: "確認無誤後請按送出",
            size: "sm",
            color: "#6B7280",
            margin: "sm",
          },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: bodyContents,
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          {
            type: "button",
            style: "secondary",
            action: {
              type: "postback",
              label: "重新定位",
              data: "action=location:retry",
              displayText: "重新定位",
            },
          },
          {
            type: "button",
            style: "primary",
            color: "#2563EB",
            action: {
              type: "postback",
              label: "通報填寫",
              data: "action=note:add",
              displayText: "通報填寫",
            },
          },
          {
            type: "button",
            style: "primary",
            color: "#16A34A",
            action: {
              type: "postback",
              label: "送出",
              data: "action=submit",
              displayText: "送出通報",
            },
          },
          {
            type: "button",
            style: "secondary",
            action: {
              type: "postback",
              label: "取消",
              data: "action=cancel",
              displayText: "取消通報",
            },
          },
        ],
      },
    },
  };
}

function buildBrliDoneFlex_(state) {
  var locationText = formatBrliLocationText_(state);
  var noteText = state.note ? state.note : "未填寫";
  var photos = getBrliPhotos_(state);
  var hasPhotoText = photos.length
    ? "已收到 " + photos.length + " 張照片"
    : state.photoSkipped
      ? "已略過照片"
      : "尚未收到";
  var bodyContents = [
    buildBrliKeyValueText_("類別", state.category || "未選擇"),
    buildBrliKeyValueText_("照片", hasPhotoText),
  ];
  var photoPreview = buildBrliPhotoPreview_(photos);
  if (photoPreview) bodyContents.push(photoPreview);
  bodyContents.push(buildBrliKeyValueText_("位置", locationText));
  bodyContents.push(buildBrliKeyValueText_("補充", noteText));

  return {
    type: "flex",
    altText: "已收到測試通報",
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "已收到測試通報",
            weight: "bold",
            size: "xl",
            color: "#1F2937",
          },
          {
            type: "text",
            text: "謝謝您，通報內容如下",
            size: "sm",
            color: "#6B7280",
            margin: "sm",
          },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: bodyContents,
      },
    },
  };
}

function buildBrliPhotoPreview_(photos) {
  var previewPhotos = getBrliPhotos_({ photos: photos })
    .filter(function (p) {
      return p && p.url;
    })
    .slice(0, 3);
  if (!previewPhotos.length) return null;

  return {
    type: "box",
    layout: "horizontal",
    spacing: "sm",
    margin: "sm",
    contents: previewPhotos.map(function (photo) {
      return {
        type: "image",
        url: photo.url,
        size: "full",
        aspectRatio: "1:1",
        aspectMode: "cover",
        flex: 1,
      };
    }),
  };
}

function buildBrliKeyValueText_(key, value) {
  return {
    type: "box",
    layout: "vertical",
    margin: "sm",
    contents: [
      { type: "text", text: key, size: "xs", color: "#6B7280" },
      {
        type: "text",
        text: String(value || ""),
        size: "sm",
        color: "#111827",
        wrap: true,
        margin: "xs",
      },
    ],
  };
}

function getBrliSession_(userId) {
  var raw = CacheService.getScriptCache().get(BRLI_SESSION_PREFIX + userId);
  if (!raw) return {};
  try {
    var state = JSON.parse(raw);
    if (state.updatedAt && Date.now() - state.updatedAt > BRLI_SESSION_TTL_MS) {
      clearBrliSession_(userId);
      return {};
    }
    return state;
  } catch (err) {
    clearBrliSession_(userId);
    return {};
  }
}

function saveBrliSession_(userId, state) {
  var nextState = Object.assign({}, state, { updatedAt: Date.now() });
  CacheService.getScriptCache().put(
    BRLI_SESSION_PREFIX + userId,
    JSON.stringify(nextState),
    Math.floor(BRLI_SESSION_TTL_MS / 1000),
  );
}

function clearBrliSession_(userId) {
  CacheService.getScriptCache().remove(BRLI_SESSION_PREFIX + userId);
}

function getBrliPhotos_(state) {
  if (!state) return [];
  if (Array.isArray(state.photos))
    return state.photos.slice(0, BRLI_MAX_PHOTOS);
  if (state.photoMessageId)
    return [{ messageId: state.photoMessageId, url: state.photoUrl || "" }];
  return [];
}

function saveLineImageToDrive_(messageId, userId, photoIndex) {
  var token = PropertiesService.getScriptProperties().getProperty(
    "LINE_CHANNEL_ACCESS_TOKEN",
  );
  if (!token) throw new Error("LINE_CHANNEL_ACCESS_TOKEN 未設定");

  var url =
    "https://api-data.line.me/v2/bot/message/" +
    encodeURIComponent(messageId) +
    "/content";
  var res = UrlFetchApp.fetch(url, {
    method: "get",
    headers: { Authorization: "Bearer " + token },
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error("LINE 圖片下載失敗：HTTP " + code);
  }

  var blob = res.getBlob();
  var contentType = String(blob.getContentType() || "image/jpeg")
    .toLowerCase()
    .split(";")[0]
    .trim();
  var ext = ALLOWED_MIME[contentType] || "jpg";
  var safeUser = String(userId || "lineuser")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 32);
  var fileName =
    "brli_" +
    safeUser +
    "_" +
    photoIndex +
    "_" +
    new Date().getTime() +
    "." +
    ext;
  blob.setName(fileName);

  var folder = DriveApp.getFolderById(BRLI_PHOTO_FOLDER_ID);
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return {
    messageId: messageId,
    url: "https://lh3.googleusercontent.com/d/" + file.getId(),
  };
}

function parseLinePostbackData_(data) {
  var result = {};
  String(data || "")
    .split("&")
    .forEach(function (part) {
      var pieces = part.split("=");
      var key = decodeURIComponent(pieces[0] || "");
      var value = decodeURIComponent(pieces.slice(1).join("=") || "");
      if (key) result[key] = value;
    });
  return result;
}

function isBrliStartText_(text) {
  return (
    ["我要通報", "開始通報", "通報", "報案", "柏瑞通報"].indexOf(text) !== -1
  );
}

function isBrliCancelText_(text) {
  return ["取消", "取消通報", "不用了"].indexOf(text) !== -1;
}

function isBrliPostbackAction_(action) {
  return (
    [
      "report:start",
      "category",
      "photo:skip",
      "note:add",
      "location:retry",
      "submit",
      "cancel",
    ].indexOf(action) !== -1
  );
}

function formatBrliLocationText_(state) {
  if (state.location) {
    var address = state.location.address || state.location.title || "";
    var mapsUrl = buildBrliGoogleMapsUrl_(
      state.location.latitude,
      state.location.longitude,
    );
    return address ? address + "\n" + mapsUrl : mapsUrl;
  }
  if (state.manualLocation) return state.manualLocation;
  return "尚未提供";
}

function buildBrliGoogleMapsUrl_(lat, lng) {
  if (lat === undefined || lng === undefined) return "";
  return "https://maps.google.com/?q=" + lat + "," + lng;
}

function buildBrliPlainSummary_(state) {
  var photos = getBrliPhotos_(state);
  var lines = [
    "類別：" + (state.category || "未選擇"),
    "照片：" +
      (photos.length
        ? "已收到 " + photos.length + " 張"
        : state.photoSkipped
          ? "已略過"
          : "尚未收到"),
    "位置：" + formatBrliLocationText_(state),
  ];
  if (state.note) lines.push("補充：" + state.note);
  return lines.join("\n");
}

function replyLine_(replyToken, messages) {
  var token = LINE_CHANNEL_ACCESS_TOKEN_;
  if (!token) {
    console.error(
      "[line] LINE_CHANNEL_ACCESS_TOKEN 未設定，請到 GAS 專案設定 → 指令碼屬性 加上",
    );
    return;
  }
  try {
    UrlFetchApp.fetch(LINE_REPLY_URL, {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + token },
      payload: JSON.stringify({ replyToken: replyToken, messages: messages }),
      muteHttpExceptions: true,
    });
  } catch (err) {
    console.error(
      "[line reply error]",
      err && err.toString ? err.toString() : err,
    );
  }
}

// ╔══════════════════════════════════════════════════════════════╗
// ║               活動報名系統 — 管理端 CRUD                      ║
// ╚══════════════════════════════════════════════════════════════╝

function handleGetEvents(data) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(SHEET_EVENTS);
  if (!sh) return jsonOut({ success: true, events: [] });
  ensureEventSheetHeader_(sh);
  var rows = sh.getDataRange().getValues();
  if (rows.length <= 1) return jsonOut({ success: true, events: [] });
  var events = [];
  var correctedCounts = false;
  for (var i = 1; i < rows.length; i++) {
    if (!rows[i][EVT_COL.eventId - 1]) continue;
    var actualCount = countEventRegistrations_(ss, rows[i]);
    if ((parseInt(rows[i][EVT_COL.registeredCount - 1]) || 0) !== actualCount) {
      rows[i][EVT_COL.registeredCount - 1] = actualCount;
      sh.getRange(i + 1, EVT_COL.registeredCount).setValue(actualCount);
      correctedCounts = true;
    }
    events.push(rowToEvent_(rows[i]));
  }
  if (correctedCounts) invalidateEventCaches_();
  return jsonOut({ success: true, events: events });
}

function handleGetEvent(data) {
  if (!data.eventId)
    return jsonOut({ success: false, error: "Missing eventId" });
  var row = findEventRow_(data.eventId);
  if (!row) return jsonOut({ success: false, error: "找不到活動" });
  return jsonOut({ success: true, event: rowToEvent_(row) });
}

function handleCreateEvent(data) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = getOrCreateEvtSheet_(ss, SHEET_EVENTS);
  ensureEventSheetHeader_(sh);
  var now = new Date().toISOString();
  var eventId =
    "EVT_" +
    Utilities.formatDate(new Date(), "Asia/Taipei", "yyyyMMdd") +
    "_" +
    String(Date.now()).slice(-4);
  var questions = data.questions || [];
  var regSheetName = "REG_" + eventId;
  sh.appendRow([
    eventId,
    data.eventName || "",
    data.eventDate || formatEventDateRange_(data.eventStart, data.eventEnd),
    data.eventLocation || "",
    data.description || "",
    data.imageUrl || "",
    data.status || "草稿",
    data.quota !== undefined && data.quota !== "" ? parseInt(data.quota) : "",
    0,
    data.requireConsent === true || data.requireConsent === "TRUE"
      ? "TRUE"
      : "FALSE",
    JSON.stringify(questions),
    regSheetName,
    now,
    now,
    data.createdBy || "",
    data.registrationStart || "",
    data.registrationEnd || "",
    data.eventStart || "",
    data.eventEnd || "",
    data.mapUrl || "",
    data.surveyId || "",
    data.surveyTarget || "全部報名",
    "",
    parseSurveyDelayMinutes_(data.surveyDelay),
  ]);
  createRegistrationSheet_(ss, regSheetName, questions);
  invalidateEventCaches_(eventId);
  return jsonOut({ success: true, eventId: eventId });
}

function handleUpdateEvent(data) {
  if (!data.eventId)
    return jsonOut({ success: false, error: "Missing eventId" });
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(SHEET_EVENTS);
  if (!sh) return jsonOut({ success: false, error: "找不到活動清單" });
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][EVT_COL.eventId - 1] !== data.eventId) continue;
    var r = i + 1;
    var now = new Date().toISOString();
    if (data.eventName !== undefined)
      sh.getRange(r, EVT_COL.eventName).setValue(data.eventName);
    if (
      data.eventDate !== undefined ||
      data.eventStart !== undefined ||
      data.eventEnd !== undefined
    ) {
      sh.getRange(r, EVT_COL.eventDate).setValue(
        data.eventDate || formatEventDateRange_(data.eventStart, data.eventEnd),
      );
    }
    if (data.eventLocation !== undefined)
      sh.getRange(r, EVT_COL.eventLocation).setValue(data.eventLocation);
    if (data.description !== undefined)
      sh.getRange(r, EVT_COL.description).setValue(data.description);
    if (data.imageUrl !== undefined)
      sh.getRange(r, EVT_COL.imageUrl).setValue(data.imageUrl);
    if (data.status !== undefined)
      sh.getRange(r, EVT_COL.status).setValue(data.status);
    if (data.quota !== undefined)
      sh.getRange(r, EVT_COL.quota).setValue(
        data.quota === "" ? "" : parseInt(data.quota),
      );
    if (data.requireConsent !== undefined)
      sh.getRange(r, EVT_COL.requireConsent).setValue(
        data.requireConsent === true || data.requireConsent === "TRUE"
          ? "TRUE"
          : "FALSE",
      );
    if (data.questions !== undefined) {
      sh.getRange(r, EVT_COL.questions).setValue(
        JSON.stringify(data.questions),
      );
      var oldQuestions = [];
      try {
        oldQuestions = JSON.parse(rows[i][EVT_COL.questions - 1] || "[]");
      } catch (e) {}
      syncRegistrationSheetHeaders_(
        ss,
        rows[i][EVT_COL.registrationSheet - 1],
        data.questions,
        oldQuestions,
      );
    }
    if (data.registrationStart !== undefined)
      sh.getRange(r, EVT_COL.registrationStart).setValue(
        data.registrationStart,
      );
    if (data.registrationEnd !== undefined)
      sh.getRange(r, EVT_COL.registrationEnd).setValue(data.registrationEnd);
    if (data.eventStart !== undefined)
      sh.getRange(r, EVT_COL.eventStart).setValue(data.eventStart);
    if (data.eventEnd !== undefined)
      sh.getRange(r, EVT_COL.eventEnd).setValue(data.eventEnd);
    if (data.mapUrl !== undefined)
      sh.getRange(r, EVT_COL.mapUrl).setValue(data.mapUrl);
    if (data.surveyId !== undefined)
      sh.getRange(r, EVT_COL.surveyId).setValue(data.surveyId);
    if (data.surveyTarget !== undefined)
      sh.getRange(r, EVT_COL.surveyTarget).setValue(data.surveyTarget);
    if (data.surveyDelay !== undefined)
      sh.getRange(r, EVT_COL.surveyDelay).setValue(
        parseSurveyDelayMinutes_(data.surveyDelay),
      );
    sh.getRange(r, EVT_COL.updatedAt).setValue(now);
    invalidateEventCaches_(data.eventId);
    return jsonOut({ success: true });
  }
  return jsonOut({ success: false, error: "找不到活動" });
}

function handleUpdateEventStatus(data) {
  if (!data.eventId || !data.status)
    return jsonOut({ success: false, error: "Missing eventId or status" });
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(SHEET_EVENTS);
  if (!sh) return jsonOut({ success: false, error: "找不到活動清單" });
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][EVT_COL.eventId - 1] !== data.eventId) continue;
    sh.getRange(i + 1, EVT_COL.status).setValue(data.status);
    sh.getRange(i + 1, EVT_COL.updatedAt).setValue(new Date().toISOString());
    invalidateEventCaches_(data.eventId);
    return jsonOut({ success: true });
  }
  return jsonOut({ success: false, error: "找不到活動" });
}

function handleDeleteEvent(data) {
  if (!data.eventId)
    return jsonOut({ success: false, error: "Missing eventId" });
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(SHEET_EVENTS);
  if (!sh) return jsonOut({ success: false, error: "找不到活動清單" });
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][EVT_COL.eventId - 1] !== data.eventId) continue;
    var regCount = parseInt(rows[i][EVT_COL.registeredCount - 1]) || 0;
    if (regCount > 0 && !data.force) {
      return jsonOut({
        success: false,
        error: "此活動已有 " + regCount + " 筆報名，確認刪除請加 force:true",
        hasRegistrations: true,
        count: regCount,
      });
    }
    sh.deleteRow(i + 1);
    invalidateEventCaches_(data.eventId);
    return jsonOut({ success: true });
  }
  return jsonOut({ success: false, error: "找不到活動" });
}

function handleGetRegistrations(data) {
  if (!data.eventId)
    return jsonOut({ success: false, error: "Missing eventId" });
  var cacheKey = "evt_regs_" + data.eventId;
  var cached = CacheService.getScriptCache().get(cacheKey);
  if (cached) return jsonOut(JSON.parse(cached));
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var evSh = ss.getSheetByName(SHEET_EVENTS);
  if (!evSh) return jsonOut({ success: false, error: "找不到活動" });
  var evRows = evSh.getDataRange().getValues();
  var row = null;
  for (var i = 1; i < evRows.length; i++) {
    if (evRows[i][EVT_COL.eventId - 1] === data.eventId) {
      row = evRows[i];
      break;
    }
  }
  if (!row) return jsonOut({ success: false, error: "找不到活動" });
  var sh = ss.getSheetByName(row[EVT_COL.registrationSheet - 1]);
  if (!sh || sh.getLastRow() <= 1) {
    var emptyPayload = { success: true, registrations: [], totalHeadcount: 0 };
    emptyPayload.registrationSheet = row[EVT_COL.registrationSheet - 1];
    CacheService.getScriptCache().put(
      cacheKey,
      JSON.stringify(emptyPayload),
      30,
    );
    return jsonOut(emptyPayload);
  }
  var rows = sh.getDataRange().getValues();
  var headers = rows[0];
  var totalHeadcount = countEventRegistrationsFromValues_(rows, row);
  var regs = rows.slice(1).map(function (r) {
    var obj = {};
    for (var j = 0; j < headers.length; j++) obj[headers[j]] = r[j];
    return obj;
  });
  var payload = {
    success: true,
    registrations: regs,
    totalHeadcount: totalHeadcount,
    registrationSheet: row[EVT_COL.registrationSheet - 1],
  };
  CacheService.getScriptCache().put(cacheKey, JSON.stringify(payload), 30);
  CacheService.getScriptCache().put(
    "evt_reg_sheet_" + data.eventId,
    String(row[EVT_COL.registrationSheet - 1] || ""),
    300,
  );
  return jsonOut(payload);
}

function handleDeleteRegistration(data) {
  if (!data.eventId || !data.regId)
    return jsonOut({ success: false, error: "Missing eventId or regId" });
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var evSh = ss.getSheetByName(SHEET_EVENTS);
  if (!evSh) return jsonOut({ success: false, error: "找不到活動清單" });
  var evRows = evSh.getDataRange().getValues();
  for (var i = 1; i < evRows.length; i++) {
    if (evRows[i][EVT_COL.eventId - 1] !== data.eventId) continue;
    var regSheetName = evRows[i][EVT_COL.registrationSheet - 1];
    var regSh = ss.getSheetByName(regSheetName);
    if (!regSh || regSh.getLastRow() <= 1)
      return jsonOut({ success: false, error: "找不到報名資料" });
    var values = regSh.getDataRange().getValues();
    var headers = values[0] || [];
    var regIdIdx = headers.indexOf("regId");
    if (regIdIdx < 0) regIdIdx = 0;
    for (var r = 1; r < values.length; r++) {
      if (String(values[r][regIdIdx]) !== String(data.regId)) continue;
      regSh.deleteRow(r + 1);
      var count = countEventRegistrations_(ss, evRows[i]);
      evSh.getRange(i + 1, EVT_COL.registeredCount).setValue(count);
      invalidateEventCaches_(data.eventId);
      return jsonOut({ success: true, registeredCount: count });
    }
    return jsonOut({ success: false, error: "找不到此筆報名資料" });
  }
  return jsonOut({ success: false, error: "找不到活動" });
}

function handleUpdateRegistration(data) {
  if (!data.eventId || !data.regId || !data.updates)
    return jsonOut({
      success: false,
      error: "Missing eventId, regId or updates",
    });
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var evSh = ss.getSheetByName(SHEET_EVENTS);
  if (!evSh) return jsonOut({ success: false, error: "找不到活動清單" });
  var evRows = evSh.getDataRange().getValues();
  for (var i = 1; i < evRows.length; i++) {
    if (evRows[i][EVT_COL.eventId - 1] !== data.eventId) continue;
    var regSheetName = evRows[i][EVT_COL.registrationSheet - 1];
    var regSh = ss.getSheetByName(regSheetName);
    if (!regSh || regSh.getLastRow() <= 1)
      return jsonOut({ success: false, error: "找不到報名資料" });
    var values = regSh.getDataRange().getValues();
    var headers = values[0] || [];
    var regIdIdx = headers.indexOf("regId");
    if (regIdIdx < 0) regIdIdx = 0;
    for (var r = 1; r < values.length; r++) {
      if (String(values[r][regIdIdx]) !== String(data.regId)) continue;
      var rowValues = values[r].slice();
      Object.keys(data.updates || {}).forEach(function (key) {
        var idx = headers.indexOf(key);
        if (idx >= 0 && !isSystemRegistrationColumn_(key))
          rowValues[idx] = String(data.updates[key] || "");
      });
      var questions = [];
      try {
        questions = JSON.parse(evRows[i][EVT_COL.questions - 1] || "[]");
      } catch (e) {}
      var headcountIdx = headers.indexOf("headcount");
      var sourceHeadcountIdx = findHeadcountAnswerColumn_(headers, questions);
      if (headcountIdx >= 0) {
        var headcount =
          sourceHeadcountIdx >= 0
            ? parseInt(rowValues[sourceHeadcountIdx]) || 1
            : 1;
        rowValues[headcountIdx] = String(headcount);
      }
      regSh
        .getRange(r + 1, 1, 1, rowValues.length)
        .setNumberFormat("@")
        .setValues([
          rowValues.map(function (v) {
            return String(v);
          }),
        ]);
      var count = countEventRegistrations_(ss, evRows[i]);
      evSh.getRange(i + 1, EVT_COL.registeredCount).setValue(count);
      invalidateEventCaches_(data.eventId);
      return jsonOut({ success: true, registeredCount: count });
    }
    return jsonOut({ success: false, error: "找不到此筆報名資料" });
  }
  return jsonOut({ success: false, error: "找不到活動" });
}

function isSystemRegistrationColumn_(key) {
  return (
    ["regId", "eventId", "lineUserId", "submittedAt", "headcount"].indexOf(
      key,
    ) >= 0
  );
}

function handleGetEventStats(data) {
  if (!data.eventId)
    return jsonOut({ success: false, error: "Missing eventId" });
  var cacheKey = "evt_stats_" + data.eventId;
  var cached = CacheService.getScriptCache().get(cacheKey);
  if (cached) return jsonOut({ success: true, stats: JSON.parse(cached) });
  var row = findEventRow_(data.eventId);
  if (!row) return jsonOut({ success: false, error: "找不到活動" });
  var questions = [];
  try {
    questions = JSON.parse(row[EVT_COL.questions - 1] || "[]");
  } catch (e) {}
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(row[EVT_COL.registrationSheet - 1]);
  var stats = { total: 0, totalRegistrations: 0, consentRate: 0, answers: {} };
  if (sh && sh.getLastRow() > 1) {
    var rows = sh.getDataRange().getValues();
    var headers = rows[0];
    stats.totalRegistrations = rows.length - 1;
    stats.total = countEventRegistrations_(ss, row);
    var consentIdx = headers.indexOf("consentGiven");
    var consentCount = 0;
    for (var i = 1; i < rows.length; i++) {
      if (consentIdx >= 0 && rows[i][consentIdx] === "TRUE") consentCount++;
    }
    stats.consentRate =
      stats.totalRegistrations > 0
        ? Math.round((consentCount / stats.totalRegistrations) * 100)
        : 0;
    for (var q = 0; q < questions.length; q++) {
      if (questions[q].type === "text") continue;
      var colIdx = headers.indexOf(questions[q].label);
      if (colIdx < 0) continue;
      var counts = {};
      for (var r = 1; r < rows.length; r++) {
        String(rows[r][colIdx] || "")
          .split("、")
          .forEach(function (v) {
            v = v.trim();
            if (v) counts[v] = (counts[v] || 0) + 1;
          });
      }
      stats.answers[questions[q].label] = counts;
    }
  }
  CacheService.getScriptCache().put(cacheKey, JSON.stringify(stats), 300);
  return jsonOut({ success: true, stats: stats });
}

function handleUploadEventImage(data) {
  var b64 = data.imageBase64;
  if (!b64) return jsonOut({ success: false, error: "Missing imageBase64" });
  if (b64.length * 0.75 > 2 * 1024 * 1024)
    return jsonOut({ success: false, error: "圖片過大，請壓縮至 2MB 以下" });
  try {
    var mimeType = data.mimeType || "image/jpeg";
    var ext = mimeType === "image/png" ? ".png" : ".jpg";
    var filename = "event_" + Date.now() + ext;
    var blob = Utilities.newBlob(
      Utilities.base64Decode(b64),
      mimeType,
      filename,
    );
    var file = DriveApp.getFolderById(EVENT_IMG_FOLDER_ID).createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return jsonOut({
      success: true,
      url:
        "https://drive.google.com/thumbnail?id=" + file.getId() + "&sz=w1000",
    });
  } catch (err) {
    console.error("[uploadEventImage]", err.toString());
    return jsonOut({ success: false, error: "上傳失敗：" + err.toString() });
  }
}

function findEventRow_(eventId) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(SHEET_EVENTS);
  if (!sh) return null;
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][EVT_COL.eventId - 1] === eventId) return rows[i];
  }
  return null;
}

function rowToEvent_(r) {
  var questions = [];
  try {
    questions = JSON.parse(r[EVT_COL.questions - 1] || "[]");
  } catch (e) {}
  return {
    eventId: r[EVT_COL.eventId - 1],
    eventName: r[EVT_COL.eventName - 1],
    eventDate:
      formatEventDateRange_(
        r[EVT_COL.eventStart - 1],
        r[EVT_COL.eventEnd - 1],
      ) || r[EVT_COL.eventDate - 1],
    eventLocation: r[EVT_COL.eventLocation - 1],
    description: r[EVT_COL.description - 1],
    imageUrl: r[EVT_COL.imageUrl - 1],
    status: r[EVT_COL.status - 1],
    quota:
      r[EVT_COL.quota - 1] === "" ? 0 : parseInt(r[EVT_COL.quota - 1]) || 0,
    registeredCount: parseInt(r[EVT_COL.registeredCount - 1]) || 0,
    requireConsent: isTrueCell_(r[EVT_COL.requireConsent - 1]),
    questions: questions,
    registrationSheet: r[EVT_COL.registrationSheet - 1],
    createdAt: r[EVT_COL.createdAt - 1],
    updatedAt: r[EVT_COL.updatedAt - 1],
    createdBy: r[EVT_COL.createdBy - 1],
    registrationStart: r[EVT_COL.registrationStart - 1] || "",
    registrationEnd: r[EVT_COL.registrationEnd - 1] || "",
    eventStart: r[EVT_COL.eventStart - 1] || "",
    eventEnd: r[EVT_COL.eventEnd - 1] || "",
    mapUrl: r[EVT_COL.mapUrl - 1] || "",
    surveyId: r[EVT_COL.surveyId - 1] || "",
    surveyTarget: r[EVT_COL.surveyTarget - 1] || "全部報名",
    surveySentAt: r[EVT_COL.surveySentAt - 1] || "",
    surveyDelay:
      r[EVT_COL.surveyDelay - 1] !== "" &&
      r[EVT_COL.surveyDelay - 1] !== undefined
        ? parseInt(r[EVT_COL.surveyDelay - 1])
        : 60,
  };
}

function formatEventDateRange_(start, end) {
  var startDate = parseMaybeDate_(start);
  var endDate = parseMaybeDate_(end);
  if (startDate && endDate) {
    var startDay = Utilities.formatDate(startDate, "Asia/Taipei", "yyyy/MM/dd");
    var endDay = Utilities.formatDate(endDate, "Asia/Taipei", "yyyy/MM/dd");
    var startTime = Utilities.formatDate(startDate, "Asia/Taipei", "HH:mm");
    var endTime = Utilities.formatDate(endDate, "Asia/Taipei", "HH:mm");
    if (startDay === endDay) return startDay + " " + startTime + "-" + endTime;
    return startDay + " " + startTime + " - " + endDay + " " + endTime;
  }
  var s = formatDateTimeText_(start);
  var e = formatDateTimeText_(end);
  if (s && e) return s + " - " + e;
  return s || e || "";
}

function formatDateTimeText_(value) {
  if (!value) return "";
  var text = String(value);
  var m = text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (m) return m[1] + "/" + m[2] + "/" + m[3] + " " + m[4] + ":" + m[5];
  try {
    var d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return Utilities.formatDate(d, "Asia/Taipei", "yyyy/MM/dd HH:mm");
  } catch (e) {
    return String(value);
  }
}

function parseMaybeDate_(value) {
  if (!value) return null;
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  var text = String(value);
  var m = text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (m) {
    // 前端送來的是台灣本地時間（UTC+8），明確轉為 UTC epoch
    // 避免 GAS 伺服器時區不是 Asia/Taipei 時造成時間偏移
    var utcMs = Date.UTC(
      parseInt(m[1]),
      parseInt(m[2]) - 1,
      parseInt(m[3]),
      parseInt(m[4]) - 8,
      parseInt(m[5]),
    );
    return new Date(utcMs);
  }
  var d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function parseSurveyDelayMinutes_(value) {
  if (value === 0 || value === "0") return 0;
  if (value === undefined || value === null || value === "") return 60;
  var minutes = parseInt(value, 10);
  if (isNaN(minutes) || minutes < 0) return 60;
  return minutes;
}

function isTrueCell_(value) {
  return value === true || String(value).toUpperCase() === "TRUE";
}

function getOrCreateEvtSheet_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}

function ensureEventSheetHeader_(sh) {
  var headers = [
    "eventId",
    "eventName",
    "eventDate",
    "eventLocation",
    "description",
    "imageUrl",
    "status",
    "quota",
    "registeredCount",
    "requireConsent",
    "questions",
    "registrationSheet",
    "createdAt",
    "updatedAt",
    "createdBy",
    "registrationStart",
    "registrationEnd",
    "eventStart",
    "eventEnd",
    "mapUrl",
    "surveyId",
    "surveyTarget",
    "surveySentAt",
    "surveyDelay",
  ];
  if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
    return;
  }
  var current = sh
    .getRange(1, 1, 1, Math.max(sh.getLastColumn(), headers.length))
    .getValues()[0];
  for (var i = 0; i < headers.length; i++) {
    if (!current[i]) sh.getRange(1, i + 1).setValue(headers[i]);
  }
}

function createRegistrationSheet_(ss, sheetName, questions) {
  var sh = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
  if (sh.getLastRow() === 0) {
    sh.appendRow(registrationHeaders_(questions));
  }
  return sh;
}

function registrationHeaders_(questions) {
  var headers = [
    "regId",
    "eventId",
    "lineUserId",
    "displayName",
    "consentGiven",
    "submittedAt",
    "headcount",
    "checkedIn",
  ];
  var seen = {};
  (questions || []).forEach(function (q, idx) {
    var label = String(q.label || "問題" + (idx + 1)).trim();
    var base = label;
    var n = 2;
    while (seen[label]) {
      label = base + " (" + n + ")";
      n++;
    }
    seen[label] = true;
    headers.push(label);
  });
  return headers;
}

function syncRegistrationSheetHeaders_(ss, sheetName, questions, oldQuestions) {
  if (!sheetName) return;
  var sh = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
  var newHeaders = registrationHeaders_(questions);
  if (sh.getLastRow() === 0) {
    sh.appendRow(newHeaders);
    return;
  }
  var values = sh.getDataRange().getValues();
  var oldHeaders = values[0] || [];
  var oldIndex = {};
  for (var i = 0; i < oldHeaders.length; i++) oldIndex[oldHeaders[i]] = i;
  var idToOldLabel = {};
  (oldQuestions || []).forEach(function (q, idx) {
    idToOldLabel[questionStableId_(q, idx)] = q.label;
  });
  var newValues = [newHeaders];
  for (var r = 1; r < values.length; r++) {
    var row = [];
    for (var c = 0; c < newHeaders.length; c++) {
      var idx = oldIndex[newHeaders[c]];
      if (idx === undefined && c === 6) {
        idx = findHeadcountColumn_(oldHeaders, oldQuestions);
      }
      if (idx === undefined && c >= 8) {
        var q = (questions || [])[c - 8];
        var oldLabel = idToOldLabel[questionStableId_(q, c - 7)];
        if (oldLabel) idx = oldIndex[oldLabel];
      }
      row.push(idx !== undefined ? values[r][idx] : "");
    }
    newValues.push(row);
  }
  sh.clearContents();
  sh.getRange(1, 1, newValues.length, newHeaders.length).setValues(newValues);
}

function questionStableId_(q, idx) {
  return q && q.id ? String(q.id) : "idx_" + idx;
}

function countEventRegistrations_(ss, eventRow) {
  var sheetName = eventRow[EVT_COL.registrationSheet - 1];
  if (!sheetName) return parseInt(eventRow[EVT_COL.registeredCount - 1]) || 0;
  var sh = ss.getSheetByName(sheetName);
  if (!sh || sh.getLastRow() <= 1) return 0;
  return sh.getLastRow() - 1;
}

function countEventRegistrationsFromValues_(values, eventRow) {
  if (!values || values.length <= 1) return 0;
  var questions = [];
  try {
    questions = JSON.parse(eventRow[EVT_COL.questions - 1] || "[]");
  } catch (e) {}
  var headers = values[0] || [];
  var idx = findHeadcountAnswerColumn_(headers, questions);
  if (idx < 0) idx = findHeadcountColumn_(headers, questions);
  var total = 0;
  for (var r = 1; r < values.length; r++) {
    total += idx >= 0 ? parseInt(values[r][idx]) || 1 : 1;
  }
  return total;
}

function hasExistingEventRegistration_(eventRow, userId) {
  if (!eventRow || !userId) return false;
  var sheetName = eventRow[EVT_COL.registrationSheet - 1];
  if (!sheetName) return false;
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(sheetName);
  if (!sh || sh.getLastRow() <= 1) return false;
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] || [];
  var idx = headers.indexOf("lineUserId");
  if (idx < 0) idx = 2;
  var values = sh.getRange(2, idx + 1, sh.getLastRow() - 1, 1).getValues();
  for (var r = 0; r < values.length; r++) {
    if (String(values[r][0]) === String(userId)) return true;
  }
  return false;
}

function findHeadcountColumn_(headers, questions) {
  var idx = headers.indexOf("headcount");
  if (idx >= 0) return idx;
  return findHeadcountAnswerColumn_(headers, questions);
}

function findHeadcountAnswerColumn_(headers, questions) {
  var labels = [];
  (questions || []).forEach(function (q) {
    if (q.type === "headcount" && q.label) labels.push(String(q.label));
  });
  for (var i = 0; i < labels.length; i++) {
    idx = headers.indexOf(labels[i]);
    if (idx >= 0) return idx;
    var normalizedLabel = normalizeHeaderText_(labels[i]);
    for (var h = 0; h < headers.length; h++) {
      if (normalizeHeaderText_(headers[h]) === normalizedLabel) return h;
    }
  }
  for (var j = 0; j < headers.length; j++) {
    if (headers[j] === "headcount") continue;
    var text = normalizeHeaderText_(headers[j]);
    if (/報名.*人數|人數|幾人|幾位/.test(text)) return j;
  }
  return -1;
}

function normalizeHeaderText_(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/[()（）]/g, "")
    .trim();
}

// ╔══════════════════════════════════════════════════════════════╗
// ║               活動報名系統 — 活動前一天提醒                     ║
// ╚══════════════════════════════════════════════════════════════╝

function getSurveySh_(ss) {
  var sh = ss.getSheetByName(SHEET_SURVEYS);
  var headers = [
    "surveyId",
    "surveyName",
    "surveyFileName",
    "questions",
    "createdAt",
    "updatedAt",
    "createdBy",
    "introTitle",
    "introDescription",
    "outroTitle",
    "outroDescription",
  ];
  if (!sh) {
    sh = ss.insertSheet(SHEET_SURVEYS);
    sh.appendRow(headers);
  } else {
    var current = sh
      .getRange(1, 1, 1, Math.max(sh.getLastColumn(), headers.length))
      .getValues()[0];
    for (var h = 0; h < headers.length; h++) {
      if (!current[h]) sh.getRange(1, h + 1).setValue(headers[h]);
    }
  }
  return sh;
}

function rowToSurvey_(row) {
  var qs = [];
  try {
    qs = JSON.parse(row[3] || "[]");
  } catch (e) {}
  qs = normalizeSurveyQuestions_(qs);
  return {
    surveyId: row[0],
    surveyName: row[1],
    surveyFileName: row[2] || "",
    questions: qs,
    createdAt: row[4],
    updatedAt: row[5],
    createdBy: row[6],
    introTitle: row[7] || row[1] || "",
    introDescription: row[8] || "",
    outroTitle: row[9] || "問券已送出，感謝！",
    outroDescription: row[10] || "您的意見已收到，感謝您的參與！",
  };
}

function handleGetSurveys(data) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = getSurveySh_(ss);
  var rows = sh.getDataRange().getValues();
  if (rows.length <= 1) return jsonOut({ success: true, surveys: [] });
  var surveys = [];
  for (var i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    surveys.push(rowToSurvey_(rows[i]));
  }
  return jsonOut({ success: true, surveys: surveys });
}

function handleGetSurvey(data) {
  if (!data.surveyId)
    return jsonOut({ success: false, error: "Missing surveyId" });
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = getSurveySh_(ss);
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] !== data.surveyId) continue;
    return jsonOut({ success: true, survey: rowToSurvey_(rows[i]) });
  }
  return jsonOut({ success: false, error: "找不到問券" });
}

function handleGetSurveyByFileName(data) {
  if (!data.surveyFileName)
    return jsonOut({ success: false, error: "Missing surveyFileName" });
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = getSurveySh_(ss);
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][2] !== data.surveyFileName) continue;
    return jsonOut({ success: true, survey: rowToSurvey_(rows[i]) });
  }
  return jsonOut({ success: false, error: "找不到問券" });
}

function handleGetSurveyPublic(data) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = getSurveySh_(ss);
  var rows = sh.getDataRange().getValues();
  var survey = null;
  if (data.surveyId) {
    for (var i = 1; i < rows.length; i++) {
      if (rows[i][0] !== data.surveyId) continue;
      survey = rowToSurvey_(rows[i]);
      break;
    }
  } else if (data.surveyFileName) {
    for (var j = 1; j < rows.length; j++) {
      if (rows[j][2] !== data.surveyFileName) continue;
      survey = rowToSurvey_(rows[j]);
      break;
    }
  }
  if (survey) {
    var lineUserId = String(data.lineUserId || "").trim();
    var eventName = "";
    var eventId = String(data.eventId || "").trim();
    if (eventId) {
      var eventRow = findEventRow_(eventId);
      if (eventRow) eventName = String(eventRow[EVT_COL.eventName - 1] || "");
    }
    return jsonOut({
      success: true,
      survey: survey,
      displayName: lineUserId ? getUserDisplayName_(lineUserId) : "",
      eventName: eventName,
    });
  }
  if (data.surveyId || data.surveyFileName) {
    return jsonOut({ success: false, error: "找不到問券" });
  }
  return jsonOut({
    success: false,
    error: "Missing surveyId or surveyFileName",
  });
}

function handleSubmitSurveyResponse(data) {
  if (!data.eventId)
    return jsonOut({ success: false, error: "Missing eventId" });
  if (!data.surveyId)
    return jsonOut({ success: false, error: "Missing surveyId" });
  if (!Array.isArray(data.answers))
    return jsonOut({ success: false, error: "Missing answers" });

  var ss = SpreadsheetApp.openById(SHEET_ID);
  var eventId = String(data.eventId || "").trim();
  var surveyId = String(data.surveyId || "").trim();
  var lineUserId = String(data.lineUserId || "").trim();
  var displayName = String(data.displayName || "").trim();
  if (!displayName && lineUserId) {
    displayName = getUserDisplayName_(lineUserId);
  }
  var answers = data.answers;

  var eventRow = findEventRow_(eventId);
  var eventName = eventRow ? String(eventRow[EVT_COL.eventName - 1] || "") : "";
  var shName = surveyResponseSheetName_(surveyId);
  var sh = ss.getSheetByName(shName);
  var baseHeaders = [
    "srvRespId",
    "eventId",
    "eventName",
    "surveyId",
    "lineUserId",
    "displayName",
    "residentNote",
    "submittedAt",
    "source",
  ];
  var qHeaders = answers.map(function (a) {
    return String(a.label || "").trim() || "問題";
  });
  var headers = baseHeaders.concat(qHeaders);

  if (!sh) {
    sh = ss.insertSheet(shName);
    sh.appendRow(headers);
  }
  var existingHeaders = ensureSheetHeaders_(sh, headers);

  var now = new Date().toISOString();
  var respId =
    "SRVR_" +
    Utilities.formatDate(new Date(), "Asia/Taipei", "yyyyMMdd") +
    "_" +
    String(Date.now()).slice(-4);
  var answerMap = {};
  answers.forEach(function (a) {
    answerMap[String(a.label || "").trim()] = Array.isArray(a.value)
      ? a.value.join("、")
      : String(a.value || "");
  });

  var row = existingHeaders.map(function (col) {
    if (col === "srvRespId") return respId;
    if (col === "eventId") return eventId;
    if (col === "eventName") return eventName;
    if (col === "surveyId") return surveyId;
    if (col === "lineUserId") return lineUserId;
    if (col === "displayName") return displayName;
    if (col === "residentNote") return getResidentNote_(ss, lineUserId).note;
    if (col === "submittedAt") return now;
    if (col === "source") return "web";
    return answerMap[col] !== undefined ? answerMap[col] : "";
  });
  sh.getRange(sh.getLastRow() + 1, 1, 1, row.length)
    .setNumberFormat("@")
    .setValues([row.map(String)]);
  return jsonOut({ success: true });
}

function handleCreateSurvey(data) {
  if (!data.surveyName)
    return jsonOut({ success: false, error: "請輸入問券名稱" });
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = getSurveySh_(ss);
  var now = new Date().toISOString();
  var surveyId =
    "SRV_" +
    Utilities.formatDate(new Date(), "Asia/Taipei", "yyyyMMdd") +
    "_" +
    String(Date.now()).slice(-4);
  var surveyFileName = String(data.surveyFileName || "").trim();
  if (!surveyFileName) {
    surveyFileName = "survey" + String(Date.now()).slice(-4) + ".html";
  }
  sh.appendRow([
    surveyId,
    data.surveyName,
    surveyFileName,
    JSON.stringify(normalizeSurveyQuestions_(data.questions || [])),
    now,
    now,
    data.createdBy || "",
    data.introTitle || data.surveyName || "",
    data.introDescription || "",
    data.outroTitle || "問券已送出，感謝！",
    data.outroDescription || "您的意見已收到，感謝您的參與！",
  ]);
  return jsonOut({ success: true, surveyId: surveyId });
}

function handleUpdateSurvey(data) {
  if (!data.surveyId)
    return jsonOut({ success: false, error: "Missing surveyId" });
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = getSurveySh_(ss);
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] !== data.surveyId) continue;
    var r = i + 1;
    var now = new Date().toISOString();
    if (data.surveyName !== undefined)
      sh.getRange(r, 2).setValue(data.surveyName);
    if (data.surveyFileName !== undefined)
      sh.getRange(r, 3).setValue(data.surveyFileName);
    if (data.questions !== undefined)
      sh.getRange(r, 4).setValue(
        JSON.stringify(normalizeSurveyQuestions_(data.questions)),
      );
    if (data.introTitle !== undefined)
      sh.getRange(r, 8).setValue(data.introTitle);
    if (data.introDescription !== undefined)
      sh.getRange(r, 9).setValue(data.introDescription);
    if (data.outroTitle !== undefined)
      sh.getRange(r, 10).setValue(data.outroTitle);
    if (data.outroDescription !== undefined)
      sh.getRange(r, 11).setValue(data.outroDescription);
    sh.getRange(r, 5).setValue(now);
    return jsonOut({ success: true });
  }
  return jsonOut({ success: false, error: "找不到問券" });
}

function normalizeSurveyQuestions_(questions) {
  return (questions || []).map(function (q, idx) {
    q = q || {};
    var type = String(q.type || "text").trim();
    if (type === "radio") type = "single";
    if (type === "checkbox") type = "multi";
    if (["text", "single", "multi", "scale"].indexOf(type) < 0) type = "text";
    var options = Array.isArray(q.options)
      ? q.options
          .map(function (o) {
            return String(o || "").trim();
          })
          .filter(Boolean)
      : [];
    if (type === "scale") options = ["1", "2", "3", "4", "5"];
    return {
      id: q.id || "srv_q_" + idx,
      type: type,
      label: String(q.label || "問題" + (idx + 1)).trim(),
      required:
        q.required === true || String(q.required).toUpperCase() === "TRUE",
      options: options,
      allowOther:
        q.allowOther === true || String(q.allowOther).toUpperCase() === "TRUE",
      maxLength: Math.min(500, Math.max(1, parseInt(q.maxLength) || 200)),
    };
  });
}

function handleDeleteSurvey(data) {
  if (!data.surveyId)
    return jsonOut({ success: false, error: "Missing surveyId" });
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = getSurveySh_(ss);
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] !== data.surveyId) continue;
    sh.deleteRow(i + 1);
    return jsonOut({ success: true });
  }
  return jsonOut({ success: false, error: "找不到問券" });
}

function surveyResponseSheetName_(surveyId) {
  var safeId = String(surveyId || "")
    .replace(/[\\\/\?\*\[\]\:]/g, "_")
    .substring(0, 80);
  return "SRV_RESP_" + safeId;
}

function ensureSheetHeaders_(sh, headers) {
  if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
    return headers.slice();
  }
  var existing = sh
    .getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1))
    .getValues()[0];
  headers.forEach(function (header) {
    if (existing.indexOf(header) >= 0) return;
    var col = sh.getLastColumn() + 1;
    sh.getRange(1, col).setValue(header);
    existing.push(header);
  });
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
}

function getResidentNoteSh_(ss) {
  var sh = ss.getSheetByName(SHEET_RESIDENT_NOTES);
  var headers = ["lineUserId", "displayName", "note", "updatedAt"];
  if (!sh) {
    sh = ss.insertSheet(SHEET_RESIDENT_NOTES);
    sh.appendRow(headers);
  } else if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
  }
  return sh;
}

function getResidentNotesMap_(ss) {
  var sh = getResidentNoteSh_(ss);
  var map = {};
  if (sh.getLastRow() <= 1) return map;
  var values = sh.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    var uid = String(values[i][0] || "").trim();
    if (!uid) continue;
    map[uid] = {
      displayName: String(values[i][1] || ""),
      note: String(values[i][2] || ""),
      updatedAt: values[i][3] || "",
    };
  }
  return map;
}

function getResidentNote_(ss, lineUserId) {
  var uid = String(lineUserId || "").trim();
  if (!uid) return { displayName: "", note: "", updatedAt: "" };
  return getResidentNotesMap_(ss)[uid] || {
    displayName: "",
    note: "",
    updatedAt: "",
  };
}

function handleUpdateSurveyResidentNote(data) {
  var uid = String(data.lineUserId || "").trim();
  if (!uid) return jsonOut({ success: false, error: "Missing lineUserId" });
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = getResidentNoteSh_(ss);
  var displayName = String(data.displayName || "").trim();
  var note = String(data.note || "").trim();
  var now = new Date().toISOString();
  if (sh.getLastRow() > 1) {
    var values = sh.getDataRange().getValues();
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][0]) !== uid) continue;
      sh.getRange(i + 1, 2, 1, 3).setValues([[displayName, note, now]]);
      return jsonOut({ success: true });
    }
  }
  sh.appendRow([uid, displayName, note, now]);
  return jsonOut({ success: true });
}

function normalizeSurveyResponseStatus_(registered, attended, filled) {
  if (registered && attended && filled) return "有報名有參加有填問券";
  if (registered && attended && !filled) return "有報名有參加沒填問券";
  if (registered && !attended && filled) return "有報名沒參加有填問券";
  if (registered && !attended && !filled) return "有報名沒參加沒填問券";
  if (!registered && attended && filled) return "沒報名有參加有填問券";
  if (!registered && attended && !filled) return "沒報名有參加沒填問券";
  if (!registered && !attended && filled) return "沒報名沒參加有填問券";
  return "";
}

function getSurveyWalkInSh_(ss) {
  var sh = ss.getSheetByName(SHEET_SURVEY_WALKIN_ATTENDANCE);
  var headers = [
    "attendanceId",
    "surveyId",
    "eventId",
    "eventName",
    "lineUserId",
    "displayName",
    "residentNote",
    "createdAt",
  ];
  if (!sh) {
    sh = ss.insertSheet(SHEET_SURVEY_WALKIN_ATTENDANCE);
    sh.appendRow(headers);
  } else {
    ensureSheetHeaders_(sh, headers);
  }
  return sh;
}

function handleAddSurveyWalkInAttendance(data) {
  var surveyId = String(data.surveyId || "").trim();
  var eventId = String(data.eventId || "").trim();
  var displayName = String(data.displayName || "").trim();
  if (!surveyId || !eventId || !displayName) {
    return jsonOut({
      success: false,
      error: "Missing surveyId, eventId or displayName",
    });
  }
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var eventRow = findEventRow_(eventId);
  var eventName = eventRow ? String(eventRow[EVT_COL.eventName - 1] || "") : "";
  var attendanceId =
    "WALKIN_" +
    Utilities.formatDate(new Date(), "Asia/Taipei", "yyyyMMdd") +
    "_" +
    String(Date.now()).slice(-5);
  var lineUserId = "walkin:" + attendanceId;
  var note = String(data.note || "").trim();
  getSurveyWalkInSh_(ss).appendRow([
    attendanceId,
    surveyId,
    eventId,
    eventName,
    lineUserId,
    displayName,
    note,
    new Date().toISOString(),
  ]);
  if (note) {
    handleUpdateSurveyResidentNote({
      lineUserId: lineUserId,
      displayName: displayName,
      note: note,
    });
  }
  return jsonOut({ success: true, lineUserId: lineUserId });
}

function readSurveyResponseRows_(sh, surveyId, fallbackEventId, eventNameById, notesByUid) {
  var out = [];
  if (!sh || sh.getLastRow() <= 1) return out;
  var values = sh.getDataRange().getValues();
  var headers = values[0] || [];
  var eventIdIdx = headers.indexOf("eventId");
  var eventNameIdx = headers.indexOf("eventName");
  var surveyIdIdx = headers.indexOf("surveyId");
  var lineUserIdIdx = headers.indexOf("lineUserId");
  var displayNameIdx = headers.indexOf("displayName");
  var submittedAtIdx = headers.indexOf("submittedAt");
  var sourceIdx = headers.indexOf("source");
  var systemCols = {
    srvRespId: true,
    eventId: true,
    eventName: true,
    surveyId: true,
    lineUserId: true,
    displayName: true,
    residentNote: true,
    submittedAt: true,
    source: true,
  };
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var rowSurveyId = surveyIdIdx >= 0 ? String(row[surveyIdIdx] || "") : surveyId;
    if (rowSurveyId !== surveyId) continue;
    var eventId = eventIdIdx >= 0 ? String(row[eventIdIdx] || "") : fallbackEventId;
    var uid = lineUserIdIdx >= 0 ? String(row[lineUserIdIdx] || "") : "";
    var answers = {};
    for (var c = 0; c < headers.length; c++) {
      var h = String(headers[c] || "");
      if (!h || systemCols[h]) continue;
      answers[h] = row[c] === undefined || row[c] === null ? "" : String(row[c]);
    }
    out.push({
      eventId: eventId,
      eventName:
        (eventNameIdx >= 0 ? String(row[eventNameIdx] || "") : "") ||
        eventNameById[eventId] ||
        eventId,
      surveyId: rowSurveyId,
      lineUserId: uid,
      displayName: displayNameIdx >= 0 ? String(row[displayNameIdx] || "") : "",
      residentNote: uid && notesByUid[uid] ? notesByUid[uid].note : "",
      submittedAt: submittedAtIdx >= 0 ? row[submittedAtIdx] : "",
      source: sourceIdx >= 0 ? String(row[sourceIdx] || "") : "",
      filled: true,
      answers: answers,
    });
  }
  return out;
}

function handleGetSurveyResponses(data) {
  var surveyId = String(data.surveyId || "").trim();
  if (!surveyId) return jsonOut({ success: false, error: "Missing surveyId" });
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var evtSh = ss.getSheetByName(SHEET_EVENTS);
  if (!evtSh) return jsonOut({ success: false, error: "找不到活動清單" });
  var evtRows = evtSh.getDataRange().getValues();
  var notesByUid = getResidentNotesMap_(ss);
  var events = [];
  var eventNameById = {};
  var registeredByEventUser = {};
  var registeredRows = [];

  for (var i = 1; i < evtRows.length; i++) {
    var ev = evtRows[i];
    if (String(ev[EVT_COL.surveyId - 1] || "").trim() !== surveyId) continue;
    var eventId = String(ev[EVT_COL.eventId - 1] || "");
    if (!eventId) continue;
    var eventName = String(ev[EVT_COL.eventName - 1] || eventId);
    var regSheetName = String(ev[EVT_COL.registrationSheet - 1] || "");
    events.push({ eventId: eventId, eventName: eventName });
    eventNameById[eventId] = eventName;
    var regSh = ss.getSheetByName(regSheetName);
    if (!regSh || regSh.getLastRow() <= 1) continue;
    var regValues = regSh.getDataRange().getValues();
    var regHeaders = regValues[0] || [];
    var uidIdx = regHeaders.indexOf("lineUserId");
    var nameIdx = regHeaders.indexOf("displayName");
    var checkIdx = regHeaders.indexOf("checkedIn");
    if (uidIdx < 0) continue;
    for (var r = 1; r < regValues.length; r++) {
      var uid = String(regValues[r][uidIdx] || "").trim();
      if (!uid) continue;
      if (registeredByEventUser[eventId + "\n" + uid]) continue;
      var attended =
        checkIdx >= 0 &&
        String(regValues[r][checkIdx] || "FALSE").toUpperCase() === "TRUE";
      var regObj = {
        eventId: eventId,
        eventName: eventName,
        surveyId: surveyId,
        lineUserId: uid,
        displayName: nameIdx >= 0 ? String(regValues[r][nameIdx] || "") : "",
        residentNote: notesByUid[uid] ? notesByUid[uid].note : "",
        registered: true,
        attended: attended,
        filled: false,
        submittedAt: "",
        source: "",
        answers: {},
      };
      registeredByEventUser[eventId + "\n" + uid] = regObj;
      registeredRows.push(regObj);
    }
  }

  var responses = [];
  responses = responses.concat(
    readSurveyResponseRows_(
      ss.getSheetByName(surveyResponseSheetName_(surveyId)),
      surveyId,
      "",
      eventNameById,
      notesByUid,
    ),
  );
  events.forEach(function (ev) {
    responses = responses.concat(
      readSurveyResponseRows_(
        ss.getSheetByName("SRV_" + ev.eventId),
        surveyId,
        ev.eventId,
        eventNameById,
        notesByUid,
      ),
    );
  });

  var filledKeys = {};
  responses.forEach(function (resp) {
    var key = resp.eventId + "\n" + resp.lineUserId;
    var reg = registeredByEventUser[key];
    resp.registered = !!reg;
    resp.attended = reg ? !!reg.attended : true;
    if (reg && !resp.displayName) resp.displayName = reg.displayName;
    if (!resp.residentNote && resp.lineUserId && notesByUid[resp.lineUserId]) {
      resp.residentNote = notesByUid[resp.lineUserId].note;
    }
    resp.status = normalizeSurveyResponseStatus_(
      resp.registered,
      resp.attended,
      true,
    );
    if (resp.lineUserId) filledKeys[key] = true;
  });

  var walkSh = ss.getSheetByName(SHEET_SURVEY_WALKIN_ATTENDANCE);
  if (walkSh && walkSh.getLastRow() > 1) {
    var walkValues = walkSh.getDataRange().getValues();
    var walkHeaders = walkValues[0] || [];
    var wSurveyIdx = walkHeaders.indexOf("surveyId");
    var wEventIdx = walkHeaders.indexOf("eventId");
    var wEventNameIdx = walkHeaders.indexOf("eventName");
    var wUidIdx = walkHeaders.indexOf("lineUserId");
    var wNameIdx = walkHeaders.indexOf("displayName");
    var wNoteIdx = walkHeaders.indexOf("residentNote");
    for (var w = 1; w < walkValues.length; w++) {
      if (String(walkValues[w][wSurveyIdx] || "") !== surveyId) continue;
      var wEventId = String(walkValues[w][wEventIdx] || "");
      var wUid = String(walkValues[w][wUidIdx] || "");
      var wKey = wEventId + "\n" + wUid;
      if (filledKeys[wKey]) continue;
      responses.push({
        eventId: wEventId,
        eventName:
          String(walkValues[w][wEventNameIdx] || "") ||
          eventNameById[wEventId] ||
          wEventId,
        surveyId: surveyId,
        lineUserId: wUid,
        displayName: String(walkValues[w][wNameIdx] || ""),
        residentNote:
          (wUid && notesByUid[wUid] ? notesByUid[wUid].note : "") ||
          String(walkValues[w][wNoteIdx] || ""),
        registered: false,
        attended: true,
        filled: false,
        submittedAt: "",
        source: "walkin",
        answers: {},
        status: normalizeSurveyResponseStatus_(false, true, false),
      });
    }
  }

  registeredRows.forEach(function (reg) {
    var key = reg.eventId + "\n" + reg.lineUserId;
    if (filledKeys[key]) return;
    reg.status = normalizeSurveyResponseStatus_(true, reg.attended, false);
    responses.push(reg);
  });

  responses.sort(function (a, b) {
    return (
      String(b.submittedAt || "").localeCompare(String(a.submittedAt || "")) ||
      String(a.eventName || "").localeCompare(String(b.eventName || "")) ||
      String(a.displayName || "").localeCompare(String(b.displayName || ""))
    );
  });

  return jsonOut({ success: true, events: events, responses: responses });
}

// ╔══════════════════════════════════════════════════════════════╗
// ║               問券系統 — 簽到                                  ║
// ╚══════════════════════════════════════════════════════════════╝

function getOrAddCheckedInColumn_(sh) {
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var idx = headers.indexOf("checkedIn");
  if (idx >= 0) return idx + 1;
  var newCol = sh.getLastColumn() + 1;
  sh.getRange(1, newCol).setValue("checkedIn");
  if (sh.getLastRow() > 1) {
    var falseVals = [];
    for (var i = 0; i < sh.getLastRow() - 1; i++) falseVals.push(["FALSE"]);
    sh.getRange(2, newCol, sh.getLastRow() - 1, 1).setValues(falseVals);
  }
  return newCol;
}

function handleSubmitRegistration(data) {
  if (!data.eventId || !data.lineUserId)
    return jsonOut({ success: false, error: "Missing eventId or lineUserId" });
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var evSh = ss.getSheetByName(SHEET_EVENTS);
  if (!evSh) return jsonOut({ success: false, error: "找不到活動清單" });
  var evRows = evSh.getDataRange().getValues();
  var eventRow = null;
  for (var i = 1; i < evRows.length; i++) {
    if (evRows[i][EVT_COL.eventId - 1] === data.eventId) { eventRow = evRows[i]; break; }
  }
  if (!eventRow) return jsonOut({ success: false, error: "找不到活動" });
  var regSheetName = String(eventRow[EVT_COL.registrationSheet - 1] || "");
  if (!regSheetName) return jsonOut({ success: true }); // 無報名表，略過
  var questions = [];
  try { questions = JSON.parse(eventRow[EVT_COL.questions - 1] || "[]"); } catch (e) {}
  var regSh = ss.getSheetByName(regSheetName) || createRegistrationSheet_(ss, regSheetName, questions);
  // 取得實際欄位（若已有資料則用現有 header）
  var headers;
  if (regSh.getLastRow() === 0) {
    headers = registrationHeaders_(questions);
    regSh.appendRow(headers);
  } else {
    headers = regSh.getRange(1, 1, 1, Math.max(regSh.getLastColumn(), 1)).getValues()[0];
  }
  // 重複報名檢查
  var lineUserIdIdx = headers.indexOf("lineUserId");
  if (lineUserIdIdx >= 0 && regSh.getLastRow() > 1) {
    var col = regSh.getRange(2, lineUserIdIdx + 1, regSh.getLastRow() - 1, 1).getValues();
    for (var r = 0; r < col.length; r++) {
      if (String(col[r][0]) === String(data.lineUserId)) return jsonOut({ success: true });
    }
  }
  var regId = "reg_" + data.eventId + "_" + String(data.lineUserId).slice(-4) + "_" + String(Date.now()).slice(-5);
  var now = new Date().toISOString();
  var answerMap = {};
  (data.answers || []).forEach(function (a) {
    var label = String(a.label || "").trim();
    if (label) answerMap[label] = String(a.value || "");
  });
  var row = [];
  for (var c = 0; c < headers.length; c++) {
    var h = String(headers[c] || "");
    if      (h === "regId")        row.push(regId);
    else if (h === "eventId")      row.push(data.eventId);
    else if (h === "lineUserId")   row.push(data.lineUserId);
    else if (h === "displayName")  row.push(data.displayName || "");
    else if (h === "consentGiven") row.push(data.consentGiven ? "TRUE" : "FALSE");
    else if (h === "submittedAt")  row.push(now);
    else if (h === "headcount")    row.push("1");
    else if (h === "checkedIn")    row.push("FALSE");
    else row.push(answerMap[h] !== undefined ? answerMap[h] : "");
  }
  regSh.appendRow(row);
  invalidateEventCaches_(data.eventId);
  return jsonOut({ success: true });
}

function handleCheckInRegistration(data) {
  if (!data.eventId || !data.regId)
    return jsonOut({ success: false, error: "Missing eventId or regId" });
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var providedSheetName = String(data.registrationSheet || "");
  if (providedSheetName && providedSheetName.indexOf("REG_") !== 0)
    providedSheetName = "";
  var cachedSheetName =
    CacheService.getScriptCache().get("evt_reg_sheet_" + data.eventId) ||
    providedSheetName;
  if (cachedSheetName) {
    var cachedRegSh = ss.getSheetByName(cachedSheetName);
    if (cachedRegSh && cachedRegSh.getLastRow() > 1)
      return updateCheckInRegistrationSheet_(cachedRegSh, data);
  }
  var evSh = ss.getSheetByName(SHEET_EVENTS);
  if (!evSh) return jsonOut({ success: false, error: "找不到活動清單" });
  var evRows = evSh.getDataRange().getValues();
  for (var i = 1; i < evRows.length; i++) {
    if (evRows[i][EVT_COL.eventId - 1] !== data.eventId) continue;
    var regSh = ss.getSheetByName(evRows[i][EVT_COL.registrationSheet - 1]);
    if (!regSh || regSh.getLastRow() <= 1)
      return jsonOut({ success: false, error: "找不到報名資料" });
    CacheService.getScriptCache().put(
      "evt_reg_sheet_" + data.eventId,
      String(evRows[i][EVT_COL.registrationSheet - 1] || ""),
      300,
    );
    return updateCheckInRegistrationSheet_(regSh, data);
  }
  return jsonOut({ success: false, error: "找不到活動" });
}

function updateCheckInRegistrationSheet_(regSh, data) {
  var checkInCol = getOrAddCheckedInColumn_(regSh);
  var values = regSh.getDataRange().getValues();
  var headers = values[0];
  var regIdIdx = headers.indexOf("regId");
  if (regIdIdx < 0) regIdIdx = 0;
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][regIdIdx]) !== String(data.regId)) continue;
    var current =
      String(values[r][checkInCol - 1] || "FALSE").toUpperCase() === "TRUE";
    var newVal = data.checkedIn !== undefined ? !!data.checkedIn : !current;
    regSh.getRange(r + 1, checkInCol).setValue(newVal ? "TRUE" : "FALSE");
    invalidateEventCaches_(data.eventId);
    return jsonOut({ success: true, checkedIn: newVal });
  }
  return jsonOut({ success: false, error: "找不到報名資料" });
}

// ╔══════════════════════════════════════════════════════════════╗
// ║               問券系統 — 活動後問券發送                        ║
// ╚══════════════════════════════════════════════════════════════╝

function buildSrvMsgs_(evtMsgs) {
  var json = JSON.stringify(evtMsgs);
  json = json.replace(/"data":"action=evt:/g, '"data":"action=srv:');
  return JSON.parse(json);
}

function handleSurveyEvent_(event) {
  if (!event || !event.source || !event.source.userId) return false;
  var userId = event.source.userId;
  var replyToken = event.replyToken;
  var state = getSrvSession_(userId);
  var hasSess = !!state.stage;

  if (event.type === "postback") {
    var pb = parseLinePostbackData_(event.postback && event.postback.data);
    if (!hasSess && !(pb.action && pb.action.indexOf("srv:") === 0))
      return false;
    handleSrvPostback_(replyToken, userId, state, pb);
    return true;
  }
  if (
    event.type === "message" &&
    event.message &&
    event.message.type === "text"
  ) {
    var text = String(event.message.text || "").trim();
    if (!hasSess) return false;
    handleSrvText_(replyToken, userId, state, text);
    return true;
  }
  return false;
}

function handleSrvText_(replyToken, userId, state, text) {
  if (/^(取消|離開|結束|不報了|算了)$/.test(text)) {
    clearSrvSession_(userId);
    return replyLine_(replyToken, [
      { type: "text", text: "已取消填寫問券，感謝您的參與！" },
    ]);
  }
  if (state.stage === "other_text") {
    var pending = state.otherPending || {};
    var otherValue = "其他：" + text.substring(0, 100);
    state.stage = "answering";
    state.answers = state.answers || [];
    if (pending.type === "single" || pending.type === "scale") {
      state.answers.push({
        qIdx: pending.qIdx,
        type: pending.type,
        label: pending.label,
        value: otherValue,
      });
      state.qIdx++;
      state.otherPending = null;
      saveSrvSession_(userId, state);
      if (state.qIdx >= (state.questions || []).length)
        return sendSrvSummary_(replyToken, userId, state);
      return replyLine_(
        replyToken,
        buildSrvMsgs_(
          buildEvtQuestionMsgs_(
            state.questions[state.qIdx],
            state.qIdx,
            state.questions.length,
          ),
        ),
      );
    }
    if (pending.type === "multi") {
      state.multiBuffer = state.multiBuffer || [];
      if (state.multiBuffer.indexOf(otherValue) < 0)
        state.multiBuffer.push(otherValue);
      state.otherPending = null;
      saveSrvSession_(userId, state);
      return replyLine_(replyToken, [
        {
          type: "text",
          text: buildMultiSelectionStatusText_(state.multiBuffer),
        },
      ]);
    }
  }
  if (state.stage === "answering") {
    var q = (state.questions || [])[state.qIdx];
    if (q && q.type === "text") {
      var answer = text.substring(0, q.maxLength || 200);
      state.answers = state.answers || [];
      state.answers.push({
        qIdx: state.qIdx,
        type: "text",
        label: q.label,
        value: answer,
      });
      state.qIdx++;
      saveSrvSession_(userId, state);
      if (state.qIdx >= (state.questions || []).length)
        return sendSrvSummary_(replyToken, userId, state);
      return replyLine_(
        replyToken,
        buildSrvMsgs_(
          buildEvtQuestionMsgs_(
            state.questions[state.qIdx],
            state.qIdx,
            state.questions.length,
          ),
        ),
      );
    }
  }
  replyLine_(replyToken, [
    { type: "text", text: "請依提示操作，或輸入「取消」中止填寫。" },
  ]);
}

function handleSrvPostback_(replyToken, userId, state, pb) {
  var action = pb.action || "";

  if (action === "srv:start") {
    var surveyId = pb.surveyId;
    var eventId = pb.eventId;
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var srvSh = ss.getSheetByName(SHEET_SURVEYS);
    if (!srvSh)
      return replyLine_(replyToken, [
        { type: "text", text: "找不到問券，請稍後再試。" },
      ]);
    var srvRows = srvSh.getDataRange().getValues();
    var survey = null;
    for (var i = 1; i < srvRows.length; i++) {
      if (srvRows[i][0] === surveyId) {
        survey = rowToSurvey_(srvRows[i]);
        break;
      }
    }
    if (!survey)
      return replyLine_(replyToken, [
        { type: "text", text: "找不到問券，請稍後再試。" },
      ]);
    var newState = {
      stage: "answering",
      surveyId: surveyId,
      surveyName: survey.surveyName,
      introTitle: survey.introTitle,
      introDescription: survey.introDescription,
      outroTitle: survey.outroTitle,
      outroDescription: survey.outroDescription,
      eventId: eventId,
      questions: survey.questions,
      qIdx: 0,
      answers: [],
      multiBuffer: [],
    };
    if (!survey.questions.length) {
      newState.stage = "summary";
      return handleSrvSubmit_(replyToken, userId, newState);
    }
    saveSrvSession_(userId, newState);
    return replyLine_(
      replyToken,
      buildSrvMsgs_(
        buildEvtQuestionMsgs_(survey.questions[0], 0, survey.questions.length),
      ),
    );
  }

  if (action === "srv:answer") {
    if (state.stage !== "answering")
      return replyLine_(replyToken, [
        { type: "text", text: "操作逾時，請重新點選問券邀請訊息。" },
      ]);
    var q = (state.questions || [])[state.qIdx];
    if (!q) return;
    if (q.type === "single" || q.type === "scale") {
      if (pb.value === "__OTHER__") {
        state.stage = "other_text";
        state.otherPending = { qIdx: state.qIdx, type: q.type, label: q.label };
        saveSrvSession_(userId, state);
        return replyLine_(replyToken, [
          { type: "text", text: "請輸入「其他」的答案。" },
        ]);
      }
      state.answers.push({
        qIdx: state.qIdx,
        type: q.type,
        label: q.label,
        value: pb.value,
      });
      state.qIdx++;
      saveSrvSession_(userId, state);
      if (state.qIdx >= state.questions.length)
        return sendSrvSummary_(replyToken, userId, state);
      return replyLine_(
        replyToken,
        buildSrvMsgs_(
          buildEvtQuestionMsgs_(
            state.questions[state.qIdx],
            state.qIdx,
            state.questions.length,
          ),
        ),
      );
    }
    if (q.type === "multi") {
      if (pb.value === "__OTHER__") {
        state.stage = "other_text";
        state.otherPending = { qIdx: state.qIdx, type: q.type, label: q.label };
        saveSrvSession_(userId, state);
        return replyLine_(replyToken, [
          { type: "text", text: "請輸入「其他」的答案。" },
        ]);
      }
      state.multiBuffer = state.multiBuffer || [];
      var srvPickIdx = state.multiBuffer.indexOf(pb.value);
      if (srvPickIdx >= 0) state.multiBuffer.splice(srvPickIdx, 1);
      else state.multiBuffer.push(pb.value);
      saveSrvSession_(userId, state);
      return replyLine_(replyToken, [
        {
          type: "text",
          text: buildMultiSelectionStatusText_(state.multiBuffer),
        },
      ]);
    }
  }

  if (action === "srv:multi_done") {
    if (state.stage !== "answering") return;
    var q2 = (state.questions || [])[state.qIdx];
    var sel = state.multiBuffer || [];
    if (q2 && q2.required && !sel.length)
      return replyLine_(replyToken, [
        { type: "text", text: "此題為必填，請至少選一個選項。" },
      ]);
    state.answers.push({
      qIdx: state.qIdx,
      type: "multi",
      label: q2 ? q2.label : "",
      value: sel,
    });
    state.multiBuffer = [];
    state.qIdx++;
    saveSrvSession_(userId, state);
    if (state.qIdx >= (state.questions || []).length)
      return sendSrvSummary_(replyToken, userId, state);
    return replyLine_(
      replyToken,
      buildSrvMsgs_(
        buildEvtQuestionMsgs_(
          state.questions[state.qIdx],
          state.qIdx,
          state.questions.length,
        ),
      ),
    );
  }

  if (action === "srv:skip") {
    if (state.stage !== "answering") return;
    var q3 = (state.questions || [])[state.qIdx];
    state.answers.push({
      qIdx: state.qIdx,
      type: q3 ? q3.type : "text",
      label: q3 ? q3.label : "",
      value: "（略過）",
    });
    state.multiBuffer = [];
    state.qIdx++;
    saveSrvSession_(userId, state);
    if (state.qIdx >= (state.questions || []).length)
      return sendSrvSummary_(replyToken, userId, state);
    return replyLine_(
      replyToken,
      buildSrvMsgs_(
        buildEvtQuestionMsgs_(
          state.questions[state.qIdx],
          state.qIdx,
          state.questions.length,
        ),
      ),
    );
  }

  if (action === "srv:submit") {
    if (state.stage !== "summary")
      return replyLine_(replyToken, [
        { type: "text", text: "操作逾時，請重新點選問券邀請訊息。" },
      ]);
    handleSrvSubmit_(replyToken, userId, state);
    return;
  }

  if (action === "srv:edit") {
    if (state.stage !== "summary") return;
    state.stage = "answering";
    state.qIdx = 0;
    state.answers = [];
    state.multiBuffer = [];
    saveSrvSession_(userId, state);
    var qs = state.questions || [];
    if (!qs.length) return sendSrvSummary_(replyToken, userId, state);
    return replyLine_(
      replyToken,
      [{ type: "text", text: "請重新回答以下問題：" }].concat(
        buildSrvMsgs_(buildEvtQuestionMsgs_(qs[0], 0, qs.length)),
      ),
    );
  }
}

function sendSrvSummary_(replyToken, userId, state) {
  state.stage = "summary";
  saveSrvSession_(userId, state);
  replyLine_(replyToken, [buildSrvSummaryBubble_(state)]);
}

function buildSrvSummaryBubble_(state) {
  var answers = state.answers || [];
  var contents = [
    { type: "text", text: "📋 問券回答確認", weight: "bold", size: "lg" },
    {
      type: "text",
      text: "問券：" + (state.surveyName || ""),
      size: "sm",
      color: "#1a73e8",
      wrap: true,
    },
    { type: "separator", margin: "md" },
  ];
  answers.forEach(function (a) {
    var val = Array.isArray(a.value) ? a.value.join("、") : a.value;
    contents.push({
      type: "text",
      text: a.label + "：" + val,
      size: "sm",
      wrap: true,
      margin: "sm",
    });
  });
  if (!answers.length)
    contents.push({
      type: "text",
      text: "（此問券無問題）",
      size: "sm",
      color: "#999999",
    });
  contents.push({ type: "separator", margin: "md" });
  contents.push({
    type: "text",
    text: "確認送出後無法修改",
    size: "xs",
    color: "#999999",
    wrap: true,
    margin: "sm",
  });
  return {
    type: "flex",
    altText: "📋 問券確認",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: contents,
      },
      footer: {
        type: "box",
        layout: "horizontal",
        spacing: "sm",
        contents: [
          {
            type: "button",
            style: "secondary",
            height: "sm",
            flex: 1,
            action: {
              type: "postback",
              label: "修改",
              data: "action=srv:edit",
            },
          },
          {
            type: "button",
            style: "primary",
            height: "sm",
            flex: 2,
            color: "#1a73e8",
            action: {
              type: "postback",
              label: "確認送出",
              data: "action=srv:submit",
            },
          },
        ],
      },
    },
  };
}

function handleSrvSubmit_(replyToken, userId, state) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var eventRow = findEventRow_(state.eventId);
    var eventName = eventRow ? String(eventRow[EVT_COL.eventName - 1] || "") : "";
    var shName = surveyResponseSheetName_(state.surveyId);
    var sh = ss.getSheetByName(shName);
    var baseHeaders = [
      "srvRespId",
      "eventId",
      "eventName",
      "surveyId",
      "lineUserId",
      "displayName",
      "residentNote",
      "submittedAt",
      "source",
    ];
    var qHeaders = (state.questions || []).map(function (q, idx) {
      return String(q.label || "問題" + (idx + 1));
    });
    var headers = baseHeaders.concat(qHeaders);
    if (!sh) {
      sh = ss.insertSheet(shName);
      sh.appendRow(headers);
    } else if (sh.getLastRow() === 0) {
      sh.appendRow(headers);
    }
    var now = new Date().toISOString();
    var respId =
      "SRVR_" +
      Utilities.formatDate(new Date(), "Asia/Taipei", "yyyyMMdd") +
      "_" +
      String(Date.now()).slice(-4);
    var displayName = getUserDisplayName_(userId);
    var answerMap = {};
    (state.answers || []).forEach(function (a) {
      answerMap[a.label] = Array.isArray(a.value)
        ? a.value.join("、")
        : a.value;
    });
    var existingHeaders = ensureSheetHeaders_(sh, headers);
    var row = existingHeaders.map(function (col) {
      if (col === "srvRespId") return respId;
      if (col === "eventId") return state.eventId;
      if (col === "eventName") return eventName;
      if (col === "surveyId") return state.surveyId;
      if (col === "lineUserId") return userId;
      if (col === "displayName") return displayName;
      if (col === "residentNote") return getResidentNote_(ss, userId).note;
      if (col === "submittedAt") return now;
      if (col === "source") return "line";
      return answerMap[col] !== undefined ? answerMap[col] : "";
    });
    sh.getRange(sh.getLastRow() + 1, 1, 1, row.length)
      .setNumberFormat("@")
      .setValues([row.map(String)]);
    clearSrvSession_(userId);
    return replyLine_(replyToken, [
      {
        type: "flex",
        altText: "感謝填寫問券",
        contents: {
          type: "bubble",
          header: {
            type: "box",
            layout: "vertical",
            backgroundColor: "#2f6836",
            paddingAll: "16px",
            contents: [
              {
                type: "text",
                text: state.outroTitle || "✅ 問券已送出，感謝！",
                color: "#ffffff",
                weight: "bold",
                size: "md",
                wrap: true,
              },
            ],
          },
          body: {
            type: "box",
            layout: "vertical",
            spacing: "sm",
            contents: [
              {
                type: "text",
                text: state.surveyName || "問券",
                weight: "bold",
                size: "lg",
                wrap: true,
              },
              {
                type: "text",
                text:
                  state.outroDescription || "您的意見已收到，感謝您的參與！",
                size: "sm",
                color: "#4b5563",
                wrap: true,
                margin: "sm",
              },
            ],
          },
        },
      },
    ]);
  } catch (err) {
    console.error("[handleSrvSubmit_]", err.toString());
    clearSrvSession_(userId);
    return replyLine_(replyToken, [
      { type: "text", text: "送出失敗，請稍後再試。" },
    ]);
  }
}

function getSrvSession_(userId) {
  var raw = SCRIPT_CACHE_.get(SRV_SESSION_PREFIX + userId);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

function saveSrvSession_(userId, state) {
  state.updatedAt = Date.now();
  var json = JSON.stringify(state);
  if (json.length > 80000) {
    console.error("[saveSrvSession_] session 過大");
    return;
  }
  SCRIPT_CACHE_.put(SRV_SESSION_PREFIX + userId, json, SRV_SESSION_TTL_SEC);
}

function clearSrvSession_(userId) {
  SCRIPT_CACHE_.remove(SRV_SESSION_PREFIX + userId);
}

// ╔══════════════════════════════════════════════════════════════╗
// ║               報名記錄查詢                                     ║
// ╚══════════════════════════════════════════════════════════════╝

function handleGetLineUserRegistrationHistory(data) {
  var query = String(data.query || "")
    .trim()
    .toLowerCase();
  if (!query) return jsonOut({ success: false, error: "請輸入查詢關鍵字" });
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var evtSh = ss.getSheetByName(SHEET_EVENTS);
  if (!evtSh) return jsonOut({ success: true, records: [], results: [] });
  var evRows = evtSh.getDataRange().getValues();
  var results = [];
  for (var i = 1; i < evRows.length; i++) {
    var eventId = evRows[i][EVT_COL.eventId - 1];
    if (!eventId) continue;
    var eventName = evRows[i][EVT_COL.eventName - 1];
    var regShName = evRows[i][EVT_COL.registrationSheet - 1];
    if (!regShName) continue;
    var regSh = ss.getSheetByName(regShName);
    if (!regSh || regSh.getLastRow() <= 1) continue;
    var regData = regSh.getDataRange().getValues();
    var headers = regData[0];
    for (var r = 1; r < regData.length; r++) {
      var obj = {};
      for (var c = 0; c < headers.length; c++) obj[headers[c]] = regData[r][c];
      var displayName = String(obj.displayName || "").toLowerCase();
      var lineUserId = String(obj.lineUserId || "").toLowerCase();
      if (displayName.indexOf(query) < 0 && lineUserId.indexOf(query) < 0)
        continue;
      results.push({
        eventId: String(eventId),
        eventName: String(eventName),
        regId: String(obj.regId || ""),
        displayName: String(obj.displayName || ""),
        lineUserId: String(obj.lineUserId || ""),
        submittedAt: String(obj.submittedAt || "")
          .substring(0, 16)
          .replace("T", " "),
        checkedIn:
          String(obj.checkedIn || "FALSE").toUpperCase() === "TRUE"
            ? "TRUE"
            : "FALSE",
        consentGiven:
          String(obj.consentGiven || "FALSE").toUpperCase() === "TRUE"
            ? "TRUE"
            : "FALSE",
      });
    }
  }
  return jsonOut({ success: true, records: results, results: results });
}

// ============================================================
// LINE Rich Menu 設定工具（主選單 2x3 + 找里長聊聊／我要報名 兩個
// richmenuswitch 子選單）
// 用法：把三張選單圖片放到 Drive，分別填好 RICH_MENU_SETUP_.main、
// .findchief、.apply 的 imageFileId 後，在 Apps Script 編輯器手動
// 執行 setupRichMenuPages() 一次即可；之後要調整再重新執行覆蓋即可。
//
// main（2x3 大選單）：
//   A 最新消息   B 教育課程   C 活動報名
//   D 商圈優惠   E 找里長聊聊 F 緊急聯絡
// C「活動報名」與 E「找里長聊聊」都是 richmenuswitch，切到對應子選單
// （不送文字訊息）。
//
// findchief（2 大按鈕 + 返回主選單）：
//   G 案件通報（左半）        H 只想聊聊（右半）
//   I 返回主選單（下方整條，richmenuswitch 切回 main）
// G/H 用「message」動作送出真實文字訊息，直接重用現有的案件通報／
// 聊天流程，不需要另外處理。
//
// apply（2 大按鈕 + 返回主選單，版面同 findchief）：
//   J 活動報名（左半）        K 課程報名（右半）
//   L 返回主選單（下方整條，richmenuswitch 切回 main）
// J/K 用 postback（action=menu&menu=apply_event / apply_course），
// 對應的活動／課程報名卡片留待 Phase 6（FB 貼文自動抓取）完成後接上。
//
// 一般功能按鈕 postback data 都是 action=menu&menu=<key>，由
// workers/events-api/src/line.js 的 handleLineMenuEvent_() 接手分流；
// richmenuswitch 按鈕只負責切換畫面，line.js 收到對應 postback 會直接
// 忽略，不會額外回訊息。
// ============================================================
var RICH_MENU_LINE_API_BASE_ = "https://api.line.me/v2/bot/richmenu";
var RICH_MENU_UPLOAD_API_BASE_ = "https://api-data.line.me/v2/bot/richmenu";

var RICH_MENU_SETUP_ = {
  main: {
    aliasId: "richmenu-alias-main",
    name: "舊社里小幫手主選單",
    chatBarText: "選單",
    size: { width: 2500, height: 1686 },
    imageFileId: "1HHoLUnzjXJ43YvsfJv_gK4ODsC7HQtyn",
    // 圖片最上面約 250px 是 Logo 橫幅（非按鈕區），下方 1436px 才是 2x3
    // 按鈕格，平分成兩排各 718px。如果實測點擊還是偏移，把 LOGO_BAND_H_
    // 改成實際 Logo 橫幅的像素高度重新算一次就好。
    areas: (function () {
      var LOGO_BAND_H_ = 250;
      var ROW_H_ = (1686 - LOGO_BAND_H_) / 2;
      var row1Y = LOGO_BAND_H_;
      var row2Y = LOGO_BAND_H_ + ROW_H_;
      return [
        { bounds: { x: 0, y: row1Y, width: 833, height: ROW_H_ }, action: { type: "postback", label: "最新消息", data: "action=menu&menu=news" } },
        { bounds: { x: 833, y: row1Y, width: 834, height: ROW_H_ }, action: { type: "postback", label: "教育課程", data: "action=menu&menu=course" } },
        { bounds: { x: 1667, y: row1Y, width: 833, height: ROW_H_ }, action: { type: "richmenuswitch", label: "活動報名", richMenuAliasId: "richmenu-alias-apply", data: "action=menu&menu=apply" } },
        { bounds: { x: 0, y: row2Y, width: 833, height: ROW_H_ }, action: { type: "postback", label: "商圈優惠", data: "action=menu&menu=store" } },
        { bounds: { x: 833, y: row2Y, width: 834, height: ROW_H_ }, action: { type: "richmenuswitch", label: "找里長聊聊", richMenuAliasId: "richmenu-alias-findchief", data: "action=menu&menu=findchief" } },
        { bounds: { x: 1667, y: row2Y, width: 833, height: ROW_H_ }, action: { type: "postback", label: "緊急聯絡", data: "action=menu&menu=emergency" } },
      ];
    })(),
  },
  findchief: {
    aliasId: "richmenu-alias-findchief",
    name: "舊社里小幫手_找里長聊聊",
    chatBarText: "找里長",
    size: { width: 2500, height: 1686 },
    imageFileId: "1GCVJ2rP7xj8awt_VwQBZMBA0cO2ZupIZ",
    areas: [
      { bounds: { x: 0, y: 0, width: 1250, height: 1500 }, action: { type: "uri", label: "案件通報", uri: "https://gsnbhs.pages.dev/report" } },
      { bounds: { x: 1250, y: 0, width: 1250, height: 1500 }, action: { type: "postback", label: "只想聊聊", data: "action=menu&menu=chat_start" } },
      { bounds: { x: 0, y: 1500, width: 2500, height: 186 }, action: { type: "richmenuswitch", label: "返回主選單", richMenuAliasId: "richmenu-alias-main", data: "action=menu&menu=backmain" } },
    ],
  },
  apply: {
    aliasId: "richmenu-alias-apply",
    name: "舊社里小幫手_我要報名",
    chatBarText: "報名",
    size: { width: 2500, height: 1686 },
    imageFileId: "1L3M-MtCiB2h-7x28Sbi3cog-YzQYQMps",
    areas: [
      { bounds: { x: 0, y: 0, width: 1250, height: 1500 }, action: { type: "postback", label: "活動報名", data: "action=menu&menu=apply_event" } },
      { bounds: { x: 1250, y: 0, width: 1250, height: 1500 }, action: { type: "postback", label: "課程報名", data: "action=menu&menu=apply_course" } },
      { bounds: { x: 0, y: 1500, width: 2500, height: 186 }, action: { type: "richmenuswitch", label: "返回主選單", richMenuAliasId: "richmenu-alias-main", data: "action=menu&menu=backmain" } },
    ],
  },
};

function richMenuAuthHeader_() {
  return { Authorization: "Bearer " + LINE_CHANNEL_ACCESS_TOKEN_ };
}

function createRichMenu_(def) {
  var res = UrlFetchApp.fetch(RICH_MENU_LINE_API_BASE_, {
    method: "post",
    contentType: "application/json",
    headers: richMenuAuthHeader_(),
    payload: JSON.stringify({
      size: def.size,
      selected: false,
      name: def.name,
      chatBarText: def.chatBarText,
      areas: def.areas,
    }),
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  var body = JSON.parse(res.getContentText() || "{}");
  if (code < 200 || code >= 300) {
    throw new Error("建立 Rich Menu 失敗：HTTP " + code + " " + res.getContentText());
  }
  return body.richMenuId;
}

function uploadRichMenuImage_(richMenuId, driveFileId) {
  var blob = DriveApp.getFileById(driveFileId).getBlob();
  var res = UrlFetchApp.fetch(RICH_MENU_UPLOAD_API_BASE_ + "/" + richMenuId + "/content", {
    method: "post",
    contentType: blob.getContentType(),
    headers: richMenuAuthHeader_(),
    payload: blob.getBytes(),
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error("上傳 Rich Menu 圖片失敗：HTTP " + code + " " + res.getContentText());
  }
}

function deleteRichMenuAliasIfExists_(aliasId) {
  UrlFetchApp.fetch(RICH_MENU_LINE_API_BASE_ + "/alias/" + aliasId, {
    method: "delete",
    headers: richMenuAuthHeader_(),
    muteHttpExceptions: true,
  });
}

function createRichMenuAlias_(aliasId, richMenuId) {
  deleteRichMenuAliasIfExists_(aliasId);
  var res = UrlFetchApp.fetch(RICH_MENU_LINE_API_BASE_ + "/alias", {
    method: "post",
    contentType: "application/json",
    headers: richMenuAuthHeader_(),
    payload: JSON.stringify({ richMenuId: richMenuId, richMenuAliasId: aliasId }),
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error("建立 Rich Menu Alias 失敗：HTTP " + code + " " + res.getContentText());
  }
}

function setDefaultRichMenu_(richMenuId) {
  var res = UrlFetchApp.fetch(
    "https://api.line.me/v2/bot/user/all/richmenu/" + richMenuId,
    {
      method: "post",
      headers: richMenuAuthHeader_(),
      muteHttpExceptions: true,
    },
  );
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error("設定預設 Rich Menu 失敗：HTTP " + code + " " + res.getContentText());
  }
}

function deleteAllRichMenus_() {
  var res = UrlFetchApp.fetch(RICH_MENU_LINE_API_BASE_ + "/list", {
    method: "get",
    headers: richMenuAuthHeader_(),
    muteHttpExceptions: true,
  });
  var list = JSON.parse(res.getContentText() || "{}").richmenus || [];
  list.forEach(function (m) {
    UrlFetchApp.fetch(RICH_MENU_LINE_API_BASE_ + "/" + m.richMenuId, {
      method: "delete",
      headers: richMenuAuthHeader_(),
      muteHttpExceptions: true,
    });
  });
  console.log("[richmenu] 已刪除舊選單共 " + list.length + " 個");
}

// 手動執行入口：清掉舊選單 → 建立 main/findchief/apply 三個選單 →
// 上傳圖片 → 設定 alias → 把 main 設為預設選單
function setupRichMenuPages() {
  deleteAllRichMenus_();

  var ids = {};
  Object.keys(RICH_MENU_SETUP_).forEach(function (key) {
    var def = RICH_MENU_SETUP_[key];
    if (!def.imageFileId || def.imageFileId.indexOf("PUT_") === 0) {
      throw new Error("請先在 RICH_MENU_SETUP_." + key + ".imageFileId 填入 Drive 圖片檔案 ID");
    }
    var richMenuId = createRichMenu_(def);
    uploadRichMenuImage_(richMenuId, def.imageFileId);
    createRichMenuAlias_(def.aliasId, richMenuId);
    ids[key] = richMenuId;
    console.log("[richmenu] " + key + " -> " + richMenuId);
  });

  setDefaultRichMenu_(ids.main);
  console.log("[richmenu] 設定完成，預設選單：main");
}

