import type { Category } from "@/types/api";

/**
 * Deterministic, fully offline, multilingual keyword matcher — no AI call,
 * no network, no downtime. Keyed by the exact Category.name strings the API
 * returns (there's no category code exposed over the wire). Keyword lists
 * cover English plus 10 major Indic languages (Hindi, Bengali, Tamil,
 * Telugu, Marathi, Gujarati, Kannada, Malayalam, Punjabi, Odia) so a
 * description written in any of them still gets a sensible preselection.
 *
 * These are best-effort, common-usage translations for a demo, not a
 * professionally vetted glossary — worth a native-speaker review before
 * relying on this in a real deployment.
 */
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  Pothole: [
    "pothole",
    "hole in the road",
    "road damage",
    "crater",
    "gaddha",
    "गड्ढा",
    "सड़क में गड्ढा",
    "खड्डा",
    "গর্ত",
    "குழி",
    "గుంత",
    "ખાડો",
    "ಗುಂಡಿ",
    "കുഴി",
    "ਟੋਆ",
    "ଗାତ",
  ],
  "Open Manhole": [
    "manhole",
    "drain cover",
    "sewer cover",
    "open hole",
    "naali",
    "dhakkan",
    "मैनहोल",
    "ढक्कन खुला",
    "ম্যানহোল",
    "மேன்ஹோல்",
    "మ్యాన్‌హోల్",
    "મેનહોલ",
    "ಮ್ಯಾನ್‌ಹೋಲ್",
    "മാൻഹോൾ",
    "ਮੈਨਹੋਲ",
    "ମାନହୋଲ",
  ],
  "Broken Street Light": [
    "street light",
    "streetlight",
    "lamp",
    "lamppost",
    "flicker",
    "dark at night",
    "स्ट्रीट लाइट",
    "बत्ती खराब",
    "স্ট্রিট লাইট",
    "বাতি",
    "தெரு விளக்கு",
    "వీధి దీపం",
    "સ્ટ્રીટ લાઇટ",
    "ಬೀದಿ ದೀಪ",
    "തെരുവ് വിളക്ക്",
    "ਸਟਰੀਟ ਲਾਈਟ",
    "ରାସ୍ତା ବତି",
  ],
  "Garbage Overflow": [
    "garbage",
    "trash",
    "waste",
    "bin",
    "rubbish",
    "कचरा",
    "कूड़ा",
    "আবর্জনা",
    "ময়লা",
    "குப்பை",
    "చెత్త",
    "કચરો",
    "ಕಸ",
    "മാലിന്യം",
    "ਕੂੜਾ",
    "ଆବର୍ଜନା",
  ],
  "Water Leakage": [
    "water leak",
    "pipe burst",
    "leaking pipe",
    "water wastage",
    "leak",
    "पानी का रिसाव",
    "पानी लीक",
    "पाणी गळती",
    "পানির লিকেজ",
    "தண்ணீர் கசிவு",
    "నీటి లీకేజీ",
    "પાણી લીકેજ",
    "ನೀರು ಸೋರಿಕೆ",
    "വെള്ളം ചോർച്ച",
    "ਪਾਣੀ ਦਾ ਰਿਸਾਅ",
    "ପାଣି ଲିକେଜ",
  ],
  "Drainage Overflow": [
    "drain",
    "drainage",
    "waterlogging",
    "storm water",
    "नाला",
    "जलभराव",
    "गटार",
    "নর্দমা",
    "জলাবদ্ধতা",
    "வடிகால்",
    "మురుగు కాలువ",
    "ગટર",
    "ಚರಂಡಿ",
    "ഓട",
    "ਨਾਲੀ",
    "ନାଳ",
  ],
  "Sewage Blockage": [
    "sewage",
    "sewer",
    "blockage",
    "सीवेज",
    "गटर बंद",
    "সাঁডপাণী",
    "கழிவுநீர்",
    "మురుగునీరు",
    "ગટર વ્યવસ્થા",
    "ಕೊಳಚೆ ನೀರು",
    "മലിനജലം",
    "ਗੰਦਾ ਪਾਣੀ",
    "ମଇଳା ପାଣି",
  ],
  "Damaged Footpath": [
    "footpath",
    "pavement",
    "sidewalk",
    "tiles",
    "फुटपाथ",
    "पैदल पथ",
    "ফুটপাথ",
    "நடைபாதை",
    "కాలిబాట",
    "ફૂટપાથ",
    "ಪಾದಚಾರಿ ಮಾರ್ಗ",
    "നടപ്പാത",
    "ਫੁੱਟਪਾਥ",
    "ପାଦଚାରୀ ପଥ",
  ],
  "Fallen Tree or Branch": [
    "tree",
    "branch",
    "fallen",
    "पेड़ गिरा",
    "टहनी",
    "झाड पडले",
    "গাছ পড়েছে",
    "மரம் விழுந்தது",
    "చెట్టు పడింది",
    "ઝાડ પડ્યું",
    "ಮರ ಬಿದ್ದಿದೆ",
    "മരം വീണു",
    "ਦਰੱਖਤ ਡਿੱਗਿਆ",
    "ଗଛ ପଡ଼ିଛି",
  ],
  "Stray Animal Nuisance": [
    "stray",
    "dog",
    "cattle",
    "animal",
    "bite",
    "आवारा कुत्ता",
    "आवारा जानवर",
    "ভবঘুরে কুকুর",
    "தெரு நாய்",
    "వీధి కుక్క",
    "રખડતું કૂતરું",
    "ಬೀದಿ ನಾಯಿ",
    "തെരുവ് നായ",
    "ਅਵਾਰਾ ਕੁੱਤਾ",
    "ରାସ୍ତା କୁକୁର",
  ],
  "Illegal Dumping": [
    "dumping",
    "debris",
    "construction waste",
    "illegal dump",
    "मलबा",
    "अवैध कचरा",
    "ধ্বংসাবশেষ",
    "இடிபாடு",
    "శిథిలాలు",
    "કાટમાળ",
    "ಅವಶೇಷ",
    "അവശിഷ്ടം",
    "ਮਲਬਾ",
    "ମଲଵା",
  ],
  "Traffic Signal Malfunction": [
    "traffic signal",
    "traffic light",
    "signal",
    "junction light",
    "ट्रैफिक सिग्नल",
    "सिग्नल खराब",
    "ট্রাফিক সিগন্যাল",
    "போக்குவரத்து சிக்னல்",
    "ట్రాఫిక్ సిగ్నల్",
    "ટ્રાફિક સિગ્નલ",
    "ಟ್ರಾಫಿಕ್ ಸಿಗ್ನಲ್",
    "ട്രാഫിക് സിഗ്നൽ",
    "ਟ੍ਰੈਫਿਕ ਸਿਗਨਲ",
    "ଟ୍ରାଫିକ ସିଗନାଲ",
  ],
};

export interface CategoryMatch {
  category: Category;
  score: number;
  matchedKeywords: string[];
}

/**
 * Scores every category by counting keyword hits in the description and
 * returns the best match, or null if nothing matched at all (citizen picks
 * manually in that case — never blocks, never "loading").
 */
export function matchCategory(
  description: string,
  categories: Category[],
): CategoryMatch | null {
  const text = description.toLowerCase();
  let best: CategoryMatch | null = null;

  for (const category of categories) {
    const keywords = CATEGORY_KEYWORDS[category.name] ?? [];
    const matched = keywords.filter((keyword) => text.includes(keyword.toLowerCase()));
    if (matched.length > 0 && (!best || matched.length > best.score)) {
      best = { category, score: matched.length, matchedKeywords: matched };
    }
  }

  return best;
}
