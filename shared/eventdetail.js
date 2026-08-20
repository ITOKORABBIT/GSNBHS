
(function(){
  var ua=navigator.userAgent||'';
  if(/Line\//i.test(ua)&&!/Chrome\//i.test(ua)){
    location.href='intent://'+location.href.replace(/^https?:\/\//,'')+'#Intent;scheme=https;action=android.intent.action.VIEW;end';
  }
})();

const SCRIPT_URL = CONFIG.SCRIPT_URL;
const EVENT_API_URL = CONFIG.EVENT_API_URL || '';
const EVENT_API_ACTIONS = new Set([
  'getEvent',
  'getEventDetailBundle',
  'createEvent',
  'updateEvent',
  'getEventStats',
  'getSurveys',
  'resetReminderSent',
  'uploadEventImage',
]);
const MAX_Q = 10;
let SESSION = null;
let editId = null;
let questions = []; // [{type,label,required,options,maxLength}]
let requireConsent = false;
let checkinLocationRequired = false;
let uploadedImageUrl = '';
let legacyEventDate = '';
let googleScriptLoading = false;
let allSurveysData = [];

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
  document.getElementById('actionBar').style.display='flex';
  init();
}
function initDtSelects(){
  var IDS=['fRegStart','fRegEnd','fEventStart','fEventEnd','fReminderTime'];
  var opts='<option value="">-- 時間 --</option>';
  for(var h=0;h<24;h++){
    ['00','30'].forEach(function(m){
      var v=String(h).padStart(2,'0')+':'+m;
      opts+='<option value="'+v+'">'+v+'</option>';
    });
  }
  IDS.forEach(function(id){
    var sel=document.getElementById(id+'T');
    if(sel) sel.innerHTML=opts;
  });
}
function getDtVal(id){
  var d=document.getElementById(id+'D');
  var t=document.getElementById(id+'T');
  if(!d||!t||!d.value||!t.value) return '';
  return d.value+'T'+t.value;
}
function setDtVal(id,isoStr){
  var d=document.getElementById(id+'D');
  var t=document.getElementById(id+'T');
  if(!d||!t) return;
  if(!isoStr){d.value='';t.value='';return;}
  var parts=isoStr.split('T');
  d.value=parts[0]||'';
  var timePart=(parts[1]||'00:00').slice(0,5);
  var arr=timePart.split(':').map(Number);
  var h=arr[0],m=arr[1];
  var snapped=m<15?0:m<45?30:0;
  var hAdj=m>=45?(h+1)%24:h;
  t.value=String(hAdj).padStart(2,'0')+':'+String(snapped).padStart(2,'0');
}
document.addEventListener('DOMContentLoaded',function(){
  initDtSelects();
  if(!tryRestoreSession()) initGoogle();
});

function onGoogleLogin(res){
  fetch(EVENT_API_URL || SCRIPT_URL,{method:'POST',body:JSON.stringify({action:'login',id_token:res.credential})})
    .then(r=>r.json()).then(d=>{
      if(!d.success){showLoginError(d.error||'登入失敗');return;}
      SESSION=Object.assign(d,{id_token:res.credential});
      localStorage.setItem(SESSION_KEY,JSON.stringify({sessionToken:d.sessionToken,email:d.email,name:d.name,role:d.role,id_token:res.credential,ts:Date.now()}));
      enterApp();
    }).catch(()=>showLoginError('網路錯誤'));
}
function showLoginError(msg){const el=document.getElementById('loginError');el.textContent=msg;el.style.display='block';}

// ── 初始化 ──
function init(){
  const params=new URLSearchParams(location.search);
  editId=params.get('id')||null;
  if(editId){
    document.getElementById('pageTitle').textContent='編輯活動';
    document.getElementById('pageSubtitle').textContent='修改活動資訊與問券內容';
    loadEvent();
  } else {
    loadSurveyOptions();
    renderQuestions();
  }
}

function loadSurveyOptions(selectedId, selectedTarget, selectedDelay, prefetchedSurveys){
  const p = prefetchedSurveys
    ? Promise.resolve({surveys: prefetchedSurveys})
    : postBackend('getSurveys',{sessionToken:SESSION.sessionToken}).then(r=>r.json());
  p.then(d=>{
    allSurveysData = d.surveys||[];
    const sel=document.getElementById('fSurveyId');
    sel.innerHTML='<option value="">不寄送問券</option>'+
      allSurveysData.map(sv=>`<option value="${esc(sv.surveyId)}">${esc(sv.surveyName)}</option>`).join('');
    if(selectedId) sel.value=selectedId;
    if(selectedTarget){
      const radios=document.querySelectorAll('input[name="surveyTarget"]');
      radios.forEach(r=>{ r.checked = r.value === selectedTarget; });
    }
    if(selectedDelay !== undefined && selectedDelay !== null){
      document.getElementById('fSurveyDelay').value = String(selectedDelay);
    }
    onSurveyChange();
  }).catch(()=>{});
}
function onSurveyChange(){
  const hasSurvey = !!document.getElementById('fSurveyId').value;
  document.getElementById('surveyTimingRow').style.display = hasSurvey ? '' : 'none';
  document.getElementById('surveyTargetRow').style.display = hasSurvey ? '' : 'none';
}

function onReminderModeChange(){
  const isCustom = document.getElementById('rReminderCustom').checked;
  document.getElementById('reminderTimeRow').style.display = isCustom ? '' : 'none';
}

function loadReminderTime(reminderTime, reminderSentAt){
  if(reminderTime && reminderTime !== 'none'){
    document.getElementById('rReminderCustom').checked = true;
    document.getElementById('rReminderNone').checked = false;
    document.getElementById('reminderTimeRow').style.display = '';
    setDtVal('fReminderTime', toDatetimeLocal(reminderTime));
  } else {
    document.getElementById('rReminderNone').checked = true;
    document.getElementById('rReminderCustom').checked = false;
    document.getElementById('reminderTimeRow').style.display = 'none';
    setDtVal('fReminderTime', '');
  }
  const resetBtn = document.getElementById('resetReminderBtn');
  if(resetBtn) resetBtn.style.display = (reminderSentAt && editId) ? '' : 'none';
}

function resetReminderSent(){
  if(!editId){return;}
  postBackend('resetReminderSent',{sessionToken:SESSION.sessionToken,eventId:editId})
    .then(r=>r.json()).then(d=>{
      if(!d.success){alert('重設失敗：'+(d.error||''));return;}
      document.getElementById('resetReminderBtn').style.display='none';
      showSaveMsg('提醒狀態已重設，下個 cron 週期會重新推播');
    }).catch(()=>alert('網路錯誤'));
}

function loadEvent(){
  postBackend('getEventDetailBundle',{sessionToken:SESSION.sessionToken,eventId:editId})
    .then(r=>r.json())
    .then(function(d){
      if(!d.success){showToast('載入失敗：'+d.error);return;}
      const ev=d.event;
      legacyEventDate=ev.eventDate||'';
      document.getElementById('fName').value=ev.eventName||'';
      setDtVal('fRegStart',toDatetimeLocal(ev.registrationStart));
      setDtVal('fRegEnd',toDatetimeLocal(ev.registrationEnd));
      setDtVal('fEventStart',toDatetimeLocal(ev.eventStart));
      setDtVal('fEventEnd',toDatetimeLocal(ev.eventEnd));
      document.getElementById('fLocation').value=ev.eventLocation||'';
      document.getElementById('fMapUrl').value=ev.mapUrl||'';
      checkinLocationRequired=!!ev.checkinLocationRequired;
      document.getElementById('fCheckinLat').value=ev.checkinLatitude||'';
      document.getElementById('fCheckinLng').value=ev.checkinLongitude||'';
      updateCheckinLocationToggle();
      document.getElementById('fDesc').value=ev.description||'';
      document.getElementById('fQuota').value=ev.quota||'';
      document.getElementById('fStatus').value=ev.status||'草稿';
      document.getElementById('fImageUrl').value=ev.imageUrl||'';
      uploadedImageUrl=ev.imageUrl||'';
      if(ev.imageUrl) previewFromUrl(ev.imageUrl);
      requireConsent=!!ev.requireConsent;
      updateConsentToggle();
      questions=JSON.parse(JSON.stringify(ev.questions||[])).map((q,i)=>Object.assign({id:'idx_'+i},q));
      renderQuestions();
      loadSurveyOptions(ev.surveyId||'', ev.surveyTarget||'全部報名',
        ev.surveyDelay !== undefined ? ev.surveyDelay : 60, d.surveys);
      loadReminderTime(ev.reminderTime||'', ev.reminderSentAt||'');
      document.getElementById('statsSection').style.display='block';
      renderStats({success:true, stats:d.stats});
    }).catch(()=>showToast('網路錯誤'));
}

function renderStats(d){
      if(!d.success){document.getElementById('statsContent').innerHTML='<p style="color:var(--muted);font-size:13px">無法載入統計</p>';return;}
      const s=d.stats;
      let html=`<p style="font-size:14px;margin-bottom:12px">共 <strong>${s.total}</strong> 人報名`;
      if(s.totalRegistrations!==undefined) html+=`（${s.totalRegistrations} 筆資料）`;
      if(s.total>0) html+=`，肖像權同意率 <strong>${s.consentRate}%</strong>`;
      html+='</p>';
      for(const label in s.answers){
        const counts=s.answers[label];
        const total=Object.values(counts).reduce((a,b)=>a+b,0)||1;
        html+=`<div style="margin-bottom:14px"><p style="font-size:13px;font-weight:700;margin-bottom:6px">${esc(label)}</p>`;
        for(const opt in counts){
          const pct=Math.round(counts[opt]/total*100);
          html+=`<div class="stat-bar-wrap"><div class="stat-bar-label"><span>${esc(opt)}</span><span>${counts[opt]} 票 (${pct}%)</span></div><div class="stat-bar"><div class="stat-bar-fill" style="width:${pct}%"></div></div></div>`;
        }
        html+='</div>';
      }
      document.getElementById('statsContent').innerHTML=html||'<p style="color:var(--muted);font-size:13px">尚無答題統計</p>';
}

// ── 問券 Builder ──
function renderQuestions(){
  const list=document.getElementById('questionsList');
  list.innerHTML=questions.map((q,i)=>qCardHTML(q,i)).join('');
  document.getElementById('addQBtn').style.display=questions.length>=MAX_Q?'none':'block';
  document.getElementById('warnMaxQ').style.display=questions.length>=MAX_Q?'block':'none';
}

function qCardHTML(q,i){
  const typeOpts=['single','multi','text'].map(t=>`<option value="${t}"${q.type===t?' selected':''}>${{single:'單選',multi:'複選',text:'簡答'}[t]}</option>`).join('');
  let optionsHtml='';
  if(q.type==='single'||q.type==='multi'){
    const maxOpts=q.type==='single'?10:11;
    optionsHtml=`
      <div class="options-list" id="opts-${i}">
        ${(q.options||[]).map((o,oi)=>optRowHTML(i,oi,o)).join('')}
      </div>
      ${(q.options||[]).length<maxOpts?`<button class="add-option-btn" onclick="addOption(${i})">＋ 新增選項</button>`:''}
      ${(q.options||[]).length>maxOpts?`<p style="font-size:11px;color:var(--gold);margin-top:4px">⚠️ 超過建議上限（LINE 最多顯示 ${maxOpts} 個），請減少選項</p>`:''}
    `;
  } else {
    optionsHtml=`<div class="maxlen-row">最大字數：<input class="maxlen-input" type="number" min="1" max="500" value="${q.maxLength||100}" onchange="setMaxLen(${i},this.value)"></div>`;
  }
  return `
<div class="q-card" id="qcard-${i}" ondragover="onQDragOver(event)" ondrop="onQDrop(event,${i})">
  <div class="q-card-header">
    <span class="q-drag" title="拖曳排序" draggable="true" ondragstart="onQDragStart(event,${i})" ondragend="onQDragEnd(event)">☰</span>
    <span class="q-num">Q${i+1}</span>
    <select onchange="setQType(${i},this.value)">${typeOpts}</select>
    <button class="q-remove" onclick="removeQuestion(${i})">✕</button>
  </div>
  <textarea class="q-label-input" placeholder="問題內容（可換行，例如條列注意事項）" oninput="setQLabel(${i},this.value)" maxlength="300">${esc(q.label||'')}</textarea>
  ${optionsHtml}
  <div class="q-required-row">
    <input type="checkbox" id="req-${i}" ${q.required?'checked':''} onchange="setRequired(${i},this.checked)">
    <label for="req-${i}">必填（不允許略過）</label>
  </div>
  <div class="q-required-row">
    <input type="checkbox" id="namefield-${i}" ${q.isNameField?'checked':''} onchange="setNameField(${i},this.checked)">
    <label for="namefield-${i}">設為報名清單顯示名稱（例如：小朋友姓名，僅可勾選一題）</label>
  </div>
</div>`;
}

function optRowHTML(qi,oi,val){
  return `<div class="option-row" id="optrow-${qi}-${oi}">
    <input class="option-input" type="text" value="${esc(val)}" placeholder="選項 ${oi+1}" maxlength="20" oninput="setOption(${qi},${oi},this.value)">
    <button class="option-del" onclick="removeOption(${qi},${oi})">✕</button>
  </div>`;
}

function addQuestion(){
  if(questions.length>=MAX_Q) return;
  questions.push({id:'q_'+Date.now()+'_'+Math.random().toString(36).slice(2,7),type:'single',label:'',required:true,options:['',''],maxLength:100});
  renderQuestions();
}

function removeQuestion(i){
  questions.splice(i,1);
  renderQuestions();
}

function setQType(i,type){
  questions[i].type=type;
  if(!questions[i].options) questions[i].options=['',''];
  if(!questions[i].maxLength) questions[i].maxLength=100;
  renderQuestions();
}

function setQLabel(i,v){ questions[i].label=v; }
function setRequired(i,v){ questions[i].required=v; }
function setNameField(i,v){
  if(v) questions.forEach((q,qi)=>{ q.isNameField = qi===i; });
  else questions[i].isNameField=false;
  renderQuestions();
}
function setMaxLen(i,v){ questions[i].maxLength=Math.min(500,Math.max(1,parseInt(v)||100)); }

function addOption(i){
  const q=questions[i];
  const maxOpts=q.type==='single'?10:11;
  if((q.options||[]).length>=maxOpts) return;
  q.options=q.options||[];
  q.options.push('');
  renderQuestions();
}

function removeOption(qi,oi){
  questions[qi].options.splice(oi,1);
  renderQuestions();
}

function setOption(qi,oi,v){ questions[qi].options[oi]=v; }

let dragQIndex = null;
function onQDragStart(e,i){
  dragQIndex=i;
  document.getElementById('qcard-'+i).classList.add('dragging');
  e.dataTransfer.effectAllowed='move';
}
function onQDragOver(e){ e.preventDefault(); e.dataTransfer.dropEffect='move'; }
function onQDrop(e,targetIndex){
  e.preventDefault();
  if(dragQIndex===null||dragQIndex===targetIndex) return;
  const moved=questions.splice(dragQIndex,1)[0];
  questions.splice(targetIndex,0,moved);
  dragQIndex=null;
  renderQuestions();
}
function onQDragEnd(e){
  if(dragQIndex!==null){
    const card=document.getElementById('qcard-'+dragQIndex);
    if(card) card.classList.remove('dragging');
  }
  dragQIndex=null;
}

// ── 肖像權 Toggle ──
function toggleConsent(e){
  if(e){e.preventDefault();e.stopPropagation();}
  requireConsent=!requireConsent;
  updateConsentToggle();
}
function updateConsentToggle(){
  document.getElementById('consentToggle').className='toggle'+(requireConsent?' on':'');
}

// ── 里民簽到定位限制 ──
function toggleCheckinLocation(e){
  if(e){e.preventDefault();e.stopPropagation();}
  checkinLocationRequired=!checkinLocationRequired;
  updateCheckinLocationToggle();
}
function updateCheckinLocationToggle(){
  document.getElementById('checkinLocationToggle').className='toggle'+(checkinLocationRequired?' on':'');
  document.getElementById('checkinLocationFields').style.display=checkinLocationRequired?'grid':'none';
}
function parseLatLngFromMapUrl(url){
  const raw=String(url||'');
  let m=raw.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
  if(!m) m=raw.match(/[?&](?:q|query|ll)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
  if(!m) m=raw.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if(!m) return null;
  const lat=parseFloat(m[1]), lng=parseFloat(m[2]);
  if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180) return null;
  return {lat,lng};
}
function setCheckinCenter(lat,lng){
  document.getElementById('fCheckinLat').value=Number(lat).toFixed(6);
  document.getElementById('fCheckinLng').value=Number(lng).toFixed(6);
}
function fillCheckinCenterFromMap(){
  const parsed=parseLatLngFromMapUrl(document.getElementById('fMapUrl').value);
  if(!parsed){showToast('這個地圖連結沒有可讀取的座標，請改貼完整 Google Maps 連結或手動填座標');return;}
  setCheckinCenter(parsed.lat, parsed.lng);
  showToast('已帶入簽到中心座標');
}
function fillCheckinCenterFromCurrentLocation(){
  if(!navigator.geolocation){showToast('此裝置不支援定位');return;}
  navigator.geolocation.getCurrentPosition(function(pos){
    setCheckinCenter(pos.coords.latitude, pos.coords.longitude);
    showToast('已使用目前位置');
  }, function(){
    showToast('無法取得目前位置，請確認瀏覽器定位權限');
  }, {enableHighAccuracy:true, timeout:10000, maximumAge:0});
}

// ── 圖片上傳 ──
function handleImgChange(e){
  const file=e.target.files[0];
  if(!file) return;
  compressAndUpload(file);
}

function toDriveImgUrl(url){
  if(!url) return url;
  var m=url.match(/[?&]id=([^&]+)/);
  if(m&&url.includes('drive.google.com')) return 'https://drive.google.com/thumbnail?id='+m[1]+'&sz=w1000';
  return url;
}
function previewFromUrl(url){
  uploadedImageUrl=url;
  const img=document.getElementById('imgPreview');
  if(url){ img.src=toDriveImgUrl(url); img.style.display='block'; }
  else { img.style.display='none'; }
}

function compressAndUpload(file){
  const maxSize=1*1024*1024;
  const reader=new FileReader();
  reader.onload=function(ev){
    const img=new Image();
    img.onload=function(){
      const canvas=document.createElement('canvas');
      let w=img.width, h=img.height;
      const maxW=1024, maxH=768;
      if(w>maxW||h>maxH){
        const ratio=Math.min(maxW/w,maxH/h);
        w=Math.round(w*ratio); h=Math.round(h*ratio);
      }
      canvas.width=w; canvas.height=h;
      canvas.getContext('2d').drawImage(img,0,0,w,h);
      const mimeType=file.type==='image/png'?'image/png':'image/jpeg';
      const b64=canvas.toDataURL(mimeType,.85).split(',')[1];
      if(b64.length*0.75>maxSize*1.5){showToast('圖片壓縮後仍過大，請使用較小的圖片');return;}
      doUpload(b64,mimeType);
    };
    img.src=ev.target.result;
  };
  reader.readAsDataURL(file);
  document.getElementById('imgPreview').src=URL.createObjectURL(file);
  document.getElementById('imgPreview').style.display='block';
}

function doUpload(b64,mimeType){
  document.getElementById('uploadProgress').style.display='block';
  postBackend('uploadEventImage',{sessionToken:SESSION.sessionToken,imageBase64:b64,mimeType})
    .then(r=>r.json()).then(d=>{
      document.getElementById('uploadProgress').style.display='none';
      if(!d.success){showToast('上傳失敗：'+d.error);return;}
      uploadedImageUrl=d.url;
      document.getElementById('fImageUrl').value=d.url;
      document.getElementById('imgUrlDisplay').textContent='✅ 已上傳：'+d.url;
      showToast('圖片上傳成功');
    }).catch(()=>{document.getElementById('uploadProgress').style.display='none';showToast('上傳失敗，請稍後再試');});
}

// ── 儲存 ──
function collectData(status){
  const name=(document.getElementById('fName').value||'').trim();
  if(!name){showToast('請輸入活動名稱');return null;}
  const regStart=getDtVal('fRegStart');
  const regEnd=getDtVal('fRegEnd');
  const eventStart=getDtVal('fEventStart');
  const eventEnd=getDtVal('fEventEnd');
  const mapUrl=document.getElementById('fMapUrl').value.trim();
  if(regStart&&regEnd&&new Date(regStart)>new Date(regEnd)){showToast('報名結束時間不可早於開始時間');return null;}
  if(eventStart&&eventEnd&&new Date(eventStart)>new Date(eventEnd)){showToast('活動結束時間不可早於開始時間');return null;}
  if(mapUrl&&!/^https?:\/\//i.test(mapUrl)){showToast('Google Map 連結需以 http:// 或 https:// 開頭');return null;}
  // 驗證問題
  const usedLabels={};
  for(let i=0;i<questions.length;i++){
    const q=questions[i];
    if(!(q.label||'').trim()){showToast('第 '+(i+1)+' 題未填入問題內容');return null;}
    const labelKey=(q.label||'').trim();
    if(usedLabels[labelKey]){showToast('第 '+(i+1)+' 題與前面題目名稱重複，請調整題目文字');return null;}
    usedLabels[labelKey]=true;
    if((q.type==='single'||q.type==='multi')&&!(q.options||[]).filter(o=>o.trim()).length){showToast('第 '+(i+1)+' 題需要至少一個選項');return null;}
  }
  const cleanedQ=questions.map((q,i)=>Object.assign({},q,{id:q.id||('idx_'+i),options:(q.options||[]).filter(o=>o.trim())}));
  const imageUrl=document.getElementById('fImageUrl').value.trim()||uploadedImageUrl;
  const surveyDelayRaw=document.getElementById('fSurveyDelay').value;
  const surveyDelay=surveyDelayRaw===''?60:parseInt(surveyDelayRaw,10);
  const checkinLat=document.getElementById('fCheckinLat').value.trim();
  const checkinLng=document.getElementById('fCheckinLng').value.trim();
  const latNum=parseFloat(checkinLat), lngNum=parseFloat(checkinLng);
  if(checkinLocationRequired){
    const hasCoords=Number.isFinite(latNum)&&Number.isFinite(lngNum)&&Math.abs(latNum)<=90&&Math.abs(lngNum)<=180;
    if(!hasCoords && !mapUrl){
      showToast('開啟簽到地點限制時，請填寫 Google Map 連結或中心點座標');
      return null;
    }
  }
  return {
    eventName:name,
    eventDate:formatDateRangeText(eventStart,eventEnd)||legacyEventDate,
    registrationStart:regStart,
    registrationEnd:regEnd,
    eventStart:eventStart,
    eventEnd:eventEnd,
    eventLocation:document.getElementById('fLocation').value.trim(),
    mapUrl:mapUrl,
    description:document.getElementById('fDesc').value.trim(),
    quota:document.getElementById('fQuota').value.trim(),
    status:status||document.getElementById('fStatus').value,
    requireConsent:requireConsent,
    checkinLocationRequired:checkinLocationRequired,
    checkinLatitude:checkinLocationRequired&&Number.isFinite(latNum)?latNum:'',
    checkinLongitude:checkinLocationRequired&&Number.isFinite(lngNum)?lngNum:'',
    checkinRadiusMeters:100,
    imageUrl:imageUrl,
    questions:cleanedQ,
    surveyId:document.getElementById('fSurveyId').value||'',
    surveyTarget:(document.querySelector('input[name="surveyTarget"]:checked')||{}).value||'全部報名',
    surveyDelay:Number.isFinite(surveyDelay)&&surveyDelay>=0?surveyDelay:60,
    reminderTime:document.getElementById('rReminderCustom').checked
      ? (getDtVal('fReminderTime')||'')
      : 'none'
  };
}

function saveDraft(){
  const d=collectData('草稿'); if(!d) return;
  save(d,'草稿');
}

function saveAndPublish(){
  const d=collectData('報名中'); if(!d) return;
  save(d,'報名中');
}

function save(payload,statusLabel){
  setSaving(true);
  const wasEdit = !!editId;
  const action=editId?'updateEvent':'createEvent';
  const body=Object.assign({},payload,{action,sessionToken:SESSION.sessionToken,createdBy:SESSION.email});
  if(editId) body.eventId=editId;
  postBackend(action, body)
    .then(r=>r.json()).then(d=>{
      setSaving(false);
      if(!d.success){showToast('儲存失敗：'+d.error);return;}
      if(!editId) editId=d.eventId;
      updateEventListCache(d.event || Object.assign({}, payload, wasEdit ? {eventId:editId} : {eventId:editId, registeredCount:0}));
      showToast('✅ 已儲存（'+(statusLabel||payload.status)+'）');
      setTimeout(()=>location.href='./eventlist.html',450);
    }).catch(()=>{setSaving(false);showToast('網路錯誤，請稍後再試');});
}

function updateEventListCache(eventData){
  try{
    const key=new URL(CONFIG.BASE_URL).hostname.split('.')[0]+'_eventlist_cache_v2';
    const raw=sessionStorage.getItem(key);
    const cache=raw?JSON.parse(raw):{events:[]};
    if(!cache || !Array.isArray(cache.events)) return;
    const idx=cache.events.findIndex(e=>e.eventId===eventData.eventId);
    if(idx>=0) cache.events[idx]=Object.assign({}, cache.events[idx], eventData);
    else cache.events.unshift(eventData);
    cache.savedAt=Date.now();
    sessionStorage.setItem(key, JSON.stringify(cache));
  }catch(e){}
}

function setSaving(v){
  document.getElementById('saveDraftBtn').disabled=v;
  document.getElementById('savePublishBtn').disabled=v;
  document.getElementById('saveDraftBtn').textContent=v?'儲存中…':'💾 儲存草稿';
}

// ── 工具 ──
function showToast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),3000);
}
function toDatetimeLocal(value){
  if(!value) return '';
  const s=String(value);
  const pad=n=>String(n).padStart(2,'0');
  // UTC ISO string (GAS/Sheets 回傳帶 Z) → 轉台灣時間 +8h
  if(/Z$/.test(s)||/[+-]\d{2}:\d{2}$/.test(s)){
    const d=new Date(s);
    if(Number.isNaN(d.getTime())) return '';
    const tw=new Date(d.getTime()+8*60*60*1000);
    return tw.getUTCFullYear()+'-'+pad(tw.getUTCMonth()+1)+'-'+pad(tw.getUTCDate())+'T'+pad(tw.getUTCHours())+':'+pad(tw.getUTCMinutes());
  }
  // 無時區標記（datetime-local 的 value，已是本地時間）→ 直接用
  if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return s.slice(0,16);
  const d=new Date(value);
  if(Number.isNaN(d.getTime())) return '';
  return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes());
}
function formatDateTimeText(value){
  if(!value) return '';
  if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(value))){
    const s=String(value);
    return s.slice(0,10).replace(/-/g,'/')+' '+s.slice(11,16);
  }
  const d=new Date(value);
  if(Number.isNaN(d.getTime())) return value;
  const pad=n=>String(n).padStart(2,'0');
  return d.getFullYear()+'/'+pad(d.getMonth()+1)+'/'+pad(d.getDate())+' '+pad(d.getHours())+':'+pad(d.getMinutes());
}
function formatDateRangeText(start,end){
  const s=formatDateTimeText(start), e=formatDateTimeText(end);
  if(s&&e) return s+' - '+e;
  return s||e||'';
}
