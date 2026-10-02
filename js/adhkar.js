/* ═══════════════════════════════════════════════════════════════════════
   ADHKAR — أذكار المسلم (v2 — أداء عالي + صفر DOM churn)
   - البناء مرة واحدة فقط
   - إغلاق بـ display:none بعد الأنيميشن (تحرير الـ GPU)
   - تحديث العناصر فقط (مش إعادة بناء)
   ═══════════════════════════════════════════════════════════════════════ */
(function(){
"use strict";
if (window.Adhkar) return;

/* ═══ ICONS ═══ */
const ICON = {
  close:   'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  back:    'M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z',
  search:  'M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z',
  reset:   'M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z',
  check:   'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  plus:    'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
  copy:    'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z',
  book:    'M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-5 6h-2v2h2v2h-2v2h2v2h-2v2H9v-2H7v-2h2v-2H7v-2h2V8H7V6h2V4h2v2h2v2z',
  star:    'M12 2l1.9 5.8H20l-4.9 3.6 1.9 5.9L12 13.7l-5 3.6 1.9-5.9L4 7.8h6.1L12 2z',
   chevron: 'M7 10l5 5 5-5z',
  edit:    'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z'
};
const svg = (d, attrs='') => `<svg viewBox="0 0 24 24" fill="currentColor" ${attrs}><path d="${d}"/></svg>`;

/* ═══ DATA ═══ */
const KURSI = 'اللَّهُ لَا إِلَٰهَ إِلَّا هُوَ الْحَيُّ الْقَيُّومُ ۚ لَا تَأْخُذُهُ سِنَةٌ وَلَا نَوْمٌ ۚ لَهُ مَا فِي السَّمَاوَاتِ وَمَا فِي الْأَرْضِ ۗ مَنْ ذَا الَّذِي يَشْفَعُ عِنْدَهُ إِلَّا بِإِذْنِهِ ۚ يَعْلَمُ مَا بَيْنَ أَيْدِيهِمْ وَمَا خَلْفَهُمْ ۖ وَلَا يُحِيطُونَ بِشَيْءٍ مِنْ عِلْمِهِ إِلَّا بِمَا شَاءَ ۚ وَسِعَ كُرْسِيُّهُ السَّمَاوَاتِ وَالْأَرْضَ ۖ وَلَا يَئُودُهُ حِفْظُهُمَا ۚ وَهُوَ الْعَلِيُّ الْعَظِيمُ';
const IKHLAS = 'قُلْ هُوَ اللَّهُ أَحَدٌ ۝ اللَّهُ الصَّمَدُ ۝ لَمْ يَلِدْ وَلَمْ يُولَدْ ۝ وَلَمْ يَكُنْ لَهُ كُفُوًا أَحَدٌ';
const FALAQ  = 'قُلْ أَعُوذُ بِرَبِّ الْفَلَقِ ۝ مِنْ شَرِّ مَا خَلَقَ ۝ وَمِنْ شَرِّ غَاسِقٍ إِذَا وَقَبَ ۝ وَمِنْ شَرِّ النَّفَّاثَاتِ فِي الْعُقَدِ ۝ وَمِنْ شَرِّ حَاسِدٍ إِذَا حَسَدَ';
const NAS    = 'قُلْ أَعُوذُ بِرَبِّ النَّاسِ ۝ مَلِكِ النَّاسِ ۝ إِلَٰهِ النَّاسِ ۝ مِنْ شَرِّ الْوَسْوَاسِ الْخَنَّاسِ ۝ الَّذِي يُوَسْوِسُ فِي صُدُورِ النَّاسِ ۝ مِنَ الْجِنَّةِ وَالنَّاسِ';

const DATA = [
 {id:'prayer',cat:'الصلاة على النبي ﷺ',emoji:'ﷺ',title:'الصلاة على النبي ﷺ',type:'prayer',count:10},
  {id:'w1',cat:'الاستيقاظ',emoji:'⏰',title:'الحمد لله الذي أحيانا',text:'الْحَمْدُ لِلَّهِ الَّذِي أَحْيَانَا بَعْدَ مَا أَمَاتَنَا وَإِلَيْهِ النُّشُورُ',type:'hadith',count:1,source:'البخاري · 6312'},
  {id:'w2',cat:'الاستيقاظ',emoji:'⏰',title:'دعاء الاستيقاظ الكامل',text:'لَا إِلَٰهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ، لَهُ الْمُلْكُ وَلَهُ الْحَمْدُ، وَهُوَ عَلَىٰ كُلِّ شَيْءٍ قَدِيرٌ، سُبْحَانَ اللَّهِ، وَالْحَمْدُ لِلَّهِ، وَلَا إِلَٰهَ إِلَّا اللَّهُ، وَاللَّهُ أَكْبَرُ، وَلَا حَوْلَ وَلَا قُوَّةَ إِلَّا بِاللَّهِ الْعَلِيِّ الْعَظِيمِ، رَبِّ اغْفِرْ لِي',type:'hadith',count:1,source:'البخاري · 6311'},
  {id:'s1',cat:'الصباح',emoji:'🌅',title:'آية الكرسي',text:KURSI,type:'quran',count:1,source:'البقرة: 255'},
  {id:'s2',cat:'الصباح',emoji:'🌅',title:'سورة الإخلاص',text:IKHLAS,type:'quran',count:3,source:'أبو داود'},
  {id:'s3',cat:'الصباح',emoji:'🌅',title:'سورة الفلق',text:FALAQ,type:'quran',count:3,source:'أبو داود'},
  {id:'s4',cat:'الصباح',emoji:'🌅',title:'سورة الناس',text:NAS,type:'quran',count:3,source:'أبو داود'},
  {id:'s5',cat:'الصباح',emoji:'🌅',title:'سيد الاستغفار',text:'اللَّهُمَّ أَنْتَ رَبِّي لَا إِلَٰهَ إِلَّا أَنْتَ، خَلَقْتَنِي وَأَنَا عَبْدُكَ، وَأَنَا عَلَىٰ عَهْدِكَ وَوَعْدِكَ مَا اسْتَطَعْتُ، أَعُوذُ بِكَ مِنْ شَرِّ مَا صَنَعْتُ، أَبُوءُ لَكَ بِنِعْمَتِكَ عَلَيَّ، وَأَبُوءُ بِذَنْبِي فَاغْفِرْ لِي',type:'hadith',count:1,source:'البخاري · 6306'},
  {id:'s6',cat:'الصباح',emoji:'🌅',title:'أصبحنا وأصبح الملك لله',text:'أَصْبَحْنَا وَأَصْبَحَ الْمُلْكُ لِلَّهِ، وَالْحَمْدُ لِلَّهِ، لَا إِلَٰهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ',type:'hadith',count:1,source:'مسلم · 2723'},
  {id:'s7',cat:'الصباح',emoji:'🌅',title:'اللهم بك أصبحنا',text:'اللَّهُمَّ بِكَ أَصْبَحْنَا، وَبِكَ أَمْسَيْنَا، وَبِكَ نَحْيَا، وَبِكَ نَمُوتُ، وَإِلَيْكَ النُّشُورُ',type:'hadith',count:1,source:'أبو داود · 5068'},
  {id:'s8',cat:'الصباح',emoji:'🌅',title:'بسم الله الذي لا يضر',text:'بِسْمِ اللَّهِ الَّذِي لَا يَضُرُّ مَعَ اسْمِهِ شَيْءٌ فِي الْأَرْضِ وَلَا فِي السَّمَاءِ وَهُوَ السَّمِيعُ الْعَلِيمُ',type:'hadith',count:3,source:'أبو داود · 5088'},
  {id:'s9',cat:'الصباح',emoji:'🌅',title:'رضيت بالله ربا',text:'رَضِيتُ بِاللَّهِ رَبًّا، وَبِالْإِسْلَامِ دِينًا، وَبِمُحَمَّدٍ ﷺ نَبِيًّا',type:'hadith',count:3,source:'أبو داود · 5072'},
  {id:'s10',cat:'الصباح',emoji:'🌅',title:'اللهم عافني',text:'اللَّهُمَّ عَافِنِي فِي بَدَنِي، اللَّهُمَّ عَافِنِي فِي سَمْعِي، اللَّهُمَّ عَافِنِي فِي بَصَرِي، لَا إِلَٰهَ إِلَّا أَنْتَ',type:'hadith',count:3,source:'أبو داود · 5090'},
  {id:'s11',cat:'الصباح',emoji:'🌅',title:'حسبي الله',text:'حَسْبِيَ اللَّهُ لَا إِلَٰهَ إِلَّا هُوَ، عَلَيْهِ تَوَكَّلْتُ، وَهُوَ رَبُّ الْعَرْشِ الْعَظِيمِ',type:'hadith',count:7,source:'أبو داود'},
  {id:'s12',cat:'الصباح',emoji:'🌅',title:'سبحان الله وبحمده (١٠٠)',text:'سُبْحَانَ اللَّهِ وَبِحَمْدِهِ',type:'hadith',count:100,source:'مسلم · 2692'},
  {id:'s13',cat:'الصباح',emoji:'🌅',title:'لا إله إلا الله وحده (١٠)',text:'لَا إِلَٰهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ، لَهُ الْمُلْكُ وَلَهُ الْحَمْدُ، وَهُوَ عَلَىٰ كُلِّ شَيْءٍ قَدِيرٌ',type:'hadith',count:10,source:'النسائي'},
  {id:'m1',cat:'المساء',emoji:'🌙',title:'آية الكرسي',text:KURSI,type:'quran',count:1,source:'البقرة: 255'},
  {id:'m2',cat:'المساء',emoji:'🌙',title:'سورة الإخلاص',text:IKHLAS,type:'quran',count:3,source:'أبو داود'},
  {id:'m3',cat:'المساء',emoji:'🌙',title:'سورة الفلق',text:FALAQ,type:'quran',count:3,source:'أبو داود'},
  {id:'m4',cat:'المساء',emoji:'🌙',title:'سورة الناس',text:NAS,type:'quran',count:3,source:'أبو داود'},
  {id:'m5',cat:'المساء',emoji:'🌙',title:'سيد الاستغفار',text:'اللَّهُمَّ أَنْتَ رَبِّي لَا إِلَٰهَ إِلَّا أَنْتَ، خَلَقْتَنِي وَأَنَا عَبْدُكَ',type:'hadith',count:1,source:'البخاري · 6306'},
  {id:'m6',cat:'المساء',emoji:'🌙',title:'أمسينا وأمسى الملك لله',text:'أَمْسَيْنَا وَأَمْسَى الْمُلْكُ لِلَّهِ، وَالْحَمْدُ لِلَّهِ، لَا إِلَٰهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ',type:'hadith',count:1,source:'مسلم · 2723'},
  {id:'m7',cat:'المساء',emoji:'🌙',title:'بسم الله الذي لا يضر',text:'بِسْمِ اللَّهِ الَّذِي لَا يَضُرُّ مَعَ اسْمِهِ شَيْءٌ فِي الْأَرْضِ وَلَا فِي السَّمَاءِ',type:'hadith',count:3,source:'أبو داود · 5088'},
  {id:'m8',cat:'المساء',emoji:'🌙',title:'أعوذ بكلمات الله',text:'أَعُوذُ بِكَلِمَاتِ اللَّهِ التَّامَّاتِ مِنْ شَرِّ مَا خَلَقَ',type:'hadith',count:3,source:'مسلم · 2708'},
  {id:'m9',cat:'المساء',emoji:'🌙',title:'حسبي الله',text:'حَسْبِيَ اللَّهُ لَا إِلَٰهَ إِلَّا هُوَ، عَلَيْهِ تَوَكَّلْتُ، وَهُوَ رَبُّ الْعَرْشِ الْعَظِيمِ',type:'hadith',count:7,source:'أبو داود'},
  {id:'m10',cat:'المساء',emoji:'🌙',title:'سبحان الله وبحمده (١٠٠)',text:'سُبْحَانَ اللَّهِ وَبِحَمْدِهِ',type:'hadith',count:100,source:'مسلم · 2692'},
  {id:'n1',cat:'النوم',emoji:'🛏️',title:'اقرأ سورة الملك',action:'اقرأ سورة الملك',actionSub:'سورة الملك (المُنجية) — تُقرأ كل ليلة قبل النوم',type:'action',count:1,source:'الترمذي · 2891'},
  {id:'n2',cat:'النوم',emoji:'🛏️',title:'آية الكرسي',text:KURSI,type:'quran',count:1,source:'البخاري · 2311'},
  {id:'n3',cat:'النوم',emoji:'🛏️',title:'الإخلاص والفلق والناس',text:IKHLAS+'\n\n'+FALAQ+'\n\n'+NAS,type:'quran',count:3,source:'البخاري · 5017'},
  {id:'n4',cat:'النوم',emoji:'🛏️',title:'باسمك اللهم أموت وأحيا',text:'بِاسْمِكَ اللَّهُمَّ أَمُوتُ وَأَحْيَا',type:'hadith',count:1,source:'البخاري · 6324'},
  {id:'n5',cat:'النوم',emoji:'🛏️',title:'سبحان الله (٣٣)',text:'سُبْحَانَ اللَّهِ',type:'hadith',count:33,source:'البخاري · 6318'},
  {id:'n6',cat:'النوم',emoji:'🛏️',title:'الحمد لله (٣٣)',text:'الْحَمْدُ لِلَّهِ',type:'hadith',count:33,source:'البخاري · 6318'},
  {id:'n7',cat:'النوم',emoji:'🛏️',title:'الله أكبر (٣٤)',text:'اللَّهُ أَكْبَرُ',type:'hadith',count:34,source:'البخاري · 6318'},
  {id:'wd1',cat:'الوضوء',emoji:'💧',title:'قبل الوضوء',text:'بِسْمِ اللَّهِ',type:'hadith',count:1,source:'أبو داود · 101'},
  {id:'wd2',cat:'الوضوء',emoji:'💧',title:'بعد الوضوء',text:'أَشْهَدُ أَنْ لَا إِلَٰهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ، وَأَشْهَدُ أَنَّ مُحَمَّدًا عَبْدُهُ وَرَسُولُهُ',type:'hadith',count:1,source:'مسلم · 234'},
  {id:'ms1',cat:'المسجد',emoji:'🕌',title:'دعاء دخول المسجد',text:'اللَّهُمَّ افْتَحْ لِي أَبْوَابَ رَحْمَتِكَ',type:'hadith',count:1,source:'مسلم · 713'},
  {id:'ms2',cat:'المسجد',emoji:'🕌',title:'دعاء الخروج من المسجد',text:'اللَّهُمَّ إِنِّي أَسْأَلُكَ مِنْ فَضْلِكَ',type:'hadith',count:1,source:'ابن ماجه · 773'},
  {id:'p1',cat:'بعد الصلاة',emoji:'🤲',title:'أستغفر الله',text:'أَسْتَغْفِرُ اللَّهَ',type:'hadith',count:3,source:'مسلم · 591'},
  {id:'p2',cat:'بعد الصلاة',emoji:'🤲',title:'اللهم أنت السلام',text:'اللَّهُمَّ أَنْتَ السَّلَامُ وَمِنْكَ السَّلَامُ، تَبَارَكْتَ يَا ذَا الْجَلَالِ وَالْإِكْرَامِ',type:'hadith',count:1,source:'مسلم · 591'},
  {id:'p3',cat:'بعد الصلاة',emoji:'🤲',title:'اللهم أجرني من النار',text:'اللَّهُمَّ أَجِرْنِي مِنَ النَّارِ',type:'hadith',count:7,source:'أبو داود · 792'},
  {id:'p4',cat:'بعد الصلاة',emoji:'🤲',title:'سبحان الله (٣٣)',text:'سُبْحَانَ اللَّهِ',type:'hadith',count:33,source:'مسلم · 597'},
  {id:'p5',cat:'بعد الصلاة',emoji:'🤲',title:'الحمد لله (٣٣)',text:'الْحَمْدُ لِلَّهِ',type:'hadith',count:33,source:'مسلم · 597'},
  {id:'p6',cat:'بعد الصلاة',emoji:'🤲',title:'الله أكبر (٣٣)',text:'اللَّهُ أَكْبَرُ',type:'hadith',count:33,source:'مسلم · 597'},
  {id:'p7',cat:'بعد الصلاة',emoji:'🤲',title:'آية الكرسي',text:KURSI,type:'quran',count:1,source:'النسائي'},
  {id:'f1',cat:'الطعام',emoji:'🍽️',title:'قبل الطعام',text:'بِسْمِ اللَّهِ',type:'hadith',count:1,source:'أبو داود · 3767'},
  {id:'f2',cat:'الطعام',emoji:'🍽️',title:'بعد الطعام',text:'الْحَمْدُ لِلَّهِ الَّذِي أَطْعَمَنِي هَذَا وَرَزَقَنِيهِ مِنْ غَيْرِ حَوْلٍ مِنِّي وَلَا قُوَّةٍ',type:'hadith',count:1,source:'أبو داود · 4023'},
  {id:'h1',cat:'المنزل',emoji:'🏠',title:'دخول المنزل',text:'بِسْمِ اللَّهِ وَلَجْنَا، وَبِسْمِ اللَّهِ خَرَجْنَا، وَعَلَىٰ رَبِّنَا تَوَكَّلْنَا',type:'hadith',count:1,source:'أبو داود · 5096'},
  {id:'h2',cat:'المنزل',emoji:'🏠',title:'الخروج من المنزل',text:'بِسْمِ اللَّهِ، تَوَكَّلْتُ عَلَى اللَّهِ، وَلَا حَوْلَ وَلَا قُوَّةَ إِلَّا بِاللَّهِ',type:'hadith',count:1,source:'أبو داود · 5095'},
  {id:'tr1',cat:'السفر',emoji:'✈️',title:'دعاء السفر',text:'اللَّهُ أَكْبَرُ، اللَّهُ أَكْبَرُ، اللَّهُ أَكْبَرُ، سُبْحَانَ الَّذِي سَخَّرَ لَنَا هَذَا وَمَا كُنَّا لَهُ مُقْرِنِينَ، وَإِنَّا إِلَىٰ رَبِّنَا لَمُنْقَلِبُونَ',type:'hadith',count:1,source:'مسلم · 1342'},
  {id:'tr2',cat:'السفر',emoji:'✈️',title:'دعاء الرجوع',text:'آيِبُونَ، تَائِبُونَ، عَابِدُونَ، لِرَبِّنَا حَامِدُونَ',type:'hadith',count:1,source:'مسلم · 1344'},
  {id:'il1',cat:'المرض والرقية',emoji:'💊',title:'أسأل الله العظيم أن يشفيك',text:'أَسْأَلُ اللَّهَ الْعَظِيمَ رَبَّ الْعَرْشِ الْعَظِيمِ أَنْ يَشْفِيَكَ',type:'hadith',count:7,source:'الترمذي · 2083'},
  {id:'il2',cat:'المرض والرقية',emoji:'💊',title:'الرقية بالمعوذات',text:IKHLAS+'\n\n'+FALAQ+'\n\n'+NAS,type:'quran',count:3,source:'البخاري · 5017'},
  {id:'hm1',cat:'الهم والحزن',emoji:'💭',title:'لا إله إلا الله العظيم الحليم',text:'لَا إِلَٰهَ إِلَّا اللَّهُ الْعَظِيمُ الْحَلِيمُ، لَا إِلَٰهَ إِلَّا اللَّهُ رَبُّ الْعَرْشِ الْعَظِيمِ',type:'hadith',count:1,source:'البخاري · 6346'},
  {id:'hm2',cat:'الهم والحزن',emoji:'💭',title:'اللهم إني أعوذ بك من الهم',text:'اللَّهُمَّ إِنِّي أَعُوذُ بِكَ مِنَ الْهَمِّ وَالْحَزَنِ، وَالْعَجْزِ وَالْكَسَلِ، وَالْبُخْلِ وَالْجُبْنِ، وَضَلَعِ الدَّيْنِ وَغَلَبَةِ الرِّجَالِ',type:'hadith',count:1,source:'البخاري · 2893'},
  {id:'ts1',cat:'تسبيحات',emoji:'📿',title:'سبحان الله وبحمده (١٠٠)',text:'سُبْحَانَ اللَّهِ وَبِحَمْدِهِ',type:'hadith',count:100,source:'مسلم · 2691'},
  {id:'ts2',cat:'تسبيحات',emoji:'📿',title:'لا إله إلا الله وحده (١٠٠)',text:'لَا إِلَٰهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ',type:'hadith',count:100,source:'البخاري · 3293'},
  {id:'ts3',cat:'تسبيحات',emoji:'📿',title:'لا حول ولا قوة إلا بالله',text:'لَا حَوْلَ وَلَا قُوَّةَ إِلَّا بِاللَّهِ',type:'hadith',count:10,source:'البخاري · 6384'},
  {id:'q1',cat:'سور يومية',emoji:'📖',title:'سورة الكهف (الجمعة)',action:'اقرأ سورة الكهف',actionSub:'مَن قرأ سورة الكهف يوم الجمعة أضاء له من النور ما بين الجمعتين',type:'action',count:1,source:'الحاكم'},
  {id:'q2',cat:'سور يومية',emoji:'📖',title:'سورة الملك (كل ليلة)',action:'اقرأ سورة الملك',actionSub:'سورة تمنع صاحبها من عذاب القبر',type:'action',count:1,source:'الترمذي · 2891'},
  {id:'q3',cat:'سور يومية',emoji:'📖',title:'سورة السجدة (كل ليلة)',action:'اقرأ سورة السجدة',actionSub:'كان النبي ﷺ لا ينام حتى يقرأ السجدة والملك',type:'action',count:1,source:'الترمذي · 3404'},
  {id:'msc1',cat:'متفرقات',emoji:'✨',title:'دخول الخلاء',text:'اللَّهُمَّ إِنِّي أَعُوذُ بِكَ مِنَ الْخُبُثِ وَالْخَبَائِثِ',type:'hadith',count:1,source:'البخاري · 142'},
  {id:'msc2',cat:'متفرقات',emoji:'✨',title:'الخروج من الخلاء',text:'غُفْرَانَكَ',type:'hadith',count:1,source:'أبو داود · 30'},
  {id:'msc3',cat:'متفرقات',emoji:'✨',title:'دعاء الريح',text:'اللَّهُمَّ إِنِّي أَسْأَلُكَ خَيْرَهَا، وَخَيْرَ مَا فِيهَا، وَخَيْرَ مَا أُرْسِلَتْ بِهِ',type:'hadith',count:1,source:'مسلم · 899'},
  {id:'msc4',cat:'متفرقات',emoji:'✨',title:'دعاء عند المطر',text:'اللَّهُمَّ صَيِّبًا نَافِعًا',type:'hadith',count:1,source:'البخاري · 1032'},
  {id:'msc5',cat:'متفرقات',emoji:'✨',title:'دعاء دخول السوق',text:'لَا إِلَٰهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ، لَهُ الْمُلْكُ وَلَهُ الْحَمْدُ، يُحْيِي وَيُمِيتُ وَهُوَ حَيٌّ لَا يَمُوتُ',type:'hadith',count:1,source:'الترمذي · 3428'}
];

/* ═══ Pre-computed indexes (مرة واحدة فقط) ═══ */
const DATA_BY_ID = Object.create(null);
const CATEGORIES = [];
{
  const catMap = new Map();
  for (const a of DATA) {
    DATA_BY_ID[a.id] = a;
    let c = catMap.get(a.cat);
    if (!c) { c = { name: a.cat, emoji: a.emoji, items: [] }; catMap.set(a.cat, c); CATEGORIES.push(c); }
    c.items.push(a);
  }
}

/* ═══ Text helpers ═══ */
const escHtml = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normAr = (s) => String(s)
  .replace(/[\u064B-\u0652\u0670\u0640]/g, '')
  .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي')
  .replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').toLowerCase();

const SEARCH_INDEX = DATA.map(a => ({
  ref: a,
  n: normAr(`${a.title} ${a.text || ''} ${a.action || ''} ${a.actionSub || ''} ${a.source} ${a.cat}`)
}));


const PRAYER_KEY = 'quran-adhkar-prayer-v1';
const PRAYER_DEFAULT_TEXT = 'اللَّهُمَّ صَلِّ عَلَى مُحَمَّدٍ وَعَلَى آلِ مُحَمَّدٍ، كَمَا صَلَّيْتَ عَلَى إِبْرَاهِيمَ وَعَلَى آلِ إِبْرَاهِيمَ، إِنَّكَ حَمِيدٌ مَجِيدٌ، اللَّهُمَّ بَارِكْ عَلَى مُحَمَّدٍ وَعَلَى آلِ مُحَمَّدٍ، كَمَا بَارَكْتَ عَلَى إِبْرَاهِيمَ وَعَلَى آلِ إِبْرَاهِيمَ، إِنَّكَ حَمِيدٌ مَجِيدٌ';
const PRAYER_DEFAULT_TARGET = 10;

function loadPrayer() {
  try {
    const raw = localStorage.getItem(PRAYER_KEY);
    if (!raw) return { text: PRAYER_DEFAULT_TEXT, target: PRAYER_DEFAULT_TARGET };
    const p = JSON.parse(raw);
    return {
      text: (typeof p.text === 'string' && p.text.trim()) ? p.text : PRAYER_DEFAULT_TEXT,
      target: (Number.isInteger(p.target) && p.target >= 1 && p.target <= 1000) ? p.target : PRAYER_DEFAULT_TARGET
    };
  } catch(_) {
    return { text: PRAYER_DEFAULT_TEXT, target: PRAYER_DEFAULT_TARGET };
  }
}

function savePrayer(p) {
  try {
    localStorage.setItem(PRAYER_KEY, JSON.stringify({ text: p.text, target: p.target }));
  } catch(_) {}
}

/* ═══ State ═══ */
const S = {
  built: false,
  search: '',
  expanded: new Set(),
  completed: new Set(),
  sessionCounts: {},
  detailId: null,
  hideTimer: 0
};

/* ═══ DOM refs (تُبنى مرة واحدة) ═══ */
let elPanel, elBackdrop, elBody, elSearch, elSearchInput, elClearBtn;
let elDetail, elDetailBody, elDetailTitle;
let elToast, elToastMsg;

/* ═══ Toast ═══ */
let toastTimer = 0;
function toast(msg) {
  if (!elToast) return;
  elToastMsg.textContent = msg;
  elToast.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elToast.classList.remove('on'), 1600);
}

/* ═══ Build DOM (مرة واحدة) ═══ */
function build() {
  if (S.built) return;

  const root = document.createElement('div');
  root.id = 'adRoot';
  root.innerHTML = `
    <div class="ad-backdrop" id="adBackdrop"></div>
    <div class="ad-panel" id="adPanel" role="dialog" aria-modal="true" aria-hidden="true">
      <div class="ad-head">
        <button class="ad-icon-btn" id="adCloseBtn" type="button" aria-label="إغلاق">${svg(ICON.close)}</button>
        <div class="ad-head-title">${svg(ICON.star)}<h3>أذكار المسلم<small id="adCount"></small></h3></div>
        <button class="ad-icon-btn" id="adResetBtn" type="button" aria-label="تصفير">${svg(ICON.reset)}</button>
      </div>
      <div class="ad-search-wrap">
        <div class="ad-search" id="adSearchBox">
          ${svg(ICON.search)}
          <input type="text" id="adSearchInput" placeholder="ابحث في الأذكار..." autocomplete="off" spellcheck="false" inputmode="search">
          <button class="ad-clear-btn" id="adClearSearch" type="button" aria-label="مسح">${svg(ICON.close)}</button>
        </div>
      </div>
      <div class="ad-body" id="adBody"></div>
      <div class="ad-detail" id="adDetail" aria-hidden="true">
        <div class="ad-detail-head">
          <button class="ad-icon-btn" id="adDetailBack" type="button" aria-label="رجوع">${svg(ICON.back, 'style="transform:scaleX(-1)"')}</button>
          <div class="ad-detail-title" id="adDetailTitle">—</div>
          <button class="ad-icon-btn" id="adDetailCopyTop" type="button" aria-label="نسخ">${svg(ICON.copy)}</button>
        </div>
        <div class="ad-detail-body" id="adDetailBody"></div>
      </div>
    </div>
        <div class="ad-toast" id="adToast"><span id="adToastMsg"></span></div>
    <div class="ad-edit-modal" id="adEditModal">
      <div class="ad-edit-box">
        <div class="ad-edit-title">${svg(ICON.edit)}<span id="adEditTitle">تعديل</span></div>
        <textarea class="ad-edit-textarea" id="adEditTextarea" spellcheck="false"></textarea>
        <input type="number" class="ad-edit-input" id="adEditNumber" min="1" max="1000" inputmode="numeric" />
        <div class="ad-edit-actions">
          <button class="ad-edit-btn cancel" id="adEditCancel" type="button">إلغاء</button>
          <button class="ad-edit-btn save" id="adEditSave" type="button">حفظ</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  /* Cache refs */
  elPanel        = document.getElementById('adPanel');
  elBackdrop     = document.getElementById('adBackdrop');
  elBody         = document.getElementById('adBody');
  elSearch       = document.getElementById('adSearchBox');
  elSearchInput  = document.getElementById('adSearchInput');
  elClearBtn     = document.getElementById('adClearSearch');
  elDetail       = document.getElementById('adDetail');
  elDetailBody   = document.getElementById('adDetailBody');
  elDetailTitle  = document.getElementById('adDetailTitle');
  elToast        = document.getElementById('adToast');
  elToastMsg     = document.getElementById('adToastMsg');

  document.getElementById('adCount').textContent = `${DATA.length} ذكر · ${CATEGORIES.length} أقسام`;

  /* Wire events — مرة واحدة فقط */
  document.getElementById('adCloseBtn').addEventListener('click', close);
  elBackdrop.addEventListener('click', close);
  document.getElementById('adDetailBack').addEventListener('click', closeDetail);
  document.getElementById('adDetailCopyTop').addEventListener('click', copyCurrent);
    document.getElementById('adResetBtn').addEventListener('click', resetAll);
  document.getElementById('adEditCancel').addEventListener('click', closePrayerEditor);
  document.getElementById('adEditSave').addEventListener('click', savePrayerEditor);
  document.getElementById('adEditModal').addEventListener('click', (e) => {
    if (e.target.id === 'adEditModal') closePrayerEditor();
  });

  /* Search — debounce بسيط */
  let searchTimer = 0;
  elSearchInput.addEventListener('input', (e) => {
    const v = e.target.value;
    elSearch.classList.toggle('has-text', v.length > 0);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { S.search = v; renderList(); }, 140);
  });
  elClearBtn.addEventListener('click', () => {
    elSearchInput.value = '';
    elSearch.classList.remove('has-text');
    S.search = '';
    renderList();
    elSearchInput.focus();
  });

  /* Delegation واحدة للكل */
  elBody.addEventListener('click', (e) => {
    const h = e.target.closest('.ad-group-head');
    if (h) {
      if (S.search.trim()) return;
      const g = h.parentElement;
      g.classList.toggle('expanded');
      const c = g.dataset.cat;
      if (g.classList.contains('expanded')) S.expanded.add(c);
      else S.expanded.delete(c);
      return;
    }
    const it = e.target.closest('.ad-item');
    if (it) openDetail(it.dataset.id);
  });

  /* Escape */
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!elPanel.classList.contains('on')) return;
    if (elDetail.classList.contains('on')) { closeDetail(); return; }
    close();
  });

  /* بناء الليستة مرة واحدة */
  renderList();
  S.built = true;
}

/* ═══ Render ═══ */
function renderList() {
  const q = normAr(S.search.trim());

  if (q) {
    /* بحث — عرض مسطح مقسم بمجموعات */
    const groups = new Map();
    for (const x of SEARCH_INDEX) {
      if (!x.n.includes(q)) continue;
      const cat = x.ref.cat;
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat).push(x.ref);
    }
    if (!groups.size) {
      elBody.innerHTML = `<div class="ad-empty">${svg(ICON.search)}<p>لا توجد نتائج لـ <b>"${escHtml(S.search)}"</b></p></div>`;
      return;
    }
    let html = '';
    for (const [catName, items] of groups) {
      const cat = CATEGORIES.find(c => c.name === catName);
      html += `<div class="ad-group expanded" data-cat="${escHtml(catName)}">
        <button class="ad-group-head" type="button">
          <span class="ad-group-emoji">${cat.emoji}</span>
          <span class="ad-group-name">${escHtml(catName)}</span>
          <span class="ad-group-count">${items.length}</span>
          ${svg(ICON.chevron, 'class="ad-group-chevron"')}
        </button>
        <div class="ad-group-body">${items.map(itemHTML).join('')}</div>
      </div>`;
    }
    elBody.innerHTML = html;
    return;
  }

  /* العرض العادي */
  let html = '';
  for (const cat of CATEGORIES) {
    const ex = S.expanded.has(cat.name);
    html += `<div class="ad-group ${ex ? 'expanded' : ''}" data-cat="${escHtml(cat.name)}">
      <button class="ad-group-head" type="button">
        <span class="ad-group-emoji">${cat.emoji}</span>
        <span class="ad-group-name">${escHtml(cat.name)}</span>
        <span class="ad-group-count">${cat.items.length}</span>
        ${svg(ICON.chevron, 'class="ad-group-chevron"')}
      </button>
      <div class="ad-group-body">${cat.items.map(itemHTML).join('')}</div>
    </div>`;
  }
  elBody.innerHTML = html;
}

function itemHTML(a) {
  const done = S.completed.has(a.id);
  const s = S.sessionCounts[a.id] || 0;
  if (a.type === 'prayer') {
    const pr = loadPrayer();
    return `<button class="ad-item ${done ? 'done' : ''}" data-id="${a.id}" type="button">
      <span class="ad-item-bullet"></span>
      <span class="ad-item-name">${escHtml(a.title)}</span>
      <span class="ad-item-progress">${s}/${pr.target}</span>
    </button>`;
  }
  const p = done ? a.count : s;
  return `<button class="ad-item ${done ? 'done' : ''}" data-id="${a.id}" type="button">
    <span class="ad-item-bullet"></span>
    <span class="ad-item-name">${escHtml(a.title)}</span>
    <span class="ad-item-progress">${p}/${a.count}</span>
  </button>`;
}

/* ═══ Open / Close ═══ */
function open() {
  build();
  clearTimeout(S.hideTimer);
  /* تأكد إنه ظاهر قبل الأنيميشن */
  elPanel.style.display = '';
  elPanel.getBoundingClientRect(); /* force reflow — مهم للأنيميشن */

  requestAnimationFrame(() => {
    elPanel.classList.add('on');
    elBackdrop.classList.add('on');
  });
  elPanel.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function close() {
  if (!elPanel.classList.contains('on')) return;

  /* ريسيت الحالة على الـ DOM بدل إعادة البناء */
  resetVisualState();

  elPanel.classList.remove('on');
  elPanel.setAttribute('aria-hidden', 'true');
  elBackdrop.classList.remove('on');
  document.body.style.overflow = '';
  closeDetail();

  /* اخفي العنصر تمامًا بعد الأنيميشن لتحرير الـ GPU */
  clearTimeout(S.hideTimer);
  S.hideTimer = setTimeout(() => {
    if (!elPanel.classList.contains('on')) elPanel.style.display = 'none';
  }, 320);
}

function resetVisualState() {
  /* إعادة كل العناصر لحالة الصفر — بدون إعادة بناء */
  const items = elBody.querySelectorAll('.ad-item.done');
  for (const el of items) {
    el.classList.remove('done');
    const a = DATA_BY_ID[el.dataset.id];
    if (a) {
      const p = el.querySelector('.ad-item-progress');
      if (p) p.textContent = `0/${a.count}`;
    }
  }
  /* تصفير الجلسات غير المكتملة */
  for (const [id, count] of Object.entries(S.sessionCounts)) {
    if (S.completed.has(id)) continue;
    const el = elBody.querySelector(`.ad-item[data-id="${id}"]`);
    const a = DATA_BY_ID[id];
    if (el && a) {
      const p = el.querySelector('.ad-item-progress');
      if (p) p.textContent = `0/${a.count}`;
    }
  }
  S.completed.clear();
  S.sessionCounts = {};
  S.expanded.clear();
  S.search = '';
  elSearchInput.value = '';
  elSearch.classList.remove('has-text');
   /* اطوي كل المجموعات */
  elBody.querySelectorAll('.ad-group.expanded').forEach(g => g.classList.remove('expanded'));
  /* ⭐ إعادة بناء القائمة الكاملة بعد إغلاق البانر */
  renderList();
}

function isOpen() { return elPanel && elPanel.classList.contains('on'); }
function toggle() { isOpen() ? close() : open(); }

/* ═══ Detail ═══ */
function openDetail(id) {
  const a = DATA_BY_ID[id];
  if (!a) return;
  S.detailId = id;

  elDetailTitle.textContent = a.title;

  if (a.type === 'prayer') {
    renderPrayerDetail(a);
    elDetail.classList.add('on');
    elDetail.setAttribute('aria-hidden', 'false');
    return;
  }

  let html = '';

  if (a.type === 'action') {
    html += `<div class="ad-action-card">
      ${svg(ICON.book, 'class="book"')}
      <div class="ad-action-name">${escHtml(a.action)}</div>
      ${a.actionSub ? `<div class="ad-action-sub">${escHtml(a.actionSub)}</div>` : ''}
    </div>`;
  } else if (a.text) {
    html += a.text.split('\n\n').map(l => `<div class="ad-text ${a.type}">${escHtml(l)}</div>`).join('');
  }
  html += `<div class="ad-source">${svg(ICON.book)}<b>${escHtml(a.source)}</b></div>`;

  const done = S.completed.has(id);
  const val = done ? a.count : (S.sessionCounts[id] || 0);

  if (a.count === 1) {
    html += `<div class="ad-single-box ${done ? 'done' : ''}">
      <button class="ad-single-tap ${done ? 'complete' : ''}" type="button" data-act="tap" ${done ? 'disabled' : ''}>
        ${svg(ICON.check)}<span>${done ? 'تم بفضل الله' : 'تم القراءة'}</span>
      </button>
      <div class="ad-single-actions">
        <button class="ad-counter-action" type="button" data-act="copy">${svg(ICON.copy)} نسخ</button>
        <button class="ad-counter-action" type="button" data-act="reset">${svg(ICON.reset)} إعادة</button>
      </div>
    </div>`;
  } else {
    const pct = Math.min(100, (val / a.count) * 100);
    html += `<div class="ad-counter-box ${done ? 'done' : ''}">
      <div class="ad-counter-display">
        <div class="ad-counter-num" data-num>${val}</div>
        <div class="ad-counter-divider"></div>
        <div class="ad-counter-target">${a.count}<small>الهدف</small></div>
      </div>
      <div class="ad-counter-bar"><i data-bar style="width:${pct}%"></i></div>
      <button class="ad-counter-tap ${done ? 'complete' : ''}" type="button" data-act="tap" ${done ? 'disabled' : ''}>
        ${svg(done ? ICON.check : ICON.plus)}<span>${done ? 'تم بفضل الله' : 'اضغط للعد'}</span>
      </button>
      <div class="ad-counter-actions">
        <button class="ad-counter-action" type="button" data-act="copy">${svg(ICON.copy)} نسخ</button>
        <button class="ad-counter-action" type="button" data-act="reset">${svg(ICON.reset)} إعادة</button>
      </div>
    </div>`;
  }

  elDetailBody.innerHTML = html;
  elDetailBody.scrollTop = 0;

  /* Delegation داخل الـ detail — تُضاف مرة واحدة */
  if (!elDetailBody._wired) {
    elDetailBody._wired = true;
    elDetailBody.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const a = DATA_BY_ID[S.detailId];
      if (!a) return;
      const act = btn.dataset.act;
      if (act === 'tap')      onTap(a);
      else if (act === 'copy') copyCurrent();
      else if (act === 'reset') resetOne(a);
    });
  }

  elDetail.classList.add('on');
  elDetail.setAttribute('aria-hidden', 'false');
}

/* ═══ Prayer custom detail ═══ */
function renderPrayerDetail(a) {
  const pr = loadPrayer();
  const count = S.sessionCounts[a.id] || 0;
  const done = count >= pr.target;

    elDetailBody.innerHTML = `
    <div class="ad-prayer-actions">
      <button class="ad-prayer-action" type="button" data-act="edit-text">
        ${svg(ICON.edit)}<span>تعديل الصيغة</span>
      </button>
      <button class="ad-prayer-action" type="button" data-act="edit-wird">
        ${svg(ICON.edit)}<span>الورد: <b>${pr.target}</b></span>
      </button>
    </div>
    <div class="ad-text hadith">${escHtml(pr.text)}</div>
    <div class="ad-counter-box ${done ? 'done' : ''}">
      <div class="ad-counter-display">
        <div class="ad-counter-num" data-num>${count}</div>
        <div class="ad-counter-divider"></div>
        <div class="ad-counter-target">${pr.target}<small>الهدف</small></div>
      </div>
      <div class="ad-counter-bar"><i data-bar style="width:${Math.min(100, (count / pr.target) * 100)}%"></i></div>
      <button class="ad-counter-tap ${done ? 'complete' : ''}" type="button" data-act="prayer-tap" ${done ? 'disabled' : ''}>
        ${svg(done ? ICON.check : ICON.plus)}<span>${done ? 'تم بفضل الله' : 'اضغط للعد'}</span>
      </button>
    </div>
  `;
  elDetailBody.scrollTop = 0;

  if (!elDetailBody._wiredPrayer) {
    elDetailBody._wiredPrayer = true;
    elDetailBody.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'prayer-tap') onPrayerTap();
      else if (act === 'edit-text') openPrayerEditor('text');
      else if (act === 'edit-wird') openPrayerEditor('wird');
    });
  }
}

function onPrayerTap() {
  const a = DATA_BY_ID[S.detailId];
  if (!a) return;
  const pr = loadPrayer();
  const cur = S.sessionCounts[a.id] || 0;
  if (cur >= pr.target) return;

  const next = cur + 1;
  S.sessionCounts[a.id] = next;

  if (navigator.vibrate) navigator.vibrate(next >= pr.target ? 80 : 18);

  const num = elDetailBody.querySelector('[data-num]');
  const bar = elDetailBody.querySelector('[data-bar]');
  if (num) num.textContent = next;
  if (bar) bar.style.width = Math.min(100, (next / pr.target) * 100) + '%';

  if (next >= pr.target) {
    S.completed.add(a.id);
    const box = elDetailBody.querySelector('.ad-counter-box');
    const btn = elDetailBody.querySelector('.ad-counter-tap');
    if (box) box.classList.add('done');
    if (btn) { btn.classList.add('complete'); btn.disabled = true; btn.innerHTML = `${svg(ICON.check)}<span>تم بفضل الله</span>`; }
    toast('أتممت وردك — تقبّل الله');
    updateRow(a.id, pr.target, true);
  } else {
    updateRow(a.id, next, false);
  }
}

/* ═══ Prayer editor modal ═══ */
let _prayerEditMode = null;

function openPrayerEditor(mode) {
  _prayerEditMode = mode;
  const modal = document.getElementById('adEditModal');
  if (!modal) return;
  const title = document.getElementById('adEditTitle');
  const ta = document.getElementById('adEditTextarea');
  const numIn = document.getElementById('adEditNumber');
  const pr = loadPrayer();

  if (mode === 'text') {
    title.textContent = 'تعديل الصيغة';
    ta.style.display = '';
    numIn.style.display = 'none';
    ta.value = pr.text;
    setTimeout(() => ta.focus(), 120);
  } else {
    title.textContent = 'تعديل الورد اليومي';
    ta.style.display = 'none';
    numIn.style.display = '';
    numIn.value = pr.target;
    setTimeout(() => { numIn.focus(); numIn.select(); }, 120);
  }
  modal.classList.add('on');
}

function closePrayerEditor() {
  const modal = document.getElementById('adEditModal');
  if (modal) modal.classList.remove('on');
  _prayerEditMode = null;
}

function savePrayerEditor() {
  const pr = loadPrayer();
  if (_prayerEditMode === 'text') {
    const val = document.getElementById('adEditTextarea').value.trim();
    if (!val) { toast('الصيغة فاضية'); return; }
    pr.text = val;
  } else if (_prayerEditMode === 'wird') {
    let val = parseInt(document.getElementById('adEditNumber').value, 10);
    if (!isFinite(val) || val < 1) val = 1;
    if (val > 1000) val = 1000;
    pr.target = val;
  }
  savePrayer(pr);
  closePrayerEditor();
  toast('✓ تم الحفظ');
  const a = DATA_BY_ID[S.detailId];
  if (a && a.type === 'prayer') renderPrayerDetail(a);
  if (a) updateRow(a.id, S.sessionCounts[a.id] || 0, S.completed.has(a.id));
}

function onTap(a) {
  if (S.completed.has(a.id)) return;

  /* count === 1 */
  if (a.count === 1) {
    S.completed.add(a.id);
    const box = elDetailBody.querySelector('.ad-single-box');
    const btn = elDetailBody.querySelector('.ad-single-tap');
    if (box) box.classList.add('done');
    if (btn) { btn.classList.add('complete'); btn.disabled = true; btn.innerHTML = `${svg(ICON.check)}<span>تم بفضل الله</span>`; }
    if (navigator.vibrate) navigator.vibrate(60);
    toast('تم — تقبّل الله');
    updateRow(a.id, a.count, true);
    return;
  }

  /* count > 1 */
  const cur = S.sessionCounts[a.id] || 0;
  if (cur >= a.count) return;
  const next = cur + 1;
  S.sessionCounts[a.id] = next;

  if (navigator.vibrate) navigator.vibrate(next >= a.count ? 80 : 18);

  const num = elDetailBody.querySelector('[data-num]');
  const bar = elDetailBody.querySelector('[data-bar]');
  if (num) num.textContent = next;
  if (bar) bar.style.width = Math.min(100, (next / a.count) * 100) + '%';

  if (next >= a.count) {
    S.completed.add(a.id);
    const box = elDetailBody.querySelector('.ad-counter-box');
    const btn = elDetailBody.querySelector('.ad-counter-tap');
    if (box) box.classList.add('done');
    if (btn) { btn.classList.add('complete'); btn.disabled = true; btn.innerHTML = `${svg(ICON.check)}<span>تم بفضل الله</span>`; }
    toast('اكتمل الذكر — تقبّل الله');
    updateRow(a.id, a.count, true);
  } else {
    updateRow(a.id, next, false);
  }
}

function updateRow(id, val, done) {
  const row = elBody.querySelector(`.ad-item[data-id="${id}"]`);
  if (!row) return;
  row.classList.toggle('done', done);
  const p = row.querySelector('.ad-item-progress');
  if (!p) return;
  const a = DATA_BY_ID[id];
  if (a && a.type === 'prayer') {
    const pr = loadPrayer();
    p.textContent = `${val}/${pr.target}`;
  } else if (a) {
    p.textContent = `${val}/${a.count}`;
  }
}

function resetOne(a) {
  S.sessionCounts[a.id] = 0;
  S.completed.delete(a.id);
  if (a.count === 1) {
    const box = elDetailBody.querySelector('.ad-single-box');
    const btn = elDetailBody.querySelector('.ad-single-tap');
    if (box) box.classList.remove('done');
    if (btn) { btn.classList.remove('complete'); btn.disabled = false; btn.innerHTML = `${svg(ICON.check)}<span>تم القراءة</span>`; }
  } else {
    const num = elDetailBody.querySelector('[data-num]');
    const bar = elDetailBody.querySelector('[data-bar]');
    const box = elDetailBody.querySelector('.ad-counter-box');
    const btn = elDetailBody.querySelector('.ad-counter-tap');
    if (num) num.textContent = 0;
    if (bar) bar.style.width = '0%';
    if (box) box.classList.remove('done');
    if (btn) { btn.classList.remove('complete'); btn.disabled = false; btn.innerHTML = `${svg(ICON.plus)}<span>اضغط للعد</span>`; }
  }
  updateRow(a.id, 0, false);
  toast('تم التصفير');
}

async function copyCurrent() {
  const a = DATA_BY_ID[S.detailId];
  if (!a) return;
  const txt = a.type === 'action' ? a.action : a.text;
  try {
    await navigator.clipboard.writeText(txt || a.title);
    toast('تم النسخ');
  } catch(_) { toast('تعذّر النسخ'); }
}

function closeDetail() {
  const id = S.detailId;
  if (id && !S.completed.has(id)) {
    delete S.sessionCounts[id];
    const a = DATA_BY_ID[id];
    if (a) updateRow(id, 0, false);
  }
  elDetail.classList.remove('on');
  elDetail.setAttribute('aria-hidden', 'true');
  S.detailId = null;
}

function resetAll() {
  const any = S.completed.size > 0 || Object.values(S.sessionCounts).some(v => v > 0);
  if (!any) { toast('مفيش عدّادات شغالة'); return; }
  if (!confirm('تصفير كل العدّادات؟')) return;
  resetVisualState();
  closeDetail();
  toast('تم التصفير');
}

/* ═══ Init ═══ */
function init() {
  const btn = document.getElementById('adhkarBtn');
  if (btn) btn.addEventListener('click', open);
}

window.Adhkar = { open, close, toggle, isOpen, data: DATA };

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

})();