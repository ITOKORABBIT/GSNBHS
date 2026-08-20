
// 記錄頁面開啟時間，用於防機器人驗證
window._storeFormTs = Date.now();

// 從 LINE 選單進來時網址會帶 lineUserId／displayName，存進隱藏欄位一併送出，
// 讓里長在後台看得出是誰申請的。直接開網址（沒有這些參數）時留空即可。
(function captureLineIdentity() {
  var q = new URLSearchParams(location.search);
  var uid = q.get('lineUserId') || '';
  var dname = q.get('displayName') || '';
  if (uid) document.getElementById('f_line_user_id').value = uid;
  if (dname) document.getElementById('f_line_display_name').value = dname;
})();

// ── 方案選擇邏輯 ──
var PLAN_FEATURES = {
  '精選': ['刊登於美食地圖頁面', '顯示 ⭐ 精選商家 藍色標章', '提升里民搜尋能見度'],
  '優選': ['置頂顯示，出現在商店列表最上方', '顯示 👑 優選推薦 金色標章', '搶先觸及每一位瀏覽的里民'],
};

function getSelectedPlan() {
  var radios = document.querySelectorAll('input[name="plan"]');
  for (var i = 0; i < radios.length; i++) {
    if (radios[i].checked) return radios[i].value;
  }
  return '免費';
}

function onPlanChange() {
  var plan = getSelectedPlan();
  var note = document.getElementById('planTrialNote');
  note.style.display = (plan !== '免費') ? 'flex' : 'none';
}

function openPlanOverlay() {
  var plan = getSelectedPlan();
  var emoji = plan === '優選' ? '👑' : '⭐';
  var cls   = plan === '優選' ? 'premium' : 'std';
  document.getElementById('pocEmoji').textContent = emoji;
  document.getElementById('pocTitle').textContent = '確認' + plan + '方案';
  var label = document.getElementById('pocPlanLabel');
  label.textContent = emoji + '  ' + plan + '方案';
  label.className = 'poc-plan-label ' + cls;
  var feats = PLAN_FEATURES[plan] || [];
  document.getElementById('pocFeatures').innerHTML = feats.map(function(f) {
    return '<div class="poc-feature"><span style="font-size:14px">✅</span>' + f + '</div>';
  }).join('');
  document.getElementById('planOverlay').classList.add('open');
}

function closePlanOverlay() {
  document.getElementById('planOverlay').classList.remove('open');
}

function setSubmitProgress(stepText, percent, noteText) {
  document.getElementById('submitProgressStep').textContent = stepText || '正在處理…';
  document.getElementById('submitProgressFill').style.width = Math.max(0, Math.min(100, percent || 0)) + '%';
  if (noteText) document.getElementById('submitProgressNote').textContent = noteText;
}

function openSubmitProgress(stepText, percent, noteText) {
  setSubmitProgress(stepText, percent, noteText);
  document.body.classList.add('loading-submit');
  document.getElementById('submitProgressOverlay').classList.add('open');
  document.getElementById('submitProgressOverlay').setAttribute('aria-hidden', 'false');
}

function closeSubmitProgress() {
  document.body.classList.remove('loading-submit');
  document.getElementById('submitProgressOverlay').classList.remove('open');
  document.getElementById('submitProgressOverlay').setAttribute('aria-hidden', 'true');
}

function resetSubmitActions() {
  var btn = document.getElementById('submitBtn');
  var confirmBtn = document.getElementById('pocConfirmBtn');
  btn.disabled = false;
  btn.innerHTML = '<svg class="icon"><use href="#i-send"/></svg> 送出申請';
  confirmBtn.disabled = false;
  confirmBtn.textContent = '確認方案，送出申請';
}

// ── 品牌標籤 picker ──
var availableBrandTags = [];
var selectedBrandTags = [];
var brandTagDefs = [];
var BRAND_TAG_PALETTE = {
  gold:{ bg:'#FFF3E0', txt:'#B75D00', bd:'#F5D7A2' }, mint:{ bg:'#EAF3EB', txt:'#2F6836', bd:'#CFE2D3' },
  blue:{ bg:'#EFF6FF', txt:'#2563EB', bd:'#BFDBFE' }, rose:{ bg:'#FFF1F4', txt:'#B4235A', bd:'#F7C1CF' },
  violet:{ bg:'#F5F0FF', txt:'#6B28A8', bd:'#DCCBFF' }, stone:{ bg:'#F0EEEC', txt:'#7A6E66', bd:'#D8D0C8' }
};
var storeCategoryFallback = ['美食地圖','飲料冰品','健康醫療','生活便利','住宅相關','寵物專區','其他'];

function brandTagValue(value) {
  return String(value || '').trim();
}

function brandTagJs(value) {
  return brandTagValue(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
function brandTagStyle(tag) {
  var def = brandTagDefs.find(function(item){ return item.name === tag; }) || { color:'gold' };
  var color = BRAND_TAG_PALETTE[def.color] || BRAND_TAG_PALETTE.gold;
  return ' style=\"background:' + color.bg + ';color:' + color.txt + ';border-color:' + color.bd + '\"';
}

function renderBrandTagPicker() {
  var selected = document.getElementById('brandTagSelected');
  var options = document.getElementById('brandTagOptions');
  if (!selected || !options) return;
  selected.innerHTML = selectedBrandTags.length
    ? selectedBrandTags.map(function(tag) {
        return '<span class="brand-tag-chip"' + brandTagStyle(tag) + '>' + esc(tag) +
          '<button type="button" aria-label="移除 ' + esc(tag) + '" onclick="removeBrandTag(\'' + brandTagJs(tag) + '\')">×</button></span>';
      }).join('')
    : '<span class="brand-tag-empty">尚未選擇標籤</span>';
  options.innerHTML = availableBrandTags.length
    ? availableBrandTags.map(function(tag) {
        var active = selectedBrandTags.indexOf(tag) !== -1;
        return '<button type="button" class="brand-tag-option' + (active ? ' selected' : '') +
          '"' + brandTagStyle(tag) + ' onclick="toggleBrandTag(\'' + brandTagJs(tag) + '\')">' + esc(tag) + '</button>';
      }).join('')
    : '<span class="brand-tag-empty">公開店家累積標籤後會顯示在這裡</span>';
}

function addBrandTag(tag) {
  tag = brandTagValue(tag);
  if (!tag) return true;
  if (tag.length > 6) { alert('每個標籤最多 6 個字'); return false; }
  if (/^\d+$/.test(tag)) { alert('品牌標籤不能只有數字'); return false; }
  if (selectedBrandTags.indexOf(tag) !== -1) return true;
  if (selectedBrandTags.length >= 3) { alert('一家店最多 3 個品牌標籤'); return false; }
  selectedBrandTags.push(tag);
  renderBrandTagPicker();
  return true;
}

function addBrandTagInput() {
  var input = document.getElementById('f_brandtag_new');
  if (!input || !addBrandTag(input.value)) return;
  input.value = '';
}

function removeBrandTag(tag) {
  selectedBrandTags = selectedBrandTags.filter(function(item) { return item !== tag; });
  renderBrandTagPicker();
}

function toggleBrandTag(tag) {
  if (selectedBrandTags.indexOf(tag) !== -1) removeBrandTag(tag);
  else addBrandTag(tag);
}

function renderStoreCategoryOptions(categories) {
  var select = document.getElementById('f_cate');
  if (!select) return;
  var current = select.value;
  var values = Array.isArray(categories) && categories.length ? categories : storeCategoryFallback;
  select.innerHTML = '<option value="">請選擇類別</option>' + values.map(function(category) {
    return '<option value="' + esc(category) + '"' + (current === category ? ' selected' : '') + '>' + esc(category) + '</option>';
  }).join('');
}

function loadStoreTaxonomy() {
  renderStoreCategoryOptions(storeCategoryFallback);
  if (!CONFIG.STORE_API_URL) return renderBrandTagPicker();
  fetch(CONFIG.STORE_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'getPublicStoreTaxonomy' })
  })
    .then(function(res) { return res.json(); })
    .then(function(json) {
      var taxonomy = json.success && json.taxonomy ? json.taxonomy : {};
      renderStoreCategoryOptions(taxonomy.categories);
      availableBrandTags = Array.isArray(taxonomy.brandTags) ? taxonomy.brandTags : [];
      brandTagDefs = Array.isArray(taxonomy.brandTagDefs) ? taxonomy.brandTagDefs : [];
      renderBrandTagPicker();
    })
    .catch(function() { renderBrandTagPicker(); });
}

// ── 多選照片 widget ──
var storePhotos = [];
var storePhotoIdSeq = 0;
var storePhotoSortable = null;

function renderStorePhotoGrid() {
  var grid   = document.getElementById('storePhotoGrid');
  var addBtn = document.getElementById('storePhotoAddBtn');
  if (!grid) return;
  grid.innerHTML = '';
  storePhotos.forEach(function(p) {
    var div = document.createElement('div');
    div.className = 'photo-preview-item';
    div.setAttribute('data-sort-id', String(p.id));
    var img = document.createElement('img'); img.src = p.src; img.alt = '照片';
    var rmBtn = document.createElement('button');
    rmBtn.type = 'button'; rmBtn.className = 'item-remove'; rmBtn.textContent = '✕';
    rmBtn.setAttribute('data-pid', String(p.id));
    rmBtn.addEventListener('click', function(e) {
      e.preventDefault(); e.stopPropagation();
      var pid = parseInt(this.getAttribute('data-pid'));
      syncStorePhotosFromDOM();
      storePhotos = storePhotos.filter(function(x) { return x.id !== pid; });
      renderStorePhotoGrid();
    });
    div.appendChild(img); div.appendChild(rmBtn);
    if (storePhotos.length > 1) {
      var hint = document.createElement('span');
      hint.className = 'drag-hint'; hint.textContent = '拖曳排序';
      div.appendChild(hint);
    }
    grid.appendChild(div);
  });
  if (addBtn) addBtn.classList.toggle('hidden', storePhotos.length >= 1);
  if (storePhotoSortable) { storePhotoSortable.destroy(); storePhotoSortable = null; }
  if (storePhotos.length > 1) {
    storePhotoSortable = new SortableOrder(grid, {
      selector: '.photo-preview-item',
      onReorder: function(ids) {
        var idMap = {};
        storePhotos.forEach(function(p) { idMap[p.id] = p; });
        storePhotos = ids.map(function(id) { return idMap[parseInt(id)]; }).filter(Boolean);
      }
    });
  }
}

function syncStorePhotosFromDOM() {
  var grid = document.getElementById('storePhotoGrid');
  if (!grid) return;
  var idMap = {};
  storePhotos.forEach(function(p) { idMap[p.id] = p; });
  var ordered = Array.prototype.map.call(grid.querySelectorAll('[data-sort-id]'), function(el) {
    return idMap[parseInt(el.getAttribute('data-sort-id'))];
  }).filter(Boolean);
  if (ordered.length === storePhotos.length) storePhotos = ordered;
}

function handleStorePhotoAdd(input) {
  if (!input.files || !input.files.length) return;
  var slots = 1 - storePhotos.length; // 只收一張商家 LOGO
  if (slots <= 0) return;
  var files = Array.prototype.slice.call(input.files, 0, slots);
  var pending = files.length;
  files.forEach(function(file) {
    var id = storePhotoIdSeq++;
    var reader = new FileReader();
    reader.onload = function(e) {
      storePhotos.push({ id: id, src: e.target.result, file: file });
      pending--;
      if (pending === 0) renderStorePhotoGrid();
    };
    reader.readAsDataURL(file);
  });
  input.value = '';
}

// 壓縮圖片（縮小到 1600px 以內，JPEG 80% 品質）
function compressImage(file) {
  return new Promise(function(resolve) {
    var reader = new FileReader();
    reader.onload = function(e) {
      var img = new Image();
      img.onload = function() {
        var canvas = document.createElement('canvas');
        var maxSize = 1600;
        var w = img.width, h = img.height;
        if (w > maxSize || h > maxSize) {
          if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
          else { w = Math.round(w * maxSize / h); h = maxSize; }
        }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function uploadPhoto(file) {
  if (!file) return '';
  try {
    var dataUrl = await compressImage(file);
    var b64 = dataUrl.indexOf(',') !== -1 ? dataUrl.split(',')[1] : dataUrl;
    var uploadedMimeType = (dataUrl.match(/^data:([^;,]+)/) || [])[1] || 'image/jpeg';
    var res = await fetch(CONFIG.STORE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'uploadStorePhoto',
        imageBase64: b64,
        mimeType: uploadedMimeType,
        website: document.getElementById('f_website').value,
        formTs: window._storeFormTs || 0
      })
    });
    var json = await res.json();
    return (json.success && json.url) ? json.url : '';
  } catch (e) {
    console.warn('[Upload] 照片上傳失敗:', e);
    return '';
  }
}

async function uploadAllPhotos(btn) {
  syncStorePhotosFromDOM();
  if (!storePhotos.length) return Array(10).fill('');
  var results = [];
  for (var i = 0; i < storePhotos.length; i++) {
    btn.innerHTML = '<span class="spinner"></span> 上傳照片 ' + (i + 1) + '/' + storePhotos.length + '…';
    setSubmitProgress('正在上傳照片 ' + (i + 1) + '/' + storePhotos.length + '…', Math.round(((i + 1) / (storePhotos.length + 1)) * 75), '大圖會需要多幾秒，這是正常的');
    results.push(await uploadPhoto(storePhotos[i].file));
  }
  while (results.length < 10) results.push('');
  return results;
}

// 表單驗證
function validateForm() {
  var valid = true;

  // 申請人姓名、聯絡電話必填——里長要靠這兩項聯繫申請人。
  var nameEl = document.getElementById('f_name');
  var nameErr = nameEl.parentElement.querySelector('.error-text');
  if (!nameEl.value.trim()) {
    nameEl.classList.add('invalid');
    if (nameErr) nameErr.style.display = 'block';
    valid = false;
  } else {
    nameEl.classList.remove('invalid');
    if (nameErr) nameErr.style.display = 'none';
  }

  var phoneEl = document.getElementById('f_phone');
  var phoneErr = phoneEl.parentElement.querySelector('.error-text');
  if (phoneEl.value.replace(/[^\d]/g, '').length < 8) {
    phoneEl.classList.add('invalid');
    if (phoneErr) phoneErr.style.display = 'block';
    valid = false;
  } else {
    phoneEl.classList.remove('invalid');
    if (phoneErr) phoneErr.style.display = 'none';
  }

  var titleEl = document.getElementById('f_title');
  var titleErr = titleEl.parentElement.querySelector('.error-text');
  if (!titleEl.value.trim()) {
    titleEl.classList.add('invalid');
    if (titleErr) titleErr.style.display = 'block';
    valid = false;
  } else {
    titleEl.classList.remove('invalid');
    if (titleErr) titleErr.style.display = 'none';
  }

  // 店家電話可留空；有填時才檢查格式。
  var storePhoneEl = document.getElementById('f_store_phone');
  var storePhoneErr = storePhoneEl.parentElement.querySelector('.error-text');
  if (storePhoneEl.value.trim() && storePhoneEl.value.replace(/[^\d]/g, '').length < 8) {
    storePhoneEl.classList.add('invalid');
    if (storePhoneErr) { storePhoneErr.style.display = 'block'; }
    valid = false;
  } else {
    storePhoneEl.classList.remove('invalid');
    if (storePhoneErr) storePhoneErr.style.display = 'none';
  }

  return valid;
}

// 清除驗證狀態
document.querySelectorAll('input, textarea, select').forEach(function(el) {
  el.addEventListener('input', function() {
    this.classList.remove('invalid');
    var err = this.parentElement.querySelector('.error-text');
    if (err) err.style.display = 'none';
  });
});

// 實際送出（不論有無 overlay）
async function doSubmit() {
  var btn = document.getElementById('submitBtn');
  var confirmBtn = document.getElementById('pocConfirmBtn');
  btn.disabled = true;
  confirmBtn.disabled = true;
  confirmBtn.textContent = '處理中，請稍候…';
  btn.innerHTML = '<span class="spinner"></span> 準備上傳…';
  openSubmitProgress('正在整理申請資料…', 10, '若有照片，系統會先壓縮再上傳');

  try {
    var photoUrls = await uploadAllPhotos(btn);
    btn.innerHTML = '<span class="spinner"></span> 送出申請中…';
    setSubmitProgress('正在送出申請資料…', 88, '資料送出後會自動進入完成畫面');

    var payload = {
      action:      'submitStore',
      website:     document.getElementById('f_website').value,
      formTs:      window._storeFormTs || 0,
      name:        document.getElementById('f_name').value.trim(),
      phone:       document.getElementById('f_phone').value.trim(),
      lineId:      document.getElementById('f_line_user_id').value,
      lineDisplayName: document.getElementById('f_line_display_name').value,
      cate:        document.getElementById('f_cate').value,
      title:       document.getElementById('f_title').value.trim(),
      storephone:  document.getElementById('f_store_phone').value.trim(),
      taxid:       document.getElementById('f_num').value.trim(),
      desc:        document.getElementById('f_desc').value.trim(),
      offer:       document.getElementById('f_offer').value.trim(),
      opentime:    document.getElementById('f_clock').value.trim(),
      addr:        document.getElementById('f_addr').value.trim(),
      map:         document.getElementById('f_map').value.trim(),
      brandTags:   selectedBrandTags.slice(0, 3),
      brandUrl:    document.getElementById('f_brandurl').value.trim(),
      photo1:  photoUrls[0], photo2:  photoUrls[1], photo3:  photoUrls[2],
      photo4:  photoUrls[3], photo5:  photoUrls[4], photo6:  photoUrls[5],
      photo7:  photoUrls[6], photo8:  photoUrls[7], photo9:  photoUrls[8],
      photo10: photoUrls[9],
      planType:    getSelectedPlan(),
    };

    var submitEndpoint = CONFIG.STORE_API_URL || CONFIG.SCRIPT_URL;
    var res = await fetch(submitEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error('HTTP ' + res.status);
    var result = await res.json();
    if (!result.success) throw new Error(result.error || '送出失敗');

    setSubmitProgress('申請已送出，正在完成畫面…', 100, '完成後會自動顯示成功訊息');
    closePlanOverlay();
    closeSubmitProgress();
    document.getElementById('reportForm').style.display = 'none';
    document.getElementById('successMsg').style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'smooth' });

  } catch (err) {
    closePlanOverlay();
    closeSubmitProgress();
    alert('送出失敗，請稍後再試。\n錯誤：' + err.message);
    resetSubmitActions();
  }
}

// overlay 確認按鈕觸發真正送出
document.getElementById('pocConfirmBtn').addEventListener('click', doSubmit);
document.getElementById('f_brandtag_new').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') { e.preventDefault(); addBrandTagInput(); }
});
loadStoreTaxonomy();

// 送出表單：免費直送、精選/優選先開 overlay
document.getElementById('reportForm').addEventListener('submit', async function(e) {
  e.preventDefault();

  if (!validateForm()) {
    document.querySelector('.invalid').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  var plan = getSelectedPlan();
  if (plan === '精選' || plan === '優選') {
    openPlanOverlay();
  } else {
    await doSubmit();
  }
});
