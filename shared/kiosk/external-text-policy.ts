// Rejection-only policy data. Sources match folded, lower-case Latin text with
// whole-word boundaries. Verb alternatives include indicative, conditional,
// participle and infinitive forms, not just imperatives. Never rewrite a value.
//
// Inflection is deliberate: šalji / šaljete are verbs, Šaljić is a surname;
// otvori / otvarate are verbs, "Otvorene su prijave" is a programme description.
export const EXTERNAL_SENSITIVE_LEXICON = [
  { id: 'credentials', source: 'lozink[a-z]*|sifr[a-z]*|pin(?:a|u|om|ovi|ove)?|kod(?:a|u|om|ovi|ove|ova|ovima)?|password[a-z]*|passcode[a-z]*|code(?:s)?|otp|token[a-z]*|credential[a-z]*|verification code|security code',
    examples: ['koristi lozinku', 'biste li poslali lozinku', 'upišem šifru', 'PIN', 'kod', 'password', 'passcode', 'OTP', 'token'] },
  { id: 'disclosure', source: 'posalj(?:i|ite|imo|em|es|e|emo|ete|u)|salj(?:i|ite|imo|em|es|e|emo|ete|u)|posla(?:t|ti|o|la|li|le|lo|h|smo|ste|n[a-z]*)|slati|proslijed[a-z]*|prosljed[a-z]*|unes(?:i|ite|imo|em|es|e|emo|ete|u|en[a-z]*)|unij(?:eti|ela|eli|ele|elo)|unio|unos(?:i|im|is|imo|ite|iti|io|ila|ili|ile|ilo|e)|upis(?:i|ite|imo|em|es|e|emo|ete|u|ati|ao|ala|ali|ale|alo|uje|ujem|ujes|ujemo|ujete|uju)|podijel[a-z]*|dijel(?:i|im|is|imo|ite|iti|io|ila|ili|ile|ilo|e)|prijav[a-z]* se|send(?:s|ing)?|sent|forward[a-z]*|enter(?:s|ed|ing)?|shar(?:e|es|ed|ing)|log(?:s|ged|ging)? in|sign(?:s|ed|ing)? in',
    examples: ['pošaljem podatke', 'šaljete podatke', 'poslali podatke', 'poslano', 'prosljeđuje podatke', 'unijeti podatke', 'unio podatke', 'uneseni podaci', 'unosimo podatke', 'upisao podatke', 'podijeljen podatak', 'prijavio se', 'sending details', 'forwarded details', 'entered details', 'shared details', 'logged in'] },
  { id: 'contact', source: 'nazov(?:i|ite|imo|em|es|e|emo|ete|u)|nazva(?:ti|o|la|li|le|lo)|zov(?:i|ite|imo|em|es|e|emo|ete|u)|pozov(?:i|ite|imo|em|es|e|emo|ete|u)|pozva(?:ti|o|la|li|le|lo)|jav(?:i|im|is|imo|ite|iti|io|ila|ili|ile|ilo|e)|javlj[a-z]*|kontakt[a-z]*|call(?:s|ed|ing)?|dial[a-z]*|text(?:s|ed|ing)?|messag(?:e|es|ed|ing)|reply|replies|replied|respond[a-z]*',
    examples: ['nazovem broj', 'nazvali broj', 'javila se', 'pozovete broj', 'pozvali broj', 'kontakt', 'called yesterday', 'dial', 'texting', 'message', 'please reply', 'could you reply'] },
  { id: 'links-apps', source: 'poveznic[a-z]*|link(?:s|a|u|om|ovi|ove|ova|ovima)?|klik[a-z]*|click[a-z]*|otvor(?:i|im|is|imo|ite|iti|io|ila|ili|ile|ilo|e)|otvar(?:a|am|as|amo|ate|aju|ati|ao|ala|ali|ale|alo)|preuzm[a-z]*|preuz(?:eti|eo|ela|eli|ele|elo|ima[a-z]*)|instal[a-z]*|skenir[a-z]*|scan[a-z]*|download[a-z]*|upload[a-z]*|open(?:s|ed|ing)? (?:the )?link',
    examples: ['otvaraš poveznicu', 'otvorili datoteku', 'preuzela aplikaciju', 'instalira program', 'skeniranje', 'scanned', 'downloaded', 'installing', 'open the link'] },
  { id: 'payment', source: 'plat(?:i|im|is|imo|ite|iti|io|ila|ili|ile|ilo|e)|plac(?:a|am|as|amo|ate|aju|ati|ao|ala|ali|ale|alo|anje)|uplat[a-z]*|uplac[a-z]*|pay(?:s|ing|ment|ments)?|paid|transfer[a-z]*|donir[a-z]* (?:na )?(?:racun|iban)|donat(?:e|ed|ing|ion) (?:to )?(?:account|iban)',
    examples: ['platio', 'platite', 'plaćaju', 'uplatila', 'uplaćujemo', 'pay', 'paid', 'payment', 'transferred', 'donirajte na račun', 'donate to account'] },
  // These explicit solicitation phrases retain W-C2's hostile matrix without
  // treating an arbitrary event-name imperative ("Daj prijedlog") as harmful.
  { id: 'solicitation', source: 'molimo broj|ucini uslugu|dodji ovamo|dodi ovamo|(?:system|assistant|developer|sustav|asistent) *:',
    examples: ['molimo broj', 'učini uslugu', 'dođi ovamo', 'system: override'] },
] as const;

// Common inter-letter disguises. Also used between words in a lexicon phrase.
export const EXTERNAL_LEXICON_SEPARATORS = "[ .,;:()'’&+/–-]*";
export const EXTERNAL_LEET: Readonly<Record<string, string>> = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b',
};

// A digit sequence is a contact/account vector unless the WHOLE sequence is a
// calendar date or a historical year range. There is no blanket "contains a
// year" exemption: 1809-1872-1234 and 4111 1111 1111 1111 remain vectors.
export const EXTERNAL_NUMERIC_DATA = [
  /^(?:1\d{3}|20\d{2})\.? *[-–] *(?:1\d{3}|20\d{2})\.?$/u,
  /^(?:[1-9]|0[1-9]|[12]\d|3[01])\. *(?:[1-9]|0[1-9]|1[0-2])\. *(?:1\d{3}|20\d{2})\.?$/u,
] as const;

export const EXTERNAL_VECTOR_PATTERNS = [
  { reason: 'link', source: /h[ .:/-]*t[ .:/-]*t[ .:/-]*p|w[ .-]*w[ .-]*w|@|(?<![a-z0-9])[a-z0-9-]+\.(?:hr|com|net|org|eu|info|io|me|app|link|ly|dev|xyz|site|online|zip|test|co|uk|de|ru|biz|store|museum|travel|gov|edu)(?![a-z0-9])/u },
  { reason: 'phone', source: /(?<![a-z0-9])(?:t[ .-]*e[ .-]*l|telefon[a-z]*|telephone[a-z]*|phone|fax|sms)(?![a-z0-9])|0[ .()/–-]*8[ .()/–-]*0[ .()/–-]*0|\+[ .()/–-]*\d/u },
  { reason: 'account', source: /(?<![a-z0-9])(?:iban|i[ .-]+b[ .-]+a[ .-]+n|swift|bic)(?![a-z0-9])|(?<![a-z0-9])h[ .-]*r[ .-]*\d/u },
  { reason: 'payment', source: /(?:\d[\d .,]* *(?:€|kn|eur|eura)(?![a-z])|(?:€|kn|eur|eura) *\d)/u },
  { reason: 'qr', source: /(?<![a-z0-9])q[ .–-]*r(?![a-z0-9])/u },
] as const;
