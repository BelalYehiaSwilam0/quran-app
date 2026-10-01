/* ═══════════════════════════════════════════════════════════════════════
   build-data.js — يولّد ملفات JSON لكل التوقيتات + النصوص
   شغّله مرة واحدة:  node scripts/build-data.js
   المتطلب: Node.js 18+ (لأن بيستخدم fetch المدمج)
   ═══════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');

const RECITERS = [
  { id: 1, key: 'husr',  name: 'الحصري' },
  { id: 2, key: 'afs',   name: 'العفاسي' },
  { id: 3, key: 'ajm',   name: 'العجمي' },
  { id: 4, key: 's_gmd', name: 'الغامدي' },
  { id: 5, key: 'sds',   name: 'السديس' },
  { id: 6, key: 'minsh', name: 'المنشاوي' },
];

const OUT = path.join(__dirname, '..', 'data');
const API_BASE = 'https://www.mp3quran.net/api/v3';
const TEXT_API = n => `https://api.alquran.cloud/v1/surah/${n}/quran-uthmani`;
const BISMILLAH = "بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ";
const BISMILLAH_REGEX = /^بِسْمِ\s+[ٱاأ]للَّهِ\s+[ٱاأ]لرَّحْم[َٰـ\u064B-\u0652]*نِ\s+[ٱاأ]لرَّحِيمِ\s+/u;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchJSON(url, retries = 4) {
  for (let i = 0; i < retries; i++) {
    try {
      const ctrl = new AbortController();
      const tmo = setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(tmo);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      if (i === retries - 1) throw e;
      await sleep(800 * (i + 1));
    }
  }
}

async function resolveTimingIds() {
  console.log('🔍 Resolving timing IDs from MP3Quran...');
  const reads = await fetchJSON(`${API_BASE}/ayat_timing/reads`);
  const map = {};
  for (const r of RECITERS) {
    const match = reads.find(x => x.name && x.name.includes(r.name));
    map[r.id] = match ? match.id : null;
    console.log(`  ${r.key}: ${match ? match.name + ' (id=' + match.id + ')' : '❌ NOT FOUND'}`);
  }
  return map;
}

async function fetchTimings(timingId, surah) {
  const data = await fetchJSON(`${API_BASE}/ayat_timing?surah=${surah}&read=${timingId}`);
  if (!Array.isArray(data) || !data.length) return null;
  const ayahs = {};
  for (const item of data) {
    if (typeof item.ayah === 'number') {
      ayahs[item.ayah] = { startTime: item.start_time / 1000, endTime: item.end_time / 1000 };
    }
  }
  if (surah === 1) {
    const ks = Object.keys(ayahs).map(Number).sort((a, b) => a - b);
    if (ks.length === 7 && ks[0] === 0 && ks[6] === 6) {
      const remapped = {};
      for (const k of ks) remapped[k + 1] = ayahs[k];
      for (const k of ks) delete ayahs[k];
      Object.assign(ayahs, remapped);
    }
  }
  return ayahs;
}

async function fetchText(surah) {
  const json = await fetchJSON(TEXT_API(surah));
  if (!json.data || !Array.isArray(json.data.ayahs)) return null;
  const ayahs = {};
  if (surah !== 1 && surah !== 9) ayahs[0] = BISMILLAH;
  for (const a of json.data.ayahs) {
    let text = a.text;
    if (a.numberInSurah === 1 && surah !== 1 && surah !== 9) {
      if (BISMILLAH_REGEX.test(text)) text = text.replace(BISMILLAH_REGEX, '').trim() || text;
    }
    ayahs[a.numberInSurah] = text;
  }
  return ayahs;
}

async function build() {
  fs.mkdirSync(OUT, { recursive: true });
  const timingIds = await resolveTimingIds();

  for (const rec of RECITERS) {
    const tid = timingIds[rec.id];
    if (!tid) { console.log(`⏭️  Skip ${rec.key}`); continue; }
    console.log(`\n📼 Building timings-${rec.id}.json (${rec.name})...`);
    const all = {};
    let ok = 0, fail = 0;
    for (let sn = 1; sn <= 114; sn++) {
      try {
        const t = await fetchTimings(tid, sn);
        if (t) { all[sn] = t; ok++; } else fail++;
      } catch (e) { fail++; }
      if (sn % 20 === 0) process.stdout.write(`  ${sn}/114 (ok=${ok}, fail=${fail})\n`);
      await sleep(40);
    }
        const file = path.join(OUT, `timings-${rec.id}.js`);
    fs.writeFileSync(file, `window.__TIMINGS_${rec.id}=${JSON.stringify(all)};`);
    console.log(`✅ ${path.basename(file)} — ${(fs.statSync(file).size / 1024).toFixed(1)} KB`);
  }

  console.log(`\n📖 Building texts.json...`);
  const texts = {};
  let okT = 0, failT = 0;
  for (let sn = 1; sn <= 114; sn++) {
    try {
      const t = await fetchText(sn);
      if (t) { texts[sn] = t; okT++; } else failT++;
    } catch (e) { failT++; }
    if (sn % 20 === 0) process.stdout.write(`  ${sn}/114 (ok=${okT}, fail=${failT})\n`);
    await sleep(40);
  }
   const textsFile = path.join(OUT, 'texts.js');
  fs.writeFileSync(textsFile, `window.__TEXTS=${JSON.stringify(texts)};`);
  console.log(`✅ texts.js — ${(fs.statSync(textsFile).size / 1024).toFixed(1)} KB`);

   console.log(`\n🎉 Done. Commit the data/ folder to git.`);
  console.log(`⚠️  امسح ملفات .json القديمة من data/`);
}

build().catch(e => { console.error('❌', e); process.exit(1); });