// ============================================================
// NeighborhoodSystem Apps Script — 特約商店後端 API
// 部署方式：Google Apps Script → 部署 → 管理部署 → 更新至最新版本
//           部署類型：Web App，執行身分：我，存取：所有人
// ============================================================

// ⚠️ 填入你的 Google Sheet ID
var SHEET_ID     = '__SHEET_ID__';
var SHEET_STORES = '商店清單';      // 工作表名稱
var SHEET_ADMINS = '管理員名單';    // 工作表名稱（與 HPNBHS 共用或新建）

// ⚠️ 填入 Google OAuth Client ID（與 config.js 相同）
var GOOGLE_CLIENT_ID = '__GOOGLE_CLIENT_ID__';

// API Key（公開端點，與 config.js 相同）
var API_KEY = '__API_KEY__';

// Session TTL: 6 小時
var SESSION_TTL = 21600;

// ── 路由 ──
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    switch (data.action) {
      case 'login':            return handleLogin(data);
      case 'getStores':        return requireAdmin(data, handleGetStores);
      case 'getStore':         return requireAdmin(data, handleGetStore);
      case 'updateStore':      return requireAdmin(data, handleUpdateStore);
      case 'getPublicStores':  return handleGetPublicStores(data);   // 公開端點，不需登入
      default:
        return jsonOut({ success: false, error: 'Unknown action' });
    }
  } catch (err) {
    return jsonOut({ success: false, error: err.toString() });
  }
}

function doGet(e) {
  return jsonOut({ success: false, error: 'POST only' });
}

// ══════════════════════════════════════════════
// AUTH — 登入 & Session 管理
// ══════════════════════════════════════════════

function handleLogin(data) {
  var idToken = data.id_token;
  if (!idToken) return jsonOut({ success: false, error: 'Missing id_token' });

  var payload = verifyGoogleToken(idToken);
  if (!payload) return jsonOut({ success: false, error: 'Invalid token' });

  var email = (payload.email || '').toLowerCase().trim();
  var admin = checkAdmin(email);
  if (!admin.valid) return jsonOut({ success: false, error: 'Not authorized' });

  var sessionToken = Utilities.getUuid();
  CacheService.getScriptCache().put(
    'sess_' + sessionToken,
    JSON.stringify({ email: email, name: admin.name }),
    SESSION_TTL
  );

  return jsonOut({ success: true, sessionToken: sessionToken, name: admin.name, email: email });
}

function verifyGoogleToken(idToken) {
  try {
    var url = 'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken);
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;
    var p = JSON.parse(res.getContentText());
    if (p.aud !== GOOGLE_CLIENT_ID) return null;
    if (p.email_verified === 'false') return null;
    return p;
  } catch (e) { return null; }
}

function checkAdmin(email) {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_ADMINS);
  if (!sheet) return { valid: false };
  var data = sheet.getDataRange().getValues();
  // 欄位：username(0) password(1) display_name(2) role(3) active(4) email(5)
  for (var i = 1; i < data.length; i++) {
    var rowEmail = String(data[i][5] || '').toLowerCase().trim();
    var active   = String(data[i][4] || '').toUpperCase();
    if (rowEmail === email && active === 'TRUE') {
      return { valid: true, name: String(data[i][2] || '') };
    }
  }
  return { valid: false };
}

function getSession(token) {
  if (!token) return null;
  var raw = CacheService.getScriptCache().get('sess_' + token);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function requireAdmin(data, handler) {
  var sess = getSession(data.sessionToken);
  if (!sess) return jsonOut({ success: false, error: 'Unauthorized', code: 401 });
  data._session = sess;
  return handler(data);
}

// ══════════════════════════════════════════════
// DATA — 商店讀取
// ══════════════════════════════════════════════

// Google Sheet 欄位對照（1-based，對應 getRange 欄號）:
//  1(A)=商店ID,      2(B)=申請時間,    3(C)=狀態,
//  4(D)=商家類別,    5(E)=申請人姓名,  6(F)=申請人電話,
//  7(G)=申請人LineID,8(H)=店家名稱,    9(I)=店家電話,
// 10(J)=統一編號,   11(K)=經營內容,   12(L)=優惠方案,
// 13(M)=營業時間,   14(N)=店家地址,   15(O)=地圖網址,
// 16(P)=照片1,      17(Q)=照片2,      18(R)=照片3,
// 19(S)=管理員備註, 20(T)=最後更新,   21(U)=審核人,
// 22(V)=公開店名,   23(W)=公開類別,   24(X)=公開電話,
// 25(Y)=公開地址,   26(Z)=公開地圖,   27(AA)=公開經營內容,
// 28(AB)=公開優惠,  29(AC)=公開營業時間, 30(AD)=公開統一編號,
// 31(AE)=方案類型,  32(AF)=置頂順序

function handleGetStores(data) {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_STORES);
  if (!sheet) return jsonOut({ success: false, error: 'Sheet not found: ' + SHEET_STORES });
  var all = sheet.getDataRange().getValues();
  var stores = [];
  for (var i = 1; i < all.length; i++) {
    if (!all[i][0]) continue;
    stores.push(rowToStore(all[i]));
  }
  return jsonOut({ success: true, stores: stores });
}

function handleGetStore(data) {
  var storeId = String(data.storeId || '');
  if (!storeId) return jsonOut({ success: false, error: 'Missing storeId' });
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_STORES);
  if (!sheet) return jsonOut({ success: false, error: 'Sheet not found' });
  var all = sheet.getDataRange().getValues();
  for (var i = 1; i < all.length; i++) {
    if (String(all[i][0]) === storeId) {
      return jsonOut({ success: true, storeData: rowToStore(all[i]) });
    }
  }
  return jsonOut({ success: false, error: '找不到商店: ' + storeId });
}

// 公開端點：只回傳已公開商店的公開欄位，不含申請人個資
function handleGetPublicStores(data) {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_STORES);
  if (!sheet) return jsonOut({ success: false, error: 'Sheet not found' });
  var all = sheet.getDataRange().getValues();
  var stores = [];
  for (var i = 1; i < all.length; i++) {
    if (!all[i][0]) continue;
    if (String(all[i][2]) !== '已公開') continue;  // C 欄=狀態
    stores.push(rowToPublicStore(all[i]));
  }
  return jsonOut({ success: true, stores: stores });
}

function rowToStore(r) {
  return {
    storeId:    String(r[0]  || ''),
    applyTime:  fmtDate(r[1]),
    status:     String(r[2]  || ''),
    category:   String(r[3]  || ''),
    name:       String(r[4]  || ''),   // 申請人姓名
    phone:      String(r[5]  || ''),   // 申請人電話
    lineId:     String(r[6]  || ''),   // 申請人LineID
    storeName:  String(r[7]  || ''),
    storePhone: String(r[8]  || ''),
    storeNum:   String(r[9]  || ''),
    desc:       String(r[10] || ''),
    offer:      String(r[11] || ''),
    hours:      String(r[12] || ''),
    addr:       String(r[13] || ''),
    mapUrl:     String(r[14] || ''),
    photo1:     String(r[15] || ''),
    photo2:     String(r[16] || ''),
    photo3:     String(r[17] || ''),
    note:       String(r[18] || ''),
    lastUpdate: fmtDate(r[19]),
    reviewer:   String(r[20] || ''),
    pubName:    String(r[21] || ''),
    pubCate:    String(r[22] || ''),
    pubPhone:   String(r[23] || ''),
    pubAddr:    String(r[24] || ''),
    pubMapUrl:  String(r[25] || ''),
    pubDesc:     String(r[26] || ''),
    pubOffer:    String(r[27] || ''),
    pubHours:    String(r[28] || ''),
    pubStoreNum: String(r[29] || ''),
    planType:    String(r[30] || '免費'),
    pinOrder:    Number(r[31] || 0),
  };
}

function rowToPublicStore(r) {
  return {
    storeId:     String(r[0]  || ''),
    photo1:      String(r[15] || ''),    // 代表照片
    pubName:     String(r[21] || ''),
    pubCate:     String(r[22] || ''),
    pubPhone:    String(r[23] || ''),
    pubAddr:     String(r[24] || ''),
    pubMapUrl:   String(r[25] || ''),
    pubDesc:     String(r[26] || ''),
    pubOffer:    String(r[27] || ''),
    pubHours:    String(r[28] || ''),
    pubStoreNum: String(r[29] || ''),
  };
}

function fmtDate(v) {
  if (!v) return '';
  if (v instanceof Date) {
    return Utilities.formatDate(v, 'Asia/Taipei', 'yyyy-MM-dd HH:mm');
  }
  return String(v);
}

// ══════════════════════════════════════════════
// DATA — 商店審核更新
// ══════════════════════════════════════════════

function handleUpdateStore(data) {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_STORES);
  if (!sheet) return jsonOut({ success: false, error: 'Sheet not found' });

  var all = sheet.getDataRange().getValues();
  var rowIndex = -1;
  for (var i = 1; i < all.length; i++) {
    if (String(all[i][0]) === String(data.storeId)) {
      rowIndex = i + 1; // 轉為 1-based
      break;
    }
  }
  if (rowIndex === -1) return jsonOut({ success: false, error: '找不到商店: ' + data.storeId });

  var now = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm');

  sheet.getRange(rowIndex,  3).setValue(data.status   || '');  // C: 狀態
  sheet.getRange(rowIndex, 19).setValue(data.note     || '');  // S: 管理員備註
  sheet.getRange(rowIndex, 20).setValue(now);                  // T: 最後更新
  sheet.getRange(rowIndex, 21).setValue(data.reviewer || '');  // U: 審核人
  sheet.getRange(rowIndex, 31).setValue(data.planType || '免費');  // AE: 方案類型
  sheet.getRange(rowIndex, 32).setValue(Number(data.pinOrder) || 0);  // AF: 置頂順序

  // 公開資訊欄位（只有狀態為已公開時才覆蓋，避免改回審核中時清空）
  if (data.status === '已公開') {
    sheet.getRange(rowIndex, 22).setValue(data.pubName   || '');  // V: 公開店名
    sheet.getRange(rowIndex, 23).setValue(data.pubCate   || '');  // W: 公開類別
    sheet.getRange(rowIndex, 24).setValue(data.pubPhone  || '');  // X: 公開電話
    sheet.getRange(rowIndex, 25).setValue(data.pubAddr   || '');  // Y: 公開地址
    sheet.getRange(rowIndex, 26).setValue(data.pubMapUrl || '');  // Z: 公開地圖
    sheet.getRange(rowIndex, 27).setValue(data.pubDesc   || '');  // AA: 公開經營內容
    sheet.getRange(rowIndex, 28).setValue(data.pubOffer  || '');  // AB: 公開優惠
    sheet.getRange(rowIndex, 29).setValue(data.pubHours    || '');  // AC: 公開營業時間
    sheet.getRange(rowIndex, 30).setValue(data.pubStoreNum || '');  // AD: 公開統一編號
  }

  return jsonOut({ success: true });
}

// ── 輸出 ──
function jsonOut(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
