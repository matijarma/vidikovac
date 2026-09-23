// Decision 21: shared rejection-only lexemes. In rows (decision 20), a
// lexeme needs a disjoint partner in the SAME sentence; headers reject single
// hits. Sources match folded, lower-case Latin with whole-word boundaries. Examples are individual
// lexemes, not necessarily unsafe values. Never rewrite a displayed value.
//
// Inflection is deliberate: šalji / šaljete are verbs, Šaljić is a surname;
// otvori / otvarate are verbs, "Otvorene su prijave" is a programme description.
// Productive verb classes, not a list of complete attack sentences. Croatian
// stems include perfective/imperfective alternants; endings cover imperative,
// present, infinitive, participle and conditional/future (with auxiliaries).
import { ISO_4217_CODES } from './iso-4217';

const I = '(?:i|im|is|imo|ite|e|iti|it|io|ila|ilo|ili|ile|iv[a-z]*|uj[a-z]*)';
const A = '(?:a|am|as|amo|ate|aju|aj|ajte|ajmo|ati|at|ao|ala|alo|ali|ale)';
export const EXTERNAL_ACTION_CLASSES = [
  { id: 'confirm-submit', role: 'action',
    source: `(?:potvrd|potvrdj|dostav|priloz)${I}|(?:potvrdjuj|predaj)[a-z]*|preda(?:ti|t|o|la|lo|li|le)|potvrdi[a-z]*|(?:verificir|autentificir|autenticir)${A}|confirm(?:s|ed|ing)?|submit(?:s|ted|ting)?|authenticat(?:e|es|ed|ing)|verif(?:y|ies|ied|ying)|validat(?:e|es|ed|ing)`,
    examples: ['potvrdi', 'potvrđujemo', 'predajte', 'dostavili', 'autentificirajte', 'submitted', 'authenticating'] },
  { id: 'write-provide', role: 'action',
    source: `(?:iz)?diktir${A}|(?:na|za|pre|u|is)?pis(?:i|imo|ite|em|es|e|emo|ete|u|ati|at|ao|ala|alo|ali|ale)|(?:napis|zapis|prepis)${I}|(?:naved|otkriv|objav|obznan)${I}|(?:objavlj|otkriv)${A}|pruz${I}|pruzaj[a-z]*|daj(?:em|es|e|emo|ete|u|te|mo)?|da(?:ti|o|la|li|le)|writ(?:e|es|ing|ten)|wrote|typ(?:e|es|ed|ing)|provid(?:e|es|ed|ing)|disclos(?:e|es|ed|ing)|suppl(?:y|ies|ied|ying)|giv(?:e|es|ing|en)|gave`,
    examples: ['izdiktirati', 'diktirati', 'piši', 'pišemo', 'napisali', 'navedite', 'otkrivamo', 'pružite', 'written', 'providing', 'disclosed'] },
  { id: 'send-enter', role: 'action',
    source: `(?:u|po)?salj(?:i|ite|imo|em|es|e|emo|ete|u)|sl(?:ao|ala|ali|alo|ale|ati|at)|slanj[a-z]*|(?:po|pro)?sljedjuj[a-z]*|(?:pro)?slijed${I}|unij(?:eti|et|eo|ela|elo|eli|ele)|unos${I}|upisuj[a-z]*|dijel${I}|input(?:s|ted|ting)?|insert(?:s|ed|ing)?`,
    examples: ['slala', 'prosljeđujete', 'unosili', 'upisujte', 'inputting', 'inserted'] },
  { id: 'entry-submission', role: 'action',
    source: `(?:utipk|tipk|ukuc|ukucav|popunjav|ispunjav|dostavlj)${A}|(?:popun|ispun|zalijep|zaljep|predoc)${I}|(?:iz|pod|do|pre)nes(?:i|ite|imo|em|es|e|emo|ete|u)|(?:iz|pod|do|pre)nij(?:eti|et|ela|eli|elo|ele)|(?:iz|pod|do|pre)nio|past(?:e|es|ed|ing)|key(?:s|ed|ing)? in|fill(?:s|ed|ing)?`,
    examples: ['utipkajte', 'popunite', 'zalijepi', 'podnesi', 'predočite', 'paste', 'key in', 'filled'] },
  { id: 'deposit', role: 'action',
    source: `(?:deponir|depozitir)${A}|poloz${I}|polaz${I}|(?:u)?placuj[a-z]*|deposit(?:s|ed|ing)?|remit(?:s|ted|ting)?`,
    examples: ['deponiraj', 'položite', 'uplaćujte', 'deposit', 'remitted'] },
] as const;

export const EXTERNAL_SENSITIVE_LEXICON = [
  ...EXTERNAL_ACTION_CLASSES,
  // Nouns: credentials/codes, link/app/program targets, account/card targets.
  // "kod" is also a geographic preposition; on its own it is never evidence.
  { id: 'credentials', role: 'noun', source: 'lozink[a-z]*|zapork[a-z]*|sifr[a-z]*|pin(?:a|u|om|ovi|ove|ova|ovima)?|kod(?:a|u|om|ovi|ove|ova|ovima)?|password[a-z]*|passcode[a-z]*|code(?:s)?|otp|token[a-z]*|credential[a-z]*',
    examples: ['lozinka', 'šifru', 'PIN', 'kod', 'password', 'passcode', 'OTP', 'token'] },
  { id: 'links-apps', role: 'noun', source: 'poveznic[a-z]*|link(?:s|a|u|om|ovi|ove|ova|ovima)?|aplikacij[a-z]*|app(?:s|lication[a-z]*)?|program(?:a|u|om|i|e|ima)?|software',
    examples: ['poveznicu', 'link', 'aplikaciju', 'app', 'program', 'software'] },
  { id: 'accounts-cards', role: 'noun', source: 'racun(?:a|u|om|i|e|ima)?|account(?:s)?|kartic[a-z]*|card(?:s)?',
    examples: ['račun', 'account', 'karticom', 'card'] },
  { id: 'numbers', role: 'noun', source: 'broj(?:a|u|em|evi|eve|eva|evima)?|number(?:s)?|akreditiv[a-z]*|vjerodajnic[a-z]*',
    examples: ['broj', 'number', 'vjerodajnice'] },
  // Actions: disclosure/use, entry and sharing, in any person/mood. "javi" can
  // disclose a credential as well as contact somebody. No arbitrary imperative
  // or request phrase ("učini uslugu", "molimo") counts as an action here.
  { id: 'disclosure', role: 'action', source: 'posalj(?:i|ite|imo|em|es|e|emo|ete|u)|salj(?:i|ite|imo|em|es|e|emo|ete|u)|posla(?:t|ti|o|la|li|le|lo|h|smo|ste|n[a-z]*)|slati|proslijed[a-z]*|prosljed[a-z]*|unes(?:i|ite|imo|em|es|e|emo|ete|u|en[a-z]*)|unij(?:eti|ela|eli|ele|elo)|unio|unos(?:i|im|is|imo|ite|iti|io|ila|ili|ile|ilo|e)|upis(?:i|ite|imo|em|es|e|emo|ete|u|ati|ao|ala|ali|ale|alo|uje|ujem|ujes|ujemo|ujete|uju)|podijel[a-z]*|dijel(?:i|im|is|imo|ite|iti|io|ila|ili|ile|ilo|e)|prijav[a-z]* se|korist(?:i|im|is|imo|ite|iti|io|ila|ili|ile|ilo|e)|jav(?:i|im|is|imo|ite|iti|io|ila|ili|ile|ilo|e)|izgovor[a-z]*|rec(?:i|ite|imo)|rek(?:ao|la|li|le|lo)|otkri(?:j[a-z]*|ti|o|la|li|le|lo)|send(?:s|ing)?|sent|forward[a-z]*|enter(?:s|ed|ing)?|shar(?:e|es|ed|ing)|us(?:e|es|ed|ing)|reveal[a-z]*|tell(?:s|ing)?|told|log(?:s|ged|ging)? in|sign(?:s|ed|ing)? in',
    examples: ['pošaljem', 'šaljete', 'poslali', 'prosljeđuje', 'unijeti', 'unio', 'unosimo', 'upisao', 'podijelit', 'prijavio se', 'koristi', 'izgovori', 'reci', 'sending', 'forwarded', 'entered', 'shared', 'logged in'] },
  // Opening/downloading/installing/scanning are verbs, not the opening-state
  // adjective "otvoren". A scan/code pair is rejected even without a QR token.
  { id: 'open-install', role: 'action', source: 'klik(?:ni|nite|nimo|nem|nes|ne|nemo|nete|nu|nuti|nuo|nula|nuli|nule)|klik(?:a|am|as|amo|ate|aju|ati|ao|ala|ali|ale|alo)|click(?:s|ed|ing)?|otvor(?:i|im|is|imo|ite|iti|io|ila|ili|ile|ilo|e)|otvar(?:a|am|as|amo|ate|aju|ati|ao|ala|ali|ale|alo)|preuzm[a-z]*|preuz(?:eti|eo|ela|eli|ele|elo|ima[a-z]*)|instalir(?:a|am|as|amo|ate|aju|aj|ajte|ajmo|ati|ao|ala|ali|ale|alo)|skenir(?:a|am|as|amo|ate|aju|aj|ajte|ajmo|ati|ao|ala|ali|ale|alo)|scan(?:s|ned|ning)?|download(?:s|ed|ing)?|upload(?:s|ed|ing)?|install(?:s|ed|ing)?|open(?:s|ed|ing)?',
    examples: ['otvaraš', 'otvorili', 'preuzela', 'instaliramo', 'skenirao', 'scanned', 'downloaded', 'installing', 'open'] },
  // Payment verbs only: the activity nouns "plaćanje" / "payment" do NOT turn
  // "plaćanje karticom" into a request. A currency-number vector still rejects.
  { id: 'payment', role: 'action', source: '(?:u)?plat(?:i|im|is|imo|ite|iti|io|ila|ili|ile|ilo|e)|(?:u)?plac(?:a|am|as|amo|ate|aju|aj|ajte|ajmo|ati|ao|ala|ali|ale|alo)|uplacuj(?:em|es|e|emo|ete|u)|pay(?:s|ing)?|paid|transfer(?:s|red|ring)?|donir(?:a|am|as|amo|ate|aju|aj|ajte|ajmo|ati|ao|ala|ali|ale|alo)|donat(?:e|es|ed|ing)',
    examples: ['platio', 'platite', 'plaćaju', 'uplatila', 'uplaćujemo', 'pay', 'paid', 'transferred', 'donirajte', 'donate'] },
  // Contact verbs need a number/address-like target. A noun such as "kontakt"
  // or a standalone "javili ste se" does not supply that target.
  { id: 'contact', role: 'contact', source: 'nazov(?:i|ite|imo|em|es|e|emo|ete|u)|nazva(?:ti|o|la|li|le|lo)|zov(?:i|ite|imo|em|es|e|emo|ete|u)|pozov(?:i|ite|imo|em|es|e|emo|ete|u)|pozva(?:ti|o|la|li|le|lo)|jav(?:i|im|is|imo|ite|iti|io|ila|ili|ile|ilo|e)|javlj(?:a|am|as|amo|ate|aju|aj|ajte|ajmo|ati|ao|ala|ali|ale|alo)|kontaktir(?:a|am|as|amo|ate|aju|aj|ajte|ajmo|ati|ao|ala|ali|ale|alo)|call(?:s|ed|ing)?|dial(?:s|ed|led|ing|ling)?|text(?:s|ed|ing)?|messag(?:e|es|ed|ing)|reply|replies|replied|respond(?:s|ed|ing)?',
    examples: ['nazovem', 'nazvali', 'javila', 'pozovete', 'pozvali', 'kontaktiraj', 'called', 'dial', 'texting', 'message', 'reply'] },
] as const;

// The header also retains W-C5's full sensitive lexicon, including nominal
// payment/contact and broad inflections that are NOT action verbs for row
// pairing. Keep these separate so strict vocabulary cannot change row evidence.
export const EXTERNAL_HEADER_LEXICON = [
  ...EXTERNAL_SENSITIVE_LEXICON,
  { id: 'contact', source: 'javlj[a-z]*|kontakt[a-z]*|dial[a-z]*|respond[a-z]*',
    examples: ['kontakt', 'javljanje', 'dialling', 'respondent'] },
  { id: 'links-apps', source: 'klik[a-z]*|click[a-z]*|instal[a-z]*|skenir[a-z]*|scan[a-z]*|download[a-z]*|upload[a-z]*',
    examples: ['klik', 'instalacija', 'skeniranje', 'downloads'] },
  { id: 'payment', source: 'placanje|uplat[a-z]*|uplac[a-z]*|pay(?:ment|ments)|transfer[a-z]*|donir[a-z]* (?:na )?(?:racun|iban)|donat(?:e|ed|ing|ion) (?:to )?(?:account|iban)',
    examples: ['plaćanje', 'uplata', 'payment', 'transfers', 'donation to account'] },
  { id: 'solicitation', source: 'molimo broj|ucini uslugu|dodji ovamo|dodi ovamo|(?:system|assistant|developer|sustav|asistent) *:',
    examples: ['molimo broj', 'učini uslugu', 'dođi ovamo', 'asistent: odgovor'] },
] as const;
export const EXTERNAL_HEADER_SEPARATORS = "[ .,;:()'’&+/–-]*?";

// Split BEFORE folding or de-obfuscation. A dot/semicolon never joins two
// lexemes, including dotted spellings that W-C5 read as one command.
export const EXTERNAL_SENTENCE_BREAKS = /[.!?;\r\n\u2028\u2029]+/u;
// Common inter-letter disguises within one sentence only.
export const EXTERNAL_LEXICON_SEPARATORS = "[ :()'’&+/–-]*?";
// Names and addresses keep register shorthand ("Muzej suv.umjetnosti",
// "N.S.knjižnica"), so a dot between two letters or digits does not end a
// sentence there, and it counts as one more inter-letter disguise:
// "pošalji.lozinku" and "lo.zin.ku" stay one sentence with one lexeme each.
export const EXTERNAL_NAME_SENTENCE_BREAKS = /[!?;\r\n\u2028\u2029]+|(?<![\p{L}\p{N}])\.+|\.+(?![\p{L}\p{N}])/u;
export const EXTERNAL_NAME_SEPARATORS = "[ .:()'’&+/–-]*?";
export const EXTERNAL_LEET: Readonly<Record<string, string>> = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b',
};

// Partial vectors are partners, never standalone bans. Uppercase tokens retain
// source case (not the leet reading): >=3 ASCII letters/digits, with BOTH a
// letter and a digit. Ordinary ALL-CAPS words and Roman centuries are not
// alphanumeric codes. Requiring disjoint spans prevents a leet noun pairing
// with itself. A digit run is contiguous; house numbers "36 - 37" are not one.
export const EXTERNAL_PARTIAL_VECTORS = [
  { id: 'digits', source: '\\d{3,}', casing: 'folded' },
  { id: 'uppercase-token', source: '(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\\d)[A-Z0-9]{3,}', casing: 'original' },
  { id: 'alphanumeric-token', source: '(?=[a-z0-9]*[a-z])(?=[a-z0-9]*\\d)[a-z0-9]{3,}', casing: 'folded' },
  { id: 'web-marker', source: 'www|@', casing: 'folded' },
] as const;
// Contact targets: the word number, a partial numeric run, web/e-mail marker,
// or a street-like name followed by a house number (not arbitrary prose).
export const EXTERNAL_CONTACT_TARGETS = [
  { id: 'number-word', source: 'broj(?:a|u|em|evi|eve|eva|evima)?|number(?:s)?' },
  { id: 'contact-digits', source: '\\d(?:[ /()–-]*\\d){2,}' },
  { id: 'contact-address', source: '(?:www|@)|[a-z]+[ -]+\\d{1,3}[a-z]?' },
] as const;
// The rule is data, in evaluation order. Each pair requires two non-overlapping
// spans in the same sentence; neither order nor person/mood changes the rule.
export const EXTERNAL_PAIR_RULES = [
  { id: 'noun-action', left: 'noun', right: 'action' },
  { id: 'noun-contact', left: 'noun', right: 'contact' },
  { id: 'noun-token', left: 'noun', right: 'partial-vector' },
  { id: 'contact-target', left: 'contact', right: 'contact-target' },
] as const;

// A digit sequence is a contact/account vector unless the WHOLE sequence is a
// calendar date or a historical year range. There is no blanket "contains a
// year" exemption: 1809-1872-1234 and 4111 1111 1111 1111 remain vectors.
export const EXTERNAL_NUMERIC_DATA = [
  /^(?:1\d{3}|20\d{2})\.? *[-–] *(?:1\d{3}|20\d{2})\.?$/u,
  /^(?:[1-9]|0[1-9]|[12]\d|3[01])\. *(?:[1-9]|0[1-9]|1[0-2])\. *(?:1\d{3}|20\d{2})\.?$/u,
] as const;

// Exact GTFS place abbreviations, not arbitrary prefix exemptions for domains.
export const EXTERNAL_PLACE_ABBREVIATIONS = new Set([
  'spr.dubrava', 'zrt.fasizma', 'gl.kolodvor', 'g.stenjevec', 'g.breg-brezo',
  'j.jelacica', 'st.dom', 's.radic', 'd.dragonozec', 'mark.trnava',
  'ses.kraljev', 'ses.selnica', 's.bukevski',
  'sav.most', 'zap.kol', 'sv.josipa',
]);

const CURRENCY = `(?:€|\\$|£|¥|₣|₽|kn|eura|${ISO_4217_CODES.join('|').toLowerCase()})`;
const AMOUNT = '\\d(?:[\\d .,]*\\d)?';
const PAYMENT_AMOUNT = new RegExp(`(?:${AMOUNT} *${CURRENCY}(?![a-z])|(?<![a-z])${CURRENCY} *${AMOUNT})`, 'u');
// Payment nouns plus a number are structural even without a credential pair.
// Keep the evidence sentence-local and require a whole payment word.
const PAYMENT_NUMBER = /(?<![a-z])(?:isplata|uplata|payout|deposit|transfer)(?![a-z])[^.!?;\r\n]*\d|\d[^.!?;\r\n]*(?<![a-z])(?:isplata|uplata|payout|deposit|transfer)(?![a-z])/u;

export const EXTERNAL_VECTOR_PATTERNS = [
  { reason: 'link', source: /h[ .:/-]*t[ .:/-]*t[ .:/-]*p|w[ .-]*w[ .-]*w|@|(?<![a-z0-9])[a-z0-9-]+\.(?:cc|hr|com|net|org|eu|info|io|me|app|link|ly|dev|xyz|site|online|zip|test|co|uk|de|ru|biz|store|museum|travel|gov|edu)(?![a-z0-9])/u },
  { reason: 'phone', source: /(?<![a-z0-9])(?:t[ .-]*e[ .-]*l|telefon[a-z]*|telephone[a-z]*|phone|fax|sms)(?![a-z0-9])|0[ .()/–-]*8[ .()/–-]*0[ .()/–-]*0|\+[ .()/–-]*\d/u },
  { reason: 'account', source: /(?<![a-z0-9])(?:iban|i[ .-]+b[ .-]+a[ .-]+n|swift|bic)(?![a-z0-9])|(?<![a-z0-9])h[ .-]*r[ .-]*\d|(?<![a-z0-9])[a-z]{2}\d{2}(?:[ -]?[a-z0-9]){10,}/u },
  // `currency`: the one vector a row's proper name may carry a code for (external-text.ts maskNameCodes).
  { reason: 'payment', source: PAYMENT_AMOUNT, currency: true },
  { reason: 'payment', source: PAYMENT_NUMBER },
  { reason: 'phone', source: /(?<![a-z0-9])(?:broj(?:a|u|em|evi|eve|eva|evima)?|number(?:s)?)[ :()-]*\d+/u },
  { reason: 'qr', source: /(?<![a-z0-9])q[ .–-]*r(?![a-z0-9])/u },
] as const;
