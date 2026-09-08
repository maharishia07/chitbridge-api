const c = require('./connector.json');
fetch(c.api + '/api/integrations/profile-map', { headers: { 'X-Api-Key': c.key } })
  .then(r => r.json()).then(j => {
    const f = j.fields || {};
    for (const k of Object.keys(f))
      console.log((k + '                  ').slice(0, 20), '=', JSON.stringify(f[k].value), f[k].missing ? '  <== MISSING' : ('  (' + f[k].rung + ' / ' + f[k].source + ')'));
  }).catch(e => console.log('ERR', e.message));
