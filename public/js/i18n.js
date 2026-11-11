/* WORLD PRESIDENT i18n — tries data/i18n.json (DATA agent), falls back to embedded dict. */
window.WP_I18N_FALLBACK = {
en:{app_name:"WORLD PRESIDENT",tagline:"Your Nation. Your Decisions. Our World.",landing_title:"Become President of a Nation",landing_sub:"Register, claim a country, and govern it in a persistent shared world with thousands of real players. Every decision has consequences.",get_started:"Get Started",login:"Login",logout:"Logout",register:"Register",username:"Username",email:"Email",password:"Password",dashboard:"Dashboard",map:"World Map",economy:"Economy",trade:"Trade",population:"Population",health:"Healthcare",disasters:"Disasters",diplomacy:"Diplomacy",government:"Government",infrastructure:"Infrastructure",budget:"Budget",news:"News",chat:"Chat",rankings:"Rankings",profile:"Profile",admin:"Admin",select_country:"Choose Your Country",inauguration:"Inauguration",sim_note:"Simulated market — not real-world data.",footer_sim:"Simulated market — not real-world data.",treasury:"Treasury",gdp:"GDP",approval:"Approval",population_label:"Population",online:"online",loading:"Loading…",claim:"Claim this country",claimed_by:"President",unclaimed:"Unclaimed",send:"Send",propose:"Propose",vote_for:"Vote For",vote_against:"Vote Against",buy:"Buy",sell:"Sell",save:"Save",cancel:"Cancel",back:"Back"},
ur:{app_name:"ورلڈ پریزیڈنٹ",tagline:"آپ کی قوم۔ آپ کے فیصلے۔ ہماری دنیا۔",landing_title:"کسی قوم کے صدر بنیں",landing_sub:"رجسٹر کریں، ملک منتخب کریں اور ہزاروں حقیقی کھلاڑیوں کے ساتھ مشترکہ دنیا میں حکومت کریں۔ ہر فیصلے کے نتائج ہوتے ہیں۔",get_started:"شروع کریں",login:"لاگ ان",logout:"لاگ آؤٹ",register:"رجسٹر",username:"صارف نام",email:"ای میل",password:"پاس ورڈ",dashboard:"ڈیش بورڈ",map:"عالمی نقشہ",economy:"معیشت",trade:"تجارت",population:"آبادی",health:"صحت",disasters:"آفات",diplomacy:"سفارت کاری",government:"حکومت",infrastructure:"انفراسٹرکچر",budget:"بجٹ",news:"خبریں",chat:"چیٹ",rankings:"درجہ بندی",profile:"پروفائل",admin:"ایڈمن",select_country:"اپنا ملک منتخب کریں",inauguration:"حلف برداری",sim_note:"مصنوعی مارکیٹ — حقیقی دنیا کا ڈیٹا نہیں۔",footer_sim:"مصنوعی مارکیٹ — حقیقی دنیا کا ڈیٹا نہیں۔",treasury:"خزانہ",gdp:"جی ڈی پی",approval:"مقبولیت",population_label:"آبادی",online:"آن لائن",loading:"لوڈ ہو رہا ہے…",claim:"اس ملک کا دعویٰ کریں",claimed_by:"صدر",unclaimed:"غیر دعویٰ شدہ",send:"بھیجیں",propose:"تجویز کریں",vote_for:"حق میں ووٹ",vote_against:"مخالف ووٹ",buy:"خریدیں",sell:"بیچیں",save:"محفوظ کریں",cancel:"منسوخ",back:"واپس"}
};
window.WP_I18N = window.WP_I18N_FALLBACK;
window.WP_LANG = localStorage.getItem('wp_lang') || 'en';
async function wpLoadI18n(){
  try{
    const r = await fetch('data/i18n.json');
    if(r.ok){ const j = await r.json(); if(j && j.en && j.ur){ window.WP_I18N = j; } }
  }catch(e){ /* DATA agent file not present yet — embedded fallback is used */ }
  applyLang();
}
function t(key){ const d = window.WP_I18N[window.WP_LANG] || window.WP_I18N.en; return d[key] || (window.WP_I18N.en[key] || key); }
function applyLang(){
  document.documentElement.lang = window.WP_LANG === 'ur' ? 'ur' : 'en';
  document.documentElement.dir = window.WP_LANG === 'ur' ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-i18n]').forEach(el=>{ el.textContent = t(el.dataset.i18n); });
  const lt = document.getElementById('lang-toggle'); if(lt) lt.textContent = window.WP_LANG === 'ur' ? 'English' : 'اردو';
  localStorage.setItem('wp_lang', window.WP_LANG);
}
function setLang(l){ window.WP_LANG = l; applyLang(); if(window.WP && window.WP.rerender) window.WP.rerender(); }
document.addEventListener('DOMContentLoaded', ()=>{ wpLoadI18n(); const lt=document.getElementById('lang-toggle'); if(lt) lt.onclick=()=>setLang(window.WP_LANG==='ur'?'en':'ur'); });
