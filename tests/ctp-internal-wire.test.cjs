/* RAIL-98 Â· RAIL-99 Â· RAIL-100 Â· RAIL-101 â€” a chit between two of OUR installations, through the normal send path (offline: db, transport and the far end are stubs).
   Each block fails on main and passes on rail/ctp-internal-wire. */
const assert = require('assert');
const path = require('path');
const Module = require('module');

let pass = 0,
  fail = 0;
const t = async (name, fn) => {
  try {
    await fn();
    pass++;
    console.log('   ok   ' + name);
  } catch (e) {
    fail++;
    console.log('   FAIL ' + name + '\n          ' + e.message);
  }
};
const root = (p) => path.join(__dirname, '..', p);

/** require `file` fresh with some modules replaced (matched on the exact request string) */
function load(file, stubs) {
  for (const f of ['db/index.js', 'lib/ctpaddress.js', 'lib/ctptransport.js']) delete require.cache[require.resolve(root(f))]; /* drop the mint test stubs */
  const real = Module._load;
  Module._load = function (req) {
    if (Object.prototype.hasOwnProperty.call(stubs, req)) return stubs[req];
    return real.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve(root(file))];
    return require(root(file));
  } finally {
    Module._load = real;
  }
}

const RECIP = 'r-entity-1';
/* âš ï¸ no bridge_id on the copy, exactly as a real send copy */
const copy = { entity_id: RECIP, direction: 'received', sender_entity_id: 's1' };
const remote = (place) => ({
  resolveAll: async (ids) =>
    new Map(ids.map((i) => [String(i), place || { local: false, installation_key: 'sit-au', endpoint: 'https://au.example/api/ctp/deliver' }]))
});

function mintWith(transport, place) {
  const db = {
    withEntity: async () => {
      throw new Error('a local write must not happen');
    },
    query: async (sql) => {
      if (/SELECT bridge_id, display_name FROM identities/.test(sql)) return { rows: [{ bridge_id: 'CBSQRH9ASH', display_name: 'QA Rish Pty' }] };
      if (/coalesce\(population/.test(sql)) return { rows: [{ population: 'live', bridge_id: 'CBEGY7LB2J', display_name: 'QA Athi' }] };
      return { rows: [] };
    }
  };
  /* deliver() requires its helpers lazily, so the stubs sit in the module cache for the whole test */
  for (const [file, exp] of [['db/index.js', db], ['lib/ctpaddress.js', remote(place)], ['lib/ctptransport.js', transport]]) {
    const id = require.resolve(root(file));
    require.cache[id] = { id, filename: id, loaded: true, exports: exp };
  }
  delete require.cache[require.resolve(root('lib/mint.js'))];
  return require(root('lib/mint.js'));
}

(async () => {
  console.log('\n== CTP between our own installations ==\n');

  await t('RAIL-98: a send copy with no bridge_id still builds the envelope (id from the recipient row)', async () => {
    let sentEnv = null;
    const mint = mintWith({
      send: async (ep, env) => {
        sentEnv = env;
        return { accepted: true, status: 200, why: 'accepted' };
      }
    });
    try {
      await mint.deliver('s1', 'chit-1', [copy], {});
    } catch (e) {
      assert.ok(/a local write must not happen/.test(e.message), 'unexpected: ' + e.message);
    }
    assert.ok(sentEnv, 'no envelope was built or sent');
    assert.strictEqual(sentEnv.to.bridge_id, 'CBSQRH9ASH');
  });

  await t('RAIL-99: the far end answers no -> 409 CTP_REFUSED naming WHO and WHY, nothing written', async () => {
    const mint = mintWith({ send: async () => ({ accepted: false, status: 404, why: 'no active business here called CBGHOST001' }) });
    let err;
    try {
      await mint.deliver('s1', 'chit-2', [copy], {});
    } catch (e) {
      err = e;
    }
    assert.ok(err, 'must refuse');
    const known = require(root('lib/knownerr')).known(err);
    assert.ok(known, 'the refusal is not recognised, so the route would say Send failed (500)');
    assert.strictEqual(known.status, 409);
    assert.strictEqual(known.body.code, 'CTP_REFUSED');
    /* sit/run6 (RAIL-99 x RAIL-129 + Q19): the refusal names WHO from our own row; the far end's own words go to the log, never into the sentence (a value from outside is never echoed) */
    assert.ok(/QA Rish Pty/.test(known.body.message), 'must name who: ' + known.body.message);
    assert.ok(!/CBGHOST001/.test(known.body.message), "the far end's words are logged, not said: " + known.body.message);
    assert.ok(/Nothing was written/.test(known.body.message) && err.refused === true);
  });

  await t('RAIL-99: nobody answers (timeout / unreachable) -> 502 CTP_UNREACHABLE, not 500', async () => {
    const mint = mintWith({ send: async () => ({ accepted: false, status: null, why: 'could not reach https://au.example/api/ctp/deliver: timed out' }) });
    let err;
    try {
      await mint.deliver('s1', 'chit-3', [copy], {});
    } catch (e) {
      err = e;
    }
    const known = require(root('lib/knownerr')).known(err);
    assert.ok(known && known.status === 502 && known.body.code === 'CTP_UNREACHABLE', JSON.stringify(known));
    assert.ok(/timed out/.test(known.body.message) && /again/.test(known.body.message));
  });

  /* SIT run 4 (RAIL-112): a business on a suspended or retired installation was "sent" into this database and never left */
  await t('RAIL-112: a recipient on an INACTIVE installation is refused 409 CTP_PEER_INACTIVE, nothing sent, nothing written', async () => {
    let sent = 0;
    const mint = mintWith({ send: async () => { sent++; return { accepted: true }; } }, { local: false, inactive: true, installation_key: 'sit-grund', endpoint: null, why: 'installation sit-grund is not active here' });
    let err;
    try {
      await mint.deliver('s1', 'chit-9', [copy], {});
    } catch (e) {
      err = e;
    }
    const known = require(root('lib/knownerr')).known(err);
    assert.ok(known && known.status === 409 && known.body.code === 'CTP_PEER_INACTIVE', JSON.stringify(known));
    assert.ok(/sit-grund/.test(known.body.message) && /Nothing was sent and nothing was saved here/.test(known.body.message));
    assert.strictEqual(sent, 0, 'nothing may go on the wire');
  });

  await t('RAIL-99: an ordinary error is still not dressed up as a far-end refusal', async () => {
    assert.strictEqual(require(root('lib/knownerr')).known(new Error('boom')), null);
  });

  await t('RAIL-100: the manifest carries the installation domain, so resolve answers bridge_id@domain', async () => {
    const db = {
      query: async (sql) => {
        if (/FROM installation/.test(sql))
          return {
            rows: [
              {
                installation_key: 'sit-au',
                label: 'sit-au',
                region: 'AU',
                domain: '129-225-90-80.sslip.io',
                ctp_endpoint: 'https://129-225-90-80.sslip.io/api/ctp/deliver'
              }
            ]
          };
        return { rows: [{ code: 'live' }] };
      }
    };
    const ctp = load('routes/ctp.js', { '../db': db });
    const m = await ctp.manifest();
    assert.strictEqual(m.domain, '129-225-90-80.sslip.io');
    assert.strictEqual(require(root('lib/ctpaddress')).format('CBSQRH9ASH', m.domain), 'CBSQRH9ASH@129-225-90-80.sslip.io');
  });

  /* â”€â”€ RAIL-101 â”€â”€ an in-memory identities table */
  function world() {
    const rows = [{ identity_id: 'owner-1', bridge_id: 'CBEGY7LB2J', display_name: 'QA Athi', inst: 'sit-in' }];
    const placed = [];
    const q = async (sql, args) => {
      if (/FROM identities WHERE bridge_id = \$1 AND identity_type/.test(sql)) {
        const r = rows.find((x) => x.bridge_id === args[0]);
        return { rows: r ? [{ identity_id: r.identity_id, display_name: r.display_name, installation_key: r.inst }] : [] };
      }
      if (/INSERT INTO identities/.test(sql)) {
        const r = { identity_id: 'new-' + (rows.length + 1), bridge_id: args[0], display_name: args[1], inst: 'sit-in' };
        rows.push(r);
        return { rows: [{ identity_id: r.identity_id, display_name: r.display_name }] };
      }
      if (/f_place_entity/.test(sql)) {
        placed.push(args);
        rows.find((x) => x.identity_id === args[0]).inst = args[1];
        return { rows: [{}] };
      }
      throw new Error('unexpected sql ' + sql);
    };
    return { rows, ©;Êi¿\Îu‡§ 8ñZfDúD‚?s/È=ŸÑ¹yØüÇá~…eÕJ°óâtâ0W‘¦´÷óä"Iut¾³Èúh¬fmXa0/¯¦ü=©‘fÊÊtv§B¹]5ŽIWÊÑ4!êØpo~¤§õOØ¿ñþ"ÐWÎ<Þ»œ¢•ÂßL³”/Q¤M.Û2Rï<`Îy@åÇÝÑ•¤÷+[ÞvURÅåâÙxä¦Dw• ¯['«0Q¾U®°àbþŠ á\–tð‘ðJMOO6’£N è±ºðXÖGC5LgË7~¦8(ü(Ò(Uƒ›D¾5å–Ë/Ä±Íb"¥Xr'iZªp$§Ÿ×ÜÙ½ÆìúÏP0FÔ¤=Å¼%™=‹,±§B":nÄ0“/Šåä1kûÎV`1‘¶BëCíwëuÐ	ÌKÂfa½¦ëìãKùÿíZüŠQµõ¨4Ù‰¦‰H‹ë§dO-(‚éqØ:²!%‰l-s‹á9OB6\‡ÓÒ;þ^<9°1ãCO5“c,}8ÓäžMÃ-HÇÎ
Tà<¾àƒ–;9¹äKaÇßÒ5*š.[Vxs-=;sÓü.}†}lV«W•§g€«l—Å¨êÇDÈb>¯¢GÖÐ;ç†{WVWÓÙpxÈ ñßESnõÍf)ÎÄÌünþ!ñ-Š&ÈÄ‡'À-ÛÃcN<…7Ec‡ò¡}xQcq°ÑFý¼˜V	»‹/êÈ=ÎÀÖÆBæ*Zè˜µXŸ=ü0#äÔ[WEÕÍ½Ÿ#ùÈ¢-`k8ÛÛ`nT0].ÏÞK¤Ç… ¤a«ší{]þ^•Ïñ“#¿œ·6[tp£Nm…{/å÷éýO>p(Gî—C¡Î^¥1·!ã_°BLýÉ¤Q„ÄîïügŒØÂè\O²ÒZ&F—L nã7\Ü>ù	xË…ÿ(ÜÑ¸eá~“ä³sn¡ti‡…©É,·Z¾"íƒÞ÷ôn¦÷®’5 	 §Uñ2yáÇ“›£¶S!dH¢lT\ÕÄ…å›Ðu¬Ÿ'2`ÚL«VÆ¸ûñiv>Ó¢†à•¤0ç‰"%Ù”þp4GþCýPŠi™j0¿a‰†+–`ú†o™_Í—ü1ÃYÃC›™“Ñï­¼¼h.áªzðªß“S_È¾ñ×½,SÎ È$‰ÑûM Þ \)!t¦;‰vQIOäê£ì¥ŒUeå§«ÄRPº6ÊÖm¯R#ß±-z¯5!nÛ(j Þl·~Ñsè+ÃìJïû²·Tˆx(µè)ÊâãH×Î‰‚ÞØî‡‡k˜©¥\çk;¡ªnF,7?q=9ö¢ëHÇUY†F7AH¶Æ…Ðm:",‰”ýC…N0>u<;š—+ËgÚ—üßÓ±ùZ9lmUç7"PìÞ°EºðB\"ÉÂhú0à¢;–ç–õÁ.–²%Tv^ýdµt~Ø«o³ûæÒyîQý‚’ÂEvÔ*ª™Àž	v·0Êûï®¤/ ß!à¶ÅY}ËÇT Ê‚zz‹ÎD­¾|s×½p×‘>ˆŒºQ˜ž™l :¾ê!¡ÀâÛpXèTfeOR¸ùÍgØlÜ<ÖªàÔ¯_0ƒ¡ºhÛ¶Î`
_ M“°Fç¨S©%_‰u•ŠÁ’Üäâ×RJ”ÑR‰sâóQLŒŸ‚kÁÇ«=ÖÒµ‹*x2µx\ß&ž›Ä6òÜhCŽ¿A,7†]’ÑdvWÖòÌ\_´I˜Øï|q)Å"ôcÂ§(f4‹ðM\W xvP÷k¥Èj6qjsFŒ­m?[MLhAýLJ«O®iŒ)-42éó¹3e¢øßúpÎyƒž0Šîàp+Ï ×6Ì¥
Nä=çsòhØàæ	§¾³„‘õA€®oÂø†jsOÙÓ#Q86y®ñ”qÈ,©Öƒ™š³VÑ‘âÝ]Å@PÁ»=5ÃÁ/0Ä¹ÞÆ Ÿ%‡5Îu+Ý VßÔû¾·’ÖLqör¡ÞOåÃAtãe+$Xäíå5ìøèÞÇù>þgfÎ¹Ì|SqIF\šÃÎiÓ4,FEøN4tèùoúä ;[ÝÀ×AÜÅ!J×‘Hõ®ñ;¿¥ÞáÆª‰®±¹Á2%·ºº†^ña£h>ÛÅÙ×¼Ú0¸ýmÚågË7Àâ^ÔÙìæ×˜ŽœÛ3¥†Þ{vÉÁÌ›Ý—óiä•Ä ¾¿kãÑR•aŽ­#|<”Ü(W-oT¤ë~dÒGHEÚ¯üQ³\×›c;sÀÐA£¢ŸC]BµM
>…6	Øjà$G»¯¦	ó“.*Ë°õŸ,dV“/ßëBÝv»iªve»GJŸq_ânØ–Ì¾ó¬=é“WAñ{]´a}ÇvJž*`Ù»£9ÒbÜýir¯ŒvÍ~ÂÃÁ#s¯ÔXGëŒ¿Å·ãF¸3~H{¬þkžI—•”>jy@G†DÍh_I‹7BÁ)-DQû—\ Œ ÌVéÁÐÛ«¼‰kû2s¼~Æþ·ŽÌÚÜÔîôP›ÃeÜ$š}ðm« q©—¹~¨%ŽØE°@gý¥òp?Ý¡JS-VþÆ˜©ûyÊ` TÁ‰ƒÁkÛ‡‹oë•ƒ?Ç
Õž³Í°AX´á3Gäö·êp‹Îº0ÿE¤pPÖ¡NÑcá:¡ÙìuASã™B‹D¹…p>5u&’0…¦¶N‚•Äˆò[á[¡ÏÕÇM[<X,sn|
ÌJïüž3{¹QH(ƒ,j:÷Œ´5çP`ÿÆ“×4â´˜¡c?Õ|\]Ìä*WW'®tÉ®U²ñrÅ±ÊÌ™†1cHÚêÙèì°Jý'…8fþêßzÄÉ3¹5Ñ‚÷Vdë½’kW51èJ,!”±^(„t7&º>[çìMÉ‡	K¥Ô“•Î+ãŸ{wºãb Øqæ(yñ 
ÙÂz¬½ËPHi
½Ä².D?f˜!¶´–Ç‡GÑ)À=u·`“lÆ¨xû¨Ë…‹öÄ®úMMÔjÏ¬CnPñÑÖµ3Ô‡Ýâ<š¦%Àô	§~f¾Ä}ºRÐç‡ä’#¼%ØÆ$0)¹×&£¼elL¬Ö›Úo¦£+Pƒáée~;’ldú¶½þˆ'J9GßZ«@€³Çbá³V`,5 ¹—Üöã .)N¦±	v«ßoÇ„‰Åfk”©[)çh3L_¨s­`ûhõù¡]ÓïïÂ‰=Ç‹¹r"ñ¶{8=æ´ÄŸµóª¼ï¦*E-ý}GI©Ë¾‰ÍáÎè/ÔÖB/`]kt-ôñÿ¥lTô±ÿ¬*\’Ô¬’ÎºXŠ¿-dÉ«Ú2½êêëÓ
Bre{…vï0tV( #BÕ¤ó‚øc¿šÑOT^V¡¤`+ÀRŽ«É“'‘  ;Ùúåƒ»ddÃÆ¡Ê?É2}”±^™>e0 ,?å¼Ê_ƒèh¹Œ¨‰ë°xÊGÂð¶)"GA-4‹†e°w&~¸¬'¦¹2óMÇ…âGÄo‘ xwË"`S™TÊÈæøbX÷Û¢?­/òd5m
Š‚QÜT”Îç…ä½Yû–þÓ)·÷:B½Ø+Ì)‡fvÝMÆ˜Åõr„BçV5žÛy¾:,ƒl›+<l1!&›yä^¥Èeã|ù7M¯°ÎEHÇñ%(pœîT–§ÐÃ‹d3Of8‚-Òò\÷8<B{b\²&WÅêÛäñ}ì1TH&²í_éZÚ·ŽB]Æß×$”/Ø‘‰AM0žuÀRS’ôLe5‚ýJ	WÌm”êw˜hO`šDÏü?¯ÒìÙÚr®¸\«v¸ZçJŠ«Øèƒè\{I(œ>†³bU&Ã9"Iyú+n¾n“[¼´e¬
5ÌHýibBDY]¯Ï¬ÒÔÈkDá”'õÌr6ºw8ë¦7F0‹;ëCKbÖ~°qF¸gíÛÂ­Äd&¿BÿÌŽ©NéÀ)%Ã˜°ƒ-»	ú§jíé¤±õ†ïztúûTìîÇ»[ô„í¦C`]q÷‰„îÄÐÆ>/Nf¨º²ñ	µpKÃÐ®6‡W¸ÔŸÊš²	,~ºüäE^ô€¢ßkß¾›!À0m×`b%ž“áEÆ&UuGo!](”&ÁrtãûoS˜˜EžeSœ1Wqdèât¤´ép£Ë\|€ÇÛ¼’Ú¢MŸ"¨$èÎìJ<Ž._AÊ QÁ¹ ".ÃÐgÅ"¥ŽAó±=;ŸÜÑ1nÜÖ\üÏ(Ÿ8¥@ ôW0½°éqk£•0žÜ]ç´¡è£ŸäðßjD£}¶‰ÂºJ)4¿\3Å…¤â
—+ðÌ´ÈPSÞIhË£ƒ!½5MÕ‡C²+çc½±‚TI×Úî,`ËŒj"zƒÔTöÑAËò”(gQ®ë !·›û«ÌyCúÖ°L`aC'çºâŽDæç”(³ò}žÈ"ÆLabcôiL( p\êÊZt²äøðev¢ú® TM BÌÙV^b'$Ô¤¯s²˜WK¸·¢úc#$Yô=úaY—ÃÊ¹¹éá!æNG5Ðø1ÿ¯I4ÂŽ ñrƒ3Ùþ{ ]ˆ [<_8ö€\è:@õ+¶@÷–iß­„àJÈqD.YÈÛÀ¶d4½ItÔ}¤ObÃKÜ®F_µ>vÔhîcá´þhßž„°7cˆ„çØ;C¼m‘í5y†=Ê@+ÖÛu„#>ƒ8QÙ¬ËÉ…É7†˜žÊ‰0O¯)S¹Föx‰³ÜP¶å6Ô„GÊË9
°é<=„E÷´ÏËþsA?NÜzÑ°ø²u?·˜}ä½r&a<Ú˜ä¥6]ÍßŠHšÜ÷lª™Y„jœ[éÉ©£ÄyÞw'ùU@1È/¯<µ’?1O=9ŸÑ!Ïg&Óägäí×	æmãŒ‡sÿ¸ÿüb\€boÎÍXAâg¾9;¨£‚£!\­ƒój"œä|üõNX»˜žŽÕNëå®62Þ”ÃœÒä«ÝŒ!º/…Æ®åÈ¹¨|Ù¾!ÖÀ‹Ó¥_ò$!VxÅ
¡9¤0Ò®ð@„fð¥S „ÃŠŠé¬‰#OrŒÎdÖ?(HJò€DTØ°8Ü¤b)àq…n`«¡þ±Çg¤úœm+0eF¢­=à‘˜[);Of2*£¹Q^ù’•6ã:áUç“Ñ¡[I!¬Ec¬sÐ÷°‘€èuƒ_óÃ2ê1|8Z›Ý| Ôáö¤‹ºè/´Èü]È—•F/ßÄºâÄX¹ïXbÊ¦K£)\7
3q’€;U;‘‹ÏüÍxë“ó”(põíÞ¸‚GåÓ†v#ú­LÀñÉ
7BÉR76ëºFà&¸ßüÃ™¶Â6C¾O"UÐeÁéÙ£Y„œçJD½— ú£SÚ¡&Tü
éD1l?™IÿVœrÌ|ªËiËå.³»Äópÿ®sÕçº&€“ê—‚Za¸®wäLC·²µ)iaõ[ósAæpiD¨éÞ` x¸¡‚}¦kwúq,ïÂ>{<li¹Ô‡«Ùy'e@*l‡1!.yWµdÆE„¾NeÓ¹MÉÆ%Ê‹èP³zÑÈÍQdÖ±¯70”Ã#Œ ÑÞ!‹i(?Ì€F8Î[4ÓV›Û7Z7·Í*‹¬™Äl’\,˜\šíkÉ¤‚µå‰÷Ù˜‰s÷µ‹á©MHšS>
@[Åg¦J®41Î¸'—~VD8ñh³d¹-B“ª²±KÏÕƒ86#
ÜAnßha±´dz~	àœ¤Œ¥ã—e©ÀˆÔÔæiG-r®¤?u)cýÓ›ásK®C€þ*l9ˆ¥VŒø¸ÓÛéZq44·˜HjÓ•ÔéÁÌÜJL¬¤\¾xÿï-`ƒ0TJ’ï/È7äïaS¼¸H9ÒÚàqbÜÜžÆñÖ3=‚M"Uñ¾ÒÁE¡ö?8eCD¥„ú§§ÅO¼¯ÇX·Ò"¥‡R••œ¹<ýV¬^œgÊdW?Rín^ÜrR Ì¼Ä©:-ž¾Œ›D{œ»Ê)yïÒ™›R"ôž˜–Z«ªëqñ.’õ—\k È„¶l‰uvÝEv ¸ëÄL€×-°“(Œz5ru$PÐ[`³¥ªþ•s#”Vr0hT ³ª™°HÅ–!1†'Û±Ò…Ñd‰‡ÉáKÐrŽù–ÎïÎíÅ,é/ì£,+É5ä®Ô9Ô¶Ü\4ƒ¹]ý¦iÎpMÂnk:Î$3ÚEþù¦º(o^ßÑÊæuç¼±ÇÒ"›Oâ`Ãë©* qšì¸(gà›‘YQ+;MCjGó£2ÍðÃ@üò¡h‡‡u1•Vú>„w©Nèd$Ø’ŒxŒ•Á%L‚µ8Õ¢wFû“ÄµhÆ]c©Œ¨IŽqÇ³pè¨‰E£`oŽ}g_Kšñ6çÃûïQ§59Ò$‚Çô;Ç«¸œ<²<šwF{]ÎFLf"Ž5_O$ez&X%*EÔäà2	9Ì5
+E=ŒP_f ’~×Ä4™ºWŽý¢o>¬Ë—³³×ž²‰•5y†Ç?Ä‹ñ¢9ÀÀ<0N+°O’Æ®{¾fÅ`|_¼Wûá’Õ.á6½ZV0u^–(Z¹’Š‘ª2×·÷zaª©n>÷|NÙ¢<üÃóä´¿À÷€äÌðöžÝ³2¶Œø†L”ÇÊxZg­ÍÎ¯a.+kÔi†nƒ1&#î!Œ jÆ¼ùL™/‡g¥±xÙ‡º:$@¼¬}N:¤z3Q¹Ú²ÁåØ2EÀgë˜…úvÝÎA^‡.XÜÜOåm‚¿˜Ó“'£‡Die¶‹p5¨p{â	H*­AÛÆ[&Ûÿ@öð½ØEFýÖV^Rr„Hö™SÝ»n†ë%”^(È\Ô«¸åé»êF ÒÝhdñù­ºþ÷vÕöúkÎÚðý'{Ñög®‡ßð&+¥@wÏZérÐÕ9çD‡Q‚!ˆ­©ÆþöMóøGè‚‚™ùg¿ºŽQQ¬æJËX5Ój
	³”c	r¼,´ý»>Ù£®Ý‚CÓOkÔÑäN#zÂ3è(ýÒˆ¦f.Ò!ŸpÓV¿4vnð£–b§TY’Ã†”c]¾~ƒè0ÅŒË8˜~}•0Ã¨Ž”2Ùs9â9v×½ä,rôÙ¤þ<”°²~_Þ:þßH²ÄHTÊb?êÕø¤\vô46#æ|%‘”5ãœ¶ v˜¢nçÌÝßq7ØôwB`óê%T'«H£þkmí|žd¡?õ¦ÝÞº7„J’·Bæ_ªuøƒÞúÚ¢©¢Qøs;rX²‡ß À	‘´ˆmuŽ†*cL¢êÃßru)¢ü|Ý*n$ÞôÎ><‘Åœ8e¹­ËÎ¢¾ES¦ÄpÉ ^oI„Ë×ù9éfŒ&²U=•”þÑ×íüà´öüÀºGÔ÷o~Æ°dKFÂ‘§åCgt`3®KL…\Õ°Ö`)RÙÔ!9„bâ1üîÞï÷Æ6Ò'õ‹D¤«ïFQì´¬J°wñÄ‚Ó»°'çDÒfÒv\÷8Sõ2ÛGBöŸùkÖ—4•­i$°­Éí¢Æ,NFu„Ê÷a³7t¶T•Kd0ÛƒÍ¥—&u`ÿ ¦¡nâF}8n…Ô¼ÊÄ>‡²Ë¦¶u™+í±¾·JST¼k·
7<ý¡þ6^t+lÄ4²bk†ÀT]yB+€ˆ*½û†·Îœã4üB6å*ŸX……œûXqÃ¬èÈgÇ¯Ãyv‰Û'fc5 ”eµwýœ3Ð÷²þ¨›Ò~ïÙb§Ø…æ>ÈlmëTpß3ÓÉ¡ršÁ.¿Ú%rú.ŠU"Jm}¸Õ7ëBL€òÁtÚ	Õl¼™À‚á4àþrm
ÇÑkQ‹•˜nPÒÒýš7Y¦õ&…W.(”ÜEEeö×DX$˜Æõ¾<½ÂÒtæAfÿ í©Ad	pVœûk!Õ‘þƒŸU
vs÷ã*~ óŸØ)“W£XyM‰“Bu˜c¿#Q•2aW:=€Ï3°5µÇi¾'Õ¼,„àð¡ðí›·ËÓ¦ÊPK³¶Ëµ“©guWÍä¹BˆGée%;`›€ØÕÐ%8JØ†¯û™›Ç„­ƒüÇ£¬rÒ×º¬Û][—3>5èfIâ0@ŒÏ}òê oßkƒ<g÷þgÄàth† wœ:xÇ
òlEôlŸ.íc¼„F=£\ÞÅ%H
Æ’Á`dÎ˜ŽäÝþ$û°Û8•«†ðÚ)56ù}|{_ŽÕñ¦X‘ù_än”}ç‰61éöÇ5]'’©ü\©¾8™óºð®c/wô¤›ªØÔ‡‘l)¦Lžj×Qñqs/U¢ha-QfSÝûˆ†}8íbÍã€¯/2ÐG4\-žó›¸wœ'>ñˆø
S|—6±ÍC=Ï¾‚¾G:KdöH°Ã¢U¶		Ý¹oöÿÈ5 –Œ´jæq[³‚Wf%MÔ¸f=k/“ñëûšC+Î£´Z÷ºÐfi‚·3r®}ÄÔtcwÆŽÛZ’šBpÃ¯½í<Ë÷LîÎ=›¢§OÀXCú~j¡Ù4°ßú<Dx_(th®K-„pHŒªšp¡¸Ò¹
á¹h`û¥u~…ù6”[¥f*50÷Àª¾^s”¾†ïv&ø£¡M±ÛTÃ²²
åÊ„äÍZÎ–0í‹ÕŸ})ÌÊÁÅ=‹3½—ƒÑïñêY-a~oGý,Æö§¼ ayøAèZMù 0Ã]Ã`¢Iy:U‰C®çtL¯i™/ÂÝÀ˜éEÍjJ¦½Ç%È²?CÎm¶dû$Áí Æ‹‡uƒä¨—5­èQP7.Xw>æCÏžÄnÇž{ºµ=ð¯±['îBöZñOv$cðÊ•î~*Ûƒ(ÁE!,ÍÏ>ÉJEf`BýlÏ1C:s2g4ùR"ª9}¦3cÏEÏ±èðvÞàZ©Ø«…ˆwbÍ™;`4–vC-'ºæôië9zO>û¸³©!ˆªo‹Õª†>À@ aª»ÁÏÊï":¹'Tëöœ¼ ¨ÁuœÐä·ò
û|>Xïª‰àHïÄ´N-Ô;)lr"Õìj<Â…q	O ºájt±!cCN*I§9¨ÌÓÌüá¨ŠÞ®¢Ò_CTµ@¸LlÂHãË)ß…Œá+ÎWÄ|B(Š¸ï”H ¬à2Äí1‚€¦ØàÉSh¨T!«ièœ*"ÇWÇ„%QG³óïú83ß3ËJgŒ³„Zy©êÉò.ú¶…¦Ž‹Þæ¬Æ+œÉ[¥.¿'„´¦S…$µÀüŸ”Ž	bEwHÂ£Bî@„0ßÙ;<E2Fn´›¨hë!§á»I19-Â–—4ù™Ÿ<§4¼^×dÙñºKII0ûl{RWEæL„2ùw„ðj#Ÿ{0X¯ÍªA${#>ãzTu.òNÎ8*d)‡­KÐÜkƒ`ÀW&ü‰% “e1f{5hÛ±LÆ&4	’*¯:¸ïž¯-ºBJ¤¯Ô_zî!È¶âàÇ0'ñ:Ãaƒ“]õÀ?ž|]Š‚Ãü9èt°3aª‰±¾Æ¡ÖMÝs‡<‡ø1mOd5®Šà€m¢Yc¾Ô·’™šÐnºLNÂ>eV¯çEôº÷ÚàåÖ›¯<ŽÄh)¤ç~E.m¤L…ÅwpABk¥Œ{9]HT)úÏ²Û^C	K!×	2²Âµ¼è´‘UyÕgêk¹é5.$Ž’KcƒUåMkŸ0­¤¦ZÓ=v¦¸ûãüÑb›²pöµ>deQËaý¾ìSyQ:A}t‹ìW<éè»4|yÈYJo2 —Œš àVª÷ÜƒÄ‘èÕä,ó)»ÝÐGìš]éËŠîçàúš3U?×dµAug„	äåhæóÝHwÉ›ç1ªÅB±|ãŸŽþB‘	Èo’ì_ef†Ñ¦ˆx‡#k÷ßwyVN„ZõÍù©“É•
'Ïô®Fb€8¥ø¦7…ÞSëž±„’1"èÓ“ÛL©¥+À)&ºÆÕ9çâj~ÏK7êtÄ*§XJ8M	Üûzåc-Ñ#þ µ9¡JrCãP‰›íXŽeMÔ‚òdˆ™‰è6œ½EÕ†…±âó_èKCãÓíñH›ÊN„×ÿÝ,ï³'\sèõA6X6ÖÖ¾ÔbpI0ß%Ð#}øŒ‹#}Õ½oÐúÔÔ;¿I° Ð€ƒtüàŽ|ÔPNÆšÍÃ-÷®Æj)ÜÐÇöVíÝbdúÜ]|™6?OµÆñ®Í§ñÚîœ®†„w›ã½yZz=.Î’;­¢Hì ÅHstÊô§ºi‡J¡ríD,Î€F/cc¡}¥ã‡¯}¡V/]ˆÔ¶úP¸µD†ÓÎØ
ÏÏUãØzœšd_R±ªÎ×“I,ëm›˜pAÃÉ;vqkÁ·*A’L2ÝÑzŸÄ*¯7‚=†[õ€;ö;ç¾ _ðiÙÂþa¨„ïQÀèQ/Säªe'N›ÿ¦Ø£ÍÞ›Ýuîî:Í˜Œ–$:	ÔO„XÐÿRå«-§d¯epÅ©CU9é}©:(þ»‡õ~YÆj  £IŽá¤u]‘ Å6÷QÈ°-‰é¼ëß‚x¦¸Ñ-Ø2ç~~àY^× 	vu¾Ü¡(‚•&g…;&¿o\ôÞVä¶Ìœc¤#tpÙð|bR‘¡š/ë¾bû¿Ö”»*ÌeÈ±6†^ÿØfø‰dD¿¤×ê?]ë)w0,a«yØôû&û
2w!Œ³Çœtyì6cZçûª@…?ÀHÌ˜o„ax'ÎüðáPŽÔÁ)Úk,p\ˆN/¿io'ì1PJ"ËŠ´‘‚ä4Ã2È	ñ›tYÌ-[ãó§SüiKMeUŸœ½¤ë©Ì½wfìØÈMtuRïÞûE®“úæ]B’…‰Œ?ä £º§£]õ(¶+î~‹}ÛïÏb£cM0¬&{ðúoU›e9$—sAJÛ ì e~8û%Â%/ìÐðÉs,†Ã›v„fOÃ)ÀeÏ’×h‚kðÞXÍ‚_‚j ¥X}óG`aÆñ¾ßÎýqv˜Eõ®q#ÏQ:¼(ðSÕ²¤ÔL†c0ÂŸôäí§“ö¿Eª÷±8Äê#=ËÜÿæ£ÒŒ]ïj ±¯,OGŽx<=ö|nÔ(ö?N}<:w!%«tæ§°ÄýÊ#|ÈíŸQÎÞi.‚¨$ÒÐÛÇ¶pÚØ}Yµ¥´"ÖÜ¢h.dkd¸Ébí×\¿;c®QÛ¿¹c|Ì>TXl*¼éG¦ºp‹D?Áþ¸‰•þçW8ò)Ÿyü™Íi—BÆä[t¡¼Î§Ç‹%¸³j5m¼©¸žÍî,A@£v|Bø‹~:/3·rWT³Aö¢\˜ºz·Ä 3Á&$cvmý+™Î6"­ý/ßº„7UiuqP†$
¬¦þÙÐ\O:V—Uë…g2œ§ÇWz¿ÿ¢i7IçÏù90³Ÿ3+,,aé$Ê`‘ Ñ;í£ø“fnà±¶	u£;ñd/i\¿	§‚Á_F¬HÚÑðêoË2øÅc£Y‹uùGSäŸoè'ìå®~ÞNK¼«€ýëü2öÎ›V3Œ
Z‰íÐ½üßmçÔ<{/µBŽ¦ñU?[œ‘÷CD7‰€ÄRû”V»³'{—;ð=H·XoÄõ}²ðVë‚nMc÷Äô4à	«ËÑ±áN\Œ®®|`…äõð²	PËf¹@ ‚Îj‡
LþäÚ,?¥©û¯7ŠP#P¿Ž€LjwMÖ‘™Z|ÝÝ¾‘PgÝÎ:W1ltnØgÏ”;]ùôb&­G'EiEÈÎ¶2ìÅU`ƒü8pàŽ€åIÚ»ÅšËåG¼ÿa×â˜4íH&Y%«xÛÚgâr¾—FËœƒó„t5º¶Í‚UÞ…Ë“LŸP3•ÍWÌíV~‚ñ	4£=g?c`2t˜¿§ Þ(¡Q‰LQÕ¨2ØÕ 5:uk'=N	—N/‡C±­ì ‚RtZT(—-?«“…\ÓÖi(i
Y[yjß¥b–Mž_9i¡©Œ ®bxô†èçöé->üÿNrÏ®hÆR”þÔ@v\CâÛÔ’|Ì©yàtz­ÖÑjÃÅ =Ø©š>ÜÌ§ÊxEÓ·oBàÊGÁú³&sf˜ZÃTË aõwgŠK