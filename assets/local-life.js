(function(){
  'use strict';
  var feeds=['water','power','fire','traffic'];
  var byId=function(id){return document.getElementById(id)};
  var format=function(value){if(!value)return '';var d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleString('zh-TW',{timeZone:'Asia/Taipei',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}):''};
  var el=function(tag,text,className){var node=document.createElement(tag);if(text)node.textContent=text;if(className)node.className=className;return node};
  var states={ongoing:'進行中',upcoming:'預計施工',restored:'已恢復',ended:'已結束',unknown:'請查閱公告'};
  var empty={water:'目前公告未列出北屯區停水',power:'目前公告未列出北屯區計畫性停電',fire:'目前清單未列出北屯區救災或交通救護案件',traffic:'近 24 小時未列出周邊路況通報'};
  var tabs=Array.from(document.querySelectorAll('.life-tab'));
  function select(tab){tabs.forEach(function(t){var active=t===tab;t.setAttribute('aria-selected',String(active));t.tabIndex=active?0:-1;byId('panel-'+t.dataset.feed).hidden=!active})}
  tabs.forEach(function(tab,index){tab.addEventListener('click',function(){select(tab)});tab.addEventListener('keydown',function(e){var next;if(e.key==='ArrowRight')next=(index+1)%tabs.length;if(e.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;if(e.key==='Home')next=0;if(e.key==='End')next=tabs.length-1;if(next!==undefined){e.preventDefault();select(tabs[next]);tabs[next].focus()}})});
  async function request(feed){var r=await fetch('/api/'+feed,{signal:AbortSignal.timeout(25000),cache:'no-cache'});var data=await r.json();if(!r.ok||!data.ok)throw new Error('unavailable');return data}
  function source(id,meta){var node=byId(id),link=node.querySelector('a');node.replaceChildren(link);node.appendChild(el('span',' · 查詢 '+format(meta.fetchedAt)))}
  function render(feed,data){
    var box=byId('items-'+feed);box.replaceChildren();
    if(!data.items.length)box.appendChild(el('p',empty[feed],'life-status'));
    data.items.forEach(function(item){
      var article=el('article',null,'life-item'),heading=el('h3');
      var status=states[item.state]||item.state||'公告';
      heading.appendChild(el('span',status,'life-tag'));
      heading.appendChild(document.createTextNode(feed==='water'?(item.reason||'停水公告'):feed==='power'?(item.desc||'計畫性停電'):feed==='fire'?([item.kind,item.detail].filter(Boolean).join('・')):item.kind||'道路資訊'));
      article.appendChild(heading);
      if(item.area)article.appendChild(el('p',item.area));
      if(feed==='traffic'&&item.detail)article.appendChild(el('p',item.detail));
      if(item.areas?.length){var details=el('details'),summary=el('summary','查看停電路段與門牌');details.appendChild(summary);item.areas.forEach(function(area){details.appendChild(el('p',area))});article.appendChild(details)}
      var when=feed==='traffic'?'更新 '+format(item.updatedAt):format(item.startAt)+(item.endAt?' ～ '+format(item.endAt):'');
      if(when){var time=el('time',when);time.dateTime=item.updatedAt||item.startAt;article.appendChild(time)}
      if(item.secondStartAt)article.appendChild(el('p','第二次停電 '+format(item.secondStartAt)+' ～ '+format(item.secondEndAt)));
      box.appendChild(article);
    });
    source('source-'+feed,data.meta);
  }
  async function loadFeed(feed){
    try{render(feed,await request(feed))}catch{byId('items-'+feed).replaceChildren(el('p','目前無法取得資訊，請點下方官方來源查詢。','life-status error'));var node=byId('source-'+feed);node.replaceChildren(node.querySelector('a'))}
  }
  var wmo=function(code){if(code===0)return '晴天';if(code<3)return '晴時多雲';if(code===3)return '陰天';if(code<50)return '有霧';if(code<60)return '毛毛雨';if(code<70)return '下雨';if(code<80)return '降雪';if(code<85)return '陣雨';if(code<90)return '陣雪';return '雷雨'};
  var number=function(n,suffix){return Number.isFinite(n)?Math.round(n)+suffix:'—'};
  async function weather(){
    try{var data=await request('weather');byId('weather-temperature').textContent=number(data.current.temperature_2m,'°');byId('weather-text').textContent=wmo(data.current.weather_code);byId('weather-details').textContent='體感 '+number(data.current.apparent_temperature,'°')+'\n今日 '+number(data.daily.temperature_2m_min[0],'°')+' — '+number(data.daily.temperature_2m_max[0],'°')+'\n降雨機率 '+number(data.daily.precipitation_probability_max[0],'%');source('weather-source',data.meta);byId('weather-source').appendChild(el('span',' · 預報 '+format(data.meta.updatedAt)))}
    catch{byId('weather-temperature').textContent='—';byId('weather-text').textContent='天氣暫時無法取得';byId('weather-details').textContent='請稍後重新整理';var node=byId('weather-source');node.replaceChildren(node.querySelector('a'))}
  }
  var busy=false,lastLoad=0;
  async function load(){if(busy)return;busy=true;byId('life-refresh').disabled=true;try{await Promise.all([weather()].concat(feeds.map(loadFeed)));lastLoad=Date.now()}finally{busy=false;byId('life-refresh').disabled=false}}
  byId('life-refresh').addEventListener('click',load);
  document.addEventListener('visibilitychange',function(){if(!document.hidden&&Date.now()-lastLoad>300000)load()});
  function schedule(){setTimeout(function(){if(!document.hidden)load();schedule()},300000)}
  schedule();
  load();
})();
