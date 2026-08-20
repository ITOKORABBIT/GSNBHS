
    var params = new URLSearchParams(location.search);
    var surveyId = params.get('surveyId') || '';
    var surveyFileName = params.get('surveyFileName') || getSurveyFileNameFromPath();
    var eventId = params.get('eventId') || '';
    var lineUserId = params.get('lineUserId') || '';
    var isPreview = params.get('preview') === '1' || !eventId;
    var scriptUrl = CONFIG.SCRIPT_URL;
    var eventApiUrl = CONFIG.EVENT_API_URL || '';
    var statusBox = document.getElementById('statusBox');
    var surveyForm = document.getElementById('surveyForm');
    var questionList = document.getElementById('questionList');
    var pageTitle = document.getElementById('pageTitle');
    var pageSubtitle = document.getElementById('pageSubtitle');

    function getSurveyFileNameFromPath() {
      var path = location.pathname || '';
      var parts = path.split('/').filter(Boolean);
      if (!parts.length) return '';
      var fileName = parts[parts.length - 1];
      if (/^survey[0-9A-Za-z_-]*\.html$/.test(fileName) && fileName.toLowerCase() !== 'survey.html') {
        return fileName;
      }
      return '';
    }

    function showStatus(message, isError) {
      statusBox.textContent = message;
      statusBox.className = 'status' + (isError ? ' error' : '');
      statusBox.style.display = 'block';
    }

    function clearStatus() {
      statusBox.style.display = 'none';
      statusBox.textContent = '';
    }

    function fetchSurvey() {
      showStatus('問券載入中，請稍候...', false);
      if (!surveyId && !surveyFileName) {
        showStatus('連結參數遺失，請重新點選 LINE 中的「開始填寫」按鈕。', true);
        return;
      }
      var body = { action: 'getSurveyPublic' };
      if (lineUserId) body.lineUserId = lineUserId;
      if (eventId) body.eventId = eventId;
      if (surveyFileName) {
        body.surveyFileName = surveyFileName;
      } else {
        body.surveyId = surveyId;
      }
      fetch(getBackendUrl('getSurveyPublic'), {
        method: 'POST',
        body: JSON.stringify(body)
      }).then(function(res) { return res.json(); })
      .then(function(json) {
        if (!json.success) {
          showStatus(json.error || '讀取問券失敗，請稍後再試。', true);
          return;
        }
        if (json.survey && json.survey.surveyId) {
          surveyId = json.survey.surveyId;
        }
        clearStatus();
        renderSurvey(json.survey, json.displayName || '', json.eventName || '');
      }).catch(function() {
        showStatus('無法連線到問卷服務，請稍後再試。', true);
      });
    }

    function renderSurvey(survey, displayName, eventName) {
      pageTitle.textContent = survey.introTitle || survey.surveyName || '活動問券填寫';
      var introDescription = personalizeIntro(survey.introDescription || '感謝您參加活動，請協助填寫問卷。', displayName, eventName);
      var introHtml = '<div class="field"><div style="color:#475569;line-height:1.8;white-space:pre-wrap;">'
        + escapeHtml(introDescription) + '</div></div>';
      document.getElementById('surveyIntro').innerHTML = introHtml;
      questionList.innerHTML = survey.questions.map(function(q, idx) {
        return renderQuestion(q, idx);
      }).join('');
      surveyForm.style.display = 'block';
      var submitBtn = document.getElementById('submitBtn');
      if (isPreview && !eventId) {
        submitBtn.disabled = true;
      } else {
        submitBtn.disabled = false;
      }
      surveyForm.addEventListener('submit', function(evt) {
        evt.preventDefault();
        submitSurvey(survey);
      });
    }

    function personalizeIntro(text, displayName, eventName) {
      var result = String(text || '');
      var namePart = displayName ? displayName + '，' : '';
      if (eventName) {
        result = result.replace(
          /^您好[，,]\s*感謝您參加這次的活動/,
          '您好，' + namePart + '感謝您參加這次的「' + eventName + '」活動'
        );
        result = result.replace(
          /^您好[，,]\s*感謝您參加活動/,
          '您好，' + namePart + '感謝您參加「' + eventName + '」活動'
        );
      }
      if (displayName && result === String(text || '')) {
        result = result.replace(/^您好[，,]/, '您好，' + displayName + '，');
      }
      return result;
    }

    function renderQuestion(q, idx) {
      var required = q.required ? '<span class="required">*</span>' : '';
      var html = '<div class="question">';
      html += '<div class="question-title">' + escapeHtml(q.label || ('問題 ' + (idx + 1))) + required + '</div>';
      if (q.type === 'text') {
        html += '<div class="field"><textarea id="q_' + idx + '" maxlength="' + (q.maxLength || 200) + '" placeholder="請輸入答案..."></textarea></div>';
      } else if (q.type === 'single' || q.type === 'scale') {
        var options = q.options || [];
        html += '<div class="option-list">';
        options.forEach(function(opt, optIdx) {
          html += '<label class="option">\n' +
            '<input type="radio" name="q_' + idx + '" value="' + escapeHtml(opt) + '" ' + (optIdx === 0 ? 'checked' : '') + '>\n' +
            '<span>' + escapeHtml(opt) + '</span>\n' +
          '</label>';
        });
        if (q.allowOther) {
          html += '<label class="option other">\n' +
            '<input type="radio" name="q_' + idx + '" value="__OTHER__" class="other-choice" data-other-input="q_' + idx + '_other">\n' +
            '<span>其他：</span>\n' +
            '<input type="text" id="q_' + idx + '_other" aria-label="其他答案" data-other-choice="q_' + idx + '">\n' +
          '</label>';
        }
        html += '</div>';
      } else if (q.type === 'multi') {
        html += '<div class="checkbox-row">';
        (q.options || []).forEach(function(opt, optIdx) {
          html += '<label class="option">\n' +
            '<input type="checkbox" name="q_' + idx + '" value="' + escapeHtml(opt) + '">\n' +
            '<span>' + escapeHtml(opt) + '</span>\n' +
          '</label>';
        });
        if (q.allowOther) {
          html += '<label class="option other">\n' +
            '<input type="checkbox" name="q_' + idx + '" value="__OTHER__" class="other-choice" data-other-input="q_' + idx + '_other">\n' +
            '<span>其他：</span>\n' +
            '<input type="text" id="q_' + idx + '_other" aria-label="其他答案" data-other-choice="q_' + idx + '">\n' +
          '</label>';
        }
        html += '</div>';
      } else {
        html += '<div class="field"><textarea id="q_' + idx + '" maxlength="' + (q.maxLength || 200) + '" placeholder="請輸入答案..."></textarea></div>';
      }
      html += '</div>';
      return html;
    }

    function submitSurvey(survey) {
      if (!eventId) {
        showStatus('此頁面為預覽模式，無法送出問券。', true);
        return;
      }
      clearStatus();
      var answers = [];
      for (var idx = 0; idx < survey.questions.length; idx++) {
        var q = survey.questions[idx];
        var value = '';
        if (q.type === 'text') {
          value = document.getElementById('q_' + idx).value.trim();
        } else if (q.type === 'single' || q.type === 'scale') {
          var radios = document.querySelectorAll('input[name="q_' + idx + '"]');
          for (var r = 0; r < radios.length; r++) {
            if (radios[r].checked) {
              if (radios[r].value === '__OTHER__') {
                var other = document.getElementById('q_' + idx + '_other');
                value = other ? other.value.trim() : '';
              } else {
                value = radios[r].value;
              }
              break;
            }
          }
        } else if (q.type === 'multi') {
          var checks = document.querySelectorAll('input[name="q_' + idx + '"]');
          var result = [];
          for (var c = 0; c < checks.length; c++) {
            if (!checks[c].checked) continue;
            if (checks[c].value === '__OTHER__') {
              var other = document.getElementById('q_' + idx + '_other');
              if (other && other.value.trim()) result.push(other.value.trim());
            } else {
              result.push(checks[c].value);
            }
          }
          value = result;
        } else {
          value = document.getElementById('q_' + idx).value.trim();
        }
        if (q.required) {
          if (q.type === 'multi') {
            if (!Array.isArray(value) || value.length === 0) {
              showStatus('第 ' + (idx + 1) + ' 題為必填，請選擇至少一個選項。', true);
              return;
            }
          } else {
            if (!value) {
              showStatus('第 ' + (idx + 1) + ' 題為必填，請填寫。', true);
              return;
            }
          }
        }
        answers.push({ label: q.label || ('問題 ' + (idx + 1)), type: q.type, value: value });
      }
      var payload = {
        action: 'submitSurveyResponse',
        eventId: eventId,
        surveyId: surveyId,
        lineUserId: lineUserId,
        displayName: '',
        answers: answers
      };
      document.getElementById('submitBtn').disabled = true;
      fetch(getBackendUrl('submitSurveyResponse'), {
        method: 'POST',
        body: JSON.stringify(payload)
      })
        .then(function(res) { return res.json(); })
        .then(function(json) {
          if (!json.success) {
            showStatus(json.error || '送出失敗，請稍後再試。', true);
            document.getElementById('submitBtn').disabled = false;
            return;
          }
          surveyForm.style.display = 'none';
          pageSubtitle.textContent = '感謝您的回饋，我們已收到問卷答案。';
          showStatus('問券已完成送出，感謝您的協助！', false);
        }).catch(function() {
          showStatus('送出失敗，請稍後再試。', true);
          document.getElementById('submitBtn').disabled = false;
        });
    }

    function getBackendUrl(action) {
      if (eventApiUrl && (action === 'getSurveyPublic' || action === 'submitSurveyResponse')) {
        return eventApiUrl;
      }
      return scriptUrl;
    }

    document.addEventListener('change', function(event) {
      var target = event.target;
      if (!target.name || !target.name.startsWith('q_')) return;
      var parts = target.name.split('_');
      var idx = parts.length > 1 ? parts[1] : null;
      if (idx === null) return;
      if (target.type === 'radio' && target.value !== '__OTHER__') {
        var other = document.getElementById('q_' + idx + '_other');
        if (other) other.value = '';
      }
    });

    document.addEventListener('input', function(event) {
      var target = event.target;
      var choiceName = target.getAttribute('data-other-choice');
      if (!choiceName) return;
      var choice = document.querySelector('input[name="' + choiceName + '"][value="__OTHER__"]');
      if (!choice) return;
      var hasText = !!target.value.trim();
      choice.checked = hasText;
      if (!hasText && choice.type === 'radio') {
        choice.checked = false;
      }
    });

    fetchSurvey();
