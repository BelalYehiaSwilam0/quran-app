(function(){
"use strict";

/* ═══════════════════════════════════════════════════════════════════════
   QURAN PLAYER v31.3 — Production Ready
   ✅ v30: OfflineResume + Force-reload + Unlimited retry + RAF + LRU
   ✅ v31: Prefetcher — تحميل كل timings + texts في الخلفية (تلقائي، نسبي)
   ✅ v31.3: إزالة polling — الاعتماد على online event + visibilitychange فقط
           (صفر timers مستمرة، صفر استهلاك موارد في الخلفية)
   ═══════════════════════════════════════════════════════════════════════ */
const CONFIG = {
  padTo: 3, defaultVolume: 0.9, defaultSpeed: 1, defaultEndBuffer: 0.05,
  storageKey: "quran-player-v24", themeStorageKey: "quran-player-theme",
  saveDebounceMs: 1200, toastDurationMs: 2800,
  apiBaseUrl: "https://www.mp3quran.net/api/v3",
  textApiBaseUrl: "https://api.alquran.cloud/v1/surah/{n}/quran-uthmani",
  autoClosePanelDelayMs: 450, maxRepeatCount: 100,
  repeatRestartDelayMs: 300, silentSwitchMs: 1500, themeFreezeMs: 60,
  downloadConcurrency: 2, ayahBoundaryBufferMs: 150,
  idbName: "quran-player-downloads", idbStore: "audio", idbVersion: 2,
  idbTimingsStore: "timings", idbTextsStore: "texts",
  TIMINGS_CACHE_MAX: 30, TEXTS_CACHE_MAX: 30, FAILED_FETCHES_MAX: 20,
  PLAYING_SAVE_INTERVAL_MS: 45000, SAVE_DELTA_SEC: 3,
  OFFLINE_RESUME_KEY: "quran-offline-resume-v1",
  OFFLINE_RESUME_MAX_AGE: 6 * 3600 * 1000,
  OFFLINE_RETRY_DELAY_MS: 2000,
  OFFLINE_MAX_RETRIES: 30,
  LS_MAX_BYTES: 10 * 1024 * 1024,
  SUBTITLE_THROTTLE_MS: 250,
  /* ⭐ v31: إعدادات الـ Prefetcher */
  PREFETCH_CONCURRENCY: 3,
  PREFETCH_DELAY_MS: 120,
  PREFETCH_RETRY_MAX: 3,
  PREFETCH_LS_KEY: "quran-prefetch-state-v1",
  PREFETCH_AUTOSTART_DELAY_MS: 4000,
  fatihahWeights: [13, 13, 7, 10, 13, 10, 34],
  reciters: [
    { id: 1, name: "محمود خليل الحصري", rewayah: "حفص عن عاصم", server: "https://server13.mp3quran.net/husr/", timingKeys: ["الحصري"] },
    { id: 2, name: "مشاري راشد العفاسي", rewayah: "حفص عن عاصم", server: "https://server8.mp3quran.net/afs/", timingKeys: ["العفاسي"] },
    { id: 3, name: "أحمد بن علي العجمي", rewayah: "حفص عن عاصم", server: "https://server10.mp3quran.net/ajm/", timingKeys: ["العجمي"] },
    { id: 4, name: "سعد الغامدي", rewayah: "حفص عن عاصم", server: "https://server7.mp3quran.net/s_gmd/", timingKeys: ["الغامدي"] },
    { id: 5, name: "عبد الرحمن السديس", rewayah: "حفص عن عاصم", server: "https://server11.mp3quran.net/sds/", timingKeys: ["السديس"] },
    { id: 6, name: "محمد صديق المنشاوي", rewayah: "حفص - مرتل", server: "https://server10.mp3quran.net/minsh/", timingKeys: ["المنشاوي", "المنشاوى"] },
  ],
};
const RECITER_MAP = new Map(CONFIG.reciters.map(r => [r.id, r]));
const FATIHAH_TOTAL_WEIGHT = CONFIG.fatihahWeights.reduce((a, b) => a + b, 0);

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const pad = n => String(n).padStart(CONFIG.padTo, "0");
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const fmtTime = (sec) => { if (!isFinite(sec) || sec < 0) sec = 0; sec = Math.floor(sec); const h = (sec / 3600) | 0, m = ((sec % 3600) / 60) | 0, s = sec % 60; const p = v => String(v).padStart(2, "0"); return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`; };
const esc = str => String(str).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
const debounce = (fn, ms) => { let t; return function(...a){ clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); }; };
const fmtBytes = (b) => { if (!b || b < 1024) return (b || 0) + " B"; if (b < 1048576) return (b / 1024).toFixed(1) + " KB"; if (b < 1073741824) return (b / 1048576).toFixed(2) + " MB"; return (b / 1073741824).toFixed(2) + " GB"; };

const AR_DIGITS = { '٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9', '۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9' };
const arabicToEnglish = (str) => String(str).replace(/[٠-٩۰-۹]/g, ch => AR_DIGITS[ch] || ch);

function lsSafeSet(key, value) {
  try {
    const v = typeof value === "string" ? value : JSON.stringify(value);
    const estBytes = (key.length + v.length) * 2;
    if (estBytes > CONFIG.LS_MAX_BYTES) return false;
    localStorage.setItem(key, v);
    return true;
  } catch(_) { return false; }
}
function lsSafeGet(key) { try { return localStorage.getItem(key); } catch(_) { return null; } }
function lsSafeRemove(key) { try { localStorage.removeItem(key); } catch(_){} }

function createLRU(max) {
  const map = new Map();
  return {
    has: k => map.has(k),
    get(k) { if (!map.has(k)) return undefined; const v = map.get(k); map.delete(k); map.set(k, v); return v; },
    set(k, v) { if (map.has(k)) map.delete(k); map.set(k, v); if (map.size > max) { const f = map.keys().next().value; map.delete(f); } },
    delete: k => map.delete(k),
    clear: () => map.clear(),
    get size() { return map.size; }
  };
}

const emptyRange = () => ({ active: false, surah: null, endSurah: null, crossSurah: false, phase: "leg1", mode: "ayah", startAyah: null, endAyah: null, startTime: 0, endTime: 0, _pendingMode: "ayah", estimated: false, openEnded: false, repeatCount: 1, repeatIndex: 0, sameSurah: false });

function getFatihahEstimated(duration) {
  if (!isFinite(duration) || duration <= 0) return null;
  const perUnit = duration / FATIHAH_TOTAL_WEIGHT;
  const ayahs = {};
  let cum = 0;
  for (let i = 0; i < 7; i++) { ayahs[i + 1] = { startTime: cum * perUnit, endTime: (cum + CONFIG.fatihahWeights[i]) * perUnit }; cum += CONFIG.fatihahWeights[i]; }
  for (let i = 1; i <= 6; i++) ayahs[i].endTime = ayahs[i + 1].startTime;
  return ayahs;
}

const IDB = {
  _db: null,
  async open() { if (this._db) return this._db; return new Promise((res, rej) => { const req = indexedDB.open(CONFIG.idbName, CONFIG.idbVersion); req.onupgradeneeded = e => { const db = e.target.result; if (!db.objectStoreNames.contains(CONFIG.idbStore)) { const st = db.createObjectStore(CONFIG.idbStore, { keyPath: "key" }); st.createIndex("reciterId", "reciterId", { unique: false }); } if (!db.objectStoreNames.contains(CONFIG.idbTimingsStore)) db.createObjectStore(CONFIG.idbTimingsStore, { keyPath: "key" }); if (!db.objectStoreNames.contains(CONFIG.idbTextsStore)) db.createObjectStore(CONFIG.idbTextsStore, { keyPath: "key" }); }; req.onsuccess = () => { this._db = req.result; res(this._db); }; req.onerror = () => rej(req.error); }); },
  async put(rec) { const db = await this.open(); return new Promise((res, rej) => { const tx = db.transaction(CONFIG.idbStore, "readwrite"); tx.objectStore(CONFIG.idbStore).put(rec); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); },
  async getAll() { const db = await this.open(); return new Promise((res, rej) => { const req = db.transaction(CONFIG.idbStore, "readonly").objectStore(CONFIG.idbStore).getAll(); req.onsuccess = () => res(req.result || []); req.onerror = () => rej(req.error); }); },
  async delete(key) { const db = await this.open(); return new Promise((res, rej) => { const tx = db.transaction(CONFIG.idbStore, "readwrite"); tx.objectStore(CONFIG.idbStore).delete(key); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); },
  async clear() { const db = await this.open(); return new Promise((res, rej) => { const tx = db.transaction(CONFIG.idbStore, "readwrite"); tx.objectStore(CONFIG.idbStore).clear(); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); },
  async putTiming(rid, surah, ayahs) { const db = await this.open(); return new Promise((res, rej) => { const tx = db.transaction(CONFIG.idbTimingsStore, "readwrite"); tx.objectStore(CONFIG.idbTimingsStore).put({ key: `${rid}-${surah}`, reciterId: rid, surah, ayahs, ts: Date.now() }); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); },
  async getTiming(rid, surah) { const db = await this.open(); return new Promise((res, rej) => { const req = db.transaction(CONFIG.idbTimingsStore, "readonly").objectStore(CONFIG.idbTimingsStore).get(`${rid}-${surah}`); req.onsuccess = () => res(req.result || null); req.onerror = () => rej(req.error); }); },
  async getAllTimings() { const db = await this.open(); return new Promise((res, rej) => { const req = db.transaction(CONFIG.idbTimingsStore, "readonly").objectStore(CONFIG.idbTimingsStore).getAll(); req.onsuccess = () => res(req.result || []); req.onerror = () => rej(req.error); }); },
  async getAllTimingKeys() { const db = await this.open(); return new Promise((res, rej) => { const req = db.transaction(CONFIG.idbTimingsStore, "readonly").objectStore(CONFIG.idbTimingsStore).getAllKeys(); req.onsuccess = () => res(req.result || []); req.onerror = () => rej(req.error); }); },
  async deleteTiming(rid, surah) { const db = await this.open(); return new Promise((res, rej) => { const tx = db.transaction(CONFIG.idbTimingsStore, "readwrite"); tx.objectStore(CONFIG.idbTimingsStore).delete(`${rid}-${surah}`); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); },
  async clearTimings() { const db = await this.open(); return new Promise((res, rej) => { const tx = db.transaction(CONFIG.idbTimingsStore, "readwrite"); tx.objectStore(CONFIG.idbTimingsStore).clear(); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); },
  async putText(surah, ayahs) { const db = await this.open(); return new Promise((res, rej) => { const tx = db.transaction(CONFIG.idbTextsStore, "readwrite"); tx.objectStore(CONFIG.idbTextsStore).put({ key: surah, ayahs, ts: Date.now() }); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); },
  async getText(surah) { const db = await this.open(); return new Promise((res, rej) => { const req = db.transaction(CONFIG.idbTextsStore, "readonly").objectStore(CONFIG.idbTextsStore).get(surah); req.onsuccess = () => res(req.result || null); req.onerror = () => rej(req.error); }); },
  async getAllTexts() { const db = await this.open(); return new Promise((res, rej) => { const req = db.transaction(CONFIG.idbTextsStore, "readonly").objectStore(CONFIG.idbTextsStore).getAll(); req.onsuccess = () => res(req.result || []); req.onerror = () => rej(req.error); }); },
  async getAllTextKeys() { const db = await this.open(); return new Promise((res, rej) => { const req = db.transaction(CONFIG.idbTextsStore, "readonly").objectStore(CONFIG.idbTextsStore).getAllKeys(); req.onsuccess = () => res(req.result || []); req.onerror = () => rej(req.error); }); },
  async deleteText(surah) { const db = await this.open(); return new Promise((res, rej) => { const tx = db.transaction(CONFIG.idbTextsStore, "readwrite"); tx.objectStore(CONFIG.idbTextsStore).delete(surah); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); },
  async clearTexts() { const db = await this.open(); return new Promise((res, rej) => { const tx = db.transaction(CONFIG.idbTextsStore, "readwrite"); tx.objectStore(CONFIG.idbTextsStore).clear(); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); },
};

const Theme = {
  ICONS: { sun: '<circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5m0 15v2.5M2 12h2.5m15 0H22M4.93 4.93l1.77 1.77m10.6 10.6l1.77 1.77M4.93 19.07l1.77-1.77m10.6-10.6l1.77-1.77" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>', moon: '<path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5c0-.34.02-.68.06-1A9 9 0 1 0 21.5 14.44c-.32.04-.66.06-1 .06z"/>' },
  get() { try { const s = lsSafeGet(CONFIG.themeStorageKey); if (s === "light" || s === "dark") return s; } catch(_){} try { if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) return "light"; } catch(_){} return "dark"; },
  apply(t) { document.documentElement.setAttribute("data-theme", t); const i = document.getElementById("themeIcon"); if (i) i.innerHTML = t === "dark" ? this.ICONS.sun : this.ICONS.moon; const mi = document.getElementById("msThemeIcon"); if (mi) mi.innerHTML = t === "dark" ? this.ICONS.sun : this.ICONS.moon; const mv = document.getElementById("msThemeValue"); if (mv) mv.textContent = t === "dark" ? "ليلي" : "نهاري"; const m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute("content", t === "light" ? "#f6f2e8" : "#0a0d13"); },
  toggle() { const cur = document.documentElement.getAttribute("data-theme") || "dark"; const nxt = cur === "dark" ? "light" : "dark"; document.documentElement.classList.add("theme-switching"); this.apply(nxt); requestAnimationFrame(() => setTimeout(() => document.documentElement.classList.remove("theme-switching"), CONFIG.themeFreezeMs)); lsSafeSet(CONFIG.themeStorageKey, nxt); return nxt; },
  init() { this.apply(this.get()); }
};
(function(){ try { const s = lsSafeGet(CONFIG.themeStorageKey); let t = "dark"; if (s === "light" || s === "dark") t = s; else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) t = "light"; document.documentElement.setAttribute("data-theme", t); } catch(_){} })();

const RAW = [[1,"الفاتحة","Al-Fatihah",7,"مكية"],[2,"البقرة","Al-Baqarah",286,"مدنية"],[3,"آل عمران","Aal-Imran",200,"مدنية"],[4,"النساء","An-Nisa",176,"مدنية"],[5,"المائدة","Al-Ma'idah",120,"مدنية"],[6,"الأنعام","Al-An'am",165,"مكية"],[7,"الأعراف","Al-A'raf",206,"مكية"],[8,"الأنفال","Al-Anfal",75,"مدنية"],[9,"التوبة","At-Tawbah",129,"مدنية"],[10,"يونس","Yunus",109,"مكية"],[11,"هود","Hud",123,"مكية"],[12,"يوسف","Yusuf",111,"مكية"],[13,"الرعد","Ar-Ra'd",43,"مدنية"],[14,"إبراهيم","Ibrahim",52,"مكية"],[15,"الحجر","Al-Hijr",99,"مكية"],[16,"النحل","An-Nahl",128,"مكية"],[17,"الإسراء","Al-Isra",111,"مكية"],[18,"الكهف","Al-Kahf",110,"مكية"],[19,"مريم","Maryam",98,"مكية"],[20,"طه","Taha",135,"مكية"],[21,"الأنبياء","Al-Anbiya",112,"مكية"],[22,"الحج","Al-Hajj",78,"مدنية"],[23,"المؤمنون","Al-Mu'minun",118,"مكية"],[24,"النور","An-Nur",64,"مدنية"],[25,"الفرقان","Al-Furqan",77,"مكية"],[26,"الشعراء","Ash-Shu'ara",227,"مكية"],[27,"النمل","An-Naml",93,"مكية"],[28,"القصص","Al-Qasas",88,"مكية"],[29,"العنكبوت","Al-Ankabut",69,"مكية"],[30,"الروم","Ar-Rum",60,"مكية"],[31,"لقمان","Luqman",34,"مكية"],[32,"السجدة","As-Sajdah",30,"مكية"],[33,"الأحزاب","Al-Ahzab",73,"مدنية"],[34,"سبأ","Saba",54,"مكية"],[35,"فاطر","Fatir",45,"مكية"],[36,"يس","Ya-Sin",83,"مكية"],[37,"الصافات","As-Saffat",182,"مكية"],[38,"ص","Sad",88,"مكية"],[39,"الزمر","Az-Zumar",75,"مكية"],[40,"غافر","Ghafir",85,"مكية"],[41,"فصلت","Fussilat",54,"مكية"],[42,"الشورى","Ash-Shura",53,"مكية"],[43,"الزخرف","Az-Zukhruf",89,"مكية"],[44,"الدخان","Ad-Dukhan",59,"مكية"],[45,"الجاثية","Al-Jathiyah",37,"مكية"],[46,"الأحقاف","Al-Ahqaf",35,"مكية"],[47,"محمد","Muhammad",38,"مدنية"],[48,"الفتح","Al-Fath",29,"مدنية"],[49,"الحجرات","Al-Hujurat",18,"مدنية"],[50,"ق","Qaf",45,"مكية"],[51,"الذاريات","Adh-Dhariyat",60,"مكية"],[52,"الطور","At-Tur",49,"مكية"],[53,"النجم","An-Najm",62,"مكية"],[54,"القمر","Al-Qamar",55,"مكية"],[55,"الرحمن","Ar-Rahman",78,"مدنية"],[56,"الواقعة","Al-Waqi'ah",96,"مكية"],[57,"الحديد","Al-Hadid",29,"مدنية"],[58,"المجادلة","Al-Mujadilah",22,"مدنية"],[59,"الحشر","Al-Hashr",24,"مدنية"],[60,"الممتحنة","Al-Mumtahanah",13,"مدنية"],[61,"الصف","As-Saff",14,"مدنية"],[62,"الجمعة","Al-Jumu'ah",11,"مدنية"],[63,"المنافقون","Al-Munafiqun",11,"مدنية"],[64,"التغابن","At-Taghabun",18,"مدنية"],[65,"الطلاق","At-Talaq",12,"مدنية"],[66,"التحريم","At-Tahrim",12,"مدنية"],[67,"الملك","Al-Mulk",30,"مكية"],[68,"القلم","Al-Qalam",52,"مكية"],[69,"الحاقة","Al-Haqqah",52,"مكية"],[70,"المعارج","Al-Ma'arij",44,"مكية"],[71,"نوح","Nuh",28,"مكية"],[72,"الجن","Al-Jinn",28,"مكية"],[73,"المزمل","Al-Muzzammil",20,"مكية"],[74,"المدثر","Al-Muddaththir",56,"مكية"],[75,"القيامة","Al-Qiyamah",40,"مكية"],[76,"الإنسان","Al-Insan",31,"مدنية"],[77,"المرسلات","Al-Mursalat",50,"مكية"],[78,"النبأ","An-Naba",40,"مكية"],[79,"النازعات","An-Nazi'at",46,"مكية"],[80,"عبس","Abasa",42,"مكية"],[81,"التكوير","At-Takwir",29,"مكية"],[82,"الانفطار","Al-Infitar",19,"مكية"],[83,"المطففين","Al-Mutaffifin",36,"مكية"],[84,"الانشقاق","Al-Inshiqaq",25,"مكية"],[85,"البروج","Al-Buruj",22,"مكية"],[86,"الطارق","At-Tariq",17,"مكية"],[87,"الأعلى","Al-A'la",19,"مكية"],[88,"الغاشية","Al-Ghashiyah",26,"مكية"],[89,"الفجر","Al-Fajr",30,"مكية"],[90,"البلد","Al-Balad",20,"مكية"],[91,"الشمس","Ash-Shams",15,"مكية"],[92,"الليل","Al-Layl",21,"مكية"],[93,"الضحى","Ad-Duha",11,"مكية"],[94,"الشرح","Ash-Sharh",8,"مكية"],[95,"التين","At-Tin",8,"مكية"],[96,"العلق","Al-Alaq",19,"مكية"],[97,"القدر","Al-Qadr",5,"مكية"],[98,"البينة","Al-Bayyinah",8,"مدنية"],[99,"الزلزلة","Az-Zalzalah",8,"مدنية"],[100,"العاديات","Al-Adiyat",11,"مكية"],[101,"القارعة","Al-Qari'ah",11,"مكية"],[102,"التكاثر","At-Takathur",8,"مكية"],[103,"العصر","Al-Asr",3,"مكية"],[104,"الهمزة","Al-Humazah",9,"مكية"],[105,"الفيل","Al-Fil",5,"مكية"],[106,"قريش","Quraysh",4,"مكية"],[107,"الماعون","Al-Ma'un",7,"مكية"],[108,"الكوثر","Al-Kawthar",3,"مكية"],[109,"الكافرون","Al-Kafirun",6,"مكية"],[110,"النصر","An-Nasr",3,"مدنية"],[111,"المسد","Al-Masad",5,"مكية"],[112,"الإخلاص","Al-Ikhlas",4,"مكية"],[113,"الفلق","Al-Falaq",5,"مكية"],[114,"الناس","An-Nas",6,"مكية"]];
const SURAHS = RAW.map(([number, nameAr, nameEn, ayahs, type]) => ({ number, nameAr, nameEn, ayahs, type }));
const SURAH_MAP = new Map(SURAHS.map(s => [s.number, s]));

const state = { current: null, playing: false, mode: "seq", queue: [], qIndex: -1, volume: CONFIG.defaultVolume, speed: CONFIG.defaultSpeed, shuffle: false, repeat: "off", search: "", lastPlayed: null, currentTime: 0, _prevVolume: CONFIG.defaultVolume, _restoredFromSaved: false, _playIntent: false, _lastSavedTime: 0, _lastSavedSignature: "", _lastKnownDuration: 0, _tabVisible: !document.hidden, _loadedRid: null, _loadedSn: null, range: emptyRange(), sleep: { active: false, endsAt: 0 }, reciterId: 1, downloads: [], _downloadSelection: new Set(), timingIds: {} };

let _saveDebounceTimer = null;
function saveSoon() {
  if (_saveDebounceTimer) clearTimeout(_saveDebounceTimer);
  _saveDebounceTimer = setTimeout(() => { _saveDebounceTimer = null; Store.save(state); }, CONFIG.saveDebounceMs);
}

const Store = {
  load() { try { const r = lsSafeGet(CONFIG.storageKey); return r ? JSON.parse(r) : null; } catch(_) { return null; } },
  save(s) {
    try {
      const sig = `${s.current}|${Math.floor((s.currentTime || 0) / 3)}|${s.queue.length}|${s.reciterId}|${s.volume}|${s.speed}|${s.repeat}|${s.shuffle}|${s.mode}|${s.range.active ? 1 : 0}|${s.sleep.active ? Math.floor(s.sleep.endsAt / 1000) : 0}`;
      if (sig === s._lastSavedSignature) return;
      s._lastSavedSignature = sig;
      const payload = {
        v: 313, queue: s.queue, mode: s.mode, qIndex: s.qIndex, current: s.current,
        currentTime: s.currentTime || 0, volume: s.volume, speed: s.speed,
        shuffle: s.shuffle, repeat: s.repeat, lastPlayed: s.lastPlayed || null,
        reciterId: s.reciterId || null,
        range: s.range && s.range.active ? { surah: s.range.surah, endSurah: s.range.endSurah, crossSurah: !!s.range.crossSurah, phase: s.range.phase, mode: s.range.mode, startAyah: s.range.startAyah, endAyah: s.range.endAyah, startTime: s.range.startTime, endTime: s.range.endTime, estimated: !!s.range.estimated, openEnded: !!s.range.openEnded, repeatCount: s.range.repeatCount || 1, repeatIndex: s.range.repeatIndex || 0, sameSurah: !!s.range.sameSurah } : null,
        sleep: s.sleep && s.sleep.active ? { endsAt: s.sleep.endsAt } : null,
        savedAt: Date.now()
      };
      lsSafeSet(CONFIG.storageKey, JSON.stringify(payload));
    } catch(_){}
  },
};

const els = {
  grid: $("#grid"), audio: $("#audio"), playBtn: $("#playBtn"), playIcon: $("#playIcon"), prevBtn: $("#prevBtn"), nextBtn: $("#nextBtn"),
  shuffleBtn: $("#shuffleBtn"), repeatBtn: $("#repeatBtn"), speedBtn: $("#speedBtn"), muteBtn: $("#muteBtn"), volIcon: $("#volIcon"), volSlider: $("#volSlider"), volFill: $("#volFill"),
  seek: $("#seek"), seekFill: $("#seekFill"), seekThumb: $("#seekThumb"), seekBuffer: $("#seekBuffer"), seekMarkerStart: $("#seekMarkerStart"), seekMarkerEnd: $("#seekMarkerEnd"), seekRangeFill: $("#seekRangeFill"), seekAyahMarkers: $("#seekAyahMarkers"),
  timeCur: $("#timeCur"), timeTotal: $("#timeTotal"), nowArt: $("#nowArt"), nowTitle: $("#nowTitle"), nowSub: $("#nowSub"),
  searchInput: $("#searchInput"), rangeBtn: $("#rangeBtn"),
  sleepBtn: $("#sleepBtn"), timerChip: $("#timerChip"), queueBtn: $("#queueBtn"), queueBadge: $("#queueBadge"), themeBtn: $("#themeBtn"), themeIcon: $("#themeIcon"),
  drawer: $("#drawer"), overlay: $("#overlay"), closeDrawer: $("#closeDrawer"), qlist: $("#qlist"), drawerCount: $("#drawerCount"),
  playQueueBtn: $("#playQueueBtn"), shuffleQueueBtn: $("#shuffleQueueBtn"), clearQueueBtn: $("#clearQueueBtn"),
  toast: $("#toast"), toastMsg: $("#toastMsg"), toastIcon: $("#toastIcon"),
  statQueue: $("#statQueue"), statLast: $("#statLast"), statDownloads: $("#statDownloads"),
  rangePanel: $("#rangePanel"), rpClose: $("#rpClose"), rpSurahName: $("#rpSurahName"), rpStartSelect: $("#rpStartSelect"), rpStartContext: $("#rpStartContext"),
  rpEndSelect: $("#rpEndSelect"), rpEndSurahSelect: $("#rpEndSurahSelect"), rpEndRow: $("#rpEndRow"), rpEndCrossHint: $("#rpEndCrossHint"),
  rpStartField: $("#rpStartField"), rpModeField: $("#rpModeField"), rpModeToggle: $("#rpModeToggle"), rpEndAyahField: $("#rpEndAyahField"), rpDurationField: $("#rpDurationField"),
  rpDurHours: $("#rpDurHours"), rpDurMinutes: $("#rpDurMinutes"), rpDurHoursCell: $("#rpDurHoursCell"), rpDurMinutesCell: $("#rpDurMinutesCell"),
  rpRepeatCount: $("#rpRepeatCount"), rpRepeatField: $("#rpRepeatField"), rpSameSurah: $("#rpSameSurah"), rpApply: $("#rpApply"), rpClear: $("#rpClear"),
  phaseNotice: $("#phaseNotice"), phaseNoticeText: $("#phaseNoticeText"),
  sleepOverlay: $("#sleepOverlay"), sleepHours: $("#sleepHours"), sleepMinutes: $("#sleepMinutes"), sleepPresets: $("#sleepPresets"),
  sleepActiveInfo: $("#sleepActiveInfo"), sleepActiveText: $("#sleepActiveText"), sleepCancel: $("#sleepCancel"), sleepStart: $("#sleepStart"),
  subtitleStrip: $("#subtitleStrip"), subSurahName: $("#subSurahName"), subAyahNum: $("#subAyahNum"), subAyahText: $("#subAyahText"),
  reciterBtn: $("#reciterBtn"), reciterDropdown: $("#reciterDropdown"), reciterList: $("#reciterList"), reciterSearchInput: $("#reciterSearchInput"),
  reciterNameLabel: $("#reciterNameLabel"), brandReciterName: $("#brandReciterName"),
  storageBtn: $("#storageBtn"), storageBadge: $("#storageBadge"), storageOverlay: $("#storageOverlay"), storageList: $("#storageList"),
  storageBarFill: $("#storageBarFill"), storageUsed: $("#storageUsed"), storageAvail: $("#storageAvail"),
  storageCount: $("#storageCount"), storageReciters: $("#storageReciters"), storageTotal: $("#storageTotal"),
  storageClearAll: $("#storageClearAll"), storageCloseBtn: $("#storageCloseBtn"),
  prefetchStatus: $("#prefetchStatus"), prefetchBarFill: $("#prefetchBarFill"),
  prefetchText: $("#prefetchText"), prefetchPercent: $("#prefetchPercent"), prefetchFailed: $("#prefetchFailed"),
  prefetchClear: $("#prefetchClear"),
  downloadBtn: $("#downloadBtn"), downloadOverlay: $("#downloadOverlay"), dlList: $("#dlList"), dlSelectAll: $("#dlSelectAll"),
  dlCountPill: $("#dlCountPill"), dlStartBtn: $("#dlStartBtn"), dlStartCount: $("#dlStartCount"), dlCloseBtn: $("#dlCloseBtn"), downloadReciterName: $("#downloadReciterName"),
  mobileMenuBtn: $("#mobileMenuBtn"), mobileSidebar: $("#mobileSidebar"), mobileOverlay: $("#mobileOverlay"), mobileSidebarClose: $("#mobileSidebarClose"),
  msReciterName: $("#msReciterName"), msQueueCount: $("#msQueueCount"), msStorageCount: $("#msStorageCount"), msSleepValue: $("#msSleepValue"), msThemeValue: $("#msThemeValue"),
};

const ICONS = {
  star: `<svg class="star" viewBox="0 0 44 44" aria-hidden="true"><path d="M22 2 L27 9 L36 7 L35 16 L42 22 L35 28 L36 37 L27 35 L22 42 L17 35 L8 37 L9 28 L2 22 L9 16 L8 7 L17 9 Z" fill="currentColor" fill-opacity="0.10" stroke="currentColor" stroke-width="0.9" stroke-opacity="0.55"/></svg>`,
  play: `<path d="M8 5v14l11-7z"/>`, pause: `<path d="M6 5h4v14H6zm8 0h4v14h-4z"/>`,
  plus: `<path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>`, minus: `<path d="M5 11h14v2H5z"/>`,
  x: `<path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>`,
  drag: `<path d="M11 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm-2-8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>`,
  volume: `<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05A4.47 4.47 0 0 0 16.5 12zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>`,
  mute: `<path d="M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25A6.99 6.99 0 0 1 14 19.24v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>`,
  music: `<path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/>`,
  check: `<path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>`,
  alert: `<path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/>`,
  cloud: `<path d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z"/>`,
  repeat: `<path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>`,
  download: `<path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>`,
  trash: `<path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>`,
  folder: `<path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>`,
  mic: `<path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/>`,
  chevron: `<path d="M7 10l5 5 5-5z"/>`,
  bolt: `<path d="M11 21h-1l1-7H7.5c-.58 0-.57-.32-.38-.66.19-.34.05-.08.07-.12C8.48 10.94 10.42 7.54 13 3h1l-1 7h3.5c.49 0 .56.33.47.51l-.07.15C12.96 17.55 11 21 11 21z"/>`,
};

let toastTimer = 0;
function toast(msg, type = "info") { els.toastMsg.textContent = msg; els.toast.classList.remove("success", "error", "repeat"); if (type === "success") { els.toast.classList.add("success"); els.toastIcon.innerHTML = ICONS.check; } else if (type === "error") { els.toast.classList.add("error"); els.toastIcon.innerHTML = ICONS.alert; } else if (type === "repeat") { els.toast.classList.add("repeat"); els.toastIcon.innerHTML = ICONS.repeat; } else { els.toastIcon.innerHTML = ICONS.check; } els.toast.classList.add("on"); clearTimeout(toastTimer); toastTimer = setTimeout(() => els.toast.classList.remove("on"), CONFIG.toastDurationMs); }

const TimingsAPI = {
  cache: {}, sortedKeys: {}, noTimingFor: new Set(), _loadedFromDB: false,
  _touchMap: new Map(),
  has(rid, surah) { return !!(this.cache[rid] && this.cache[rid][surah]); },
  getFor(rid, surah) { const r = this.cache[rid]; if (!r || !r[surah]) return null; this._touch(rid, surah); return r[surah]; },
  getKeysFor(rid, surah) { return (this.sortedKeys[rid] && this.sortedKeys[rid][surah]) || null; },
  _touch(rid, sn) {
    const k = `${rid}-${sn}`;
    if (this._touchMap.has(k)) this._touchMap.delete(k);
    this._touchMap.set(k, Date.now());
    if (this._touchMap.size > CONFIG.TIMINGS_CACHE_MAX) {
      const oldKey = this._touchMap.keys().next().value;
      this._touchMap.delete(oldKey);
      const [oldRid, oldSn] = oldKey.split("-").map(Number);
      if (this.cache[oldRid]) delete this.cache[oldRid][oldSn];
      if (this.sortedKeys[oldRid]) delete this.sortedKeys[oldRid][oldSn];
    }
  },
  _store(rid, sn, ayahs) {
    if (!this.cache[rid]) this.cache[rid] = {};
    if (!this.sortedKeys[rid]) this.sortedKeys[rid] = {};
    this.cache[rid][sn] = ayahs;
    this.sortedKeys[rid][sn] = Object.keys(ayahs).map(Number).sort((a, b) => a - b);
    this._touch(rid, sn);
  },
  isDisabled(rid) { return this.noTimingFor.has(rid); },
  async loadAllFromIDB() { if (this._loadedFromDB) return; try { const all = await IDB.getAllTimings(); const sliced = all.slice(-CONFIG.TIMINGS_CACHE_MAX); for (const rec of sliced) { this._store(rec.reciterId, rec.surah, rec.ayahs); } this._loadedFromDB = true; } catch (e) { console.warn("TimingsAPI.loadAllFromIDB:", e); } },
  async fetch(rid, surahNumber, persist = false) {
    if (this.has(rid, surahNumber)) { this._touch(rid, surahNumber); return this.cache[rid][surahNumber]; }
    try {
      const rec = await IDB.getTiming(rid, surahNumber);
      if (rec && rec.ayahs && Object.keys(rec.ayahs).length) {
        this._store(rid, surahNumber, rec.ayahs);
        return rec.ayahs;
      }
    } catch(_) {}
    const timingId = state.timingIds[rid]; if (!timingId) { this.noTimingFor.add(rid); return null; }
    try {
      const url = `${CONFIG.apiBaseUrl}/ayat_timing?surah=${surahNumber}&read=${timingId}`;
      const res = await fetch(url, { cache: "no-store" }); if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json(); const ayahs = {};
      if (Array.isArray(data)) data.forEach(item => { if (typeof item.ayah === "number") ayahs[item.ayah] = { startTime: item.start_time / 1000, endTime: item.end_time / 1000 }; });
      if (!Object.keys(ayahs).length) throw new Error("empty");
      if (surahNumber === 1) { const ks = Object.keys(ayahs).map(Number).sort((a, b) => a - b); if (ks.length === 7 && ks[0] === 0 && ks[6] === 6) { const remapped = {}; for (const k of ks) remapped[k + 1] = ayahs[k]; for (const k of ks) delete ayahs[k]; Object.assign(ayahs, remapped); } const allValid = [1,2,3,4,5,6,7].every(i => ayahs[i] && ayahs[i].endTime > ayahs[i].startTime && ayahs[i].startTime >= 0); if (!allValid) throw new Error("invalid fatihah"); for (let i = 1; i <= 6; i++) if (ayahs[i + 1] && ayahs[i + 1].startTime > ayahs[i].endTime) ayahs[i].endTime = ayahs[i + 1].startTime; }
      this._store(rid, surahNumber, ayahs);
      if (persist) { try { await IDB.putTiming(rid, surahNumber, ayahs); } catch(_) {} }
      return ayahs;
    } catch (e) { console.warn(`Timings fetch failed [${rid} ${surahNumber}]:`, e); return null; }
  },
  async resolveTimingIds() {
    const cached = lsSafeGet("quran-timing-ids-v5");
    if (cached) { try { const p = JSON.parse(cached); const now = Date.now(); if (p._t && now - p._t < 86400000 * 7) return p; } catch(_){} }
    const map = { _t: Date.now() };
    try { const res = await fetch(`${CONFIG.apiBaseUrl}/ayat_timing/reads`); if (!res.ok) throw new Error("HTTP " + res.status); const reads = await res.json(); for (const local of CONFIG.reciters) { const match = reads.find(r => r.name && local.timingKeys.some(k => r.name.includes(k))); map[local.id] = match ? match.id : null; } lsSafeSet("quran-timing-ids-v5", JSON.stringify(map)); } catch (e) { console.warn("resolveTimingIds failed:", e); Object.assign(map, { 1: 12, 2: 14, 3: 6, 4: 8, 5: 10, 6: 9 }); }
    return map;
  },
};

const BISMILLAH_TEXT = "بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ";
const BISMILLAH_REGEX = /^بِسْمِ\s+[ٱاأ]للَّهِ\s+[ٱاأ]لرَّحْم[َٰـ\u064B-\u0652]*نِ\s+[ٱاأ]لرَّحِيمِ\s+/u;
const TextAPI = {
  cache: createLRU(CONFIG.TEXTS_CACHE_MAX),
  _loadedFromDB: false,
  async loadAllFromIDB() { if (this._loadedFromDB) return; try { const all = await IDB.getAllTexts(); const sliced = all.slice(-CONFIG.TEXTS_CACHE_MAX); for (const rec of sliced) this.cache.set(rec.key, rec.ayahs); this._loadedFromDB = true; } catch (e) { console.warn("TextAPI.loadAllFromIDB:", e); } },
  _parseText(sn, data) {
    const ayahs = {};
    if (sn !== 1 && sn !== 9) ayahs[0] = BISMILLAH_TEXT;
    data.ayahs.forEach(a => { let text = a.text; if (a.numberInSurah === 1 && sn !== 1 && sn !== 9) { if (BISMILLAH_REGEX.test(text)) text = text.replace(BISMILLAH_REGEX, "").trim() || text; } ayahs[a.numberInSurah] = text; });
    return ayahs;
  },
  async fetch(surahNumber, persist = false) {
    const cached = this.cache.get(surahNumber);
    if (cached) return cached;
    try {
      const rec = await IDB.getText(surahNumber);
      if (rec && rec.ayahs && Object.keys(rec.ayahs).length) {
        this.cache.set(surahNumber, rec.ayahs);
        return rec.ayahs;
      }
    } catch(_) {}
    try { const res = await fetch(CONFIG.textApiBaseUrl.replace("{n}", surahNumber), { cache: "no-store" }); if (!res.ok) throw new Error("HTTP " + res.status); const json = await res.json(); const data = json.data; if (!data || !Array.isArray(data.ayahs)) throw new Error("empty"); const ayahs = this._parseText(surahNumber, data); this.cache.set(surahNumber, ayahs); if (persist) { try { await IDB.putText(surahNumber, ayahs); } catch(_) {} } return ayahs; } catch (e) { return null; }
  },
  get(surah, ayah) { const s = this.cache.get(surah); return s ? s[ayah] || null : null; },
  has(surah) { return this.cache.has(surah); },
};

let _silentSwitch = false, _silentSwitchTimer = null, _audioLoadId = 0;
const _objectUrls = new Map();
function markSilentSwitch() { _silentSwitch = true; if (_silentSwitchTimer) clearTimeout(_silentSwitchTimer); _silentSwitchTimer = setTimeout(() => { _silentSwitch = false; _silentSwitchTimer = null; }, CONFIG.silentSwitchMs); }
function clearSilentSwitch() { if (_silentSwitchTimer) clearTimeout(_silentSwitchTimer); _silentSwitchTimer = null; _silentSwitch = false; }
function getSurahUrl(rid, sn) { const r = RECITER_MAP.get(rid); return `${(r ? r.server : CONFIG.reciters[0].server)}${pad(sn)}.mp3`; }
function resolveSurahSrc(rid, sn) { const k = `${rid}-${sn}`; return _objectUrls.has(k) ? _objectUrls.get(k) : getSurahUrl(rid, sn); }
function registerObjectUrl(rid, sn, blob) { const k = `${rid}-${sn}`; if (_objectUrls.has(k)) { try { URL.revokeObjectURL(_objectUrls.get(k)); } catch(_){} } const url = URL.createObjectURL(blob); _objectUrls.set(k, url); return url; }
function unregisterObjectUrl(rid, sn) { const k = `${rid}-${sn}`; if (_objectUrls.has(k)) { try { URL.revokeObjectURL(_objectUrls.get(k)); } catch(_){} _objectUrls.delete(k); } }
function pauseAudio() { try { els.audio.pause(); } catch(_){} }
function setLoadedSource(rid, sn) { state._loadedRid = rid; state._loadedSn = sn; }

/* ═══════════════════════════════════════════════════════════════════════
   ⭐ Prefetcher v31 — يحمّل كل timings + texts مرة واحدة في الخلفية
   ═══════════════════════════════════════════════════════════════════════ */
const Prefetcher = {
  _running: false,
  _aborted: false,
  _paused: false,
  _progress: { done: 0, total: 798, failed: 0, phase: "idle" },
  _onProgress: null,

  setProgressCallback(fn) { this._onProgress = fn; },
  _emit() { if (this._onProgress) try { this._onProgress(this._progress); } catch(_){} },

  _saveState() {
    lsSafeSet(CONFIG.PREFETCH_LS_KEY, JSON.stringify({
      progress: this._progress,
      paused: this._paused,
      running: this._running,
      ts: Date.now()
    }));
  },
  _clearState() { lsSafeRemove(CONFIG.PREFETCH_LS_KEY); },

  async isComplete() {
    try {
      const tk = await IDB.getAllTimingKeys();
      const xk = await IDB.getAllTextKeys();
      return tk.length >= CONFIG.reciters.length * 114 && xk.length >= 114;
    } catch(_) { return false; }
  },

  status() { return this._progress; },

  async run() {
    console.log('[Prefetcher] run() called | running:', this._running, '| online:', navigator.onLine);
    if (this._running) return;
    if (!navigator.onLine) {
      this._paused = true;
      this._progress.phase = "paused";
      this._emit();
      this._saveState();
      return;
    }
    this._running = true;
    this._aborted = false;
    this._paused = false;

    try {
      const existingT = new Set(await IDB.getAllTimingKeys());
      const existingX = new Set((await IDB.getAllTextKeys()).map(String));

      const tasks = [];
      for (const rec of CONFIG.reciters) {
        for (let sn = 1; sn <= 114; sn++) {
          const k = `${rec.id}-${sn}`;
          if (!existingT.has(k)) tasks.push({ type: "timing", rid: rec.id, sn });
        }
      }
      for (let sn = 1; sn <= 114; sn++) {
        if (!existingX.has(String(sn))) tasks.push({ type: "text", sn });
      }

      const totalAll = CONFIG.reciters.length * 114 + 114;
      this._progress.total = totalAll;
      this._progress.done = existingT.size + existingX.size;
      this._progress.failed = 0;
      this._progress.phase = "running";
      this._emit();
      this._saveState();

      if (!tasks.length) {
        this._progress.phase = "complete";
        this._progress.done = totalAll;
        this._emit();
        this._clearState();
        this._running = false;
        return;
      }

      let idx = 0;
      const worker = async () => {
        while (idx < tasks.length) {
          if (this._aborted || this._paused) return;
          if (!navigator.onLine) { this._paused = true; return; }
          const i = idx++;
          const task = tasks[i];
          const ok = await this._processTask(task);
          if (!ok) this._progress.failed++;
          this._progress.done++;
          this._emit();
          if (i % 5 === 0) this._saveState();
          await new Promise(r => setTimeout(r, CONFIG.PREFETCH_DELAY_MS));
        }
      };

      await Promise.all(Array.from({ length: CONFIG.PREFETCH_CONCURRENCY }, () => worker()));

      if (this._aborted) {
        this._progress.phase = "aborted";
        this._emit();
        this._running = false;
        return;
      }
      if (this._paused) {
        this._progress.phase = "paused";
        this._emit();
        this._saveState();
        this._running = false;
        return;
      }
      this._progress.phase = "complete";
      this._progress.done = totalAll;
      this._emit();
      this._clearState();
      this._running = false;
      toast("✅ اكتمل تحميل توقيتات الآيات", "success");
    } catch (e) {
      console.warn("[Prefetcher] error:", e);
      this._running = false;
      this._progress.phase = "error";
      this._emit();
    }
  },

  async _processTask(task) {
    for (let attempt = 1; attempt <= CONFIG.PREFETCH_RETRY_MAX; attempt++) {
      if (this._aborted || this._paused) return true;
      if (!navigator.onLine) return false;
      try {
        if (task.type === "timing") await this._fetchTiming(task.rid, task.sn);
        else await this._fetchText(task.sn);
        return true;
      } catch (e) {
        if (attempt >= CONFIG.PREFETCH_RETRY_MAX) return false;
        await new Promise(r => setTimeout(r, 500 * attempt));
      }
    }
    return false;
  },

  async _fetchTiming(rid, sn) {
    const timingId = state.timingIds[rid];
    if (!timingId) return;
    const url = `${CONFIG.apiBaseUrl}/ayat_timing?surah=${sn}&read=${timingId}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    const ayahs = {};
    if (Array.isArray(data)) data.forEach(item => { if (typeof item.ayah === "number") ayahs[item.ayah] = { startTime: item.start_time / 1000, endTime: item.end_time / 1000 }; });
    if (!Object.keys(ayahs).length) throw new Error("empty");
    if (sn === 1) {
      const ks = Object.keys(ayahs).map(Number).sort((a, b) => a - b);
      if (ks.length === 7 && ks[0] === 0 && ks[6] === 6) {
        const remapped = {};
        for (const k of ks) remapped[k + 1] = ayahs[k];
        for (const k of ks) delete ayahs[k];
        Object.assign(ayahs, remapped);
      }
    }
    await IDB.putTiming(rid, sn, ayahs);
    TimingsAPI._store(rid, sn, ayahs);
  },

  async _fetchText(sn) {
    const url = CONFIG.textApiBaseUrl.replace("{n}", sn);
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const json = await res.json();
    const data = json.data;
    if (!data || !Array.isArray(data.ayahs)) throw new Error("empty");
    const ayahs = TextAPI._parseText(sn, data);
    await IDB.putText(sn, ayahs);
    TextAPI.cache.set(sn, ayahs);
  },

  pause() {
    if (!this._running) return;
    this._paused = true;
    this._progress.phase = "paused";
    this._emit();
    this._saveState();
  },
  resume() {
    if (this._running) return;
    this._paused = false;
    this.run();
  },
  abort() {
    this._aborted = true;
    this._running = false;
    this._progress.phase = "aborted";
    this._emit();
    this._clearState();
  },
  async clearAll() {
    this.abort();
    try {
      await IDB.clearTimings();
      await IDB.clearTexts();
      TimingsAPI.cache = {}; TimingsAPI.sortedKeys = {}; TimingsAPI._touchMap.clear();
      TextAPI.cache.clear();
      this._progress = { done: 0, total: 798, failed: 0, phase: "idle" };
      this._clearState();
      this._emit();
      toast("تم مسح التوقيتات والنصوص", "success");
    } catch(_) {}
  }
};

/* ═══════════════════════════════════════════════════════════════════════
   ⭐ OfflineResume v31.3 — بدون polling — online event + visibilitychange
   ═══════════════════════════════════════════════════════════════════════ */
const OfflineResume = {
  _restoring: false,
  _retryTimer: null,
  _retryAttempt: 0,
  _currentData: null,

  _ayahFromTime(rid, sn, time) {
    try {
      if (!TimingsAPI.has(rid, sn)) return null;
      const result = Subtitle.findCurrentAyah(rid, sn, time);
      return (result != null && result > 0) ? result : null;
    } catch(_) { return null; }
  },

  _read() {
    try {
      const raw = lsSafeGet(CONFIG.OFFLINE_RESUME_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data.ts || Date.now() - data.ts > CONFIG.OFFLINE_RESUME_MAX_AGE) {
        this.clear();
        return null;
      }
      return data;
    } catch(_) { return null; }
  },

  _write(data) {
    try { lsSafeSet(CONFIG.OFFLINE_RESUME_KEY, JSON.stringify(data)); } catch(_){}
  },

  save(reason) {
    if (!state.current) return;
    const time = els.audio.currentTime || state.currentTime || 0;
    const ayah = this._ayahFromTime(state.reciterId, state.current, time);
    const data = { rid: state.reciterId, sn: state.current, ayah, time, wasPlaying: !!state._playIntent, ts: Date.now(), reason };
    this._currentData = data;
    this._write(data);
  },

  updateSeek(time) {
    if (!state.current) return;
    const ayah = this._ayahFromTime(state.reciterId, state.current, time);
    const existing = this._currentData || this._read() || {};
    const data = { rid: state.reciterId, sn: state.current, ayah: ayah != null ? ayah : existing.ayah, time, wasPlaying: !!state._playIntent, ts: Date.now(), reason: "seek" };
    this._currentData = data;
    this._write(data);
  },

  updateReciter(newRid, newTime) {
    if (!state.current) return;
    const ayah = this._ayahFromTime(newRid, state.current, newTime);
    const data = { rid: newRid, sn: state.current, ayah, time: newTime, wasPlaying: !!state._playIntent, ts: Date.now(), reason: "reciter" };
    this._currentData = data;
    this._write(data);
  },

  updatePlayState(wasPlaying) {
    const data = this._currentData || this._read();
    if (!data) return;
    data.wasPlaying = !!wasPlaying;
    data.ts = Date.now();
    this._currentData = data;
    this._write(data);
  },

  clear() {
    this._currentData = null;
    lsSafeRemove(CONFIG.OFFLINE_RESUME_KEY);
    if (this._retryTimer) { clearTimeout(this._retryTimer); this._retryTimer = null; }
    this._retryAttempt = 0;
    this._restoring = false;
  },

  async restore(trigger) {
    if (this._restoring) return;
    const data = this._read();
    if (!data) return;
    if (!state.current || state.current !== data.sn) { this.clear(); return; }
    if (state.reciterId !== data.rid) { this.clear(); return; }
    if (!navigator.onLine) return;

    this._restoring = true;
    this._retryAttempt = 0;
    this._currentData = data;
    await this._attemptRestore(data);
  },

  async _attemptRestore(data) {
    if (!TimingsAPI.has(data.rid, data.sn) && !TimingsAPI.isDisabled(data.rid)) {
      try { await TimingsAPI.fetch(data.rid, data.sn); } catch(_){}
    }

    let targetTime = data.time || 0;
    let precise = false;
    if (data.ayah != null) {
      const t = TimingsAPI.getFor(data.rid, data.sn);
      if (t && t[data.ayah]) { targetTime = t[data.ayah].startTime; precise = true; }
    }

    try {
      els.audio.pause();
      els.audio.removeAttribute('src');
      els.audio.load();
    } catch(_) {}

    await new Promise(r => setTimeout(r, 60));

    markSilentSwitch();
    setLoadedSource(data.rid, data.sn);
    try {
      els.audio.src = resolveSurahSrc(data.rid, data.sn);
      els.audio.load();
    } catch(_) { this._scheduleRetry(data); return; }

    const canPlayOk = await new Promise((resolve) => {
      let done = false;
      const finish = (ok) => { if (done) return; done = true; els.audio.removeEventListener('canplay', onCanPlay); els.audio.removeEventListener('error', onErr); clearTimeout(tmo); resolve(ok); };
      const onCanPlay = () => finish(true);
      const onErr = () => finish(false);
      els.audio.addEventListener('canplay', onCanPlay);
      els.audio.addEventListener('error', onErr);
      const tmo = setTimeout(() => finish(false), 10000);
    });

    if (!canPlayOk) { this._scheduleRetry(data); return; }

    try { els.audio.currentTime = targetTime; state.currentTime = targetTime; } catch(_) {}

    await new Promise((resolve) => {
      let done = false;
      const finish = () => { if (done) return; done = true; els.audio.removeEventListener('seeked', onSeeked); clearTimeout(tmo); resolve(); };
      const onSeeked = () => finish();
      els.audio.addEventListener('seeked', onSeeked);
      const tmo = setTimeout(finish, 2500);
    });

    if (data.wasPlaying) {
      state._playIntent = true;
      const p = els.audio.play();
      if (p && p.catch) p.catch(() => {});
    }

    UI.progress();
    Subtitle.currentKey = null;
    Subtitle.update();
    clearSilentSwitch();

    this.clear();

    if (precise) toast(`▶ عاد الاتصال — الآية ${data.ayah}`, "success");
    else toast("▶ عاد الاتصال", "success");
  },

  _scheduleRetry(data) {
    if (this._retryTimer) clearTimeout(this._retryTimer);
    if (!navigator.onLine) { this._restoring = false; return; }
    this._retryAttempt++;
    if (this._retryAttempt > CONFIG.OFFLINE_MAX_RETRIES) { this._restoring = false; return; }
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      if (!navigator.onLine) { this._restoring = false; return; }
      this._attemptRestore(data);
    }, CONFIG.OFFLINE_RETRY_DELAY_MS);
  }
};

const Subtitle = {
  currentKey: null, _pendingFetches: {}, _failedMap: new Map(), _changingTimer: null, _lastUpdateTs: 0,
  _markFailed(fk) {
    if (this._failedMap.has(fk)) this._failedMap.delete(fk);
    this._failedMap.set(fk, Date.now());
    if (this._failedMap.size > CONFIG.FAILED_FETCHES_MAX) {
      const old = this._failedMap.keys().next().value;
      this._failedMap.delete(old);
    }
  },
  findCurrentAyah(rid, surahNum, t) {
    const timings = TimingsAPI.getFor(rid, surahNum); const keys = TimingsAPI.getKeysFor(rid, surahNum);
    if (timings && keys && keys.length) { let lo = 0, hi = keys.length - 1; while (lo <= hi) { const mid = (lo + hi) >> 1; const k = keys[mid]; const a = timings[k]; if (t < a.startTime) hi = mid - 1; else if (t >= a.endTime) lo = mid + 1; else return k; } if (lo < keys.length) { const k = keys[lo]; if (t < timings[k].startTime) return lo > 0 ? keys[lo - 1] : keys[0]; return k; } return keys[keys.length - 1]; }
    if (surahNum === 1) { const est = getFatihahEstimated(els.audio.duration); if (!est) return null; for (let i = 1; i <= 7; i++) if (t >= est[i].startTime && t < est[i].endTime) return i; return 7; }
    return null;
  },
  update() {
    const now = performance.now();
    if (now - this._lastUpdateTs < CONFIG.SUBTITLE_THROTTLE_MS) return;
    this._lastUpdateTs = now;

    if (!state.current) { this.hide(); return; }
    const surah = state.current;
    const fk = `${state.reciterId}-${surah}`;
    const hasTimings = TimingsAPI.has(state.reciterId, surah);
    const isDisabled = TimingsAPI.isDisabled(state.reciterId);
    const isFailed = this._failedMap.has(fk);
    const isPending = this._pendingFetches[fk];
    if (!hasTimings && !isDisabled && !isFailed && !isPending) {
      this._pendingFetches[fk] = true;
      TimingsAPI.fetch(state.reciterId, surah).then((data) => {
        delete this._pendingFetches[fk];
        if (!data && navigator.onLine) this._markFailed(fk);
        UI._markerRenderKey = null; UI.renderAyahMarkers(); this.currentKey = null; this.update();
      }).catch(() => { delete this._pendingFetches[fk]; if (navigator.onLine) this._markFailed(fk); });
    }
    const audioHealthy = !els.audio.error && els.audio.readyState >= 2;
    const t = audioHealthy ? (els.audio.currentTime || 0) : (state.currentTime || 0);
    const curAyah = this.findCurrentAyah(state.reciterId, surah, t);
    if (curAyah === null) { this.hide(); return; }
    els.subtitleStrip.classList.add("on");
    this.render(surah, curAyah);
    UI.highlightMarker(curAyah);
  },
  render(surahNum, ayahNum) {
    const key = `${surahNum}:${ayahNum}`; if (this.currentKey === key) return false;
    this.currentKey = key;
    const s = SURAH_MAP.get(surahNum); if (!s) return false;
    els.subSurahName.textContent = s.nameAr;
    els.subAyahNum.textContent = ayahNum === 0 ? "البسملة" : `${ayahNum} / ${s.ayahs}`;
    const text = TextAPI.get(surahNum, ayahNum);
    if (text) this.setText(text, false);
    else { this.setText("﴿ جاري تحميل النص... ﴾", true); const fk = `text-${surahNum}`; if (!this._pendingFetches[fk]) { this._pendingFetches[fk] = true; TextAPI.fetch(surahNum).then(() => { delete this._pendingFetches[fk]; if (this.currentKey === key) { const tx = TextAPI.get(surahNum, ayahNum); if (tx) this.setText(tx, false); } }).catch(() => { delete this._pendingFetches[fk]; if (this.currentKey === key) this.setText("﴿ تعذّر تحميل النص ﴾", true); }); } }
    if (this._changingTimer) clearTimeout(this._changingTimer);
    els.subtitleStrip.classList.add("changing");
    this._changingTimer = setTimeout(() => els.subtitleStrip.classList.remove("changing"), 550);
    return true;
  },
  setText(text, isLoading) { els.subAyahText.textContent = text; els.subAyahText.classList.toggle("loading", !!isLoading); },
  onPlay() {
    this.currentKey = null;
    this._lastUpdateTs = 0;
    this.update();
    if (state.current && !TextAPI.has(state.current)) TextAPI.fetch(state.current).catch(() => {});
    if (state.current && !TimingsAPI.has(state.reciterId, state.current) && !TimingsAPI.isDisabled(state.reciterId)) {
      const fk = `${state.reciterId}-${state.current}`;
      this._failedMap.delete(fk);
      TimingsAPI.fetch(state.reciterId, state.current).then(() => {
        UI._markerRenderKey = null; UI.renderAyahMarkers();
        this.currentKey = null; this.update();
      }).catch(() => {});
    }
  },
  hide() { els.subtitleStrip.classList.remove("on"); this.currentKey = null; },
};

const cardEls = new Map();
let lastPlayingCard = null;
const UI = {
  _markerNodes: new Map(), _currentMarkerNode: null, _lastHighlightAyah: null, _markerRenderKey: null,
  buildLibrary() {
    const h = document.createElement("div");
    h.innerHTML = SURAHS.map(s => { const tc = s.type === "مكية" ? "makki" : "madani"; return `<article class="card" data-num="${s.number}" tabindex="0" role="button" aria-label="سورة ${esc(s.nameAr)}"><div class="num">${ICONS.star}<span class="val">${s.number}</span><div class="eq-indicator"><i></i><i></i><i></i></div></div><div class="meta"><div class="ar">${esc(s.nameAr)}</div><div class="en">${esc(s.nameEn)}</div><div class="tags"><span class="tag">${s.ayahs} آية</span><span class="tag ${tc}">${s.type}</span><span class="tag downloaded-badge" data-downloaded-badge style="display:none">⬇ محمّلة</span><span class="tag resume-badge" data-resume-badge style="display:none">▶ استئناف</span><span class="tag range-badge" data-range-badge style="display:none">نطاق</span><span class="tag repeat-badge" data-repeat-badge style="display:none">🔁</span></div></div><div class="card-actions"><button class="mini dl-mini" data-act="download" data-num="${s.number}" title="تحميل"><span class="ring"></span><svg viewBox="0 0 24 24">${ICONS.download}</svg></button><button class="mini" data-act="add" data-num="${s.number}" title="أضف"><svg viewBox="0 0 24 24">${ICONS.plus}</svg></button></div></article>`; }).join("");
    const frag = document.createDocumentFragment(); while (h.firstChild) frag.appendChild(h.firstChild);
    els.grid.appendChild(frag);
    $$(".card", els.grid).forEach(el => cardEls.set(+el.dataset.num, el));
  },
  filter() { const raw = (state.search || "").trim(); if (!raw) { cardEls.forEach(el => { el.style.display = ""; }); return; } const q = raw.toLowerCase(); const qNum = arabicToEnglish(raw).toLowerCase(); const isNum = /^\d+$/.test(qNum); const qInt = isNum ? parseInt(qNum, 10) : NaN; cardEls.forEach((el, num) => { const s = SURAH_MAP.get(num); const match = (s.nameAr || "").toLowerCase().includes(q) || (s.nameEn || "").toLowerCase().includes(q) || (isNum && qInt === num); el.style.display = match ? "" : "none"; }); },
  updatePlayingCard() { if (lastPlayingCard) lastPlayingCard.classList.remove("playing", "audio-active"); if (!state.current) { lastPlayingCard = null; return; } const el = cardEls.get(state.current); if (el) { el.classList.add("playing"); if (state.playing) el.classList.add("audio-active"); lastPlayingCard = el; } },
  updateResumeCard() { cardEls.forEach(el => { el.classList.remove("resume-card"); const b = el.querySelector("[data-resume-badge]"); if (b) b.style.display = "none"; }); if (state._restoredFromSaved && state.current) { const el = cardEls.get(state.current); if (el) { el.classList.add("resume-card"); const b = el.querySelector("[data-resume-badge]"); if (b && state.currentTime > 1) b.style.display = ""; } } },
  updateAddedButtons() { const q = new Set(state.queue); cardEls.forEach((el, num) => { const btn = el.querySelector('[data-act="add"]'); if (!btn) return; const isIn = q.has(num); btn.classList.toggle("added", isIn); const svg = btn.querySelector("svg"); if (svg) svg.innerHTML = isIn ? ICONS.minus : ICONS.plus; }); },
  updateRangeBadges() { cardEls.forEach((el, num) => { const b = el.querySelector("[data-range-badge]"); const rb = el.querySelector("[data-repeat-badge]"); if (!b) return; let show = false; if (state.range.active) { if (state.range.crossSurah) show = (num === state.range.surah || num === state.range.endSurah); else show = (num === state.range.surah); } b.style.display = show ? "" : "none"; if (rb) { const sr = show && (state.range.repeatCount || 1) > 1; rb.style.display = sr ? "" : "none"; if (sr) rb.textContent = `🔁 ×${state.range.repeatCount}`; } }); els.rangeBtn.classList.toggle("active", state.range.active); },
  updateDownloadedBadges() { const dn = new Set(); state.downloads.forEach(d => { if (d.reciterId === state.reciterId) dn.add(d.surahNum); }); cardEls.forEach((el, num) => { const b = el.querySelector("[data-downloaded-badge]"); const btn = el.querySelector('[data-act="download"]'); const has = dn.has(num); if (b) b.style.display = has ? "" : "none"; if (btn) { btn.classList.toggle("downloaded", has); const svg = btn.querySelector("svg"); if (svg && !btn.classList.contains("downloading")) svg.innerHTML = has ? ICONS.check : ICONS.download; } }); els.statDownloads.textContent = state.downloads.filter(d => d.reciterId === state.reciterId).length; },
  renderQueue() {
    const q = state.queue; let ht = `${q.length} ${q.length === 1 ? "سورة" : "سور"}`;
    if (state.mode === "queue" && state.current) { const idx = state.queue.indexOf(state.current); if (idx !== -1) ht += ` · قيد التشغيل: ${idx + 1}`; }
    els.drawerCount.textContent = ht; els.statQueue.textContent = q.length; els.queueBadge.textContent = q.length; els.queueBadge.classList.toggle("on", q.length > 0);
    if (!q.length) { els.qlist.innerHTML = `<div class="empty"><svg viewBox="0 0 24 24">${ICONS.music}</svg><p>القائمة فارغة<br/>اضغط <b>+</b> لإضافة</p></div>`; return; }
    els.qlist.innerHTML = q.map((num, i) => { const s = SURAH_MAP.get(num); const isCur = state.mode === "queue" && state.current === num; const isPlay = isCur && state.playing; return `<div class="qitem ${isCur ? "playing" : ""}" draggable="true" data-idx="${i}" data-num="${num}"><span class="qhandle"><svg viewBox="0 0 24 24">${ICONS.drag}</svg></span><span class="qnum">${num}</span><div class="qmeta"><b>${esc(s.nameAr)}</b><span>${esc(s.nameEn)} · ${s.ayahs} آية</span></div><button class="qplay ${isPlay ? "playing" : ""}" data-act="qplay" data-idx="${i}"><svg viewBox="0 0 24 24">${isPlay ? ICONS.pause : ICONS.play}</svg></button><button class="qx" data-act="remove" data-idx="${i}"><svg viewBox="0 0 24 24">${ICONS.x}</svg></button></div>`; }).join("");
  },
  updateQueuePlayButtons() { els.qlist.querySelectorAll(".qitem").forEach(item => { const num = Number(item.dataset.num); const isCur = state.mode === "queue" && state.current === num; item.classList.toggle("playing", isCur); const btn = item.querySelector(".qplay"); if (!btn) return; const ip = isCur && state.playing; btn.classList.toggle("playing", ip); const svg = btn.querySelector("svg"); if (svg) svg.innerHTML = ip ? ICONS.pause : ICONS.play; }); },
  nowPlaying() {
    const s = state.current ? SURAH_MAP.get(state.current) : null;
    if (s) {
      const isOff = state.downloads.some(d => d.reciterId === state.reciterId && d.surahNum === state.current);
      const parts = [];
      if (state.range.active) { if (state.range.crossSurah && state.range.phase === "leg2") parts.push("2/2"); const rc = state.range.repeatCount || 1; if (rc > 1) parts.push(`تشغيل ${(state.range.repeatIndex || 0) + 1}/${rc}`); if (state.range.sameSurah) parts.push("نفس السورة"); }
      if (state.mode === "queue") { const idx = state.queue.indexOf(state.current); if (idx !== -1) parts.push(`من القائمة ${idx + 1}/${state.queue.length}`); }
      const extra = parts.length ? ` · ${parts.join(" · ")}` : "";
      els.nowTitle.textContent = `سورة ${s.nameAr}`;
      if (state._restoredFromSaved && state.currentTime > 1) { els.nowSub.innerHTML = `<span class="resume-hint">▶ اضغط تشغيل للمتابعة من ${fmtTime(state.currentTime)}</span>`; els.playBtn.classList.add("has-resume"); }
      else if (isOff) { els.nowSub.innerHTML = `<span class="offline-hint">⬇ محمّلة · يعمل بدون إنترنت</span>${extra}`; els.playBtn.classList.remove("has-resume"); }
      else { els.nowSub.textContent = `${s.nameEn} · ${s.ayahs} آية · ${s.type}${extra}`; els.playBtn.classList.remove("has-resume"); }
      els.statLast.textContent = s.nameAr; els.nowArt.classList.add("spin");
    } else { els.nowTitle.textContent = "لم يتم التشغيل"; els.nowSub.textContent = "اختر سورة"; els.statLast.textContent = "—"; els.nowArt.classList.remove("spin"); els.playBtn.classList.remove("has-resume"); }
    els.playIcon.innerHTML = state.playing ? ICONS.pause : ICONS.play;
    els.playBtn.disabled = !state.current;
  },
  progress() {
    const hasAudio = isFinite(els.audio.duration) && els.audio.duration > 0;
    const dur = hasAudio ? els.audio.duration : (state._lastKnownDuration || 0);
    const cur = hasAudio ? (els.audio.currentTime || 0) : (state.currentTime || 0);
    const ratio = dur > 0 ? cur / dur : 0;
    els.seekFill.style.transform = `scaleX(${ratio})`;
    els.seekThumb.style.left = (ratio * 100).toFixed(3) + "%";
    els.timeCur.textContent = fmtTime(cur); if (dur > 0) els.timeTotal.textContent = fmtTime(dur);
    if (dur > 0) els.seek.setAttribute("aria-valuenow", Math.round(ratio * 100));
    if (els.audio.buffered.length && hasAudio) { const end = els.audio.buffered.end(els.audio.buffered.length - 1); els.seekBuffer.style.width = ((end / dur) * 100).toFixed(2) + "%"; }
  },
  renderAyahMarkers() {
    if (!state.current) return this._clearMarkers();
    const dur = els.audio.duration; if (!isFinite(dur) || dur <= 0) return this._clearMarkers();
    const key = `${state.reciterId}-${state.current}-${Math.round(dur)}`; if (this._markerRenderKey === key) return;
    this._markerRenderKey = key;
    let timings = TimingsAPI.getFor(state.reciterId, state.current); let keys = TimingsAPI.getKeysFor(state.reciterId, state.current);
    if ((!timings || !keys) && state.current === 1) { timings = getFatihahEstimated(dur); keys = [1, 2, 3, 4, 5, 6, 7]; }
    if (!timings || !keys || keys.length < 2) return this._clearMarkers();
    els.seekAyahMarkers.innerHTML = ""; this._markerNodes.clear(); this._currentMarkerNode = null; this._lastHighlightAyah = null;
    const frag = document.createDocumentFragment();
    for (let i = 1; i < keys.length; i++) { const k = keys[i]; const t = timings[k]; if (!t) continue; const pos = (t.startTime / dur) * 100; if (pos <= 0 || pos >= 100) continue; const m = document.createElement("i"); m.style.left = pos.toFixed(3) + "%"; m.dataset.ayah = k; frag.appendChild(m); this._markerNodes.set(k, m); }
    els.seekAyahMarkers.appendChild(frag);
  },
  _clearMarkers() { els.seekAyahMarkers.innerHTML = ""; this._markerNodes.clear(); this._currentMarkerNode = null; this._lastHighlightAyah = null; this._markerRenderKey = null; },
  highlightMarker(ayahNum) { if (this._lastHighlightAyah === ayahNum) return; this._lastHighlightAyah = ayahNum; if (this._currentMarkerNode) { this._currentMarkerNode.classList.remove("current"); this._currentMarkerNode = null; } if (ayahNum == null) return; const node = this._markerNodes.get(ayahNum); if (node) { node.classList.add("current"); this._currentMarkerNode = node; } },
  rangeMarkers() {
    const total = els.audio.duration; const has = isFinite(total) && total > 0;
    if (!has) { els.seekMarkerStart.classList.remove("on"); els.seekMarkerEnd.classList.remove("on"); els.seekRangeFill.classList.remove("on"); return; }
    let active = false, sT = 0, eT = total;
    if (state.range.active && !state.range.openEnded) {
      if (state.range.crossSurah) { if (state.range.phase === "leg1" && state.current === state.range.surah) { active = true; sT = state.range.startTime; eT = total; } else if (state.range.phase === "leg2" && state.current === state.range.endSurah) { active = true; sT = 0; eT = state.range.endTime; } }
      else if (state.current === state.range.surah) { active = true; sT = state.range.startTime; eT = state.range.endTime; }
    }
    if (!active) { els.seekMarkerStart.classList.remove("on"); els.seekMarkerEnd.classList.remove("on"); els.seekRangeFill.classList.remove("on"); return; }
    const sP = clamp((sT / total) * 100, 0, 100), eP = clamp((eT / total) * 100, 0, 100);
    els.seekMarkerStart.style.left = sP + "%"; els.seekMarkerEnd.style.left = eP + "%";
    els.seekRangeFill.style.left = sP + "%"; els.seekRangeFill.style.width = Math.max(0, eP - sP) + "%";
    els.seekMarkerStart.classList.add("on"); els.seekMarkerEnd.classList.add("on"); els.seekRangeFill.classList.add("on");
  },
  volume() { els.volFill.style.transform = `scaleX(${state.volume})`; els.volSlider.setAttribute("aria-valuenow", Math.round(state.volume * 100)); els.volIcon.innerHTML = state.volume === 0 ? ICONS.mute : ICONS.volume; },
  speed() { els.speedBtn.textContent = state.speed + "×"; },
  shuffle() { els.shuffleBtn.classList.toggle("on", state.shuffle); },
  repeat() { els.repeatBtn.classList.toggle("on", state.repeat !== "off"); },
  timerChip() { if (state.sleep.active) { const r = Math.max(0, state.sleep.endsAt - Date.now()); els.timerChip.textContent = fmtTime(r / 1000); els.timerChip.classList.add("on"); els.sleepBtn.classList.add("active"); } else { els.timerChip.classList.remove("on"); els.sleepBtn.classList.remove("active"); } },
  updateMobileValues() { if (!els.msReciterName) return; els.msReciterName.textContent = (RECITER_MAP.get(state.reciterId) || {}).name || "—"; els.msQueueCount.textContent = state.queue.length; els.msStorageCount.textContent = state.downloads.filter(d => d.reciterId === state.reciterId).length; els.msSleepValue.textContent = state.sleep.active ? fmtTime(Math.max(0, state.sleep.endsAt - Date.now()) / 1000) : "—"; },
  phaseNotice() {
    const isL2 = state.range.active && state.range.crossSurah && state.range.phase === "leg2";
    const rc = state.range.repeatCount || 1; const hasR = state.range.active && rc > 1; const isSame = state.range.active && state.range.sameSurah;
    if (isL2) { const ss = SURAH_MAP.get(state.range.surah); let h = `أنت الآن في <b>المرحلة 2 من 2</b> — تشغيل سورة ${SURAH_MAP.get(state.range.endSurah).nameAr}. عند تطبيق نطاق جديد، سيبدأ من ${ss.nameAr} (الآية ${state.range.startAyah}).`; if (hasR) h += ` <br>🔁 التشغيل <b>${(state.range.repeatIndex || 0) + 1} من ${rc}</b>`; els.phaseNoticeText.innerHTML = h; els.phaseNotice.classList.add("on"); els.phaseNotice.classList.toggle("repeat-active", hasR); }
    else if (isSame) { let h = `🔁 تشغيل <b>سورة ${SURAH_MAP.get(state.range.surah).nameAr}</b> كاملة`; if (hasR) h += ` — <b>${(state.range.repeatIndex || 0) + 1} من ${rc}</b>`; els.phaseNoticeText.innerHTML = h; els.phaseNotice.classList.add("on"); els.phaseNotice.classList.toggle("repeat-active", hasR); }
    else if (hasR) { els.phaseNoticeText.innerHTML = `🔁 النطاق مُشغَّل <b>${rc} مرات</b> — الإنجاز: <b>${(state.range.repeatIndex || 0) + 1}</b> من ${rc}`; els.phaseNotice.classList.add("on", "repeat-active"); }
    else if (state.range.active && state.range.openEnded) { els.phaseNoticeText.innerHTML = `▶ التشغيل من الآية <b>${state.range.startAyah}</b> بدون حد للنهاية.`; els.phaseNotice.classList.add("on"); els.phaseNotice.classList.remove("repeat-active"); }
    else els.phaseNotice.classList.remove("on", "repeat-active");
  },
  reciterName(name) { els.reciterNameLabel.textContent = name || "اختر قارئ"; els.brandReciterName.textContent = name ? `الشيخ ${name}` : "اختر قارئ"; els.downloadReciterName.textContent = name ? `— ${name}` : ""; if (els.msReciterName) els.msReciterName.textContent = name || "—"; },
};

/* ═══ RAF loop ═══ */
let _rafId = null;
let _lastSaveCheckTs = 0;
function _rafTick(ts) {
  if (!state.playing || !state._tabVisible) { _rafId = null; return; }
  UI.progress();
  if (state.range.active && !state.range.openEnded && state.current === state.range.surah) {
    if (els.audio.currentTime >= state.range.endTime) {
      try { els.audio.pause(); } catch(_){}
      try { els.audio.currentTime = state.range.endTime; } catch(_){}
      handleRangeEnd();
      _rafId = null;
      return;
    }
  }
  if (ts - _lastSaveCheckTs > CONFIG.PLAYING_SAVE_INTERVAL_MS) {
    _lastSaveCheckTs = ts;
    safeSave();
  }
  _rafId = requestAnimationFrame(_rafTick);
}
function startRafLoop() { if (_rafId !== null) return; if (!state.playing || !state._tabVisible) return; _rafId = requestAnimationFrame(_rafTick); }
function stopRafLoop() { if (_rafId !== null) { cancelAnimationFrame(_rafId); _rafId = null; } }

let _rangeHardStop = null;
function clearRangeHardStop() { if (_rangeHardStop) { clearTimeout(_rangeHardStop); _rangeHardStop = null; } }
function scheduleHardStop() {
  clearRangeHardStop();
  if (!state.range.active || state.range.openEnded) return;
  if (state.current !== state.range.surah) return;
  const cur = els.audio.currentTime || 0;
  const end = state.range.endTime;
  if (!isFinite(cur) || !isFinite(end) || end <= cur) return;
  const delay = Math.max(0, (end - cur) * 1000 - 30);
  _rangeHardStop = setTimeout(() => {
    _rangeHardStop = null;
    if (!state.range.active || state.range.openEnded) return;
    if (state.current !== state.range.surah) return;
    try { els.audio.pause(); } catch(_){}
    try { els.audio.currentTime = state.range.endTime; } catch(_){}
    handleRangeEnd();
  }, delay);
}
function startRangeWatch() { clearRangeHardStop(); if (!state.range.active || state.range.openEnded) return; scheduleHardStop(); }
function stopRangeWatch() { clearRangeHardStop(); }

let _playingSaveTimer = null;
function schedulePlayingSave() { if (_playingSaveTimer) clearTimeout(_playingSaveTimer); _playingSaveTimer = null; if (!state._playIntent || !state.current) return; _playingSaveTimer = setTimeout(() => { _playingSaveTimer = null; if (state._playIntent && state.current) { safeSave(); schedulePlayingSave(); } }, CONFIG.PLAYING_SAVE_INTERVAL_MS); }
function cancelPlayingSave() { if (_playingSaveTimer) { clearTimeout(_playingSaveTimer); _playingSaveTimer = null; } }

const Audio = {
  load(num, { autoplay = true, seek = 0 } = {}) {
    if (!SURAH_MAP.has(num)) return;
    const inL2 = state.range.active && state.range.crossSurah && state.range.phase === "leg2" && num === state.range.endSurah;
    if (state.range.active && !inL2) { const sc = (num !== state.range.surah) || (state.range.crossSurah && state.range.phase === "leg2"); if (sc) { const rc = state.range.repeatCount || 1; const ss = state.range.sameSurah; state.range = emptyRange(); state.range.repeatCount = rc; state.range.sameSurah = ss; UI.updateRangeBadges(); UI.rangeMarkers(); Range.syncUI(); stopRangeWatch(); } }
    markSilentSwitch();
    _audioLoadId++; pauseAudio();
    state.current = num; state.currentTime = seek || 0;
    setLoadedSource(state.reciterId, num);
    try { els.audio.src = resolveSurahSrc(state.reciterId, num); els.audio.playbackRate = state.speed; els.audio.volume = state.volume; els.audio.muted = state.volume === 0; els.audio.load(); } catch(_){}
    TextAPI.fetch(num).catch(() => {});
    if (autoplay) { state._playIntent = true; const p = els.audio.play(); if (p && p.catch) p.catch(() => {}); }
    OfflineResume.clear();
    saveSoon();
  },
  play() { state._playIntent = true; const p = els.audio.play(); if (p && p.catch) p.catch(() => {}); if (!navigator.onLine && state.current) OfflineResume.updatePlayState(true); },
  pause() { state._playIntent = false; els.audio.pause(); safeSave(); if (!navigator.onLine && state.current) OfflineResume.updatePlayState(false); },
  toggle() { if (!state.current) return; if (els.audio.paused) Audio.play(); else Audio.pause(); },
  seekTo(sec) { if (!isFinite(els.audio.duration)) return; const wasPlaying = state._playIntent; els.audio.currentTime = clamp(sec, 0, els.audio.duration); if (wasPlaying && els.audio.paused) { const p = els.audio.play(); if (p && p.catch) p.catch(() => {}); } safeSave(); },
  setVolume(v) { state.volume = clamp(v, 0, 1); els.audio.volume = state.volume; els.audio.muted = state.volume === 0; UI.volume(); saveSoon(); },
  setSpeed(s) { state.speed = s; els.audio.playbackRate = s; UI.speed(); saveSoon(); },
};

async function switchReciterSmart(newRid) {
  if (state.reciterId === newRid) return;
  const oldRid = state.reciterId;
  const wasPlaying = state._playIntent;
  const oldTime = els.audio.currentTime || state.currentTime || 0;
  const curSurah = state.current;
  let curAyah = null;
  if (curSurah) {
    if (!TimingsAPI.has(oldRid, curSurah) && !TimingsAPI.isDisabled(oldRid)) { try { await TimingsAPI.fetch(oldRid, curSurah); } catch(_){} }
    curAyah = Subtitle.findCurrentAyah(oldRid, curSurah, oldTime);
  }
  state.reciterId = newRid;
  const rec = RECITER_MAP.get(newRid);
  UI.reciterName(rec.name); UI.updateDownloadedBadges(); UI.updateMobileValues(); saveSoon();
  if (!curSurah) { toast(`🎙️ ${rec.name}`, "success"); return; }
  if (!TimingsAPI.has(newRid, curSurah) && !TimingsAPI.isDisabled(newRid)) { try { await TimingsAPI.fetch(newRid, curSurah); } catch(_){} }
  let targetTime = oldTime; let precise = false;
  const newTimings = TimingsAPI.getFor(newRid, curSurah);
  const newKeys = TimingsAPI.getKeysFor(newRid, curSurah);
  if (curAyah !== null && newTimings && newTimings[curAyah]) { targetTime = newTimings[curAyah].startTime; precise = true; }
  else if (curAyah !== null && newTimings && newKeys && newKeys.length) { let nearest = newKeys[0], best = Math.abs(newKeys[0] - curAyah); for (const k of newKeys) { const d = Math.abs(k - curAyah); if (d < best) { best = d; nearest = k; } } targetTime = newTimings[nearest].startTime; precise = true; }
  else if (curSurah === 1 && curAyah !== null) { const est = getFatihahEstimated(els.audio.duration); if (est && est[curAyah]) { targetTime = est[curAyah].startTime; precise = true; } }
  if (state.range.active && state.range.surah === curSurah && !state.range.crossSurah) { const r = state.range; if (r.mode === "duration") { const rangeDur = r.endTime - r.startTime; r.startTime = targetTime; r.endTime = targetTime + rangeDur; } else if (newTimings) { if (r.startAyah && newTimings[r.startAyah]) r.startTime = newTimings[r.startAyah].startTime; if (r.endAyah && newTimings[r.endAyah]) r.endTime = newTimings[r.endAyah].endTime + CONFIG.defaultEndBuffer; } UI.rangeMarkers(); }

  const isOffline = !navigator.onLine;
  if (isOffline) {
    state.currentTime = targetTime;
    OfflineResume.updateReciter(newRid, targetTime);
    UI.updatePlayingCard(); UI.nowPlaying(); UI.progress();
    Subtitle.currentKey = null; Subtitle.update();
    if (precise && curAyah !== null) toast(`🎙️ ${rec.name} — سيبدأ من آية ${curAyah} عند الاتصال`, "info");
    else toast(`🎙️ ${rec.name} — بانتظار الاتصال`, "info");
    return;
  }

  UI._markerRenderKey = null;
  markSilentSwitch();
  try { pauseAudio(); state.currentTime = targetTime; setLoadedSource(newRid, curSurah); els.audio.src = resolveSurahSrc(newRid, curSurah); els.audio.playbackRate = state.speed; els.audio.volume = state.volume; els.audio.muted = state.volume === 0; els.audio.load(); } catch(_) {}
  await new Promise((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; els.audio.removeEventListener("canplay", onCanPlay); els.audio.removeEventListener("error", onErr); clearTimeout(tmo); resolve(); };
    const onCanPlay = () => { try { els.audio.currentTime = targetTime; state.currentTime = targetTime; } catch(_){} if (wasPlaying) { state._playIntent = true; const p = els.audio.play(); if (p && p.catch) p.catch(() => {}); } UI._markerRenderKey = null; UI.renderAyahMarkers(); UI.progress(); Subtitle.currentKey = null; Subtitle.update(); finish(); };
    const onErr = () => finish();
    els.audio.addEventListener("canplay", onCanPlay);
    els.audio.addEventListener("error", onErr);
    const tmo = setTimeout(finish, 8000);
  });
  UI.updatePlayingCard(); UI.nowPlaying(); UI.rangeMarkers(); Subtitle.currentKey = null; Subtitle.update();
  if (precise && curAyah !== null) toast(`🎙️ ${rec.name} — بدءاً من آية ${curAyah}`, "success");
  else toast(`🎙️ ${rec.name}`, "success");
}

const Player = {
  playSurah(num) { if (!SURAH_MAP.has(num)) return; state._restoredFromSaved = false; state.mode = "seq"; state.qIndex = -1; Audio.load(num, { autoplay: true }); UI.updatePlayingCard(); UI.nowPlaying(); UI.updateResumeCard(); UI.updateQueuePlayButtons(); Range.syncUI(); },
  playQueueAt(idx) { if (idx < 0 || idx >= state.queue.length) return; const num = state.queue[idx]; if (state.current === num && state.mode === "queue") { Audio.toggle(); return; } state._restoredFromSaved = false; state.mode = "queue"; state.qIndex = idx; Audio.load(num, { autoplay: true }); UI.updatePlayingCard(); UI.nowPlaying(); UI.renderQueue(); UI.updateResumeCard(); Range.syncUI(); },
  next() { if (state.repeat === "one" && state.current) { els.audio.currentTime = 0; Audio.play(); return; } if (state.mode === "queue") { const cur = state.queue.indexOf(state.current); if (cur === -1) { if (state.queue.length) Player.playQueueAt(0); else Audio.pause(); return; } const n = cur + 1; if (n < state.queue.length) Player.playQueueAt(n); else if (state.repeat === "all" && state.queue.length) Player.playQueueAt(0); else Audio.pause(); return; } if (!state.current) return; const n = state.current + 1; if (n <= 114) Player.playSurah(n); else Audio.pause(); },
  prev() { if (state.mode === "queue") { const cur = state.queue.indexOf(state.current); if (cur > 0) Player.playQueueAt(cur - 1); else els.audio.currentTime = 0; return; } if (!state.current) return; if (state.current > 1) Player.playSurah(state.current - 1); else els.audio.currentTime = 0; },
};

const Queue = {
  toggle(num) { const i = state.queue.indexOf(num); if (i >= 0) Queue.removeAt(i); else Queue.add(num); },
  add(num) { if (!SURAH_MAP.has(num)) return; if (state.queue.includes(num)) { toast(`موجودة بالفعل`); return; } state.queue.push(num); syncQueueIndex(); UI.renderQueue(); UI.updateAddedButtons(); UI.updateMobileValues(); saveSoon(); toast(`أُضيفت ${SURAH_MAP.get(num).nameAr}`, "success"); },
  removeAt(i) { if (i < 0 || i >= state.queue.length) return; const removed = state.queue[i]; const wasP = state.mode === "queue" && state.current === removed; state.queue.splice(i, 1); if (wasP) { Audio.pause(); state.mode = "seq"; state.qIndex = -1; } else syncQueueIndex(); UI.renderQueue(); UI.updateAddedButtons(); UI.updateMobileValues(); saveSoon(); },
  clear() { if (!state.queue.length) return; state.queue = []; if (state.mode === "queue") { state.mode = "seq"; state.qIndex = -1; } UI.renderQueue(); UI.updateAddedButtons(); UI.updateMobileValues(); saveSoon(); toast("تم مسح القائمة"); },
  move(from, to) { if (from === to || from < 0 || to < 0) return; if (from >= state.queue.length || to >= state.queue.length) return; const [it] = state.queue.splice(from, 1); state.queue.splice(to, 0, it); syncQueueIndex(); const st = els.qlist.scrollTop; UI.renderQueue(); els.qlist.scrollTop = st; saveSoon(); },
  shuffle() { if (state.queue.length < 2) return; for (let i = state.queue.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [state.queue[i], state.queue[j]] = [state.queue[j], state.queue[i]]; } syncQueueIndex(); UI.renderQueue(); saveSoon(); toast("تم الخلط"); },
  playAll() { if (!state.queue.length) { toast("القائمة فارغة"); return; } Player.playQueueAt(0); },
};
function syncQueueIndex() { if (state.mode === "queue" && state.current) state.qIndex = state.queue.indexOf(state.current); }

function handleRangeEnd() {
  if (!state.range.active || state.range.openEnded) return;
  clearRangeHardStop();
  const r = state.range;
  const totalPlays = Math.max(1, r.repeatCount || 1);
  const currentIter = (r.repeatIndex || 0) + 1;
  if (currentIter < totalPlays) { r.repeatIndex = currentIter; els.audio.pause(); toast(`🔁 التشغيل ${currentIter + 1} من ${totalPlays} — إعادة...`, "repeat"); UI.phaseNotice(); UI.nowPlaying(); saveSoon(); setTimeout(restartRange, CONFIG.repeatRestartDelayMs); return; }
  const endS = SURAH_MAP.get(r.endSurah || r.surah);
  const suf = totalPlays > 1 ? ` (بعد ${totalPlays} مرات)` : "";
  let msg;
  if (r.sameSurah) msg = `انتهت سورة ${endS.nameAr}${suf}`;
  else if (r.mode === "duration") msg = `انتهت المدة${suf}`;
  else if (r.crossSurah) msg = `انتهى النطاق الممتد (آية ${r.endAyah} في ${endS.nameAr})${suf}`;
  else msg = `انتهى النطاق (آية ${r.endAyah})${suf}`;
  els.audio.pause();
  state.range = emptyRange();
  UI.updateRangeBadges(); UI.rangeMarkers(); Range.syncUI(); UI.phaseNotice(); UI.nowPlaying(); stopRangeWatch(); saveSoon();
  toast(`${msg} — اضغط تشغيل للمتابعة`, "success");
}

function restartRange() {
  if (!state.range.active) return;
  const r = state.range;
  if (r.crossSurah) { r.phase = "leg1"; state._restoredFromSaved = false; markSilentSwitch(); _audioLoadId++; pauseAudio(); state.current = r.surah; state.currentTime = r.startTime; setLoadedSource(state.reciterId, r.surah); try { els.audio.src = resolveSurahSrc(state.reciterId, r.surah); els.audio.load(); } catch(_){} TextAPI.fetch(r.surah).catch(() => {}); state._playIntent = true; const p = els.audio.play(); if (p && p.catch) p.catch(() => {}); }
  else { try { els.audio.currentTime = r.startTime; state.currentTime = r.startTime; } catch(_){} Audio.play(); }
  UI.updatePlayingCard(); UI.updateRangeBadges(); UI.rangeMarkers();
  UI.nowPlaying(); UI.phaseNotice(); saveSoon();
  startRangeWatch();
  Subtitle.currentKey = null;
  Subtitle.update();
}

function transitionToLeg2() { if (!state.range.active || !state.range.crossSurah || state.range.phase !== "leg1") return; const e = state.range.endSurah; if (!e || !SURAH_MAP.has(e)) return; state.range.phase = "leg2"; state._restoredFromSaved = false; markSilentSwitch(); _audioLoadId++; pauseAudio(); state.current = e; state.currentTime = 0; setLoadedSource(state.reciterId, e); try { els.audio.src = resolveSurahSrc(state.reciterId, e); els.audio.load(); } catch(_){} TextAPI.fetch(e).catch(() => {}); state._playIntent = true; const p = els.audio.play(); if (p && p.catch) p.catch(() => {}); UI.updatePlayingCard(); UI.nowPlaying(); UI.updateRangeBadges(); UI.rangeMarkers(); UI.phaseNotice(); saveSoon(); toast(`▶ الانتقال إلى ${SURAH_MAP.get(e).nameAr} — حتى آية ${state.range.endAyah}`, "info"); }

const Range = {
  isOpen() { return els.rangePanel.classList.contains("on"); },
  open() { if (!state.current) { toast("شغّل سورة أولًا", "error"); return; } Range.syncUI(); els.rangePanel.classList.add("on"); els.rangePanel.setAttribute("aria-hidden", "false"); els.rangeBtn.classList.add("active"); UI.phaseNotice(); },
  close() { els.rangePanel.classList.remove("on"); els.rangePanel.setAttribute("aria-hidden", "true"); if (!state.range.active) els.rangeBtn.classList.remove("active"); },
  toggle() { Range.isOpen() ? Range.close() : Range.open(); },
  setMode(mode) { const ev = parseInt(els.rpEndSurahSelect.value, 10) || state.current; if (ev !== state.current && mode === "duration") mode = "ayah"; state.range._pendingMode = mode; const ia = mode === "ayah"; els.rpEndAyahField.style.display = ia ? "" : "none"; els.rpDurationField.style.display = ia ? "none" : ""; $$("#rpModeToggle button").forEach(b => { b.classList.toggle("active", b.dataset.mode === mode); if (b.dataset.mode === "duration" && ev !== state.current) { b.disabled = true; } else { b.disabled = false; } }); Range.clearErrors(); },
  clearErrors() { els.rpStartField.classList.remove("error"); const ef = els.rpEndSelect.closest(".rp-field"); if (ef) ef.classList.remove("error"); els.rpDurHoursCell.classList.remove("error"); els.rpDurMinutesCell.classList.remove("error"); },
  showError(el, msg) { Range.clearErrors(); if (el) { el.classList.add("error"); setTimeout(() => el.classList.remove("error"), 3000); } toast(msg, "error"); },
  async ensureTimings(sn) { if (TimingsAPI.isDisabled(state.reciterId)) return false; if (TimingsAPI.has(state.reciterId, sn)) return true; const r = await TimingsAPI.fetch(state.reciterId, sn); return !!r; },
  buildAyahOptions(sel, count, ie = true) { sel.innerHTML = ie ? '<option value="">اختر</option>' : '<option value="">بدون حد</option>'; const frag = document.createDocumentFragment(); for (let i = 1; i <= count; i++) { const o = document.createElement("option"); o.value = i; o.textContent = `آية ${i}`; frag.appendChild(o); } sel.appendChild(frag); },
  updateRepeatHighlight() { let v = parseInt(els.rpRepeatCount.value, 10); if (!isFinite(v) || isNaN(v) || v < 1) v = 1; $$(".rp-repeat-preset").forEach(b => b.classList.toggle("active", parseInt(b.dataset.count, 10) === v)); },
  getAyahTime(sn, ayah, dur) { const t = TimingsAPI.getFor(state.reciterId, sn); if (t && t[ayah]) return t[ayah]; if (sn === 1) { const est = getFatihahEstimated(dur); if (est && est[ayah]) return est[ayah]; } return null; },
  getExtendedEndTime(sn, ayah, dur) {
    const timings = TimingsAPI.getFor(state.reciterId, sn);
    const buffer = CONFIG.ayahBoundaryBufferMs / 1000;
    if (timings && timings[ayah]) { const cur = timings[ayah]; const nextAyah = timings[ayah + 1]; if (nextAyah && nextAyah.startTime > cur.startTime + 0.2) { const stopBeforeNext = nextAyah.startTime - buffer; const limitByEnd = cur.endTime > cur.startTime + 0.4 ? cur.endTime - 0.05 : null; if (limitByEnd !== null) return Math.max(cur.startTime + 0.3, Math.min(stopBeforeNext, limitByEnd)); return Math.max(cur.startTime + 0.3, stopBeforeNext); } if (dur > 0 && dur > cur.startTime + 0.3) return dur; return cur.endTime; }
    if (sn === 1) { const est = getFatihahEstimated(dur); if (est && est[ayah]) { const cur = est[ayah]; const nextAyah = est[ayah + 1]; if (nextAyah) return Math.max(cur.startTime + 0.3, nextAyah.startTime - buffer); return dur > 0 ? dur : cur.endTime; } }
    return null;
  },
  updateSameSurahUI() { const on = !!state.range.sameSurah; if (els.rpSameSurah) { els.rpSameSurah.classList.toggle("active", on); els.rpSameSurah.setAttribute("aria-pressed", on ? "true" : "false"); } [els.rpStartField, els.rpModeField, els.rpEndAyahField, els.rpDurationField].forEach(f => { if (f) f.classList.toggle("rp-disabled", on); }); },
  toggleSameSurah() { state.range.sameSurah = !state.range.sameSurah; Range.updateSameSurahUI(); if (state.range.sameSurah) toast("🔁 سورة كاملة — عدد المرات شغال عادي", "info"); },
  syncUI() {
    const s = state.current ? SURAH_MAP.get(state.current) : null; if (!s) { els.rpSurahName.textContent = ""; return; }
    els.rpSurahName.textContent = `— سورة ${s.nameAr} (${s.ayahs} آية)`;
    els.rpEndSurahSelect.innerHTML = SURAHS.map(x => `<option value="${x.number}">${x.number}. ${esc(x.nameAr)}</option>`).join("");
    const ssn = state.range.active && state.range.crossSurah && state.range.surah ? state.range.surah : state.current;
    const ss = SURAH_MAP.get(ssn) || s;
    let esn = state.current; if (state.range.active && state.range.endSurah) esn = state.range.endSurah;
    els.rpEndSurahSelect.value = esn;
    Range.buildAyahOptions(els.rpStartSelect, ss.ayahs, true);
    if (state.range.active && state.range.crossSurah) { els.rpStartContext.textContent = `في ${ss.nameAr}`; els.rpStartContext.style.display = ""; } else els.rpStartContext.style.display = "none";
    const es = SURAH_MAP.get(esn);
    Range.buildAyahOptions(els.rpEndSelect, es ? es.ayahs : s.ayahs, true);
    const cm = (state.range.active && state.range.surah === ssn) ? (state.range.mode || "ayah") : (state.range._pendingMode || "ayah");
    Range.setMode(cm);
    if (state.range.active) {
      const inL1 = !state.range.crossSurah && state.current === state.range.surah;
      const inCL1 = state.range.crossSurah && state.range.phase === "leg1" && state.current === state.range.surah;
      const inCL2 = state.range.crossSurah && state.range.phase === "leg2" && state.current === state.range.endSurah;
      if (inL1 || inCL1 || inCL2) { els.rpStartSelect.value = state.range.startAyah || ""; if (state.range.crossSurah) { els.rpEndSurahSelect.value = state.range.endSurah || state.current; const esx = SURAH_MAP.get(state.range.endSurah); Range.buildAyahOptions(els.rpEndSelect, esx ? esx.ayahs : s.ayahs, true); } if (state.range.mode === "ayah") els.rpEndSelect.value = state.range.endAyah || ""; else { const ts = Math.max(0, Math.round(state.range.endTime - state.range.startTime)); const h = Math.floor(ts / 3600); const m = Math.floor((ts % 3600) / 60); els.rpDurHours.value = h > 0 ? h : ""; els.rpDurMinutes.value = m > 0 ? m : ""; } els.rpRepeatCount.value = state.range.repeatCount || 1; }
      else { els.rpStartSelect.value = ""; els.rpEndSelect.value = ""; els.rpDurHours.value = ""; els.rpDurMinutes.value = ""; }
    } else { els.rpStartSelect.value = ""; els.rpEndSelect.value = ""; els.rpDurHours.value = ""; els.rpDurMinutes.value = ""; els.rpRepeatCount.value = "1"; }
    Range.refreshCrossSurahUI(); Range.updateRepeatHighlight(); Range.updateSameSurahUI(); UI.phaseNotice();
  },
  refreshCrossSurahUI() { const ev = parseInt(els.rpEndSurahSelect.value, 10) || state.current; const ic = ev !== state.current; els.rpEndRow.classList.toggle("cross-surah", ic); if (ic) { const s = SURAH_MAP.get(ev); els.rpEndCrossHint.textContent = `في ${s.nameAr}`; } else els.rpEndCrossHint.textContent = ""; },
  async apply() {
    Range.clearErrors();
    if (!state.current) { toast("شغّل سورة أولًا", "error"); return; }
    const ssn = state.range.active && state.range.crossSurah && state.range.surah ? state.range.surah : state.current;
    const ss = SURAH_MAP.get(ssn); if (!ss) { toast("تعذر تحديد سورة البداية", "error"); return; }
    let rc = parseInt(els.rpRepeatCount.value, 10); if (!isFinite(rc) || isNaN(rc) || rc < 1) rc = 1; rc = clamp(rc, 1, CONFIG.maxRepeatCount);
    if (state.range.sameSurah) {
      const sFull = SURAH_MAP.get(state.current); if (!sFull) return;
      const sdur = (isFinite(els.audio.duration) && els.audio.duration > 0) ? els.audio.duration : null;
      await Range.ensureTimings(state.current);
      const sd = Range.getAyahTime(state.current, 1, sdur);
      let st = sd ? clamp(sd.startTime, 0, sdur || Infinity) : 0;
      const extendedEnd = Range.getExtendedEndTime(state.current, sFull.ayahs, sdur);
      const dur = (isFinite(els.audio.duration) && els.audio.duration > 0) ? els.audio.duration : sdur;
      let et = (extendedEnd !== null && dur) ? clamp(extendedEnd, st + 0.3, dur) : (dur || Infinity);
      state.range = { active: true, surah: state.current, endSurah: state.current, crossSurah: false, phase: "leg1", mode: "ayah", startAyah: 1, endAyah: sFull.ayahs, startTime: st, endTime: et, _pendingMode: "ayah", estimated: false, openEnded: false, repeatCount: rc, repeatIndex: 0, sameSurah: true };
      state.currentTime = st; try { els.audio.currentTime = st; } catch(_){}
      state._restoredFromSaved = false;
      UI.updateRangeBadges(); UI.rangeMarkers(); UI.updateResumeCard(); UI.nowPlaying(); UI.phaseNotice(); saveSoon();
      if (!els.audio.paused) startRangeWatch();
      const rtxt = rc > 1 ? ` × ${rc} مرات` : "";
      toast(`✅ سورة ${sFull.nameAr} كاملة${rtxt}`, "success");
      setTimeout(() => { if (Range.isOpen()) Range.close(); }, CONFIG.autoClosePanelDelayMs);
      return;
    }
    let sa = parseInt(els.rpStartSelect.value, 10); if (!isFinite(sa) || sa < 1) { Range.showError(els.rpStartField, "⚠️ اختر آية البداية"); return; } sa = clamp(sa, 1, ss.ayahs);
    let esn = parseInt(els.rpEndSurahSelect.value, 10); if (!isFinite(esn) || !SURAH_MAP.has(esn)) esn = state.current;
    const es = SURAH_MAP.get(esn); const ic = esn !== ssn; const mode = state.range._pendingMode || "ayah";
    if (ic && mode === "duration") { Range.showError(els.rpDurationField, "استخدم وضع 'عند آية' مع النطاق الممتد"); return; }
    const sdur = (state.current === ssn && isFinite(els.audio.duration) && els.audio.duration > 0) ? els.audio.duration : null;
    if (ic) {
      let ea = parseInt(els.rpEndSelect.value, 10); if (!isFinite(ea) || ea < 1) { Range.showError(els.rpEndSelect.closest(".rp-field"), "⚠️ اختر آية النهاية"); return; } ea = clamp(ea, 1, es.ayahs);
      await Range.ensureTimings(ssn); await Range.ensureTimings(esn);
      const sd = Range.getAyahTime(ssn, sa, sdur);
      const extendedEnd = Range.getExtendedEndTime(esn, ea, sdur);
      let st = sd ? sd.startTime : 0, et = extendedEnd !== null ? extendedEnd : 0;
      state.range = { active: true, surah: ssn, endSurah: esn, crossSurah: true, phase: "leg1", mode: "ayah", startAyah: sa, endAyah: ea, startTime: st, endTime: et, _pendingMode: "ayah", estimated: false, openEnded: false, repeatCount: rc, repeatIndex: 0, sameSurah: false };
      state.currentTime = state.range.startTime; state._restoredFromSaved = false;
      if (state.current !== ssn) { markSilentSwitch(); _audioLoadId++; pauseAudio(); state.current = ssn; state.currentTime = state.range.startTime; setLoadedSource(state.reciterId, ssn); try { els.audio.src = resolveSurahSrc(state.reciterId, ssn); els.audio.load(); } catch(_){} TextAPI.fetch(ssn).catch(() => {}); if (state._playIntent) { const p = els.audio.play(); if (p && p.catch) p.catch(() => {}); } } else { try { els.audio.currentTime = state.range.startTime; } catch(_){} }
      UI.updateRangeBadges(); UI.rangeMarkers(); UI.updateResumeCard(); UI.nowPlaying(); UI.phaseNotice(); saveSoon();
      if (!els.audio.paused) startRangeWatch();
      const rtxt = rc > 1 ? ` × ${rc} مرات` : "";
      toast(`✅ من آية ${sa} في ${ss.nameAr} ← آية ${ea} في ${es.nameAr}${rtxt}`, "success");
      setTimeout(() => { if (Range.isOpen()) Range.close(); }, CONFIG.autoClosePanelDelayMs);
      return;
    }
    if (state.current !== ssn) { markSilentSwitch(); _audioLoadId++; pauseAudio(); state.current = ssn; state.currentTime = 0; setLoadedSource(state.reciterId, ssn); try { els.audio.src = resolveSurahSrc(state.reciterId, ssn); els.audio.load(); } catch(_){} TextAPI.fetch(ssn).catch(() => {}); if (state._playIntent) { const p = els.audio.play(); if (p && p.catch) p.catch(() => {}); } await new Promise(r => { if (isFinite(els.audio.duration) && els.audio.duration > 0) { r(); return; } const ol = () => { els.audio.removeEventListener("loadedmetadata", ol); r(); }; els.audio.addEventListener("loadedmetadata", ol); setTimeout(r, 1500); }); }
    const dur = (isFinite(els.audio.duration) && els.audio.duration > 0) ? els.audio.duration : sdur;
    if (!dur) { toast("انتظر تحميل السورة", "error"); return; }
    if (mode === "ayah") {
      let ea = parseInt(els.rpEndSelect.value, 10); const he = isFinite(ea) && ea >= 1;
      if (he) { ea = clamp(ea, 1, ss.ayahs); if (sa > ea) { Range.showError(els.rpEndSelect.closest(".rp-field"), `❌ آية البداية (${sa}) أكبر من النهاية (${ea})`); return; } }
      await Range.ensureTimings(ssn);
      const sd = Range.getAyahTime(ssn, sa, dur);
      let st = sd ? clamp(sd.startTime, 0, dur) : 0;
      if (!he) {
        state.range = { active: true, surah: ssn, endSurah: ssn, crossSurah: false, phase: "leg1", mode: "ayah", startAyah: sa, endAyah: null, startTime: st, endTime: dur, _pendingMode: "ayah", estimated: false, openEnded: true, repeatCount: rc, repeatIndex: 0, sameSurah: false };
        state.currentTime = st; try { els.audio.currentTime = st; } catch(_){} state._restoredFromSaved = false;
        UI.updateRangeBadges(); UI.rangeMarkers(); UI.updateResumeCard(); UI.nowPlaying(); UI.phaseNotice(); saveSoon();
        const rtxt = rc > 1 ? ` × ${rc} مرات` : "";
        toast(`▶ سيبدأ من آية ${sa} — سيستمر حتى الإيقاف${rtxt}`, "success");
        setTimeout(() => { if (Range.isOpen()) Range.close(); }, CONFIG.autoClosePanelDelayMs);
        return;
      }
      const extendedEnd = Range.getExtendedEndTime(ssn, ea, dur);
      let et = extendedEnd !== null ? clamp(extendedEnd, st + 0.3, dur) : dur;
      state.range = { active: true, surah: ssn, endSurah: ssn, crossSurah: false, phase: "leg1", mode, startAyah: sa, endAyah: ea, startTime: st, endTime: et, _pendingMode: mode, estimated: false, openEnded: false, repeatCount: rc, repeatIndex: 0, sameSurah: false };
      state.currentTime = st; try { els.audio.currentTime = st; } catch(_){} state._restoredFromSaved = false;
      UI.updateRangeBadges(); UI.rangeMarkers(); UI.updateResumeCard(); UI.nowPlaying(); UI.phaseNotice(); saveSoon();
      if (!els.audio.paused) startRangeWatch();
      const rtxt = rc > 1 ? ` × ${rc} مرات` : "";
      toast(`✅ النطاق: آية ${sa} → ${ea}${rtxt}`, "success");
      setTimeout(() => { if (Range.isOpen()) Range.close(); }, CONFIG.autoClosePanelDelayMs);
      return;
    }
    let h = els.rpDurHours.value.trim() === "" ? 0 : parseInt(els.rpDurHours.value, 10);
    let m = els.rpDurMinutes.value.trim() === "" ? 0 : parseInt(els.rpDurMinutes.value, 10);
    if (!isFinite(h)) h = 0; if (!isFinite(m)) m = 0; h = clamp(h, 0, 12); m = clamp(m, 0, 59);
    const ts = h * 3600 + m * 60; if (ts <= 0) { Range.showError(els.rpDurHoursCell, "⚠️ حدد مدة أكبر من صفر"); return; }
    await Range.ensureTimings(ssn);
    const sd = Range.getAyahTime(ssn, sa, dur);
    let st = sd ? clamp(sd.startTime, 0, dur) : 0;
    const et = clamp(st + ts, st + 0.3, dur);
    state.range = { active: true, surah: ssn, endSurah: ssn, crossSurah: false, phase: "leg1", mode: "duration", startAyah: sa, endAyah: null, startTime: st, endTime: et, _pendingMode: "duration", estimated: false, openEnded: false, repeatCount: rc, repeatIndex: 0, sameSurah: false };
    state.currentTime = st; try { els.audio.currentTime = st; } catch(_){} state._restoredFromSaved = false;
    UI.updateRangeBadges(); UI.rangeMarkers(); UI.updateResumeCard(); UI.nowPlaying(); UI.phaseNotice(); saveSoon();
    if (!els.audio.paused) startRangeWatch();
    const parts = []; if (h) parts.push(`${h} ساعة`); if (m) parts.push(`${m} دقيقة`);
    const rtxt = rc > 1 ? ` × ${rc} مرات` : "";
    toast(`✅ سيبدأ من آية ${sa} وينتهي بعد ${parts.join(" و ")}${rtxt}`, "success");
    setTimeout(() => { if (Range.isOpen()) Range.close(); }, CONFIG.autoClosePanelDelayMs);
  },
  clear() {
    state.range = emptyRange();
    els.rpStartSelect.value = ""; els.rpEndSelect.value = ""; els.rpDurHours.value = ""; els.rpDurMinutes.value = "";
    els.rpRepeatCount.value = "1"; els.rpStartContext.style.display = "none";
    Range.clearErrors();
    UI.updateRangeBadges(); UI.rangeMarkers(); els.rangeBtn.classList.remove("active");
    stopRangeWatch(); Range.refreshCrossSurahUI(); Range.updateRepeatHighlight(); Range.updateSameSurahUI(); UI.phaseNotice(); UI.nowPlaying(); saveSoon();
    toast("تم مسح النطاق", "success");
    setTimeout(() => { if (Range.isOpen()) Range.close(); }, CONFIG.autoClosePanelDelayMs);
  },
};

const RecitersUI = {
  renderList(q) { const ql = (q || "").trim().toLowerCase(); const items = ql ? CONFIG.reciters.filter(r => r.name.toLowerCase().includes(ql) || (r.rewayah || "").toLowerCase().includes(ql)) : CONFIG.reciters; if (!items.length) { els.reciterList.innerHTML = `<div class="reciter-empty">لا نتائج</div>`; return; } els.reciterList.innerHTML = items.map(r => `<div class="reciter-item ${r.id === state.reciterId ? "active" : ""}" data-id="${r.id}" role="menuitem"><span class="r-name">${esc(r.name)}</span><span class="r-rewayah">${esc(r.rewayah)}</span></div>`).join(""); },
  open() { els.reciterBtn.classList.add("active"); els.reciterDropdown.classList.add("on"); els.reciterSearchInput.value = ""; RecitersUI.renderList(""); setTimeout(() => { try { els.reciterSearchInput.focus(); } catch(_){} }, 100); },
  close() { els.reciterBtn.classList.remove("active"); els.reciterDropdown.classList.remove("on"); },
  isOpen() { return els.reciterDropdown.classList.contains("on"); },
  toggle() { RecitersUI.isOpen() ? RecitersUI.close() : RecitersUI.open(); },
};

const Downloads = {
  _queue: [], _running: 0, _controllers: new Map(), _progress: new Map(),
  isDownloading(key) { return this._controllers.has(key); },
  cancel(key) {
    const ctrl = this._controllers.get(key); if (!ctrl) return;
    ctrl.abort(); this._controllers.delete(key); this._progress.delete(key);
    this._queue = this._queue.filter(it => `${it.reciterId}-${it.surahNum}` !== key);
    const [r, s] = key.split("-").map(Number);
    const btn = cardEls.get(s)?.querySelector('[data-act="download"]');
    if (btn) { btn.classList.remove("downloading"); btn.classList.add("cancelled"); btn.innerHTML = `<span class="ring"></span><svg viewBox="0 0 24 24">${ICONS.x}</svg>`; setTimeout(() => { btn.classList.remove("cancelled"); btn.innerHTML = `<span class="ring"></span><svg viewBox="0 0 24 24">${ICONS.download}</svg>`; }, 1200); }
    const dlItem = els.dlList.querySelector(`.dl-item[data-key="${key}"]`);
    if (dlItem) { dlItem.classList.remove("downloading"); dlItem.classList.add("failed"); const small = dlItem.querySelector("small"); if (small) small.textContent = "✗ أُلغي"; }
    toast("تم إلغاء التحميل");
  },
  async loadFromIDB() { try { const all = await IDB.getAll(); state.downloads = all.map(r => ({ key: r.key, reciterId: r.reciterId, surahNum: r.surahNum, size: r.size || (r.blob ? r.blob.size : 0) })); all.forEach(r => { if (r.blob) registerObjectUrl(r.reciterId, r.surahNum, r.blob); }); } catch (e) { state.downloads = []; } },
  isDownloaded(rid, sn) { return state.downloads.some(d => d.reciterId === rid && d.surahNum === sn); },
  async downloadOne(rid, sn, { onProgress } = {}) {
    const key = `${rid}-${sn}`;
    if (Downloads.isDownloaded(rid, sn)) { if (onProgress) onProgress(1, 1, true); return true; }
    const controller = new AbortController();
    Downloads._controllers.set(key, controller);
    const url = getSurahUrl(rid, sn);
    try {
      const res = await fetch(url, { cache: "no-store", signal: controller.signal });
      if (!res.ok) throw new Error("HTTP " + res.status);
      if (!res.body) throw new Error("لا يوجد محتوى");
      const total = +(res.headers.get("Content-Length") || 0);
      let blob = null;
      try { const reader = res.body.getReader(); const chunks = []; let received = 0; while (true) { const { done, value } = await reader.read(); if (done) break; if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError"); chunks.push(value); received += value.length; if (onProgress && total > 0) onProgress(received, total); } if (total > 0 && received < total * 0.98) throw new Error(`حجم ناقص: ${received}/${total}`); blob = new Blob(chunks, { type: "audio/mpeg" }); }
      catch (readerErr) { if (readerErr.name === "AbortError") throw readerErr; console.warn("[Download] reader failed → fallback:", readerErr.message); const res2 = await fetch(url, { cache: "no-store", signal: controller.signal }); if (!res2.ok) throw new Error("HTTP " + res2.status); blob = await res2.blob(); }
      if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (!blob || blob.size === 0) throw new Error("ملف فارغ");
      if (onProgress) onProgress(blob.size, blob.size, false);
      const rec = { key, reciterId: rid, surahNum: sn, blob, size: blob.size, timestamp: Date.now() };
      await IDB.put(rec); registerObjectUrl(rid, sn, blob);
      state.downloads.push({ key, reciterId: rid, surahNum: sn, size: blob.size });
      try { if (!TimingsAPI.has(rid, sn) && !TimingsAPI.isDisabled(rid)) await TimingsAPI.fetch(rid, sn, true); } catch(_){}
      try { if (!TextAPI.has(sn)) await TextAPI.fetch(sn, true); } catch(_){}
      if (onProgress) onProgress(blob.size, blob.size, true);
      return true;
    } catch (e) { if (e.name === "AbortError") return false; console.error("[Download] Failed:", key, e); if (onProgress) onProgress(0, 0, false, e); return false; } finally { Downloads._controllers.delete(key); Downloads._progress.delete(key); }
  },
  async deleteOne(rid, sn) {
    const key = `${rid}-${sn}`;
    try { await IDB.delete(key); } catch(_){}
    unregisterObjectUrl(rid, sn);
    state.downloads = state.downloads.filter(d => !(d.reciterId === rid && d.surahNum === sn));
    try { await IDB.deleteTiming(rid, sn); if (TimingsAPI.cache[rid]) delete TimingsAPI.cache[rid][sn]; if (TimingsAPI.sortedKeys[rid]) delete TimingsAPI.sortedKeys[rid][sn]; } catch(_){}
    const anyOther = state.downloads.some(d => d.surahNum === sn);
    if (!anyOther) { try { await IDB.deleteText(sn); TextAPI.cache.delete(sn); } catch(_){} }
    UI.updateDownloadedBadges(); UI.updateMobileValues();
    if (state.current === sn && state.reciterId === rid) { const wp = state._playIntent; const pos = els.audio.currentTime || 0; try { els.audio.src = getSurahUrl(rid, sn); } catch(_){} els.audio.load(); els.audio.addEventListener("loadedmetadata", function once() { els.audio.removeEventListener("loadedmetadata", once); try { els.audio.currentTime = pos; } catch(_){} if (wp) Audio.play(); }); }
  },
  async clearAll() { try { await IDB.clear(); } catch(_){} try { await IDB.clearTimings(); } catch(_){} try { await IDB.clearTexts(); } catch(_){} for (const k of _objectUrls.keys()) { try { URL.revokeObjectURL(_objectUrls.get(k)); } catch(_){} } _objectUrls.clear(); state.downloads = []; TimingsAPI.cache = {}; TimingsAPI.sortedKeys = {}; TimingsAPI._touchMap.clear(); TextAPI.cache.clear(); UI.updateDownloadedBadges(); UI.updateMobileValues(); },
  enqueue(items) { items.forEach(it => Downloads._queue.push(it)); Downloads.pump(); },
  pump() { while (Downloads._running < CONFIG.downloadConcurrency && Downloads._queue.length) { const it = Downloads._queue.shift(); Downloads._running++; Downloads.runTask(it).finally(() => { Downloads._running--; Downloads.pump(); }); } },
  async runTask({ reciterId, surahNum }) {
    const key = `${reciterId}-${surahNum}`;
    const btn = cardEls.get(surahNum)?.querySelector('[data-act="download"]');
    const dlItem = els.dlList.querySelector(`.dl-item[data-key="${key}"]`);
    const dlProg = dlItem?.querySelector(".dl-progress i");
    const dlSmall = dlItem?.querySelector("small");
    if (btn) btn.classList.add("downloading"); if (dlItem) dlItem.classList.add("downloading"); if (dlSmall) dlSmall.textContent = "جاري...";
    const ok = await Downloads.downloadOne(reciterId, surahNum, { onProgress: (recv, total, done, err) => { if (err) { if (dlSmall) dlSmall.textContent = "✗ فشل"; if (dlProg) { dlProg.style.width = "100%"; dlProg.style.background = "var(--rose)"; } return; } if (total > 0) { const pct = Math.min(100, Math.round((recv / total) * 100)); if (dlProg) dlProg.style.width = pct + "%"; if (dlSmall) dlSmall.textContent = done ? `✓ تم — ${fmtBytes(recv)}` : `جاري... ${pct}%`; } else { if (dlSmall) dlSmall.textContent = done ? `✓ تم — ${fmtBytes(recv)}` : "جاري..."; } } });
    if (btn) btn.classList.remove("downloading");
    if (dlItem) { dlItem.classList.remove("downloading"); if (ok) { dlItem.classList.remove("checked", "failed"); dlItem.classList.add("downloaded"); state._downloadSelection.delete(key); } else dlItem.classList.add("failed"); }
    UI.updateDownloadedBadges(); Downloads.updateBadge(); UI.updateMobileValues();
  },
  updateBadge() { const n = state.downloads.filter(d => d.reciterId === state.reciterId).length; els.storageBadge.textContent = n; els.storageBadge.classList.toggle("on", n > 0); },
  openModal() { state._downloadSelection.clear(); Downloads.renderList(); Downloads.updateSelectionUI(); openModal(els.downloadOverlay); },
  closeModal() { closeModal(els.downloadOverlay); },
  renderList() { const rec = RECITER_MAP.get(state.reciterId); els.downloadReciterName.textContent = rec ? `— ${rec.name}` : ""; const ds = new Set(state.downloads.filter(d => d.reciterId === state.reciterId).map(d => d.surahNum)); els.dlList.innerHTML = SURAHS.map(s => { const k = `${state.reciterId}-${s.number}`; const has = ds.has(s.number); const ch = state._downloadSelection.has(k); return `<div class="dl-item ${has ? "downloaded" : ""} ${ch ? "checked" : ""}" data-key="${k}" data-num="${s.number}"><div class="dl-check"><svg viewBox="0 0 24 24">${has || ch ? ICONS.check : ""}</svg></div><span class="dl-num">${s.number}</span><div class="dl-info"><b>${esc(s.nameAr)}</b><small>${has ? "محمّلة ✓" : `${s.ayahs} آية · ${s.type}`}</small><div class="dl-progress"><i style="width:0%"></i></div></div></div>`; }).join(""); },
  updateSelectionUI() { const n = state._downloadSelection.size; els.dlCountPill.textContent = `${n} محددة`; els.dlStartCount.textContent = n; els.dlStartBtn.disabled = n === 0; const as = SURAHS.map(s => `${state.reciterId}-${s.number}`); const ds = new Set(state.downloads.filter(d => d.reciterId === state.reciterId).map(d => `${d.reciterId}-${d.surahNum}`)); const sel = as.filter(k => !ds.has(k)); els.dlSelectAll.checked = sel.length > 0 && sel.every(k => state._downloadSelection.has(k)); },
  toggleSelection(num) { const k = `${state.reciterId}-${num}`; const ds = new Set(state.downloads.filter(d => d.reciterId === state.reciterId).map(d => d.surahNum)); if (ds.has(num)) return; if (state._downloadSelection.has(k)) state._downloadSelection.delete(k); else state._downloadSelection.add(k); const item = els.dlList.querySelector(`.dl-item[data-num="${num}"]`); if (item) item.classList.toggle("checked", state._downloadSelection.has(k)); const sv = item?.querySelector(".dl-check svg"); if (sv) sv.innerHTML = state._downloadSelection.has(k) ? ICONS.check : ""; Downloads.updateSelectionUI(); },
  toggleSelectAll(ch) { const ds = new Set(state.downloads.filter(d => d.reciterId === state.reciterId).map(d => d.surahNum)); state._downloadSelection.clear(); if (ch) SURAHS.forEach(s => { if (!ds.has(s.number)) state._downloadSelection.add(`${state.reciterId}-${s.number}`); }); Downloads.renderList(); Downloads.updateSelectionUI(); },
  startSelected() { if (!state._downloadSelection.size) return; const items = Array.from(state._downloadSelection).map(k => { const [r, s] = k.split("-").map(Number); return { reciterId: r, surahNum: s }; }); const td = items.filter(it => !Downloads.isDownloaded(it.reciterId, it.surahNum)); if (!td.length) { toast("كل السور محمّلة"); return; } Downloads.enqueue(td); toast(`بدأ تحميل ${td.length} سورة`, "success"); },
};

function updatePrefetchUI() {
  const s = Prefetcher.status();
  const total = s.total || 798;
  const pct = total > 0 ? Math.min(100, Math.round((s.done / total) * 100)) : 0;
  if (els.prefetchBarFill) els.prefetchBarFill.style.width = pct + "%";
  if (els.prefetchPercent) els.prefetchPercent.textContent = pct + "%";
  if (els.prefetchText) els.prefetchText.textContent = `${s.done} / ${total}`;
  if (els.prefetchFailed) els.prefetchFailed.textContent = s.failed > 0 ? `${s.failed} فشل` : "";
  if (els.prefetchStatus) {
    els.prefetchStatus.classList.remove("running", "complete", "paused", "error", "aborted");
    let txt = "—";
    if (s.phase === "complete") { txt = "✅ مكتمل"; els.prefetchStatus.classList.add("complete"); }
    else if (s.phase === "running") { txt = "⏳ جاري"; els.prefetchStatus.classList.add("running"); }
    else if (s.phase === "paused") { txt = "⏸ موقوف"; els.prefetchStatus.classList.add("paused"); }
    else if (s.phase === "aborted") { txt = "⛔"; els.prefetchStatus.classList.add("aborted"); }
    else if (s.phase === "error") { txt = "❌"; els.prefetchStatus.classList.add("error"); }
    else { txt = "بانتظار"; }
    els.prefetchStatus.textContent = txt;
  }
}

const StoragePanel = {
  open() { StoragePanel.render(); openModal(els.storageOverlay); StoragePanel.refreshEstimate(); updatePrefetchUI(); },
  close() { closeModal(els.storageOverlay); },
  async refreshEstimate() { if (!navigator.storage || !navigator.storage.estimate) { els.storageUsed.textContent = "—"; els.storageAvail.textContent = "—"; return; } try { const est = await navigator.storage.estimate(); const u = est.usage || 0, q = est.quota || 0; const pct = q > 0 ? Math.min(100, (u / q) * 100) : 0; els.storageBarFill.style.width = pct.toFixed(1) + "%"; els.storageUsed.textContent = fmtBytes(u); els.storageAvail.textContent = fmtBytes(Math.max(0, q - u)); } catch(_) { els.storageUsed.textContent = "—"; } },
  render() {
    const tot = state.downloads.reduce((a, d) => a + (d.size || 0), 0);
    const recs = new Set(state.downloads.map(d => d.reciterId));
    els.storageCount.textContent = state.downloads.length; els.storageReciters.textContent = recs.size; els.storageTotal.textContent = fmtBytes(tot);
    if (!state.downloads.length) { els.storageList.innerHTML = `<div class="empty"><svg viewBox="0 0 24 24">${ICONS.folder}</svg><p>لم تحمّل أي سورة بعد</p></div>`; return; }
    const byR = new Map();
    state.downloads.forEach(d => { if (!byR.has(d.reciterId)) byR.set(d.reciterId, []); byR.get(d.reciterId).push(d); });
    const html = [];
    byR.forEach((items, rid) => { const rec = RECITER_MAP.get(rid); const nm = rec ? rec.name : `قارئ #${rid}`; const sz = items.reduce((a, d) => a + (d.size || 0), 0); const sorted = items.slice().sort((a, b) => a.surahNum - b.surahNum); html.push(`<div class="storage-reciter" data-rid="${rid}"><button class="storage-reciter-head" type="button"><svg class="srh-mic" viewBox="0 0 24 24">${ICONS.mic}</svg><div class="srh-info"><b>${esc(nm)}</b><small>${items.length} ${items.length === 1 ? "سورة" : "سور"} · ${fmtBytes(sz)}</small></div><svg class="srh-chevron" viewBox="0 0 24 24">${ICONS.chevron}</svg></button><div class="storage-reciter-body">${sorted.map(d => { const s = SURAH_MAP.get(d.surahNum); return `<div class="storage-row" data-key="${d.key}" data-reciter="${rid}" data-surah="${d.surahNum}"><b>${s ? esc(s.nameAr) : d.surahNum}</b><span class="size">${fmtBytes(d.size)}</span><button class="storage-del" data-del="${d.key}" aria-label="حذف"><svg viewBox="0 0 24 24">${ICONS.trash}</svg></button></div>`; }).join("")}</div></div>`); });
    els.storageList.innerHTML = html.join("");
  },
};

let _sleepIntervalId = null;
function startSleepTick() { if (_sleepIntervalId) return; _sleepIntervalId = setInterval(Sleep.tick, 1000); }
function stopSleepTick() { if (_sleepIntervalId) { clearInterval(_sleepIntervalId); _sleepIntervalId = null; } }

const Sleep = {
  open() { if (state.sleep.active) { const r = Math.max(0, state.sleep.endsAt - Date.now()); const h = Math.floor(r / 3600000); const m = Math.round((r % 3600000) / 60000); els.sleepHours.value = h > 0 ? h : ""; els.sleepMinutes.value = m > 0 ? m : ""; } else { els.sleepHours.value = ""; els.sleepMinutes.value = ""; } Sleep.updateActiveInfo(); Sleep.updatePresetHighlight(); openModal(els.sleepOverlay); },
  close() { closeModal(els.sleepOverlay); },
  updateActiveInfo() { if (state.sleep.active) { els.sleepActiveInfo.classList.add("on"); const r = Math.max(0, state.sleep.endsAt - Date.now()); els.sleepActiveText.textContent = `المؤقت شغال — متبقي: ${fmtTime(r / 1000)}`; } else els.sleepActiveInfo.classList.remove("on"); },
  updatePresetHighlight() { const h = parseInt(els.sleepHours.value, 10) || 0; const m = parseInt(els.sleepMinutes.value, 10) || 0; const t = h * 60 + m; $$("#sleepPresets button").forEach(b => b.classList.toggle("active", t > 0 && parseInt(b.dataset.min, 10) === t)); },
  start() { let h = els.sleepHours.value.trim() === "" ? 0 : parseInt(els.sleepHours.value, 10); let m = els.sleepMinutes.value.trim() === "" ? 0 : parseInt(els.sleepMinutes.value, 10); if (!isFinite(h)) h = 0; if (!isFinite(m)) m = 0; h = clamp(h, 0, 12); m = clamp(m, 0, 59); const tm = (h * 60 + m) * 60 * 1000; if (tm <= 0) { toast("⚠️ حدد مدة", "error"); return; } state.sleep.active = true; state.sleep.endsAt = Date.now() + tm; Sleep.tick(); Sleep.updateActiveInfo(); UI.timerChip(); UI.updateMobileValues(); startSleepTick(); saveSoon(); toast(`المؤقت: ${h > 0 ? h + " س " : ""}${m > 0 ? m + " د" : ""}`, "success"); Sleep.close(); },
  cancel() { if (!state.sleep.active) { Sleep.close(); return; } state.sleep.active = false; state.sleep.endsAt = 0; stopSleepTick(); UI.timerChip(); Sleep.updateActiveInfo(); UI.updateMobileValues(); saveSoon(); toast("تم الإلغاء"); Sleep.close(); },
  tick() { if (!state.sleep.active) { stopSleepTick(); return; } const r = state.sleep.endsAt - Date.now(); if (r <= 0) { state.sleep.active = false; state.sleep.endsAt = 0; stopSleepTick(); Audio.pause(); UI.timerChip(); UI.updateMobileValues(); toast("انتهى المؤقت", "success"); saveSoon(); return; } const s = Math.max(0, Math.round(r / 1000)); const h = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60; const p = v => String(v).padStart(2, "0"); els.timerChip.textContent = h > 0 ? `${h}:${p(mm)}:${p(ss)}` : `${mm}:${p(ss)}`; if (els.sleepOverlay.classList.contains("on")) Sleep.updateActiveInfo(); if (els.mobileSidebar && els.mobileSidebar.classList.contains("on")) UI.updateMobileValues(); },
};

function openModal(el) { el.classList.add("on"); document.body.style.overflow = "hidden"; }
function closeModal(el) { el.classList.remove("on"); if (!$$(".modal-overlay.on").length && !els.drawer.classList.contains("on") && !els.mobileSidebar.classList.contains("on")) document.body.style.overflow = ""; }

function bindDrag(el, onR) {
  let d = false;
  const r = (e) => { const rc = el.getBoundingClientRect(); const x = e.touches ? e.touches[0].clientX : e.clientX; return clamp((x - rc.left) / rc.width, 0, 1); };
  const dn = (e) => { d = true; el.classList.add("dragging"); onR(r(e)); e.preventDefault(); };
  const mv = (e) => { if (d) onR(r(e)); };
  const up = () => { d = false; el.classList.remove("dragging"); };
  el.addEventListener("mousedown", dn); el.addEventListener("touchstart", dn, { passive: false });
  window.addEventListener("mousemove", mv, { passive: true }); window.addEventListener("touchmove", mv, { passive: false });
  window.addEventListener("mouseup", up, { passive: true }); window.addEventListener("touchend", up, { passive: true }); window.addEventListener("touchcancel", up, { passive: true });
}

(function setupSeekDrag() {
  let dragging = false, wasPlayingBeforeDrag = false, pendingRatio = 0;
  const ratioFromEvent = (e) => { const rc = els.seek.getBoundingClientRect(); const x = e.touches ? e.touches[0].clientX : e.clientX; return clamp((x - rc.left) / rc.width, 0, 1); };
  const preview = (r) => { els.seekFill.style.transform = `scaleX(${r})`; els.seekThumb.style.left = (r * 100).toFixed(3) + "%"; const dur = els.audio.duration; if (isFinite(dur) && dur > 0) els.timeCur.textContent = fmtTime(r * dur); };
  const onStart = (e) => { dragging = true; wasPlayingBeforeDrag = state._playIntent; els.seek.classList.add("dragging"); pendingRatio = ratioFromEvent(e); preview(pendingRatio); e.preventDefault(); };
  const onMove = (e) => { if (!dragging) return; pendingRatio = ratioFromEvent(e); preview(pendingRatio); };
  const onEnd = () => {
    if (!dragging) return; dragging = false; els.seek.classList.remove("dragging");
    const dur = els.audio.duration;
    if (isFinite(dur) && dur > 0) {
      const target = pendingRatio * dur;
      try { els.audio.currentTime = target; state.currentTime = target; } catch(_){}
      if (wasPlayingBeforeDrag && els.audio.paused) {
        state._playIntent = true;
        const p = els.audio.play(); if (p && p.catch) p.catch(() => {});
      }
      if (!navigator.onLine) OfflineResume.updateSeek(target);
    } else if (state._lastKnownDuration > 0) {
      const target = pendingRatio * state._lastKnownDuration;
      state.currentTime = target;
      if (!navigator.onLine) OfflineResume.updateSeek(target);
    }
    safeSave();
  };
  els.seek.addEventListener("mousedown", onStart); els.seek.addEventListener("touchstart", onStart, { passive: false });
  window.addEventListener("mousemove", onMove, { passive: true }); window.addEventListener("touchmove", onMove, { passive: false });
  window.addEventListener("mouseup", onEnd, { passive: true }); window.addEventListener("touchend", onEnd, { passive: true }); window.addEventListener("touchcancel", onEnd, { passive: true });
})();
bindDrag(els.volSlider, (r) => Audio.setVolume(r));

function openMobileSidebar() { UI.updateMobileValues(); els.mobileSidebar.classList.add("on"); els.mobileOverlay.classList.add("on"); els.mobileSidebar.setAttribute("aria-hidden", "false"); document.body.style.overflow = "hidden"; }
function closeMobileSidebar() { els.mobileSidebar.classList.remove("on"); els.mobileOverlay.classList.remove("on"); els.mobileSidebar.setAttribute("aria-hidden", "true"); if (!$$(".modal-overlay.on").length && !els.drawer.classList.contains("on")) document.body.style.overflow = ""; }
els.mobileMenuBtn.addEventListener("click", openMobileSidebar);
els.mobileSidebarClose.addEventListener("click", closeMobileSidebar);
els.mobileOverlay.addEventListener("click", closeMobileSidebar);

document.querySelectorAll('.ms-item[data-trigger]').forEach(btn => {
  btn.addEventListener('click', () => {
    const targetId = btn.dataset.trigger; const target = document.getElementById(targetId);
    closeMobileSidebar();
    setTimeout(() => { if (target) target.click(); }, targetId === "reciterBtn" ? 180 : 220);
  });
});

els.themeBtn.addEventListener("click", () => { const n = Theme.toggle(); UI.updateMobileValues(); toast(n === "light" ? "☀️ نهاري" : "🌙 ليلي"); });
els.reciterBtn.addEventListener("click", (e) => { e.stopPropagation(); RecitersUI.toggle(); });
els.reciterSearchInput.addEventListener("input", (e) => RecitersUI.renderList(e.target.value));
els.reciterList.addEventListener("click", (e) => { const it = e.target.closest(".reciter-item"); if (!it) return; RecitersUI.close(); switchReciterSmart(Number(it.dataset.id)); });
document.addEventListener("click", (e) => { if (!els.reciterDropdown.classList.contains("on")) return; if (e.target.closest(".reciter-wrap")) return; if (e.target.closest(".reciter-dropdown")) return; RecitersUI.close(); });
els.storageBtn.addEventListener("click", () => StoragePanel.open());
els.storageCloseBtn.addEventListener("click", () => StoragePanel.close());

els.storageClearAll.addEventListener("click", async () => {
  const hasDownloads = state.downloads.length > 0;
  const hasPrefetch = Prefetcher._progress.done > 0;
  if (!hasDownloads && !hasPrefetch) { toast("لا توجد بيانات"); return; }
  if (!confirm("سيتم حذف جميع البيانات المحمّلة (سور + توقيتات + نصوص). متأكد؟")) return;
  await Downloads.clearAll();
  Prefetcher.abort();
  Prefetcher._progress = { done: 0, total: 798, failed: 0, phase: "idle" };
  Prefetcher._clearState();
  updatePrefetchUI();
  StoragePanel.render();
  StoragePanel.refreshEstimate();
  Downloads.updateBadge();
  toast("تم المسح", "success");
  if (navigator.onLine) setTimeout(() => Prefetcher.run(), 500);
});

if (els.prefetchClear) {
  els.prefetchClear.addEventListener("click", async () => {
    if (!confirm("سيتم مسح كل التوقيتات والنصوص. هتتحمل تلقائيًا من جديد. متأكد؟")) return;
    await Prefetcher.clearAll();
    updatePrefetchUI();
    if (navigator.onLine) setTimeout(() => Prefetcher.run(), 400);
  });
}

els.storageList.addEventListener("click", async (e) => {
  const delBtn = e.target.closest("[data-del]");
  if (delBtn) { e.stopPropagation(); const row = delBtn.closest(".storage-row"); if (!row) return; const sNum = Number(row.dataset.surah), rId = Number(row.dataset.reciter); const sName = SURAH_MAP.get(sNum)?.nameAr || "", rName = RECITER_MAP.get(rId)?.name || ""; if (!confirm(`حذف سورة ${sName} من ${rName}؟`)) return; await Downloads.deleteOne(rId, sNum); StoragePanel.render(); StoragePanel.refreshEstimate(); Downloads.updateBadge(); UI.updateMobileValues(); toast(`حُذفت ${sName}`, "success"); return; }
  const head = e.target.closest(".storage-reciter-head");
  if (head) { const group = head.closest(".storage-reciter"); if (group) group.classList.toggle("expanded"); return; }
});

els.downloadBtn.addEventListener("click", () => Downloads.openModal());
els.dlCloseBtn.addEventListener("click", () => Downloads.closeModal());
els.dlSelectAll.addEventListener("change", (e) => Downloads.toggleSelectAll(e.target.checked));
els.dlList.addEventListener("click", (e) => { const it = e.target.closest(".dl-item"); if (!it) return; Downloads.toggleSelection(Number(it.dataset.num)); });
els.dlStartBtn.addEventListener("click", () => Downloads.startSelected());
els.grid.addEventListener("click", (e) => {
  const dl = e.target.closest('[data-act="download"]');
  if (dl) { e.stopPropagation(); const n = Number(dl.dataset.num); const key = `${state.reciterId}-${n}`;
    if (Downloads.isDownloading(key)) { Downloads.cancel(key); return; }
    if (Downloads.isDownloaded(state.reciterId, n)) { if (confirm(`سورة ${SURAH_MAP.get(n).nameAr} محمّلة. حذفها؟`)) { Downloads.deleteOne(state.reciterId, n).then(() => { toast(`حُذفت`, "success"); StoragePanel.render && StoragePanel.render(); }); } return; }
    Downloads.enqueue([{ reciterId: state.reciterId, surahNum: n }]); toast(`بدأ تحميل ${SURAH_MAP.get(n).nameAr}`, "success"); return;
  }
  const add = e.target.closest('[data-act="add"]'); if (add) { e.stopPropagation(); Queue.toggle(Number(add.dataset.num)); return; }
  const c = e.target.closest(".card"); if (!c) return; const n = Number(c.dataset.num); if (state.current === n && state.mode === "seq") { Audio.toggle(); return; } Player.playSurah(n);
});
els.grid.addEventListener("keydown", (e) => { if (e.key !== "Enter" && e.key !== " ") return; const c = e.target.closest(".card"); if (!c) return; e.preventDefault(); c.click(); });

els.playBtn.addEventListener("click", () => {
  if (!state.current) { Player.playSurah(1); return; }
  Audio.toggle();
});
els.prevBtn.addEventListener("click", () => Player.prev());
els.nextBtn.addEventListener("click", () => Player.next());
els.shuffleBtn.addEventListener("click", () => { state.shuffle = !state.shuffle; UI.shuffle(); saveSoon(); toast(state.shuffle ? "الخلط مُفعّل" : "الخلط مُعطّل"); });
els.repeatBtn.addEventListener("click", () => { state.repeat = state.repeat === "off" ? "one" : state.repeat === "one" ? "all" : "off"; UI.repeat(); saveSoon(); toast(state.repeat === "off" ? "مُعطّل" : state.repeat === "one" ? "تكرار السورة" : "تكرار القائمة"); });
const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];
els.speedBtn.addEventListener("click", () => { const i = SPEEDS.indexOf(state.speed); const n = SPEEDS[(i + 1) % SPEEDS.length]; Audio.setSpeed(n); toast(`السرعة: ${n}×`); });
els.muteBtn.addEventListener("click", () => { if (state.volume > 0) { state._prevVolume = state.volume; Audio.setVolume(0); } else Audio.setVolume(state._prevVolume || CONFIG.defaultVolume); });
const openDrawer = () => { els.drawer.classList.add("on"); els.overlay.classList.add("on"); els.drawer.setAttribute("aria-hidden", "false"); document.body.style.overflow = "hidden"; if (state.mode === "queue" && state.current) requestAnimationFrame(() => { const it = els.qlist.querySelector(`.qitem[data-num="${state.current}"]`); if (it) it.scrollIntoView({ block: "center", behavior: "smooth" }); }); };
const closeDrawer = () => { els.drawer.classList.remove("on"); els.overlay.classList.remove("on"); els.drawer.setAttribute("aria-hidden", "true"); if (!$$(".modal-overlay.on").length && !els.mobileSidebar.classList.contains("on")) document.body.style.overflow = ""; };
els.queueBtn.addEventListener("click", openDrawer);
els.closeDrawer.addEventListener("click", closeDrawer);
els.overlay.addEventListener("click", closeDrawer);
els.playQueueBtn.addEventListener("click", () => Queue.playAll());
els.shuffleQueueBtn.addEventListener("click", () => Queue.shuffle());
els.clearQueueBtn.addEventListener("click", () => { if (!state.queue.length) return; if (confirm("مسح القائمة؟")) Queue.clear(); });
let dragFromIdx = -1, lastDragEnd = 0;
const isSuppressed = () => (Date.now() - lastDragEnd) < 200;
els.qlist.addEventListener("click", (e) => { if (isSuppressed()) return; const rm = e.target.closest('[data-act="remove"]'); if (rm) { e.stopPropagation(); Queue.removeAt(Number(rm.dataset.idx)); return; } const pb = e.target.closest('[data-act="qplay"]'); if (pb) { e.stopPropagation(); const idx = Number(pb.dataset.idx); const n = state.queue[idx]; if (n === undefined) return; if (state.current === n && state.mode === "queue") Audio.toggle(); else Player.playQueueAt(idx); return; } const it = e.target.closest(".qitem"); if (!it) return; const idx = Number(it.dataset.idx); const n = state.queue[idx]; if (n === undefined) return; if (state.current === n && state.mode === "queue") Audio.toggle(); else Player.playQueueAt(idx); });
els.qlist.addEventListener("dragstart", (e) => { const it = e.target.closest(".qitem"); if (!it) return; dragFromIdx = Number(it.dataset.idx); it.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", String(dragFromIdx)); } catch(_){} });
els.qlist.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; $$(".qitem.drop-target", els.qlist).forEach(x => x.classList.remove("drop-target")); const it = e.target.closest(".qitem"); if (it) it.classList.add("drop-target"); });
els.qlist.addEventListener("dragleave", (e) => { const it = e.target.closest(".qitem"); if (it) it.classList.remove("drop-target"); });
els.qlist.addEventListener("drop", (e) => { e.preventDefault(); const it = e.target.closest(".qitem"); if (!it) return; const to = Number(it.dataset.idx); if (dragFromIdx >= 0 && !isNaN(to) && dragFromIdx !== to) Queue.move(dragFromIdx, to); dragFromIdx = -1; $$(".qitem.drop-target", els.qlist).forEach(x => x.classList.remove("drop-target")); });
els.qlist.addEventListener("dragend", () => { $$(".qitem.dragging", els.qlist).forEach(x => x.classList.remove("dragging")); $$(".qitem.drop-target", els.qlist).forEach(x => x.classList.remove("drop-target")); dragFromIdx = -1; lastDragEnd = Date.now(); });
const applySearch = debounce((v) => { state.search = v || ""; UI.filter(); }, 140);
els.searchInput.addEventListener("input", (e) => applySearch(e.target.value));
els.rangeBtn.addEventListener("click", Range.toggle);
els.rpClose.addEventListener("click", Range.close);
els.rpApply.addEventListener("click", Range.apply);
els.rpClear.addEventListener("click", Range.clear);
els.rpModeToggle.addEventListener("click", (e) => { const b = e.target.closest("button[data-mode]"); if (!b || b.disabled) return; Range.setMode(b.dataset.mode); });
els.rpEndSurahSelect.addEventListener("change", () => { const ev = parseInt(els.rpEndSurahSelect.value, 10); const es = SURAH_MAP.get(ev); if (es) { Range.buildAyahOptions(els.rpEndSelect, es.ayahs, true); els.rpEndSelect.value = ""; } Range.refreshCrossSurahUI(); const ic = ev !== state.current; if (ic && state.range._pendingMode === "duration") Range.setMode("ayah"); $$("#rpModeToggle button").forEach(b => { if (b.dataset.mode === "duration") { b.disabled = ic; } }); });
els.rpRepeatCount.addEventListener("input", Range.updateRepeatHighlight);
$$(".rp-repeat-preset").forEach(btn => { btn.addEventListener("click", () => { els.rpRepeatCount.value = parseInt(btn.dataset.count, 10); Range.updateRepeatHighlight(); }); });
els.rpStartSelect.addEventListener("change", () => els.rpStartField.classList.remove("error"));
els.rpEndSelect.addEventListener("change", () => { const ef = els.rpEndSelect.closest(".rp-field"); if (ef) ef.classList.remove("error"); });
els.rpDurHours.addEventListener("input", () => els.rpDurHoursCell.classList.remove("error"));
els.rpDurMinutes.addEventListener("input", () => els.rpDurMinutesCell.classList.remove("error"));
if (els.rpSameSurah) els.rpSameSurah.addEventListener("click", () => Range.toggleSameSurah());
els.sleepBtn.addEventListener("click", Sleep.open);
els.sleepStart.addEventListener("click", Sleep.start);
els.sleepCancel.addEventListener("click", Sleep.cancel);
els.sleepPresets.addEventListener("click", (e) => { const b = e.target.closest("button[data-min]"); if (!b) return; const t = parseInt(b.dataset.min, 10); els.sleepHours.value = Math.floor(t / 60) || ""; els.sleepMinutes.value = (t % 60) || ""; Sleep.updatePresetHighlight(); });
els.sleepHours.addEventListener("input", Sleep.updatePresetHighlight);
els.sleepMinutes.addEventListener("input", Sleep.updatePresetHighlight);
document.addEventListener("click", (e) => { const cb = e.target.closest("[data-close]"); if (cb) { const el = document.getElementById(cb.dataset.close); if (el) closeModal(el); return; } if (e.target.classList.contains("modal-overlay")) closeModal(e.target); });

els.audio.addEventListener("loadedmetadata", () => {
  els.audio.playbackRate = state.speed; els.audio.volume = state.volume; els.audio.muted = state.volume === 0;
  if (isFinite(els.audio.duration) && els.audio.duration > 0) state._lastKnownDuration = els.audio.duration;
  clearSilentSwitch();
  const dur = els.audio.duration; let target = 0;
  if (state.range.active && state.range.openEnded && state.current === state.range.surah) { const ok = state.currentTime > 0.5 && state.currentTime < dur - 0.5; const inR = ok && state.currentTime >= state.range.startTime; target = inR ? state.currentTime : state.range.startTime; }
  else if (state.range.active && state.range.crossSurah) { if (state.range.phase === "leg1" && state.current === state.range.surah) { const ok = state.currentTime > 0.5 && state.currentTime < dur - 0.5; const inR = ok && state.currentTime >= state.range.startTime; target = inR ? state.currentTime : state.range.startTime; } else if (state.range.phase === "leg2" && state.current === state.range.endSurah) { const ok = state.currentTime > 0.5 && state.currentTime < state.range.endTime - 0.5; target = ok ? state.currentTime : 0; } }
  else if (state.range.active && state.current === state.range.surah && !state.range.openEnded) { const ok = state.currentTime > 0.5 && state.currentTime < dur - 0.5; const inR = ok && state.currentTime >= state.range.startTime && state.currentTime < state.range.endTime - 0.5; target = inR ? state.currentTime : state.range.startTime; }
  else if (state.currentTime > 0.5 && state.currentTime < dur - 0.5) target = state.currentTime;
  if (target > 0 && target < dur - 0.5) { try { els.audio.currentTime = target; } catch(_){} state.currentTime = target; }
  UI._markerRenderKey = null;
  UI.renderAyahMarkers(); UI.progress(); UI.rangeMarkers();
  Subtitle.currentKey = null; Subtitle.update();
  if (state.range.active && !state.range.openEnded && state._playIntent) startRangeWatch();
});

els.audio.addEventListener("timeupdate", () => {
  if (state.current && state._playIntent) state.currentTime = els.audio.currentTime;
  if (state.range.active && !state.range.openEnded && state._playIntent && state.current === state.range.surah && !state._tabVisible) {
    if (els.audio.currentTime >= state.range.endTime) {
      try { els.audio.pause(); } catch(_) {}
      try { els.audio.currentTime = state.range.endTime; } catch(_) {}
      handleRangeEnd();
      return;
    }
  }
  Subtitle.update();
  if (!state._tabVisible) UI.progress();
});

els.audio.addEventListener("durationchange", () => { if (isFinite(els.audio.duration) && els.audio.duration > 0) state._lastKnownDuration = els.audio.duration; UI._markerRenderKey = null; UI.progress(); UI.rangeMarkers(); });
els.audio.addEventListener("play", () => {
  state.playing = true;
  state._restoredFromSaved = false;
  UI.nowPlaying(); UI.updatePlayingCard(); UI.updateResumeCard(); UI.updateQueuePlayButtons();
  if (state.range.active && !state.range.openEnded) startRangeWatch();
  Subtitle.onPlay();
  startRafLoop();
  if (!navigator.onLine) OfflineResume.updatePlayState(true);
});
els.audio.addEventListener("pause", () => {
  state.playing = false;
  stopRafLoop();
  UI.nowPlaying(); UI.updatePlayingCard(); UI.updateQueuePlayButtons(); stopRangeWatch();
  if (state.current && !_silentSwitch) {
    state.currentTime = els.audio.currentTime || 0;
    state._lastSavedTime = state.currentTime;
    Store.save(state);
    if (!navigator.onLine) OfflineResume.updatePlayState(false);
  }
});
els.audio.addEventListener("ended", () => {
  if (state.range.active && state.range.crossSurah && state.range.phase === "leg1" && state.current === state.range.surah) { transitionToLeg2(); return; }
  if (state.range.active && state.range.crossSurah && state.range.phase === "leg2" && state.current === state.range.endSurah) { handleRangeEnd(); return; }
  if (state.range.active && !state.range.crossSurah && !state.range.openEnded && state.current === state.range.surah) { handleRangeEnd(); return; }
  if (state.repeat === "one" && state.current) { els.audio.currentTime = 0; Audio.play(); return; }
  Player.next();
});
els.audio.addEventListener("error", () => {
  if (!navigator.onLine && state.current && !_silentSwitch) {
    if (!OfflineResume._read()) OfflineResume.save("audio-error-offline");
  }
  if (_silentSwitch || !els.audio.src || !state.current) return;
  const err = els.audio.error;
  if (err && err.code === 4 && _audioLoadId === 0) return;
  if (!navigator.onLine) return;
  const lock = _audioLoadId;
  setTimeout(() => { if (_audioLoadId !== lock || _silentSwitch) return; const s = SURAH_MAP.get(state.current); if (!s) return; toast(`تعذّر تشغيل ${s.nameAr}`, "error"); }, 300);
});

document.addEventListener("keydown", (e) => {
  const tag = (e.target && e.target.tagName) || ""; if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  if (e.code === "Escape") { if (els.mobileSidebar.classList.contains("on")) { closeMobileSidebar(); return; } if (RecitersUI.isOpen()) { RecitersUI.close(); return; } const om = $(".modal-overlay.on"); if (om) { closeModal(om); return; } if (Range.isOpen()) { Range.close(); return; } closeDrawer(); return; }
  if ($(".modal-overlay.on")) return;
  if (RecitersUI.isOpen()) return;
  switch (e.code) {
    case "Space": e.preventDefault(); els.playBtn.click(); break;
    case "ArrowRight": if (e.shiftKey) els.nextBtn.click(); else Audio.seekTo((els.audio.currentTime || 0) + 5); break;
    case "ArrowLeft": if (e.shiftKey) els.prevBtn.click(); else Audio.seekTo((els.audio.currentTime || 0) - 5); break;
    case "ArrowUp": e.preventDefault(); Audio.setVolume(state.volume + 0.05); break;
    case "ArrowDown": e.preventDefault(); Audio.setVolume(state.volume - 0.05); break;
    case "KeyM": els.muteBtn.click(); break;
    case "KeyR": Range.toggle(); break;
    case "KeyT": els.themeBtn.click(); break;
  }
});

async function init() {
  Theme.init();
  UI.buildLibrary();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  await Promise.all([TimingsAPI.loadAllFromIDB(), TextAPI.loadAllFromIDB()]);
  state.timingIds = await TimingsAPI.resolveTimingIds();

  const saved = Store.load();
  if (saved) {
    if (Array.isArray(saved.queue)) state.queue = saved.queue.filter(n => SURAH_MAP.has(n));
    if (typeof saved.volume === "number") state.volume = clamp(saved.volume, 0, 1);
    if (typeof saved.speed === "number" && SPEEDS.includes(saved.speed)) state.speed = saved.speed;
    if (typeof saved.shuffle === "boolean") state.shuffle = saved.shuffle;
    if (["off","one","all"].includes(saved.repeat)) state.repeat = saved.repeat;
    if (typeof saved.currentTime === "number") state.currentTime = saved.currentTime;
    if (saved.lastPlayed && SURAH_MAP.has(saved.lastPlayed)) state.lastPlayed = saved.lastPlayed;
    if (typeof saved.qIndex === "number") state.qIndex = saved.qIndex;
    if (saved.mode === "queue" || saved.mode === "seq") state.mode = saved.mode;
    if (saved.reciterId && RECITER_MAP.has(saved.reciterId)) state.reciterId = saved.reciterId;
    if (saved.range && saved.range.surah && SURAH_MAP.has(saved.range.surah)) { let ph = "leg1"; if (saved.range.crossSurah && saved.current === saved.range.endSurah) ph = "leg2"; state.range = { active: true, surah: saved.range.surah, endSurah: saved.range.endSurah || saved.range.surah, crossSurah: !!saved.range.crossSurah, phase: ph, mode: saved.range.mode || "ayah", startAyah: saved.range.startAyah || 1, endAyah: saved.range.endAyah || null, startTime: saved.range.startTime || 0, endTime: saved.range.endTime || 0, _pendingMode: saved.range.mode || "ayah", estimated: !!saved.range.estimated, openEnded: !!saved.range.openEnded, repeatCount: (saved.range.repeatCount >= 1 ? saved.range.repeatCount : 1), repeatIndex: saved.range.repeatIndex || 0, sameSurah: !!saved.range.sameSurah }; }
    if (saved.sleep && saved.sleep.endsAt && saved.sleep.endsAt > Date.now()) { state.sleep.active = true; state.sleep.endsAt = saved.sleep.endsAt; startSleepTick(); }
    syncQueueIndex();
  }
  RecitersUI.renderList("");
  const curRec = RECITER_MAP.get(state.reciterId) || CONFIG.reciters[0];
  state.reciterId = curRec.id;
  UI.reciterName(curRec.name);
  await Downloads.loadFromIDB();
  UI.updateDownloadedBadges(); Downloads.updateBadge();
  els.audio.volume = state.volume; els.audio.playbackRate = state.speed; els.audio.muted = state.volume === 0;
  UI.renderQueue(); UI.updateAddedButtons(); UI.updateRangeBadges(); UI.volume(); UI.speed(); UI.shuffle(); UI.repeat(); UI.timerChip();
  if (!els.rpRepeatCount.value || els.rpRepeatCount.value === "0") els.rpRepeatCount.value = "1";
  Range.updateRepeatHighlight(); Range.updateSameSurahUI();
  UI.updateMobileValues();

  const rn = saved && saved.current && SURAH_MAP.has(saved.current) ? saved.current : state.lastPlayed;
  if (rn && SURAH_MAP.has(rn)) {
    state.current = rn; state.playing = false;
    setLoadedSource(state.reciterId, rn);
    try { els.audio.src = resolveSurahSrc(state.reciterId, rn); els.audio.load(); } catch(_){}
    if (state.currentTime > 1) state._restoredFromSaved = true;
    TextAPI.fetch(rn).catch(() => {});
    if (!TimingsAPI.isDisabled(state.reciterId) && !TimingsAPI.has(state.reciterId, rn)) { TimingsAPI.fetch(state.reciterId, rn).then(() => { UI._markerRenderKey = null; UI.renderAyahMarkers(); Subtitle.currentKey = null; Subtitle.update(); }).catch(() => {}); }
    UI.updatePlayingCard(); UI.updateResumeCard(); Range.syncUI(); UI.nowPlaying(); UI.phaseNotice(); UI.updateQueuePlayButtons();
  } else { state._restoredFromSaved = false; UI.nowPlaying(); }

  setTimeout(() => { if (state._restoredFromSaved) toast(`▶ جاهز للاستئناف`, "success"); else toast(`جاهز ✓`, "success"); }, 800);

  Prefetcher.setProgressCallback(updatePrefetchUI);
  setTimeout(async () => {
    console.log('[Prefetcher] autostart check | online:', navigator.onLine);
    try {
      if (!navigator.onLine) { console.warn('[Prefetcher] offline — will retry on online event'); return; }
      const complete = await Prefetcher.isComplete();
      console.log('[Prefetcher] isComplete =', complete);
      if (!complete) {
        console.log('[Prefetcher] starting run()...');
        Prefetcher.run();
      } else {
        const tk = await IDB.getAllTimingKeys();
        const xk = await IDB.getAllTextKeys();
        console.log('[Prefetcher] already complete:', tk.length, 'timings,', xk.length, 'texts');
        Prefetcher._progress = { done: tk.length + xk.length, total: 798, failed: 0, phase: "complete" };
        updatePrefetchUI();
      }
    } catch(e) {
      console.error('[Prefetcher] autostart failed:', e);
    }
  }, CONFIG.PREFETCH_AUTOSTART_DELAY_MS);

  /* ⭐ لو فيه OfflineResume معلّق */
  const pendingOffline = OfflineResume._read();
  if (pendingOffline && state.current && pendingOffline.sn === state.current && pendingOffline.rid === state.reciterId) {
    if (navigator.onLine) {
      setTimeout(() => OfflineResume.restore("init"), 1000);
    } else {
      state.currentTime = pendingOffline.time || state.currentTime;
      state._playIntent = false;
      UI.progress();
      Subtitle.currentKey = null;
      Subtitle.update();
      /* ⭐ v31.3: بدون polling — نعتمد على online event */
    }
  }

  /* ⭐ online — استعادة تلقائية + استئناف الـ Prefetcher */
  window.addEventListener("online", () => {
    toast("🌐 عاد الاتصال", "info");
    Subtitle._failedMap.clear();
    setTimeout(() => OfflineResume.restore("online-event"), 200);
    if (Prefetcher._paused && !Prefetcher._running) {
      Prefetcher.resume();
    }
  });

  /* ⭐ offline — snapshot فقط (بدون polling) */
  window.addEventListener("offline", () => {
    const dc = state.downloads.filter(d => d.reciterId === state.reciterId).length;
    if (state.current) {
      OfflineResume.save("offline");
    }
    if (Prefetcher._running) {
      Prefetcher._paused = true;
      Prefetcher._progress.phase = "paused";
      Prefetcher._emit();
      Prefetcher._saveState();
    }
    if (dc > 0) toast(`📴 ${dc} سورة محمّلة تعمل بدون إنترنت`, "success");
    else toast("📴 انقطع الاتصال", "info");
  });

  /* ⭐ visibility — استعادة عند الرجوع للتاب */
  document.addEventListener("visibilitychange", () => {
    state._tabVisible = !document.hidden;
    if (document.hidden) {
      stopRafLoop();
      if (state.current) {
        state.currentTime = els.audio.currentTime || 0;
        state._lastSavedTime = state.currentTime;
        Store.save(state);
      }
    } else {
      if (state.playing) startRafLoop();
      if (navigator.onLine && OfflineResume._read()) {
        setTimeout(() => OfflineResume.restore("visibility"), 300);
      }
    }
  });

  window.addEventListener("pagehide", () => {
    stopRafLoop();
    if (state.current) {
      state.currentTime = els.audio.currentTime || 0;
      Store.save(state);
      if (!navigator.onLine) OfflineResume.save("pagehide");
    }
  });
  window.addEventListener("beforeunload", () => {
    stopRafLoop();
    if (state.current) {
      state.currentTime = els.audio.currentTime || 0;
      Store.save(state);
      if (!navigator.onLine) OfflineResume.save("beforeunload");
    }
  });
}

function safeSave() { if (!state.current) return; const now = els.audio.currentTime || 0; if (Math.abs(now - state._lastSavedTime) < CONFIG.SAVE_DELTA_SEC) return; state.currentTime = now; state._lastSavedTime = now; Store.save(state); }

init();
})();