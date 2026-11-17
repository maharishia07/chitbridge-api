/* Ledgers page — ChitBridge · CB Accounts › Reports › Ledgers (2026-10-03)
   Built on the frozen list standard (docs/design/list-standard/index.html, SYSTEM.md §3a).
   • The list on the right is a CBList declaration (see LEDGER_LIST below); its shell code here is the standard's, adapted only to
     take the declaration from the selected ledger. In the product it is a CBList mount, not this copy.
   • The avatar is CBAvatar, copied unchanged from the standard. In the product it is the shared CBAvatar mount.
   • New on this page: the ledger tree (the second pane), the figures line in the title row, the parties check notice,
     and the party-agreement marker.
   • The page paints; it never adds up money. Every figure comes from data.js (the API's shape). */
(function(){
'use strict';
var D=window.LEDGER_DATA, SHOP=D.shop;

/* ═════ helpers ═════ */
function rs(paise){ var s=(Math.abs(paise)/100).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2}); return '₹'+s; }
function money(a){ return a&&a[0]? rs(a[0])+' '+a[1] : '₹0.00'; }                 /* Dr/Cr, never minus */
function moneyH(a){ return a&&a[0]? '<b>'+rs(a[0])+'</b><span class="side">'+a[1]+'</span>' : '<b>₹0.00</b>'; }
function signed(a){ return a? (a[1]==='Cr'?-a[0]:a[0]) : 0; }                         /* sorting only, never shown */
function day(iso){ var p=iso.split('-'); return new Date(+p[0],+p[1]-1,+p[2]); }
function dfmt(d,o){ return d.toLocaleDateString('en-IN',o||{day:'2-digit',month:'short'}); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
function store(k,v){ try{ if(v===undefined){ var x=localStorage.getItem('cblist.'+k); return x?JSON.parse(x):null; } localStorage.setItem('cblist.'+k,JSON.stringify(v)); }catch(_){ return null; } }
var $=function(id){return document.getElementById(id);};
var URLP=new URLSearchParams(location.search);

/* ═════ page state ═════ */
var PAGE={
  sel: parseSel(URLP.get('sel')) || store('ledger.sel') || {k:'L',id:'2100'},
  period: URLP.get('period') || 'fy',
  view: URLP.get('view') || (URLP.get('sel')?'ledger':'tree'),   /* phone only: tree page or ledger page */
  folded: URLP.get('fold')==='1' || store('ledger.folded')===true,
  treeW: store('ledger.treeW') || 360,
  tq: URLP.get('tq')||'',
  tOpen: store('ledger.treeOpen') || {}                           /* folded bands/groups/control accounts */
};
function parseSel(v){ if(!v) return null; return v[0]==='P'?{k:'P',id:v.slice(1)}:{k:'L',id:v.replace(/^L/,'')}; }
function selLedger(){ return PAGE.sel.k==='L'? D.ledgers[PAGE.sel.id] : D.ledgers[D.parties[PAGE.sel.id].ledger]; }
function selFig(){ return (PAGE.sel.k==='L'? D.ledgers[PAGE.sel.id] : D.parties[PAGE.sel.id]).fig[PAGE.period]; }
function selName(){ return PAGE.sel.k==='L'? D.ledgers[PAGE.sel.id].short : (D.parties[PAGE.sel.id].short||D.parties[PAGE.sel.id].name); }
function selFull(){ return PAGE.sel.k==='L'? D.ledgers[PAGE.sel.id].name : D.parties[PAGE.sel.id].name; }
function selKind(){ return PAGE.sel.k==='P'?'party':(D.ledgers[PAGE.sel.id].control?'control':'plain'); }
function postKey(){ return PAGE.sel.k==='P'? 'P:'+PAGE.sel.id : PAGE.sel.id; }

/* ═════ THE DECLARATION — what this page tells CBList (the only list code a page writes) ═════ */
var KINDS=[], TENDERS=[], COUNTERS=[], PEOPLE=[];
D.entries.forEach(function(e){ [[KINDS,e.kind],[TENDERS,e.tender],[COUNTERS,e.counter],[PEOPLE,e.person]].forEach(function(p){ if(p[0].indexOf(p[1])<0) p[0].push(p[1]); }); });
var NO_PARTY='No party';
function partyName(id){ return id? D.parties[id].name : ''; }

function LEDGER_LIST(){
  var kind=selKind(), L=selLedger(), pk=postKey(), per=D.periods[PAGE.period];
  var cols=[
    {key:'date',label:'Date',prio:1,w:112,sort:true,cell:function(x){return dfmt(day(x.e.date));}}];
  if(kind==='control') cols.push(
    {key:'party',label:'Party',prio:2,w:200,sort:true,html:true,cell:function(x){return x.e.party?esc(partyName(x.e.party)):'<span class="dim">'+NO_PARTY+'</span>';}});
  cols.push(
    {key:'what',label:'Details',prio:kind==='control'?3:2,w:220,html:true,cell:function(x){ var e=x.e;
      return esc(e.kind)+(e.bill?' <span class="link">'+esc(e.bill)+'</span>':'')+' <span class="dim">'+esc(e.time)+'</span>'; }},
    {key:'bal',label:'Balance',prio:kind==='control'?4:3,w:160,num:true,sort:true,cell:function(x){return money(x.p.bal);}},
    {key:'entry',label:'Entry no.',prio:5,w:160,mono:true,sort:true,cell:function(x){return x.e.entry;}},
    {key:'tender',label:'Tender',prio:6,w:110,cell:function(x){return x.e.tender;}},
    {key:'counter',label:'Counter',prio:7,w:120,cell:function(x){return x.e.counter;}},
    {key:'person',label:'Rung by',prio:8,w:110,cell:function(x){return x.e.person;}});
  var filters=[['kind','Kind',KINDS],['tender','Tender',TENDERS],['counter','Counter',COUNTERS],['person','Rung by',PEOPLE]];
  if(kind==='control') filters.unshift(['party','Party',L.parties.map(partyName).concat([NO_PARTY])]);
  var notices=[];
  if(kind==='control'&&L.recon[PAGE.period].state==='differ'){ var r=L.recon[PAGE.period];
    notices.push({cls:'warn',text:money(r.amount)+'<span class="pw"> with</span> no party',fix:'Show it',run:function(s){ s.filt={party:NO_PARTY}; s.q=''; },
      say:r.n===1?'Showing the 1 entry with no party. Open it and pick the party.':'Showing the '+r.n+' entries with no party.'}); }
  return {
    title:selName(), key:'ledger.'+kind, view:'grid', defaultCols:kind==='control'?['date','party','what']:['date','what','bal'],
    columns:cols,
    amount:{key:'amount',label:'Amount',w:160,cell:function(x){return money(x.p.amt);}},
    groups:[['month','Month'],['day','Day'],['none','None']], group:'month',
    defaultSort:{key:'date',dir:-1},                                   /* newest first, like a bank passbook app */
    filters:filters, notices:notices,
    rows:function(){ return rowsFor(pk,per); },
    search:function(x){ var e=x.e; return [e.kind,e.bill,e.entry,partyName(e.party),money(x.p.amt),e.tender,e.person].join(' '); },
    gist:function(x){ return x.e.gist; },
    groupFig:function(g,k){ var f=selFig()[g==='month'?'months':'days'][k]; return f; },
    next:nextOf, actionsWord:'Download CSV'
  };
}
var ROWCACHE={};
function rowsFor(pk,per){
  var ck=pk+'|'+per.from+'|'+per.to; if(ROWCACHE[ck]) return ROWCACHE[ck];
  var out=[]; D.entries.forEach(function(e){ var p=e.post[pk]; if(!p||e.date<per.from||e.date>per.to) return;
    out.push({id:e.id,e:e,p:p,date:e.date+' '+e.time,party:partyName(e.party)||'~',amount:signed(p.amt),bal:signed(p.bal),entry:e.entry,
      kind:e.kind,tender:e.tender,counter:e.counter,person:e.person,partyF:e.party?partyName(e.party):NO_PARTY}); });
  return (ROWCACHE[ck]=out);
}
/* what a row opens to: the journal lines, never cut, never sideways; nothing the row already shows */
function nextOf(x,shownCols){
  var e=x.e, kind=selKind(), led=selLedger(), showsParty=shownCols.indexOf('party')>=0;
  var h=(e.gist&&e.gist.indexOf('₹')<0)?'<div class="gist">'+esc(e.gist)+'</div>':'';
  h+='<div class="jl"><div class="h">Code · Ledger</div><div class="h r">Debit</div><div class="h r">Credit</div>'+
    e.lines.map(function(l){ var me=l[0]===led.code, who=l[4]&&!(kind==='party'||showsParty)?' · '+partyName(l[4]):'';
      return '<div class="'+(me?'me':'')+'"><span class="code">'+l[0]+'</span>'+esc(l[1]+who)+'</div><div class="r'+(me?' me':'')+'">'+(l[2]?rs(l[2]):'')+'</div><div class="r'+(me?' me':'')+'">'+(l[3]?rs(l[3]):'')+'</div>'; }).join('')+'</div>';
  var facts=[];
  if(shownCols.indexOf('entry')<0) facts.push('Entry '+e.entry);
  if(shownCols.indexOf('tender')<0) facts.push(e.tender);
  if(shownCols.indexOf('counter')<0) facts.push(e.counter);
  if(shownCols.indexOf('person')<0) facts.push('rung by '+e.person);
  h+='<div class="facts">'+facts.map(function(f){return '<span>'+esc(f)+'</span>';}).join('')+'</div>';
  h+='<div class="acts">'+(e.bill?'<button class="btn" data-act="bill">Open bill</button>':'')+'<button class="btn" data-act="entry">Open entry</button><button class="btn" data-act="reverse">Reverse this entry</button></div>';
  return h;
}

/* ═════ CBList: the shell (the standard's, unchanged in behaviour) ═════ */
var S={}, openPop=null, pstate='normal';
var PERIODS=[['today','Today'],['month','This month'],['fy','This FY (Apr–Mar)'],['custom','Custom']];
function cur(){ return LEDGER_LIST(); }
function st(L){
  if(!S[L.key]){ var saved=store(L.key)||{};
    S[L.key]={ cols:saved.cols||L.defaultCols.slice(), widths:saved.widths||{}, view:saved.view||L.view, group:saved.group||L.group,
      sort:saved.sort||L.defaultSort, filt:{}, q:'', open:{}, allOpen:false }; }
  return S[L.key];
}
function save(L){ var s=st(L); store(L.key,{cols:s.cols,widths:s.widths,view:s.view,group:s.group,sort:s.sort}); }
function colsOf(L,s){ var by={}; L.columns.forEach(function(c){by[c.key]=c;}); return s.cols.map(function(k){return by[k];}).filter(Boolean).concat(L.amount?[L.amount]:[]); }
function widthOf(L,s,c){ return (s.widths[c.key]||c.w); }
function template(L,s){ var cs=colsOf(L,s), keys=cs.map(function(c){return c.key;});
  var flex=keys.indexOf('what')>=0?'what':keys.indexOf('party')>=0?'party':keys[keys.length-2];
  return cs.map(function(c){ var w=widthOf(L,s,c); return c.key===flex?'minmax('+w+'px,1fr)':w+'px'; }).join(' '); }
function filtered(L,s){ return Object.keys(s.filt).some(function(k){return s.filt[k];})||!!s.q.trim(); }
function rowsOf(L,s){
  var rows=L.rows().slice(), q=s.q.trim().toLowerCase();
  if(q) rows=rows.filter(function(x){return L.search(x).toLowerCase().indexOf(q)>=0;});
  Object.keys(s.filt).forEach(function(f){ var v=s.filt[f]; if(!v) return;
    rows=rows.filter(function(x){ return f==='party'? x.partyF===v : x[f]===v; }); });
  if(s.sort){ var c=s.sort.key, dir=s.sort.dir;
    rows.sort(function(a,b){ var A=a[c],B=b[c]; if(A===B&&c!=='date'){A=a.date;B=b.date;} return (A>B?1:A<B?-1:0)*dir; }); }
  return rows;
}
function groupKey(L,s,x){
  if(!s.sort||s.sort.key!=='date') return null;                       /* groups follow the date order only */
  var d=day(x.e.date);
  if(s.group==='day') return [dfmt(d,{weekday:'short',day:'2-digit',month:'short'}), x.e.date, 'day'];
  if(s.group==='month') return [dfmt(d,{month:'long',year:'numeric'}), x.e.date.slice(0,7), 'month'];
  return null;
}

/* Row 1 · the title row */
function paintTitle(){
  var phoneTree=isPhone()&&PAGE.view==='tree', L=cur(), s=st(L), per=D.periods[PAGE.period];
  var h='<button class="btn back" id="backBtn" aria-label="Back to all ledgers">‹</button>';
  if(phoneTree) h='<h1>Ledger</h1>';
  else {
    var full=selFull(); h+='<h1'+(full!==L.title?' title="'+esc(full)+'"':'')+'>'+esc(L.title)+'</h1>';
  }
  h+='<span class="anchor"><button class="chip period" id="periodBtn" aria-haspopup="dialog" aria-expanded="'+(openPop==='period')+'" aria-label="Period: '+esc(per.label)+'"><span class="pl">'+esc(per.label)+'</span><span class="ps">'+esc(per.short)+'</span> ▾</button>'+(openPop==='period'?periodPop():'')+'</span>';
  if(!phoneTree){
    var f=selFig(), same=f.open[0]===f.close[0]&&f.open[1]===f.close[1], led=selLedger(), parts=[];
    if(same) parts.push(['','<span class="lbl">Balance </span>'+moneyH(f.close)]);
    else { parts.push(['o','<span class="lbl">Opening </span>'+moneyH(f.open)]); parts.push(['c','<span class="lbl">Closing </span>'+moneyH(f.close)]); }
    h+='<span class="brk" aria-hidden="true"></span><span class="figs">'+parts.map(function(p){return '<span class="'+p[0]+'">'+p[1]+'</span>';}).join('')+'</span>';
    if(selKind()==='control'&&led.recon[PAGE.period].state==='agree') h+='<span class="recon ok">✓<span class="pw"> parties</span> agree</span>';
    h+=L.notices.map(function(n,i){return '<button class="chip '+n.cls+'" data-notice="'+i+'">⚠ '+n.text+' <span class="go"><span class="fixw">'+esc(n.fix)+' </span>›</span></button>';}).join('');
  }
  h+='<span class="who"><span class="shop">'+esc(SHOP)+'</span><button class="btn home" data-act="home" aria-label="Home">⌂<span class="hw"> Home</span></button><span class="anchor"><button class="avbtn" id="avBtn" aria-haspopup="dialog" aria-expanded="'+(openPop==='av')+'" aria-label="'+esc(SHOP)+': your menu">C</button>'+(openPop==='av'?avPop():'')+'</span></span>';
  $('titlerow').innerHTML=h; $('titlerow').classList.toggle('tv',phoneTree);
}
function periodPop(){
  return '<div class="pop left" role="dialog" aria-label="Period"><h4>Period</h4><div class="preset">'+
    PERIODS.map(function(p){return '<button data-period="'+p[0]+'" aria-pressed="'+(PAGE.period===p[0])+'">'+p[1]+'</button>';}).join('')+'</div>'+
    (PAGE.period==='custom'?'<div class="custom"><input id="from" type="date" value="2026-07-01" aria-label="From"> → <input id="to" type="date" value="2026-09-30" aria-label="To"></div>':'')+'</div>';
}

/* ═════ THE AVATAR (CBAvatar): one control, the same person, menu, theme and font on every page ═════ */
var APP_THEMES_RAW={"cream":{"name":"Cream","dot":"#FAF8F4","vars":{"--page":"#FAF8F4","--card":"#fff","--panel":"#F7F1E4","--line":"#E7E2D8","--line-soft":"#E7E2D8","--hair":"#F7F1E4","--ink":"#0F2E3D","--muted":"#494F56","--faint":"#5D636A","--ghost":"#646A72","--green":"#27794c","--green-t":"#E6F4EC","--green-b":"#2f8f5b","--amber-t":"#F6ECD8","--amber-i":"#6b5a36","--amber-b":"#E8D9BC","--red":"#b4453f","--red-t":"#FBECEB","--red-i":"#b4453f","--red-b":"#a5382e","--blue":"#3F66A6","--blue-t":"#eef3fb","--blue-b":"#cfe0f4","--blue-i":"#345488"}},"cool":{"name":"Cool","dot":"#F4F6F8","vars":{"--page":"#F4F6F8","--card":"#ffffff","--panel":"#EEF2F6","--line":"#DEE3E8","--line-soft":"#DEE3E8","--hair":"#EEF2F6","--ink":"#0F2E3D","--muted":"#494F56","--faint":"#5D636A","--ghost":"#646A72","--green":"#27794c","--green-t":"#E6F4EC","--green-b":"#2f8f5b","--amber-t":"#F6ECD8","--amber-i":"#6b5a36","--amber-b":"#D6DEE6","--red":"#b4453f","--red-t":"#FBECEB","--red-i":"#b4453f","--red-b":"#a5382e","--blue":"#3F66A6","--blue-t":"#eef3fb","--blue-b":"#cfe0f4","--blue-i":"#345488"}},"contrast":{"name":"Contrast","dot":"#ffffff","vars":{"--page":"#ffffff","--card":"#ffffff","--panel":"#F7F1E4","--line":"#B9C2CB","--line-soft":"#B9C2CB","--hair":"#F7F1E4","--ink":"#0A1E29","--muted":"#4E555C","--faint":"#5D636A","--ghost":"#646A72","--green":"#27794c","--green-t":"#E6F4EC","--green-b":"#2f8f5b","--amber-t":"#F6ECD8","--amber-i":"#6b5a36","--amber-b":"#E8D9BC","--red":"#b4453f","--red-t":"#FBECEB","--red-i":"#b4453f","--red-b":"#a5382e","--blue":"#3F66A6","--blue-t":"#eef3fb","--blue-b":"#cfe0f4","--blue-i":"#345488"}},"sand":{"name":"Sand","dot":"#F3EDE1","vars":{"--page":"#F3EDE1","--card":"#FFFDF8","--panel":"#F6EFE0","--line":"#DED3BF","--line-soft":"#DED3BF","--hair":"#F6EFE0","--ink":"#0F2E3D","--muted":"#494F56","--faint":"#5D636A","--ghost":"#646A72","--green":"#27794c","--green-t":"#E6F4EC","--green-b":"#2f8f5b","--amber-t":"#F6ECD8","--amber-i":"#6b5a36","--amber-b":"#E0D2B4","--red":"#b4453f","--red-t":"#FBECEB","--red-i":"#b4453f","--red-b":"#a5382e","--blue":"#3F66A6","--blue-t":"#eef3fb","--blue-b":"#cfe0f4","--blue-i":"#345488"}},"vibrant":{"name":"Vibrant","dot":"#1F5FD0","vars":{"--page":"#FBFCFE","--card":"#ffffff","--panel":"#FDF4E0","--line":"#D8E0EA","--line-soft":"#D8E0EA","--hair":"#FDF4E0","--ink":"#0F2E3D","--muted":"#494F56","--faint":"#5D636A","--ghost":"#646A72","--green":"#0F8749","--green-t":"#E6F4EC","--green-b":"#17A45C","--amber-t":"#F6ECD8","--amber-i":"#6b5a36","--amber-b":"#F0DCA8","--red":"#C7352B","--red-t":"#FBECEB","--red-i":"#C7352B","--red-b":"#B32C23","--blue":"#1F5FD0","--blue-t":"#E8F0FE","--blue-b":"#BBD3F7","--blue-i":"#164AA8"}},"flowery":{"name":"Flowery","dot":"#F6EAF0","vars":{"--page":"#FBF3F6","--card":"#FFFCFD","--panel":"#FBF0E6","--line":"#EBD9E2","--line-soft":"#EBD9E2","--hair":"#FBF0E6","--ink":"#3A2430","--muted":"#513E47","--faint":"#5F5258","--ghost":"#665A60","--green":"#3E7D53","--green-t":"#E6F4EC","--green-b":"#4C9364","--amber-t":"#F6ECD8","--amber-i":"#6b5a36","--amber-b":"#EED9C2","--red":"#B8465A","--red-t":"#FBECEB","--red-i":"#B8465A","--red-b":"#9A3549","--blue":"#8A4E8F","--blue-t":"#F7EDF7","--blue-b":"#E4CDE6","--blue-i":"#6F3E74"}},"dark":{"name":"Dark","dot":"#161A1F","vars":{"--page":"#14181D","--card":"#1C2128","--panel":"#2A2418","--line":"#2E353E","--line-soft":"#2E353E","--hair":"#2A2418","--ink":"#E6EAEF","--muted":"#D4D9DF","--faint":"#B7BEC6","--ghost":"#ABB3BB","--green":"#2E9E5E","--green-t":"#16281E","--green-b":"#3BB06E","--amber-t":"#2A2418","--amber-i":"#C08F35","--amber-b":"#463A22","--red":"#E15E54","--red-t":"#2E1A18","--red-i":"#E15E54","--red-b":"#C9463D","--blue":"#6892DB","--blue-t":"#1E2A3C","--blue-b":"#31445F","--blue-i":"#7BA2E4"}},"slate":{"name":"Slate","dot":"#1D2A2C","vars":{"--page":"#101418","--card":"#191E24","--panel":"#262117","--line":"#2B323A","--line-soft":"#2B323A","--hair":"#262117","--ink":"#E7EBEF","--muted":"#C9D0D5","--faint":"#AEB6BD","--ghost":"#A4ABB2","--green":"#33A866","--green-t":"#16281E","--green-b":"#3EB673","--amber-t":"#262117","--amber-i":"#C99738","--amber-b":"#423A24","--red":"#E05A50","--red-t":"#2E1A18","--red-i":"#E05A50","--red-b":"#C9463D","--blue":"#2E9E96","--blue-t":"#16292C","--blue-b":"#27453F","--blue-i":"#45B3AB"}},"azure":{"name":"Azure","dot":"#1857B8","vars":{"--page":"#EDF3FB","--card":"#ffffff","--panel":"#FAF2E2","--line":"#CDDCEF","--line-soft":"#CDDCEF","--hair":"#FAF2E2","--ink":"#0D2440","--muted":"#3D454C","--faint":"#4F575F","--ghost":"#585E66","--green":"#1F7A4D","--green-t":"#E6F4EC","--green-b":"#268C5A","--amber-t":"#F6ECD8","--amber-i":"#7A5412","--amber-b":"#E8D6B4","--red":"#B4453F","--red-t":"#FBECEB","--red-i":"#B4453F","--red-b":"#93332E","--blue":"#1857B8","--blue-t":"#E4EDFA","--blue-b":"#BFD4EF","--blue-i":"#11408C"}},"ruby":{"name":"Ruby","dot":"#A81F4A","vars":{"--page":"#FBEFF0","--card":"#FFFAFA","--panel":"#FAF1E4","--line":"#EBD3D7","--line-soft":"#EBD3D7","--hair":"#FAF1E4","--ink":"#33161C","--muted":"#4A3B43","--faint":"#5D4D55","--ghost":"#64555D","--green":"#1F7A4D","--green-t":"#E6F4EC","--green-b":"#268C5A","--amber-t":"#F6ECD8","--amber-i":"#7A5412","--amber-b":"#E6D3B6","--red":"#B4453F","--red-t":"#FBECEB","--red-i":"#B4453F","--red-b":"#93332E","--blue":"#A81F4A","--blue-t":"#F8E6EB","--blue-b":"#E7C2CE","--blue-i":"#84163A"}},"hc":{"name":"High Contrast","dot":"#000000","vars":{"--page":"#FFFFFF","--card":"#FFFFFF","--panel":"#FFFFFF","--line":"#4A5158","--line-soft":"#4A5158","--hair":"#FFFFFF","--ink":"#000000","--muted":"#22272C","--faint":"#34393F","--ghost":"#3C4248","--green":"#0A5A30","--green-t":"#E6F3EB","--green-b":"#0A5A30","--amber-t":"#F6EFDC","--amber-i":"#5A4200","--amber-b":"#4A5158","--red":"#941410","--red-t":"#FBEBEA","--red-i":"#941410","--red-b":"#941410","--blue":"#0B3C8C","--blue-t":"#EAF0FA","--blue-b":"#4A5158","--blue-i":"#082E6D"}},"hcdark":{"name":"High Contrast Dark","dot":"#FFFFFF","vars":{"--page":"#000000","--card":"#000000","--panel":"#14100A","--line":"#B6BEC6","--line-soft":"#B6BEC6","--hair":"#14100A","--ink":"#FFFFFF","--muted":"#EDEFF1","--faint":"#CBCFD4","--ghost":"#BCC1C7","--green":"#6EE39C","--green-t":"#07160D","--green-b":"#6EE39C","--amber-t":"#14100A","--amber-i":"#F5C95A","--amber-b":"#B6BEC6","--red":"#FFA9A0","--red-t":"#1A0908","--red-i":"#FFA9A0","--red-b":"#FFA9A0","--blue":"#8FBEFF","--blue-t":"#0B1520","--blue-b":"#B6BEC6","--blue-i":"#A9CFFF"}},"cvd":{"name":"Colour Vision","dot":"#0072B2","vars":{"--page":"#F7F8F9","--card":"#FFFFFF","--panel":"#FBF3E2","--line":"#767F88","--line-soft":"#767F88","--hair":"#FBF3E2","--ink":"#101418","--muted":"#3F464D","--faint":"#515861","--ghost":"#59616A","--green":"#00674B","--green-t":"#E0EFEA","--green-b":"#00674B","--amber-t":"#F7EFDD","--amber-i":"#8A5F00","--amber-b":"#D8C79E","--red":"#A34700","--red-t":"#F9EAE0","--red-i":"#A34700","--red-b":"#8A3C00","--blue":"#005B8F","--blue-t":"#E4F0F7","--blue-b":"#A9CBDE","--blue-i":"#00476F"}},"calm":{"name":"Calm","dot":"#8A9BA8","vars":{"--page":"#EFEFED","--card":"#F8F8F6","--panel":"#F2EFE6","--line":"#7B7B76","--line-soft":"#7B7B76","--hair":"#F2EFE6","--ink":"#23262A","--muted":"#464B51","--faint":"#565B62","--ghost":"#5C616A","--green":"#3D6B52","--green-t":"#E6EDE9","--green-b":"#3D6B52","--amber-t":"#EFEBE1","--amber-i":"#7A6438","--amber-b":"#D6CDB6","--red":"#8C4A45","--red-t":"#F0E7E6","--red-i":"#8C4A45","--red-b":"#7A3F3A","--blue":"#456179","--blue-t":"#E7ECEF","--blue-b":"#C3CDD4","--blue-i":"#374E61"}},"softpaper":{"name":"Soft Paper","dot":"#F6E8CE","vars":{"--page":"#F7EEDC","--card":"#FCF6E9","--panel":"#F6ECD6","--line":"#877A62","--line-soft":"#877A62","--hair":"#F6ECD6","--ink":"#2E2721","--muted":"#54483C","--faint":"#665A4C","--ghost":"#6D6153","--green":"#3F6B45","--green-t":"#E9F0E8","--green-b":"#3F6B45","--amber-t":"#F5EBD5","--amber-i":"#7E5F1F","--amber-b":"#DCC9A4","--red":"#94413A","--red-t":"#F6E9E5","--red-i":"#94413A","--red-b":"#7E362F","--blue":"#2F5B86","--blue-t":"#E9EFF4","--blue-b":"#C2D2DF","--blue-i":"#24486B"}}};
var APP_THEMES=Object.assign({}, APP_THEMES_RAW, { terminal: {"name":"Terminal","dot":"#03200F","vars":{"--page":"#021A0C","--card":"#03200F","--panel":"#06301A","--line":"#1F6B3D","--line-soft":"#155A31","--hair":"#0B3A20","--ink":"#F2FFF2","--muted":"#B8F5C6","--faint":"#8FE0A3","--ghost":"#6FC888","--green":"#4CFF7A","--green-t":"#0B3A20","--green-b":"#2E9E55","--amber-t":"#2A2A08","--amber-i":"#FFE066","--amber-b":"#8C7A1E","--red":"#FF7A66","--red-t":"#3A120C","--red-i":"#FF9C8A","--red-b":"#8C3A2E","--blue":"#FFD84A","--blue-t":"#2E2A08","--blue-b":"#8C7A1E","--blue-i":"#FFE88A"}} });
var FONTS=[['default','Default',"Inter,system-ui,sans-serif",'the product’s own face'],['grotesk','Grotesk',"'Space Grotesk',Inter,sans-serif",'larger apertures'],
  ['serif','Serif',"Georgia,'Times New Roman',serif",'serifs guide the line'],['wide','Wide',"Verdana,Tahoma,sans-serif",'wide letters, low vision'],
  ['mono','Monospace',"'Space Mono',ui-monospace,monospace",'every letter the same width']];
var TEXT_SIZES=[['s','Small',0.92],['m','Medium',1],['l','Large',1.15],['xl','Extra large',1.32]];
var AP={weight:(store('ap.weight')||'normal'),fs:(store('ap.fs')||'m'),motion:(store('ap.motion')||'auto'),theme:(store('ap.theme')||'device'),font:(store('ap.font')||'default')};
function applyAppearance(){
  var root=document.documentElement, t=APP_THEMES[AP.theme];
  Object.keys(APP_THEMES.cream.vars).forEach(function(k){ root.style.removeProperty(k); });
  if(t) Object.keys(t.vars).forEach(function(k){ root.style.setProperty(k,t.vars[k]); });
  var dark=t&&/^#(0|1|2)/i.test(t.vars['--page']);
  root.style.colorScheme=t?(dark?'dark':'light'):'';
  var fnt=FONTS.filter(function(x){return x[0]===AP.font;})[0];
  if(fnt&&AP.font!=='default') root.style.setProperty('--f-ui',fnt[2]); else root.style.removeProperty('--f-ui');
  ['--f-display','--f-num'].forEach(function(k){ root.style.removeProperty(k); });
  if(AP.theme==='terminal'){ var mono="'IBM Plex Mono','Space Mono',ui-monospace,monospace";
    root.style.setProperty('--f-display',mono); root.style.setProperty('--f-num',mono); if(AP.font==='default') root.style.setProperty('--f-ui',mono); }
  var sz=TEXT_SIZES.filter(function(x){return x[0]===AP.fs;})[0]||TEXT_SIZES[1];
  if(sz[2]===1) root.style.removeProperty('--k'); else root.style.setProperty('--k',String(sz[2]));
  if(AP.motion==='reduce') root.setAttribute('data-motion','reduce'); else root.removeAttribute('data-motion');
  if(AP.weight==='bold') root.setAttribute('data-weight','bold'); else root.removeAttribute('data-weight');
}
function avPop(){
  var sw='<button class="sw" data-ap-theme="device" aria-pressed="'+(AP.theme==='device')+'"><span class="dot"><i style="background:#FCFAF5"></i><i style="background:#15140F"></i></span>My device</button>'+
    Object.keys(APP_THEMES).map(function(k){ var t=APP_THEMES[k];
      return '<button class="sw" data-ap-theme="'+k+'" aria-pressed="'+(AP.theme===k)+'" title="'+esc(t.name)+'"><span class="dot"><i style="background:'+t.vars['--page']+'"></i><i style="background:'+t.vars['--blue']+'"></i></span>'+esc(t.name)+'</button>'; }).join('');
  return '<div class="pop avpop" role="dialog" aria-label="Your menu">'+
    '<div class="avwho"><span class="avatar">C</span><div><b>Chola Auto Care</b><span>Owner · signed in on this device</span></div></div>'+
    '<div class="avitems"><button data-av="profile">Profile <span class="hint">↗ in the app</span></button><button data-av="settings">Settings <span class="hint">↗ owner, in the app only</span></button></div>'+
    '<h4>Appearance · this page and every other</h4><div class="swatches" role="group" aria-label="Theme">'+sw+'</div>'+
    '<h4>Text size</h4><div class="sizes" role="group" aria-label="Text size">'+TEXT_SIZES.map(function(x,i){return '<button data-ap-fs="'+x[0]+'" aria-pressed="'+(AP.fs===x[0])+'" title="'+x[1]+' ('+Math.round(x[2]*100)+'%)" aria-label="'+x[1]+'" style="font-size:'+[13,16,20,25][i]+'px">A</button>';}).join('')+'</div>'+
    '<div class="weights" role="group" aria-label="Text weight"><button data-ap-weight="normal" aria-pressed="'+(AP.weight==='normal')+'" title="Normal" aria-label="Normal text" style="font-weight:400">A</button><button data-ap-weight="bold" aria-pressed="'+(AP.weight==='bold')+'" title="Bold" aria-label="Bold text" style="font-weight:800">A</button></div>'+
    '<div class="motion"><span>Less motion</span><button class="toggle" role="switch" data-ap-motion="1" aria-checked="'+(AP.motion==='reduce')+'" aria-label="Less motion"></button></div>'+
    '<h4>Reading font</h4><div class="fonts" role="group" aria-label="Font">'+FONTS.map(function(x){return '<button data-ap-font="'+x[0]+'" aria-pressed="'+(AP.font===x[0])+'" style="font-family:'+x[2].replace(/"/g,'&quot;')+'"><span>'+x[1]+'</span><span class="hint">'+x[3]+'</span></button>';}).join('')+'</div>'+
    '<div class="avitems" style="border-bottom:0;border-top:1px solid var(--line-soft);margin-top:8px"><button data-av="support">Support</button><button data-av="signout">Sign out <span class="hint">every tab follows</span></button></div></div>';
}


/* Row 2 · the tools row */
function paintTools(){
  var L=cur(), s=st(L), n=rowsOf(L,s).length, fn=Object.keys(s.filt).filter(function(k){return s.filt[k];}).length;
  var h=(PAGE.folded?'<button class="tbtn" id="unfold" aria-label="Show the ledger list">☰ Ledgers</button>':'')+
    '<label class="search"><span aria-hidden="true">🔍</span><input id="q" type="search" placeholder="Search bill, party, amount" value="'+esc(s.q)+'" aria-label="Search this ledger"></label>'+
    '<span class="anchor"><button class="tbtn'+(fn?' on':'')+'" id="filtBtn" aria-haspopup="dialog" aria-expanded="'+(openPop==='filt')+'">Filters ▾'+(fn?' <span class="badge">'+fn+'</span>':'')+'</button>'+(openPop==='filt'?filtPop(L,s):'')+'</span>'+
    '<span class="seg" role="group" aria-label="Group by">'+L.groups.map(function(g){return '<button data-group="'+g[0]+'" aria-pressed="'+(s.group===g[0])+'">'+g[1]+'</button>';}).join('')+'</span>'+
    '<button class="tbtn ico" id="expBtn" title="'+(s.allOpen?'Collapse all':'Expand all')+'" aria-label="'+(s.allOpen?'Collapse all':'Expand all')+'" aria-pressed="'+s.allOpen+'">'+(s.allOpen?'⇡':'⇣')+'</button>'+
    '<span class="seg" role="group" aria-label="View"><button data-view="grid" title="Grid: columns" aria-pressed="'+(s.view==='grid')+'">▤</button><button data-view="lines" title="Lines: one line per record" aria-pressed="'+(s.view==='lines')+'">☰</button></span>'+
    '<span class="anchor"><button class="tbtn ico" id="colBtn" title="Choose columns" aria-label="Choose columns" aria-haspopup="dialog" aria-expanded="'+(openPop==='cols')+'">⚙</button>'+(openPop==='cols'?colsPop(L,s):'')+'</span>'+
    '<button class="tbtn ico" id="csvBtn" title="'+esc(L.actionsWord)+'" aria-label="'+esc(L.actionsWord)+'">⬇</button>'+
    '<span class="count" aria-live="polite">'+n+' shown</span>'+
    '<div class="fchips">'+Object.keys(s.filt).filter(function(k){return s.filt[k];}).map(function(k){
      var f=L.filters.filter(function(x){return x[0]===k;})[0]; return '<span class="fchip">'+esc(f[1])+': '+esc(s.filt[k])+'<button data-unfilt="'+k+'" aria-label="Remove '+esc(f[1])+' filter">×</button></span>';}).join('')+'</div>';
  $('tools').innerHTML=h;
}
function filtPop(L,s){
  return '<div class="pop left" role="dialog" aria-label="Filters"><h4>Filters</h4>'+L.filters.map(function(f){
    return '<label class="f">'+esc(f[1])+'<select data-filt="'+f[0]+'" id="f_'+f[0]+'"><option value="">Any</option>'+f[2].map(function(o){return '<option'+(s.filt[f[0]]===o?' selected':'')+'>'+esc(o)+'</option>';}).join('')+'</select></label>';}).join('')+
    '<div class="acts"><button class="btn" id="clearF">Clear all</button></div></div>';
}
function colsPop(L,s){
  var all=L.columns, top=all.slice().sort(function(a,b){return a.prio-b.prio;})[0].key, shown=s.cols, rest=all.filter(function(c){return shown.indexOf(c.key)<0;});
  function row(c,i,isShown){
    return '<div class="colrow">'+(isShown?'<button class="mv" data-mv="'+c.key+'" data-d="-1" '+(i===0?'disabled':'')+' aria-label="Move '+esc(c.label)+' left">←</button>':'<span class="mvsp"></span>')+
      '<label><input type="checkbox" data-col="'+c.key+'" '+(isShown?'checked':'')+' '+(c.key===top?'disabled':'')+'> '+esc(c.label)+'</label>'+
      (isShown?'<button class="mv" data-mv="'+c.key+'" data-d="1" '+(i===shown.length-1?'disabled':'')+' aria-label="Move '+esc(c.label)+' right">→</button>':'<span class="mvsp"></span>')+'</div>';
  }
  var by={}; all.forEach(function(c){by[c.key]=c;});
  return '<div class="pop" role="dialog" aria-label="Columns"><h4>Shown — in this order</h4>'+shown.filter(function(k){return by[k];}).map(function(k,i){return row(by[k],i,true);}).join('')+
    (rest.length?'<h4>Available</h4>'+rest.map(function(c){return row(c,0,false);}).join(''):'')+
    '<div class="acts"><button class="btn" id="resetCols">Reset to the standard three</button></div></div>';
}

/* Row 3 · the column header + rows */
function paintList(){
  var L=cur(), s=st(L), el=$('list');
  if(pstate==='loading'){ el.innerHTML='<div class="hdr" style="grid-template-columns:'+template(L,s)+'">'+colsOf(L,s).map(function(c){return '<div class="hc">'+esc(c.label)+'</div>';}).join('')+'</div>'+Array(7).join('<div class="skel"></div>'); return; }
  if(pstate==='error'){ el.innerHTML='<div class="state"><div class="big">This ledger could not load.</div>Your entries are safe.<br><button class="btn" id="retry">Try again</button></div>'; return; }
  var rows=rowsOf(L,s);
  if(!rows.length){
    el.innerHTML=!L.rows().length
      ?'<div class="state"><div class="big">Nothing in this period.</div><button class="btn" data-period="fy">Show this FY</button></div>'
      :'<div class="state"><div class="big">No entry matches.</div>'+esc(s.q?'“'+s.q+'”':'These filters')+' match nothing in this period.<br><button class="btn" id="clearAll">Clear search and filters</button></div>';
    return; }
  var cols=colsOf(L,s), tpl=template(L,s), h='', shownKeys=s.cols.slice(), isF=filtered(L,s);
  if(s.view==='grid'){
    h+='<div class="grid"><div class="hdr" id="hdr" role="row" style="grid-template-columns:'+tpl+'">'+cols.map(function(c){
      var isAmt=c===L.amount, sorted=s.sort&&s.sort.key===c.key;
      return '<div class="hc'+(isAmt||c.num?' r':'')+'" role="columnheader" aria-sort="'+(sorted?(s.sort.dir>0?'ascending':'descending'):'none')+'">'+
        (c.sort||isAmt?'<button class="sort" data-sort="'+c.key+'">'+esc(c.label)+' <span class="arrow">'+(sorted?(s.sort.dir>0?'▲':'▼'):'⇅')+'</span></button>':esc(c.label))+
        '<button class="rz" data-rz="'+c.key+'" aria-label="Resize '+esc(c.label)+' column (arrow keys)" title="Drag to resize · double-click resets"></button></div>';}).join('')+'</div>';
  }
  var last=null, party=PAGE.sel.k==='P'?D.parties[PAGE.sel.id]:null, agreedDone=!party||!party.agreedTo||isF||!s.sort||s.sort.key!=='date';
  function marker(){ return '<div class="agreed" role="row"><span aria-hidden="true">✓</span>Agreed up to '+esc(dfmt(day(party.agreedTo),{day:'numeric',month:'short',year:'numeric'}))+'</div>'; }
  rows.forEach(function(x,idx){
    if(!agreedDone){                                                   /* the agreement marker sits between the last agreed entry and the next */
      var before=x.e.date<=party.agreedTo;
      if(s.sort.dir<0&&before){ h+=marker(); agreedDone=true; }
      if(s.sort.dir>0&&!before&&idx>0){ h+=marker(); agreedDone=true; }
    }
    var g=groupKey(L,s,x);
    if(g&&g[1]!==last){ last=g[1];
      var f=isF?null:L.groupFig(g[2],g[1]), fig;
      if(f) fig=f.n+' entr'+(f.n===1?'y':'ies')+(f.dr?' · '+rs(f.dr)+' Dr':'')+(f.cr?' · '+rs(f.cr)+' Cr':'');
      else { var c=rows.filter(function(y){var k=groupKey(L,s,y);return k&&k[1]===g[1];}).length; fig=c+' shown'; }
      h+='<div class="group" role="row"><b>'+esc(g[0])+'</b><span class="fig">'+fig+'</span></div>'; }
    var open=s.allOpen?!s.open[x.id+'#closed']:!!s.open[x.id];
    if(s.view==='grid'){
      h+='<div class="grow'+(open?' open':'')+'" role="row" data-row="'+x.id+'" tabindex="0" aria-expanded="'+open+'" style="grid-template-columns:'+tpl+'">'+cols.map(function(c,i){
        var v=c.cell(x), isAmt=c===L.amount;
        return '<div class="cell'+(i===0?' first':'')+(isAmt?' r mono strong amt':'')+(c.num?' r mono':'')+(c.mono?' mono':'')+'" data-l="'+esc(i===0||isAmt?'':c.label)+'" role="cell">'+
          (i===0?'<span class="tw" aria-hidden="true">▸</span>':'')+(c.html?v:esc(v))+'</div>';}).join('')+'</div>';
    } else {
      h+='<div class="lrec'+(open?' open':'')+'" role="row" data-row="'+x.id+'" tabindex="0" aria-expanded="'+open+'"><div class="lline"><span class="tw" aria-hidden="true">▸</span><span class="lflow">'+
        cols.filter(function(c){return c!==L.amount;}).map(function(c){var v=c.cell(x);return '<span>'+(c.html?v:esc(v))+'</span>';}).join('')+'</span>'+
        (L.amount?'<span class="lamt">'+esc(L.amount.cell(x))+'</span>':'')+'</div>'+(L.gist&&L.gist(x)?'<div class="lgist">'+esc(L.gist(x))+'</div>':'')+'</div>';
    }
    if(open) h+='<div class="next" role="row">'+L.next(x,shownKeys)+'</div>';
  });
  if(!agreedDone&&s.sort.dir>0) h+=marker();
  if(s.view==='grid') h+='</div>';
  h+='<div class="state" style="padding:14px;font:12px var(--f-num)">'+rows.length+' shown · end of list</div>';
  el.innerHTML=h;
  var hdr=$('hdr'); document.documentElement.style.setProperty('--hdr-h',hdr?hdr.offsetHeight+'px':'0px');
}

/* ═════ THE LEDGER TREE — the second pane (new) ═════
   band → group → ledger → party. One line per node where the words allow; when a name is long it WRAPS (never clipped);
   the amount column is one fixed width so every figure lines up; the open ledger shows no figure here because the title
   row already shows it (rule 3). Codes stay out unless you type one. */
function tOpen(id,def){ return PAGE.tOpen[id]==null?def:PAGE.tOpen[id]; }
function tSet(id,v){ PAGE.tOpen[id]=v; store('ledger.treeOpen',PAGE.tOpen); }
function treeNodes(){
  var q=PAGE.tq.trim().toLowerCase(), out=[], per=PAGE.period;
  function hit(str){ return !q||str.toLowerCase().indexOf(q)>=0; }
  D.bands.forEach(function(b){
    var bandKids=[];
    b.groups.forEach(function(g){
      var gKids=[];
      g.ledgers.forEach(function(code){
        var L=D.ledgers[code], ps=(L.parties||[]).filter(function(p){ return hit(D.parties[p].name)||hit(D.parties[p].short); });
        var selfHit=hit(L.short)||hit(L.name)||(q&&code.indexOf(q)===0);
        if(!selfHit&&!ps.length) return;
        var kids=(selfHit&&!q?(L.parties||[]):ps).map(function(p){ var P=D.parties[p];
          return {t:'party',id:'P'+p,sel:{k:'P',id:p},name:P.short||P.name,fig:P.fig[per].close,ok:!!P.agreedTo}; });
        gKids.push({t:'ledger',id:'L'+code,sel:{k:'L',id:code},name:L.short,fig:L.fig[per].close,kids:kids,code:code});
      });
      if(!gKids.length) return;
      if(g.id) bandKids.push({t:'grp',id:'G'+g.id,name:g.name,count:gKids.length,kids:gKids});
      else bandKids=bandKids.concat(gKids);
    });
    if(bandKids.length) out.push({t:'band',id:'B'+b.id,name:b.name,kids:bandKids});
  });
  return out;
}
function paintTree(){
  var nodes=treeNodes(), q=PAGE.tq.trim(), h='', selId=(PAGE.sel.k==='P'?'P':'L')+PAGE.sel.id;
  /* the control account holding the open party stays open */
  if(PAGE.sel.k==='P') tSet('L'+D.parties[PAGE.sel.id].ledger, true);
  function nm(s){ if(!q) return esc(s); var i=s.toLowerCase().indexOf(q.toLowerCase()); if(i<0) return esc(s);
    return esc(s.slice(0,i))+'<mark>'+esc(s.slice(i,i+q.length))+'</mark>'+esc(s.slice(i+q.length)); }
  function walk(n,lvl){
    var kids=n.kids&&n.kids.length, open=q?true:tOpen(n.id,n.t==='ledger'?false:true), sel=n.id===selId, right='';
    if(n.t==='band'||n.t==='grp') right='<span class="am">'+(n.count!=null?n.count:'')+'</span>';
    else if(sel&&!(isPhone()&&PAGE.view==='tree')) right='<span class="am"></span>';  /* the title row beside it already shows this figure */
    else right='<span class="am'+(n.fig&&n.fig[0]?'':' nil')+'">'+(n.ok?'<span class="ck" aria-label="agreed">✓</span>':'')+(n.fig&&n.fig[0]?esc(money(n.fig)):'—')+'</span>';
    h+='<button class="tn '+n.t+'" role="treeitem" data-tn="'+n.id+'" aria-level="'+(lvl+1)+'"'+(kids?' aria-expanded="'+open+'"':'')+
      (n.sel?' aria-selected="'+sel+'"':'')+' tabindex="-1" style="--lvl:'+lvl+'">'+
      '<span class="tw" aria-hidden="true">'+(kids?(open?'▾':'▸'):'')+'</span><span class="nm">'+nm(n.name)+'</span>'+right+'</button>';
    if(kids&&open) n.kids.forEach(function(k){ walk(k,lvl+1); });
  }
  nodes.forEach(function(n){ walk(n,0); });
  $('treeList').innerHTML=h||'<div class="tree-empty">No ledger or party called “'+esc(q)+'”.<br><button class="btn" id="tClear">Clear</button></div>';
  /* roving focus: one tab stop in the tree */
  var all=[].slice.call(document.querySelectorAll('.tn')), f=document.querySelector('.tn[aria-selected="true"]')||all[0]; if(f) f.tabIndex=0;
}

/* ═════ THE KURAL FOOTER — one band at the foot of every page, every size (proposed decision, see README) ═════
   The open ledger's kural (the tree page on a phone carries the page's own). Wide: verse and meaning side by side. Narrower:
   the meaning below. Phone: they take turns in one place every 7 s, tap to switch, never with Less motion. ✕ hides it until
   tomorrow; it comes back as one small line. The Tamil verse always shows; the setting only swaps which line leads.
   Outside the head, so the 20% / 30% rule is untouched. Tokens only, so it is right in all 16 themes. */
var TODAY=D.today;
var KUR={ showSecond: URLP.get('ksecond')==='1', paused:false, timer:null, lang: URLP.get('klang') || store('kural.lang') || 'ta', hiddenOn: URLP.get('khide')==='1'?TODAY:(store('kural.hidden')||'') };
function kHidden(){ return KUR.hiddenOn===TODAY; }
function kuralFor(){ var no=(isPhone()&&PAGE.view==='tree')? D.kural.page : selLedger().kural; return D.kural.verses[no]; }
function paintKural(){
  var bar=$('kbar'), k=kuralFor(); clearInterval(KUR.timer);
  if(kHidden()){ bar.className='kbar off'; bar.innerHTML='<button class="kshow" data-kshow="1" aria-label="Show the kural">குறள் '+k.no+' ›</button>'; return; }
  var verse='<span class="kv" lang="ta">'+kline(k.ta[0])+kline(k.ta[1])+'</span>', mean='<span class="km">'+esc(k.en)+'</span>';
  bar.className='kbar k-'+KUR.lang+(KUR.showSecond?' second':'');
  bar.innerHTML='<svg class="kseal" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="29" fill="none" stroke="currentColor" stroke-width="2.5"/><ellipse cx="32" cy="13" rx="4.4" ry="3.6"/><circle cx="32" cy="22" r="6.4"/><path d="M25.8 23.5Q26 33 32 38.5Q38 33 38.2 23.5Q32 27 25.8 23.5Z"/><path d="M15.5 54Q16.5 41 26 36.8L32 40L38 36.8Q47.5 41 48.5 54Z"/></svg>'+
    '<button class="kbody" data-kswap="1" aria-label="Thirukkural '+k.no+'. Tap to switch Tamil and English">'+(KUR.lang==='ta'?verse+mean:mean+verse)+'</button>'+
    '<span class="kno">குறள் '+k.no+'</span>'+
    '<button class="kx" data-khide="1" aria-label="Hide the kural for today" title="Hide for today">✕</button>';
  /* phone: the two lines take turns in one place; never with Less motion */
  var still=AP.motion==='reduce'||(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches);
  if(isPhone()&&!still&&!KUR.paused) KUR.timer=setInterval(function(){ KUR.showSecond=!KUR.showSecond; bar.classList.toggle('second',KUR.showSecond); },7000);
}
/* a line too long for its space breaks only at its middle, the rest indented */
function kline(s){ var w=s.split(' '), m=Math.ceil(w.length/2);
  return '<span class="ln"><span class="h">'+esc(w.slice(0,m).join(' '))+'</span> <span class="h">'+esc(w.slice(m).join(' '))+'</span></span>'; }

/* ═════ paint ═════ */
function isPhone(){ return $('app').clientWidth<=640; }
function paint(){
  var shell=$('app');
  shell.classList.toggle('folded',PAGE.folded);
  shell.classList.toggle('view-tree',PAGE.view==='tree'); shell.classList.toggle('view-ledger',PAGE.view!=='tree');
  document.documentElement.style.setProperty('--tree-w',PAGE.treeW+'px');
  paintTitle(); paintTree(); paintTools(); paintList(); paintKural();
}
var tt; function toast(t){ var e=$('toast'); e.textContent=t; e.hidden=false; clearTimeout(tt); tt=setTimeout(function(){e.hidden=true;},2600); }

/* ═════ behaviour ═════ */
function select(sel){ PAGE.sel=sel; store('ledger.sel',sel); PAGE.view='ledger'; openPop=null;
  var s=st(cur()); s.open={}; s.filt={}; s.q=''; s.allOpen=false; paint(); $('list').scrollTop=0; }
document.addEventListener('click',function(ev){
  var t=ev.target.closest('button,[data-row],.group'); var L=cur(), s=st(L);
  if(!t){ if(openPop&&!ev.target.closest('.pop')){openPop=null;paint();} return; }
  if(t.closest('.pop')&&!t.matches('button')) return;
  var d=t.dataset;
  if(d.tn){ var n=d.tn, kind=t.classList.contains('band')||t.classList.contains('grp')?'fold':'sel';
    if(kind==='fold'){ tSet(n,!tOpen(n,true)); paintTree(); focusTn(n); return; }
    if(ev.target.closest('.tw')&&t.getAttribute('aria-expanded')!=null){ tSet(n,!tOpen(n,false)); paintTree(); focusTn(n); return; }
    if(n[0]==='L'&&t.getAttribute('aria-expanded')==='false') tSet(n,true);
    select(n[0]==='P'?{k:'P',id:n.slice(1)}:{k:'L',id:n.slice(1)}); focusTn(n); return; }
  if(d.kswap){ KUR.paused=true; KUR.showSecond=!KUR.showSecond; $('kbar').classList.toggle('second',KUR.showSecond); clearInterval(KUR.timer); return; }
  if(d.khide){ KUR.hiddenOn=TODAY; store('kural.hidden',TODAY); paint(); toast('Kural hidden until tomorrow'); var s2=document.querySelector('[data-kshow]'); s2&&s2.focus(); return; }
  if(d.kshow){ KUR.hiddenOn=''; store('kural.hidden',''); paint(); return; }
  if(t.id==='tClear'){ PAGE.tq=''; $('tq').value=''; paintTree(); return; }
  if(t.id==='backBtn'){ PAGE.view='tree'; openPop=null; paint(); var f=document.querySelector('.tn[aria-selected="true"]'); f&&f.focus(); return; }
  if(t.id==='foldTree'){ PAGE.folded=true; store('ledger.folded',true); paint(); $('unfold')&&$('unfold').focus(); return; }
  if(t.id==='unfold'){ PAGE.folded=false; store('ledger.folded',false); paint(); $('tq').focus(); return; }
  if(t.id==='avBtn'){ openPop=openPop==='av'?null:'av'; paint(); return; }
  if(d.apTheme){ AP.theme=d.apTheme; store('ap.theme',AP.theme); applyAppearance(); paint(); toast((APP_THEMES[AP.theme]?APP_THEMES[AP.theme].name:'Your device’s light or dark')+': every page now opens in it'); return; }
  if(d.apFs){ AP.fs=d.apFs; store('ap.fs',AP.fs); applyAppearance(); paint(); var z=TEXT_SIZES.filter(function(x){return x[0]===AP.fs;})[0]; toast('Text: '+z[1]+', '+Math.round(z[2]*100)+'% on every page'); return; }
  if(d.apWeight){ AP.weight=d.apWeight; store('ap.weight',AP.weight); applyAppearance(); paint(); return; }
  if(d.apMotion){ AP.motion=AP.motion==='reduce'?'auto':'reduce'; store('ap.motion',AP.motion); applyAppearance(); paint(); return; }
  if(d.apFont){ AP.font=d.apFont; store('ap.font',AP.font); applyAppearance(); paint(); return; }
  if(d.av){ toast({profile:'Opens Profile in the app',settings:'Settings stay in the app (owner only)',support:'Opens Support',signout:'In the product: signed out here and in every other tab'}[d.av]); return; }
  if(t.id==='periodBtn'){ openPop=openPop==='period'?null:'period'; paint(); return; }
  if(t.id==='filtBtn'){ openPop=openPop==='filt'?null:'filt'; paint(); return; }
  if(t.id==='colBtn'){ openPop=openPop==='cols'?null:'cols'; paint(); return; }
  if(d.period){ PAGE.period=d.period; if(d.period!=='custom') openPop=null; s.open={}; paint(); toast('Showing '+(PERIODS.filter(function(p){return p[0]===d.period;})[0][1]).toLowerCase()); return; }
  if(d.notice!=null){ var nt=L.notices[+d.notice]; nt.run(s); paint(); toast(nt.say); return; }
  if(d.group){ s.group=d.group; save(L); paint(); return; }
  if(d.view){ s.view=d.view; save(L); paint(); return; }
  if(t.id==='expBtn'){ s.allOpen=!s.allOpen; s.open={}; paint(); return; }
  if(t.id==='csvBtn'){ toast('In the product this downloads '+rowsOf(L,s).length+' rows as CSV'); return; }
  if(d.unfilt){ delete s.filt[d.unfilt]; paint(); return; }
  if(t.id==='clearF'||t.id==='clearAll'){ s.filt={}; s.q=''; openPop=null; paint(); return; }
  if(t.id==='retry'){ pstate='loading'; paint(); setTimeout(function(){pstate='normal';paint();},700); return; }
  if(d.mv){ var i=s.cols.indexOf(d.mv), j=i+(+d.d); if(j<0||j>=s.cols.length) return; s.cols.splice(i,1); s.cols.splice(j,0,d.mv); save(L); paint(); return; }
  if(t.id==='resetCols'){ s.cols=L.defaultCols.slice(); s.widths={}; save(L); paint(); return; }
  if(d.sort){ s.sort=s.sort&&s.sort.key===d.sort?{key:d.sort,dir:-s.sort.dir}:{key:d.sort,dir:1}; save(L); paint(); return; }
  if(d.act){ toast({home:'Opens the CB Accounts To do home',bill:'Opens the bill in the one detail page',entry:'Opens the entry in the one detail page',reverse:'Starts ＋ Entry with this entry reversed, for you to check'}[d.act]); return; }
  if(d.rz) return;
  if(t.classList.contains('group')) return;
  var row=ev.target.closest('[data-row]'); if(row&&!ev.target.closest('.link')){ toggleRow(row.dataset.row); return; }
  if(ev.target.closest('.link')){ toast('Opens the bill in the one detail page'); }
});
function focusTn(id){ var b=document.querySelector('[data-tn="'+id+'"]'); if(b){ document.querySelectorAll('.tn').forEach(function(x){x.tabIndex=-1;}); b.tabIndex=0; b.focus(); } }
function toggleRow(id){ var s=st(cur()); if(s.allOpen) s.open[id+'#closed']=!s.open[id+'#closed']; else s.open[id]=!s.open[id]; paintList(); }
document.addEventListener('change',function(ev){
  var t=ev.target, L=cur(), s=st(L);
  if(t.dataset.col){ var k=t.dataset.col; if(t.checked) s.cols.push(k); else s.cols=s.cols.filter(function(x){return x!==k;}); save(L); paint(); return; }
  if(t.dataset.filt){ s.filt[t.dataset.filt]=t.value||undefined; paintTools(); paintList(); $('f_'+t.dataset.filt)&&$('f_'+t.dataset.filt).focus(); }
});
document.addEventListener('input',function(ev){
  if(ev.target.id==='q'){ var L=cur(), s=st(L); s.q=ev.target.value; paintList(); var c=document.querySelector('.count'); if(c) c.textContent=rowsOf(L,s).length+' shown'; }
  if(ev.target.id==='tq'){ PAGE.tq=ev.target.value; paintTree(); }
});
document.addEventListener('keydown',function(ev){
  var t=ev.target;
  if(ev.key==='Escape'&&openPop){ openPop=null; paint(); return; }
  if(ev.key==='Escape'&&t.id==='tq'&&PAGE.tq){ PAGE.tq=''; t.value=''; paintTree(); return; }
  if(t.id==='tq'&&ev.key==='ArrowDown'){ ev.preventDefault(); var f=document.querySelector('.tn'); f&&focusTn(f.dataset.tn); return; }
  if(t.dataset&&t.dataset.tn){                                         /* the tree: ↑ ↓ move · → open / step in · ← close / step out · Enter opens */
    var all=[].slice.call(document.querySelectorAll('.tn')), i=all.indexOf(t), exp=t.getAttribute('aria-expanded'), lvl=+t.getAttribute('aria-level');
    if(ev.key==='ArrowDown'||ev.key==='ArrowUp'){ ev.preventDefault(); var nx=all[i+(ev.key==='ArrowDown'?1:-1)]; nx&&focusTn(nx.dataset.tn); return; }
    if(ev.key==='ArrowRight'){ ev.preventDefault(); if(exp==='false'){ tSet(t.dataset.tn,true); paintTree(); focusTn(t.dataset.tn); } else if(exp==='true'&&all[i+1]) focusTn(all[i+1].dataset.tn); return; }
    if(ev.key==='ArrowLeft'){ ev.preventDefault(); if(exp==='true'){ tSet(t.dataset.tn,false); paintTree(); focusTn(t.dataset.tn); }
      else { for(var j=i-1;j>=0;j--){ if(+all[j].getAttribute('aria-level')<lvl){ focusTn(all[j].dataset.tn); break; } } } return; }
    if(ev.key==='Home'){ ev.preventDefault(); focusTn(all[0].dataset.tn); return; }
    if(ev.key==='End'){ ev.preventDefault(); focusTn(all[all.length-1].dataset.tn); return; }
  }
  if(t.dataset&&t.dataset.rz&&(ev.key==='ArrowLeft'||ev.key==='ArrowRight')){ ev.preventDefault(); resize(t.dataset.rz,ev.key==='ArrowRight'?8:-8); var b=document.querySelector('[data-rz="'+t.dataset.rz+'"]'); b&&b.focus(); return; }
  if(t.id==='paneRz'&&(ev.key==='ArrowLeft'||ev.key==='ArrowRight')){ ev.preventDefault(); setTreeW(PAGE.treeW+(ev.key==='ArrowRight'?16:-16)); return; }
  if(t.dataset&&t.dataset.row&&(ev.key==='Enter'||ev.key===' ')){ ev.preventDefault(); toggleRow(t.dataset.row); var n=document.querySelector('[data-row="'+t.dataset.row+'"]'); n&&n.focus(); return; }
  if(t.dataset&&t.dataset.row&&(ev.key==='ArrowDown'||ev.key==='ArrowUp')){ ev.preventDefault(); var rs_=[].slice.call(document.querySelectorAll('[data-row]')), k=rs_.indexOf(t), nn=rs_[k+(ev.key==='ArrowDown'?1:-1)]; nn&&nn.focus(); }
});
/* adjustable columns (the standard's): drag, arrows, double-click resets; never narrower than the label */
function minW(c){ return Math.max(64, c.label.length*9+40); }
function resize(key,delta){ var L=cur(), s=st(L), c=L.columns.concat(L.amount||[]).filter(function(x){return x.key===key;})[0]; if(!c) return;
  s.widths[key]=Math.max(minW(c),(s.widths[key]||c.w)+delta); save(L); paintList(); }
/* the tree pane's width: drag its edge or use ← →; remembered */
function setTreeW(w){ PAGE.treeW=Math.max(240,Math.min(520,w)); store('ledger.treeW',PAGE.treeW); document.documentElement.style.setProperty('--tree-w',PAGE.treeW+'px'); }
var drag=null;
document.addEventListener('pointerdown',function(ev){
  if(ev.target.id==='paneRz'){ ev.preventDefault(); drag={pane:true,x:ev.clientX,w:PAGE.treeW}; ev.target.classList.add('drag'); return; }
  var b=ev.target.closest('[data-rz]'); if(!b) return; ev.preventDefault();
  var L=cur(), s=st(L), c=L.columns.concat(L.amount||[]).filter(function(x){return x.key===b.dataset.rz;})[0];
  drag={key:b.dataset.rz,x:ev.clientX,w:s.widths[c.key]||c.w,c:c}; b.classList.add('drag'); });
document.addEventListener('pointermove',function(ev){ if(!drag) return;
  if(drag.pane){ setTreeW(drag.w+(ev.clientX-drag.x)); return; }
  var L=cur(), s=st(L); s.widths[drag.key]=Math.max(minW(drag.c),drag.w+(ev.clientX-drag.x));
  var tpl=template(L,s); document.querySelectorAll('.hdr,.grow').forEach(function(e){e.style.gridTemplateColumns=tpl;}); });
document.addEventListener('pointerup',function(){ if(!drag) return; var p=drag.pane; drag=null; document.querySelectorAll('.drag').forEach(function(e){e.classList.remove('drag');});
  if(!p){ save(cur()); paintList(); } });
document.addEventListener('dblclick',function(ev){ var b=ev.target.closest('[data-rz]'); if(!b) return; var L=cur(), s=st(L); delete s.widths[b.dataset.rz]; save(L); paintList(); });
var lastPhone=null, lastW=0; window.addEventListener('resize',function(){ var p=isPhone(), w=window.innerWidth; if(p!==lastPhone||Math.abs(w-lastW)>24){ lastPhone=p; lastW=w; paint(); } else { } });

/* ═════ start ═════ */
if(URLP.get('theme')){ AP.theme=URLP.get('theme'); }
if(URLP.get('tfold')==='1'){ PAGE.tOpen={Bhold:false,Bpl:false,Bcapital:false}; }
applyAppearance();
lastPhone=isPhone(); paint(); if(PAGE.tq) $('tq').value=PAGE.tq;
})();
