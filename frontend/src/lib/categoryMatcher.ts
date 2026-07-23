import type { Category } from "@/types/api";

/**
 * Super-comprehensive, deterministic offline keyword matcher with Fuzzy Search support.
 * Audited for exact keyphrases, Indic scripts (Hindi, Bengali, Tamil, Telugu, Gujarati,
 * Kannada, Malayalam, Punjabi, Odia, Marathi), Hinglish/transliterations, single-word anchors,
 * and minor typographical errors via Levenshtein distance.
 */
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  Pothole: [
    // English
    "pothole", "potholes", "hole in road", "road hole", "crater", "craters",
    "broken road", "pit", "pits", "damaged asphalt", "tar road damage", "uneven road",
    // Hinglish & Transliterations
    "gaddha", "gaddhe", "gadday", "gadda", "gadde", "khadda", "khadde", "khadday",
    "khatta", "khatte", "sadak toot", "rasta kharab", "sadak me gaddha", "gaddhe hai",
    "sadak kharab", "kuzhi", "gundhi", "gado", "toaa", "khaddo",
    // Native Scripts
    "गड्ढा", "गड्ढे", "सड़क में गड्ढा", "खड्डा", "खड्डे", "सड़क टूटी",
    "গর্ত", "রাস্তার গর্ত", "குழி", "பள்ளம்", "ரோட்டு குழி", "சாலை குழி",
    "గుంత", "గుంతలు", "రోడ్డు గుంత", "ખાડો", "કાણું", "રસ્તાનો ખાડો",
    "ಗುಂಡಿ", "ತಗ್ಗು", "ರಸ್ತೆ ಗುಂಡಿ", "കുഴി", "റോഡിലെ കുഴി", "ਟੋਆ", "ਸੜਕ ਵਿੱਚ ਟੋਆ",
    "ଗାତ", "ରାସ୍ତା ଗାତ"
  ],
  "Open Manhole": [
    // English
    "manhole", "man hole", "drain cover", "sewer cover", "open hole", "missing cover",
    "chamber cover", "open drain", "chamber open", "uncovered drain", "danger hole", "chamber", "drain",
    // Hinglish & Transliterations
    "naali", "naala", "nala", "nali", "dhakkan", "dhakan", "gutter", "guttar", "gutar",
    "gutter khula", "naali khuli", "dhakkan missing", "chamber khula",
    "menhol", "drainage hole",
    // Native Scripts
    "मैनहोल", "ढक्कन खुला", "खुला नाला", "गटर खुला", "चेम्बर", "चेंबर",
    "ম্যানহোল", "ড্রেন কভার", "மேன்ஹோல்", "மூடி இல்லை", "திறந்த சாக்கடை", "சாக்கடை",
    "మ్యాన్‌హోల్", "మురుగు మూత", "మురుగుడు", "મેનહોલ", "ગટર ઢાંકણ",
    "ಮ್ಯಾನ್‌ಹೋಲ್", "ಚರಂಡಿ ಮುಚ್ಚಳ", "മാൻഹോൾ", "ഓട മൂടി", "ചാമ്പർ",
    "ਮੈਨਹੋਲ", "ਗਟਰ ਦਾ ਢੱਕਣ", "ମାନହୋଲ", "ନାଳ ଢାଙ୍କୁଣୀ"
  ],
  "Broken Street Light": [
    // English
    "street light", "streetlight", "streetlights", "lamp", "lamppost", "flicker",
    "flickering", "dark at night", "no light", "light not working", "bulb broken",
    "dark street", "darkness", "pole light", "bulb",
    // Hinglish & Transliterations
    "andhera", "andhera hai", "batti band", "light kharab", "light nahi jal rahi",
    "light off", "pole light off", "batti kharab", "light nahi hai", "khamba", "batti", "lightu",
    // Native Scripts
    "स्ट्रीट लाइट", "बत्ती खराब", "अंधेरा", "लाइट नहीं जल रही", "बत्ती", "खंभा",
    "স্ট্রিট লাইট", "বাতি বন্ধ", "আলো", "தெரு விளக்கு", "மின்விளக்கு எரியவில்லை", "வெளிச்சம்",
    "వీధి దీపం", "లైటు వెలగడం లేదు", "వెలుగు", "સ્ટ્રીટ લાઇટ", "લાઇટ બંધ છે",
    "ಬೀದಿ ದೀಪ", "ದೀಪ ಉರಿಯುತ್ತಿಲ್ಲ", "തെരുവ് വിളക്ക്", "വിളക്ക് കത്തുന്നില്ല",
    "ਸਟਰੀਟ ਲਾਈਟ", "ਲਾਈਟ ਖਰਾਬ", "ਰਾସ୍ତା ବਤੀ", "ବତି ଜଳୁନାହିଁ"
  ],
  "Garbage Overflow": [
    // English
    "garbage", "trash", "waste", "bin", "dustbin", "dumpster", "rubbish", "litter",
    "stink", "foul smell", "smelly", "smell", "overflowing bin", "waste accumulation",
    // Hinglish & Transliterations
    "kachra", "kachre", "kachra gadi", "kooda", "kuda", "kudadan", "gandagi", "kuchra",
    "kachra dher", "kachra overflow", "kuda fela", "badbu", "badboo", "smell aa rahi",
    // Native Scripts
    "कचरा", "कूड़ा", "गंदगी", "बदबू", "कूड़ेदान फुल", "कूड़ेदान", "डस्टबिन",
    "আবর্জনা", "ময়লা", "দুর্গন্ধ", "குப்பை", "துர்நாற்றம்", "குப்பை தொட்டி",
    "చెత్త", "దుర్వాసన", "చెత్త కుండీ", "કચરો", "દુર્ગંધ",
    "ಕಸ", "ದುರ್ವಾಸನೆ", "ಕಸದ ತೊಟ್ಟಿ", "ಕಸದತೊಟ್ಟಿ", "മാലിന്യം", "ദുർഗന്ധം", "മാലിന്യനിക്ഷേപം",
    "ਕੂੜਾ", "ਬੱਦਬੂ", "ଆବର୍ଜନା", "ଦୁର୍ଗନ୍ଧ"
  ],
  "Water Leakage": [
    // English
    "water leak", "water leakage", "pipe burst", "leaking pipe", "water wastage",
    "leak", "leaking", "broken pipe", "water pipeline", "water gushing", "main pipe leak",
    "pipeline", "pipe", "wastage",
    // Hinglish & Transliterations
    "pani leak", "paani leak", "pani beh raha", "pipe phat gaya", "pani waste",
    "piping leak", "jal leak", "nal", "nall",
    // Native Scripts
    "पानी का रिसाव", "पानी लीक", "पाइप फूला", "पानी बह रहा है", "पाइप", "नल", "सप्लाई",
    "পানির লিকেজ", "পাইপ ফেটে গেছে", "தண்ணீர் கசிவு", "குழாய் உடைப்பு", "குழாய்",
    "నీటి లీకేజీ", "పైపు పగిలింది", "పైపు", "પાણી લીકેજ", "પાઇપ લીકેજ", "પાણી",
    "ನೀರು ಸೋರಿಕೆ", "ಪೈಪ್ ಒಡೆದಿದೆ", "വെള്ളം ചോർച്ച", "പൈപ്പ് പൊട്ടി",
    "ਪਾਣੀ ਦਾ ਰਿਸਾਅ", "ਪਾਈਪ ਲੀਕ", "ਪାଣି ଲିକେଜ", "ପାଇପ୍ ଫାଟିଛି"
  ],
  "Drainage Overflow": [
    // English
    "drain", "drainage", "waterlog", "waterlogging", "logging", "logged", "storm water",
    "stormwater", "overflowing drain", "flooded street", "flooded", "standing water",
    "blocked drain", "dirty water road",
    // Hinglish & Transliterations
    "naali overflow", "nala overflow", "gutar overflow", "jal bharav", "jalbharav",
    "pani bhara", "rasta jam", "paani bhara hai", "gatarr", "nalah",
    // Native Scripts
    "नाला", "नाली", "जलभराव", "गटार", "पानी भरा है", "नाली ओवरफ्लो",
    "নর্দমা", "জলাবদ্ধতা", "வடிகால்", "தெருவில் தண்ணீர்", "வெள்ளம்",
    "మురుగు కాలువ", "కాలువ", "నీరు నిలిచింది", "ગટર", "પાણી ભરાયું",
    "ಚರಂಡಿ", "ನೀರು ನಿಂತಿದೆ", "ഓട", "വെള്ളക്കെട്ട്",
    "ਨਾਲੀ", "ਪਾਣੀ ਭਰਿਆ", "ਨਾଳ", "ଜଳବନ୍ଦୀ"
  ],
  "Sewage Blockage": [
    // English
    "sewage", "sewer", "sewerage", "blockage", "choked", "sewer line blocked", "backflow",
    "choked sewer", "foul sewage", "sewage overflow", "toilet waste",
    // Hinglish & Transliterations
    "seavage", "sewer jam", "gutar band", "gatar choke", "sewer blockage",
    "ganda pani", "ganda paani", "gutter", "guttar", "gutar", "ganda",
    // Native Scripts
    "सीवेज", "गटर बंद", "सीवर चोक", "गंदा पानी", "सीवर", "गटर", "बदबू",
    "সাঁডপাণী", "সেপটিক পাইপ", "கழிவுநீர்", "சாக்கடை அடைப்பு", "கழிவு",
    "మురుగునీరు", "డ్రైనేజీ బ్లాక్", "మురుగు", "ગટર વ્યવસ્થા", "ગટર બ્લોક",
    "ಕೊಳಚೆ ನೀರು", "ಚರಂಡಿ ಬ್ಲಾಕ್", "മലിനജലം", "ഓട അടഞ്ഞു",
    "ਗੰਦਾ ਪਾਣੀ", "ਸੀਵਰ ਬਲਾਕ", "ମଇଳା ପାଣି", "ସିୱେଜ୍ ବ୍ଲକ୍"
  ],
  "Damaged Footpath": [
    // English
    "footpath", "pavement", "sidewalk", "tiles", "paver blocks", "broken tiles",
    "walkway", "pedestrian track", "broken footpath", "paver",
    // Hinglish & Transliterations
    "footpath kharab", "pedal chalne ka rasta", "tiles tuti", "footpath toot gaya",
    "pavement broken", "patri", "paver",
    // Native Scripts
    "फुटपाथ", "पैदल पथ", "टाइल्स टूटी", "पैट्री", "पटरी", "टाइल्स",
    "ফুটপাথ", "ফুটপাত", "পাকা পথ", "நடைபாதை", "நடைபாதை கல் உடைந்தது",
    "కాలిబాట", "ఫుట్‌పాత్", "పుట్‌పాత్", "ફૂટપાથ", "પેવર બ્લોક broken",
    "ಪಾದಚಾರಿ ಮಾರ್ಗ", "ಫುಟ್‌ಪಾತ್", "ಕಾಲುದಾರಿ", "നടപ്പാത", "പാതയോരം",
    "ਫੁੱਟਪਾਥ", "ପାଦଚାରୀ ପଥ"
  ],
  "Fallen Tree or Branch": [
    // English
    "tree", "branch", "fallen tree", "tree down", "blocking road tree",
    "uprooted tree", "broken branch", "tree fell", "branches",
    // Hinglish & Transliterations
    "ped", "perh", "ped gira", "pedh gira", "paudha", "jhadd", "dali toot gayi",
    "ped raste pe", "jhad padle", "gaach", "dali", "taani",
    // Native Scripts
    "पेड़ गिरा", "पेड़", "टहनी", "डाली टूटी", "पेड़ गिर गया", "डाली", "पौधा",
    "গাছ পড়েছে", "গাছের ডাল", "গাছ", "மரம் விழுந்தது", "கிளை முறிந்தது", "மரம்", "கிளை",
    "చెట్టు పడింది", "కొమ్మ విరిగింది", "చెట్టు", "కొమ్మ", "ઝાડ પડ્યું", "ડાખી તૂટી", "ઝાડ",
    "ಮರ ಬಿದ್ದಿದೆ", "ಕೊಂಬೆ ಬಿದ್ದಿದೆ", "ಮರ", "മരം വീണു", "ചില്ല പൊട്ടി", "മരം", "ചില്ല",
    "ਦਰੱਖਤ ਡਿੱਗਿਆ", "ਟਾਹਣੀ", "ਦਰੱਖਤ", "ଗଛ ପଡ଼ିଛି", "ଡାଳ ଭାଙ୍ଗିଛି", "ଗଛ"
  ],
  "Stray Animal Nuisance": [
    // English
    "dog", "doggie", "dogs", "stray", "stray dog", "cattle", "cow", "cows", "ghode", "bull", "animal",
    "dog bite", "monkeys", "monkey", "stray pigs", "pigs", "aggressive dog", "rabies risk",
    "animal attack", "rabies",
    // Hinglish & Transliterations
    "kutta", "kutte", "kuttay", "gaay", "gay", "ghode", "sadak pe gaay", "awara kutta", "janwar",
    "monkeys trouble", "kutta kata", "dog menace", "bandar", "saand",
    // Native Scripts
    "आवारा कुत्ता", "आवारा जानवर", "गाय", "कुत्ते काटते हैं", "कुत्ता", "कुत्ते", "बंदर", "सांड", "सांड़",
    "ভবঘুরে কুকুর", "গরু", "தெரு நாய்", "மாடு", "நாய் கடி", "நாய்",
    "వీధి కుక్క", "ఆవు", "కుక్క కాటు", "కుక్క", "రખડતું કૂતરું", "ગાય",
    "ಬೀದಿ ನಾಯಿ", "ಸಾಕುಪ್ರಾಣಿ", "ನಾಯಿ", "തെരുവ് നായ", "പശു", "നായ",
    "ਅਵਾਰਾ ਕੁੱਤਾ", "ਗਾਂ", "ਰਾସ୍ਤਾ ਕੁକୁਰ", "ଗାଈ"
  ],
  "Illegal Dumping": [
    // English
    "dumping", "debris", "construction waste", "illegal dump", "malba",
    "building waste", "dumping yard", "unauthorized dumping", "concrete waste", "rubble",
    // Hinglish & Transliterations
    "malba", "malwa", "kaccha kachra", "building ka kachra", "dher laga hai",
    "illegal kachra", "debris overflow", "dher",
    // Native Scripts
    "मलबा", "अवैध कचरा", "निर्माण सामग्री", "मलबे", "ढेर",
    "ধ্বংসাবশেষ", "নির্মাণ বর্জ্য", "இடிபாடு", "கட்டுமானக் கழிவு", "கழிவு",
    "శిథిలాలు", "భవన వ్యర్థాలు", "వ్యర్థాలు", "કાટમાળ",
    "ಅವಶೇಷ", "ಕಟ್ಟಡದ ತ್ಯಾಜ್ಯ", "ಅവശಿಷ್ಟം", "കെട്ടിട അവശിഷ്ടങ്ങൾ",
    "ਮਲਬਾ", "ମଲଵਾ", "ନିର୍ମାଣ ଆବର୍ଜନା"
  ],
  "Traffic Signal Malfunction": [
    // English
    "traffic signal", "traffic light", "signal", "junction light", "red light",
    "signal broken", "signal not working", "traffic jam signal", "blinking signal", "junction",
    // Hinglish & Transliterations
    "signal kharab", "traffic light band", "red light not working", "chauraha signal",
    "traffic jam", "light kharab hai", "chauraha", "chaurahe",
    // Native Scripts
    "ट्रैफिक सिग्नल", "सिग्नल खराब", "रेड लाइट बंद", "सिग्नल", "चौराहा",
    "ট্রাফিক সিগন্যাল", "போக்குவரத்து সিগন্যাল", "சிக்னல் வேலை செய்யவில்லை", "சிக்னல்",
    "ట్రాఫిక్ సిగ్నల్", "సిగ్నል పనిచేయడం లేదు", "సిగ్నల్", "ટ્રાફિક સિગ્નલ", "સિગ્નલ બંધ છે",
    "ಟ್ರಾಫಿಕ್ ಸಿಗ್ನಲ್", "ಸಿಗ್ನಲ್ ಕೆಲಸ ಮಾಡುತ್ತಿಲ್ಲ", "ട്രാഫിക് സിഗ്നൽ", "സിഗ്നൽ തകരാർ",
    "ਟ੍ਰੈਫਿਕ ਸਿਗਨਲ", "ଟ୍ରାଫିକ ସିଗନାଲ"
  ],
};

// Standard dictionary normalization on load
const NORMALIZED_CATEGORY_KEYWORDS: Record<string, string[]> = Object.fromEntries(
  Object.entries(CATEGORY_KEYWORDS).map(([cat, keywords]) => [
    cat,
    keywords.map((k) => k.toLowerCase().normalize("NFC").trim()),
  ])
);

export interface CategoryMatch {
  category: Category;
  score: number;
  matchedKeywords: string[];
}

/**
 * Fast Levenshtein distance algorithm for client-side fuzzy typo detection.
 */
function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Tokenizes text into individual words, stripping punctuation while preserving
 * letters/digits from any script (Latin, Devanagari, Bengali, Tamil, Telugu,
 * Gujarati, Kannada, Malayalam, Gurmukhi, Odia, ...).
 */
function tokenize(text: string): string[] {
  return text
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
}

/**
 * Evaluates keyword match against full description and individual word tokens:
 * - Exact / Multi-word phrase hit: 2.0 - 2.5 score
 * - Boundary-safe single word hit: 1.0 score
 * - Fuzzy Levenshtein typo hit: 0.6 score
 */
function evaluateKeywordMatch(
  text: string,
  tokens: string[],
  keyword: string
): { isMatch: boolean; score: number } {
  const isMultiWord = keyword.includes(" ");

  // 1. Exact phrase or boundary-safe word check
  const isNonAscii = [...keyword].some((ch) => ch.charCodeAt(0) > 127);
  if (isNonAscii) {
    if (text.includes(keyword)) {
      return { isMatch: true, score: isMultiWord ? 2.5 : 1.5 };
    }
  } else {
    const boundaryRegex = new RegExp(`(?:^|\\W)${escapeRegex(keyword)}(?:$|\\W)`, "i");
    if (boundaryRegex.test(text)) {
      return { isMatch: true, score: isMultiWord ? 2.0 : 1.0 };
    }
  }

  // 2. Tokenized Fuzzy match for single words (e.g., "pothol" -> "pothole")
  if (!isMultiWord && keyword.length >= 4) {
    const maxAllowedDistance = keyword.length <= 5 ? 1 : 2;

    for (const token of tokens) {
      if (Math.abs(token.length - keyword.length) <= maxAllowedDistance) {
        const dist = levenshteinDistance(token, keyword);
        if (dist <= maxAllowedDistance) {
          return { isMatch: true, score: 0.6 };
        }
      }
    }
  }

  return { isMatch: false, score: 0 };
}

/**
 * Offline, client-side category matching engine.
 */
export function matchCategory(
  description: string,
  categories: Category[]
): CategoryMatch | null {
  if (!description || description.trim().length === 0) {
    return null;
  }

  const normalizedText = description.toLowerCase().normalize("NFC");
  const tokens = tokenize(normalizedText);
  let bestMatch: CategoryMatch | null = null;

  for (const category of categories) {
    const keywords = NORMALIZED_CATEGORY_KEYWORDS[category.name] ?? [];
    const matchedKeywords: string[] = [];
    let totalCategoryScore = 0;

    for (const keyword of keywords) {
      const { isMatch, score } = evaluateKeywordMatch(normalizedText, tokens, keyword);

      if (isMatch) {
        matchedKeywords.push(keyword);
        totalCategoryScore += score;
      }
    }

    if (matchedKeywords.length > 0 && (!bestMatch || totalCategoryScore > bestMatch.score)) {
      bestMatch = {
        category,
        score: Number(totalCategoryScore.toFixed(2)),
        matchedKeywords,
      };
    }
  }

  return bestMatch;
}
