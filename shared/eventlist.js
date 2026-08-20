(function(){
  // LINE WebView 強制開外部瀏覽器
  var ua = navigator.userAgent||'';
  if(/Line\//i.test(ua)&&!/Chrome\//i.test(ua)){
    location.href='intent://'+location.href.replace(/^https?:\/\//,'')+'#Intent;scheme=https;action=android.intent.action.VIEW;end';
  }
})();

const SCRIPT_URL = CONFIG.SCRIPT_URL;
const EVENT_API_URL = CONFIG.EVENT_API_URL || '';
const EVENT_API_ACTIONS = new Set([
  'getEvents',
  'getRegistrations',
  'checkInRegistration',
  'updateEventStatus',
  'deleteEvent',
  'updateRegistration',
  'addWalkInRegistration',
  'deleteRegistration',
  'getSurveys',
  'createSurvey',
  'updateSurvey',
  'deleteSurvey',
  'getSurveyResponses',
  'updateSurveyResidentNote',
  'addSurveyWalkInAttendance',
  'getLineUserRegistrationHistory',
  'resetReminderSent',
  'resetSurveySentAt',
  'deleteSurveyEntry',
  'reorderEvents',
  'copyRegistration'
]);
let SESSION = null;
/* SESSION_KEY, SESSION_TTL — moved to utils.js */
const CACHE_NAMESPACE = new URL(CONFIG.BASE_URL).hostname.split('.')[0];
const EVENTS_CACHE_KEY = CACHE_NAMESPACE + '_eventlist_cache_v2';
const REGISTRATIONS_CACHE_PREFIX = CACHE_NAMESPACE + '_event_regs_';
let allEvents = [];
let currentFilter = 'all';
let sortableEventsInstance = null;
let pendingDeleteId = null;
let pendingDeleteHasReg = false;
let currentDrawerEventId = null;
let currentDrawerEventName = '';
let currentDrawerSurveyId = null;
var _currentQrUrl = '';
var _currentQrPin = '';
let currentRegs = [];
let currentRegHeaders = [];
let registrationLocalOverrides = {};
let regSortCol = null;
let regSortDir = 'asc';
let editingRegIndex = null;
let googleScriptLoading = false;
let allSurveys = [];
let surveyModalView = 'list';
const SURVEYS_CACHE_KEY = CACHE_NAMESPACE + '_surveys_cache_v1';
let currentSurveyId = null;
let currentSurveyResponses = [];
let currentSurveyResponseEvents = [];
let currentSurveyResponseSurvey = null;

function backendUrlForAction(action){
  return EVENT_API_URL && EVENT_API_ACTIONS.has(action) ? EVENT_API_URL : SCRIPT_URL;
}
function postBackend(action, payload){
  const body = Object.assign({action}, payload || {});
  if(SESSION && SESSION.id_token && EVENT_API_URL && EVENT_API_ACTIONS.has(action)){
    body.id_token = SESSION.id_token;
  }
  return fetch(backendUrlForAction(action), {
    method:'POST',
    body:JSON.stringify(body)
  });
}

// ── 登入 ──
function initGoogle(){
  if(typeof google==='undefined'){
    if(googleScriptLoading) return;
    googleScriptLoading = true;
    const s = document.createElement('script');
    s.id = 'googleIdentityScript';
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.onload = function(){ googleScriptLoading = false; initGoogle(); };
    s.onerror = function(){ googleScriptLoading = false; showLoginError('Google 登入元件載入失敗，請重新整理頁面。'); };
    document.head.appendChild(s);
    return;
  }
  google.accounts.id.initialize({
    client_id: CONFIG.GOOGLE_CLIENT_ID,
    callback: onGoogleLogin,
    auto_select: false
  });
  google.accounts.id.renderButton(document.getElementById('loginBtnWrap'),{
    type:'standard', theme:'outline', size:'large', text:'signin_with', locale:'zh-TW', width:300
  });
}
function tryRestoreSession(){
  try{
    const raw=localStorage.getItem(SESSION_KEY);
    if(!raw) return false;
    const data=JSON.parse(raw);
    if(!data.sessionToken||Date.now()-data.ts>SESSION_TTL){localStorage.removeItem(SESSION_KEY);return false;}
    SESSION=data;
    enterApp();
    return true;
  }catch(e){return false;}
}
function enterApp(){
  document.getElementById('loginShell').style.display='none';
  document.getElementById('mainPage').style.display='block';
  const hasCache = renderCachedEvents();
  if(!hasCache) renderEmptyEvents();
  loadEvents({ keepExisting: true });
}
document.addEventListener('DOMContentLoaded',function(){if(!tryRestoreSession()) initGoogle();});

function onGoogleLogin(res){
  fetch(EVENT_API_URL || SCRIPT_URL,{method:'POST',body:JSON.stringify({action:'login',id_token:res.credential})})
    .then(r=>r.json()).then(d=>{
      if(!d.success){showLoginError(d.error||'登入失敗');return;}
      SESSION=Object.assign(d,{id_token:res.credential});
      localStorage.setItem(SESSION_KEY,JSON.stringify({sessionToken:d.sessionToken,email:d.email,name:d.name,role:d.role,id_token:res.credential,ts:Date.now()}));
      enterApp();
    }).catch(()=>showLoginError('網路錯誤，請稍後再試'));
}
function showLoginError(msg){
  const el=document.getElementById('loginError');
  el.textContent=msg; el.style.display='block';
}

// ── 載入活動 ──
function renderCachedEvents(){
  try{
    const raw = sessionStorage.getItem(EVENTS_CACHE_KEY);
    if(!raw) return false;
    const cache = JSON.parse(raw);
    if(!cache || !Array.isArray(cache.events)) return false;
    allEvents = cache.events;
    renderStats();
    renderCards();
    return true;
  }catch(e){
    sessionStorage.removeItem(EVENTS_CACHE_KEY);
    return false;
  }
}

function saveEventsCache(events){
  try{
    sessionStorage.setItem(EVENTS_CACHE_KEY, JSON.stringify({
      savedAt: Date.now(),
      events: events || []
    }));
  }catch(e){}
}

function registrationsCacheKey(eventId){
  return REGISTRATIONS_CACHE_PREFIX + String(eventId || '');
}

function getCachedRegistrations(eventId){
  try{
    const raw = sessionStorage.getItem(registrationsCacheKey(eventId));
    if(!raw) return null;
    const cache = JSON.parse(raw);
    if(!cache || !Array.isArray(cache.registrations)) return null;
    return cache;
  }catch(e){
    sessionStorage.removeItem(registrationsCacheKey(eventId));
    return null;
  }
}

function saveRegistrationsCache(eventId, payload){
  try{
    sessionStorage.setItem(registrationsCacheKey(eventId), JSON.stringify({
      savedAt: Date.now(),
      registrations: payload.registrations || [],
      totalHeadcount: parseInt(payload.totalHeadcount) || (payload.registrations || []).length,
      registrationSheet: payload.registrationSheet || ''
    }));
  }catch(e){}
}

function updateCachedRegistration(eventId, regId, updates){
  const cache = getCachedRegistrations(eventId);
  if(!cache) return;
  const reg = cache.registrations.find(r => String(r.regId || '') === String(regId || ''));
  if(!reg) return;
  Object.assign(reg, updates || {});
  saveRegistrationsCache(eventId, cache);
}

function removeCachedRegistration(eventId, regId){
  const cache = getCachedRegistrations(eventId);
  if(!cache) return;
  cache.registrations = cache.registrations.filter(r => String(r.regId || '') !== String(regId || ''));
  cache.totalHeadcount = cache.registrations.length;
  saveRegistrationsCache(eventId, cache);
}

function registrationOverrideKey(eventId, regId){
  return String(eventId || '') + '::' + String(regId || '');
}

function setRegistrationOverride(eventId, regId, updates){
  registrationLocalOverrides[registrationOverrideKey(eventId, regId)] = Object.assign(
    {},
    registrationLocalOverrides[registrationOverrideKey(eventId, regId)] || {},
    updates || {}
  );
}

function applyRegistrationOverrides(eventId, regs){
  (regs || []).forEach(r => {
    const updates = registrationLocalOverrides[registrationOverrideKey(eventId, r.regId)];
    if(updates) Object.assign(r, updates);
  });
  return regs;
}

function loadEvents(options){
  const keepExisting = options && options.keepExisting;
  if(!keepExisting) cardsGrid.innerHTML='<p style="text-align:center;padding:40px;color:var(--muted)">載入中…</p>';
  postBackend('getEvents',{sessionToken:SESSION.sessionToken})
    .then(r=>r.json()).then(d=>{
      if(!d.success){showToast('載入失敗：'+d.error);return;}
      allEvents = d.events||[];
      saveEventsCache(allEvents);
      renderStats();
      renderCards();
    }).catch(()=>showToast('網路錯誤'));
}

function renderEmptyEvents(){
  allEvents = [];
  renderStats();
  renderCards();
}

function renderStats(){
  let active=0,draft=0,closed=0;
  allEvents.forEach(e=>{
    if(e.status==='報名中') active++;
    else if(e.status==='草稿') draft++;
    else closed++;
  });
  document.getElementById('statActive').textContent='🟢 報名中 '+active;
  document.getElementById('statDraft').textContent='📝 草稿 '+draft;
  document.getElementById('statClosed').textContent='🔴 已截止 '+closed;
}

function setFilter(f, btn){
  currentFilter=f;
  document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  renderCards();
}

function renderCards(){
  const grid = document.getElementById('cardsGrid');
  const empty = document.getElementById('emptyState');
  const filtered = currentFilter==='all' ? allEvents : allEvents.filter(e=>e.status===currentFilter);
  if(!filtered.length){ grid.innerHTML=''; empty.style.display='block'; return; }
  empty.style.display='none';
  grid.innerHTML = filtered.map(e=>cardHTML(e)).join('');
  if(sortableEventsInstance){ try{ sortableEventsInstance.destroy(); }catch(e){} }
  if(typeof Sortable !== 'undefined'){
    sortableEventsInstance = Sortable.create(grid, {
      animation: 150,
      delay: 200,
      delayOnTouchOnly: true,
      ghostClass: 'sortable-ghost',
      dragClass: 'sortable-drag',
      onEnd: onSortEnd
    });
  }
}

function onSortEnd(){
  const grid = document.getElementById('cardsGrid');
  const cards = grid.querySelectorAll('.event-card[data-event-id]');
  const orders = [];
  cards.forEach(function(card, i){
    const eventId = card.getAttribute('data-event-id');
    const sortOrder = (i + 1) * 10;
    orders.push({ eventId, sortOrder });
    const ev = allEvents.find(e => e.eventId === eventId);
    if(ev) ev.sortOrder = sortOrder;
  });
  postBackend('reorderEvents', { sessionToken: SESSION.sessionToken, orders })
    .catch(function(){});
}

function toDriveImgUrl(url){
  if(!url) return url;
  var m=url.match(/[?&]id=([^&]+)/);
  if(m&&url.includes('drive.google.com')) return 'https://drive.google.com/thumbnail?id='+m[1]+'&sz=w1000';
  return url;
}

function cardHTML(e){
  const reservedCount = parseInt(e.reservedCount)||0;
  const occupiedCount = (parseInt(e.registeredCount)||0) + reservedCount;
  const reserveText = reservedCount ? `（暫佔中 ${reservedCount}）` : '';
  const quota = e.quota>0
    ? (occupiedCount>=e.quota
        ? `<span class="card-quota full">🔴 ${e.registeredCount}/${e.quota} 已額滿${reserveText}</span>`
        : (occupiedCount>=e.quota*0.8
            ? `<span class="card-quota warn">🟡 ${e.registeredCount}/${e.quota} 即將額滿${reserveText}</span>`
            : `<span class="card-quota ok">🟢 ${e.registeredCount}/${e.quota} 人${reserveText}</span>`))
    : `<span class="card-quota ok">🟢 ${e.registeredCount} 人報名${reserveText}（不限名額）</span>`;
  const badge = e.status==='報名中'
    ? '<span class="badge green">報名中</span>'
    : e.status==='草稿'
    ? '<span class="badge gray">草稿</span>'
    : '<span class="badge red">已截止</span>';
  const thumb = e.imageUrl
    ? `<img class="card-thumb" src="${toDriveImgUrl(e.imageUrl)}" alt="${esc(e.eventName)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`+`<div class="card-thumb-placeholder" style="display:none">🎪</div>`
    : `<div class="card-thumb-placeholder">🎪</div>`;
  const statusOptions=['草稿','報名中','已截止'].map(s=>`<option${s===e.status?' selected':''}>${s}</option>`).join('');
  return `
<div class="event-card" id="card-${e.eventId}" data-event-id="${e.eventId}">
  ${thumb}
  <div class="card-body">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
      <span class="card-name">${esc(e.eventName)}</span>
      ${badge}
    </div>
    ${e.eventDate?`<div class="card-meta"><span>📅 ${esc(e.eventDate)}</span></div>`:''}
    ${e.eventLocation?`<div class="card-meta"><span>📍 ${esc(e.eventLocation)}</span></div>`:''}
    ${(e.registrationStart||e.registrationEnd)?`<div class="card-meta"><span>🕒 報名：${esc(formatDateRangeText(e.registrationStart,e.registrationEnd)||'未設定')}</span></div>`:''}
    ${quota}
    ${e.questions&&e.questions.length?`<div style="font-size:12px;color:var(--muted);margin-top:2px">📋 ${e.questions.length} 道問題</div>`:''}
    ${e.surveyId&&e.surveySentAt?`<div style="font-size:11px;color:var(--muted);margin-top:2px">📨 問券已推播 <button onclick="resetSurveySentAt('${e.eventId}')" style="font-size:11px;color:#b45309;background:none;border:none;cursor:pointer;padding:0;text-decoration:underline">重置</button></div>`:''}
  </div>
  <div class="card-footer">
    <select class="status-select" onchange="changeStatus('${e.eventId}',this.value)">
      ${statusOptions}
    </select>
    <button class="btn" style="font-size:12px;padding:7px 12px" onclick="goEdit('${e.eventId}')">✏️ 編輯</button>
    <button class="btn" style="font-size:12px;padding:7px 12px" onclick="openRegistrations('${e.eventId}','${esc(e.eventName)}','${esc(e.surveyId||'')}')">👥 名單</button>
    <button class="btn danger" style="font-size:12px;padding:7px 12px;margin-left:auto" onclick="askDelete('${e.eventId}',${e.registeredCount})">刪除</button>
  </div>
</div>`;
}

// ── 重置問券推播 ──
function resetSurveySentAt(eventId){
  if(!confirm('確定要重置問券推播記錄？下次排程執行時將重新推播。')) return;
  postBackend('resetSurveySentAt',{sessionToken:SESSION.sessionToken,eventId})
    .then(r=>r.json()).then(d=>{
      if(d.success){
        const ev=allEvents.find(e=>e.eventId===eventId);
        if(ev) ev.surveySentAt='';
        saveEventsCache(allEvents);
        renderCards();
        showToast('已重置，下次排程將重新推播問券');
      } else showToast('重置失敗：'+(d.error||''));
    }).catch(()=>showToast('網路錯誤'));
}

// ── 狀態切換 ──
function changeStatus(eventId, status){
  postBackend('updateEventStatus',{sessionToken:SESSION.sessionToken,eventId,status})
    .then(r=>r.json()).then(d=>{
      if(d.success){
        const ev=allEvents.find(e=>e.eventId===eventId);
        if(ev) ev.status=status;
        saveEventsCache(allEvents);
        renderStats(); renderCards();
        showToast('狀態已更新為：'+status);
      } else showToast('更新失敗：'+d.error);
    }).catch(()=>showToast('網路錯誤'));
}

// ── 刪除 ──
function askDelete(eventId, regCount){
  pendingDeleteId=eventId; pendingDeleteHasReg=regCount>0;
  const msg = regCount>0
    ? `此活動已有 ${regCount} 筆報名資料，刪除後無法還原，確定要刪除？`
    : '刪除後無法還原，確定要刪除？';
  document.getElementById('deleteMsg').textContent=msg;
  document.getElementById('deleteModal').classList.add('open');
}
function closeDeleteModal(){ document.getElementById('deleteModal').classList.remove('open'); }
function confirmDelete(){
  if(!pendingDeleteId) return;
  document.getElementById('confirmDeleteBtn').disabled=true;
  postBackend('deleteEvent',{sessionToken:SESSION.sessionToken,eventId:pendingDeleteId,force:true})
    .then(r=>r.json()).then(d=>{
      document.getElementById('confirmDeleteBtn').disabled=false;
      closeDeleteModal();
      if(d.success){
        allEvents=allEvents.filter(e=>e.eventId!==pendingDeleteId);
        saveEventsCache(allEvents);
        renderStats(); renderCards();
        showToast('活動已刪除');
      } else showToast('刪除失敗：'+d.error);
    }).catch(()=>{document.getElementById('confirmDeleteBtn').disabled=false;showToast('網路錯誤');});
}

// ── 報名名單 ──
const REG_COL_MAP={displayName:'LINE姓名',consentGiven:'肖像同意',submittedAt:'報名時間',checkedIn:'簽到',residentNote:'備註',lineReminderOptIn:'LINE提醒'};
const REG_COL_CLASS={checkedIn:'reg-col-checkin',displayName:'reg-col-name',residentNote:'reg-col-note',consentGiven:'reg-col-consent',submittedAt:'reg-col-time',lineReminderOptIn:'reg-col-reminder'};
const REG_HIDDEN=new Set(['lineUserId','regId','eventId','headcount']);
const REG_FIRST=['checkedIn','displayName'];
const REG_LAST=['lineReminderOptIn','consentGiven','submittedAt','residentNote'];
const REG_FIXED=new Set([...REG_FIRST,...REG_LAST]);

function normalizeRegKeys(reg, labelToQId){
  // Convert text-key answers to stable q_id keys so old+new records share the same columns
  const norm={...reg};
  for(const [label,qId] of Object.entries(labelToQId)){
    if(label in norm && !(qId in norm)){norm[qId]=norm[label];delete norm[label];}
  }
  return norm;
}
function buildRegTableHTML(eventId, regs){
  const evt=(allEvents||[]).find(e=>e.eventId===eventId);
  const qIdMap={};
  const labelToQId={};
  for(const q of (evt?.questions||[])){
    if(q.id){qIdMap[q.id]=q.label;if(q.label)labelToQId[q.label]=q.id;}
  }
  const nameFieldQId=(evt?.questions||[]).find(q=>q.isNameField)?.id||null;
  // nameField question becomes its own "姓名" column; displayName always stays as "LINE姓名"
  const getColLabel=h=>(h===nameFieldQId)?'姓名':(REG_COL_MAP[h]||qIdMap[h]||h);
  // Normalize all regs to q_id keys for consistent column mapping
  const normRegs=Object.keys(labelToQId).length?regs.map(r=>normalizeRegKeys(r,labelToQId)):[...regs];
  // Apply column sort if active
  if(regSortCol){
    const sc=regSortCol,dir=regSortDir==='asc'?1:-1;
    normRegs.sort((a,b)=>{
      let va=String(a[sc]||''),vb=String(b[sc]||'');
      // TRUE/FALSE: treat TRUE > FALSE
      if(va==='TRUE')va='1';else if(va==='FALSE')va='0';
      if(vb==='TRUE')vb='1';else if(vb==='FALSE')vb='0';
      return va.localeCompare(vb,'zh-Hant-TW',{numeric:true})*dir;
    });
  }
  // Update currentRegs to normalized+sorted so edit modal reads correct keys
  for(let i=0;i<normRegs.length;i++)currentRegs[i]=normRegs[i];
  const dataKeys=new Set(normRegs.flatMap(r=>Object.keys(r)));
  // Sort custom cols by question order so columns follow Q1→Q2→Q3 regardless of JSON key position
  const qOrder=(evt?.questions||[]).map(q=>q.id);
  const customCols=[...dataKeys].filter(h=>!REG_HIDDEN.has(h)&&!REG_FIXED.has(h)&&h!==nameFieldQId)
    .sort((a,b)=>{const ia=qOrder.indexOf(a),ib=qOrder.indexOf(b);return(ia<0?999:ia)-(ib<0?999:ib);});
  // When isNameField is set, insert that question as "姓名" column right after checkedIn,
  // keeping displayName visible as "LINE姓名"
  const firstCols=nameFieldQId&&dataKeys.has(nameFieldQId)
    ?['checkedIn','displayName',nameFieldQId]
    :REG_FIRST;
  const headers=[...firstCols,...customCols,...REG_LAST.filter(h=>dataKeys.has(h))];
  currentRegHeaders=headers;
  const thHtml=headers.map(h=>{
    const cls=REG_COL_CLASS[h]||'';
    const isActive=regSortCol===h;
    const ind=isActive?(regSortDir==='asc'?'▲':'▼'):'⇅';
    const indStyle=`font-size:10px;opacity:${isActive?1:0.3};margin-left:3px`;
    return `<th class="${cls}" style="cursor:pointer;user-select:none;white-space:nowrap" onclick="sortRegTable('${h}')" title="點擊依此欄排序">${esc(getColLabel(h))}<span style="${indStyle}">${ind}</span></th>`;
  }).join('')+`<th class="reg-action-col">操作</th>`;
  const rowsHtml=normRegs.map((r,idx)=>{
    const rid=esc(String(r.regId||''));
    const actionHtml=`<td class="reg-action-col"><div class="reg-actions"><button class="reg-edit-btn" onclick="openRegistrationEdit(${idx})">編</button><button class="reg-copy-btn" onclick="copyRegistrationRow('${eventId}','${rid}',this)" title="複製此筆報名">複</button><button class="reg-del-btn" onclick="deleteRegistration('${eventId}','${rid}',this)">刪</button></div></td>`;
    const cellsHtml=headers.map(h=>{
      const cls=REG_COL_CLASS[h]?` class="${REG_COL_CLASS[h]}"`:''
      if(h==='checkedIn'){
        const chk=(r[h]||'FALSE')==='TRUE';
        return `<td${cls}><button class="reg-checkin-btn${chk?' checked':''}" onclick="checkIn('${eventId}','${rid}','${chk?'TRUE':'FALSE'}',this)">${chk?'✅':'⬜'}</button></td>`;
      }
      if(h==='lineReminderOptIn'){
        const on=(r[h]||'FALSE')==='TRUE';
        return `<td${cls}><button class="reg-checkin-btn${on?' checked':''}" onclick="toggleReminderOptIn('${eventId}','${rid}','${on?'TRUE':'FALSE'}',this)">${on?'🔔':'🔕'}</button></td>`;
      }
      if(h==='residentNote'){
        const note=r.residentNote||'';
        const uid=esc(r.lineUserId||'');
        const noLine=!r.lineUserId;
        return `<td${cls}><div style="display:flex;align-items:center;gap:6px"><input type="text" class="reg-note-input" data-userid="${uid}" data-name="${esc(r.displayName||'')}" value="${esc(note)}" placeholder="${noLine?'（非 LINE 報名）':'真實姓名、職業等'}"${noLine?' disabled':''}>${noLine?'':` <button class="reg-note-save-btn" onclick="saveRegistrationNote(this)">儲存</button>`}</div></td>`;
      }
      let v=r[h]||'';
      if(h==='consentGiven') v=v==='TRUE'?'✅':'—';
      if(h==='submittedAt'&&v) v=formatTaipeiDateTime(v);
      return `<td${cls}>${esc(String(v))}</td>`;
    }).join('');
    return `<tr>${cellsHtml}${actionHtml}</tr>`;
  }).join('');
  return `<table class="reg-table"><thead><tr>${thHtml}</tr></thead><tbody>${rowsHtml}</tbody></table>`;
}

function exportRegistrationsExcel(){
  if(!currentRegs||!currentRegs.length){showToast('目前沒有報名資料可匯出');return;}
  if(typeof XLSX==='undefined'){showToast('匯出功能載入中，請稍後再試');return;}
  const headers=(currentRegHeaders&&currentRegHeaders.length)?currentRegHeaders:Object.keys(currentRegs[0]);
  const evt=(allEvents||[]).find(e=>e.eventId===currentDrawerEventId);
  const qIdMap={};
  for(const q of (evt?.questions||[])){if(q.id)qIdMap[q.id]=q.label;}
  const nameFieldQId=(evt?.questions||[]).find(q=>q.isNameField)?.id||null;
  const getColLabel=h=>(h===nameFieldQId)?'姓名':(REG_COL_MAP[h]||qIdMap[h]||h);
  const cellVal=(r,h)=>{
    let v=r[h]||'';
    if(h==='checkedIn') return v==='TRUE'?'已簽到':'未簽到';
    if(h==='lineReminderOptIn') return v==='TRUE'?'開啟':'關閉';
    if(h==='consentGiven') return v==='TRUE'?'同意':'未同意';
    if(h==='submittedAt'&&v) return formatTaipeiDateTime(v);
    return String(v);
  };
  const aoa=[headers.map(getColLabel)];
  for(const r of currentRegs){
    aoa.push(headers.map(h=>cellVal(r,h)));
  }
  const ws=XLSX.utils.aoa_to_sheet(aoa);
  const CJK_RE=new RegExp('['+
    '\\u3000-\\u30FF'+   // CJK punctuation, Hiragana, Katakana
    '\\u3400-\\u4DBF'+   // CJK ext A
    '\\u4E00-\\u9FFF'+   // CJK unified ideographs
    '\\uF900-\\uFAFF'+   // CJK compat ideographs
    '\\uFF00-\\uFFEF'+   // fullwidth forms
    ']');
  const dispWidth=s=>String(s).split('').reduce((w,ch)=>w+(CJK_RE.test(ch)?2:1),0);
  ws['!cols']=headers.map((h,i)=>{
    const maxLen=aoa.reduce((m,row)=>Math.max(m,dispWidth(row[i]||'')),0);
    return {wch:Math.min(Math.max(maxLen+2,8),40)};
  });
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'報名名單');
  const d=new Date();
  const pad=n=>String(n).padStart(2,'0');
  const stamp=`${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}`;
  const safeName=(currentDrawerEventName||'活動').replace(/[\\/:*?"<>|]/g,'_');
  XLSX.writeFile(wb,`${safeName}_報名名單_${stamp}.xlsx`);
  showToast('已匯出報名名單');
}

function copyRegistrationRow(eventId, regId, btn){
  const ev=(allEvents||[]).find(e=>e.eventId===eventId);
  if(ev && parseInt(ev.quota)>0){
    const occupied=(parseInt(ev.registeredCount)||0)+(parseInt(ev.reservedCount)||0);
    if(occupied>=parseInt(ev.quota)){showToast('此活動名額已滿，無法複製');return;}
  }
  if(btn){btn.disabled=true;btn.textContent='…';}
  postBackend('copyRegistration',{sessionToken:SESSION.sessionToken,eventId,regId})
    .then(r=>r.json()).then(d=>{
      if(btn){btn.disabled=false;btn.textContent='複';}
      if(!d.success){showToast('複製失敗：'+(d.error||''));return;}
      if(ev) ev.registeredCount=d.registeredCount;
      currentRegs.push(d.registration);
      const wrap=document.querySelector('.reg-table-wrap');
      if(wrap) wrap.innerHTML=buildRegTableHTML(eventId,currentRegs);
      showToast('已複製一筆報名');
    }).catch(()=>{if(btn){btn.disabled=false;btn.textContent='複';}showToast('網路錯誤');});
}

function sortRegTable(col){
  if(regSortCol===col){
    regSortDir=regSortDir==='asc'?'desc':'asc';
  } else {
    regSortCol=col;
    regSortDir='asc';
  }
  const wrap=document.querySelector('.reg-table-wrap');
  if(wrap) wrap.innerHTML=buildRegTableHTML(currentDrawerEventId,currentRegs);
}

function saveRegistrationNote(btn){
  const td=btn.closest('td');
  const ta=td.querySelector('.reg-note-input');
  const lineUserId=ta.dataset.userid;
  const displayName=ta.dataset.name;
  const note=ta.value;
  if(!lineUserId){showToast('非 LINE 報名，無法儲存備註');return;}
  btn.disabled=true; btn.textContent='儲存中…';
  postBackend('updateSurveyResidentNote',{sessionToken:SESSION.sessionToken,lineUserId,displayName,note})
    .then(r=>r.json()).then(d=>{
      btn.disabled=false; btn.textContent='儲存';
      if(d.success) showToast('備註已儲存');
      else showToast('儲存失敗：'+(d.error||''));
    }).catch(()=>{btn.disabled=false;btn.textContent='儲存';showToast('網路錯誤');});
}

function addWalkInRegistration(){
  if(!currentDrawerEventId){showToast('請先開啟報名名單');return;}
  showQrModal(currentDrawerEventId, currentDrawerEventName);
}

var _qrInstance = null;
function showQrModal(eventId, eventName){
  if(!CONFIG.LINE_BOT_ID){
    showToast('請先在 config.js 填入 LINE_BOT_ID');return;
  }
  var lineId = CONFIG.LINE_BOT_ID.replace(/^@/, '');
  var pin = eventId.split('_').pop() || eventId.slice(-4);
  var lineUrl = 'https://line.me/R/oaMessage/@' + lineId + '/?' + encodeURIComponent(pin);
  _currentQrUrl = lineUrl;
  document.getElementById('qrModalTitle').textContent = eventName || '現場報名';
  document.getElementById('qrModalSub').textContent = '① 掃碼開啟 LINE 官方帳號 → ② 報名碼已自動帶入，直接按「傳送」即可開始報名';
  document.getElementById('qrPinWrap').style.display = '';
  document.getElementById('qrPin').textContent = pin;
  _currentQrPin = pin;
  var canvas = document.getElementById('qrCanvas');
  canvas.innerHTML = '';
  _qrInstance = new QRCode(canvas, {
    text: lineUrl, width: 200, height: 200,
    colorDark: '#1E160E', colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.M
  });
  document.getElementById('qrBackdrop').classList.add('open');
}
function showSurveyQrModal(){
  if(!currentDrawerEventId||!currentDrawerSurveyId){showToast('此活動尚未設定問券');return;}
  if(!CONFIG.LINE_BOT_ID){showToast('請先在 config.js 填入 LINE_BOT_ID');return;}
  var lineId = CONFIG.LINE_BOT_ID.replace(/^@/, '');
  var msg = '問券_' + currentDrawerEventId + '_' + currentDrawerSurveyId;
  var lineUrl = 'https://line.me/R/oaMessage/@' + lineId + '/?' + encodeURIComponent(msg);
  _currentQrUrl = lineUrl;
  document.getElementById('qrModalTitle').textContent = currentDrawerEventName + '｜活動問券';
  document.getElementById('qrModalSub').textContent = '① 掃碼開啟 LINE 官方帳號 → ② 點「傳送」→ 自動收到問券連結';
  document.getElementById('qrPinWrap').style.display = 'none';
  _currentQrPin = '';
  var canvas = document.getElementById('qrCanvas');
  canvas.innerHTML = '';
  _qrInstance = new QRCode(canvas, {
    text: lineUrl, width: 200, height: 200,
    colorDark: '#1E160E', colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.M
  });
  document.getElementById('qrBackdrop').classList.add('open');
}
function closeQrModal(){
  document.getElementById('qrBackdrop').classList.remove('open');
}
function copyQrModalLink(){
  if(!_currentQrUrl){showToast('請先開啟 QR Code');return;}
  var text = _currentQrPin
    ? ('點選連結開啟 LINE，報名碼會自動帶入，直接按「傳送」即可開始報名\n\n' + _currentQrUrl)
    : ('點選連結開啟 LINE，會自動帶入問券訊息，直接按「傳送」即可收到問券連結\n\n' + _currentQrUrl);
  navigator.clipboard.writeText(text).then(()=>showToast('連結已複製')).catch(()=>showToast('複製失敗，請手動複製'));
}
function printQrModal(){
  if(!_currentQrUrl){showToast('請先開啟 QR Code');return;}
  var printCanvas = document.getElementById('qrPrintCanvas');
  printCanvas.innerHTML = '';
  new QRCode(printCanvas, {
    text: _currentQrUrl, width: 600, height: 600,
    colorDark: '#1E160E', colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.M
  });
  setTimeout(function(){
    window.print();
    setTimeout(function(){ printCanvas.innerHTML = ''; }, 1000);
  }, 300);
}

function toggleReminderOptIn(eventId, regId, current, btn){
  if(btn.dataset.syncing==='1') return;
  const newVal=current==='TRUE'?'FALSE':'TRUE';
  const applyState=(val)=>{
    const isOn=val==='TRUE';
    btn.className='reg-checkin-btn'+(isOn?' checked':'');
    btn.textContent=isOn?'🔔':'🔕';
    btn.setAttribute('onclick',`toggleReminderOptIn('${eventId}','${regId}','${val}',this)`);
  };
  btn.dataset.syncing='1';
  applyState(newVal);
  postBackend('updateRegistration',{sessionToken:SESSION.sessionToken,eventId,regId,updates:{lineReminderOptIn:newVal}})
    .then(r=>r.json()).then(d=>{
      btn.dataset.syncing='0';
      if(!d.success){applyState(current);showToast('更新失敗：'+(d.error||''));return;}
      const reg=currentRegs.find(r=>r.regId===regId);
      if(reg) reg.lineReminderOptIn=newVal;
      saveRegistrationsCache(eventId,{registrations:currentRegs,totalHeadcount:currentRegs.length});
    }).catch(()=>{btn.dataset.syncing='0';applyState(current);showToast('網路錯誤');});
}

function openRegistrations(eventId, eventName, surveyId){
  currentDrawerEventId=eventId;
  currentDrawerEventName=eventName;
  currentDrawerSurveyId=surveyId||null;
  regSortCol=null; regSortDir='asc';
  document.getElementById('drawerTitle').textContent='👥 '+eventName+' 報名名單';
  var sqBtn=document.getElementById('surveyQrBtn');
  if(sqBtn) sqBtn.style.display='flex';
  document.getElementById('drawerBody').innerHTML='<p style="text-align:center;padding:40px;color:var(--muted)">載入中…</p>';
  document.getElementById('drawerOverlay').classList.add('open');
  document.getElementById('drawer').classList.add('open');
  sessionStorage.removeItem(registrationsCacheKey(eventId));
  postBackend('getRegistrations',{sessionToken:SESSION.sessionToken,eventId})
    .then(r=>r.json()).then(d=>{
      if(!d.success){document.getElementById('drawerBody').innerHTML='<p style="color:var(--accent);text-align:center;padding:40px">載入失敗：'+esc(d.error||'')+'</p>';return;}
      const regs=applyRegistrationOverrides(eventId, d.registrations||[]);
      const totalPeople=parseInt(d.totalHeadcount)||regs.length;
      const reservedCount=parseInt(d.reservedCount)||0;
      const ev=allEvents.find(e=>e.eventId===eventId);
      if(ev) ev.reservedCount=reservedCount;
      saveRegistrationsCache(eventId, {registrations: regs, totalHeadcount: totalPeople, reservedCount, registrationSheet: d.registrationSheet || ''});
      currentRegs=regs;
      if(!regs.length){document.getElementById('drawerBody').innerHTML=`<p style="text-align:center;padding:40px;color:var(--muted)">尚無報名資料${reservedCount?`，暫佔中 ${reservedCount} 人`:''}</p>`;return;}
      document.getElementById('drawerBody').innerHTML=
        `<p style="margin-bottom:12px;font-size:13px;color:var(--muted)">共 ${regs.length} 筆報名資料，合計 ${totalPeople} 人${reservedCount?`，暫佔中 ${reservedCount} 人`:''}</p>`+
        `<div class="reg-table-wrap">${buildRegTableHTML(eventId,regs)}</div>`;
    }).catch(()=>{document.getElementById('drawerBody').innerHTML='<p style="color:var(--accent);text-align:center;padding:40px">網路錯誤</p>';});
}
function renderRegistrationsDrawerFast(eventId, data, fromCache){
  const regs = data.registrations || [];
  const totalPeople = parseInt(data.totalHeadcount) || regs.length;
  const reservedCount = parseInt(data.reservedCount) || 0;
  window.__currentRegistrationSheet = data.registrationSheet || window.__currentRegistrationSheet || '';
  currentRegs = regs;
  if(!regs.length){
    document.getElementById('drawerBody').innerHTML=`<p style="text-align:center;padding:40px;color:var(--muted)">目前沒有報名資料${reservedCount?`，暫佔中 ${reservedCount} 人`:''}</p>`;
    return;
  }
  document.getElementById('drawerBody').innerHTML=
    `<p style="margin-bottom:12px;font-size:13px;color:var(--muted)">共 ${regs.length} 筆報名資料，合計 ${totalPeople} 人${reservedCount?`，暫佔中 ${reservedCount} 人`:''}${fromCache?'（背景同步中）':''}</p>`+
    `<div class="reg-table-wrap">${buildRegTableHTML(eventId,regs)}</div>`;
}

function openRegistrationEdit(index){
  editingRegIndex=index;
  const reg=currentRegs[index];
  if(!reg){showToast('找不到報名資料');return;}
  const evt=(allEvents||[]).find(e=>e.eventId===currentDrawerEventId);
  const qIdMap={};
  for(const q of (evt?.questions||[])){if(q.id)qIdMap[q.id]=q.label;}
  const colMap={...REG_COL_MAP,...qIdMap};
  const fields=currentRegHeaders.filter(h=>h!=='submittedAt'&&h!=='residentNote'&&h!=='checkedIn');
  document.getElementById('editRegForm').innerHTML=fields.map((h,i)=>{
    const label=esc(colMap[h]||h);
    const value=reg[h]||'';
    const key=encodeURIComponent(h);
    if(h==='consentGiven'){
      return `<div class="edit-field"><label>${label}</label><select data-field="${key}"><option value="TRUE"${value==='TRUE'?' selected':''}>同意</option><option value="FALSE"${value!=='TRUE'?' selected':''}>不同意 / 未同意</option></select></div>`;
    }
    return `<div class="edit-field"><label>${label}</label><textarea data-field="${key}">${esc(String(value))}</textarea></div>`;
  }).join('');
  document.getElementById('editRegModal').classList.add('open');
}
function closeEditRegModal(){
  document.getElementById('editRegModal').classList.remove('open');
  editingRegIndex=null;
}
function saveRegistrationEdit(){
  const reg=currentRegs[editingRegIndex];
  if(!reg){showToast('找不到報名資料');return;}
  const updates={};
  document.querySelectorAll('#editRegForm [data-field]').forEach(el=>{
    updates[decodeURIComponent(el.getAttribute('data-field'))]=el.value;
  });
  const btn=document.getElementById('saveRegBtn');
  btn.disabled=true; btn.textContent='儲存中';
  postBackend('updateRegistration',{sessionToken:SESSION.sessionToken,eventId:currentDrawerEventId,regId:reg.regId,updates})
    .then(r=>r.json()).then(d=>{
      btn.disabled=false; btn.textContent='儲存修改';
      if(!d.success){showToast('儲存失敗：'+(d.error||''));return;}
      closeEditRegModal();
      const ev=allEvents.find(e=>e.eventId===currentDrawerEventId);
      if(ev&&d.registeredCount!==undefined) ev.registeredCount=parseInt(d.registeredCount)||0;
      updateCachedRegistration(currentDrawerEventId, reg.regId, updates);
      saveEventsCache(allEvents);
      renderStats(); renderCards();
      showToast('報名資料已更新');
      const cachedAfterEdit=getCachedRegistrations(currentDrawerEventId);
      if(cachedAfterEdit) renderRegistrationsDrawerFast(currentDrawerEventId,cachedAfterEdit,false);
    }).catch(()=>{btn.disabled=false;btn.textContent='儲存修改';showToast('網路錯誤');});
}
function deleteRegistration(eventId, regId, btn){
  if(!eventId||!regId){showToast('缺少報名資料編號');return;}
  if(!confirm('確定刪除此筆報名資料？刪除後會重新計算活動報名人數。')) return;
  btn.disabled=true;
  btn.textContent='…';
  postBackend('deleteRegistration',{sessionToken:SESSION.sessionToken,eventId,regId})
    .then(r=>r.json()).then(d=>{
      if(!d.success){btn.disabled=false;btn.textContent='刪';showToast('刪除失敗：'+(d.error||''));return;}
      const ev=allEvents.find(e=>e.eventId===eventId);
      if(ev&&d.registeredCount!==undefined) ev.registeredCount=parseInt(d.registeredCount)||0;
      removeCachedRegistration(eventId, regId);
      saveEventsCache(allEvents);
      renderStats(); renderCards();
      showToast('報名資料已刪除');
      const cachedAfterDelete=getCachedRegistrations(eventId);
      if(cachedAfterDelete) renderRegistrationsDrawerFast(eventId,cachedAfterDelete,false);
    }).catch(()=>{btn.disabled=false;btn.textContent='刪';showToast('網路錯誤');});
}
function closeDrawer(){
  document.getElementById('drawerOverlay').classList.remove('open');
  document.getElementById('drawer').classList.remove('open');
  currentDrawerEventId=null;
  currentDrawerEventName='';
}

// ── 導頁 ──
function goCreate(){ location.href='./eventdetail.html'; }
function goEdit(id){ location.href='./eventdetail.html?id='+id; }

// ── 工具 ──
function showToast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),2800);
}
/* esc — moved to utils.js */
function formatDateTimeText(value){
  if(!value) return '';
  if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(value))){
    const s=String(value);
    return s.slice(0,10).replace(/-/g,'/')+' '+s.slice(11,16);
  }
  const d=new Date(value);
  if(Number.isNaN(d.getTime())) return String(value).slice(0,16);
  const pad=n=>String(n).padStart(2,'0');
  return d.getFullYear()+'/'+pad(d.getMonth()+1)+'/'+pad(d.getDate())+' '+pad(d.getHours())+':'+pad(d.getMinutes());
}
function formatDateRangeText(start,end){
  const s=formatDateTimeText(start), e=formatDateTimeText(end);
  if(s&&e) return s+' - '+e;
  return s||e||'';
}

// ── 簽到切換 ──
function checkIn(eventId, regId, currentState, btn){
  if(btn.dataset.syncing==='1') return;
  const newState = currentState !== 'TRUE';
  const previousState = currentState === 'TRUE';
  const applyButtonState = (checked) => {
    const ns = checked ? 'TRUE' : 'FALSE';
    btn.setAttribute('onclick',`checkIn('${eventId}','${regId}','${ns}',this)`);
    if(checked){
      btn.classList.add('checked');
      btn.textContent='✅';
    } else {
      btn.classList.remove('checked');
      btn.textContent='⬜';
    }
  };

  btn.dataset.syncing='1';
  btn.classList.add('syncing');
  applyButtonState(newState);
  setRegistrationOverride(eventId, regId, {checkedIn: newState ? 'TRUE' : 'FALSE'});
  updateCachedRegistration(eventId, regId, {checkedIn: newState ? 'TRUE' : 'FALSE'});

  const cached = getCachedRegistrations(eventId);
  const registrationSheet = (cached && cached.registrationSheet) || window.__currentRegistrationSheet || '';
  postBackend('checkInRegistration',{sessionToken:SESSION.sessionToken,eventId,regId,checkedIn:newState,registrationSheet})
    .then(r=>r.json()).then(d=>{
      btn.dataset.syncing='0';
      btn.classList.remove('syncing');
      if(!d.success){
        applyButtonState(previousState);
        setRegistrationOverride(eventId, regId, {checkedIn: previousState ? 'TRUE' : 'FALSE'});
        updateCachedRegistration(eventId, regId, {checkedIn: previousState ? 'TRUE' : 'FALSE'});
        showToast('簽到同步失敗：'+(d.error||''));
        return;
      }
      const committed = d.checkedIn !== undefined ? !!d.checkedIn : newState;
      applyButtonState(committed);
      setRegistrationOverride(eventId, regId, {checkedIn: committed ? 'TRUE' : 'FALSE'});
      updateCachedRegistration(eventId, regId, {checkedIn: committed ? 'TRUE' : 'FALSE'});
    }).catch(()=>{
      btn.dataset.syncing='0';
      btn.classList.remove('syncing');
      applyButtonState(previousState);
      setRegistrationOverride(eventId, regId, {checkedIn: previousState ? 'TRUE' : 'FALSE'});
      updateCachedRegistration(eventId, regId, {checkedIn: previousState ? 'TRUE' : 'FALSE'});
      showToast('簽到同步失敗，已還原');
    });
}

// ── 問券管理 ──
function openSurveyModal(){
  document.getElementById('surveyModal').classList.add('open');
  renderCachedSurveys();
  loadSurveys();
}
function closeSurveyModal(){
  document.getElementById('surveyModal').classList.remove('open');
  document.getElementById('surveyModalTitle').textContent='📋 問券管理';
}
function loadSurveys(){
  if(!allSurveys.length) document.getElementById('surveyModalBody').innerHTML='<p style="text-align:center;color:var(--muted);padding:30px">載入中…</p>';
  postBackend('getSurveys',{sessionToken:SESSION.sessionToken})
    .then(r=>r.json()).then(d=>{
      if(!d.success){
        if(surveyModalView==='list') document.getElementById('surveyModalBody').innerHTML='<p style="color:var(--accent);text-align:center;padding:30px">載入失敗</p>';
        return;
      }
      allSurveys = d.surveys||[];
      saveSurveysCache();
      if(surveyModalView==='list') renderSurveyList();
    }).catch(()=>{
      if(surveyModalView==='list') document.getElementById('surveyModalBody').innerHTML='<p style="color:var(--accent);text-align:center;padding:30px">網路錯誤</p>';
    });
}
function saveSurveysCache(){
  try{ sessionStorage.setItem(SURVEYS_CACHE_KEY, JSON.stringify({savedAt:Date.now(), surveys:allSurveys||[]})); }catch(e){}
}
function renderCachedSurveys(){
  try{
    const raw=sessionStorage.getItem(SURVEYS_CACHE_KEY);
    if(!raw) return false;
    const cache=JSON.parse(raw);
    if(!cache || !Array.isArray(cache.surveys)) return false;
    allSurveys=cache.surveys;
    renderSurveyList();
    return true;
  }catch(e){
    sessionStorage.removeItem(SURVEYS_CACHE_KEY);
    return false;
  }
}
function renderSurveyList(){
  surveyModalView='list';
  document.getElementById('surveyModalTitle').textContent='📋 問券管理';
  document.getElementById('surveyAddBtn').style.display='';
  let html='';
  if(!allSurveys.length){
    html='<p style="text-align:center;color:var(--muted);padding:30px">尚無問券，請新增</p>';
  } else {
    html=allSurveys.map(sv=>{
      const questions = sv.questions || [];
      return `<div class="survey-list-item">
      <div style="flex:1"><div class="survey-item-name">${esc(sv.surveyName)}</div><div class="survey-item-meta">${questions.length} 題</div></div>
      <div class="survey-item-actions">
        <button class="srv-edit-btn" onclick="previewSurvey('${esc(String(sv.surveyId))}')">預覽</button>
        <button class="srv-edit-btn" onclick="openSurveyEdit('${esc(String(sv.surveyId))}')">編輯</button>
        <button class="srv-edit-btn" onclick="openSurveyResponses('${esc(String(sv.surveyId))}')">回覆列表</button>
        <button class="srv-edit-btn" onclick="copySurveyLink('${esc(String(sv.surveyId))}')">複製</button>
        <button class="srv-del-btn" onclick="deleteSurveyItem('${esc(String(sv.surveyId))}',this)">刪除</button>
      </div>
    </div>`;
    }).join('');
  }
  document.getElementById('surveyModalBody').innerHTML=html;
}

function openSurveyResponses(surveyId, keepFilters){
  const sv = allSurveys.find(s=>s.surveyId===surveyId);
  if(!sv){showToast('找不到問券');return;}
  surveyModalView='responses';
  currentSurveyResponseSurvey = sv;
  if(!keepFilters){
    window.__srvRespSearch = '';
    window.__srvRespEvent = 'all';
    window.__srvRespStatus = 'all';
  }
  document.getElementById('surveyModalTitle').textContent='📋 回覆列表';
  document.getElementById('surveyAddBtn').style.display='none';
  document.getElementById('surveyModalBody').innerHTML='<p style="text-align:center;color:var(--muted);padding:30px">讀取回覆中…</p>';
  postBackend('getSurveyResponses',{sessionToken:SESSION.sessionToken,surveyId})
    .then(r=>r.json()).then(d=>{
      if(!d.success){document.getElementById('surveyModalBody').innerHTML='<p style="color:var(--accent);text-align:center;padding:30px">讀取失敗：'+esc(d.error||'')+'</p>';return;}
      currentSurveyResponses = d.responses || [];
      currentSurveyResponseEvents = d.events || [];
      renderSurveyResponses();
    }).catch(()=>{document.getElementById('surveyModalBody').innerHTML='<p style="color:var(--accent);text-align:center;padding:30px">網路錯誤</p>';});
}

function surveyStatusLabel(row){
  if(row.registered && row.attended && row.filled) return '有報名／有參加／有填';
  if(row.registered && row.attended && !row.filled) return '有報名／有參加／未填';
  if(row.registered && !row.attended && row.filled) return '有報名／未參加／有填';
  if(row.registered && !row.attended && !row.filled) return '有報名／未參加／未填';
  if(!row.registered && row.attended && row.filled) return '沒報名／有參加／有填';
  if(!row.registered && row.attended && !row.filled) return '沒報名／有參加／未填';
  return '未填';
}
function surveyStatusClass(row){
  if(row.filled && row.attended) return 'ok';
  if(row.filled) return 'warn';
  return 'miss';
}
function filterSurveyResponseRows(){
  const keyword=(document.getElementById('srvRespSearch')?.value||'').trim().toLowerCase();
  const eventId=document.getElementById('srvRespEvent')?.value||'all';
  const status=document.getElementById('srvRespStatus')?.value||'all';
  return currentSurveyResponses.filter(r=>{
    if(eventId!=='all' && r.eventId!==eventId) return false;
    if(status==='filled' && !r.filled) return false;
    if(status==='missing' && r.filled) return false;
    if(status==='attended_filled' && !(r.attended && r.filled)) return false;
    if(status==='attended_missing' && !(r.attended && !r.filled)) return false;
    if(status==='registered_absent_filled' && !(r.registered && !r.attended && r.filled)) return false;
    if(status==='registered_absent_missing' && !(r.registered && !r.attended && !r.filled)) return false;
    if(status==='walkin_filled' && !(!r.registered && r.attended && r.filled)) return false;
    if(status==='walkin_missing' && !(!r.registered && r.attended && !r.filled)) return false;
    if(keyword){
      const hay=[r.displayName,r.residentNote,r.eventName,r.status,surveyStatusLabel(r),Object.values(r.answers||{}).join(' ')].join(' ').toLowerCase();
      if(!hay.includes(keyword)) return false;
    }
    return true;
  });
}
function formatTaipeiDateTime(value){
  if(!value) return '—';
  const raw = String(value);
  let date = null;
  if(/^\d{4}-\d{2}-\d{2}T/.test(raw)){
    date = new Date(raw);
  } else if(/^\d{4}\/\d{2}\/\d{2}/.test(raw)){
    return raw.substring(0,16);
  } else if(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(raw)){
    return raw.substring(0,16).replace(/-/g,'/');
  }
  if(!date || isNaN(date.getTime())) return raw.substring(0,16).replace('T',' ');
  return new Intl.DateTimeFormat('zh-TW',{
    timeZone:'Asia/Taipei',
    year:'numeric',
    month:'2-digit',
    day:'2-digit',
    hour:'2-digit',
    minute:'2-digit',
    hour12:false
  }).format(date).replace(/\//g,'/');
}
function renderSurveyResponses(){
  if(document.getElementById('srvRespSearch')) window.__srvRespSearch = document.getElementById('srvRespSearch').value || '';
  if(document.getElementById('srvRespEvent')) window.__srvRespEvent = document.getElementById('srvRespEvent').value || 'all';
  if(document.getElementById('srvRespStatus')) window.__srvRespStatus = document.getElementById('srvRespStatus').value || 'all';
  const sv = currentSurveyResponseSurvey || {};
  const eventOptions = ['<option value="all">全部活動</option>'].concat(currentSurveyResponseEvents.map(ev=>`<option value="${esc(ev.eventId)}">${esc(ev.eventName)}</option>`)).join('');
  const total = currentSurveyResponses.length;
  const filled = currentSurveyResponses.filter(r=>r.filled).length;
  const missing = currentSurveyResponses.filter(r=>!r.filled).length;
  const rows = filterSurveyResponseRows();
  const answerColumns = [];
  (sv.questions||[]).forEach(q=>{
    const label=(q.label||'').trim();
    if(label && !answerColumns.includes(label)) answerColumns.push(label);
  });
  rows.forEach(r=>{
    Object.keys(r.answers||{}).forEach(label=>{
      if(label && !answerColumns.includes(label)) answerColumns.push(label);
    });
  });
  const answerHeads = answerColumns.map(label=>`<th class="answer-col">${esc(label)}</th>`).join('');
  const body = rows.length ? rows.map(r=>{
    const answerCells = answerColumns.map(label=>{
      const value = r.filled ? String((r.answers||{})[label] || '').trim() : '';
      return `<td class="answer-col">${value ? esc(value) : '<span style="color:var(--muted)">—</span>'}</td>`;
    }).join('');
    let deleteCell = '<td></td>';
    if (r.filled && r.responseId) {
      deleteCell = `<td style="text-align:center"><button class="srv-del-btn" title="刪除此筆回覆" onclick="deleteSurveyEntry('${esc(r.responseId)}','',this)">🗑</button></td>`;
    } else if (!r.filled && r.lineUserId && r.lineUserId.startsWith('walkin:')) {
      const aid = r.lineUserId.replace('walkin:','');
      deleteCell = `<td style="text-align:center"><button class="srv-del-btn" title="刪除此筆回覆" onclick="deleteSurveyEntry('','${esc(aid)}',this)">🗑</button></td>`;
    }
    return `<tr>
      <td>${esc(r.displayName || '未取得名稱')}</td>
      <td><div style="display:flex;align-items:center;gap:6px"><input type="text" class="srv-note-input" data-uid="${esc(r.lineUserId||'')}" data-name="${esc(r.displayName||'')}" value="${esc(r.residentNote||'')}" placeholder="真實姓名、職業等"><button class="srv-edit-btn" onclick="saveSurveyResidentNote(this)">儲存</button></div></td>
      <td>${esc(r.eventName||'')}</td>
      <td><span class="srv-chip ${surveyStatusClass(r)}">${surveyStatusLabel(r)}</span></td>
      <td>${r.filled ? esc(formatTaipeiDateTime(r.submittedAt)) : '—'}</td>
      ${answerCells}
      ${deleteCell}
    </tr>`;
  }).join('') : `<tr><td colspan="${5 + answerColumns.length + 1}" style="text-align:center;color:var(--muted);padding:26px">沒有符合篩選的資料</td></tr>`;
  document.getElementById('surveyModalBody').innerHTML=`
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px">
      <div><div style="font-weight:800;color:var(--heading);font-size:16px">${esc(sv.surveyName||'問券')}</div><div class="survey-item-meta">${(sv.questions||[]).length} 題</div></div>
      <button class="btn" onclick="renderSurveyList()">返回問券列表</button>
    </div>
    <div class="srv-response-summary">
      <span class="srv-chip">全部 ${total}</span>
      <span class="srv-chip ok">已填 ${filled}</span>
      <span class="srv-chip miss">未填 ${missing}</span>
    </div>
    <div class="srv-response-tools">
      <input id="srvRespSearch" type="text" placeholder="搜尋里民、備註、答案…" onkeydown="if(event.key==='Enter')renderSurveyResponses()">
      <select id="srvRespEvent" onchange="renderSurveyResponses()">${eventOptions}</select>
      <select id="srvRespStatus" onchange="renderSurveyResponses()">
        <option value="all">全部狀態</option>
        <option value="filled">已填問券</option>
        <option value="missing">未填問券</option>
        <option value="attended_filled">有參加有填</option>
        <option value="attended_missing">有參加未填</option>
        <option value="registered_absent_filled">有報名未參加有填</option>
        <option value="registered_absent_missing">有報名未參加未填</option>
        <option value="walkin_filled">沒報名有參加有填</option>
        <option value="walkin_missing">沒報名有參加未填</option>
      </select>
      <button class="btn ghost" onclick="addSurveyWalkInAttendance()">新增現場參加者</button>
      <button class="btn" onclick="renderSurveyResponses()">篩選</button>
    </div>
    <div class="srv-response-wrap">
      <table class="srv-response-table">
        <thead><tr><th>里民名稱</th><th>備註</th><th>參加的活動名稱</th><th>狀態</th><th>回填時間</th>${answerHeads}<th></th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
  const search=document.getElementById('srvRespSearch');
  const eventSel=document.getElementById('srvRespEvent');
  const statusSel=document.getElementById('srvRespStatus');
  if(search) search.value = (window.__srvRespSearch || '');
  if(eventSel) eventSel.value = (window.__srvRespEvent || 'all');
  if(statusSel) statusSel.value = (window.__srvRespStatus || 'all');
}

function saveSurveyResidentNote(btn){
  const input=btn.closest('td').querySelector('.srv-note-input');
  const lineUserId=input.getAttribute('data-uid')||'';
  if(!lineUserId){showToast('沒有 LINE 身分，無法儲存備註');return;}
  btn.disabled=true;
  postBackend('updateSurveyResidentNote',{sessionToken:SESSION.sessionToken,lineUserId,displayName:input.getAttribute('data-name')||'',note:input.value||''})
    .then(r=>r.json()).then(d=>{
      btn.disabled=false;
      if(!d.success){showToast('備註儲存失敗：'+(d.error||''));return;}
      currentSurveyResponses.forEach(row=>{if(row.lineUserId===lineUserId) row.residentNote=input.value||'';});
      showToast('備註已儲存');
    }).catch(()=>{btn.disabled=false;showToast('網路錯誤');});
}

function deleteSurveyEntry(responseId, attendanceId, btn){
  if(!confirm('確定要刪除這筆回覆嗎？此操作無法復原。')) return;
  btn.disabled=true;
  const surveyId=(currentSurveyResponseSurvey||{}).surveyId||currentSurveyId||'';
  if(!surveyId){showToast('找不到問券 ID');return;}
  const payload={sessionToken:SESSION.sessionToken,surveyId};
  if(responseId) payload.responseId=responseId;
  if(attendanceId) payload.attendanceId=attendanceId;
  postBackend('deleteSurveyEntry',payload)
    .then(r=>r.json()).then(d=>{
      if(!d.success){btn.disabled=false;showToast('刪除失敗：'+(d.error||''));return;}
      const tr=btn.closest('tr');
      if(tr) tr.remove();
      if(responseId) currentSurveyResponses=currentSurveyResponses.filter(r=>r.responseId!==responseId);
      else if(attendanceId) currentSurveyResponses=currentSurveyResponses.filter(r=>!(r.lineUserId&&r.lineUserId.replace('walkin:','')===attendanceId));
      showToast('已刪除');
    }).catch(()=>{btn.disabled=false;showToast('網路錯誤');});
}

function addSurveyWalkInAttendance(){
  const sv = currentSurveyResponseSurvey || {};
  if(!sv.surveyId){showToast('請先開啟問券回覆列表');return;}
  const selectedEvent = document.getElementById('srvRespEvent')?.value || 'all';
  if(selectedEvent === 'all'){
    showToast('請先在活動下拉選單選定一個活動');
    return;
  }
  const displayName = (prompt('請輸入現場參加者名稱') || '').trim();
  if(!displayName) return;
  const note = (prompt('備註可填真實姓名、職業等，也可以留空') || '').trim();
  postBackend('addSurveyWalkInAttendance',{
    sessionToken:SESSION.sessionToken,
    surveyId:sv.surveyId,
    eventId:selectedEvent,
    displayName,
    note
  }).then(r=>r.json()).then(d=>{
    if(!d.success){showToast('新增失敗：'+(d.error||''));return;}
    showToast('已新增現場參加者');
    window.__srvRespEvent = selectedEvent;
    openSurveyResponses(sv.surveyId, true);
  }).catch(()=>showToast('網路錯誤'));
}

function buildQCard(q, idx){
  const types=[{v:'text',l:'文字輸入'},{v:'single',l:'單選'},{v:'multi',l:'多選'},{v:'scale',l:'量表(1-5)'}];
  const typeOpts=types.map(t=>`<option value="${t.v}"${(q.type||'text')===t.v?' selected':''}>${t.l}</option>`).join('');
  const hasOpts=['single','multi'].includes(q.type||'text');
  const optsHtml=hasOpts?(q.options||[]).map(o=>`<div class="srv-opt-row"><input type="text" value="${esc(o)}" placeholder="選項文字" style="flex:1;padding:5px;border:1px solid #ddd;border-radius:4px;font-size:13px"><button onclick="removeQuestionOption(this)" style="border:none;background:none;color:var(--accent);cursor:pointer;font-size:16px">✕</button></div>`).join(''):'';
  const addOptBtn=hasOpts?`<button onclick="addQuestionOption(this)" class="srv-add-opt-btn" style="font-size:12px;background:none;border:1px dashed #aaa;padding:4px 10px;border-radius:4px;cursor:pointer;color:var(--muted);margin-top:4px">＋ 新增選項</button>`:'';
  const otherRow=hasOpts?`<label class="srv-other-row"><input type="checkbox" class="srv-q-other"${q.allowOther?' checked':''}> 加入「其他」填答</label>`:'';
  return `<div class="srv-q-card">
    <div class="srv-q-header">
      <span class="srv-q-num">第 ${idx+1} 題</span>
      <button class="srv-q-remove" onclick="this.closest('.srv-q-card').remove()">✕ 刪除</button>
    </div>
    <input type="text" class="srv-q-text" value="${esc(q.label||'')}" placeholder="題目文字">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
      <label style="font-size:12px;color:var(--muted)">類型：</label>
      <select class="srv-q-type" onchange="updateQCardOpts(this)" style="padding:4px 8px;border:1px solid #ccc;border-radius:4px;font-size:13px">${typeOpts}</select>
      <label style="font-size:12px;color:var(--muted)"><input type="checkbox" class="srv-q-req"${q.required?' checked':''} style="margin-right:4px">必填</label>
    </div>
    <div class="srv-opts-wrap">${optsHtml}${addOptBtn}${otherRow}</div>
  </div>`;
}
function openSurveyEdit(surveyId){
  surveyModalView='edit';
  document.getElementById('surveyAddBtn').style.display='none';
  currentSurveyId = surveyId || null;
  const sv = surveyId ? allSurveys.find(s=>s.surveyId===surveyId) : null;
  const name = sv ? sv.surveyName : '';
  const introTitle = sv ? (sv.introTitle || sv.surveyName || '') : '';
  const introDescription = sv ? (sv.introDescription || '') : '';
  const outroTitle = sv ? (sv.outroTitle || '問券已送出，感謝！') : '問券已送出，感謝！';
  const outroDescription = sv ? (sv.outroDescription || '您的意見已收到，感謝您的參與！') : '您的意見已收到，感謝您的參與！';
  const qs = sv ? (sv.questions||[]) : [];
  document.getElementById('surveyModalTitle').textContent = surveyId ? '✏️ 編輯問券' : '＋ 新增問券';
  const qHtml = qs.map((q,i)=>buildQCard(q,i)).join('');
  document.getElementById('surveyModalBody').innerHTML=`
    <div style="margin-bottom:12px">
      <label style="font-size:13px;font-weight:600;display:block;margin-bottom:6px">問券名稱</label>
      <input type="text" id="surveyNameInput" value="${esc(name)}" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;font-size:14px;box-sizing:border-box" placeholder="例：活動意見調查">
    </div>
    <div style="margin-bottom:14px;padding:12px;border:1px solid var(--border);border-radius:10px;background:#faf7f2">
      <label style="font-size:13px;font-weight:600;display:block;margin-bottom:6px">封面標題</label>
      <input type="text" id="surveyIntroTitleInput" value="${esc(introTitle)}" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;font-size:14px;box-sizing:border-box;margin-bottom:10px" placeholder="例：一起來規劃${esc((CONFIG.VILLAGE_NAME || '').replace(/^.*區/, ''))}的活動吧">
      <label style="font-size:13px;font-weight:600;display:block;margin-bottom:6px">封面說明</label>
      <textarea id="surveyIntroDescInput" style="width:100%;min-height:88px;padding:8px;border:1px solid #ccc;border-radius:6px;font-size:14px;box-sizing:border-box;resize:vertical" placeholder="例：您好，感謝您參加這次活動。請花一點時間填寫，方便之後有更好的規劃。">${esc(introDescription)}</textarea>
    </div>
    <div id="qCards">${qHtml}</div>
    <button class="srv-add-q-btn" onclick="addSurveyQuestion()">＋ 新增題目</button>
    <div style="margin-top:14px;padding:12px;border:1px solid var(--border);border-radius:10px;background:#faf7f2">
      <label style="font-size:13px;font-weight:600;display:block;margin-bottom:6px">送出後標題</label>
      <input type="text" id="surveyOutroTitleInput" value="${esc(outroTitle)}" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;font-size:14px;box-sizing:border-box;margin-bottom:10px" placeholder="例：問券已送出，感謝！">
      <label style="font-size:13px;font-weight:600;display:block;margin-bottom:6px">送出後說明</label>
      <textarea id="surveyOutroDescInput" style="width:100%;min-height:72px;padding:8px;border:1px solid #ccc;border-radius:6px;font-size:14px;box-sizing:border-box;resize:vertical" placeholder="例：您的意見已收到，感謝您的參與！">${esc(outroDescription)}</textarea>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px">
      <button class="btn ghost" id="previewSurveyBtn" onclick="previewSurvey()" disabled>預覽問券</button>
      <button class="btn ghost" id="copySurveyLinkBtn" onclick="copySurveyLink()" disabled>複製連結</button>
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px">
      <button class="btn" onclick="renderSurveyList()">取消</button>
      <button class="btn primary" id="saveSurveyBtn" onclick="saveSurvey()">儲存問券</button>
    </div>`;
  updateSurveyPreviewButtons();
}

function addSurveyQuestion(){
  const cards=document.getElementById('qCards');
  const idx=cards.querySelectorAll('.srv-q-card').length;
  cards.insertAdjacentHTML('beforeend',buildQCard({type:'text',label:'',required:false},idx));
}
function updateQCardOpts(sel){
  const wrap=sel.closest('.srv-q-card').querySelector('.srv-opts-wrap');
  const hasOpts=['single','multi'].includes(sel.value);
  if(hasOpts){
    if(!wrap.querySelector('.srv-opt-row')){
      wrap.innerHTML=`<div class="srv-opt-row"><input type="text" value="" placeholder="選項文字" style="flex:1;padding:5px;border:1px solid #ddd;border-radius:4px;font-size:13px"><button onclick="removeQuestionOption(this)" style="border:none;background:none;color:var(--accent);cursor:pointer;font-size:16px">✕</button></div><button onclick="addQuestionOption(this)" class="srv-add-opt-btn" style="font-size:12px;background:none;border:1px dashed #aaa;padding:4px 10px;border-radius:4px;cursor:pointer;color:var(--muted);margin-top:4px">＋ 新增選項</button><label class="srv-other-row"><input type="checkbox" class="srv-q-other"> 加入「其他」填答</label>`;
    }
  } else {
    wrap.innerHTML='';
  }
}
function addQuestionOption(btn){
  const wrap=btn.closest('.srv-opts-wrap');
  const newRow=document.createElement('div');
  newRow.className='srv-opt-row';
  newRow.innerHTML=`<input type="text" value="" placeholder="選項文字" style="flex:1;padding:5px;border:1px solid #ddd;border-radius:4px;font-size:13px"><button onclick="removeQuestionOption(this)" style="border:none;background:none;color:var(--accent);cursor:pointer;font-size:16px">✕</button>`;
  wrap.insertBefore(newRow, btn);
}
function removeQuestionOption(btn){
  btn.closest('.srv-opt-row').remove();
}
function saveSurvey(){
  const name=(document.getElementById('surveyNameInput').value||'').trim();
  if(!name){showToast('請輸入問券名稱');return;}
  const introTitle=(document.getElementById('surveyIntroTitleInput').value||'').trim() || name;
  const introDescription=(document.getElementById('surveyIntroDescInput').value||'').trim();
  const outroTitle=(document.getElementById('surveyOutroTitleInput').value||'').trim() || '問券已送出，感謝！';
  const outroDescription=(document.getElementById('surveyOutroDescInput').value||'').trim() || '您的意見已收到，感謝您的參與！';
  const cards=document.querySelectorAll('#qCards .srv-q-card');
  if(!cards.length){showToast('請至少新增一道題目');return;}
  const questions=[];
  let valid=true;
  cards.forEach((card,i)=>{
    const label=(card.querySelector('.srv-q-text').value||'').trim();
    if(!label){showToast(`第 ${i+1} 題題目不能空白`);valid=false;return;}
    const type=card.querySelector('.srv-q-type').value;
    const required=card.querySelector('.srv-q-req').checked;
    const opts=[];
    card.querySelectorAll('.srv-opt-row input').forEach(inp=>{const v=(inp.value||'').trim();if(v)opts.push(v);});
    if(['single','multi'].includes(type)&&opts.length<2){showToast(`第 ${i+1} 題選項至少需要 2 個`);valid=false;return;}
    const allowOther=!!card.querySelector('.srv-q-other')?.checked;
    questions.push({label,type,required,options:opts,allowOther});
  });
  if(!valid) return;
  const btn=document.getElementById('saveSurveyBtn');
  btn.disabled=true; btn.textContent='儲存中…';
  const action=currentSurveyId?'updateSurvey':'createSurvey';
  const payload={action,sessionToken:SESSION.sessionToken,surveyName:name,introTitle,introDescription,outroTitle,outroDescription,questions};
  if(currentSurveyId) payload.surveyId=currentSurveyId;
  postBackend(action,payload)
    .then(r=>r.json()).then(d=>{
      btn.disabled=false; btn.textContent='儲存問券';
      if(!d.success){showToast('儲存失敗：'+(d.error||''));return;}
      showToast(currentSurveyId?'問券已更新':'問券已建立');
      loadSurveys();
    }).catch(()=>{btn.disabled=false;btn.textContent='儲存問券';showToast('網路錯誤');});
}
function getSurveyPreviewUrl(surveyId){
  const id = surveyId || currentSurveyId;
  if(!id) return null;
  const sv = allSurveys.find(s=>s.surveyId===id);
  if(!sv) return null;
  if (sv.surveyFileName) {
    return CONFIG.BASE_URL.replace(/\/$/, '') + '/survey?preview=1&surveyFileName=' + encodeURIComponent(sv.surveyFileName);
  }
  return CONFIG.BASE_URL.replace(/\/$/, '') + '/survey?preview=1&surveyId=' + encodeURIComponent(sv.surveyId);
}
function previewSurvey(surveyId){
  const url = getSurveyPreviewUrl(surveyId);
  if(!url){showToast('請先儲存問券後再預覽');return;}
  window.open(url, '_blank');
}
function copySurveyLink(surveyId){
  const url = getSurveyPreviewUrl(surveyId);
  if(!url){showToast('請先儲存問券後再複製連結');return;}
  navigator.clipboard.writeText(url).then(()=>showToast('問券預覽連結已複製')).catch(()=>showToast('複製失敗，請手動複製'));
}
function updateSurveyPreviewButtons(){
  const btn = document.getElementById('previewSurveyBtn');
  const copyBtn = document.getElementById('copySurveyLinkBtn');
  if(!btn||!copyBtn) return;
  const enabled = !!currentSurveyId;
  btn.disabled = !enabled;
  copyBtn.disabled = !enabled;
}
function deleteSurveyItem(surveyId, btn){
  if(!confirm('確定要刪除此問券？')) return;
  btn.disabled=true;
  postBackend('deleteSurvey',{sessionToken:SESSION.sessionToken,surveyId})
    .then(r=>r.json()).then(d=>{
      if(!d.success){btn.disabled=false;showToast('刪除失敗：'+(d.error||''));return;}
      showToast('問券已刪除');
      loadSurveys();
    }).catch(()=>{btn.disabled=false;showToast('網路錯誤');});
}

// ── 報名記錄查詢 ──
function openHistoryModal(){
  document.getElementById('historyModal').classList.add('open');
  document.getElementById('historySearchInput').value='';
  document.getElementById('historyBody').innerHTML='<p style="text-align:center;color:var(--muted);padding:30px">請輸入姓名或 LINE ID 查詢報名記錄</p>';
}
function closeHistoryModal(){
  document.getElementById('historyModal').classList.remove('open');
}
function searchHistory(){
  const q=(document.getElementById('historySearchInput').value||'').trim();
  if(!q){showToast('請輸入查詢內容');return;}
  document.getElementById('historyBody').innerHTML='<p style="text-align:center;color:var(--muted);padding:30px">查詢中…</p>';
  postBackend('getLineUserRegistrationHistory',{sessionToken:SESSION.sessionToken,query:q})
    .then(r=>r.json()).then(d=>{
      if(!d.success){document.getElementById('historyBody').innerHTML='<p style="color:var(--accent);text-align:center;padding:30px">查詢失敗：'+esc(d.error||'')+'</p>';return;}
      const records=d.records||[];
      if(!records.length){document.getElementById('historyBody').innerHTML='<p style="text-align:center;color:var(--muted);padding:30px">查無資料</p>';return;}
      const rowsHtml=records.map(r=>`<tr>
        <td>${esc(r.displayName||'')}</td>
        <td style="font-size:11px;color:var(--muted)">${esc(r.lineUserId||'')}</td>
        <td>${esc(r.eventName||r.eventId||'')}</td>
        <td>${esc(formatTaipeiDateTime(r.submittedAt))}</td>
        <td>${r.checkedIn==='TRUE'?'✅':'—'}</td>
      </tr>`).join('');
      document.getElementById('historyBody').innerHTML=`<table class="history-table"><thead><tr><th>姓名</th><th>LINE ID</th><th>活動</th><th>報名時間</th><th>簽到</th></tr></thead><tbody>${rowsHtml}</tbody></table>`;
    }).catch(()=>{document.getElementById('historyBody').innerHTML='<p style="color:var(--accent);text-align:center;padding:30px">網路錯誤</p>';});
}
