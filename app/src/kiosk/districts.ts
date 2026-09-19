// The 17 gradske četvrti as the screen's settings panel offers them (beside
// "Cijeli grad", which is worker/pairing/areas.ts's CITY_AREA and no četvrt):
// the slug the Worker accepts (`areaSlugOf`), the written name, and the
// district's seat address with its coordinates. The seats come from the
// City's Gradske četvrti dataset (data.zagreb.hr, Otvorena dozvola), the
// same rows the open ckan-geo feed serves as `cetvrt:<n>` points; they are
// used only to rank stops "nearest the district seat" in the panel's stop
// search, never shown as a location of the screen itself.
export interface District {
  slug: string;
  name: string;
  seat: { lon: number; lat: number; address: string };
}

export const DISTRICTS: readonly District[] = Object.freeze([
  { slug: 'donji-grad', name: 'Donji grad', seat: { lon: 15.97969, lat: 45.80906, address: 'Ilica 25' } },
  { slug: 'gornji-grad-medvescak', name: 'Gornji grad – Medveščak', seat: { lon: 15.97422, lat: 45.82916, address: 'Draškovićeva ulica 15' } },
  { slug: 'trnje', name: 'Trnje', seat: { lon: 15.9849, lat: 45.79615, address: 'Ulica grada Vukovara 56a' } },
  { slug: 'maksimir', name: 'Maksimir', seat: { lon: 16.00921, lat: 45.83529, address: 'Petrova ulica 116' } },
  { slug: 'pescenica-zitnjak', name: 'Peščenica – Žitnjak', seat: { lon: 16.05549, lat: 45.78991, address: 'Zapoljska ulica 1' } },
  { slug: 'novi-zagreb-istok', name: 'Novi Zagreb – istok', seat: { lon: 16.00393, lat: 45.76195, address: 'Avenija Dubrovnik 12' } },
  { slug: 'novi-zagreb-zapad', name: 'Novi Zagreb – zapad', seat: { lon: 15.92885, lat: 45.75645, address: 'Avenija Dubrovnik 12' } },
  { slug: 'tresnjevka-sjever', name: 'Trešnjevka – sjever', seat: { lon: 15.93994, lat: 45.8017, address: 'Park Stara Trešnjevka 2' } },
  { slug: 'tresnjevka-jug', name: 'Trešnjevka – jug', seat: { lon: 15.9235, lat: 45.78612, address: 'Park Stara Trešnjevka 2' } },
  { slug: 'crnomerec', name: 'Črnomerec', seat: { lon: 15.92951, lat: 45.84417, address: 'Trg Francuske Republike 15' } },
  { slug: 'gornja-dubrava', name: 'Gornja Dubrava', seat: { lon: 16.05901, lat: 45.87032, address: 'Dubrava 49' } },
  { slug: 'donja-dubrava', name: 'Donja Dubrava', seat: { lon: 16.06896, lat: 45.81559, address: 'Dubrava 49' } },
  { slug: 'stenjevec', name: 'Stenjevec', seat: { lon: 15.88284, lat: 45.80089, address: 'Sigetje 2' } },
  { slug: 'podsused-vrapce', name: 'Podsused – Vrapče', seat: { lon: 15.87405, lat: 45.83618, address: 'Sigetje 2' } },
  { slug: 'podsljeme', name: 'Podsljeme', seat: { lon: 15.99364, lat: 45.88857, address: 'Ilica 25' } },
  { slug: 'sesvete', name: 'Sesvete', seat: { lon: 16.14106, lat: 45.87669, address: 'Trg Dragutina Domjanića 4' } },
  { slug: 'brezovica', name: 'Brezovica', seat: { lon: 15.88554, lat: 45.68994, address: 'Brezovička cesta 100' } },
]);

export const DEFAULT_DISTRICT_SLUG = 'donji-grad';

export function districtBySlug(slug: string | null | undefined): District | null {
  return DISTRICTS.find((district) => district.slug === slug) ?? null;
}

/** A district's written name for the header; the slug itself when unknown
 *  (a venue screen provisioned with an area the table does not list). */
export function districtLabel(slug: string | null | undefined): string {
  if (!slug) return '';
  return districtBySlug(slug)?.name ?? slug;
}
