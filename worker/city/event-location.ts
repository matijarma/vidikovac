import { clean } from './normalize';
import { normalName } from '../../shared/city/geo';
/** Extract only evidence from the event's introductory location sentence.
 * Full articles are not copied into the product. Outside-city locations are
 * explicit; an organizer or performer from Zagreb does not relocate an event.
 */
export function eventLocation(excerpt: string, classes: readonly string[]): { venueHint?: string; venueTags?: string; city?: string } {
  const text = clean(excerpt).slice(0, 900);
  const outside = text.match(/\bu\s+(Splitu|Rijeci|Osijeku|Zadru|Puli|Dubrovniku|Varaždinu|Karlovcu|Šibeniku)\b/i);
  const zagreb = /\bu\s+Zagrebu\b|\bu\s+zagrebačk(?:om|oj|im)\b/i.test(text);
  // Carry extracted location tokens, never borrowed article prose. A token
  // must occur in a location construction, not just a performer's biography.
  const location = /\b(?:u|na|ispred)\s+(?:zagrebačk(?:om|oj|im)\s+)?([^.!?\n,]{2,100})/gi;
  const tokens: string[] = [];
  for (const match of text.matchAll(location)) {
    const phrase = match[1].split(/\b(?:održ|odrz|počin|pocin|otvara|predstav|nastup|bit će|bit ce|s početkom|s pocetkom)/i)[0].trim();
    if (phrase && phrase.split(/\s+/).length <= 9) tokens.push(phrase);
  }
  const tags = classes.filter(s => s.startsWith('tag-')).map(s => normalName(s.slice(4)))
    .filter(t => /^(?:dokukino|gavella|kino |galerija |muzej |mocvara|kunstcaffe|msu|kic|mama)/.test(t));
  const venueHint = tokens.join(' | ').slice(0, 300), venueTags = tags.join(' | ').slice(0, 300);
  const city = outside ? outside[1] : zagreb ? 'Zagreb' : undefined;
  return { ...(venueHint ? { venueHint } : {}), ...(venueTags ? { venueTags } : {}), ...(city ? { city } : {}) };
}
