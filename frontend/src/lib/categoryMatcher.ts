import type { Category } from "@/types/api";
import { romanKey } from "@/lib/indicTransliteration";

/**
 * Deterministic, offline keyword matcher for complaint categories.
 *
 * This is the *only* category suggester in the app — there is no AI category
 * suggestion. Because the category list is closed, tiny (12 labels) and frozen
 * (`complaint_categories`: "seeded once, not editable from the app"), a curated
 * lexicon beats a model here, and it cannot block the filing flow: no network,
 * no model, worst case it abstains.
 *
 * Design rules, in order of importance:
 *
 *  1. **A wrong suggestion is worse than no suggestion.** The citizen has to
 *     confirm a category either way, so abstaining costs one tap; a confidently
 *     wrong pre-selection costs a misrouted complaint. `matchCategory` returns
 *     `null` unless the winner clears both an absolute floor and a margin over
 *     the runner-up.
 *  2. **Exact evidence always beats fuzzy evidence.** Fuzzy (typo) matching
 *     runs only when nothing matched exactly anywhere, so a near-miss in one
 *     category can never outrank a real hit in another.
 *  3. **Evidence is counted per region of text, not per keyword.** "pothole"
 *     and "potholes" hitting the same word count once, so a category curated
 *     with more spelling variants does not outscore an equally-supported one.
 *  4. **Shared keywords carry less weight.** A keyword listed under n
 *     categories contributes 1/n — "gutter" (manhole + sewage) is weak
 *     evidence, "manhole" is strong.
 *  5. **Negated mentions do not count.** "there is no pothole here, the
 *     streetlight is broken" is a streetlight complaint.
 *
 * Keyed by `Category.code` (the stable `complaint_categories.category_code`),
 * with a display-name fallback for safety. Covers English, Hinglish /
 * transliterations, and ten Indic scripts (Hindi, Bengali, Tamil, Telugu,
 * Gujarati, Kannada, Malayalam, Punjabi, Odia, Marathi).
 */

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  POTHOLE: [
    // English
    "pothole", "potholes", "hole in road", "road hole", "crater", "craters",
    "broken road", "pit", "pits", "damaged asphalt", "tar road damage", "uneven road",
    "asphalt hole", "cave in", "cavein", "cavity on road", "damaged road", "deep hole",
    "deep pit", "dented road", "depression in road", "road patch missing", "road sinkhole",
    "road cavity", "sink hole", "sinkhole", "sinkholes", "trench on road", "unpaved patch",
    // Hinglish & Transliterations
    "gaddha", "gaddhe", "gadday", "gadda", "gadde", "khadda", "khadde", "khadday",
    "khatta", "khatte", "sadak toot", "rasta kharab", "sadak me gaddha", "gaddhe hai",
    "sadak kharab", "kuzhi", "gundhi", "gado", "toaa", "khaddo",
    "bhond", "bada gaddha", "chota gaddha", "gaddha hi gaddha", "gadde hi gadde", "gaddi",
    "kappal road", "khaddiya", "khaddun", "khani", "kuzhigal", "kuzhiam", "pallam",
    "pallangal", "periya kuzhi", "road gaddha", "road kharab", "sadak gaddha", "sadak tuti",
    "suang", "toae", "tooaa",
    // Native Scripts
    "गड्ढा", "गड्ढे", "सड़क में गड्ढा", "खड्डा", "खड्डे", "सड़क टूटी",
    "গর্ত", "রাস্তার গর্ত", "குழி", "பள்ளம்", "ரோட்டு குழி", "சாலை குழி",
    "గుంత", "గుంతలు", "రోడ్డు గుంత", "ખાડો", "કાણું", "રસ્તાનો ખાડો",
    "ಗುಂಡಿ", "ತಗ್ಗು", "ರಸ್ತೆ ಗುಂಡಿ", "കുഴി", "റോഡിലെ കുഴി", "ਟੋਆ", "ਸੜਕ ਵਿੱਚ ਟੋਆ",
    "ଗାତ", "ରାସ୍ତା ଗାତ",
    "मोठा खड्डा", "रस्त्यावर खड्डा", "रस्ता खराब", "મોટો ખાડો", "ਰਸਤੇ ਵਿੱਚ ਟੋਆ",
    "பெரிய குழி", "சாலையில் பள்ளம்", "రోడ్డులో గుంత", "ರಸ್ತೆಯಲ್ಲಿ ಗುಂಡಿ", "റോഡിൽ കുഴി"
  ],
  OPEN_MANHOLE: [
    // English
    "manhole", "man hole", "drain cover", "sewer cover", "open hole", "missing cover",
    "chamber cover", "open drain", "chamber open", "uncovered drain", "danger hole", "chamber", "drain",
    "broken chamber", "broken drain cover", "broken manhole", "broken slab", "gutter cover missing",
    "lid missing", "manhole cover broken", "manhole cover missing", "missing lid", "missing slab",
    "no cover on drain", "open chamber", "open gutter", "open pit", "uncovered chamber",
    "uncovered pit", "uncovered sewer",
    // Hinglish & Transliterations
    "naali", "naala", "nala", "nali", "dhakkan", "dhakan", "gutter", "guttar", "gutar",
    "gutter khula", "naali khuli", "dhakkan missing", "chamber khula",
    "menhol", "drainage hole",
    "chamber ka dhakkan", "chamber tuta", "dhakan nahi hai", "dhakkan gayab", "dhakkan nahi hai",
    "dhakkan tuta", "gutter ka dhakkan", "gutter cover", "khula dhakkan", "khula gutter",
    "khula menhol", "khula nala", "mainhole", "menhol khula", "moodi illai", "moodi broken",
    "nala khula", "sewer cover missing",
    // Native Scripts
    "मैनहोल", "ढक्कन खुला", "खुला नाला", "गटर खुला", "चेम्बर", "चेंबर",
    "ম্যানহোল", "ড্রেন কভার", "மேன்ஹோல்", "மூடி இல்லை", "திறந்த சாக்கடை", "சாக்கடை",
    "మ్యాన్‌హోల్", "మురుగు మూత", "మురుగుడు", "મેનહોલ", "ગટર ઢાંકણ",
    "ಮ್ಯಾನ್‌ಹೋಲ್", "ಚರಂಡಿ ಮುಚ್ಚಳ", "മാൻഹോൾ", "ഓട മൂടി", "ചാമ്പർ",
    "ਮੈਨਹੋਲ", "ਗਟਰ ਦਾ ਢੱਕਣ", "ਮਾਨਹੋਲ", "ନାଳ ଢାଙ୍କୁଣୀ",
    "गटरचे झाकण missing", "उघडा गटर", "झाकण नाही", "ગટરનું ઢાંકણ નથી", "ਖੁੱਲ੍ਹਾ ਗਟਰ",
    "மூடி உடைந்தது", "மூடி காணவில்லை", "మూత లేదు", "మురుగు కాలువ మూత", "ముచ్చள ಇಲ್ಲ"
  ],
  BROKEN_STREETLIGHT: [
    // English
    "street light", "streetlight", "streetlights", "lamp", "lamppost", "flicker",
    "flickering", "dark at night", "no light", "light not working", "bulb broken",
    "dark street", "darkness", "pole light", "bulb", "fused bulb", "fused light",
    "lamp post", "lamp post broken", "led light fused", "light off", "light outage",
    "no street light", "non functional street light", "pole light broken", "pole light fused",
    "street light off", "street light out", "street lamp broken", "street lamp out",
    // Hinglish & Transliterations
    "andhera", "andhera hai", "batti band", "light kharab", "light nahi jal rahi",
    "light off", "pole light off", "batti kharab", "light nahi hai", "khamba", "batti", "lightu",
    "andhera raasta", "batti band hai", "batti nahi jal rahi", "khamba light off", "khamba light kharab",
    "khamba no light", "light fuse", "light ho gaya off", "light nahi chal rahi", "light nahi hai re",
    "light repair needed", "lightu elagale", "lightu eriyala", "post light off", "roshni nahi hai",
    "street light band", "street light nahi jal raha",
    // Native Scripts
    "स्ट्रीट लाइट", "बत्ती खराब", "अंधेरा", "लाइट नहीं जल रही", "बत्ती", "खंभा",
    "স্ট্রিট লাইট", "বাতি বন্ধ", "আলো", "தெரு விளக்கு", "மின்விளக்கு எரியவில்லை", "வெளிச்சம்",
    "వీధి దీపం", "లైటు వెలగడం లేదు", "వెలుగు", "સ્ટ્રીટ લાઇટ", "લાઇટ બંધ છે",
    "ಬೀದಿ ದೀಪ", "ದೀಪ ಉರಿಯುತ್ತಿಲ್ಲ", "തെരുവ് വിളക്ക്", "വിളക്ക് കത്തുന്നില്ല",
    "ਸਟਰੀਟ ਲਾਈਟ", "ਲਾਈਟ ਖਰਾਬ", "ਰਾਏਤਾ ਬਤੀ", "ବତି ଜଳୁନାହିଁ",
    "दिवे बंद", "रस्त्यावर अंधार", "લાઈટ બંધ", "લાઇટ ખરાબ", "ਰਾਤ ਨੂੰ ਹਨੇਰਾ",
    "விளக்கு எரியவில்லை", "லைட் எரியல", "లైట్ వెలగలేదు", "లైటు పనిచేయట్లేదు", "ದೀಪ ಕೆಟ್ಟಿದೆ"
  ],
  GARBAGE_OVERFLOW: [
    // English
    "garbage", "trash", "waste", "bin", "dustbin", "dumpster", "rubbish", "litter",
    "stink", "foul smell", "smelly", "smell", "overflowing bin", "waste accumulation",
    "accumulation of waste", "bad odor", "bad odour", "bin overflow", "bio waste uncollected",
    "decaying garbage", "dustbin overflow", "foul odor", "garbage heap", "garbage pile",
    "garbage van not coming", "home waste not collected", "littered street", "littering",
    "overflowing dustbin", "rotten waste", "smelly garbage", "uncollected garbage",
    "uncollected trash", "uncollected waste",
    // Hinglish & Transliterations
    "kachra", "kachre", "kachra gadi", "kooda", "kuda", "kudadan", "gandagi", "kuchra",
    "kachra dher", "kachra overflow", "kuda fela", "badbu", "badboo", "smell aa rahi",
    "badboo aarahai", "dustbin bhar gaya", "dustbin overflow", "gandagi hai", "gandi smell",
    "kachra bhara hai", "kachra nahi uthaya", "kachra nahi utha", "kachra nahi uthaya gaya",
    "kachra paile", "kachre ka dher", "kuda nahi utha", "kuda nahi uthaya", "kuda overflow",
    "kudadan bhar gaya", "kuppa thotti overflow", "kuppai overflow", "smelly bin",
    // Native Scripts
    "कचरा", "कूड़ा", "गंदगी", "बदबू", "कूड़ेदान फुल", "कूड़ेदान", "डस्टबिन",
    "আবর্জনা", "ময়লা", "দুর্গন্ধ", "குப்பை", "துர்நாற்றம்", "குப்பை தொட்டி",
    "చెత్త", "దుర్వాసన", "చెత్త కుండీ", "કચરો", "દુર્ગંધ",
    "ಕಸ", "ದುರ್ವಾದನೆ", "ಕಸದ ತೊಟ್ಟಿ", "ಕಸದತೊಟ್ಟಿ", "മാലിന്യം", "ദുർഗന്ധം", "മാലിന്യനിക്ഷേപം",
    "ਕੂੜਾ", "ਬੱਦਬੂ", "ଆବର୍ଜନା", "ଦୁର୍ଗନ୍ଧ",
    "कचरा साचलाय", "कचऱ्याचा ढीग", "दुर्गंधी", "કચરાનો ઢગલો", "ਕੂੜਾ ਨਹੀਂ ਚੁੱਕਿਆ",
    "குப்பை அல்லவில்லை", "குப்பை நாற்றம்", "చెత్త తీయలేదు", "చెత్త కుండి నిండిపోయింది", "ಕಸ ಎತ್ತಿಲ್ಲ"
  ],
  WATER_LEAKAGE: [
    // English
    "water leak", "water leakage", "pipe burst", "leaking pipe", "water wastage",
    "leak", "leaking", "broken pipe", "water pipeline", "water gushing", "main pipe leak",
    "pipeline", "pipe", "wastage",
    "burst pipe", "broken water line", "clean water wasting", "drinking water leaking",
    "drinking water wastage", "gushing water", "leakage in pipe", "leaking tap",
    "main line leak", "municipal pipe leak", "pipe leakage", "pipeburst", "pipeline burst",
    "pipeline leakage", "supply pipe leak", "water line burst", "water main break",
    "water overflow pipeline", "water pipe broken", "water pipe leak", "waterbreak",
    // Hinglish & Transliterations
    "pani leak", "paani leak", "pani beh raha", "pipe phat gaya", "pani waste",
    "piping leak", "jal leak", "nal", "nall", "paani", "pani",
    "nal ka pani", "nal leak", "nalla leak", "paani bah raha hai", "paani beh raha hai",
    "paani ka leak", "paani phat gaya", "paani waste ho raha hai", "pani fuskaya", "pani gushing",
    "pani kharab ho raha hai", "pani ki line burst", "pani ki line leak", "pani leak ho raha hai",
    "pani tuta pipe", "pipe bursting", "pipe leak ho gaya", "thanneer leak", "water pipeline broken",
    // Native Scripts
    "पानी का रिसाव", "पानी लीक", "पाइप फूला", "पानी बह रहा है", "पाइप", "नल", "सप्लाई",
    "পানির লিকেজ", "পাইপ ফেটে গেছে", "தண்ணீர் கசிவு", "குழாய் உடைப்பு", "குழாய்",
    "నీటి లీకేజీ", "పైపు పగిలింది", "పైపు", "પાણી લીકેજ", "પાઇપ લીકેજ", "પાણી",
    "ನೀರು ಸೋರಿಕೆ", "ಪೈಪ್ ಒಡೆದಿದೆ", "വെള്ളം ചോർച്ച", "പൈപ്പ് പൊട്ടി",
    "ਪਾਣੀ ਦਾ ਰਿਸਾਅ", "ਪਾਈਪ ਲੀਕ", "ପାଣି ଲିକੇଜ", "ਪਾਈਪ ਲੀਕ", "ପାଣି ଲିକେଜ", "ପାଇପ୍ ଫାଟିଛି",
    "पाणी गळती", "पाणी वाया जात आहे", "पाइप फुटला", "પાણી વેસ્ટ", "પાણીની પાઇપ લીક",
    "પાણીનું લીકેજ", "તણ્ણીર્ કસિവു", "தண்ணீர் வீணாகிறது", "నీళ్ళు వృధా", "నీటి పైపు లీక్", "ನೀರು ಪೋಲಾಗುತ್ತಿದೆ"
  ],
  DRAINAGE_OVERFLOW: [
    // English
    "drain", "drainage", "waterlog", "waterlogged", "waterlogging", "water logging",
    "water logged", "logging", "logged", "storm water",
    "stormwater", "overflowing drain", "flooded street", "flooded", "standing water",
    "blocked drain", "drain blocked", "drain is blocked", "dirty water road",
    "clogged drain", "clogged stormwater drain", "drain choking", "drain overflow",
    "flooded road", "flooding on road", "monsoon waterlogging", "rain water accumulation",
    "rainwater accumulation", "rainwater flooding", "rainwater logging", "road flooding",
    "standing rainwater", "storm drain blocked", "storm drain overflow", "street waterlogging",
    // Hinglish & Transliterations
    "naali overflow", "naala overflow", "gutar overflow", "jal bharav", "jalbharav",
    "pani bhara", "rasta jam", "paani bhara hai", "gatarr", "nalah", "naali bhar gayi", "naala bhar",
    "barish ka pani", "barish ka paani", "drainage block", "jal jamav", "naala block",
    "naala jam", "naali jam", "naali ka pani road pe", "nala overflowing", "nali blockage",
    "paani bhara hua hai", "pani atka hai", "pani bhara hua hai", "pani jam gaya", "pani jama hai",
    "rasta me pani", "road pe pani", "sadak pe pani", "thanneer stagnation", "waterlogging on road",
    // Native Scripts
    "नाला", "नाली", "जलभराव", "गटर", "पानी भरा है", "नाली ओवरफ्लो",
    "নর্দমা", "জলাবদ্ধতা", "வடிகால்", "தெருவில் தண்ணீர்", "வெள்ளம்",
    "முరుగు కాలువ", "కాలువ", "నీరు నిలిచింది", "ગટર", "પાણી ભરાયું",
    "ಚರಂಡಿ", "ನೀರು ನಿಂತಿದೆ", "ഓട", "വെള്ളക്കെട്ട്",
    "ਨਾਲੀ", "ਪਾਣੀ ਭਰਿਆ", "ਨਾੜ", "ଜଳବନ୍ଦୀ",
    "रस्त्यावर पाणी साचले", "पाणी साचले", "પાણી ભરાઈ ગયું", "રસ્તા પર પાણી", "ਰਸਤੇ ਵਿੱਚ ਪਾਣੀ",
    "ரோட்டில் தண்ணீர் நிற்கிறது", "மழைநீர் தேக்கம்", "రోడ్డుపై నీరు నిలిచింది", "నీరు నిల్వ ఉంది", "ರಸ್ತೆಯಲ್ಲಿ ನೀರು"
  ],
  SEWAGE_BLOCKAGE: [
    // English
    "sewage", "sewer", "sewerage", "blockage", "choked", "sewer line blocked", "backflow",
    "choked sewer", "foul sewage", "sewage overflow", "toilet waste",
    "blackwater", "blackwater overflow", "choked manhole", "clogged sewer", "clogged sewer line",
    "foul sewage water", "gutter blockage", "overflowing sewer", "septage", "septic",
    "sewage backflow", "sewage water on road", "sewer choking", "sewer line blockage",
    "sewer line choke", "sewer line leak", "sewer overflow", "sewer water leak",
    "sewer water overflow", "stinking sewage", "toilet waste leak", "unclog sewer",
    // Hinglish & Transliterations
    "seavage", "sewer jam", "gutar band", "gatar choke", "sewer blockage",
    "ganda pani", "ganda paani", "gutter", "guttar", "gutar", "ganda", "naali band", "naali block",
    "badbu", "badboo",
    "ganda paani sadak pe", "ganda pani aara hai", "ganda pani overflow", "gatar ka pani",
    "gutter choked", "gutter jam", "gutter ka ganda pani", "gutter ka pani road pe",
    "gutter leak", "guttar band", "guttar block", "saakadai water", "sewage water",
    "sewer ka ganda pani", "sewer phat gaya", "sewer pipe block", "shakada water",
    // Native Scripts
    "सीवेज", "गटर बंद", "सीवर चोक", "गंदा पानी", "सीवर", "गटर", "बदबू",
    "সাঁডপাণী", "সেপটিক পাইপ", "কழிவுநீர்", "சாக்கடை அடைப்பு", "கழிவு",
    "మురుగునీరు", "డ్రైనేజీ బ్లాక్", "మురుగు", "ગટર વ્યવસ્થા", "ગટર બ્લોક",
    "ಕೊಳಚೆ ನೀರು", "ಚರಂಡಿ ಬ್ಲಾಕ್", "മലിനജലം", "ഓട അടഞ്ഞു",
    "ਗੰਦਾ ਪਾਣੀ", "ਸੀਵਰ ਬਲਾਕ", "ਮਈਲਾ ਪਾਣੀ", "ସିୱେଜ୍ ବ୍ଲକ୍",
    "गटाराचे घाण पाणी", "सीवर बंद", "ગંદુ પાણી", "ગટર લીક", "ਸੀਵਰ ਦਾ ਗੰਦਾ ਪਾਣੀ",
    "சாக்கடை நீர்", "சாக்கடை பொங்குது", "మురుగునీరు రోడ్డుపై", "మురుగు పారుతోంది", "ಕೊಳಚೆ నీరు"
  ],
  DAMAGED_FOOTPATH: [
    // English
    "footpath", "pavement", "sidewalk", "tiles", "paver blocks", "broken tiles",
    "walkway", "pedestrian track", "broken footpath", "paver",
    "broken kerb", "broken pavement", "broken sidewalk", "broken walkway", "cracked footpath",
    "damaged pavement", "damaged sidewalk", "damaged tiles", "dislodged paver blocks",
    "footpath broken", "footpath condition poor", "interlocking tiles broken", "kerb",
    "kerbstones", "missing tiles footpath", "pavers", "pedestrian footpath damaged",
    "uneven footpath", "uneven pavement", "uneven walkway",
    // Hinglish & Transliterations
    "footpath kharab", "pedal chalne ka rasta", "tiles tuti", "footpath toot gaya",
    "pavement broken", "patri",
    "chalne ka rasta tuta", "footpath broken hai", "footpath gaddha", "footpath ka tile tuta",
    "footpath ki tile", "footpath paver block", "footpath tuta hai", "nade padhai broken",
    "padachari rasta tuta", "paver block tuta", "pedal chalne ka rasta kharab", "pedestrian path tuta",
    "tiles toot gayi", "toti hui tile", "tuta footpath", "tuti patri",
    // Native Scripts
    "फुटपाथ", "पैदल पथ", "टाइल्स टूटी", "पैट्री", "पटरी", "टाइल्स",
    "ফুটপাথ", "ফুটপাত", "পাকা পথ", "நடைபாதை", "நடைபாதை கல் உடைந்தது",
    "కాలిబాట", "ఫుట్‌పాత్", "పుట్‌పాత్", "ફૂટપાથ", "પેવર બ્લોક broken",
    "ಪಾದಚಾರಿ ಮಾರ್ಗ", "ಫುಟ್‌ಪಾತ್", "ಕಾಲುದಾರಿ", "നടപ്പാത", "പാതയോരം",
    "ਫੁੱਟਪਾਥ", "ਪਾਦਚਾਰੀ ਪਥ",
    "फूटपाथ खराब", "पायवाट फुटली", "ફૂટપાથ તૂટી ગઈ", "ਫੁੱਟਪਾਥ ਟੁੱਟਿਆ",
    "நடைபாதை சேதம்", "நடபாதை உடைந்துவிட்டது", "కాలిబాట దెబ్బతింది", "ఫుట్‌పాత్ విరిగింది", "ಫುಟ್‌ಪಾತ್ ಹಾಳಾಗಿದೆ"
  ],
  FALLEN_TREE: [
    // English
    "tree", "branch", "fallen tree", "tree down", "blocking road tree",
    "uprooted tree", "broken branch", "tree fell", "branches",
    "big branch fallen", "blocking tree", "branch hanging dangerously", "branch obstructs road",
    "dangerous tree branch", "fallen branch", "fallen tree branch", "hanging branch",
    "heavy branch fallen", "large tree fell", "overhanging branch", "snapped tree branch",
    "tree blocking traffic", "tree branch broken", "tree collapse", "tree fallen on road",
    "tree fallen on wire", "tree root uprooted", "tree fell down", "uprooted trunk",
    // Hinglish & Transliterations
    "ped", "perh", "ped gira", "pedh gira", "paudha", "jhadd", "dali toot gayi",
    "ped raste pe", "jhad padle", "gaach", "dali", "taani",
    "bada ped gira", "dali toot ke giri", "dali tut gayi", "dali tuti hai", "jhad gira",
    "jhad padla", "maram fallen", "maram vilundhadhu", "ped gir gaya", "ped gir gaya hai",
    "ped ka dali tuta", "ped ki shakha tuti", "ped raste par gira", "perh gir gaya",
    "shakha tuti hai", "taani toot gayi", "tree fallen road block",
    // Native Scripts
    "पेड़ गिरा", "पेड़", "टहनी", "डाली टूटी", "पेड़ गिर गया", "डाली", "पौधा",
    "গাছ পড়েছে", "গাছের ডাল", "গাছ", "மரம் விழுந்தது", "கிளை முறிந்தது", "மரம்", "கிளை",
    "చెట్టు పడింది", "కొమ్మ విరిగింది", "చెట్టు", "కొమ్మ", "ઝાડ પડ્યું", "ડાખી તૂટી", "ઝાડ",
    "ಮರ ಬಿದ್ದಿದೆ", "ಕೊಂಬೆ ಬಿದ್ದಿದೆ", "ಮರ", "മരം വീണു", "ചില്ല പൊട്ടി", "മരം", "ചില്ല",
    "ਦਰੱਖਤ ਡਿੱਗਿਆ", "ਟਾਹਣੀ", "ਦਰੱਖਤ", "ଗଛ ପଡ଼ିଛି", "ଡାଳ ଭାଙ୍ଗିଛି", "ଗଛ",
    "झाड पडले", "झाडाची फांदी तुटली", "ઝાડ રસ્તા પર પડ્યું", "ਦਰੱਖਤ ਰਸਤੇ 'ਤੇ ਡਿੱਗਿਆ",
    "மரம் முறிந்து விழுந்தது", "கிளை உடைந்து விழுந்தது", "చెట్టు కూలిపోయింది", "చెట్టు కొమ్మ విరిగింది", "ಮರ ಬಿದ್ದಿದೆ"
  ],
  STRAY_ANIMAL: [
    // English
    "dog", "doggie", "dogs", "stray", "stray dog", "cattle", "cow", "cows", "bull", "animal",
    "dog bite", "monkeys", "monkey", "stray pigs", "pigs", "aggressive dog", "rabies risk",
    "animal attack", "rabies",
    "aggressive stray dog", "animal menace", "biting dog", "bull fight on road", "bull menace",
    "canine", "cattle blocking road", "cattle menace", "dog pack", "dog terror", "mad dog",
    "monkey menace", "monkey trouble", "pack of dogs", "stray animal menace", "stray bull",
    "stray cattle", "stray cows", "stray dog bite", "stray dogs menace", "stray pig menace",
    "street dog", "street dogs",
    // Hinglish & Transliterations
    "kutta", "kutte", "kuttay", "gaay", "gay", "ghode", "sadak pe gaay", "awara kutta", "janwar",
    "monkeys trouble", "kutta kata", "dog menace", "bandar", "saand",
    "awara kuttay", "awara pareshani", "bandar ka utpat", "bandar pareshan kar rahe",
    "booridha dog", "gaay raste pe", "gai raste pe", "janwar raste pe", "kutte ka katna",
    "kutte ka dar", "kutte ka jamawda", "kutte ka terror", "kutte ne kata", "kutte pareshan kar rahe",
    "naai bites", "saand ka attack", "saand raste pe", "stray dog bite kar raha hai",
    // Native Scripts
    "आवारा कुत्ता", "आवारा जानवर", "गाय", "कुत्ते काटते हैं", "कुत्ता", "कुत्ते", "बंदर", "सांड", "सांड़",
    "ভবঘুরে কুকুর", "গরু", "தெரு நாய்", "மாடு", "நாய் கடி", "நாய்",
    "వీధి కుక్క", "ఆవు", "కుక్క కాటు", "కుక్క", "રખડતું કૂતરું", "ગાય",
    "ಬೀದಿ ನಾಯಿ", "ಸಾಕುಪ್ರಾಣಿ", "ನಾಯಿ", "തെരുവ് നായ", "പശു", "നായ",
    "ਅਵਾਰਾ ਕੁੱਤਾ", "ਗਾਂ", "ਰਾਸਤਾ ਕੁਕੁਰ", "ଗାଈ",
    "भटकणारे कुत्रे", "भटके कुत्रे", "मोकाट जनावर", "રખડતાં ઢોર", "ਅਵਾਰਾ ਪਸ਼ੂ",
    "தெரு நாய் தொல்லை", "நாய்க்கடி", "వీధి కుక్కల బెడద", "కుక్క కాటు వేసింది", "ಬೀದಿ ನಾಯಿಗಳ ಉಪಟಳ"
  ],
  ILLEGAL_DUMPING: [
    // English
    "dumping", "debris", "construction waste", "illegal dump", "malba",
    "building waste", "dumping yard", "unauthorized dumping", "concrete waste", "rubble",
    "c&d waste", "construction debris", "debris dumping", "debris on road", "dumped malba",
    "dumped rubble", "dumping debris", "illegal debris", "illegal debris dumping", "illegal garbage dump",
    "unauthorized debris", "unauthorized dump", "unauthorized dumping site", "unauthorized waste dumping",
    // Hinglish & Transliterations
    "malwa", "kaccha kachra", "building ka kachra", "dher laga hai",
    "illegal kachra", "debris overflow", "dher", "kachre ka dher", "kachra dher", "dher", "kachde ka dher", "kachda dher",
    "building kachra", "building ka malba", "cement waste", "construction ka kachra",
    "debris ka dher", "illegal dumping ground", "illegal malba", "kacha kachra", "khali plot pe kachra", "malba dher",
    "malba dumping", "malwa ka dher", "malwa dher", "patthar ka dher", "sadak pe malba",
    "unauthorized kachra",
    // Native Scripts
    "मलबा", "अवैध कचरा", "निर्माण सामग्री", "मलबे", "ढेर",
    "ধ্বংসাবশেষ", "নির্মাণ বর্জ্য", "இடிபாடு", "கட்டுமானக் கழிவு", "கழிவு",
    "శిథిలాలు", "భవన వ్యర్థాలు", "వ్యర్థాలు", "કાટમાળ",
    "ಅವಶೇಷ", "ಕಟ್ಟಡದ ತ್ಯಾಜ್ಯ", "അവശിഷ്ടം", "കെട്ടിട അവശിഷ്ടങ്ങൾ",
    "ਮਲਬਾ", "ਮਲਵਾ", "ନିର୍ମାଣ ଆବର୍ଜନା",
    "बांधकाम कचरा", "अनधिकृत कचरा", "બાંધકામનો કચરો", "ਗੈਰ-ਕਾਨੂੰਨੀ ਮਲਬਾ",
    "கட்டுமானக் கழிவுகள்", "கட்டிட இடிபாடுகள்", "భవన నిర్మాణ వ్యర్థాలు", "చెత్త డంపింగ్", "ಕಟ್ಟಡ ತ್ಯಾಜ್ಯ"
  ],
  TRAFFIC_SIGNAL_FAULT: [
    // English
    "traffic signal", "traffic light", "signal", "junction light", "red light",
    "signal broken", "signal not working", "traffic jam signal", "blinking signal", "junction",
    "blinking red light", "faulty signal", "faulty traffic light", "junction signal broken",
    "no signal", "pedestrian signal broken", "red light broken", "red light fault", "signal blink",
    "signal dark", "signal failure", "signal kaput", "signal light off", "signal stuck",
    "signal timer broken", "traffic light kaput", "traffic light off", "traffic signal broken",
    "traffic signal failure", "traffic signal fault", "traffic signal fixed off", "yellow light blinking",
    // Hinglish & Transliterations
    "signal kharab", "traffic light band", "red light not working", "chauraha signal",
    "traffic jam", "light kharab hai", "chauraha", "chaurahe",
    "chauraha light band", "chauraha light kharab", "chaurahe pe signal band", "red light band hai",
    "red light kharab", "signal band hai", "signal chal nahi raha", "signal kaam nahi kar raha",
    "signal kharab hai", "signal nahi chal raha", "signal off hai", "signal photo kharab",
    "traffic jam due to signal", "traffic light kharab", "traffic light nahi chal raha",
    // Native Scripts
    "ट्रैफिक सिग्नल", "सिग्नल खराब", "रेड लाइट बंद", "सिग्नल", "चौराहा",
    "ট্রাফিক সিগন্যাল", "ট্রাফিক সিগন্যাল বিকਲ", "சிக்னல் வேலை செய்யவில்லை", "சிக்னல்",
    "ట్రాఫిక్ సిగ్నల్", "సిగ్నల్ పనిచేయడం లేదు", "సిగ్నல்", "ટ્રાફિક સિગ્નલ", "સિગ્નલ બંધ છે",
    "ಟ್ರಾಫಿಕ್ ಸಿಗ್ನಲ್", "ಸಿಗ್ನಲ್ ಕೆಲಸ ಮಾಡುತ್ತಿಲ್ಲ", "ട്രാഫിക് സിഗ്നൽ", "സിഗ്നൽ തകരാർ",
    "ਟ੍ਰੈਫਿਕ ਸਿਗਨਲ", "ਟ੍ਰੈਫਿਕ ਸਿਗਨਾਿਲ",
    "ट्रॅफिक सिग्नल बंद", "सिग्नल बंद आहे", "ટ્રાફિક સિગ્નલ બંધ", "ਟ੍ਰੈਫਿਕ ਲਾਈਟ ਖਰਾਬ",
    "சிக்னல் வேலை செய்யல", "டிராபிக் சிக்னல் பழுது", "సిగ్నల్ పనిచేయట్లేదు", "ట్రాఫిక్ లైట్ బంద్", "ಸಿಗ್ನಲ್ ಕೆಟ್ಟಿದೆ"
  ],
};

/**
 * Fallback lookup for the seeded display names, so the matcher keeps working
 * if `Category.code` is ever missing from a response. `category_code` is the
 * stable key (a rename never changes it); `name` is not, which is why it is
 * only the fallback.
 */
const CODE_BY_SEEDED_NAME: Record<string, string> = {
  "pothole": "POTHOLE",
  "open manhole": "OPEN_MANHOLE",
  "broken street light": "BROKEN_STREETLIGHT",
  "garbage overflow": "GARBAGE_OVERFLOW",
  "water leakage": "WATER_LEAKAGE",
  "drainage overflow": "DRAINAGE_OVERFLOW",
  "sewage blockage": "SEWAGE_BLOCKAGE",
  "damaged footpath": "DAMAGED_FOOTPATH",
  "fallen tree or branch": "FALLEN_TREE",
  "stray animal nuisance": "STRAY_ANIMAL",
  "illegal dumping": "ILLEGAL_DUMPING",
  "traffic signal malfunction": "TRAFFIC_SIGNAL_FAULT",
};

// --- Tuning constants -------------------------------------------------------

/** Score for a multi-word phrase hit. Phrases are the strongest signal. */
const SCORE_PHRASE = 2.0;
/** Non-Latin phrases match by substring, which is stricter, so they score higher. */
const SCORE_PHRASE_NON_ASCII = 2.5;
/** Score for a whole-word hit on a single-word keyword. */
const SCORE_WORD = 1.0;
const SCORE_WORD_NON_ASCII = 1.5;
/**
 * Score for a Levenshtein typo hit. Equal to an exact word hit *because* the
 * fuzzy pass only ever runs when the exact pass found nothing anywhere — there
 * is no cross-tier competition to discount against.
 */
const SCORE_FUZZY = 1.0;
/**
 * A transliteration hit. Below an exact match, since it survived a lossy fold
 * that discards aspiration, vowel length and internal schwas, but above a
 * Levenshtein guess: "gadda" reaching गड्ढा is a real synonym, not a typo.
 */
const SCORE_ROMAN = 1.2;
const SCORE_ROMAN_PHRASE = 2.2;
/**
 * Folded keys shorter than this collide too easily to be evidence of
 * anything — "toa" folds to "to", which would match half the lexicon.
 */
const ROMAN_MIN_KEY_LENGTH = 3;

/** A winner must clear this, or the matcher abstains. */
const MIN_SCORE = 1.0;
/** ...and must beat the runner-up by this, or the evidence is ambiguous. */
const MIN_MARGIN = 0.5;

/** Fuzzy matching is off below this length — short words are too promiscuous. */
const FUZZY_MIN_KEYWORD_LENGTH = 5;
/** Distance 2 is only safe on long keywords; on short ones it matches anything. */
const FUZZY_DISTANCE_2_MIN_LENGTH = 8;

/** How many words back from a match to look for a negator. */
const NEGATION_LOOKBACK_TOKENS = 3;

/**
 * Words that flip the meaning of a following match. Kept deliberately small
 * and unambiguous — a false negation silently deletes real evidence.
 */
const NEGATORS = new Set([
  "no", "not", "non", "without", "never", "neither", "nor",
  "isnt", "arent", "wasnt", "werent", "dont", "doesnt", "didnt", "cant", "wont",
  // Deliberately excludes bare "na"/"koi" — they are far more often ordinary
  // words than negators, and a false negation silently deletes real evidence.
  "nahi", "nahin", "nai", "naa", "bina",
  "नहीं", "नही", "ना", "बिना",
]);

/**
 * A negator only reaches forward within its own clause. Punctuation and
 * coordinating conjunctions end the reach, so "no pothole, the light is
 * broken" does not negate "light".
 */
const CLAUSE_BREAKERS = new Set([
  "but", "and", "however", "though", "although", "yet", "still",
  "lekin", "magar", "aur", "par", "phir",
  "लेकिन", "मगर", "और", "पर", "फिर",
]);
const CLAUSE_BREAKING_PUNCTUATION = /[,;.!?—–|\n]/;

// --- Index built once at module load ---------------------------------------

interface IndexedKeyword {
  keyword: string;
  isMultiWord: boolean;
  isNonAscii: boolean;
  /** 1 / (number of categories listing this keyword). Shared terms are weak evidence. */
  specificity: number;
  /**
   * The transliterated + folded form, split per word. Empty when the keyword
   * folds to something too short to be evidence. See `SCORE_ROMAN`.
   */
  romanParts: string[];
  /** Same 1/n rule as `specificity`, but counted over folded keys — folding
   * merges terms that were distinct, so the collision count differs. */
  romanSpecificity: number;
}

const KEYWORD_INDEX: Record<string, IndexedKeyword[]> = (() => {
  const normalize = (k: string) => k.toLowerCase().normalize("NFC").trim();

  // Dedupe within each category first, so a keyword listed twice by accident
  // (and there were three) cannot be counted twice.
  const deduped: Record<string, string[]> = {};
  for (const [code, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    deduped[code] = [...new Set(keywords.map(normalize))].filter(Boolean);
  }

  const categoryCount = new Map<string, number>();
  for (const keywords of Object.values(deduped)) {
    for (const keyword of keywords) {
      categoryCount.set(keyword, (categoryCount.get(keyword) ?? 0) + 1);
    }
  }

  const foldedFor = (keyword: string): string[] => {
    const folded = romanKey(keyword);
    if (!folded) return [];
    const parts = folded.split(" ").filter(Boolean);
    // Guard on the longest part, not the total: a phrase whose every word is
    // two letters is still noise.
    if (!parts.some((part) => part.length >= ROMAN_MIN_KEY_LENGTH)) return [];
    return parts;
  };

  // Folding is many-to-one, so a folded key can be shared by categories whose
  // original spellings were distinct. Count those collisions separately.
  const romanCount = new Map<string, number>();
  for (const keywords of Object.values(deduped)) {
    const seen = new Set<string>();
    for (const keyword of keywords) {
      const parts = foldedFor(keyword);
      if (parts.length === 0) continue;
      seen.add(parts.join(" "));
    }
    for (const key of seen) romanCount.set(key, (romanCount.get(key) ?? 0) + 1);
  }

  return Object.fromEntries(
    Object.entries(deduped).map(([code, keywords]) => [
      code,
      keywords.map((keyword) => {
        const romanParts = foldedFor(keyword);
        return {
          keyword,
          isMultiWord: keyword.includes(" "),
          isNonAscii: [...keyword].some((ch) => ch.charCodeAt(0) > 127),
          specificity: 1 / (categoryCount.get(keyword) ?? 1),
          romanParts,
          romanSpecificity:
            romanParts.length === 0
              ? 0
              : 1 / (romanCount.get(romanParts.join(" ")) ?? 1),
        };
      }),
    ]),
  );
})();

// --- Types ------------------------------------------------------------------

export interface CategoryMatch {
  category: Category;
  score: number;
  matchedKeywords: string[];
}

export interface CategoryScore extends CategoryMatch {
  /** True for the winner when it cleared both `MIN_SCORE` and `MIN_MARGIN`. */
  confident: boolean;
}

// --- Text handling ----------------------------------------------------------

interface Token {
  text: string;
  start: number;
  end: number;
}

/**
 * Splits into script-aware words, keeping combining marks and ZWJ/ZWNJ so
 * Indic clusters ("गड्ढा") survive intact, and recording offsets so a match
 * can be traced back to the region of text that produced it.
 */
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /[\p{L}\p{N}\p{M}‌‍]+/gu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    tokens.push({ text: match[0], start: match.index, end: match.index + match[0].length });
  }
  return tokens;
}

function levenshteinWithin(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (a === b) return 0;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowBest = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      current.push(value);
      if (value < rowBest) rowBest = value;
    }
    // Every remaining row can only grow the distance — bail out early.
    if (rowBest > max) return max + 1;
    previous = current;
  }
  return previous[b.length];
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Token indices that sit under a negator within the same clause, e.g. the
 * "pothole" in "there is no pothole here".
 */
function findNegatedTokens(text: string, tokens: Token[]): Set<number> {
  const negated = new Set<number>();

  for (let i = 0; i < tokens.length; i++) {
    if (!NEGATORS.has(tokens[i].text)) continue;

    for (let j = i + 1; j < tokens.length; j++) {
      const gap = text.slice(tokens[j - 1].end, tokens[j].start);
      if (CLAUSE_BREAKING_PUNCTUATION.test(gap)) break;
      if (CLAUSE_BREAKERS.has(tokens[j].text)) break;
      if (j - i > NEGATION_LOOKBACK_TOKENS) break;
      negated.add(j);
    }
  }

  return negated;
}

// --- Matching ---------------------------------------------------------------

interface Span {
  keyword: string;
  score: number;
  /** Token indices this match covers. */
  tokens: number[];
  isMultiWord: boolean;
}

function tokensInRange(tokens: Token[], start: number, end: number): number[] {
  const covered: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].start < end && tokens[i].end > start) covered.push(i);
  }
  return covered;
}

function findExactSpans(
  text: string,
  tokens: Token[],
  entry: IndexedKeyword,
): Span | null {
  const { keyword, isMultiWord, isNonAscii, specificity } = entry;

  let start: number;
  let end: number;

  if (isNonAscii) {
    // Latin word boundaries (\W) are meaningless for Indic scripts, so these
    // match by substring.
    start = text.indexOf(keyword);
    if (start === -1) return null;
    end = start + keyword.length;
  } else {
    const boundary = new RegExp(`(?:^|\\W)(${escapeRegex(keyword)})(?:$|\\W)`);
    const match = boundary.exec(text);
    if (!match) return null;
    start = match.index + match[0].indexOf(match[1]);
    end = start + match[1].length;
  }

  const base = isMultiWord
    ? isNonAscii
      ? SCORE_PHRASE_NON_ASCII
      : SCORE_PHRASE
    : isNonAscii
      ? SCORE_WORD_NON_ASCII
      : SCORE_WORD;

  return {
    keyword,
    score: base * specificity,
    tokens: tokensInRange(tokens, start, end),
    isMultiWord,
  };
}

/**
 * Matches a keyword against the description through the transliteration fold,
 * so native script and every common romanisation of the same word meet in the
 * middle. Runs only when nothing matched exactly anywhere — see rule 2 in the
 * module docstring.
 */
function findRomanSpan(romanTokens: string[], entry: IndexedKeyword): Span | null {
  const { keyword, romanParts, romanSpecificity } = entry;
  if (romanParts.length === 0) return null;

  for (let i = 0; i + romanParts.length <= romanTokens.length; i++) {
    let hit = true;
    for (let k = 0; k < romanParts.length; k++) {
      if (romanTokens[i + k] !== romanParts[k]) {
        hit = false;
        break;
      }
    }
    if (!hit) continue;

    const isMultiWord = romanParts.length > 1;
    return {
      keyword,
      score: (isMultiWord ? SCORE_ROMAN_PHRASE : SCORE_ROMAN) * romanSpecificity,
      tokens: Array.from({ length: romanParts.length }, (_, k) => i + k),
      isMultiWord,
    };
  }
  return null;
}

function findFuzzySpan(tokens: Token[], entry: IndexedKeyword): Span | null {
  const { keyword, isMultiWord, specificity } = entry;
  if (isMultiWord || keyword.length < FUZZY_MIN_KEYWORD_LENGTH) return null;

  const maxDistance = keyword.length >= FUZZY_DISTANCE_2_MIN_LENGTH ? 2 : 1;

  for (let i = 0; i < tokens.length; i++) {
    if (levenshteinWithin(tokens[i].text, keyword, maxDistance) <= maxDistance) {
      return {
        keyword,
        score: SCORE_FUZZY * specificity,
        tokens: [i],
        isMultiWord: false,
      };
    }
  }
  return null;
}

/**
 * Sums a category's spans, counting each *region of text* once: phrases always
 * count, and a single-word hit is dropped if its word is already accounted for
 * by a stronger match. This is what stops "pothole" + "potholes" from scoring
 * twice for one word, and stops a longer synonym list from winning on length.
 */
function scoreSpans(spans: Span[]): { score: number; matchedKeywords: string[] } {
  const covered = new Set<number>();
  const matchedKeywords: string[] = [];
  let score = 0;

  const phrases = spans.filter((s) => s.isMultiWord);
  const words = spans.filter((s) => !s.isMultiWord).sort((a, b) => b.score - a.score);

  for (const span of phrases) {
    score += span.score;
    matchedKeywords.push(span.keyword);
    for (const t of span.tokens) covered.add(t);
  }

  for (const span of words) {
    if (span.tokens.some((t) => covered.has(t))) continue;
    score += span.score;
    matchedKeywords.push(span.keyword);
    for (const t of span.tokens) covered.add(t);
  }

  return { score, matchedKeywords };
}

function keywordsFor(category: Category): IndexedKeyword[] {
  // `code` is required by the contract, but a stale mock or a partially typed
  // fixture can still be missing it — fall back rather than silently matching
  // nothing at all.
  const code = category.code as string | undefined;
  if (code && KEYWORD_INDEX[code]) return KEYWORD_INDEX[code];

  const fallback = CODE_BY_SEEDED_NAME[category.name?.toLowerCase().trim() ?? ""];
  return (fallback && KEYWORD_INDEX[fallback]) || [];
}

/**
 * Scores every category against the description, best first.
 *
 * Exposed for tests, diagnostics, and any UI that wants to offer runners-up.
 * Prefer {@link matchCategory} for the "which category should we pre-select"
 * question — it applies the confidence rules.
 */
export function rankCategories(
  description: string,
  categories: Category[],
): CategoryScore[] {
  if (!description || description.trim().length === 0) return [];

  const text = description.toLowerCase().normalize("NFC");
  const tokens = tokenize(text);
  const negatedTokens = findNegatedTokens(text, tokens);

  const usable = (span: Span | null): Span | null =>
    span && span.tokens.length > 0 && !span.tokens.some((t) => negatedTokens.has(t))
      ? span
      : null;

  const scoreTier = (finder: (entry: IndexedKeyword) => Span | null) =>
    categories.map((category) => {
      const spans: Span[] = [];
      for (const entry of keywordsFor(category)) {
        const span = usable(finder(entry));
        if (span) spans.push(span);
      }
      const { score, matchedKeywords } = scoreSpans(spans);
      return { category, score, matchedKeywords };
    });

  // Tier 1: exact phrases and whole words.
  let scored = scoreTier((entry) => findExactSpans(text, tokens, entry));

  // Tier 2: transliteration. A citizen writing "gadda" (or गड्ढा, or ಗುಂಡಿ)
  // is naming the thing exactly, just not in a spelling the lexicon happens
  // to list — so this sits above typo tolerance and below an exact hit.
  if (scored.every((s) => s.score === 0)) {
    const romanTokens = tokens.map((token) => romanKey(token.text));
    scored = scoreTier((entry) => findRomanSpan(romanTokens, entry));
  }

  // Tier 3: typo tolerance — only when nothing matched exactly *anywhere*, so
  // a near-miss can never outrank real evidence in another category.
  if (scored.every((s) => s.score === 0)) {
    scored = scoreTier((entry) => findFuzzySpan(tokens, entry));
  }

  const ranked = scored
    .filter((s) => s.matchedKeywords.length > 0)
    .map((s) => ({ ...s, score: Number(s.score.toFixed(2)), confident: false }))
    .sort((a, b) => b.score - a.score);

  if (ranked.length > 0) {
    const runnerUp = ranked[1]?.score ?? 0;
    ranked[0].confident =
      ranked[0].score >= MIN_SCORE && ranked[0].score - runnerUp >= MIN_MARGIN;
  }

  return ranked;
}

/**
 * The category to pre-select for a description, or `null` to leave the choice
 * to the citizen.
 *
 * Returns a result *only* when the evidence is unambiguous — abstaining is the
 * safe outcome here, since the citizen confirms the category either way.
 */
export function matchCategory(
  description: string,
  categories: Category[],
): CategoryMatch | null {
  const [best] = rankCategories(description, categories);
  if (!best || !best.confident) return null;
  return { category: best.category, score: best.score, matchedKeywords: best.matchedKeywords };
}
