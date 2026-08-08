// The locator, end to end: build a network, give the stores stock, and ask "who has it?"
const API='https://chitbridge-api-production.up.railway.app';
const a=async(p,o={})=>{const r=await fetch(API+p,{method:o.method||'GET',headers:{'Content-Type':'application/json',...(o.token?{Authorization:'Bearer '+o.token}:{})},body:o.body?JSON.stringify(o.body):undefined});let j=null;try{j=await r.json()}catch(e){};return{status:r.status,json:j}};
let pass=0,fail=0; const ok=(c,v,d)=>{console.log((v?'   ✓ ':'   ✗ ')+c+(d?'  '+d:'')); v?pass++:fail++;};
const S='av'+String(Date.now()).slice(-5);
(async()=>{
  await a('/api/entities/register',{method:'POST',body:{email:S+'@test-cb.com',display_name:'Avail '+S}});
  const t=(await a('/api/entities/verify',{method:'POST',body:{email:S+'@test-cb.com',otp:'123456'}})).json.token;
  await a('/api/entities/profile',{method:'PATCH',token:t,body:{user_id:S+'network'}});
  await a('/api/entities/profile',{method:'PATCH',token:t,body:{catalogue_visibility:'public'}});
  const P=(city,lat,lng)=>({address:city,city,country:'IN',lat,lng,km:50});
  await a('/api/network-design',{method:'PUT',token:t,body:{draft:{nodes:[
    {key:'r',name:'Avail '+S,parent_key:null,root:true,owned:true,holds:[]},
    {key:'cbe',name:'Coimbatore',parent_key:'r',owned:true,exposure:'protected',pos:0,place:P('Coimbatore',11.0168,76.9558)},
    {key:'ero',name:'Erode',     parent_key:'r',owned:true,exposure:'protected',pos:1,place:P('Erode',11.3410,77.7172)},
    {key:'che',name:'Chennai',   parent_key:'r',owned:true,exposure:'protected',pos:2,place:P('Chennai',13.0827,80.2707)},
    {key:'sec',name:'Secret',    parent_key:'r',owned:true,exposure:'private', pos:3,place:P('Madurai',9.9252,78.1198)}]}}});
  const b=(await a('/api/network-design/build',{method:'POST',token:t,body:{}})).json;
  const by=n=>(b.created||[]).find(x=>x.name===n);
  ok('four stores built',(b.created||[]).length===4);

  // each store signs in, gets a catalogue, adds the SAME product, and reports (or does not report) stock
  const setup=async(name, qty, source, agoMin)=>{
    const c=by(name);
    const tok=(await a('/api/entities/verify',{method:'POST',body:{user_id:c.handle,otp:c.claim_code}})).json.token;
    await a('/api/schemas/create-default',{method:'POST',token:tok});
    const p=await a('/api/products',{method:'POST',token:tok,body:{item_data:{name:'Impeller ring 90mm',code:'IMP-90',unit:'each',price:1200}}});
    const id=(p.json&&(p.json.item&&p.json.item.item_id))||null;
    if(id && qty!==undefined){
      const as_of=agoMin?new Date(Date.now()-agoMin*60000).toISOString():undefined;
      await a('/api/products/'+id+'/availability',{method:'PUT',token:tok,body:{qty,source,as_of}});
    }
    return {tok,id};
  };
  const cbe=await setup('Coimbatore', 6, 'erp', 4);
  await setup('Erode', 41, 'manual', 60*24*210);      // lots, but ancient
  await setup('Chennai', undefined);                   // has the item, has NEVER reported
  await setup('Secret', 99, 'erp', 2);                 // private store — must not appear at all

  const r=await a('/api/network-design/availability?q=impeller',{token:cbe.tok});
  const J=r.json||{};
  console.log('\n   '+J.summary+'\n');
  (J.rows||[]).forEach(x=>console.log('     '+String(x.store).padEnd(12)
    +(x.qty===null?'unknown':String(x.qty)+' in stock').padEnd(14)
    +String(x.km===null?'—':x.km+' km').padEnd(9)
    +String((x.freshness||{}).label||'').padEnd(14)+(x.source||'')));

  ok('the search answered', r.status===200, J.summary||'');
  ok('★★ a PRIVATE store is absent entirely — not listed as unknown',
     !(J.rows||[]).some(x=>x.store==='Secret'), 'existence oracle stays closed');
  ok('★★ fresh beats stale: Coimbatore(6, 4 min) above Erode(41, 210 days)',
     (J.rows||[]).findIndex(x=>x.store==='Coimbatore') < (J.rows||[]).findIndex(x=>x.store==='Erode'));
  const chn=(J.rows||[]).find(x=>x.store==='Chennai');
  ok('★★ a store that never reported is UNKNOWN, not zero', !!chn && chn.qty===null, 'qty='+(chn&&chn.qty));
  ok('★ the summary counts the unknowns out loud', /has not reported|have not reported/.test(J.summary||''), J.summary);
  ok('★ distance is real', (J.rows||[]).some(x=>x.km>80&&x.km<100), 'Coimbatore→Erode ~91 km');
  ok('★ a negative quantity is refused',
     (await a('/api/products/'+cbe.id+'/availability',{method:'PUT',token:cbe.tok,body:{qty:-5}})).status===400);
  console.log('\n  '+pass+' proved · '+fail+' failed\n'); process.exit(fail?1:0);
})();
