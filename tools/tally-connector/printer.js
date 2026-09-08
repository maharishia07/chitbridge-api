'use strict';
/**
 * printer.js — THE SLIP, ON PAPER (2026-09-08). Athi: *"can you detect the printer, I have now connected through USB, thermal
 * printer, not sure how to add it."*
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────────────────────────────────────────
 * The browser can only ever offer a PRINT DIALOG: a person has to pick the printer, the margins and the paper, on every bill. At a
 * counter with a queue that is not printing, it is an interruption with a printer attached. The little program runs ON the shop PC,
 * so it can send the bill straight to the till printer and be done — which is the whole reason the desktop version exists.
 *
 * ── WHAT IT SENDS ─────────────────────────────────────────────────────────────────────────────────────────────
 * ESC/POS: the command language every thermal receipt printer speaks — Epson TM series, and the hundred clones that copied it. Bold
 * for the total, double height for the shop's name, a partial cut at the end, and the pulse that opens a cash drawer. A driver
 * rendering an HTML page cannot do the cut or the drawer, which is why this is raw bytes and not a document.
 *
 * ── HOW IT REACHES THE PRINTER ON WINDOWS ─────────────────────────────────────────────────────────────────────
 * Through the spooler, by name — no sharing, no port guessing, no extra install. PowerShell compiles a few lines of C# that call
 * winspool.drv the way every POS application has since 1995 (OpenPrinter · StartDocPrinter · WritePrinter). RAW means the bytes reach
 * the printer untouched, which is the only way a cut command survives.
 * ⚠️ It needs a QUEUE to exist: a USB thermal printer with no driver installed is invisible to the spooler however well the cable is
 * plugged in. `list()` reports exactly what Windows can see, so the screen can say which of the two problems it is.
 *
 * ⚠️ IT NEVER BLOCKS A SALE (rule 4). Every failure here is reported and swallowed: the bill is already on disk and already queued
 * before anything is printed, and a shop with a jammed printer must go on selling.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const ESC = 0x1b, GS = 0x1d;
const B = (...a) => Buffer.from(a);

/* ── the language ────────────────────────────────────────────────────────────────────────────────────────────── */
const CMD = {
  init: B(ESC, 0x40),                       // wake up, forget whatever the last job left set
  boldOn: B(ESC, 0x45, 1), boldOff: B(ESC, 0x45, 0),
  left: B(ESC, 0x61, 0), centre: B(ESC, 0x61, 1), right: B(ESC, 0x61, 2),
  big: B(GS, 0x21, 0x11), normal: B(GS, 0x21, 0x00),   // double width AND height, then back
  feed: (n) => B(ESC, 0x64, n),
  cut: B(GS, 0x56, 66, 0),                  // partial cut, after feeding the paper clear of the head
  /* ⚠️ THE DRAWER IS NOT A PRINTER COMMAND, it is a pulse on the printer's kick-out socket. 100 ms on, 100 ms off — the figures
     every drawer maker prints on the box. Sending it when no drawer is attached does nothing at all. */
  drawer: B(ESC, 0x70, 0, 25, 250),
};

/** what a receipt printer can hold on one line: 42 characters at 80 mm, 32 at 58 mm */
function widthOf(mm) { return Number(mm) === 58 ? 32 : 42; }

/* ── laying out a line of a bill ─────────────────────────────────────────────────────────────────────────────── */
/** "Rice 25 kg .................. 1,180.00" — the two halves of every receipt line there has ever been */
function pair(left, right, w) {
  const l = String(left == null ? '' : left), r = String(right == null ? '' : right);
  if (l.length + r.length + 1 > w) return l.slice(0, Math.max(0, w - r.length - 1)) + ' ' + r;
  return l + ' '.repeat(w - l.length - r.length) + r;
}
const centre = (t, w) => { const s = String(t || ''); const pad = Math.max(0, Math.floor((w - s.length) / 2)); return ' '.repeat(pad) + s; };
const rule = (w, ch) => (ch || '-').repeat(w);
/** a long product name wraps rather than being cut off — a customer must be able to read what they bought */
function wrap(t, w) {
  const words = String(t || '').split(/\s+/).filter(Boolean);
  const out = []; let line = '';
  for (const word of words) {
    if (!line.length) line = word;
    else if ((line + ' ' + word).length <= w) line += ' ' + word;
    else { out.push(line); line = word; }
  }
  if (line.length) out.push(line);
  return out.length ? out : [''];
}
const money = (n) => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);

/**
 * ⭐ THE SAME BILL THE SCREEN SHOWED, AS PAPER. It takes the document the counter already built — a sale, a goods receipt or a
 * despatch note — and lays it out for a roll. Nothing is recalculated here: a printer that did its own arithmetic would be a second
 * opinion about money.
 */
function slipBytes(doc, shop, opts) {
  const o = opts || {};
  const w = widthOf(o.mm);
  const parts = [CMD.init];
  const line = (t) => { parts.push(Buffer.from(String(t == null ? '' : t) + '\n', 'binary')); };
  const kind = doc.kind === 'receipt' ? 'receipt' : (doc.kind === 'despatch' ? 'despatch' : 'bill');

  parts.push(CMD.centre, CMD.big);
  line((shop && shop.name) || '');
  parts.push(CMD.normal);
  if (shop && shop.address) wrap(shop.address, w).forEach(line);
  if (shop && shop.phone) line('Ph ' + shop.phone);
  if (shop && shop.gstin && kind === 'bill' && doc.kind !== 'cash') line('GSTIN ' + shop.gstin);

  parts.push(CMD.boldOn);
  line(kind === 'receipt' ? 'GOODS RECEIVED' : (kind === 'despatch' ? 'PACKING SLIP' : title(doc)));
  parts.push(CMD.boldOff, CMD.left);
  line(rule(w));

  line(pair(doc.no || '', new Date(doc.at || Date.now()).toLocaleString(), w));
  if (kind === 'bill') line(pair((doc.by && doc.by.name) || '', (doc.customer && doc.customer.name) || 'Walk-in', w));
  if (kind === 'receipt') {
    line(pair('From', (doc.vendor && doc.vendor.name) || ''));
    if (doc.their_bill && doc.their_bill.no) line(pair('Their bill', doc.their_bill.no, w));
  }
  if (kind === 'despatch') {
    line(pair('To', (doc.against && doc.against.party) || '', w));
    if (doc.ref) line(pair('LR / vehicle', doc.ref, w));
    line(pair('Cartons', String(doc.cartons || 1) + (doc.weight ? ' · ' + doc.weight + ' kg' : ''), w));
  }
  line(rule(w));

  for (const l of (doc.lines || [])) {
    const qty = kind === 'receipt' ? l.counted : (kind === 'despatch' ? l.picked : l.qty);
    const amount = kind === 'despatch' ? (qty + ' ' + (l.unit || '')) : money(kind === 'receipt' ? l.value : l.net);
    wrap(l.name, w).forEach(line);
    let sub = '  ' + qty + ' ' + (l.unit || '');
    if (kind !== 'despatch' && l.price != null) sub += ' x ' + money(l.price);
    if (kind !== 'despatch' && l.rate != null) sub += ' x ' + money(l.rate);
    line(pair(sub, amount, w));
    if (kind === 'bill' && l.off) line('  offer -' + money(l.save));
    if (kind === 'receipt' && l.difference) line('  ' + (l.difference > 0 ? 'excess ' + l.difference : 'short ' + (-l.difference)) + (l.reason ? ' · ' + l.reason : ''));
    if (kind === 'despatch' && l.short > 0) line('  short ' + l.short + (l.reason ? ' · ' + l.reason : ''));
  }
  line(rule(w));

  if (kind === 'bill') {
    if (doc.saved > 0) line(pair('You saved', '-' + money(doc.saved), w));
    if (doc.kind === 'tax') { line(pair('Taxable', money(doc.taxable), w)); line(pair('GST', money(doc.tax), w)); }
    parts.push(CMD.boldOn); line(pair('TOTAL', money(doc.total), w)); parts.push(CMD.boldOff);
    for (const p of (doc.payments || [])) line(pair(p.how, money(p.amount), w));
    if (doc.change > 0) line(pair('Change', money(doc.change), w));
  } else if (kind === 'receipt') {
    line(pair('Goods', money(doc.goods), w));
    if (doc.extras > 0) line(pair('Freight and costs', money(doc.extras), w));
    parts.push(CMD.boldOn); line(pair('LANDED', money(doc.landed_total), w)); parts.push(CMD.boldOff);
    if (doc.their_bill && doc.their_bill.total != null) line(pair('Their bill says', money(doc.their_bill.total), w));
  }

  line(rule(w));
  parts.push(CMD.centre);
  if (kind === 'bill') line('Thank you · visit again');
  if (kind === 'receipt') line('What we counted.');
  if (kind === 'despatch') line('Check this before signing.');
  line('Billed on ChitBridge');
  parts.push(CMD.left, CMD.feed(4));
  if (o.drawer && kind === 'bill') parts.push(CMD.drawer);   /* only a sale opens a drawer */
  if (o.cut !== false) parts.push(CMD.cut);
  return Buffer.concat(parts);
}
function title(doc) { return doc.kind === 'tax' ? 'TAX INVOICE' : (doc.kind === 'supply' ? 'BILL OF SUPPLY' : 'CASH MEMO'); }

/* ── Windows: what is installed, and sending bytes to it ─────────────────────────────────────────────────────── */
const ps = (script, cb) => execFile('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
  { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, cb);

/**
 * every printer Windows can see, and whether one of them looks like a receipt printer.
 * ⚠️ A USB THERMAL PRINTER WITH NO DRIVER IS NOT IN THIS LIST however well the cable is plugged in — so the screen can tell the
 * difference between "no printer" and "no driver", which are two completely different jobs for the shopkeeper.
 */
function list(cb) {
  if (process.platform !== 'win32') return cb(null, { printers: [], why: 'this is not Windows' });
  ps('Get-Printer | Select-Object Name,DriverName,PortName,PrinterStatus | ConvertTo-Json -Compress', (err, out) => {
    if (err) return cb(null, { printers: [], why: String(err.message || err).slice(0, 200) });
    let rows = [];
    try { const j = JSON.parse(String(out || '[]').trim() || '[]'); rows = Array.isArray(j) ? j : [j]; } catch (_) { rows = []; }
    const looksThermal = (r) => /tm-|thermal|receipt|pos-?\d|epson|star |bixolon|rongta|tvs |80mm|58mm/i.test(String(r.Name) + ' ' + String(r.DriverName));
    cb(null, { printers: rows.map((r) => ({ name: r.Name, driver: r.DriverName, port: r.PortName, status: r.PrinterStatus, thermal: looksThermal(r) })) });
  });
}

/**
 * ⭐ RAW, THROUGH THE SPOOLER, BY NAME. The few lines of C# below are the Win32 calls every POS application has used for thirty
 * years; PowerShell compiles them on the spot, so there is nothing to install and nothing to share.
 * ⚠️ RAW is the point. Anything that renders — Out-Printer, a driver's own dialog — will silently drop the cut and the drawer pulse,
 * because those are not characters.
 */
const RAW_CS = [
  'using System;using System.IO;using System.Runtime.InteropServices;',
  'public class CBRaw{',
  ' [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] public class DOCINFO{ [MarshalAs(UnmanagedType.LPWStr)] public string pDocName; [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile; [MarshalAs(UnmanagedType.LPWStr)] public string pDataType; }',
  ' [DllImport("winspool.drv",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool OpenPrinter(string src,out IntPtr h,IntPtr pd);',
  ' [DllImport("winspool.drv",SetLastError=true)] static extern bool ClosePrinter(IntPtr h);',
  ' [DllImport("winspool.drv",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool StartDocPrinter(IntPtr h,int level,[In,MarshalAs(UnmanagedType.LPStruct)] DOCINFO di);',
  ' [DllImport("winspool.drv",SetLastError=true)] static extern bool EndDocPrinter(IntPtr h);',
  ' [DllImport("winspool.drv",SetLastError=true)] static extern bool StartPagePrinter(IntPtr h);',
  ' [DllImport("winspool.drv",SetLastError=true)] static extern bool EndPagePrinter(IntPtr h);',
  ' [DllImport("winspool.drv",SetLastError=true)] static extern bool WritePrinter(IntPtr h,IntPtr buf,int count,out int written);',
  ' public static void Send(string printer,string file){',
  '  byte[] bytes=File.ReadAllBytes(file); IntPtr h; if(!OpenPrinter(printer,out h,IntPtr.Zero)) throw new Exception("the spooler would not open "+printer);',
  '  try{ DOCINFO di=new DOCINFO(); di.pDocName="ChitBridge slip"; di.pDataType="RAW";',
  '   if(!StartDocPrinter(h,1,di)) throw new Exception("the printer refused the job");',
  '   StartPagePrinter(h); IntPtr p=Marshal.AllocCoTaskMem(bytes.Length); Marshal.Copy(bytes,0,p,bytes.Length); int wrote;',
  '   WritePrinter(h,p,bytes.Length,out wrote); Marshal.FreeCoTaskMem(p); EndPagePrinter(h); EndDocPrinter(h);',
  '  } finally { ClosePrinter(h); } } }',
].join('');

function sendRaw(printer, buf, cb) {
  if (process.platform !== 'win32') return cb(new Error('printing straight to a printer is Windows-only for now'));
  const file = path.join(os.tmpdir(), 'cb-slip-' + Date.now() + '.bin');
  try { fs.writeFileSync(file, buf); } catch (e) { return cb(e); }
  const script = "Add-Type -TypeDefinition @'\n" + RAW_CS + "\n'@ ; [CBRaw]::Send('" + String(printer).replace(/'/g, "''") + "','" + file.replace(/'/g, "''") + "')";
  ps(script, (err, out, errOut) => {
    try { fs.unlinkSync(file); } catch (_) {}
    if (err) return cb(new Error(String((errOut || err.message || '')).split('\n')[0].slice(0, 200)));
    cb(null, { ok: true });
  });
}

/** the whole job: lay the document out and send it. Never throws — a printer is never allowed to cost a sale. */
function print(doc, shop, opts, cb) {
  const o = opts || {};
  if (!o.printer) return cb(null, { ok: false, why: 'no printer chosen yet' });
  let buf;
  try { buf = slipBytes(doc, shop, o); } catch (e) { return cb(null, { ok: false, why: 'the slip could not be laid out: ' + e.message }); }
  sendRaw(o.printer, buf, (err) => cb(null, err ? { ok: false, why: err.message } : { ok: true }));
}

/** a page of proof: every width, the cut, and the drawer if one is attached */
function testPage(shop, opts) {
  const w = widthOf((opts || {}).mm);
  return slipBytes({
    kind: 'cash', no: 'TEST', at: new Date().toISOString(),
    customer: { name: 'Test print' }, by: { name: 'ChitBridge' },
    lines: [{ name: 'If you can read this line, the printer is set up', qty: 1, unit: 'test', price: 0, net: 0 },
            { name: 'A long product name that has to wrap onto a second line so the customer can still read what they bought', qty: 2, unit: 'piece', price: 12.5, net: 25 }],
    total: 25, payments: [{ how: 'Cash', amount: 25 }], change: 0, saved: 0,
  }, shop || { name: 'Test print', address: String(w) + ' characters wide' }, opts);
}

module.exports = { list, print, testPage, slipBytes, sendRaw, widthOf, pair, wrap };
