/* Standards — ChitBridge · CB (2026-10-03). Built on the frozen list standard (docs/design/list-standard, SYSTEM.md §3a).
   • The table is a CBList declaration (STANDARDS_LIST below); its shell here is the standard's. In the product: a CBList mount.
   • The avatar is CBAvatar, copied unchanged. The kural footer is the proposed CBKural (see the Ledgers handoff).
   • New on this page: the matrix pane (count by Area · Country · Kind × In force · Partly · Planned), whose cells ARE the
     list's filters (one value, one control), and the Standards door for the index page.
   • Honesty is the point: every Partly and Planned row says what is missing IN the row, not one tap away. */
(function(){
'use strict';
var D=window.STD_PAGE, SHOP=D.shop;
function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
/* the register's own prose carries <b> and <code>; keep exactly those, escape everything else */
function rich(s){ return esc(String(s==null?'':s).replace(/⭐\s*/g,'').replace(/⚠️\s*/g,'')).replace(/&lt;(\/?)(b|code)&gt;/g,'<$1$2>'); }
function plain(s){ return String(s==null?'':s).replace(/<[^>]+>/g,''); }
function store(k,v){ try{ if(v===undefined){ var x=localStorage.getItem('cblist.'+k); return x?JSON.parse(x):null; } localStorage.setItem('cblist.'+k,JSON.stringify(v)); }catch(_){ return null; } }
var $=function(id){return document.getElementById(id);};
var URLP=new URLSearchParams(location.search);
function lab(list,id){ for(var i=0;i<list.length;i++) if(list[i][0]===id) return list[i]; return [id,id,'']; }
var AREA=function(r){return lab(D.areas,r.a)[1];}, KIND=function(r){return lab(D.kinds,r.k)[1];};
var COUNTRY=function(r){return r.c.map(function(c){return lab(D.countries,c)[1];}).join(' · ');};
var STATUS=function(r){return lab(D.statuses,r.s)[1];}, SORD={live:0,part:1,plan:2};

var PAGE={ dim: URLP.get('dim')||store('std.dim')||'area', view: URLP.get('view')|| (URLP.get('f')?'list':'matrix'), sheet: URLP.get('sheet')||null, door: URLP.get('door')==='1' };

/* ═════ THE DECLARATION — what this page tells CBList ═════ */
function STANDARDS_LIST(){
  return {
    title:'Standards', key:'standards', view:'grid', defaultCols:['what','std','where'],
    columns:[
      {key:'what',label:'What it does for you',prio:1,w:250,sort:true,html:true,cell:function(r){
        return esc(r.p)+(r.m?'<span class="miss"><b>Missing:</b> '+esc(r.m)+'</span>':r.limit?'<span class="lim"><b>Limit:</b> '+esc(r.limit)+'</span>':''); }},
      {key:'std',label:'Reference',prio:2,w:230,sort:true,html:true,cell:function(r){ return '<span class="sn">'+esc(r.n)+'</span> <span class="kind k-'+r.k+'">'+esc(KIND(r))+'</span>'; }},
      {key:'where',label:'Applies in',prio:3,w:120,sort:true,cell:COUNTRY},
      {key:'area',label:'Area',prio:4,w:150,sort:true,cell:AREA},
      {key:'at',label:'Where in the app',prio:5,w:220,cell:function(r){return r.at;}},
      {key:'ex',label:'Clause or example',prio:6,w:230,mono:true,cell:function(r){return plain(r.ex);}}],
    amount:{key:'status',label:'Status',w:120,html:true,cell:function(r){ var s=lab(D.statuses,r.s); return '<span class="st st-'+r.s+'"><span aria-hidden="true">'+s[2]+'</span> '+s[1]+'</span>'; }},
    groups:[['area','Area'],['country','Country'],['kind','Kind'],['none','None']], group:'area',
    defaultSort:{key:'status',dir:1},
    filters:[['status','Status',D.statuses.map(function(s){return s[1];})],['area','Area',D.areas.map(function(a){return a[1];})],
             ['kind','Kind',D.kinds.map(function(k){return k[1];})],['country','Applies in',D.countries.map(function(c){return c[1];})]],
    rows:function(){ return ROWS; },
    search:function(x){ var r=x.r; return [r.p,r.n,r.w,r.m,r.limit,r.note,r.at,plain(r.ex),r.eq,AREA(r),KIND(r),COUNTRY(r),STATUS(r),r.g].join(' '); },
    gist:function(x){ return x.r.w; },
    next:nextOf, actionsWord:'Download CSV'
  };
}
var ROWS=D.rows.map(function(r){ return {id:r.id,r:r,what:r.p,std:r.n,where:COUNTRY(r),area:AREA(r),status:SORD[r.s],kind:KIND(r),
  statusF:STATUS(r),areaF:AREA(r),kindF:KIND(r),countryF:r.c.map(function(c){return lab(D.countries,c)[1];})}; });
function matches(x,f,v){ if(f==='country') return x.countryF.indexOf(v)>=0; return x[f+'F']===v; }

/* what a row opens to: everything a buyer or CA checks, nothing the row already shows */
function nextOf(x,shown){
  var r=x.r, k=lab(D.kinds,r.k), h='<dl class="sd">';
  h+='<dt>Covers</dt><dd>'+esc(r.w)+'</dd>';
  if(shown.indexOf('std')<0) h+='<dt>Reference</dt><dd>'+esc(r.n)+'</dd>';
  h+='<dt>Kind</dt><dd><span class="kind k-'+r.k+'">'+esc(k[1])+'</span> '+esc(k[2])+'</dd>';
  if(r.ex&&plain(r.ex)!=='—'&&shown.indexOf('ex')<0) h+='<dt>Clause or example</dt><dd><code class="ex">'+esc(plain(r.ex))+'</code>'+(r.exWhy?'<div class="exw">'+rich(r.exWhy)+'</div>':'')+'</dd>';
  if(r.note) h+='<dt>'+(r.s==='live'?'Note':'What is missing, in full')+'</dt><dd>'+rich(r.note)+'</dd>';
  if(r.eq) h+='<dt>Elsewhere</dt><dd>'+esc(r.eq)+'</dd>';
  if(shown.indexOf('at')<0) h+='<dt>In the app</dt><dd>'+esc(r.at)+'</dd>';
  if(r.why) h+='<dt>Why it matters</dt><dd>'+rich(r.why.replace(/^⭐\s*/,''))+'</dd>';
  h+='<dt>Source</dt><dd>'+(r.src==='register'?'In the register':'<span class="new">New</span> Adopted 2–3 Oct 2026; not yet in the register')+'</dd></dl>';
  h+='<div class="acts">'+(r.go?'<button class="btn" data-act="go">Open in the app ›</button>':'')+'<button class="btn" data-act="copy">Copy for a buyer or CA</button></div>';
  return h;
}

/* ═════ CBList: the shell (the standard's) ═════ */
var S={}, openPop=null, pstate=URLP.get('state')||'normal';
function cur(){ return STANDARDS_LIST(); }
function st(L){ if(!S[L.key]){ var sv=store(L.key)||{};
  S[L.key]={cols:sv.cols||L.defaultCols.slice(),widths:sv.widths||{},view:sv.view||L.view,group:URLP.get('group')||sv.group||L.group,sort:sv.sort||L.defaultSort,filt:{},q:URLP.get('q')||'',open:{},allOpen:false}; }
  return S[L.key]; }
function save(L){ var s=st(L); store(L.key,{cols:s.cols,widths:s.widths,view:s.view,group:s.group,sort:s.sort}); }
function colsOf(L,s){ var by={}; L.columns.forEach(function(c){by[c.key]=c;}); return s.cols.map(function(k){return by[k];}).filter(Boolean).concat([L.amount]); }
function widthOf(L,s,c){ return s.widths[c.key]||c.w; }
function template(L,s){ var cs=colsOf(L,s); return cs.map(function(c){ var w=widthOf(L,s,c); return c.key==='what'||(c.key===cs[0].key&&cs.every(function(x){return x.key!=='what';}))?'minmax('+w+'px,1fr)':w+'px'; }).join(' '); }
function isFiltered(s){ return Object.keys(s.filt).some(function(k){return s.filt[k];})||!!s.q.trim(); }
function rowsOf(L,s){
  var rows=L.rows().slice(), q=s.q.trim().toLowerCase();
  if(q) rows=rows.filter(function(x){return L.search(x).toLowerCase().indexOf(q)>=0;});
  Object.keys(s.filt).forEach(function(f){ var v=s.filt[f]; if(v) rows=rows.filter(function(x){return matches(x,f,v);}); });
  if(s.sort){ var c=s.sort.key, dir=s.sort.dir; rows.sort(function(a,b){ var A=a[c],B=b[c]; if(A===B){A=a.what;B=b.what;} return (A>B?1:A<B?-1:0)*dir; }); }
  return rows;
}
function groupKey(s,x){
  if(s.group==='area') return [x.area,'a'+lab(D.areas.map(function(a,i){return [a[0],i];}),x.r.a)[1]];
  if(s.group==='kind') return [x.kind,'k'+x.r.k];
  if(s.group==='country'){ var c=x.r.c.indexOf('IN')>=0&&x.r.c.length===1?'India':x.r.c.length>1?'India and global':'Global'; return [c,'c'+c]; }
  return null;
}
function groupOrder(s,rows){                                   /* rows arrive grouped: group order, then the chosen sort */
  if(s.group==='none') return rows;
  var order={}; D.areas.forEach(function(a,i){order['a'+a[0]]=i;}); D.kinds.forEach(function(k,i){order['k'+k[0]]=i;});
  order['cIndia']=0; order['cIndia and global']=1; order['cGlobal']=2;
  return rows.map(function(x,i){ var g=groupKey(s,x); return [order[s.group==='area'?'a'+x.r.a:g[1]],i,x]; }).sort(function(a,b){return a[0]-b[0]||a[1]-b[1];}).map(function(t){return t[2];});
}

/* Row 1 · the title row: title · the honest count · as of · shop · Home · avatar. No period chip: a standard is not dated. */
function isPhone(){ return $('app').clientWidth<=640; }
function counts(rows){ var n={live:0,part:0,plan:0}; rows.forEach(function(r){n[r.s]++;}); return n; }
function paintTitle(){
  var phoneMx=isPhone()&&PAGE.view==='matrix', n=counts(D.rows);
  var h='<button class="btn back" id="backBtn" aria-label="Back to the matrix">‹</button><h1>Standards</h1>';
  /* the counts live in the matrix's All row; saying them here too would be the same figures twice (rule 3) */
  h+='<span class="figs"><span class="asof">checked '+esc(D.asOfLabel)+'</span></span>';
  h+='<span class="who"><span class="shop">'+esc(SHOP)+'</span><button class="btn home" data-act="home" aria-label="Home">⌂<span class="hw"> Home</span></button><span class="anchor"><button class="avbtn" id="avBtn" aria-haspopup="dialog" aria-expanded="'+(openPop==='av')+'" aria-label="'+esc(SHOP)+': your menu">C</button>'+(openPop==='av'?avPop():'')+'</span></span>';
  $('titlerow').innerHTML=h; $('titlerow').classList.toggle('on-matrix',phoneMx);
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


/* Row 2 · the tools row (the standard's) */
function paintTools(){
  var L=cur(), s=st(L), n=rowsOf(L,s).length, fn=(chipsOf(L,s).match(/class="fchip"/g)||[]).length;   /* the badge counts what you see: one cell = one chip = 1 */
  var h='<label class="search"><span aria-hidden="true">🔍</span><input id="q" type="search" placeholder="Search standards" value="'+esc(s.q)+'" aria-label="Search the standards"></label>'+
    '<span class="anchor"><button class="tbtn'+(fn?' on':'')+'" id="filtBtn" aria-haspopup="dialog" aria-expanded="'+(openPop==='filt')+'">Filters ▾'+(fn?' <span class="badge">'+fn+'</span>':'')+'</button>'+(openPop==='filt'?filtPop(L,s):'')+'</span>'+
    '<span class="seg" role="group" aria-label="Group by">'+L.groups.map(function(g){return '<button data-group="'+g[0]+'" aria-pressed="'+(s.group===g[0])+'">'+g[1]+'</button>';}).join('')+'</span>'+
    '<button class="tbtn ico" id="expBtn" title="'+(s.allOpen?'Collapse all':'Expand all')+'" aria-label="'+(s.allOpen?'Collapse all':'Expand all')+'" aria-pressed="'+s.allOpen+'">'+(s.allOpen?'⇡':'⇣')+'</button>'+
    '<span class="seg" role="group" aria-label="View"><button data-view="grid" title="Grid: columns" aria-pressed="'+(s.view==='grid')+'">▤</button><button data-view="lines" title="Lines: one line per record" aria-pressed="'+(s.view==='lines')+'">☰</button></span>'+
    '<span class="anchor"><button class="tbtn ico" id="colBtn" title="Choose columns" aria-label="Choose columns" aria-haspopup="dialog" aria-expanded="'+(openPop==='cols')+'">⚙</button>'+(openPop==='cols'?colsPop(L,s):'')+'</span>'+
    '<button class="tbtn ico" id="csvBtn" title="Download CSV" aria-label="Download CSV">⬇</button>'+
    '<span class="count" aria-live="polite">'+n+' shown</span>'+
    '<div class="fchips">'+chipsOf(L,s)+'</div>';
  $('tools').innerHTML=h;
}
/* a matrix cell is ONE choice (a row and a status), so it is one chip; any other filter keeps its own chip */
function chipsOf(L,s){
  var keys=Object.keys(s.filt).filter(function(k){return s.filt[k];}), fk=DIMF[PAGE.dim], out=[];
  if(s.filt.status&&s.filt[fk]){ out.push('<span class="fchip">'+esc(s.filt[fk])+' · '+esc(s.filt.status)+'<button data-unfilt="__cell" aria-label="Remove this filter">×</button></span>'); keys=keys.filter(function(k){return k!=='status'&&k!==fk;}); }
  return out.concat(keys.map(function(k){ var f=L.filters.filter(function(x){return x[0]===k;})[0];
    return '<span class="fchip">'+esc(f[1])+': '+esc(s.filt[k])+'<button data-unfilt="'+k+'" aria-label="Remove '+esc(f[1])+' filter">×</button></span>'; })).join('');
}
function filtPop(L,s){ return '<div class="pop left" role="dialog" aria-label="Filters"><h4>Filters</h4>'+L.filters.map(function(f){
    return '<label class="f">'+esc(f[1])+'<select data-filt="'+f[0]+'" id="f_'+f[0]+'"><option value="">Any</option>'+f[2].map(function(o){return '<option'+(s.filt[f[0]]===o?' selected':'')+'>'+esc(o)+'</option>';}).join('')+'</select></label>';}).join('')+
    '<div class="acts"><button class="btn" id="clearF">Clear all</button></div></div>'; }
function colsPop(L,s){
  var all=L.columns, shown=s.cols, rest=all.filter(function(c){return shown.indexOf(c.key)<0;}), by={}; all.forEach(function(c){by[c.key]=c;});
  function row(c,i,on){ return '<div class="colrow">'+(on?'<button class="mv" data-mv="'+c.key+'" data-d="-1" '+(i===0?'disabled':'')+' aria-label="Move '+esc(c.label)+' left">←</button>':'<span class="mvsp"></span>')+
    '<label><input type="checkbox" data-col="'+c.key+'" '+(on?'checked':'')+' '+(c.key==='what'?'disabled':'')+'> '+esc(c.label)+'</label>'+
    (on?'<button class="mv" data-mv="'+c.key+'" data-d="1" '+(i===shown.length-1?'disabled':'')+' aria-label="Move '+esc(c.label)+' right">→</button>':'<span class="mvsp"></span>')+'</div>'; }
  return '<div class="pop" role="dialog" aria-label="Columns"><h4>Shown — in this order</h4>'+shown.map(function(k,i){return row(by[k],i,true);}).join('')+
    (rest.length?'<h4>Available</h4>'+rest.map(function(c){return row(c,0,false);}).join(''):'')+'<div class="acts"><button class="btn" id="resetCols">Reset to the standard three</button></div></div>';
}

/* Row 3 · the column header + rows */
function paintList(){
  var L=cur(), s=st(L), el=$('list');
  if(pstate==='loading'){ el.innerHTML='<div class="hdr" style="grid-template-columns:'+template(L,s)+'">'+colsOf(L,s).map(function(c){return '<div class="hc">'+esc(c.label)+'</div>';}).join('')+'</div>'+Array(7).join('<div class="skel"></div>'); return; }
  if(pstate==='error'){ el.innerHTML='<div class="state"><div class="big">The standards could not load.</div>Nothing has changed in them.<br><button class="btn" id="retry">Try again</button></div>'; return; }
  var rows=groupOrder(s,rowsOf(L,s));
  if(!rows.length){ el.innerHTML='<div class="state"><div class="big">No standard matches.</div>'+esc(s.q?'“'+s.q+'”':'These filters')+' match nothing.<br><button class="btn" id="clearAll">Clear search and filters</button></div>'; return; }
  var cols=colsOf(L,s), tpl=template(L,s), h='', last=null;
  if(s.view==='grid') h+='<div class="grid"><div class="hdr" id="hdr" role="row" style="grid-template-columns:'+tpl+'">'+cols.map(function(c){
      var isAmt=c===L.amount, sorted=s.sort&&s.sort.key===c.key;
      return '<div class="hc'+(isAmt?' r':'')+'" role="columnheader" aria-sort="'+(sorted?(s.sort.dir>0?'ascending':'descending'):'none')+'">'+
        (c.sort||isAmt?'<button class="sort" data-sort="'+c.key+'">'+esc(c.label)+' <span class="arrow">'+(sorted?(s.sort.dir>0?'▲':'▼'):'⇅')+'</span></button>':esc(c.label))+
        '<button class="rz" data-rz="'+c.key+'" aria-label="Resize '+esc(c.label)+' column (arrow keys)" title="Drag to resize · double-click resets"></button></div>';}).join('')+'</div>';
  rows.forEach(function(x){
    var g=groupKey(s,x);
    if(g&&g[1]!==last){ last=g[1]; var inG=rows.filter(function(y){var k=groupKey(s,y);return k&&k[1]===g[1];}).map(function(y){return y.r;}), n=counts(inG);
      h+='<div class="group" role="row"><b>'+esc(g[0])+'</b><span class="fig">'+inG.length+' · <span class="c-live">● '+n.live+'</span> <span class="c-part">◐ '+n.part+'</span> <span class="c-plan">○ '+n.plan+'</span></span></div>'; }
    var open=s.allOpen?!s.open[x.id+'#closed']:!!s.open[x.id];
    if(s.view==='grid'){
      h+='<div class="grow'+(open?' open':'')+(x.r.s==='plan'?' planned':'')+'" role="row" data-row="'+x.id+'" tabindex="0" aria-expanded="'+open+'" style="grid-template-columns:'+tpl+'">'+cols.map(function(c,i){
        var v=c.cell(x.r), isAmt=c===L.amount;
        return '<div class="cell'+(i===0?' first':'')+(isAmt?' r amt':'')+(c.mono?' mono':'')+'" data-l="'+esc(i===0||isAmt?'':c.label)+'" role="cell">'+(i===0?'<span class="tw" aria-hidden="true">▸</span>':'')+(c.html?v:esc(v))+'</div>';}).join('')+'</div>';
    } else {
      h+='<div class="lrec'+(open?' open':'')+'" role="row" data-row="'+x.id+'" tabindex="0" aria-expanded="'+open+'"><div class="lline"><span class="tw" aria-hidden="true">▸</span><span class="lflow">'+
        cols.filter(function(c){return c!==L.amount;}).map(function(c){var v=c.cell(x.r);return '<span>'+(c.html?v:esc(v))+'</span>';}).join('')+'</span><span class="lamt">'+L.amount.cell(x.r)+'</span></div><div class="lgist">'+esc(L.gist(x))+'</div></div>';
    }
    if(open) h+='<div class="next" role="row">'+L.next(x,s.cols)+'</div>';
  });
  if(s.view==='grid') h+='</div>';
  h+='<div class="state" style="padding:14px;font:12px var(--f-num)">'+rows.length+' shown · end of list</div>';
  el.innerHTML=h;
  var hdr=$('hdr'); document.documentElement.style.setProperty('--hdr-h',hdr?hdr.offsetHeight+'px':'0px');
}

/* ═════ THE MATRIX — the second pane (new) ═════
   Rows by Area, Country or Kind; columns In force · Partly · Planned. A cell IS the list's filter pair (status + row), so the
   chips in the tools row and the lit cell are the same state, shown twice. A cell with nothing in it says "—" and does nothing. */
function mxRows(){
  if(PAGE.dim==='country') return [['IN','India',function(r){return r.c.indexOf('IN')>=0;}],['GLOBAL','Global',function(r){return r.c.indexOf('GLOBAL')>=0;}]];
  if(PAGE.dim==='kind') return D.kinds.map(function(k){return [k[0],k[1],function(r){return r.k===k[0];},k[2]];});
  return D.areas.map(function(a){return [a[0],a[1],function(r){return r.a===a[0];}];});
}
var DIMF={area:'area',country:'country',kind:'kind'};
function paintMatrix(){
  var L=cur(), s=st(L), f=s.filt, fk=DIMF[PAGE.dim], other=Object.keys(f).filter(function(k){return f[k]&&k!=='status'&&k!==fk;}).length||!!s.q.trim();
  var h='<div class="mx-tools"><span class="mx-lab" id="mxLab">Count by</span><span class="seg" role="group" aria-labelledby="mxLab">'+
    [['area','Area'],['country','Country'],['kind','Kind']].map(function(d){return '<button data-dim="'+d[0]+'" aria-pressed="'+(PAGE.dim===d[0])+'">'+d[1]+'</button>';}).join('')+'</span></div>';
  h+='<div class="mx" role="table" aria-label="Standards by '+PAGE.dim+' and status"><div class="mx-r mx-h" role="row"><span role="columnheader"></span>'+
    D.statuses.map(function(t){ var on=f.status===t[1]&&!f[fk]; return '<button role="columnheader" class="mx-ch c-'+t[0]+'" data-mxs="'+t[1]+'" aria-pressed="'+on+'" title="Show every '+t[1].toLowerCase()+' standard"><span class="sym" aria-hidden="true">'+t[2]+'</span>'+t[1]+'</button>'; }).join('')+'</div>';
  var all=D.rows;
  mxRows().concat([['*','All',function(){return true;}]]).forEach(function(r){
    var rows=all.filter(r[2]), n=counts(rows), rowOn=r[0]==='*'?!f[fk]&&!f.status:f[fk]===r[1]&&!f.status;
    h+='<div class="mx-r'+(r[0]==='*'?' mx-all':'')+'" role="row"><button role="rowheader" class="mx-rh" data-mxr="'+r[0]+'" aria-pressed="'+rowOn+'">'+esc(r[1])+(r[3]?'<span class="mx-sub">'+esc(r[3])+'</span>':'')+'</button>'+
      D.statuses.map(function(t){ var c=n[t[0]], on=f.status===t[1]&&(r[0]==='*'?!f[fk]:f[fk]===r[1]);
        return c?'<button role="cell" class="mx-c c-'+t[0]+'" data-mxr="'+r[0]+'" data-mxs="'+t[1]+'" aria-pressed="'+on+'" aria-label="'+esc(r[1])+', '+t[1]+': '+c+'">'+c+'</button>':'<span role="cell" class="mx-c nil" aria-label="'+esc(r[1])+', '+t[1]+': none">—</span>'; }).join('')+'</div>';
  });
  h+='</div>';
  if(other) h+='<p class="mx-note">The matrix counts the whole register; the list also has your search or other filters.</p>';
  h+='<div class="mx-more"><button class="tbtn" data-sheet="why">Why follow standards ›</button><button class="tbtn" data-sheet="record">One record, every standard ›</button></div>';
  $('mxBody').innerHTML=h;
}
function mxPick(rowId,statusLabel){
  var L=cur(), s=st(L), fk=DIMF[PAGE.dim], rowLab=rowId&&rowId!=='*'?mxRows().filter(function(r){return r[0]===rowId;})[0][1]:null;
  var same=(s.filt.status||null)===(statusLabel||null)&&(s.filt[fk]||null)===rowLab;
  s.filt={}; s.q='';
  if(!same){ if(statusLabel) s.filt.status=statusLabel; if(rowLab) s.filt[fk]=rowLab; }
  if(PAGE.dim==='area') s.group=s.filt.area?'none':'area';
  PAGE.view='list'; openPop=null; paint(); $('list').scrollTop=0;
}

/* ═════ the two sheets: the argument for standards, and one record carrying them (data from cap-standards.js) ═════ */
function paintSheet(){
  var el=$('sheet'); if(!PAGE.sheet){ el.hidden=true; el.innerHTML=''; return; }
  var W=D.why, h='<div class="sh-head"><h2>'+(PAGE.sheet==='why'?'Why follow standards':'One record, every standard')+'</h2><button class="btn" id="sheetX" aria-label="Close">✕</button></div><div class="sh-body">';
  if(PAGE.sheet==='why'){
    h+='<p class="sh-lead"><b>A chit crosses a boundary.</b> It leaves one company and lands in another that shares no system with it. Every convention we invent is one the other side has to be taught; every standard we adopt arrives already legible.</p>';
    function col(t,items,cls){ return '<section class="sh-col '+cls+'"><h3>'+t+'</h3>'+items.map(function(x){return '<div class="sh-it"><b>'+rich(x[0].replace(/^⚠️\s*/,''))+'</b><p>'+rich(x[1])+'</p></div>';}).join('')+'</section>'; }
    h+='<div class="sh-two">'+col('What it buys',W.pleasure,'buys')+col('What it costs',W.pain,'costs')+'</div>';
    h+='<section class="sh-col"><h3>What it has actually caught here</h3>'+W.proof.map(function(p){return '<p class="sh-proof">'+rich(p)+'</p>';}).join('')+'</section>';
  } else {
    h+='<p class="sh-lead">500 kg of pepper leaving Chennai for Dubai. Each field carries somebody else’s standard, so the record arrives already legible to a system that has never heard of us. <b>Planned fields are shown dimmed</b>, not hidden and not passed off as done.</p><div class="rec">';
    D.record.forEach(function(f){ var s=lab(D.statuses,f.s);
      h+='<div class="rf'+(f.s==='plan'?' planned':'')+'"><div class="rk"><code>'+esc(f.k)+'</code><code class="rv">'+esc(f.v)+'</code></div>'+
        (f.std?'<div class="rs"><span class="st st-'+f.s+'">'+s[2]+' '+s[1]+'</span> <span class="sn">'+esc(f.std)+'</span></div>':'')+'<p>'+rich(f.c.replace(/^⚠️\s*/,''))+'</p></div>'; });
    h+='</div>';
  }
  el.innerHTML=h+'</div>'; el.hidden=false;
}

/* ═════ THE STANDARDS DOOR — for the index page (new) ═════
   One box: a live fact (the three counts), one line of what it is, the date it was checked, and Read me. Opens the matrix. */
function doorHTML(){
  var n=counts(D.rows);
  return '<a class="door" href="?view=matrix" data-door="1"><span class="door-t">Standards <span aria-hidden="true">›</span></span>'+
    '<span class="door-n"><span class="c-live">● <b>'+n.live+'</b> in force</span><span class="c-part">◐ <b>'+n.part+'</b> partly</span><span class="c-plan">○ <b>'+n.plan+'</b> planned</span></span>'+
    '<span class="door-d">The laws and standards we follow — and what is still missing.</span>'+
    '<span class="door-f"><span>Checked '+esc(D.asOfLabel)+'</span><button class="door-read" data-sheet="why">Read me</button></span></a>';
}
function paintDoor(){
  $('doorpage').hidden=!PAGE.door; $('app').hidden=PAGE.door; if(!PAGE.door) return;
  $('doorpage').innerHTML='<div class="titlerow"><h1>'+esc(SHOP)+'</h1><span class="who"><span class="anchor"><button class="avbtn" aria-label="Your menu">C</button></span></span></div>'+
    '<div class="dp-grid"><div class="ph ph-wide">[ RAIL box — as already decided for the index page ]</div>'+doorHTML()+
    '<div class="ph">[ other index boxes ]</div><div class="ph">[ other index boxes ]</div></div>';
}

/* ═════ the kural footer (proposed CBKural) — 118, the even scale, for a page whose point is to lean to neither side ═════ */
var KUR={ lang:URLP.get('klang')||store('kural.lang')||'ta', hiddenOn:URLP.get('khide')==='1'?D.asOf:(store('kural.hidden')||''), showSecond:URLP.get('ksecond')==='1', paused:false, timer:null };
function kline(s){ var w=s.split(' '), m=Math.ceil(w.length/2); return '<span class="ln"><span class="h">'+esc(w.slice(0,m).join(' '))+'</span> <span class="h">'+esc(w.slice(m).join(' '))+'</span></span>'; }
function paintKural(){
  var bar=$('kbar'), k=D.kural; clearInterval(KUR.timer);
  if(KUR.hiddenOn===D.asOf){ bar.className='kbar off'; bar.innerHTML='<button class="kshow" data-kshow="1" aria-label="Show the kural">குறள் '+k.no+' ›</button>'; return; }
  var verse='<span class="kv" lang="ta">'+kline(k.ta[0])+kline(k.ta[1])+'</span>', mean='<span class="km">'+esc(k.en)+'</span>';
  bar.className='kbar k-'+KUR.lang+(KUR.showSecond?' second':'');
  bar.innerHTML='<svg class="kseal" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="29" fill="none" stroke="currentColor" stroke-width="2.5"/><ellipse cx="32" cy="13" rx="4.4" ry="3.6"/><circle cx="32" cy="22" r="6.4"/><path d="M25.8 23.5Q26 33 32 38.5Q38 33 38.2 23.5Q32 27 25.8 23.5Z"/><path d="M15.5 54Q16.5 41 26 36.8L32 40L38 36.8Q47.5 41 48.5 54Z"/></svg>'+
    '<button class="kbody" data-kswap="1" aria-label="Thirukkural '+k.no+'. Tap to switch Tamil and English">'+(KUR.lang==='ta'?verse+mean:mean+verse)+'</button><span class="kno">குறள் '+k.no+'</span><button class="kx" data-khide="1" aria-label="Hide the kural for today" title="Hide for today">✕</button>';
  var still=AP.motion==='reduce'||(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches);
  if(isPhone()&&!still&&!KUR.paused) KUR.timer=setInterval(function(){ KUR.showSecond=!KUR.showSecond; bar.classList.toggle('second',KUR.showSecond); },7000);
}

/* ═════ paint ═════ */
function paint(){
  paintDoor(); if(PAGE.door){ paintSheet(); paintProto(); return; }
  var a=$('app'); a.classList.toggle('view-matrix',PAGE.view==='matrix'); a.classList.toggle('view-list',PAGE.view!=='matrix');
  paintTitle(); paintMatrix(); paintTools(); paintList(); paintKural(); paintSheet(); paintProto(); measure();
}
function measure(){
  if(PAGE.door) return;
  var proto=$('proto').offsetHeight, el=isPhone()&&PAGE.view==='matrix'?$('mxBody'):$('list'), hdr=$('hdr');
  var top=el.getBoundingClientRect().top+(el===$('list')&&hdr&&hdr.offsetParent?hdr.offsetHeight:0)-proto;
  var pct=Math.round(top/(window.innerHeight-proto)*100), m=$('meter'), lim=window.innerWidth<=640?30:20;
  m.textContent='head '+pct+'% (limit '+lim+'%)'; m.className='meter '+(pct<=lim?'ok':'bad');
}
var tt; function toast(t){ var e=$('toast'); e.textContent=t; e.hidden=false; clearTimeout(tt); tt=setTimeout(function(){e.hidden=true;},2600); }

/* ═════ PROTOTYPE ONLY — DO NOT BUILD ═════ */
var PROTO=[['Matrix + list',{}],['Partly · Money & GST',{mx:['money','Partly']}],['India only',{dim:'country',mx:['IN',null]}],['Laws',{dim:'kind',mx:['law',null]}],
  ['Row opened',{mx:['money','Partly'],open:'GSTR-1 / GSTR-3B (GSTN schema)'}],['Search “privacy”',{q:'privacy'}],['No match',{q:'zzzz'}],['Why follow standards',{sheet:'why'}],['One record',{sheet:'record'}],['Index door',{door:true}]];
function paintProto(){
  $('pState').innerHTML=PROTO.map(function(p,i){return '<button data-pjump="'+i+'">'+esc(p[0])+'</button>';}).join('');
  $('pTheme').innerHTML=[['cream','Cream'],['dark','Dark'],['terminal','Terminal']].map(function(t){return '<button data-ptheme="'+t[0]+'" aria-pressed="'+(AP.theme===t[0])+'">'+t[1]+'</button>';}).join('');
  document.documentElement.style.setProperty('--proto-h',$('proto').offsetHeight+'px');
}
function jump(c){
  var L=cur(), s=st(L); s.filt={}; s.q=''; s.open={}; s.allOpen=false; s.group='area'; openPop=null;
  PAGE.door=!!c.door; PAGE.sheet=c.sheet||null; if(c.dim) PAGE.dim=c.dim; else if(!c.mx) PAGE.dim='area';
  PAGE.view=(c.mx||c.q||c.open)?'list':'matrix';
  if(c.q) s.q=c.q;
  if(c.mx) mxPick(c.mx[0],c.mx[1]);
  if(c.open){ var r=ROWS.filter(function(x){return x.r.n===c.open;})[0]; if(r){ st(cur()).open[r.id]=true; } }
  if(c.mx&&!c.open) return;
  paint();
}

/* ═════ behaviour ═════ */
document.addEventListener('click',function(ev){
  var t=ev.target.closest('button,a[data-door],[data-row],.group'); var L=cur(), s=st(L);
  if(!t){ if(openPop&&!ev.target.closest('.pop')){openPop=null;paint();} return; }
  if(t.closest('.pop')&&!t.matches('button')) return;
  var d=t.dataset;
  if(d.sheet){ ev.preventDefault(); PAGE.sheet=d.sheet; paintSheet(); $('sheetX')&&$('sheetX').focus(); return; }
  if(t.id==='sheetX'){ PAGE.sheet=null; paintSheet(); return; }
  if(d.door){ ev.preventDefault(); PAGE.door=false; PAGE.view='matrix'; paint(); return; }
  if(d.pjump){ jump(PROTO[+d.pjump][1]); return; }
  if(d.ptheme){ AP.theme=d.ptheme; store('ap.theme',AP.theme); applyAppearance(); paint(); return; }
  if(d.dim){ PAGE.dim=d.dim; store('std.dim',d.dim); var fk=DIMF[d.dim]; Object.keys(s.filt).forEach(function(k){ if(k!=='status'&&k!==fk) delete s.filt[k]; }); paint(); return; }
  if(d.mxr!=null||d.mxs!=null){ mxPick(d.mxr||null,d.mxs||null); return; }
  if(t.id==='backBtn'){ PAGE.view='matrix'; openPop=null; paint(); return; }
  if(d.kswap){ KUR.paused=true; KUR.showSecond=!KUR.showSecond; $('kbar').classList.toggle('second',KUR.showSecond); clearInterval(KUR.timer); return; }
  if(d.khide){ KUR.hiddenOn=D.asOf; store('kural.hidden',D.asOf); paintKural(); toast('Kural hidden until tomorrow'); return; }
  if(d.kshow){ KUR.hiddenOn=''; store('kural.hidden',''); paintKural(); return; }
  if(t.id==='avBtn'){ openPop=openPop==='av'?null:'av'; paint(); return; }
  if(d.apTheme){ AP.theme=d.apTheme; store('ap.theme',AP.theme); applyAppearance(); paint(); toast((APP_THEMES[AP.theme]?APP_THEMES[AP.theme].name:'Your device’s light or dark')+': every page now opens in it'); return; }
  if(d.apFs){ AP.fs=d.apFs; store('ap.fs',AP.fs); applyAppearance(); paint(); var z=TEXT_SIZES.filter(function(x){return x[0]===AP.fs;})[0]; toast('Text: '+z[1]+', '+Math.round(z[2]*100)+'% on every page'); return; }
  if(d.apWeight){ AP.weight=d.apWeight; store('ap.weight',AP.weight); applyAppearance(); paint(); return; }
  if(d.apMotion){ AP.motion=AP.motion==='reduce'?'auto':'reduce'; store('ap.motion',AP.motion); applyAppearance(); paint(); return; }
  if(d.apFont){ AP.font=d.apFont; store('ap.font',AP.font); applyAppearance(); paint(); return; }
  if(d.av){ toast({profile:'Opens Profile in the app',settings:'Settings stay in the app (owner only)',support:'Opens Support',signout:'In the product: signed out here and in every other tab'}[d.av]); return; }
  if(t.id==='filtBtn'){ openPop=openPop==='filt'?null:'filt'; paint(); return; }
  if(t.id==='colBtn'){ openPop=openPop==='cols'?null:'cols'; paint(); return; }
  if(d.group){ s.group=d.group; save(L); paint(); return; }
  if(d.view){ s.view=d.view; save(L); paint(); return; }
  if(t.id==='expBtn'){ s.allOpen=!s.allOpen; s.open={}; paint(); return; }
  if(t.id==='csvBtn'){ toast('In the product this downloads '+rowsOf(L,s).length+' rows as CSV, every column'); return; }
  if(d.unfilt){ if(d.unfilt==='__cell'){ delete s.filt.status; delete s.filt[DIMF[PAGE.dim]]; } else delete s.filt[d.unfilt]; paint(); return; }
  if(t.id==='clearF'||t.id==='clearAll'){ s.filt={}; s.q=''; openPop=null; paint(); return; }
  if(t.id==='retry'){ pstate='normal'; paint(); return; }
  if(d.mv){ var i=s.cols.indexOf(d.mv), j=i+(+d.d); if(j<0||j>=s.cols.length) return; s.cols.splice(i,1); s.cols.splice(j,0,d.mv); save(L); paint(); return; }
  if(t.id==='resetCols'){ s.cols=L.defaultCols.slice(); s.widths={}; save(L); paint(); return; }
  if(d.sort){ s.sort=s.sort&&s.sort.key===d.sort?{key:d.sort,dir:-s.sort.dir}:{key:d.sort,dir:1}; save(L); paint(); return; }
  if(d.act){ toast({home:'Opens the index page',go:'Opens that part of the app (stdGoto)',copy:'Copies the standard, clause, status and what is missing — ready to paste for a buyer or CA'}[d.act]); return; }
  if(d.rz) return;
  if(t.classList.contains('group')) return;
  var row=ev.target.closest('[data-row]'); if(row){ toggleRow(row.dataset.row); }
});
function toggleRow(id){ var s=st(cur()); if(s.allOpen) s.open[id+'#closed']=!s.open[id+'#closed']; else s.open[id]=!s.open[id]; paintList(); measure(); }
document.addEventListener('change',function(ev){ var t=ev.target, L=cur(), s=st(L);
  if(t.dataset.col){ var k=t.dataset.col; if(t.checked) s.cols.push(k); else s.cols=s.cols.filter(function(x){return x!==k;}); save(L); paint(); return; }
  if(t.dataset.filt){ s.filt[t.dataset.filt]=t.value||undefined; paint(); $('f_'+t.dataset.filt)&&$('f_'+t.dataset.filt).focus(); } });
document.addEventListener('input',function(ev){ if(ev.target.id==='q'){ var L=cur(), s=st(L); s.q=ev.target.value; paintList(); paintMatrix(); var c=document.querySelector('.count'); if(c) c.textContent=rowsOf(L,s).length+' shown'; measure(); } });
document.addEventListener('keydown',function(ev){ var t=ev.target;
  if(ev.key==='Escape'&&PAGE.sheet){ PAGE.sheet=null; paintSheet(); return; }
  if(ev.key==='Escape'&&openPop){ openPop=null; paint(); return; }
  if(t.dataset&&t.dataset.rz&&(ev.key==='ArrowLeft'||ev.key==='ArrowRight')){ ev.preventDefault(); resize(t.dataset.rz,ev.key==='ArrowRight'?8:-8); var b=document.querySelector('[data-rz="'+t.dataset.rz+'"]'); b&&b.focus(); return; }
  if(t.id==='paneRz'&&(ev.key==='ArrowLeft'||ev.key==='ArrowRight')){ ev.preventDefault(); setPaneW(PANEW+(ev.key==='ArrowRight'?16:-16)); return; }
  if(t.dataset&&t.dataset.row&&(ev.key==='Enter'||ev.key===' ')){ ev.preventDefault(); toggleRow(t.dataset.row); var n=document.querySelector('[data-row="'+t.dataset.row+'"]'); n&&n.focus(); return; }
  if(t.dataset&&t.dataset.row&&(ev.key==='ArrowDown'||ev.key==='ArrowUp')){ ev.preventDefault(); var all=[].slice.call(document.querySelectorAll('[data-row]')), k=all.indexOf(t), nn=all[k+(ev.key==='ArrowDown'?1:-1)]; nn&&nn.focus(); } });
function minW(c){ return Math.max(64, c.label.length*9+40); }
function resize(key,delta){ var L=cur(), s=st(L), c=L.columns.concat([L.amount]).filter(function(x){return x.key===key;})[0]; if(!c) return; s.widths[key]=Math.max(minW(c),(s.widths[key]||c.w)+delta); save(L); paintList(); measure(); }
var PANEW=store('std.paneW')||340;
function setPaneW(w){ PANEW=Math.max(260,Math.min(480,w)); store('std.paneW',PANEW); document.documentElement.style.setProperty('--mx-w',PANEW+'px'); }
var drag=null;
document.addEventListener('pointerdown',function(ev){
  if(ev.target.id==='paneRz'){ ev.preventDefault(); drag={pane:true,x:ev.clientX,w:PANEW}; ev.target.classList.add('drag'); return; }
  var b=ev.target.closest('[data-rz]'); if(!b) return; ev.preventDefault(); var L=cur(), s=st(L), c=L.columns.concat([L.amount]).filter(function(x){return x.key===b.dataset.rz;})[0];
  drag={key:b.dataset.rz,x:ev.clientX,w:s.widths[c.key]||c.w,c:c}; b.classList.add('drag'); });
document.addEventListener('pointermove',function(ev){ if(!drag) return; if(drag.pane){ setPaneW(drag.w+(ev.clientX-drag.x)); return; }
  var L=cur(), s=st(L); s.widths[drag.key]=Math.max(minW(drag.c),drag.w+(ev.clientX-drag.x)); var tpl=template(L,s); document.querySelectorAll('.hdr,.grow').forEach(function(e){e.style.gridTemplateColumns=tpl;}); });
document.addEventListener('pointerup',function(){ if(!drag) return; var p=drag.pane; drag=null; document.querySelectorAll('.drag').forEach(function(e){e.classList.remove('drag');}); if(!p){ save(cur()); paintList(); } measure(); });
document.addEventListener('dblclick',function(ev){ var b=ev.target.closest('[data-rz]'); if(!b) return; var L=cur(), s=st(L); delete s.widths[b.dataset.rz]; save(L); paintList(); });
var lastPhone=null; window.addEventListener('resize',function(){ var p=isPhone(); if(p!==lastPhone){ lastPhone=p; paint(); } else { paintProto(); measure(); } });

/* ═════ start ═════ */
if(URLP.get('theme')) AP.theme=URLP.get('theme');
if(URLP.get('proto')==='0') $('proto').hidden=true;
applyAppearance(); setPaneW(PANEW);
(function(){ var j=URLP.get('jump'); lastPhone=isPhone(); if(j!=null){ jump(PROTO[+j][1]); if(URLP.get('view')) { PAGE.view=URLP.get('view'); paint(); } } else paint(); })();
})();
