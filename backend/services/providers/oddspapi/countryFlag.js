/**
 * OddsPapi has no flag URLs. Map `categorySlug` ("england", "europe") to a
 * flagcdn code — the same CDN the frontend already uses for language flags.
 */

const FLAGCDN = "https://flagcdn.com/w40";

/** Home-nation and confederation slugs that are not ISO 3166-1 alpha-2. */
const SPECIAL = Object.freeze({
  england: "gb-eng",
  scotland: "gb-sct",
  wales: "gb-wls",
  "northern-ireland": "gb-nir",
  europe: "eu",
  international: "eu",
  world: "eu",
  uefa: "eu",
  "great-britain": "gb",
  "united-kingdom": "gb",
});

/** Common football-country slugs → ISO 3166-1 alpha-2 (flagcdn). */
const SLUG_TO_ISO = Object.freeze({
  albania: "al",
  algeria: "dz",
  andorra: "ad",
  angola: "ao",
  argentina: "ar",
  armenia: "am",
  australia: "au",
  austria: "at",
  azerbaijan: "az",
  bahrain: "bh",
  belarus: "by",
  belgium: "be",
  benin: "bj",
  bolivia: "bo",
  bosnia: "ba",
  "bosnia-and-herzegovina": "ba",
  botswana: "bw",
  brazil: "br",
  bulgaria: "bg",
  "burkina-faso": "bf",
  cameroon: "cm",
  canada: "ca",
  chile: "cl",
  china: "cn",
  "china-pr": "cn",
  colombia: "co",
  congo: "cg",
  "congo-dr": "cd",
  "dr-congo": "cd",
  "costa-rica": "cr",
  croatia: "hr",
  cyprus: "cy",
  "czech-republic": "cz",
  czechia: "cz",
  denmark: "dk",
  ecuador: "ec",
  egypt: "eg",
  "el-salvador": "sv",
  estonia: "ee",
  ethiopia: "et",
  "faroe-islands": "fo",
  finland: "fi",
  france: "fr",
  gabon: "ga",
  gambia: "gm",
  georgia: "ge",
  germany: "de",
  ghana: "gh",
  greece: "gr",
  guatemala: "gt",
  guinea: "gn",
  honduras: "hn",
  "hong-kong": "hk",
  hungary: "hu",
  iceland: "is",
  india: "in",
  indonesia: "id",
  iran: "ir",
  iraq: "iq",
  ireland: "ie",
  "republic-of-ireland": "ie",
  israel: "il",
  italy: "it",
  "ivory-coast": "ci",
  "cote-divoire": "ci",
  "cote-d-ivoire": "ci",
  jamaica: "jm",
  japan: "jp",
  jordan: "jo",
  kazakhstan: "kz",
  kenya: "ke",
  kosovo: "xk",
  kuwait: "kw",
  latvia: "lv",
  lebanon: "lb",
  liberia: "lr",
  libya: "ly",
  liechtenstein: "li",
  lithuania: "lt",
  luxembourg: "lu",
  malaysia: "my",
  mali: "ml",
  malta: "mt",
  mexico: "mx",
  moldova: "md",
  mongolia: "mn",
  montenegro: "me",
  morocco: "ma",
  mozambique: "mz",
  netherlands: "nl",
  "new-zealand": "nz",
  nicaragua: "ni",
  nigeria: "ng",
  "north-macedonia": "mk",
  macedonia: "mk",
  norway: "no",
  oman: "om",
  panama: "pa",
  paraguay: "py",
  peru: "pe",
  philippines: "ph",
  poland: "pl",
  portugal: "pt",
  qatar: "qa",
  romania: "ro",
  russia: "ru",
  rwanda: "rw",
  "saudi-arabia": "sa",
  senegal: "sn",
  serbia: "rs",
  singapore: "sg",
  slovakia: "sk",
  slovenia: "si",
  "south-africa": "za",
  "south-korea": "kr",
  "korea-republic": "kr",
  korea: "kr",
  spain: "es",
  sudan: "sd",
  sweden: "se",
  switzerland: "ch",
  syria: "sy",
  tanzania: "tz",
  thailand: "th",
  tunisia: "tn",
  turkey: "tr",
  uganda: "ug",
  ukraine: "ua",
  "united-arab-emirates": "ae",
  uae: "ae",
  uruguay: "uy",
  usa: "us",
  "united-states": "us",
  uzbekistan: "uz",
  venezuela: "ve",
  vietnam: "vn",
  zambia: "zm",
  zimbabwe: "zw",
});

export function normalizeCategorySlug(slug) {
  return String(slug || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/\s+/g, "-");
}

export function flagCodeForCategory(slug) {
  const key = normalizeCategorySlug(slug);
  if (!key) return null;
  if (SPECIAL[key]) return SPECIAL[key];
  if (SLUG_TO_ISO[key]) return SLUG_TO_ISO[key];
  if (/^[a-z]{2}$/.test(key)) return key;
  return null;
}

export function flagUrlForCategory(slug) {
  const code = flagCodeForCategory(slug);
  return code ? `${FLAGCDN}/${code}.png` : null;
}
