(function(){
"use strict";


const CONFIG = {
  padTo: 3, defaultVolume: 0.9, defaultSpeed: 1, defaultEndBuffer: 0.05,
  storageKey: "quran-player-settings", themeStorageKey: "quran-player-theme",
  saveDebounceMs: 1200, toastDurationMs: 2800,
  autoClosePanelDelayMs: 450, maxRepeatCount: 100,
  repeatRestartDelayMs: 300, silentSwitchMs: 1500, themeFreezeMs: 60,
  downloadConcurrency: 2, ayahBoundaryBufferMs: 150,
  idbName: "quran-player-downloads", idbVersion: 4,
  idbStore: "audio", idbMetaStore: "audio-meta", TEXTS_CACHE_MAX: 200,
  BLOB_LRU_MAX: 3,
  PLAYING_SAVE_INTERVAL_MS: 45000, SAVE_DELTA_SEC: 3,
  OFFLINE_RETRY_DELAY_MS: 2000, OFFLINE_MAX_RETRIES: 30,
  LS_MAX_BYTES: 10 * 1024 * 1024, SUBTITLE_THROTTLE_MS: 250,
  RANGE_TIMINGS_TIMEOUT_MS: 300,
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

/* ⭐ v33: Blob URL LRU — يحتفظ بـ 3 object URLs فقط في الرام */
function createBlobUrlLRU(max) {
  const map = new Map();
  const revoke = (url) => { try { URL.revokeObjectURL(url); } catch(_){} };
  return {
    has: k => map.has(k),
    get(k) { if (!map.has(k)) return null; const v = map.get(k); map.delete(k); map.set(k, v); return v; },
    set(k, blob) {
      if (map.has(k)) { revoke(map.get(k)); map.delete(k); }
      const url = URL.createObjectURL(blob);
      map.set(k, url);
      while (map.size > max) { const f = map.keys().next().value; revoke(map.get(f)); map.delete(f); }
      return url;
    },
    delete(k) { if (map.has(k)) { revoke(map.get(k)); map.delete(k); } },
    clear() { for (const u of map.values()) revoke(u); map.clear(); },
    get size() { return map.size; }
  };
}

const emptyRange = () => ({ active: false, surah: null, endSurah: null, crossSurah: false, phase: "leg1", mode: "ayah", startAyah: null, endAyah: null, startTime: 0, endTime: 0, _pendingMode: "ayah", estimated: false, openEnded: false, repeatCount: 1, repeatIndex: 0, sameSurah: false });

/* ⭐ v33: TypedArray-based timing estimation */
function getFatihahEstimated(duration) {
  if (!isFinite(duration) || duration <= 0) return null;
  const n = 7;
  const perUnit = duration / FATIHAH_TOTAL_WEIGHT;
  const starts = new Float32Array(n);
  const ends = new Float32Array(n);
  let cum = 0;
  for (let i = 0; i < n; i++) {
    starts[i] = cum * perUnit;
    cum += CONFIG.fatihahWeights[i];
    ends[i] = cum * perUnit;
  }
  for (let i = 0; i < n - 1; i++) ends[i] = starts[i + 1];
  return { n, starts, ends, estimated: true };
}

function estimateTimings(surahNum, duration) {
  if (!isFinite(duration) || duration <= 0) return null;
  if (surahNum === 1) return getFatihahEstimated(duration);
  const s = SURAH_MAP.get(surahNum);
  if (!s || !s.ayahs) return null;
  const n = s.ayahs;
  const weights = new Float32Array(n);
  let totalW = 0;
  for (let i = 0; i < n; i++) {
    let w = 1;
    if (i < 3) w = 1.5;
    else if (i >= n - 3) w = 0.7;
    weights[i] = w; totalW += w;
  }
  const perUnit = duration / totalW;
  const starts = new Float32Array(n);
  const ends = new Float32Array(n);
  let cum = 0;
  for (let i = 0; i < n; i++) { starts[i] = cum * perUnit; cum += weights[i]; ends[i] = cum * perUnit; }
  return { n, starts, ends, estimated: true };
}

const IDB = {
  _db: null,
  async open() {
    if (this._db) return this._db;
    return new Promise((res, rej) => {
      const req = indexedDB.open(CONFIG.idbName, CONFIG.idbVersion);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        const tx = e.target.transaction;
        const oldVersion = e.oldVersion || 0;

        // Ensure audio store exists
        if (!db.objectStoreNames.contains(CONFIG.idbStore)) {
          const st = db.createObjectStore(CONFIG.idbStore, { keyPath: "key" });
          st.createIndex("reciterId", "reciterId", { unique: false });
        }
        // Create audio-meta store (v3)
        if (!db.objectStoreNames.contains(CONFIG.idbMetaStore)) {
          const mst = db.createObjectStore(CONFIG.idbMetaStore, { keyPath: "key" });
          mst.createIndex("reciterId", "reciterId", { unique: false });
          // Migration v2→v3: copy metadata from audio store
          if (oldVersion >= 2) {
            try {
              const oldStore = tx.objectStore(CONFIG.idbStore);
              const cursorReq = oldStore.openCursor();
              cursorReq.onsuccess = (ev) => {
                const c = ev.target.result;
                if (!c) return;
                const r = c.value;
                mst.put({
                  key: r.key,
                  reciterId: r.reciterId,
                  surahNum: r.surahNum,
                  size: r.size || (r.blob && r.blob.size) || 0,
                  timestamp: r.timestamp || Date.now()
                });
                c.continue();
              };
            } catch(_) {}
          }
        }
             
        if (db.objectStoreNames.contains('timings')) db.deleteObjectStore('timings');
        if (db.objectStoreNames.contains('texts')) db.deleteObjectStore('texts');
      };
      req.onsuccess = () => { this._db = req.result; res(this._db); };
      req.onerror = () => rej(req.error);
    });
  },
  // ─── Audio store (blobs) ───
  async put(rec) { const db = await this.open(); return new Promise((res, rej) => { const tx = db.transaction(CONFIG.idbStore, "readwrite"); tx.objectStore(CONFIG.idbStore).put(rec); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); },
  async getAudio(rid, sn) { const db = await this.open(); return new Promise((res, rej) => { const req = db.transaction(CONFIG.idbStore, "readonly").objectStore(CONFIG.idbStore).get(`${rid}-${sn}`); req.onsuccess = () => res(req.result || null); req.onerror = () => rej(req.error); }); },
  async delete(key) { const db = await this.open(); return new Promise((res, rej) => { const tx = db.transaction(CONFIG.idbStore, "readwrite"); tx.objectStore(CONFIG.idbStore).delete(key); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); },
  async clear() { const db = await this.open(); return new Promise((res, rej) => { const tx = db.transaction(CONFIG.idbStore, "readwrite"); tx.objectStore(CONFIG.idbStore).clear(); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); },
  // ─── Audio-meta store (metadata only) ───
  async getAllMeta() { const db = await this.open(); return new Promise((res, rej) => { const req = db.transaction(CONFIG.idbMetaStore, "readonly").objectStore(CONFIG.idbMetaStore).getAll(); req.onsuccess = () => res(req.result || []); req.onerror = () => rej(req.error); }); },
  async putMeta(rec) { const db = await this.open(); return new Promise((res, rej) => { const tx = db.transaction(CONFIG.idbMetaStore, "readwrite"); tx.objectStore(CONFIG.idbMetaStore).put(rec); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); },
  async deleteMeta(key) { const db = await this.open(); return new Promise((res, rej) => { const tx = db.transaction(CONFIG.idbMetaStore, "readwrite"); tx.objectStore(CONFIG.idbMetaStore).delete(key); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); },
  async clearMeta() { const db = await this.open(); return new Promise((res, rej) => { const tx = db.transaction(CONFIG.idbMetaStore, "readwrite"); tx.objectStore(CONFIG.idbMetaStore).clear(); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); },
  
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

const state = { current: null, playing: false, _buffering: false, mode: "seq", queue: [], qIndex: -1, volume: CONFIG.defaultVolume, speed: CONFIG.defaultSpeed, shuffle: false, repeat: "off", search: "", lastPlayed: null, currentTime: 0, _prevVolume: CONFIG.defaultVolume, _restoredFromSaved: false, _playIntent: false, _lastSavedTime: 0, _lastSavedSignature: "", _lastKnownDuration: 0, _tabVisible: !document.hidden, _loadedRid: null, _loadedSn: null, range: emptyRange(), sleep: { active: false, endsAt: 0 }, reciterId: 1, downloads: [], _downloadSelection: new Set(), timingIds: {} };
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
        v: 330, queue: s.queue, mode: s.mode, qIndex: s.qIndex, current: s.current,
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
  spinner: `<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-dasharray="42 14" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.9s" repeatCount="indefinite"/></circle>`,
};

let toastTimer = 0;
function toast(msg, type = "info") { els.toastMsg.textContent = msg; els.toast.classList.remove("success", "error", "repeat"); if (type === "success") { els.toast.classList.add("success"); els.toastIcon.innerHTML = ICONS.check; } else if (type === "error") { els.toast.classList.add("error"); els.toastIcon.innerHTML = ICONS.alert; } else if (type === "repeat") { els.toast.classList.add("repeat"); els.toastIcon.innerHTML = ICONS.repeat; } else { els.toastIcon.innerHTML = ICONS.check; } els.toast.classList.add("on"); clearTimeout(toastTimer); toastTimer = setTimeout(() => els.toast.classList.remove("on"), CONFIG.toastDurationMs); }

const TimingsAPI = {
  cache: {}, _loadedFromDB: false,
  has(rid, surah) { return !!(this.cache[rid] && this.cache[rid][surah]); },
  getFor(rid, surah) { const r = this.cache[rid]; if (!r || !r[surah]) return null; return r[surah]; },
   getAyahRange(rid, surah, ayahNum) {
    const t = this.cache[rid] && this.cache[rid][surah];
    if (!t) return null;
    const idx = ayahNum - (t.baseAyah || 0);
    if (idx < 0 || idx >= t.n) return null;
    return { startTime: t.starts[idx], endTime: t.ends[idx] };
  },
    _store(rid, sn, ayahs) {
    const keys = Object.keys(ayahs).map(Number).sort((a, b) => a - b);
    if (!keys.length) return;
    const n = keys.length;
    const starts = new Float32Array(n);
    const ends = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      starts[i] = ayahs[keys[i]].startTime;
      ends[i] = ayahs[keys[i]].endTime;
    }
    for (let i = 0; i < n - 1; i++) { if (ends[i] > starts[i + 1]) ends[i] = starts[i + 1]; }
    if (!this.cache[rid]) this.cache[rid] = {};
    // ⭐ baseAyah: 0 لو البسملة ضمن التوقيتات، 1 لو لأ (الفاتحة بعد إعادة الترقيم)
    this.cache[rid][sn] = { n, starts, ends, baseAyah: keys[0] };
  },
  async fetch(rid, surahNumber) {
    if (this.has(rid, surahNumber)) return this.cache[rid][surahNumber];
    return null;
  },
};

const TextAPI = {
  cache: createLRU(CONFIG.TEXTS_CACHE_MAX),
  _loadedFromDB: false,
  async fetch(surahNumber) {
    const cached = this.cache.get(surahNumber);
    return cached || null;
  },
  get(surah, ayah) { const s = this.cache.get(surah); return s ? s[ayah] || null : null; },
  has(surah) { return this.cache.has(surah); },
};

let _silentSwitch = false, _silentSwitchTimer = null, _audioLoadId = 0;
const _blobUrlLRU = createBlobUrlLRU(CONFIG.BLOB_LRU_MAX);

function markSilentSwitch() { _silentSwitch = true; if (_silentSwitchTimer) clearTimeout(_silentSwitchTimer); _silentSwitchTimer = setTimeout(() => { _silentSwitch = false; _silentSwitchTimer = null; }, CONFIG.silentSwitchMs); }
function clearSilentSwitch() { if (_silentSwitchTimer) clearTimeout(_silentSwitchTimer); _silentSwitchTimer = null; _silentSwitch = false; }
function getSurahUrl(rid, sn) { const r = RECITER_MAP.get(rid); return `${(r ? r.server : CONFIG.reciters[0].server)}${pad(sn)}.mp3`; }

/* ⭐ v33: Async source resolution — blob LRU first, then IDB, then remote */
async function resolveSurahSrc(rid, sn) {
  const k = `${rid}-${sn}`;
  const cached = _blobUrlLRU.get(k);
  if (cached) return cached;
  if (Downloads.isDownloaded(rid, sn)) {
    try {
      const rec = await IDB.getAudio(rid, sn);
      if (rec && rec.blob && rec.blob.size > 0) return _blobUrlLRU.set(k, rec.blob);
    } catch(_) {}
  }
  return getSurahUrl(rid, sn);
}

function pauseAudio() { try { els.audio.pause(); } catch(_){} }
function setLoadedSource(rid, sn) { state._loadedRid = rid; state._loadedSn = sn; }

/* ⭐ v3.0.3: فحص هل الوقت الحالي داخل الـ buffer */
function isTimeBuffered(time) {
  const buffered = els.audio.buffered;
  for (let i = 0; i < buffered.length; i++) {
    if (time >= buffered.start(i) && time <= buffered.end(i)) return true;
  }
  return false;
}

/* ⭐ v3.0.3: هل نقدر نعمل Seek للنقطة دي؟ */
function canSeekTo(time) {
  // لو النت شغال → مسموح (Range Requests هيتعامل)
  if (navigator.onLine) return true;
  // لو النت مقطوع → لازم الوقت يكون في الـ buffer
  return isTimeBuffered(time);
}

const StaticDataLoader = {
  _readyPromise: null,
  _started: false,

  init() {
    if (this._started) return this._readyPromise;
    this._started = true;
    this._readyPromise = this._run();
    return this._readyPromise;
  },

  async _run() {
    const t0 = performance.now();
    UI.showDataLoading(7);

    // ⭐ ملفات data/*.js بقت متغيرات global — بتتحمّل بـ <script>
    const textsData = window.__TEXTS;
    if (textsData) {
      for (const [snStr, ayahs] of Object.entries(textsData)) {
        TextAPI.cache.set(Number(snStr), ayahs);
      }
    }

    let done = 1, failed = textsData ? 0 : 1;
    UI.updateDataLoading(done, 7, failed);

    for (let i = 0; i < CONFIG.reciters.length; i++) {
      const rec = CONFIG.reciters[i];
      const data = window[`__TIMINGS_${rec.id}`];
      if (data) {
        for (const [snStr, ayahs] of Object.entries(data)) {
          TimingsAPI._store(rec.id, Number(snStr), ayahs);
        }
      } else {
        failed++;
      }
      done++;
      UI.updateDataLoading(done, 7, failed);
      await new Promise(r => setTimeout(r, 0));
    }

    TimingsAPI._loadedFromDB = true;
    TextAPI._loadedFromDB = true;

    // ⭐ ضمان ظهور شاشة التحميل 800ms على الأقل
    const elapsed = performance.now() - t0;
    if (elapsed < 800) await new Promise(r => setTimeout(r, 800 - elapsed));
    UI.hideDataLoading();
  },

  ensureCurrent() {}
};

const OfflineResume = {
  _restoring: false, _retryTimer: null, _retryAttempt: 0,

  _ayahFromTime(rid, sn, time) {
    try {
      if (!TimingsAPI.has(rid, sn)) return null;
      const result = Subtitle.findCurrentAyah(rid, sn, time);
      return (result != null && result > 0) ? result : null;
    } catch(_) { return null; }
  },

  _stillValid(data) { return state.current === data.sn && state.reciterId === data.rid; },

  async restore(trigger) {
    if (this._restoring) return;
    if (!navigator.onLine) return;
    if (!state.current) return;

    this._restoring = true;
    this._retryAttempt = 0;

    try {
      if (!TimingsAPI.has(state.reciterId, state.current)) { try { await TimingsAPI.fetch(state.reciterId, state.current); } catch(_) {} }
      const snapshot = { sn: state.current, rid: state.reciterId };
      if (!this._stillValid(snapshot)) { this._restoring = false; return; }

      const audioHealthy = !els.audio.error && els.audio.readyState >= 2;
      const liveTime = audioHealthy ? (els.audio.currentTime || 0) : (state.currentTime || 0);
      const liveAyah = this._ayahFromTime(state.reciterId, state.current, liveTime);

      await this._applyRestore({ rid: state.reciterId, sn: state.current, ayah: liveAyah, time: liveTime, wasPlaying: !!state._playIntent });
    } catch(_) { this._restoring = false; }
  },

  async _applyRestore(data) {
    if (!this._stillValid(data)) { this._restoring = false; return; }

    let targetTime = data.time || 0;
    let precise = false;
    if (data.ayah != null) {
      const t = TimingsAPI.getAyahRange(data.rid, data.sn, data.ayah);
      if (t) { targetTime = t.startTime; precise = true; }
    }

    try { els.audio.pause(); els.audio.removeAttribute('src'); els.audio.load(); } catch(_) {}
    await new Promise(r => setTimeout(r, 60));
    if (!this._stillValid(data)) { this._restoring = false; return; }

    markSilentSwitch();
    setLoadedSource(data.rid, data.sn);

    let src;
    try { src = await resolveSurahSrc(data.rid, data.sn); } catch(_) { this._scheduleRetry(data); return; }
    if (!this._stillValid(data)) { clearSilentSwitch(); this._restoring = false; return; }

    try { els.audio.src = src; els.audio.load(); } catch(_) { this._scheduleRetry(data); return; }

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
    if (!this._stillValid(data)) { clearSilentSwitch(); this._restoring = false; return; }

    try { els.audio.currentTime = targetTime; state.currentTime = targetTime; } catch(_) {}

    await new Promise((resolve) => {
      let done = false;
      const finish = () => { if (done) return; done = true; els.audio.removeEventListener('seeked', onSeeked); clearTimeout(tmo); resolve(); };
      const onSeeked = () => finish();
      els.audio.addEventListener('seeked', onSeeked);
      const tmo = setTimeout(finish, 2500);
    });

    if (!this._stillValid(data)) { clearSilentSwitch(); this._restoring = false; return; }

    if (data.wasPlaying) { state._playIntent = true; const p = els.audio.play(); if (p && p.catch) p.catch(() => {}); }

    UI.progress();
    Subtitle.currentKey = null;
    Subtitle.update();
    clearSilentSwitch();
    this._restoring = false;
    this._retryAttempt = 0;

    if (precise) toast(`▶ عاد الاتصال — الآية ${data.ayah}`, "success");
    else toast("▶ عاد الاتصال", "success");
  },

  _scheduleRetry(data) {
    if (this._retryTimer) clearTimeout(this._retryTimer);
    if (!navigator.onLine) { this._restoring = false; return; }
    if (!this._stillValid(data)) { this._restoring = false; return; }
    this._retryAttempt++;
    if (this._retryAttempt > CONFIG.OFFLINE_MAX_RETRIES) { this._restoring = false; return; }
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      if (!navigator.onLine) { this._restoring = false; return; }
      if (!this._stillValid(data)) { this._restoring = false; return; }
      this._applyRestore(data);
    }, CONFIG.OFFLINE_RETRY_DELAY_MS);
  },

  clear() { if (this._retryTimer) { clearTimeout(this._retryTimer); this._retryTimer = null; } this._retryAttempt = 0; this._restoring = false; }
};

const Subtitle = {
  currentKey: null, _pendingFetches: {}, _failedMap: new Map(), _changingTimer: null, _lastUpdateTs: 0,
  _markFailed(fk) {
    if (this._failedMap.has(fk)) this._failedMap.delete(fk);
    this._failedMap.set(fk, Date.now());
    if (this._failedMap.size > CONFIG.FAILED_FETCHES_MAX) { const old = this._failedMap.keys().next().value; this._failedMap.delete(old); }
  },
    findCurrentAyah(rid, surahNum, t) {
    const timings = TimingsAPI.getFor(rid, surahNum);
    if (!timings) return null;
    const { n, starts, ends, baseAyah } = timings;
    const base = baseAyah || 0;
    let lo = 0, hi = n - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (t < starts[mid]) hi = mid - 1;
      else if (t >= ends[mid]) lo = mid + 1;
      else return mid + base;
    }
    if (lo >= n) return (n - 1) + base;
    if (lo === 0) return base;
    return (lo - 1) + base;
  },
  update() {
    const now = performance.now();
    if (now - this._lastUpdateTs < CONFIG.SUBTITLE_THROTTLE_MS) return;
    this._lastUpdateTs = now;

    if (!state.current) { this.hide(); return; }
    const surah = state.current;
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
  },
  hide() { els.subtitleStrip.classList.remove("on"); this.currentKey = null; },
};

const cardEls = new Map();
let lastPlayingCard = null;
const UI = {
  _markerNodes: new Map(), _currentMarkerNode: null, _lastHighlightAyah: null, _markerRenderKey: null, _pendingMarkerIdle: null,
  buildLibrary() {
    const h = document.createElement("div");
    h.innerHTML = SURAHS.map(s => { const tc = s.type === "مكية" ? "makki" : "madani"; return `<article class="card" data-num="${s.number}" tabindex="0" role="button" aria-label="سورة ${esc(s.nameAr)}"><div class="num">${ICONS.star}<span class="val">${s.number}</span><div class="eq-indicator"><i></i><i></i><i></i></div></div><div class="meta"><div class="ar">${esc(s.nameAr)}</div><div class="en">${esc(s.nameEn)}</div><div class="tags"><span class="tag">${s.ayahs} آية</span><span class="tag ${tc}">${s.type}</span><span class="tag downloaded-badge" data-downloaded-badge style="display:none">⬇ محمّلة</span><span class="tag resume-badge" data-resume-badge style="display:none">▶ استئناف</span><span class="tag range-badge" data-range-badge style="display:none">نطاق</span><span class="tag repeat-badge" data-repeat-badge style="display:none">🔁</span></div></div><div class="card-actions"><button class="mini dl-mini" data-act="download" data-num="${s.number}" title="تحميل"><span class="ring"></span><span class="dl-mini-pct">0%</span><svg viewBox="0 0 24 24">${ICONS.download}</svg></button><button class="mini" data-act="add" data-num="${s.number}" title="أضف"><svg viewBox="0 0 24 24">${ICONS.plus}</svg></button></div></article>`; }).join("");
    const frag = document.createDocumentFragment(); while (h.firstChild) frag.appendChild(h.firstChild);
    els.grid.appendChild(frag);
    $$(".card", els.grid).forEach(el => cardEls.set(+el.dataset.num, el));
  },
  filter() {
    const raw = (state.search || "").trim();
    if (!raw) { cardEls.forEach(el => { el.style.display = ""; }); return; }
    const q = raw.toLowerCase();
    const qNum = arabicToEnglish(raw).toLowerCase();
    const isNum = /^\d+$/.test(qNum);
    const qInt = isNum ? parseInt(qNum, 10) : NaN;
    const normEn = (s) => s.toLowerCase().replace(/^(ash|adh|al|an|ar|as|at|az|ad)[\s-]+/i, '').replace(/[^a-z0-9]/g, '');
    const qNormEn = normEn(q);
    cardEls.forEach((el, num) => {
      const s = SURAH_MAP.get(num);
      const enNorm = normEn(s.nameEn || '');
      const match = (s.nameAr || "").toLowerCase().includes(q) || (s.nameEn || "").toLowerCase().includes(q) || (qNormEn && enNorm.includes(qNormEn)) || (isNum && qInt === num);
      el.style.display = match ? "" : "none";
    });
  },  updatePlayingCard() { if (lastPlayingCard) lastPlayingCard.classList.remove("playing", "audio-active"); if (!state.current) { lastPlayingCard = null; return; } const el = cardEls.get(state.current); if (el) { el.classList.add("playing"); if (state.playing) el.classList.add("audio-active"); lastPlayingCard = el; } },
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
      if (state.range.active) { if (state.range.crossSurah && state.range.phase === "leg2") parts.push("2/2"); const rc = state.range.repeatCount || 1; if (rc > 1) parts.push(`تشغيل ${(state.range.repeatIndex || 0) + 1}/${rc}`); if (state.range.sameSurah) parts.push("نفس السورة"); if (state.range.estimated) parts.push("≈ تقديري"); }
      if (state.mode === "queue") { const idx = state.queue.indexOf(state.current); if (idx !== -1) parts.push(`من القائمة ${idx + 1}/${state.queue.length}`); }
      const extra = parts.length ? ` · ${parts.join(" · ")}` : "";
      els.nowTitle.textContent = `سورة ${s.nameAr}`;
      if (state._restoredFromSaved && state.currentTime > 1) { els.nowSub.innerHTML = `<span class="resume-hint">▶ اضغط تشغيل للمتابعة من ${fmtTime(state.currentTime)}</span>`; els.playBtn.classList.add("has-resume"); }
      else if (isOff) { els.nowSub.innerHTML = `<span class="offline-hint">⬇ محمّلة · يعمل بدون إنترنت</span>${extra}`; els.playBtn.classList.remove("has-resume"); }
      else { els.nowSub.textContent = `${s.nameEn} · ${s.ayahs} آية · ${s.type}${extra}`; els.playBtn.classList.remove("has-resume"); }
      els.statLast.textContent = s.nameAr; els.nowArt.classList.add("spin");
    } else { els.nowTitle.textContent = "لم يتم التشغيل"; els.nowSub.textContent = "اختر سورة"; els.statLast.textContent = "—"; els.nowArt.classList.remove("spin"); els.playBtn.classList.remove("has-resume"); }
        if (state._buffering) {
      els.playIcon.innerHTML = ICONS.spinner;
      els.playBtn.classList.add("buffering");
    } else {
      els.playIcon.innerHTML = state.playing ? ICONS.pause : ICONS.play;
      els.playBtn.classList.remove("buffering");
    }
    els.playBtn.disabled = !state.current;
  },
  progress() {
    const hasAudio = isFinite(els.audio.duration) && els.audio.duration > 0;
    const dur = hasAudio ? els.audio.duration : (state._lastKnownDuration || 0);
    const cur = hasAudio ? (els.audio.currentTime || 0) : (state.currentTime || 0);
    const ratio = dur > 0 ? cur / dur : 0;
       els.seekFill.style.transform = `scaleX(${ratio})`;
    els.seekThumb.style.setProperty("--seek-x", (ratio * 100).toFixed(3) + "%");
    const curStr = fmtTime(cur);
    if (els.timeCur.textContent !== curStr) els.timeCur.textContent = curStr;
    if (dur > 0) {
      const durStr = fmtTime(dur);
      if (els.timeTotal.textContent !== durStr) els.timeTotal.textContent = durStr;
      const ariaVal = String(Math.round(ratio * 100));
      if (els.seek.getAttribute("aria-valuenow") !== ariaVal) els.seek.setAttribute("aria-valuenow", ariaVal);
    }
    if (els.audio.buffered.length && hasAudio) {
      const end = els.audio.buffered.end(els.audio.buffered.length - 1);
      const newWidth = ((end / dur) * 100).toFixed(2) + "%";
      if (els.seekBuffer.style.width !== newWidth) els.seekBuffer.style.width = newWidth;
    }
  },
      renderAyahMarkers() {
  if (!state.current) return this._clearMarkers();
  const dur = els.audio.duration;
  if (!isFinite(dur) || dur <= 0) return this._clearMarkers();
  const timings = TimingsAPI.getFor(state.reciterId, state.current);
  if (!timings || timings.n < 2) return this._clearMarkers();

  const key = `${state.reciterId}-${state.current}-${Math.round(dur)}-R`;
  if (this._markerRenderKey === key) return;
  /* ⭐ ملحوظة: مش بنحفظ _markerRenderKey هنا — هيتحفظ بعد نجاح البناء */

  /* ⭐ إلغاء أي عملية بناء معلقة من قبل */
  if (this._pendingMarkerIdle != null) {
    if (window.cancelIdleCallback) cancelIdleCallback(this._pendingMarkerIdle);
    else clearTimeout(this._pendingMarkerIdle);
    this._pendingMarkerIdle = null;
  }

  /* ⭐ تفريغ فوري للشريط */
  els.seekAyahMarkers.innerHTML = "";
  this._markerNodes.clear();
  this._currentMarkerNode = null;
  this._lastHighlightAyah = null;

  const { n, starts, baseAyah } = timings;
  const base = baseAyah || 0;
  const container = els.seekAyahMarkers;
  const nodesMap = this._markerNodes;
  const renderKeySnapshot = key;
  /* ⭐ حفظ هوية السورة والقارئ للحماية من stale builds */
  const surahSnapshot = state.current;
  const ridSnapshot = state.reciterId;
  const self = this;

  /* ⭐ البناء الفعلي — يُؤجَّل لـ requestIdleCallback لتجنب blocking الـ UI */
  const buildMarkers = () => {
    self._pendingMarkerIdle = null;

    /* ⭐ تحقق 1: هل الحالة اتغيرت أثناء الانتظار؟ */
    if (!state.current) return;
    if (state.current !== surahSnapshot || state.reciterId !== ridSnapshot) return;

    /* ⭐ تحقق 2: هل في طلب بناء أحدث اتخطى ده؟ */
    if (self._markerRenderKey === renderKeySnapshot) return;

    /* ⭐ بناء HTML string كامل — أسرع 5-10× من createElement */
    let html = '';
    const keys = [];
    for (let i = 1; i < n; i++) {
      const pos = (starts[i] / dur) * 100;
      if (pos <= 0 || pos >= 100) continue;
      html += `<i style="left:${pos.toFixed(3)}%" data-ayah="${i + base}"></i>`;
      keys.push(i + base);
    }

    /* ⭐ إضافة مرة واحدة للـ DOM — layout واحد فقط */
    container.innerHTML = html;

    /* ⭐ ربط المراجع — k لتجنب shadowing + Math.min للأمان */
    const children = container.children;
    const len = Math.min(keys.length, children.length);
    for (let k = 0; k < len; k++) {
      nodesMap.set(keys[k], children[k]);
    }

    /* ⭐ قفل المفتاح — دلوقتي بس بعد نجاح البناء */
    self._markerRenderKey = renderKeySnapshot;

    /* ⭐ إعادة تطبيق الـ highlight للآية الحالية */
    self._lastHighlightAyah = null;
    if (state.current) {
      const audioHealthy = !els.audio.error && els.audio.readyState >= 2;
      const t = audioHealthy ? (els.audio.currentTime || 0) : (state.currentTime || 0);
      const curAyah = Subtitle.findCurrentAyah(state.reciterId, state.current, t);
      if (curAyah != null) self.highlightMarker(curAyah);
    }
  };

  if (window.requestIdleCallback) {
    this._pendingMarkerIdle = requestIdleCallback(buildMarkers, { timeout: 500 });
  } else {
    this._pendingMarkerIdle = setTimeout(buildMarkers, 50);
  }
},
   _clearMarkers() {
    if (this._pendingMarkerIdle != null) {
      if (window.cancelIdleCallback) cancelIdleCallback(this._pendingMarkerIdle);
      else clearTimeout(this._pendingMarkerIdle);
      this._pendingMarkerIdle = null;
    }
    els.seekAyahMarkers.innerHTML = "";
    this._markerNodes.clear();
    this._currentMarkerNode = null;
    this._lastHighlightAyah = null;
    this._markerRenderKey = null;
  },
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
  showDataLoading(total) {
    const ov = document.getElementById('dataLoadingOverlay');
    if (!ov) return;
    ov.style.display = 'flex';
    ov.style.opacity = '1';
    const t = document.getElementById('dataLoadingText');
    if (t) t.textContent = `0 / ${total}`;
    const b = document.getElementById('dataLoadingBar');
    if (b) b.style.width = '0%';
  },
  updateDataLoading(done, total, failed) {
    const t = document.getElementById('dataLoadingText');
    if (t) t.textContent = `${done} / ${total}${failed ? ` (فشل: ${failed})` : ''}`;
    const b = document.getElementById('dataLoadingBar');
    if (b) b.style.width = Math.min(100, (done / total) * 100) + '%';
  },
  hideDataLoading() {
    const ov = document.getElementById('dataLoadingOverlay');
    if (!ov) return;
    ov.style.transition = 'opacity .4s ease';
    ov.style.opacity = '0';
    setTimeout(() => { ov.style.display = 'none'; ov.style.opacity = '1'; }, 400);
  },
};

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

const Audio = {
       async load(num, { autoplay = true, seek = 0 } = {}) {
    if (!SURAH_MAP.has(num)) return;
    if (!navigator.onLine && !Downloads.isDownloaded(state.reciterId, num)) {
      const s = SURAH_MAP.get(num);
      const sName = s ? s.nameAr : `سورة ${num}`;
      toast(`📴 ${sName} غير محمّلة — لا يمكن التشغيل بدون إنترنت`, "error");
      return;
    }
    
    const inL2 = state.range.active && state.range.crossSurah && state.range.phase === "leg2" && num === state.range.endSurah;
    if (state.range.active && !inL2) { const sc = (num !== state.range.surah) || (state.range.crossSurah && state.range.phase === "leg2"); if (sc) { const rc = state.range.repeatCount || 1; const ss = state.range.sameSurah; state.range = emptyRange(); state.range.repeatCount = rc; state.range.sameSurah = ss; UI.updateRangeBadges(); UI.rangeMarkers(); Range.syncUI(); stopRangeWatch(); } }
    markSilentSwitch();
    _audioLoadId++;
    const loadId = _audioLoadId;
    pauseAudio();
    state.current = num; state.currentTime = seek || 0;
    setLoadedSource(state.reciterId, num);

    const rid = state.reciterId;
    let src;
    try { src = await resolveSurahSrc(rid, num); } catch(_) { src = getSurahUrl(rid, num); }
    if (_audioLoadId !== loadId || state.current !== num || state.reciterId !== rid) return;

    try {
      els.audio.src = src;
      els.audio.playbackRate = state.speed;
      els.audio.volume = state.volume;
      els.audio.muted = state.volume === 0;
      els.audio.load();
    } catch(_){}

    if (autoplay) { state._playIntent = true; const p = els.audio.play(); if (p && p.catch) p.catch(() => {}); }
        StaticDataLoader.ensureCurrent(rid, num);
    OfflineResume.clear();
    saveSoon();
  },
  play() { state._playIntent = true; const p = els.audio.play(); if (p && p.catch) p.catch(() => {}); },
  pause() { state._playIntent = false; els.audio.pause(); safeSave(); },
  toggle() { if (!state.current) return; if (els.audio.paused) Audio.play(); else Audio.pause(); },
    seekTo(sec) {
    if (!isFinite(els.audio.duration)) return;
    const target = clamp(sec, 0, els.audio.duration);
    
    /* ⭐ v3.0.3: منع التنقل لمنطقة غير محمّلة بدون نت */
    if (!canSeekTo(target)) {
      toast("📴 هذا الجزء غير محمّل — لا يمكن التنقل بدون إنترنت", "error");
      return;
    }
    
    const wasPlaying = state._playIntent;
    els.audio.currentTime = target;
    if (wasPlaying && els.audio.paused) { const p = els.audio.play(); if (p && p.catch) p.catch(() => {}); }
    safeSave();
  },  setVolume(v) { state.volume = clamp(v, 0, 1); els.audio.volume = state.volume; els.audio.muted = state.volume === 0; UI.volume(); saveSoon(); },
  setSpeed(s) { state.speed = s; els.audio.playbackRate = s; UI.speed(); saveSoon(); },
};

async function switchReciterSmart(newRid) {
  if (state.reciterId === newRid) return;
  const oldRid = state.reciterId;
  const wasPlaying = state._playIntent;
  const oldTime = els.audio.currentTime || state.currentTime || 0;
  const curSurah = state.current;

  /* ⭐ v3.0.3: التبديل يعمل مع أي سورة — Range Requests مدعومة */
  const newReciterHasSurah = curSurah ? Downloads.isDownloaded(newRid, curSurah) : false;

  /* أوفلاين + السورة مش محمّلة عند القارئ الجديد → ارفض */
  if (!navigator.onLine && curSurah && !newReciterHasSurah) {
    toast(`📴 القارئ ده مش محمّل أوفلاين`, "error");
    return;
  }

  /* استخراج الآية الحالية من القارئ القديم */
  let curAyah = null;
  if (curSurah) {
    if (!TimingsAPI.has(oldRid, curSurah)) {
      try { await TimingsAPI.fetch(oldRid, curSurah); } catch(_){}
    }
    curAyah = Subtitle.findCurrentAyah(oldRid, curSurah, oldTime);
  }

  /* تغيير القارئ */
  state.reciterId = newRid;
  const rec = RECITER_MAP.get(newRid);
  UI.reciterName(rec.name);
  UI.updateDownloadedBadges();
  UI.updateMobileValues();
  saveSoon();

  if (!curSurah) { toast(`🎙️ ${rec.name}`, "success"); return; }

  /* تحميل التوقيتات الجديدة (احتياطي) */
  if (!TimingsAPI.has(newRid, curSurah)) {
    try { await TimingsAPI.fetch(newRid, curSurah); } catch(_) {}
  }

  /* حساب الوقت المستهدف — دائمًا على نفس الآية */
  let targetTime = 0;
  let precise = false;
  const newTimings = TimingsAPI.getFor(newRid, curSurah);

  /* المسار 1: عندنا رقم الآية + توقيتات القارئ الجديد */
  if (curAyah !== null && newTimings) {
    const r = TimingsAPI.getAyahRange(newRid, curSurah, curAyah);
    if (r) { targetTime = r.startTime; precise = true; }
  }

  /* المسار 2: مطابقة الوقت المباشر */
  if (!precise && newTimings) {
    const n = newTimings.n;
    for (let i = 0; i < n; i++) {
      if (oldTime >= newTimings.starts[i] && oldTime < newTimings.ends[i]) {
        targetTime = newTimings.starts[i];
        precise = true;
        break;
      }
    }
  }

  /* المسار 3: نسبة من السورة */
  if (!precise && newTimings) {
    const oldDur = els.audio.duration || state._lastKnownDuration || 0;
    const newDur = newTimings.ends[newTimings.n - 1] || 0;
    if (oldDur > 0 && newDur > 0) {
      targetTime = (oldTime / oldDur) * newDur;
    }
  }

  /* تعديل النطاق النشط */
  if (state.range.active && state.range.surah === curSurah && !state.range.crossSurah) {
    const r = state.range;
    if (r.mode === "duration") {
      const rangeDur = r.endTime - r.startTime;
      r.startTime = targetTime;
      r.endTime = targetTime + rangeDur;
    } else if (newTimings) {
      if (r.startAyah) {
        const rs = TimingsAPI.getAyahRange(newRid, curSurah, r.startAyah);
        if (rs) r.startTime = rs.startTime;
      }
      if (r.endAyah) {
        const re = TimingsAPI.getAyahRange(newRid, curSurah, r.endAyah);
        if (re) r.endTime = re.endTime + CONFIG.defaultEndBuffer;
      }
    }
    UI.rangeMarkers();
  }

  /* تحميل القارئ الجديد من نفس النقطة */
  UI._markerRenderKey = null;
  markSilentSwitch();
  _audioLoadId++;
  const loadId = _audioLoadId;
  pauseAudio();
  state.currentTime = targetTime;
  setLoadedSource(newRid, curSurah);

  let src;
  try { src = await resolveSurahSrc(newRid, curSurah); } catch(_) { src = getSurahUrl(newRid, curSurah); }
  if (_audioLoadId !== loadId || state.reciterId !== newRid || state.current !== curSurah) return;

  try {
    els.audio.src = src;
    els.audio.playbackRate = state.speed;
    els.audio.volume = state.volume;
    els.audio.muted = state.volume === 0;
    els.audio.load();
  } catch(_) {}

  await new Promise((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; els.audio.removeEventListener("canplay", onCanPlay); els.audio.removeEventListener("error", onErr); clearTimeout(tmo); resolve(); };
    const onCanPlay = () => {
      try { els.audio.currentTime = targetTime; state.currentTime = targetTime; } catch(_){}
      if (wasPlaying) { state._playIntent = true; const p = els.audio.play(); if (p && p.catch) p.catch(() => {}); }
      UI._markerRenderKey = null; UI.renderAyahMarkers(); UI.progress();
      Subtitle.currentKey = null; Subtitle.update();
      finish();
    };
    const onErr = () => finish();
    els.audio.addEventListener("canplay", onCanPlay);
    els.audio.addEventListener("error", onErr);
    const tmo = setTimeout(finish, 8000);
  });

  UI.updatePlayingCard(); UI.nowPlaying(); UI.rangeMarkers();
  Subtitle.currentKey = null; Subtitle.update();
  Range.applyLock();

  if (precise && curAyah !== null) toast(`🎙️ ${rec.name} — بدءاً من آية ${curAyah}`, "success");
  else if (curAyah !== null) toast(`🎙️ ${rec.name} — الآية ${curAyah}`, "success");
  else toast(`🎙️ ${rec.name}`, "success");
}

const Player = {
  playSurah(num) { if (!SURAH_MAP.has(num)) return; state._restoredFromSaved = false; state.mode = "seq"; state.qIndex = -1; Audio.load(num, { autoplay: true }).catch(() => {}); UI.updatePlayingCard(); UI.nowPlaying(); UI.updateResumeCard(); UI.updateQueuePlayButtons(); Range.syncUI(); },
  playQueueAt(idx) { if (idx < 0 || idx >= state.queue.length) return; const num = state.queue[idx]; if (state.current === num && state.mode === "queue") { Audio.toggle(); return; } state._restoredFromSaved = false; state.mode = "queue"; state.qIndex = idx; Audio.load(num, { autoplay: true }).catch(() => {}); UI.updatePlayingCard(); UI.nowPlaying(); UI.renderQueue(); UI.updateResumeCard(); Range.syncUI(); },
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

async function restartRange() {
  if (!state.range.active) return;
  const r = state.range;
  if (r.crossSurah) {
    r.phase = "leg1";
    state._restoredFromSaved = false;
    markSilentSwitch();
    _audioLoadId++;
    const loadId = _audioLoadId;
    pauseAudio();
    state.current = r.surah;
    state.currentTime = r.startTime;
    setLoadedSource(state.reciterId, r.surah);
    let src;
    try { src = await resolveSurahSrc(state.reciterId, r.surah); } catch(_) { src = getSurahUrl(state.reciterId, r.surah); }
    if (_audioLoadId !== loadId || state.current !== r.surah) return;
    try { els.audio.src = src; els.audio.load(); } catch(_){}
    TextAPI.fetch(r.surah).catch(() => {});
    state._playIntent = true;
    const p = els.audio.play(); if (p && p.catch) p.catch(() => {});
  } else {
    try { els.audio.currentTime = r.startTime; state.currentTime = r.startTime; } catch(_){}
    Audio.play();
  }
  UI.updatePlayingCard(); UI.updateRangeBadges(); UI.rangeMarkers();
  UI.nowPlaying(); UI.phaseNotice(); saveSoon();
  startRangeWatch();
  Subtitle.currentKey = null;
  Subtitle.update();
}

async function transitionToLeg2() {
  if (!state.range.active || !state.range.crossSurah || state.range.phase !== "leg1") return;
  const e = state.range.endSurah;
  if (!e || !SURAH_MAP.has(e)) return;
  state.range.phase = "leg2";
  state._restoredFromSaved = false;
  markSilentSwitch();
  _audioLoadId++;
  const loadId = _audioLoadId;
  pauseAudio();
  state.current = e;
  state.currentTime = 0;
  setLoadedSource(state.reciterId, e);
  let src;
  try { src = await resolveSurahSrc(state.reciterId, e); } catch(_) { src = getSurahUrl(state.reciterId, e); }
  if (_audioLoadId !== loadId || state.current !== e) return;
  try { els.audio.src = src; els.audio.load(); } catch(_){}
  TextAPI.fetch(e).catch(() => {});
  state._playIntent = true;
  const p = els.audio.play(); if (p && p.catch) p.catch(() => {});
  UI.updatePlayingCard(); UI.nowPlaying(); UI.updateRangeBadges(); UI.rangeMarkers(); UI.phaseNotice(); saveSoon();
  toast(`▶ الانتقال إلى ${SURAH_MAP.get(e).nameAr} — حتى آية ${state.range.endAyah}`, "info");
}

const Range = {
  isOpen() { return els.rangePanel.classList.contains("on"); },
    open() { if (!state.current) { toast("شغّل سورة أولًا", "error"); return; } Range.syncUI(); Range.applyLock(); els.rangePanel.classList.add("on"); els.rangePanel.setAttribute("aria-hidden", "false"); els.rangeBtn.classList.add("active"); UI.phaseNotice(); },  
    close() { els.rangePanel.classList.remove("on"); els.rangePanel.setAttribute("aria-hidden", "true"); if (!state.range.active) els.rangeBtn.classList.remove("active"); },
  toggle() { Range.isOpen() ? Range.close() : Range.open(); },
  setMode(mode) { const ev = parseInt(els.rpEndSurahSelect.value, 10) || state.current; if (ev !== state.current && mode === "duration") mode = "ayah"; state.range._pendingMode = mode; const ia = mode === "ayah"; els.rpEndAyahField.style.display = ia ? "" : "none"; els.rpDurationField.style.display = ia ? "none" : ""; $$("#rpModeToggle button").forEach(b => { b.classList.toggle("active", b.dataset.mode === mode); if (b.dataset.mode === "duration" && ev !== state.current) { b.disabled = true; } else { b.disabled = false; } }); Range.clearErrors(); },
  clearErrors() { els.rpStartField.classList.remove("error"); const ef = els.rpEndSelect.closest(".rp-field"); if (ef) ef.classList.remove("error"); els.rpDurHoursCell.classList.remove("error"); els.rpDurMinutesCell.classList.remove("error"); },
  showError(el, msg) { Range.clearErrors(); if (el) { el.classList.add("error"); setTimeout(() => el.classList.remove("error"), 3000); } toast(msg, "error"); },
  buildAyahOptions(sel, count, ie = true) { sel.innerHTML = ie ? '<option value="">اختر</option>' : '<option value="">بدون حد</option>'; const frag = document.createDocumentFragment(); for (let i = 1; i <= count; i++) { const o = document.createElement("option"); o.value = i; o.textContent = `آية ${i}`; frag.appendChild(o); } sel.appendChild(frag); },
  updateRepeatHighlight() { let v = parseInt(els.rpRepeatCount.value, 10); if (!isFinite(v) || isNaN(v) || v < 1) v = 1; $$(".rp-repeat-preset").forEach(b => b.classList.toggle("active", parseInt(b.dataset.count, 10) === v)); },
  getAyahTime(sn, ayah, dur) {
    const r = TimingsAPI.getAyahRange(state.reciterId, sn, ayah);
    if (r) return r;
    if (sn === 1) { const est = getFatihahEstimated(dur); if (est && ayah <= est.n) return { startTime: est.starts[ayah-1], endTime: est.ends[ayah-1] }; }
    const est = estimateTimings(sn, dur);
    if (est && ayah <= est.n) return { startTime: est.starts[ayah-1], endTime: est.ends[ayah-1] };
    return null;
  },
  getExtendedEndTime(sn, ayah, dur) {
    const buffer = CONFIG.ayahBoundaryBufferMs / 1000;
    const t = TimingsAPI.getFor(state.reciterId, sn);
    if (t && ayah >= 1 && ayah <= t.n) {
      const idx = ayah - 1;
      const curStart = t.starts[idx], curEnd = t.ends[idx];
      if (idx + 1 < t.n) {
        const nextStart = t.starts[idx + 1];
        if (nextStart > curStart + 0.2) {
          const stopBeforeNext = nextStart - buffer;
          const limitByEnd = curEnd > curStart + 0.4 ? curEnd - 0.05 : null;
          if (limitByEnd !== null) return Math.max(curStart + 0.3, Math.min(stopBeforeNext, limitByEnd));
          return Math.max(curStart + 0.3, stopBeforeNext);
        }
      }
      if (dur > 0 && dur > curStart + 0.3) return dur;
      return curEnd;
    }
    const est = estimateTimings(sn, dur);
    if (est && ayah >= 1 && ayah <= est.n) {
      const idx = ayah - 1;
      if (idx + 1 < est.n) return Math.max(est.starts[idx] + 0.3, est.starts[idx + 1] - buffer);
      return dur > 0 ? dur : est.ends[idx];
    }
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
      Range.refreshCrossSurahUI(); Range.updateRepeatHighlight(); Range.updateSameSurahUI(); UI.phaseNotice(); Range.applyLock();
  },
  refreshCrossSurahUI() { const ev = parseInt(els.rpEndSurahSelect.value, 10) || state.current; const ic = ev !== state.current; els.rpEndRow.classList.toggle("cross-surah", ic); if (ic) { const s = SURAH_MAP.get(ev); els.rpEndCrossHint.textContent = `في ${s.nameAr}`; } else els.rpEndCrossHint.textContent = ""; },
   applyLock() {
    /* ⭐ v3.0.3: قفل النطاق اتشال — Range Requests شغالة */
    const panel = els.rangePanel;
    if (!panel) return;
    panel.classList.remove("rp-locked");
    const notice = panel.querySelector(".rp-locked-notice");
    if (notice) notice.remove();
  },
    async apply() {
    Range.clearErrors();
    if (!state.current) { toast("شغّل سورة أولًا", "error"); return; }
    const ssn = state.range.active && state.range.crossSurah && state.range.surah ? state.range.surah : state.current;
    const ss = SURAH_MAP.get(ssn); if (!ss) { toast("تعذر تحديد سورة البداية", "error"); return; }
    let rc = parseInt(els.rpRepeatCount.value, 10); if (!isFinite(rc) || isNaN(rc) || rc < 1) rc = 1; rc = clamp(rc, 1, CONFIG.maxRepeatCount);

    const waitAndGet = async (surahNum) => {
      if (TimingsAPI.has(state.reciterId, surahNum)) return { has: true };
      const promise = TimingsAPI.fetch(state.reciterId, surahNum);
      const timeout = new Promise(r => setTimeout(() => r("__TO__"), CONFIG.RANGE_TIMINGS_TIMEOUT_MS));
      const result = await Promise.race([promise, timeout]);
      if (result === "__TO__") { TimingsAPI.fetch(state.reciterId, surahNum).catch(() => {}); return { has: false }; }
      return { has: !!result };
    };

    if (state.range.sameSurah) {
      const sFull = SURAH_MAP.get(state.current); if (!sFull) return;
      const sdur = (isFinite(els.audio.duration) && els.audio.duration > 0) ? els.audio.duration : null;
      const sd = Range.getAyahTime(state.current, 1, sdur);
      let st = sd ? clamp(sd.startTime, 0, sdur || Infinity) : 0;
      const extendedEnd = Range.getExtendedEndTime(state.current, sFull.ayahs, sdur);
      const dur = (isFinite(els.audio.duration) && els.audio.duration > 0) ? els.audio.duration : sdur;
      let et = (extendedEnd !== null && dur) ? clamp(extendedEnd, st + 0.3, dur) : (dur || Infinity);
      const hasReal = TimingsAPI.has(state.reciterId, state.current);
      state.range = { active: true, surah: state.current, endSurah: state.current, crossSurah: false, phase: "leg1", mode: "ayah", startAyah: 1, endAyah: sFull.ayahs, startTime: st, endTime: et, _pendingMode: "ayah", estimated: !hasReal, openEnded: false, repeatCount: rc, repeatIndex: 0, sameSurah: true };
      state.currentTime = st; try { els.audio.currentTime = st; } catch(_){}
      state._restoredFromSaved = false;
      UI.updateRangeBadges(); UI.rangeMarkers(); UI.updateResumeCard(); UI.nowPlaying(); UI.phaseNotice(); saveSoon();
      if (!els.audio.paused) startRangeWatch();
      if (!hasReal) TimingsAPI.fetch(state.reciterId, state.current).catch(() => {});
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
      await Promise.all([waitAndGet(ssn), waitAndGet(esn)]);
      const hasReal = TimingsAPI.has(state.reciterId, ssn) && TimingsAPI.has(state.reciterId, esn);
      const sd = Range.getAyahTime(ssn, sa, sdur);
      const extendedEnd = Range.getExtendedEndTime(esn, ea, sdur);
      let st = sd ? sd.startTime : 0, et = extendedEnd !== null ? extendedEnd : 0;
      state.range = { active: true, surah: ssn, endSurah: esn, crossSurah: true, phase: "leg1", mode: "ayah", startAyah: sa, endAyah: ea, startTime: st, endTime: et, _pendingMode: "ayah", estimated: !hasReal, openEnded: false, repeatCount: rc, repeatIndex: 0, sameSurah: false };
      state.currentTime = state.range.startTime; state._restoredFromSaved = false;
      if (state.current !== ssn) {
        markSilentSwitch();
        _audioLoadId++;
        const loadId = _audioLoadId;
        pauseAudio();
        state.current = ssn;
        state.currentTime = state.range.startTime;
        setLoadedSource(state.reciterId, ssn);
        let src;
        try { src = await resolveSurahSrc(state.reciterId, ssn); } catch(_) { src = getSurahUrl(state.reciterId, ssn); }
        if (_audioLoadId === loadId && state.current === ssn) {
          try { els.audio.src = src; els.audio.load(); } catch(_){}
          TextAPI.fetch(ssn).catch(() => {});
          if (state._playIntent) { const p = els.audio.play(); if (p && p.catch) p.catch(() => {}); }
        }
      } else { try { els.audio.currentTime = state.range.startTime; } catch(_){} }
      UI.updateRangeBadges(); UI.rangeMarkers(); UI.updateResumeCard(); UI.nowPlaying(); UI.phaseNotice(); saveSoon();
      if (!els.audio.paused) startRangeWatch();
      const rtxt = rc > 1 ? ` × ${rc} مرات` : "";
      const suf = hasReal ? "" : " (تقديري)";
      toast(`✅ من آية ${sa} في ${ss.nameAr} ← آية ${ea} في ${es.nameAr}${rtxt}${suf}`, "success");
      setTimeout(() => { if (Range.isOpen()) Range.close(); }, CONFIG.autoClosePanelDelayMs);
      return;
    }
    if (state.current !== ssn) {
      markSilentSwitch();
      _audioLoadId++;
      const loadId = _audioLoadId;
      pauseAudio();
      state.current = ssn;
      state.currentTime = 0;
      setLoadedSource(state.reciterId, ssn);
      let src;
      try { src = await resolveSurahSrc(state.reciterId, ssn); } catch(_) { src = getSurahUrl(state.reciterId, ssn); }
      if (_audioLoadId === loadId && state.current === ssn) {
        try { els.audio.src = src; els.audio.load(); } catch(_){}
        TextAPI.fetch(ssn).catch(() => {});
        if (state._playIntent) { const p = els.audio.play(); if (p && p.catch) p.catch(() => {}); }
      }
      await new Promise(r => {
        if (isFinite(els.audio.duration) && els.audio.duration > 0) { r(); return; }
        const ol = () => { els.audio.removeEventListener("loadedmetadata", ol); r(); };
        els.audio.addEventListener("loadedmetadata", ol);
        setTimeout(r, 1500);
      });
    }
    const dur = (isFinite(els.audio.duration) && els.audio.duration > 0) ? els.audio.duration : sdur;
    if (!dur) { toast("انتظر تحميل السورة", "error"); return; }
    await waitAndGet(ssn);
    const hasReal = TimingsAPI.has(state.reciterId, ssn);
    if (mode === "ayah") {
      let ea = parseInt(els.rpEndSelect.value, 10); const he = isFinite(ea) && ea >= 1;
      if (he) { ea = clamp(ea, 1, ss.ayahs); if (sa > ea) { Range.showError(els.rpEndSelect.closest(".rp-field"), `❌ آية البداية (${sa}) أكبر من النهاية (${ea})`); return; } }
      const sd = Range.getAyahTime(ssn, sa, dur);
      let st = sd ? clamp(sd.startTime, 0, dur) : 0;
      if (!he) {
        state.range = { active: true, surah: ssn, endSurah: ssn, crossSurah: false, phase: "leg1", mode: "ayah", startAyah: sa, endAyah: null, startTime: st, endTime: dur, _pendingMode: "ayah", estimated: !hasReal, openEnded: true, repeatCount: rc, repeatIndex: 0, sameSurah: false };
        state.currentTime = st; try { els.audio.currentTime = st; } catch(_){} state._restoredFromSaved = false;
        UI.updateRangeBadges(); UI.rangeMarkers(); UI.updateResumeCard(); UI.nowPlaying(); UI.phaseNotice(); saveSoon();
        const rtxt = rc > 1 ? ` × ${rc} مرات` : "";
        const suf = hasReal ? "" : " (تقديري)";
        toast(`▶ سيبدأ من آية ${sa} — سيستمر حتى الإيقاف${rtxt}${suf}`, "success");
        setTimeout(() => { if (Range.isOpen()) Range.close(); }, CONFIG.autoClosePanelDelayMs);
        return;
      }
      const extendedEnd = Range.getExtendedEndTime(ssn, ea, dur);
      let et = extendedEnd !== null ? clamp(extendedEnd, st + 0.3, dur) : dur;
      state.range = { active: true, surah: ssn, endSurah: ssn, crossSurah: false, phase: "leg1", mode, startAyah: sa, endAyah: ea, startTime: st, endTime: et, _pendingMode: mode, estimated: !hasReal, openEnded: false, repeatCount: rc, repeatIndex: 0, sameSurah: false };
      state.currentTime = st; try { els.audio.currentTime = st; } catch(_){} state._restoredFromSaved = false;
      UI.updateRangeBadges(); UI.rangeMarkers(); UI.updateResumeCard(); UI.nowPlaying(); UI.phaseNotice(); saveSoon();
      if (!els.audio.paused) startRangeWatch();
      const rtxt = rc > 1 ? ` × ${rc} مرات` : "";
      const suf = hasReal ? "" : " (تقديري)";
      toast(`✅ النطاق: آية ${sa} → ${ea}${rtxt}${suf}`, "success");
      setTimeout(() => { if (Range.isOpen()) Range.close(); }, CONFIG.autoClosePanelDelayMs);
      return;
    }
    let h = els.rpDurHours.value.trim() === "" ? 0 : parseInt(els.rpDurHours.value, 10);
    let m = els.rpDurMinutes.value.trim() === "" ? 0 : parseInt(els.rpDurMinutes.value, 10);
    if (!isFinite(h)) h = 0; if (!isFinite(m)) m = 0; h = clamp(h, 0, 12); m = clamp(m, 0, 59);
    const ts = h * 3600 + m * 60; if (ts <= 0) { Range.showError(els.rpDurHoursCell, "⚠️ حدد مدة أكبر من صفر"); return; }
    const sd = Range.getAyahTime(ssn, sa, dur);
    let st = sd ? clamp(sd.startTime, 0, dur) : 0;
    const et = clamp(st + ts, st + 0.3, dur);
    state.range = { active: true, surah: ssn, endSurah: ssn, crossSurah: false, phase: "leg1", mode: "duration", startAyah: sa, endAyah: null, startTime: st, endTime: et, _pendingMode: "duration", estimated: !hasReal, openEnded: false, repeatCount: rc, repeatIndex: 0, sameSurah: false };
    state.currentTime = st; try { els.audio.currentTime = st; } catch(_){} state._restoredFromSaved = false;
    UI.updateRangeBadges(); UI.rangeMarkers(); UI.updateResumeCard(); UI.nowPlaying(); UI.phaseNotice(); saveSoon();
    if (!els.audio.paused) startRangeWatch();
    const parts = []; if (h) parts.push(`${h} ساعة`); if (m) parts.push(`${m} دقيقة`);
    const rtxt = rc > 1 ? ` × ${rc} مرات` : "";
    const suf = hasReal ? "" : " (تقديري)";
    toast(`✅ سيبدأ من آية ${sa} وينتهي بعد ${parts.join(" و ")}${rtxt}${suf}`, "success");
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
  _queue: [], _running: 0, _controllers: new Map(),
  _index: new Set(),
  isDownloading(key) { return this._controllers.has(key); },
  cancel(key) {
    const ctrl = this._controllers.get(key); if (!ctrl) return;
    ctrl.abort(); this._controllers.delete(key);
    this._queue = this._queue.filter(it => `${it.reciterId}-${it.surahNum}` !== key);
    const [r, s] = key.split("-").map(Number);
    const btn = cardEls.get(s)?.querySelector('[data-act="download"]');
    if (btn) { btn.classList.remove("downloading"); btn.classList.add("cancelled"); btn.innerHTML = `<span class="ring"></span><svg viewBox="0 0 24 24">${ICONS.x}</svg>`; setTimeout(() => { btn.classList.remove("cancelled"); btn.innerHTML = `<span class="ring"></span><svg viewBox="0 0 24 24">${ICONS.download}</svg>`; }, 1200); }
    const dlItem = els.dlList.querySelector(`.dl-item[data-key="${key}"]`);
    if (dlItem) { dlItem.classList.remove("downloading"); dlItem.classList.add("failed"); const small = dlItem.querySelector("small"); if (small) small.textContent = "✗ أُلغي"; }
    toast("تم إلغاء التحميل");
  },
 
   async loadFromIDB() {
    try {
      const meta = await IDB.getAllMeta();
      state.downloads = meta.map(r => ({ key: r.key, reciterId: r.reciterId, surahNum: r.surahNum, size: r.size || 0 }));
      Downloads._index.clear();
      for (const d of state.downloads) Downloads._index.add(`${d.reciterId}-${d.surahNum}`);
    } catch(_) { state.downloads = []; Downloads._index.clear(); }
  },
    isDownloaded(rid, sn) { return Downloads._index.has(`${rid}-${sn}`); },
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
      try {
        const reader = res.body.getReader(); const chunks = []; let received = 0;
        while (true) { const { done, value } = await reader.read(); if (done) break; if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError"); chunks.push(value); received += value.length; if (onProgress && total > 0) onProgress(received, total); }
        if (total > 0 && received < total * 0.98) throw new Error(`حجم ناقص: ${received}/${total}`);
        blob = new Blob(chunks, { type: "audio/mpeg" });
      } catch (readerErr) {
        if (readerErr.name === "AbortError") throw readerErr;
        const res2 = await fetch(url, { cache: "no-store", signal: controller.signal });
        if (!res2.ok) throw new Error("HTTP " + res2.status);
        blob = await res2.blob();
      }
      if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (!blob || blob.size === 0) throw new Error("ملف فارغ");
      if (onProgress) onProgress(blob.size, blob.size, false);

      // ⭐ Put blob + meta separately
      const rec = { key, reciterId: rid, surahNum: sn, blob, size: blob.size, timestamp: Date.now() };
            await IDB.put(rec);
      await IDB.putMeta({ key, reciterId: rid, surahNum: sn, size: blob.size, timestamp: Date.now() });
      state.downloads.push({ key, reciterId: rid, surahNum: sn, size: blob.size });
      Downloads._index.add(`${rid}-${sn}`);

          // ⭐ التوقيتات والنصوص بقت من ملفات ثابتة — مش محتاجين تحميل إضافي
      if (onProgress) onProgress(blob.size, blob.size, true);
      return true;
    } catch (e) { if (e.name === "AbortError") return false; if (onProgress) onProgress(0, 0, false, e); return false; }
    finally { Downloads._controllers.delete(key); }
  },
  async deleteOne(rid, sn) {
    const key = `${rid}-${sn}`;
    try { await IDB.delete(key); } catch(_){}
    try { await IDB.deleteMeta(key); } catch(_){}
       _blobUrlLRU.delete(key);
    state.downloads = state.downloads.filter(d => !(d.reciterId === rid && d.surahNum === sn));
    Downloads._index.delete(`${rid}-${sn}`);
       UI.updateDownloadedBadges(); UI.updateMobileValues();
    if (state.current === sn && state.reciterId === rid) {
      const wp = state._playIntent;
      const pos = els.audio.currentTime || 0;
      const src = getSurahUrl(rid, sn);
      try { els.audio.src = src; els.audio.load(); } catch(_){}
      els.audio.addEventListener("loadedmetadata", function once() { els.audio.removeEventListener("loadedmetadata", once); try { els.audio.currentTime = pos; } catch(_){} if (wp) Audio.play(); });
    }
  },
      async clearAll() {
    try { await IDB.clear(); } catch(_){}
    try { await IDB.clearMeta(); } catch(_){}
    _blobUrlLRU.clear();
    state.downloads = [];
    Downloads._index.clear();
    // ⭐ الداتا الثابتة (توقيتات + نصوص) تفضل
    UI.updateDownloadedBadges(); UI.updateMobileValues();
  },
  enqueue(items) { items.forEach(it => Downloads._queue.push(it)); Downloads.pump(); },
  pump() { while (Downloads._running < CONFIG.downloadConcurrency && Downloads._queue.length) { const it = Downloads._queue.shift(); Downloads._running++; Downloads.runTask(it).finally(() => { Downloads._running--; Downloads.pump(); }); } },
   async runTask({ reciterId, surahNum }) {
    const key = `${reciterId}-${surahNum}`;
    const btn = cardEls.get(surahNum)?.querySelector('[data-act="download"]');
    const btnPct = btn?.querySelector(".dl-mini-pct");
    const dlItem = els.dlList.querySelector(`.dl-item[data-key="${key}"]`);
    const dlProg = dlItem?.querySelector(".dl-progress i");
    const dlSmall = dlItem?.querySelector("small");
    if (btn) btn.classList.add("downloading");
    if (btnPct) btnPct.textContent = "0%";
    if (dlItem) dlItem.classList.add("downloading");
    if (dlSmall) dlSmall.textContent = "جاري...";
    const ok = await Downloads.downloadOne(reciterId, surahNum, {
      onProgress: (recv, total, done, err) => {
        if (err) {
          if (dlSmall) dlSmall.textContent = "✗ فشل";
          if (dlProg) { dlProg.style.width = "100%"; dlProg.style.background = "var(--rose)"; }
          if (btnPct) btnPct.textContent = "✗";
          return;
        }
        if (total > 0) {
          const pct = Math.min(100, Math.round((recv / total) * 100));
          if (dlProg) dlProg.style.width = pct + "%";
          if (dlSmall) dlSmall.textContent = done ? `✓ تم — ${fmtBytes(recv)}` : `جاري... ${pct}%`;
          if (btnPct) btnPct.textContent = pct + "%";
        } else {
          if (dlSmall) dlSmall.textContent = done ? `✓ تم — ${fmtBytes(recv)}` : "جاري...";
        }
      }
    });
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

const StoragePanel = {
  open() { StoragePanel.render(); openModal(els.storageOverlay); StoragePanel.refreshEstimate(); },
  close() { closeModal(els.storageOverlay); },
  async refreshEstimate() { if (!navigator.storage || !navigator.storage.estimate) { els.storageUsed.textContent = "—"; els.storageAvail.textContent = "—"; return; } try { const est = await navigator.storage.estimate(); const u = est.usage || 0, q = est.quota || 0; const pct = q > 0 ? Math.min(100, (u / q) * 100) : 0; els.storageBarFill.style.width = pct.toFixed(1) + "%"; els.storageUsed.textContent = fmtBytes(u); els.storageAvail.textContent = fmtBytes(Math.max(0, q - u)); } catch(_) { els.storageUsed.textContent = "—"; } },
   render() {
    const tot = state.downloads.reduce((a, d) => a + (d.size || 0), 0);
    const recs = new Set(state.downloads.map(d => d.reciterId));
    els.storageCount.textContent = state.downloads.length; els.storageReciters.textContent = recs.size; els.storageTotal.textContent = fmtBytes(tot);

    // ⭐ v34: عرض بيانات القرآن الكريم (توقيتات + نصوص) اللي نزلت أوتوماتيك
    let staticTimings = 0, staticTexts = 0;
    try {
      for (const rid of Object.keys(TimingsAPI.cache)) staticTimings += Object.keys(TimingsAPI.cache[rid]).length;
      staticTexts = TextAPI.cache.size;
    } catch(_) {}
    const staticInfo = document.getElementById('staticDataInfo');
    if (staticInfo) {
      staticInfo.innerHTML = `
        <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.5rem">
          <svg viewBox="0 0 24 24" style="width:1.1rem;height:1.1rem;color:var(--gold)"><path d="M12 2l1.9 5.8H20l-4.9 3.6 1.9 5.9L12 13.7l-5 3.6 1.9-5.9L4 7.8h6.1L12 2z"/></svg>
          <b style="font-size:.85rem">بيانات القرآن الكريم (تلقائية)</b>
        </div>
        <div class="storage-stats">
          <div class="storage-stat"><b>${staticTimings}</b><span>توقيتات قارئ</span></div>
          <div class="storage-stat"><b>${staticTexts}</b><span>نص سورة</span></div>
          <div class="storage-stat"><b>${CONFIG.reciters.length}</b><span>قراء</span></div>
        </div>
      `;
    }

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
   const onStart = (e) => {
    /* ⭐ v3.0.3: التنقل الحر مسموح — Range Requests شغالة */
    dragging = true; wasPlayingBeforeDrag = state._playIntent; els.seek.classList.add("dragging"); pendingRatio = ratioFromEvent(e); preview(pendingRatio); e.preventDefault();
  };  const onMove = (e) => { if (!dragging) return; pendingRatio = ratioFromEvent(e); preview(pendingRatio); };
   const onEnd = () => {
    if (!dragging) return; dragging = false; els.seek.classList.remove("dragging");
    const dur = els.audio.duration;
    if (isFinite(dur) && dur > 0) {
      const target = pendingRatio * dur;
      
      /* ⭐ v3.0.3: منع التنقل لمنطقة غير محمّلة بدون نت */
      if (!canSeekTo(target)) {
        toast("📴 هذا الجزء غير محمّل — لا يمكن التنقل بدون إنترنت", "error");
        /* ⭐ إرجاع الشريط لمكانه الأصلي */
        const curRatio = (els.audio.currentTime || 0) / dur;
        els.seekFill.style.transform = `scaleX(${curRatio})`;
        els.seekThumb.style.setProperty("--seek-x", (curRatio * 100).toFixed(3) + "%");
        els.timeCur.textContent = fmtTime(els.audio.currentTime || 0);
        return;
      }
      
      try { els.audio.currentTime = target; state.currentTime = target; } catch(_){}
      if (wasPlayingBeforeDrag && els.audio.paused) { state._playIntent = true; const p = els.audio.play(); if (p && p.catch) p.catch(() => {}); }
    } else if (state._lastKnownDuration > 0) { const target = pendingRatio * state._lastKnownDuration; state.currentTime = target; }
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
  if (!state.downloads.length) { toast("لا توجد بيانات"); return; }
  if (!confirm("سيتم حذف جميع السور المحمّلة. متأكد؟")) return;
  await Downloads.clearAll();
  StoragePanel.render();
  StoragePanel.refreshEstimate();
  Downloads.updateBadge();
  toast("تم المسح", "success");
});


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

els.playBtn.addEventListener("click", () => { if (!state.current) { Player.playSurah(1); return; } Audio.toggle(); });
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
    if (els.audio.currentTime >= state.range.endTime) { try { els.audio.pause(); } catch(_) {} try { els.audio.currentTime = state.range.endTime; } catch(_) {} handleRangeEnd(); return; }
  }
  Subtitle.update();
  if (!state._tabVisible) UI.progress();
});

els.audio.addEventListener("durationchange", () => { if (isFinite(els.audio.duration) && els.audio.duration > 0) state._lastKnownDuration = els.audio.duration; UI._markerRenderKey = null; UI.progress(); UI.rangeMarkers(); });
els.audio.addEventListener("play", () => {
  state._restoredFromSaved = false;
  UI.updatePlayingCard(); UI.updateResumeCard(); UI.updateQueuePlayButtons();
  if (state.range.active && !state.range.openEnded) startRangeWatch();
  Subtitle.onPlay();
  startRafLoop();
});
els.audio.addEventListener("playing", () => {
  if (state._buffering) { state._buffering = false; }
  if (!state.playing) { state.playing = true; }
  UI.nowPlaying();
  startRafLoop(); 
});
els.audio.addEventListener("waiting", () => {
  if (!state._buffering && state._playIntent) { state._buffering = true; UI.nowPlaying(); }
});
els.audio.addEventListener("stalled", () => {
  if (!state._buffering && state._playIntent) { state._buffering = true; UI.nowPlaying(); }
});
els.audio.addEventListener("canplay", () => {
  if (state._buffering && !state.playing) { /* لسه بنستنى playing */ }
});
els.audio.addEventListener("pause", () => {
  state.playing = false;
  state._buffering = false;
  stopRafLoop();
  UI.nowPlaying(); UI.updatePlayingCard(); UI.updateQueuePlayButtons(); stopRangeWatch();
  if (state.current && !_silentSwitch) { state.currentTime = els.audio.currentTime || 0; state._lastSavedTime = state.currentTime; Store.save(state); }
});
els.audio.addEventListener("ended", () => {
  if (state.range.active && state.range.crossSurah && state.range.phase === "leg1" && state.current === state.range.surah) { transitionToLeg2(); return; }
  if (state.range.active && state.range.crossSurah && state.range.phase === "leg2" && state.current === state.range.endSurah) { handleRangeEnd(); return; }
  if (state.range.active && !state.range.crossSurah && !state.range.openEnded && state.current === state.range.surah) { handleRangeEnd(); return; }
  if (state.repeat === "one" && state.current) { els.audio.currentTime = 0; Audio.play(); return; }
  Player.next();
});
els.audio.addEventListener("error", () => {
  if (_silentSwitch || !els.audio.src || !state.current) return;
  const err = els.audio.error;
  if (err && err.code === 4 && _audioLoadId === 0) return;
  
  /* ⭐ v3.0.3: عند انقطاع النت — وقف المحاولات + رسالة واضحة */
  if (!navigator.onLine) {
    try { els.audio.pause(); } catch(_){}
    state._buffering = false;
    UI.nowPlaying();
    const s = SURAH_MAP.get(state.current);
    toast(`📴 انقطع الاتصال — ${s ? s.nameAr : ""} متوقف`, "error");
    return;
  }
  
  const lock = _audioLoadId;
  setTimeout(() => { 
    if (_audioLoadId !== lock || _silentSwitch) return; 
    const s = SURAH_MAP.get(state.current); 
    if (!s) return; 
    toast(`تعذّر تشغيل ${s.nameAr}`, "error"); 
  }, 300);
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
   els.playBtn.disabled = true;   // ⭐ معطّل لحد ما الداتا تجهز
  await StaticDataLoader.init(); 

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
    const src = await resolveSurahSrc(state.reciterId, rn);
    if (state.current === rn) { try { els.audio.src = src; els.audio.load(); } catch(_){} }
       if (state.currentTime > 1) state._restoredFromSaved = true;
    TextAPI.fetch(rn).catch(() => {});
    if (!TimingsAPI.has(state.reciterId, rn)) { TimingsAPI.fetch(state.reciterId, rn).catch(() => {}); }
    UI.updatePlayingCard(); UI.updateResumeCard(); Range.syncUI(); UI.nowPlaying(); UI.phaseNotice(); UI.updateQueuePlayButtons();
  } else { state._restoredFromSaved = false; UI.nowPlaying(); }

  setTimeout(() => { if (state._restoredFromSaved) toast(`▶ جاهز للاستئناف`, "success"); else toast(`جاهز ✓`, "success"); }, 800);

 

    window.addEventListener("online", () => {
    toast("🌐 عاد الاتصال", "info");
    Subtitle._failedMap.clear();
    setTimeout(() => OfflineResume.restore("online"), 200);
  });

  window.addEventListener("offline", () => {
    const dc = state.downloads.filter(d => d.reciterId === state.reciterId).length;
    if (dc > 0) toast(`📴 ${dc} سورة محمّلة تعمل بدون إنترنت`, "success");
    else toast("📴 انقطع الاتصال", "info");
  });

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
    }
  });

  window.addEventListener("pagehide", () => { stopRafLoop(); if (state.current) { state.currentTime = els.audio.currentTime || 0; Store.save(state); } });
  window.addEventListener("beforeunload", () => { stopRafLoop(); if (state.current) { state.currentTime = els.audio.currentTime || 0; Store.save(state); } });
}

function safeSave() { if (!state.current) return; const now = els.audio.currentTime || 0; if (Math.abs(now - state._lastSavedTime) < CONFIG.SAVE_DELTA_SEC) return; state.currentTime = now; state._lastSavedTime = now; Store.save(state); }

init();
})();