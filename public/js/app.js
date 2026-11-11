/* WORLD PRESIDENT — frontend SPA (vanilla JS). Contract: ARCHITECTURE.md REST + Socket.io. */
(function(){
'use strict';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtN=n=>n==null?'—':Number(n).toLocaleString('en-US',{maximumFractionDigits:2});
const fmtM=n=>n==null?'—':'$'+fmtN(n)+'M';
const fmtB=n=>n==null?'—':'$'+fmtN(n)+'B';
const simNote=()=>`<p class="sim-note">${esc(t('sim_note'))}</p>`;
const S={token:localStorage.getItem('wp_token')||null,user:null,myCountry:null,myCode:null,world:null,countries:[],socket:null,charts:{},chatChannel:'global',history:JSON.parse(localStorage.getItem('wp_history')||'[]')};
function saveHistory(){try{localStorage.setItem('wp_history',JSON.stringify(S.history.slice(-60)));}catch(e){}}
function pushHistory(){ if(!S.myCountry) return; S.history.push({tick:S.world?.tick??0,treasury:S.myCountry.treasury,gdp:S.myCountry.gdp,approval:S.myCountry.approval}); saveHistory(); }

async function api(path,opts={}){
  const headers={'Content-Type':'application/json',...(opts.headers||{})};
  if(S.token) headers.Authorization='Bearer '+S.token;
  let res;
  try{ res=await fetch('/api'+path,{...opts,headers}); }catch(e){ throw new Error('Network error — is the server running? '+e.message); }
  let data=null; try{ data=await res.json(); }catch(e){ data=null; }
  if(!res.ok){ const msg=(data&&(data.error||data.message))||('HTTP '+res.status); const err=new Error(msg); err.status=res.status; throw err; }
  return data;
}
function toast(msg,kind){ const d=document.createElement('div'); d.className='toast'; d.textContent=msg; $('#toasts').appendChild(d); setTimeout(()=>d.remove(),6000); }
function errBox(e){ return `<div class="error">${esc(e.message||String(e))}</div>`; }
function requireAuth(){ if(!S.token){ location.hash='#/login'; return false; } return true; }

/* ---------- Socket ---------- */
function connectSocket(){
  if(S.socket||!S.token||typeof io==='undefined') return;
  try{
    S.socket=io({auth:{token:S.token}});
    S.socket.on('connect',()=>{});
    S.socket.on('connect_error',()=>{/* stay on REST; do not crash */});
    S.socket.on('world:update',d=>{ S.world={...(S.world||{}),...d}; updateClock(); if(location.hash.startsWith('#/dashboard')) refreshDashboardLive(); if(location.hash.startsWith('#/economy')) loadEconomy(true); });
    S.socket.on('news:new',n=>{ toast('📰 '+(n.title||'News')); const f=$('#news-feed'); if(f) f.insertAdjacentHTML('afterbegin',newsItem(n)); });
    S.socket.on('chat:message',m=>{ if(m.channel===S.chatChannel){ const b=$('#chat-box'); if(b) b.insertAdjacentHTML('beforeend',chatMsg(m)); b.scrollTop=b.scrollHeight; } });
    S.socket.on('notify',n=>toast((n.text||n.message||'Notification')));
    S.socket.on('presence',p=>{ const c=$('#online-count'); if(c) c.textContent='● '+(p.online?p.online.length:(S.world?.onlineCount??0))+' '+t('online'); });
  }catch(e){}
}
function updateClock(){
  const c=$('#world-clock'); if(c&&S.world) c.textContent=(S.world.gameDate||'')+' · Tick '+(S.world.tick??'—');
  const o=$('#online-count'); if(o&&S.world?.onlineCount!=null) o.textContent='● '+S.world.onlineCount+' '+t('online');
}

/* ---------- Nav / routing ---------- */
const NAV=[['dashboard','#/dashboard'],['map','#/map'],['economy','#/economy'],['trade','#/trade'],['population','#/population'],['health','#/health'],['disasters','#/disasters'],['diplomacy','#/diplomacy'],['government','#/government'],['infrastructure','#/infrastructure'],['budget','#/budget'],['news','#/news'],['chat','#/chat'],['rankings','#/rankings'],['profile','#/profile']];
function renderNav(){
  const nav=$('#mainnav');
  if(!S.token){ nav.innerHTML=`<a href="#/landing">${esc(t('app_name'))}</a><a href="#/login">${esc(t('login'))}</a><a href="#/register">${esc(t('register'))}</a>`; $('#logout-btn').classList.add('hidden'); return; }
  $('#logout-btn').classList.remove('hidden');
  nav.innerHTML=NAV.map(([k,h])=>`<a href="${h}" class="${location.hash===h?'active':''}">${esc(t(k))}</a>`).join('')+(S.user?.is_admin?`<a href="#/admin">${esc(t('admin'))}</a>`:'');
}
async function ensureMe(){
  if(!S.token) return false;
  try{ const me=await api('/auth/me'); S.user=me.user; S.myCode=me.countryCode||null; if(S.myCode&&!S.myCountry){ try{S.myCountry=await api('/me/country');}catch(e){} } return true; }
  catch(e){ if(e.status===401){ logout(); } return false; }
}
function logout(){ S.token=null; S.user=null; S.myCountry=null; S.myCode=null; localStorage.removeItem('wp_token'); if(S.socket){S.socket.disconnect();S.socket=null;} renderNav(); location.hash='#/landing'; }
function rerender(){ route(); }
window.WP={rerender};

async function route(){
  renderNav(); applyLang();
  const h=(location.hash||'#/landing').replace(/^#\/?/,'');
  const [page,arg]=h.split('/');
  const app=$('#app');
  if(!S.token && !['landing','login','register'].includes(page)){ location.hash='#/login'; return; }
  if(S.token){ await ensureMe(); renderNav(); connectSocket(); }
  try{
    switch(page){
      case 'landing': return renderLanding(app);
      case 'login': return renderAuth(app,'login');
      case 'register': return renderAuth(app,'register');
      case 'select': return renderSelect(app);
      case 'inauguration': return renderInauguration(app);
      case 'dashboard': return S.myCode?renderDashboard(app):(location.hash='#/select');
      case 'map': return renderMap(app);
      case 'economy': return renderEconomy(app);
      case 'trade': return renderTrade(app);
      case 'population': return renderPopulation(app);
      case 'health': return renderHealth(app);
      case 'disasters': return renderDisasters(app);
      case 'diplomacy': return renderDiplomacy(app);
      case 'government': return renderGovernment(app);
      case 'infrastructure': return renderInfrastructure(app);
      case 'budget': return renderBudget(app);
      case 'news': return renderNews(app);
      case 'chat': return renderChat(app,arg);
      case 'rankings': return renderRankings(app);
      case 'profile': return renderProfile(app);
      case 'admin': return renderAdmin(app);
      default: return renderLanding(app);
    }
  }catch(e){ app.innerHTML=errBox(e)+`<p><a href="#/landing">← ${esc(t('back'))}</a></p>`; }
}
window.addEventListener('hashchange',route);
document.addEventListener('DOMContentLoaded',()=>{ $('#logout-btn').onclick=logout; route(); });

/* ---------- Shared render helpers ---------- */
function stat(label,value,sub){ return `<div class="stat"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div>${sub?`<div class="sub">${esc(sub)}</div>`:''}</div>`; }
function newsItem(n){ return `<div class="card"><span class="badge">${esc(n.category||'news')}</span> <small>${esc(n.gameDate||'')} · Tick ${n.tick??''}</small><h3>${esc(n.title||'')}</h3><p>${esc(n.body||'')}</p></div>`; }
function chatMsg(m){ return `<div class="chat-msg"><b>${esc(m.from||m.username||'')}</b> <small>${esc(m.at||'')}</small><br>${esc(m.text||'')}</div>`; }
async function loadWorld(){ try{ S.world=await api('/world'); updateClock(); }catch(e){} }
function countryCard(c){
  return `<div class="country-card ${c.claimed?'claimed':''}" data-code="${esc(c.code)}"><div style="font-size:1.6rem">${esc(c.flag||'🏳️')}</div><b>${esc(c.name)}</b><br><small>${esc(c.capital||'')} · ${esc(c.region||'')}</small><br><small>${esc(c.government||'')} · Pop ${fmtN(c.population)}</small><br>${c.claimed?`<span class="badge">${esc(t('claimed_by'))}: ${esc(c.president||'')}</span>`:`<span class="badge green">${esc(t('unclaimed'))}</span>`}</div>`;
}
async function openCountryProfile(code){
  const root=$('#modal-root');
  root.innerHTML=`<div class="modal-back"><div class="modal"><button class="close" onclick="document.getElementById('modal-root').innerHTML=''">✕</button><p>${esc(t('loading'))}</p></div></div>`;
  try{
    const c=await api('/countries/'+encodeURIComponent(code));
    root.innerHTML=`<div class="modal-back" onclick="if(event.target===this)this.remove()"><div class="modal"><button class="close" onclick="document.getElementById('modal-root').innerHTML=''">✕</button>
    <h2>${esc(c.flag||'')} ${esc(c.name)} — ${esc(c.capital||'')}</h2>
    <p>${esc(t('claimed_by'))}: ${c.president?esc(c.president):esc(t('unclaimed'))} · ${esc(c.government||'')} · ${esc(c.region||'')}</p>
    <div class="grid grid4">${stat(t('population_label'),fmtN(c.population))}${stat(t('gdp'),fmtB(c.gdp))}${stat(t('treasury'),fmtM(c.treasury))}${stat(t('approval'),(c.approval??'—')+'%')}</div>
    <div class="grid grid3">${stat('GDP / capita','$'+fmtN(c.gdpPerCapita))}${stat('Unemployment',(c.unemployment??'—')+'%')}${stat('Literacy',(c.literacy??'—')+'%')}${stat('Health',(c.healthIndex??'—')+'/100')}${stat('Education',(c.educationIndex??'—')+'/100')}${stat('Infrastructure',(c.infraIndex??'—')+'/100')}</div>
    <p><b>Stockpiles:</b> ${esc(JSON.stringify(c.stockpiles||{}))}</p>
    <p><b>Ministers:</b> ${esc(JSON.stringify(c.ministers||{}))}</p>
    ${!c.president&&S.token&&!S.myCode?`<button class="btn" onclick="WP_claim('${esc(code)}')">${esc(t('claim'))}</button>`:''}
    </div></div>`;
  }catch(e){ root.innerHTML=`<div class="modal-back"><div class="modal">${errBox(e)}<button class="btn" onclick="document.getElementById('modal-root').innerHTML=''">${esc(t('cancel'))}</button></div></div>`; }
}
window.WP_claim=async function(code){
  try{ await api('/countries/claim',{method:'POST',body:JSON.stringify({code})}); toast('Country claimed!'); $('#modal-root').innerHTML=''; S.myCode=code; S.myCountry=await api('/me/country'); location.hash='#/inauguration'; }
  catch(e){ toast(e.message); }
};

/* ---------- Screens ---------- */
function renderLanding(app){
  app.innerHTML=`<section class="hero"><h1>🌍 ${esc(t('app_name'))}</h1><p><b>${esc(t('tagline'))}</b></p><p>${esc(t('landing_sub'))}</p>
  <p><a class="btn" href="#/register">${esc(t('get_started'))}</a> <a class="btn btn-cyan" href="#/login">${esc(t('login'))}</a></p></section>
  <div class="grid grid3" id="landing-world"></div>${simNote()}`;
  loadWorld().then(()=>{ const el=$('#landing-world'); if(!el||!S.world) return;
    el.innerHTML=stat('Game date',S.world.gameDate||'—','Tick '+(S.world.tick??'—'))+stat(t('online'),String(S.world.onlineCount??0))+stat('Top news',(S.world.topNews?.[0]?.title)||'—');
  });
  api('/rankings').then(r=>{ const el=$('#landing-world'); if(el&&r?.gdp) el.insertAdjacentHTML('beforeend',`<div class="card"><h3>🏆 GDP Top 5</h3><ol>${r.gdp.slice(0,5).map(x=>`<li>${esc(x.code)} — ${fmtN(x.value)}</li>`).join('')}</ol></div>`); }).catch(()=>{});
}
function renderAuth(app,mode){
  const isLogin=mode==='login';
  app.innerHTML=`<div class="card"><h2>${esc(t(isLogin?'login':'register'))}</h2><div id="auth-err"></div>
  <form id="auth-form"><label>${esc(t('username'))}</label><input name="username" required minlength="3" maxlength="30">
  ${isLogin?'':`<label>${esc(t('email'))}</label><input name="email" type="email" required>`}
  <label>${esc(t('password'))}</label><input name="password" type="password" required minlength="6">
  <button class="btn" type="submit">${esc(t(isLogin?'login':'register'))}</button></form>
  <p>${isLogin?`No account? <a href="#/register">${esc(t('register'))}</a>`:`Have an account? <a href="#/login">${esc(t('login'))}</a>`}</p></div>`;
  $('#auth-form').onsubmit=async e=>{
    e.preventDefault();
    const fd=new FormData(e.target);
    const body={username:fd.get('username').trim(),password:fd.get('password')};
    if(!isLogin) body.email=fd.get('email').trim();
    if(body.username.length<3||body.password.length<6){ $('#auth-err').innerHTML='<div class="error">Username ≥3 chars, password ≥6 chars.</div>'; return; }
    try{
      const r=await api('/auth/'+(isLogin?'login':'register'),{method:'POST',body:JSON.stringify(body)});
      S.token=r.token; localStorage.setItem('wp_token',r.token); S.user=r.user; connectSocket();
      location.hash=r.user&& (await api('/auth/me').catch(()=>null))?.countryCode ? '#/dashboard' : '#/select';
      // simpler: re-check me
      try{ const me=await api('/auth/me'); location.hash=me.countryCode?'#/dashboard':'#/select'; }catch(_){ location.hash='#/select'; }
    }catch(err){ $('#auth-err').innerHTML=errBox(err); }
  };
}
async function renderSelect(app){
  app.innerHTML=`<h2>${esc(t('select_country'))}</h2><p id="sel-msg"></p><div class="country-grid" id="country-grid"><p>${esc(t('loading'))}</p></div>`;
  try{
    const list=await api('/countries'); S.countries=list;
    $('#country-grid').innerHTML=list.map(countryCard).join('');
    $$('#country-grid .country-card').forEach(el=>el.onclick=()=>{
      const c=S.countries.find(x=>x.code===el.dataset.code);
      if(c.claimed){ openCountryProfile(c.code); }
      else if(confirm(t('claim')+' — '+c.name+'?')) window.WP_claim(c.code);
    });
  }catch(e){ $('#country-grid').innerHTML=errBox(e); }
}
function renderInauguration(app){
  const c=S.myCountry||{};
  app.innerHTML=`<div class="card hero"><h1>${esc(c.flag||'🎉')} ${esc(t('inauguration'))}</h1><h2>${esc(c.name||S.myCode||'')}</h2>
  <p>Congratulations, President ${esc(S.user?.username||'')}! You are now head of government of ${esc(c.name||'')} (${esc(c.capital||'')}).</p>
  <p>Population ${fmtN(c.population)} · GDP ${fmtB(c.gdp)} · Treasury ${fmtM(c.treasury)}</p>
  <a class="btn" href="#/dashboard">Enter your ${esc(t('dashboard'))} →</a></div>`;
  if(!c.name&&S.myCode){ api('/me/country').then(x=>{S.myCountry=x; renderInauguration(app);}).catch(()=>{}); }
}

/* ---------- Dashboard ---------- */
async function renderDashboard(app){
  app.innerHTML=`<h2>${esc(t('dashboard'))}</h2><div id="dash-err"></div><div id="dash-body"><p>${esc(t('loading'))}</p></div>`;
  try{
    const [c,adv,ach]=await Promise.all([api('/me/country'),api('/advisors').catch(()=>null),api('/achievements').catch(()=>null)]);
    S.myCountry=c; pushHistory();
    const d=c;
    $('#dash-body').innerHTML=`
    <div class="card"><h2>${esc(d.flag||'')} ${esc(d.name)} — ${esc(d.capital||'')}</h2><p>President: <b>${esc(d.president||S.user?.username||'')}</b> · ${esc(d.government||'')} · ${esc(d.region||'')} · Currency ${esc(d.currency||'')}</p></div>
    <div class="grid grid4">
      ${stat(t('population_label'),fmtN(d.population))}${stat(t('gdp'),fmtB(d.gdp),'per capita $'+fmtN(d.gdpPerCapita))}
      ${stat(t('treasury'),fmtM(d.treasury),'Debt '+fmtM(d.debt)+' · Reserves '+fmtM(d.reserves))}
      ${stat(t('approval'),(d.approval??'—')+'%')}${stat('Inflation',(d.inflation??'—')+'%')}
      ${stat('Unemployment',(d.unemployment??'—')+'%')}${stat('Literacy',(d.literacy??'—')+'%')}
      ${stat('Health',(d.healthIndex??'—')+'/100')}${stat('Education',(d.educationIndex??'—')+'/100')}
      ${stat('Infrastructure',(d.infraIndex??'—')+'/100')}${stat('Energy',fmtN(d.energy)+' TWh', 'Green '+(d.energyGreenPct??'—')+'%')}
      ${stat('Trade balance',fmtM(d.tradeBalance),'Imports '+fmtM(d.imports)+' · Exports '+fmtM(d.exports))}
      ${stat('Defense',fmtM(d.defenseBudget),'Personnel '+fmtN(d.personnel)+' · Readiness '+(d.readiness??'—')+'%')}
    </div>
    ${d.events?.length?`<div class="card"><h3>⚠️ ${esc(t('disasters'))} — pending events</h3>${d.events.map(ev=>`<p><b>${esc(ev.name||ev.type||'Event')}</b> (severity ${esc(ev.severity??'')}) — ${esc(ev.description||'')}<br><button class="btn btn-sm" onclick="WP_event('${esc(ev.id)}','emergency_fund')">Emergency fund</button> <button class="btn btn-sm btn-ghost" onclick="WP_event('${esc(ev.id)}','international_appeal')">International appeal</button> <button class="btn btn-sm btn-ghost" onclick="WP_event('${esc(ev.id)}','ignore')">Ignore</button></p>`).join('')}</div>`:''}
    <div class="grid grid2">
      <div class="card"><h3>${esc(t('treasury'))} / ${esc(t('gdp'))} history</h3><div class="chart-wrap"><canvas id="ch-main"></canvas></div></div>
      <div class="card"><h3>${esc(t('approval'))} history</h3><div class="chart-wrap"><canvas id="ch-appr"></canvas></div></div>
    </div>
    ${adv?`<div class="card"><h3>🧭 Advisors</h3>${['economy','priorities','diplomacy','risks'].map(k=>adv[k]?.length?`<h4>${esc(k)}</h4><ul>${adv[k].map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:'').join('')}</div>`:''}
    ${ach?`<div class="card"><h3>🏅 Achievements</h3><p>${esc(JSON.stringify(ach))}</p></div>`:''}
    ${simNote()}`;
    drawCharts();
  }catch(e){ $('#dash-err').innerHTML=errBox(e); }
}
function drawCharts(){
  if(typeof Chart==='undefined') return;
  const labels=S.history.map((h,i)=>'T'+(h.tick||i));
  const mk=(id,datasets)=>{ const el=document.getElementById(id); if(!el) return; if(S.charts[id]) S.charts[id].destroy(); S.charts[id]=new Chart(el,{type:'line',data:{labels,datasets},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#e8eef7'}}},scales:{x:{ticks:{color:'#93a4bd'}},y:{ticks:{color:'#93a4bd'}}}}}); };
  mk('ch-main',[{label:'Treasury ($M)',data:S.history.map(h=>h.treasury),borderColor:'#d4af37',tension:.3},{label:'GDP ($B)',data:S.history.map(h=>h.gdp),borderColor:'#22d3ee',tension:.3}]);
  mk('ch-appr',[{label:'Approval %',data:S.history.map(h=>h.approval),borderColor:'#22c55e',tension:.3}]);
}
async function refreshDashboardLive(){
  try{ const c=await api('/me/country'); S.myCountry=c; pushHistory(); const b=$('#dash-body'); if(b) renderDashboard($('#app')); }catch(e){}
}
window.WP_event=async function(id,response){
  try{ await api('/actions/respond-event',{method:'POST',body:JSON.stringify({eventId:id,response})}); toast('Response recorded'); renderDashboard($('#app')); }
  catch(e){ toast(e.message); }
};

/* ---------- Map ---------- */
async function renderMap(app){
  app.innerHTML=`<h2>${esc(t('map'))}</h2><div id="map"></div><p><small>Click a country or capital marker for its profile.</small></p><div id="map-fallback"></div>${simNote()}`;
  let countries=[];
  try{ countries=await api('/countries'); S.countries=countries; }catch(e){ $('#map-fallback').innerHTML=errBox(e); return; }
  // capital coords: try data/countries.json (DATA agent), else no markers
  let coords={};
  try{ const r=await fetch('data/countries.json'); if(r.ok){ const j=await r.json(); (Array.isArray(j)?j:j.countries||[]).forEach(c=>{ if(c.lat!=null) coords[c.code]={lat:c.lat,lng:c.lng}; }); } }catch(e){}
  if(typeof L==='undefined'){ renderCountryGrid($('#map-fallback'),countries); return; }
  try{
    const map=L.map('map').setView([25,10],2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap'}).addTo(map);
    const claimed={}; countries.forEach(c=>claimed[c.code]=c);
    const gj=await fetch('https://raw.githubusercontent.com/johan/world.geo.json/master/countries.geo.json').then(r=>{if(!r.ok) throw new Error('GeoJSON '+r.status); return r.json();});
    L.geoJSON(gj,{style:f=>{ const code=(f.id||f.properties?.iso_a2||'').toUpperCase(); const c=claimed[code]; return {color:'#d4af37',weight:1,fillColor:c?(c.claimed?'#3b82f6':'#22c55e'):'#22395c',fillOpacity:.55}; },
      onEachFeature:(f,layer)=>{ const code=(f.id||f.properties?.iso_a2||'').toUpperCase(); const c=claimed[code]; layer.bindPopup(`<b>${esc(f.properties?.name||code)}</b>${c?`<br>${esc(c.flag||'')} ${esc(c.capital||'')}<br>${c.claimed?esc(t('claimed_by'))+': '+esc(c.president||''):esc(t('unclaimed'))}<br><button onclick="window.WP_openProfile('${esc(code)}')">Profile</button>`:''}`); layer.on('click',()=>{ if(c) openCountryProfile(code); }); }
    }).addTo(map);
    countries.forEach(c=>{ const co=coords[c.code]; if(co) L.marker([co.lat,co.lng]).addTo(map).bindPopup(`${esc(c.flag||'')} <b>${esc(c.name)}</b><br>${esc(c.capital||'')}`).on('click',()=>openCountryProfile(c.code)); });
  }catch(e){ $('#map-fallback').innerHTML=`<p>Map GeoJSON unavailable (${esc(e.message)}). Showing country list instead:</p>`; renderCountryGrid($('#map-fallback'),countries); }
}
window.WP_openProfile=openCountryProfile;
function renderCountryGrid(el,countries){ el.insertAdjacentHTML('beforeend','<div class="country-grid">'+countries.map(countryCard).join('')+'</div>'); $$('#map-fallback .country-card').forEach(n=>n.onclick=()=>openCountryProfile(n.dataset.code)); }

/* ---------- Economy / Market ---------- */
async function renderEconomy(app,keep){
  if(!keep) app.innerHTML=`<h2>${esc(t('economy'))}</h2>${simNote()}<div id="econ-body"><p>${esc(t('loading'))}</p></div>`;
  await loadEconomy(false);
}
async function loadEconomy(keep){
  const body=$('#econ-body'); if(!body) return;
  try{
    const m=await api('/market');
    body.innerHTML=`<table><thead><tr><th>Commodity</th><th>Price</th><th>Change</th><th>Supply</th><th>Demand</th><th>Qty</th><th></th></tr></thead><tbody>
    ${m.map(x=>`<tr><td>${esc(x.commodity)}</td><td>$${fmtN(x.price)}</td><td class="${(x.changePct??0)>=0?'pos':'neg'}">${(x.changePct??0)>=0?'+':''}${fmtN(x.changePct)}%</td><td>${fmtN(x.supply)}</td><td>${fmtN(x.demand)}</td>
    <td><input type="number" min="1" value="10" id="qty-${esc(x.commodity)}" style="width:80px;margin:0"></td>
    <td><button class="btn btn-sm" onclick="WP_market('buy','${esc(x.commodity)}')">${esc(t('buy'))}</button> <button class="btn btn-sm btn-cyan" onclick="WP_market('sell','${esc(x.commodity)}')">${esc(t('sell'))}</button></td></tr>`).join('')}</tbody></table><div id="mkt-msg"></div>${simNote()}`;
  }catch(e){ body.innerHTML=errBox(e); }
}
window.WP_market=async function(side,commodity){
  const qty=parseInt((document.getElementById('qty-'+commodity)||{}).value||'10',10);
  if(!qty||qty<=0){ toast('Quantity must be ≥ 1'); return; }
  try{ const r=await api('/market/'+side,{method:'POST',body:JSON.stringify({commodity,qty})}); toast(side==='buy'?'Bought '+qty+' '+commodity:'Sold '+qty+' '+commodity); loadEconomy(true); }
  catch(e){ const m=$('#mkt-msg'); if(m) m.innerHTML=errBox(e); else toast(e.message); }
};

/* ---------- Trade ---------- */
async function renderTrade(app){
  app.innerHTML=`<h2>${esc(t('trade'))}</h2>${simNote()}<div id="trade-body"><p>${esc(t('loading'))}</p></div>`;
  try{
    const [offers,countries]=await Promise.all([api('/trade/offers'),api('/countries')]);
    $('#trade-body').innerHTML=`
    <div class="card"><h3>New offer</h3><form id="offer-form"><label>To country</label><select name="toCode">${countries.filter(c=>c.code!==S.myCode).map(c=>`<option value="${esc(c.code)}">${esc(c.flag||'')} ${esc(c.name)}${c.claimed?' ('+esc(c.president||'')+')':''}</option>`).join('')}</select>
    <label>Commodity</label><input name="commodity" required placeholder="oil"><label>Qty</label><input name="qty" type="number" min="1" required value="10"><label>Price per unit ($)</label><input name="pricePerUnit" type="number" min="0" step="0.01" required value="10">
    <button class="btn" type="submit">Send offer</button></form><div id="offer-msg"></div></div>
    <div class="card"><h3>Offers involving my country</h3>${offers?.length?`<table><thead><tr><th>ID</th><th>From → To</th><th>Commodity</th><th>Qty</th><th>Price</th><th>Status</th><th></th></tr></thead><tbody>${offers.map(o=>`<tr><td>${esc(o.id??o.offerId??'')}</td><td>${esc(o.fromCode||o.from||'')} → ${esc(o.toCode||o.to||'')}</td><td>${esc(o.commodity)}</td><td>${fmtN(o.qty)}</td><td>$${fmtN(o.pricePerUnit)}</td><td>${esc(o.status||'pending')}</td><td>${o.status==='pending'?`<button class="btn btn-sm" onclick="WP_offer('${esc(o.id??o.offerId)}',true)">Accept</button> <button class="btn btn-sm btn-danger" onclick="WP_offer('${esc(o.id??o.offerId)}',false)">Reject</button>`:''}</td></tr>`).join('')}</tbody></table>`:'<p>No offers yet.</p>'}</div>`;
    $('#offer-form').onsubmit=async e=>{ e.preventDefault(); const fd=new FormData(e.target);
      try{ await api('/trade/offer',{method:'POST',body:JSON.stringify({toCode:fd.get('toCode'),commodity:fd.get('commodity').trim(),qty:Number(fd.get('qty')),pricePerUnit:Number(fd.get('pricePerUnit'))})}); $('#offer-msg').innerHTML='<div class="success">Offer sent.</div>'; renderTrade(app); }
      catch(err){ $('#offer-msg').innerHTML=errBox(err); } };
  }catch(e){ $('#trade-body').innerHTML=errBox(e); }
}
window.WP_offer=async function(offerId,accept){
  try{ await api('/trade/respond',{method:'POST',body:JSON.stringify({offerId,accept})}); toast(accept?'Offer accepted':'Offer rejected'); renderTrade($('#app')); }
  catch(e){ toast(e.message); }
};

/* ---------- Population ---------- */
async function renderPopulation(app){
  app.innerHTML=`<h2>${esc(t('population'))}</h2><div id="pop-body"><p>${esc(t('loading'))}</p></div>`;
  try{
    const p=await api('/population');
    $('#pop-body').innerHTML=`<div class="grid grid4">
    ${stat(t('population_label'),fmtN(p.population||p.total||S.myCountry?.population))}${stat('Birth rate',fmtN(p.birthRate)+' /1k')}${stat('Death rate',fmtN(p.deathRate)+' /1k')}${stat('Migration',fmtN(p.migration))}
    ${stat('Urban',fmtN(p.urbanPct)+'%')}${stat('Rural',fmtN(p.ruralPct)+'%')}${stat('Literacy',fmtN(p.literacy)+'%')}${stat('Poverty',fmtN(p.poverty)+'%')}</div>
    ${p.ageBands?`<div class="card"><h3>Age bands</h3><table><tbody>${Object.entries(p.ageBands).map(([k,v])=>`<tr><td>${esc(k)}</td><td>${fmtN(v)}</td></tr>`).join('')}</tbody></table></div>`:''}
    <div class="card"><h3>Details</h3><pre>${esc(JSON.stringify(p,null,2))}</pre></div>`;
  }catch(e){ $('#pop-body').innerHTML=errBox(e); }
}
/* ---------- Health ---------- */
async function renderHealth(app){
  app.innerHTML=`<h2>${esc(t('health'))}</h2><div id="health-body"><p>${esc(t('loading'))}</p></div>`;
  try{
    const h=await api('/health');
    $('#health-body').innerHTML=`<div class="grid grid4">
    ${stat('Hospitals',fmtN(h.hospitals))}${stat('Doctors',fmtN(h.doctors))}${stat('Beds',fmtN(h.beds))}${stat('Vaccination',fmtN(h.vaccination)+'%')}</div>
    <div class="card"><h3>Active diseases</h3>${h.diseases?.length||h.activeDiseases?.length?`<table><thead><tr><th>Disease</th><th>Affected</th><th>Severity</th><th>Trend</th><th></th></tr></thead><tbody>${(h.diseases||h.activeDiseases).map(d=>`<tr><td>${esc(d.name)}</td><td>${fmtN(d.affected)}</td><td>${esc(d.severity??'')}</td><td>${esc(d.trend||'')}</td><td><button class="btn btn-sm" onclick="WP_vaccinate('${esc(d.name)}')">Vaccinate</button></td></tr>`).join('')}</tbody></table>`:'<p>No active diseases reported.</p>'}</div>
    <div id="health-msg"></div><div class="card"><pre>${esc(JSON.stringify(h,null,2))}</pre></div>`;
  }catch(e){ $('#health-body').innerHTML=errBox(e); }
}
window.WP_vaccinate=async function(disease){
  try{ await api('/health/vaccinate',{method:'POST',body:JSON.stringify({disease})}); toast('Vaccination campaign started for '+disease); renderHealth($('#app')); }
  catch(e){ toast(e.message); }
};
/* ---------- Disasters ---------- */
async function renderDisasters(app){
  app.innerHTML=`<h2>${esc(t('disasters'))}</h2><div id="dis-body"><p>${esc(t('loading'))}</p></div>`;
  try{
    const c=await api('/me/country'); S.myCountry=c;
    const evs=c.events||[];
    $('#dis-body').innerHTML=evs.length?evs.map(ev=>`<div class="card"><h3>${esc(ev.name||ev.type||'Event')}</h3><p>Severity ${esc(ev.severity??'')} · ${esc(ev.description||'')}</p>
    <button class="btn btn-sm" onclick="WP_event('${esc(ev.id)}','emergency_fund')">Emergency fund</button> <button class="btn btn-sm btn-ghost" onclick="WP_event('${esc(ev.id)}','international_appeal')">International appeal</button> <button class="btn btn-sm btn-ghost" onclick="WP_event('${esc(ev.id)}','ignore')">Ignore</button></div>`).join('')
    :'<div class="card"><p>No pending disasters or events. Events arrive each tick and appear here and in News.</p></div>';
    const news=await api('/news?limit=20').catch(()=>[]);
    const disasterNews=(Array.isArray(news)?news:news.items||[]).filter(n=>/disaster|flood|quake|earthquake|drought|storm|fire|heat|pandemic|disease/i.test((n.category||'')+' '+(n.title||'')));
    if(disasterNews.length) $('#dis-body').insertAdjacentHTML('beforeend','<h3>Disaster news</h3>'+disasterNews.map(newsItem).join(''));
  }catch(e){ $('#dis-body').innerHTML=errBox(e); }
}
/* ---------- Diplomacy + UN ---------- */
async function renderDiplomacy(app){
  app.innerHTML=`<h2>${esc(t('diplomacy'))}</h2><div class="tabs"><button class="active" onclick="WP_diploTab('rel',this)">Relations</button><button onclick="WP_diploTab('un',this)">United Nations</button><button onclick="WP_diploTab('msg',this)">Diplomatic messages</button></div><div id="diplo-body"><p>${esc(t('loading'))}</p></div>`;
  window.WP_diploTab=async function(tab,btn){ $$('#app .tabs button').forEach(b=>b.classList.remove('active')); if(btn) btn.classList.add('active'); const b=$('#diplo-body'); if(!b) return;
    try{
      if(tab==='un'){
        const un=await api('/un');
        const list=Array.isArray(un)?un:un.resolutions||[];
        b.innerHTML=`<div class="card"><h3>Propose a resolution</h3><form id="un-form"><textarea name="text" required maxlength="500" placeholder="Resolution text…"></textarea><button class="btn" type="submit">${esc(t('propose'))}</button></form><div id="un-msg"></div></div>
        ${list.length?list.map(r=>`<div class="card"><p><b>#${esc(r.id)}</b> — ${esc(r.proposer||'')}</p><p>${esc(r.text)}</p><p>For ${r.votesFor??0} · Against ${r.votesAgainst??0} · Status ${esc(r.status||'open')}</p><button class="btn btn-sm" onclick="WP_vote('${esc(r.id)}','for')">${esc(t('vote_for'))}</button> <button class="btn btn-sm btn-danger" onclick="WP_vote('${esc(r.id)}','against')">${esc(t('vote_against'))}</button></div>`).join(''):'<p>No resolutions yet.</p>'}`;
        $('#un-form').onsubmit=async e=>{ e.preventDefault(); try{ await api('/un/propose',{method:'POST',body:JSON.stringify({text:new FormData(e.target).get('text')})}); toast('Resolution proposed'); window.WP_diploTab('un'); }catch(err){ $('#un-msg').innerHTML=errBox(err); } };
      } else if(tab==='msg'){
        const countries=await api('/countries');
        b.innerHTML=`<div class="card"><h3>Diplomatic DM</h3><form id="dm-form"><label>To country</label><select name="toCode">${countries.filter(c=>c.code!==S.myCode&&c.claimed).map(c=>`<option value="${esc(c.code)}">${esc(c.name)} (${esc(c.president||'')})</option>`).join('')}</select><textarea name="text" required maxlength="500"></textarea><button class="btn" type="submit">${esc(t('send'))}</button></form><div id="dm-msg"></div><div id="dm-thread"></div></div>`;
        $('#dm-form').onsubmit=async e=>{ e.preventDefault(); const fd=new FormData(e.target); const to=fd.get('toCode');
          try{ await api('/diplomacy/message',{method:'POST',body:JSON.stringify({toCode:to,text:fd.get('text')})}); $('#dm-msg').innerHTML='<div class="success">Sent.</div>'; const th=await api('/diplomacy/messages/'+encodeURIComponent(to)); $('#dm-thread').innerHTML='<h4>Thread</h4>'+(Array.isArray(th)?th:th.messages||[]).map(m=>`<p><b>${esc(m.from||'')}</b>: ${esc(m.text||'')}</p>`).join(''); }
          catch(err){ $('#dm-msg').innerHTML=errBox(err); } };
      } else {
        const d=await api('/diplomacy');
        const rels=d.relations||[];
        b.innerHTML=`<div class="card"><h3>Relations</h3>${rels.length?`<table><thead><tr><th>Country</th><th>Score</th><th>Embassy</th><th>Alliance</th><th>Treaty</th><th>Embargo</th><th>Action</th></tr></thead><tbody>${rels.map(r=>`<tr><td>${esc(r.code)}</td><td>${esc(r.score??'')}</td><td>${r.embassy?'✅':'—'}</td><td>${r.alliance?'✅':'—'}</td><td>${esc(r.treaty||'—')}</td><td>${r.embargo?'⛔':'—'}</td><td><select onchange="WP_relation('${esc(r.code)}',this.value);this.value=''"><option value="">—</option><option value="improve">Improve</option><option value="embassy">Embassy</option><option value="alliance_propose">Propose alliance</option><option value="alliance_accept">Accept alliance</option><option value="treaty">Treaty</option><option value="embargo">Embargo</option><option value="embargo_lift">Lift embargo</option><option value="break">Break relations</option></select></td></tr>`).join('')}</tbody></table>`:'<p>No relations yet.</p>'}</div>
        ${d.pendingOffers?.length?`<div class="card"><h3>Pending</h3><pre>${esc(JSON.stringify(d.pendingOffers,null,2))}</pre></div>`:''}`;
      }
    }catch(e){ b.innerHTML=errBox(e); }
  };
  window.WP_diploTab('rel');
}
window.WP_relation=async function(toCode,action){ if(!action) return; try{ await api('/diplomacy/relation',{method:'POST',body:JSON.stringify({toCode,action})}); toast('Diplomatic action sent: '+action); window.WP_diploTab&&window.WP_diploTab('rel'); }catch(e){ toast(e.message); } };
window.WP_vote=async function(id,vote){ try{ await api('/un/vote',{method:'POST',body:JSON.stringify({id,vote})}); toast('Vote recorded: '+vote); window.WP_diploTab&&window.WP_diploTab('un'); }catch(e){ toast(e.message); } };

/* ---------- Government / Ministers ---------- */
async function renderGovernment(app){
  app.innerHTML=`<h2>${esc(t('government'))}</h2><div id="gov-body"><p>${esc(t('loading'))}</p></div>`;
  try{
    const mins=await api('/actions/ministers');
    const list=Array.isArray(mins)?mins:(mins.ministers||[]);
    const obj=!Array.isArray(mins)&&mins&&typeof mins==='object'?mins:null;
    $('#gov-body').innerHTML=`<div class="card"><h3>Ministers</h3>${list.length?`<table><thead><tr><th>Role</th><th>Name</th></tr></thead><tbody>${list.map(m=>`<tr><td>${esc(m.role)}</td><td>${esc(m.name)}</td></tr>`).join('')}</tbody></table>`:obj?`<pre>${esc(JSON.stringify(obj,null,2))}</pre>`:'<p>No ministers appointed yet.</p>'}</div>
    <div class="card"><h3>Appoint minister</h3><form id="min-form"><label>Role</label><select name="role"><option>foreign</option><option>finance</option><option>defense</option><option>health</option><option>education</option><option>interior</option></select><label>Name</label><input name="name" required minlength="2" maxlength="60"><button class="btn" type="submit">Appoint</button></form><div id="min-msg"></div></div>
    <div class="card"><h3>Policy</h3><form id="pol-form"><label>Tax rate (0.05–0.45)</label><input name="taxRate" type="number" step="0.01" min="0.05" max="0.45" value="${S.myCountry?.taxRate??0.2}"><label>Health budget ($M)</label><input name="healthBudget" type="number" min="0" value=""><label>Education budget ($M)</label><input name="educationBudget" type="number" min="0" value=""><label>Defense budget ($M)</label><input name="defenseBudget" type="number" min="0" value=""><label>Interest rate (0–0.2)</label><input name="interestRate" type="number" step="0.01" min="0" max="0.2" value=""><button class="btn" type="submit">${esc(t('save'))}</button></form><div id="pol-msg"></div></div>`;
    $('#min-form').onsubmit=async e=>{ e.preventDefault(); const fd=new FormData(e.target); try{ await api('/actions/appoint',{method:'POST',body:JSON.stringify({role:fd.get('role'),name:fd.get('name').trim()})}); $('#min-msg').innerHTML='<div class="success">Minister appointed.</div>'; renderGovernment(app); }catch(err){ $('#min-msg').innerHTML=errBox(err); } };
    $('#pol-form').onsubmit=async e=>{ e.preventDefault(); const fd=new FormData(e.target); const body={}; ['taxRate','healthBudget','educationBudget','defenseBudget','interestRate'].forEach(k=>{ const v=fd.get(k); if(v!==''&&v!=null) body[k]=Number(v); });
      try{ const r=await api('/actions/policy',{method:'POST',body:JSON.stringify(body)}); S.myCountry=r.state||r; $('#pol-msg').innerHTML='<div class="success">Policy applied.</div>'; }catch(err){ $('#pol-msg').innerHTML=errBox(err); } };
  }catch(e){ $('#gov-body').innerHTML=errBox(e); }
}
/* ---------- Infrastructure ---------- */
const PROJECTS=['roads','railways','airports','seaports','hospitals','schools','universities','power','renewables','water','factories','farms','research','housing','digital'];
async function renderInfrastructure(app){
  app.innerHTML=`<h2>${esc(t('infrastructure'))}</h2><div id="infra-body"><p>${esc(t('loading'))}</p></div>`;
  try{
    const projs=await api('/actions/projects');
    const list=Array.isArray(projs)?projs:(projs.projects||[]);
    $('#infra-body').innerHTML=`<div class="card"><h3>Build a project</h3><div class="grid grid3">${PROJECTS.map(p=>`<button class="btn btn-blue" onclick="WP_build('${p}')">${esc(p)}</button>`).join('')}</div><div id="build-msg"></div></div>
    <div class="card"><h3>My projects</h3>${list.length?`<table><thead><tr><th>Project</th><th>Status</th><th>Progress</th></tr></thead><tbody>${list.map(p=>`<tr><td>${esc(p.project||p.type||p.name||'')}</td><td>${esc(p.status||'')}</td><td>${esc(p.progress??p.ticksLeft??'')}</td></tr>`).join('')}</tbody></table>`:'<p>No projects yet.</p>'}</div>`;
  }catch(e){ $('#infra-body').innerHTML=errBox(e); }
}
window.WP_build=async function(project){
  try{ await api('/actions/build',{method:'POST',body:JSON.stringify({project})}); toast('Construction started: '+project); renderInfrastructure($('#app')); }
  catch(e){ const m=$('#build-msg'); if(m) m.innerHTML=errBox(e); else toast(e.message); }
};
/* ---------- Budget ---------- */
async function renderBudget(app){
  app.innerHTML=`<h2>${esc(t('budget'))}</h2><div id="budget-body"><p>${esc(t('loading'))}</p></div>`;
  try{
    const c=await api('/me/country'); S.myCountry=c;
    const rev=(c.gdp||0)*1000*(c.taxRate||0)/365; // $M/day approx, shown as estimate
    $('#budget-body').innerHTML=`<div class="grid grid4">${stat(t('treasury'),fmtM(c.treasury))}${stat('Debt',fmtM(c.debt))}${stat('Reserves',fmtM(c.reserves))}${stat('Tax rate',((c.taxRate||0)*100).toFixed(1)+'%')}</div>
    <div class="card"><h3>Daily estimate (simulated)</h3><p>Tax revenue ≈ ${fmtM(rev)} / day · GDP ${fmtB(c.gdp)} · Defense budget ${fmtM(c.defenseBudget)}</p><p>Use Government → Policy to change tax rate and budgets. Use Infrastructure to start projects (costs treasury + commodities).</p></div>
    <div class="card"><h3>Military</h3><div id="mil-body"><p>${esc(t('loading'))}</p></div></div>${simNote()}`;
    try{ const m=await api('/military'); $('#mil-body').innerHTML=`<div class="grid grid4">${stat('Personnel',fmtN(m.personnel))}${stat('Tanks',fmtN(m.equipment?.tanks))}${stat('Jets',fmtN(m.equipment?.jets))}${stat('Ships',fmtN(m.equipment?.ships))}</div><p>Readiness ${esc(m.readiness??'—')}% · Defense budget ${fmtM(m.defenseBudget)}</p>
    <form id="rec-form"><label>Recruit personnel</label><input name="count" type="number" min="1" value="1000"><button class="btn btn-sm" type="submit">Recruit</button></form>
    <form id="eq-form"><label>Equipment</label><select name="item"><option>tanks</option><option>jets</option><option>ships</option></select><input name="qty" type="number" min="1" value="10"><button class="btn btn-sm" type="submit">Buy equipment</button></form>
    <form id="pk-form"><label>Peacekeeping target (country code)</label><input name="targetCode" required maxlength="2" placeholder="PK"><button class="btn btn-sm" type="submit">Send peacekeeping mission</button></form><div id="mil-msg"></div>`;
      $('#rec-form').onsubmit=async e=>{e.preventDefault(); try{await api('/military/recruit',{method:'POST',body:JSON.stringify({count:Number(new FormData(e.target).get('count'))})}); toast('Recruited'); renderBudget(app);}catch(err){$('#mil-msg').innerHTML=errBox(err);}};
      $('#eq-form').onsubmit=async e=>{e.preventDefault(); const fd=new FormData(e.target); try{await api('/military/equipment',{method:'POST',body:JSON.stringify({item:fd.get('item'),qty:Number(fd.get('qty'))})}); toast('Equipment ordered'); renderBudget(app);}catch(err){$('#mil-msg').innerHTML=errBox(err);}};
      $('#pk-form').onsubmit=async e=>{e.preventDefault(); try{await api('/military/peacekeeping',{method:'POST',body:JSON.stringify({targetCode:new FormData(e.target).get('targetCode').trim().toUpperCase()})}); toast('Peacekeeping mission sent');}catch(err){$('#mil-msg').innerHTML=errBox(err);}};
    }catch(e){ $('#mil-body').innerHTML=errBox(e); }
  }catch(e){ $('#budget-body').innerHTML=errBox(e); }
}
/* ---------- News ---------- */
async function renderNews(app){
  app.innerHTML=`<h2>${esc(t('news'))}</h2><div id="news-feed"><p>${esc(t('loading'))}</p></div>`;
  try{ const n=await api('/news?limit=50'); const list=Array.isArray(n)?n:(n.items||n.news||[]); $('#news-feed').innerHTML=list.length?list.map(newsItem).join(''):'<p>No news yet — news is created only from real game events.</p>'; }
  catch(e){ $('#news-feed').innerHTML=errBox(e); }
}
/* ---------- Chat ---------- */
async function renderChat(app,arg){
  const channels=[['global','Global'],['country:'+(S.myCode||''),'My country'],['dm:','Diplomatic DM (pick a country below)']];
  app.innerHTML=`<h2>${esc(t('chat'))}</h2><div class="tabs">${channels.map(([ch,l])=>`<button data-ch="${esc(ch)}" class="${S.chatChannel===ch?'active':''}">${esc(l)}</button>`).join('')}</div>
  <div id="chat-box" class="chat-box"><p>${esc(t('loading'))}</p></div>
  <form id="chat-form"><input name="text" maxlength="500" required placeholder="Message (max 500 chars)…"><button class="btn" type="submit">${esc(t('send'))}</button></form>
  <p><small>DM: use Diplomacy → Diplomatic messages, or type a channel like <code>dm:PK</code> in the box below.</small></p>
  <form id="dm-jump"><input name="code" maxlength="2" placeholder="Country code, e.g. PK"><button class="btn btn-sm btn-ghost" type="submit">Open DM</button></form>
  <div class="card"><h3>Online players (from server)</h3><div id="online-list"><p>${esc(t('loading'))}</p></div></div>`;
  const load=async ch=>{ S.chatChannel=ch; $$('#app .tabs button').forEach(b=>b.classList.toggle('active',b.dataset.ch===ch));
    try{ const m=await api('/chat/'+encodeURIComponent(ch)); const list=Array.isArray(m)?m:(m.messages||[]); $('#chat-box').innerHTML=list.length?list.map(chatMsg).join(''):'<p>No messages yet.</p>'; const b=$('#chat-box'); b.scrollTop=b.scrollHeight; }
    catch(e){ $('#chat-box').innerHTML=errBox(e); } };
  $$('#app .tabs button').forEach(b=>b.onclick=()=>{ if(b.dataset.ch==='dm:'){ toast('Pick a country code below for a DM'); return; } load(b.dataset.ch); });
  $('#chat-form').onsubmit=async e=>{ e.preventDefault(); const inp=e.target.text; const text=inp.value.trim(); if(!text) return; inp.value='';
    try{ if(S.socket) S.socket.emit('chat:send',{channel:S.chatChannel,text}); else await api('/chat',{method:'POST',body:JSON.stringify({channel:S.chatChannel,text})}); if(!S.socket) load(S.chatChannel); }
    catch(err){ toast(err.message); } };
  $('#dm-jump').onsubmit=e=>{ e.preventDefault(); const code=new FormData(e.target).get('code').trim().toUpperCase(); if(code) load('dm:'+code); };
  load(S.chatChannel.startsWith('dm:')||S.chatChannel.startsWith('country:')?S.chatChannel:'global');
  try{ const w=await api('/world'); $('#online-list').innerHTML=`<p>${w.onlineCount??0} online (live count from server). Presence list arrives via Socket.io when connected.</p>`; }catch(e){ $('#online-list').innerHTML=errBox(e); }
}
/* ---------- Rankings ---------- */
async function renderRankings(app){
  app.innerHTML=`<h2>${esc(t('rankings'))}</h2><div id="rank-body"><p>${esc(t('loading'))}</p></div>`;
  try{ const r=await api('/rankings');
    $('#rank-body').innerHTML=Object.entries(r).map(([k,arr])=>`<div class="card"><h3>${esc(k)}</h3><ol>${(arr||[]).slice(0,10).map(x=>`<li><b>${esc(x.code||x.country||'')}</b> — ${fmtN(x.value??x.score??'')}</li>`).join('')||'<li>—</li>'}</ol></div>`).join('');
  }catch(e){ $('#rank-body').innerHTML=errBox(e); }
}
/* ---------- Profile ---------- */
async function renderProfile(app){
  app.innerHTML=`<h2>${esc(t('profile'))}</h2><div id="prof-body"><p>${esc(t('loading'))}</p></div>`;
  try{
    const [me,ach]=await Promise.all([api('/auth/me'),api('/achievements').catch(()=>null)]);
    const c=S.myCountry||(me.countryCode?await api('/me/country').catch(()=>null):null);
    $('#prof-body').innerHTML=`<div class="card"><p><b>${esc(me.user.username)}</b> (${esc(me.user.email||'')}) ${me.user.is_admin?'<span class="badge gold">Admin</span>':''}</p>
    <p>Country: ${c?esc(c.flag||'')+' '+esc(c.name)+' ('+esc(c.code)+')':'No country claimed yet — <a href="#/select">choose one</a>'}</p></div>
    ${ach?`<div class="card"><h3>🏅 Achievements</h3><pre>${esc(JSON.stringify(ach,null,2))}</pre></div>`:''}
    ${c?`<div class="card"><h3>Your nation</h3><div class="grid grid4">${stat(t('gdp'),fmtB(c.gdp))}${stat(t('treasury'),fmtM(c.treasury))}${stat(t('approval'),(c.approval??'—')+'%')}${stat(t('population_label'),fmtN(c.population))}</div></div>`:''}`;
  }catch(e){ $('#prof-body').innerHTML=errBox(e); }
}
/* ---------- Admin ---------- */
async function renderAdmin(app){
  app.innerHTML=`<h2>${esc(t('admin'))}</h2><div id="admin-body"><p>${esc(t('loading'))}</p></div>`;
  try{
    const o=await api('/admin/overview');
    $('#admin-body').innerHTML=`<div class="card"><h3>Overview</h3><pre>${esc(JSON.stringify(o,null,2))}</pre></div>
    <div class="card"><h3>Broadcast</h3><form id="bc-form"><textarea name="text" required maxlength="500"></textarea><button class="btn" type="submit">Broadcast</button></form><div id="bc-msg"></div></div>
    <div class="card"><h3>Moderate</h3><form id="mod-form"><label>User ID</label><input name="userId" required><label>Action</label><select name="action"><option>ban</option><option>unban</option><option>reset_country</option></select><button class="btn btn-danger" type="submit">Apply</button></form><div id="mod-msg"></div></div>
    <div class="card"><h3>Tick speed (seconds, 10–600)</h3><form id="sp-form"><input name="seconds" type="number" min="10" max="600" value="60"><button class="btn" type="submit">Set speed</button></form><div id="sp-msg"></div></div>`;
    $('#bc-form').onsubmit=async e=>{e.preventDefault(); try{await api('/admin/broadcast',{method:'POST',body:JSON.stringify({text:new FormData(e.target).get('text')})}); $('#bc-msg').innerHTML='<div class="success">Broadcast sent.</div>';}catch(err){$('#bc-msg').innerHTML=errBox(err);}};
    $('#mod-form').onsubmit=async e=>{e.preventDefault(); const fd=new FormData(e.target); try{await api('/admin/moderate',{method:'POST',body:JSON.stringify({userId:fd.get('userId'),action:fd.get('action')})}); $('#mod-msg').innerHTML='<div class="success">Done.</div>';}catch(err){$('#mod-msg').innerHTML=errBox(err);}};
    $('#sp-form').onsubmit=async e=>{e.preventDefault(); try{await api('/admin/speed',{method:'POST',body:JSON.stringify({seconds:Number(new FormData(e.target).get('seconds'))})}); $('#sp-msg').innerHTML='<div class="success">Speed updated.</div>';}catch(err){$('#sp-msg').innerHTML=errBox(err);}};
  }catch(e){ $('#admin-body').innerHTML=errBox(e)+'<p>Admin endpoints require an admin account (first registered user).</p>'; }
}
})();
