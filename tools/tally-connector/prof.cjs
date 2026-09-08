const c = require('./connector.json');
(async () => {
  const r = await fetch(c.api + '/api/integrations/profile', { method: 'POST',
    headers: { 'X-Api-Key': c.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'seed', fields: {
      legal_name: 'CB Test Traders', trade_name: 'CB Test Traders',
      gstin: '33AABCK1234F1Z6', reg_type: 'regular', state: 'Tamil Nadu',
      address: '16A-105 Perumbakkam Main Road', city: 'Chennai', pincode: '600126',
      country: 'IN', currency: 'INR', phone: '044 22592632' } }) });
  const j = await r.json();
  console.log('HTTP', r.status, '· written:', JSON.stringify(j.written), '· kept:', JSON.stringify(j.kept));
})();
