#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

const PUBLIC_KEY_B64 = 'MCowBQYDK2VwAyEA0000000000000000000000000000000000000000000=';
const LIC_FILE = path.join(process.cwd(), '.parcelaudit.lic');

function verifyLicense(keyStr) {
  try {
    const [payloadB64, sigB64] = keyStr.trim().split('.');
    if (!payloadB64 || !sigB64) return false;
    const payload = Buffer.from(payloadB64, 'base64url').toString('utf8');
    if (!payload.includes('parcelaudit')) return false;
    const pubKey = crypto.createPublicKey({ key: Buffer.from(PUBLIC_KEY_B64, 'base64'), format: 'der', type: 'spki' });
    return crypto.verify(null, Buffer.from(payloadB64), pubKey, Buffer.from(sigB64, 'base64url'));
  } catch { return false; }
}

function auditRows(rows) {
  const claims = [], seen = new Set();
  for (const r of rows) {
    const [trk, carrier, service, billedWt, l, w, h, billedAmt, days] = r.split(',').map(s => s.trim());
    if (!trk || trk === 'TrackingNumber') continue;
    const amt = parseFloat(billedAmt) || 0, bWt = parseFloat(billedWt) || 0;
    const dimWt = Math.ceil(((parseFloat(l)||0) * (parseFloat(w)||0) * (parseFloat(h)||0)) / 139);
    const transit = parseInt(days, 10) || 0;
    if (seen.has(trk)) {
      claims.push({ trk, carrier, reason: 'Duplicate Billing', refund: amt.toFixed(2) });
    } else {
      seen.add(trk);
      if ((service || '').toLowerCase().includes('overnight') && transit > 1) {
        claims.push({ trk, carrier, reason: 'Guaranteed Service Late Delivery', refund: amt.toFixed(2) });
      } else if (dimWt > 0 && bWt > dimWt + 1) {
        claims.push({ trk, carrier, reason: `DIM Overcharge (Billed ${bWt}lb vs ${dimWt}lb)`, refund: (amt * ((bWt - dimWt) / bWt)).toFixed(2) });
      }
    }
  }
  return claims;
}

async function main() {
  console.log('\n======================================================');
  console.log('  📦 ParcelAudit Desktop v1.0.0 (100% Air-Gapped)');
  console.log('  UPS / FedEx / DHL / Canada Post Overcharge Auditor');
  console.log('  Store & Lifetime License: https://t.me/Userstudiobot/Store');
  console.log('======================================================\n');

  let licensed = fs.existsSync(LIC_FILE) && verifyLicense(fs.readFileSync(LIC_FILE, 'utf8'));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = q => new Promise(res => rl.question(q, res));

  if (!licensed) {
    console.log('🔒 Mode: FREE PREVIEW (Exports capped at 3 claim rows)');
    const k = await ask('🔑 Enter Lifetime License Key (or Enter for Free Preview): ');
    if (k.trim() && verifyLicense(k.trim())) {
      fs.writeFileSync(LIC_FILE, k.trim());
      licensed = true;
      console.log('✅ Lifetime License Activated!\n');
    } else if (k.trim()) {
      console.log('⚠️ Invalid key. Running in Free Preview mode.\n');
    }
  } else {
    console.log('✅ Status: LIFETIME LICENSE ACTIVE\n');
  }

  let csvPath = process.argv[2] || (await ask('📂 Drag & drop carrier CSV path (or Enter for sample): ')).trim().replace(/^['"]|['"]$/g, '');
  if (!csvPath || !fs.existsSync(csvPath)) {
    csvPath = path.join(process.cwd(), 'sample_carrier_invoice.csv');
    fs.writeFileSync(csvPath, 'TrackingNumber,Carrier,Service,BilledWeightLb,LengthIn,WidthIn,HeightIn,BilledAmountUSD,TransitDays\n1Z999AA10123456784,UPS,Next Day Air Overnight,12,10,8,6,68.50,3\n1Z999AA10123456784,UPS,Next Day Air Overnight,12,10,8,6,68.50,3\n794644790132,FedEx,Ground,18,12,10,8,29.40,4');
  }

  const claims = auditRows(fs.readFileSync(csvPath, 'utf8').split(/\r?\n/));
  const total = claims.reduce((s, c) => s + parseFloat(c.refund), 0);
  const outPath = path.join(process.cwd(), 'parcelaudit_claims_report.csv');
  fs.writeFileSync(outPath, ['TrackingNumber,Carrier,ClaimReason,RecoverableUSD', ...(licensed ? claims : claims.slice(0, 3)).map(c => `${c.trk},${c.carrier},"${c.reason}",${c.refund}`)].join('\n'));
  console.log(`\n📊 Found ${claims.length} overcharge claims totaling $${total.toFixed(2)} USD.`);
  console.log(`💾 Saved report to: ${outPath}\n`);
  rl.close();
}
main();
