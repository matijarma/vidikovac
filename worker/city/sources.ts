import type { CatalogueEntry, PlaceCategory } from '../../shared/city/types';
export interface ReferenceSource {
  id: string; name: string; url: string; catalogue: string; licence: string;
  category?: PlaceCategory; kind: CatalogueEntry['kind']; format?: 'streets' | 'settlements' | 'heritage' | 'gtfs';
}
const CITY = 'https://data.zagreb.hr/dataset/';
const OD = 'Otvorena dozvola (OD)';
const arc = (id: string) => `https://opendata.arcgis.com/api/v3/datasets/${id}/downloads/data?format=geojson&spatialRefId=4326&where=1%3D1`;
const place = (id: string, name: string, slug: string, resource: string, category: PlaceCategory): ReferenceSource =>
  ({ id, name, catalogue: CITY + slug, url: resource.startsWith('http') ? resource : arc(resource), licence: OD, kind: 'places', category });
export const REFERENCE_SOURCES: readonly ReferenceSource[] = [
  place('culture', 'Kulturne ustanove Grada Zagreba', 'geoportal-kulturne-ustanove', '83db22aeb39441ec84911ee94f26e746_0', 'culture'),
  place('water', 'Javni zdenci', 'geoportal_javni_zdenci', CITY + '0d1c65b5-6e8f-4b6a-be90-cc9ecb6fa374/resource/2010797b-3e1e-4a43-9a5a-b1619722d2ac/download/data.geojson', 'water'),
  place('drinking-water', 'Pojilice s pitkom vodom', 'pojilice-sa-pitkom-vodom', 'https://services8.arcgis.com/Usi0jGQwMmBUpFjr/arcgis/rest/services/pitka_voda/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson', 'water'),
  place('toilets', 'Javni WC-i', 'javni-wc-i', 'https://services8.arcgis.com/Usi0jGQwMmBUpFjr/arcgis/rest/services/javni_wc/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson', 'toilet'),
  place('sport', 'Javna sportska igrališta', 'geoportal-javna-igralista', '8e2abb22194b4595965d2056f31ff66e_0', 'sport'),
  place('dogs', 'Javne površine za pse', 'geoportal-javne-povrsine-za-pse', '78e1786ccdd544cfb8465b73051f22c9_0', 'dogs'),
  place('recycling', 'Reciklažna dvorišta', 'reciklazna-dvorista-grada-zagreba1', '249fa384ccf9481abf4fd2de73a822f5_0', 'recycling'),
  place('markets', 'Gradske tržnice', 'geoportal-gradske-trznice', '55461536a14e46a69c81a0a67e56c53f_0', 'market'),
  place('wifi', 'Besplatna Wi-Fi mreža', 'geoportal-besplatna-wifi-mreza', '59efced0d006469fa858ab07764735b0_0', 'wifi'),
  place('cycle-parking', 'Javna parkirališta za bicikle', 'geoportal-javna-parkiralista-za-bicikle', '04012b0e4968447c978a6ee494d76495_2', 'cycle-parking'),
  place('garages', 'Javne garaže', 'geoportal-javne-garaze', '3e3484aca5284b16b4a1c41bd6594711_0', 'garage'),
  place('charging', 'Električne punionice', 'geoportal-elektricne-punionice', '4a4fc728724b4d319c27a9f647a0bb62_0', 'charging'),
  { id: 'cycle-paths', name: 'Biciklističke staze', catalogue: CITY + 'geoportal-biciklisticke-staze', url: arc('b10db2ae3a5b4e4b8dbee85a89d4b5b1_4'), licence: OD, kind: 'paths' },
  { id: 'streets', name: 'Registar naziva ulica', catalogue: CITY + 'registar-naziva-ulica-adresna-prostorna-jedinica-za-podrucje-grada-zagreba',
    url: CITY + '8e0bd4c4-4b6f-49b9-8327-f2ef9c213b05/resource/e232d55f-16f7-4310-bb30-ecdaf4b21066/download/rpj_ulica.csv', licence: OD, kind: 'streets', format: 'streets' },
  { id: 'settlements', name: 'Naselja Grada Zagreba', catalogue: CITY + 'naselja-adresna-prostorna-jedinice-za-podrucje-grada-zagreba',
    url: 'https://services8.arcgis.com/Usi0jGQwMmBUpFjr/arcgis/rest/services/Naselja/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson', licence: OD, kind: 'settlements', format: 'settlements' },
  { id: 'heritage', name: 'Ministarstvo kulture i medija', catalogue: 'https://data.gov.hr/ckan/dataset/kulturna-dobra',
    url: 'https://data.gov.hr/ckan/dataset/c0410787-33b1-4299-b92c-9bbf38dd8bbf/resource/c9a9bce6-1b70-45ec-b2cf-d3f93bca7a02/download/data.json',
    licence: OD + '; geometrija: Geoportal kulturnih dobara, informativni prikaz', kind: 'places', format: 'heritage', category: 'heritage' },
  { id: 'zet-schedule', name: 'ZET GTFS', catalogue: 'https://www.zet.hr/odredbe/datoteke-u-gtfs-formatu/669', url: 'https://www.zet.hr/gtfs-scheduled/latest', licence: OD, kind: 'schedules', format: 'gtfs' },
  { id: 'hz-schedule', name: 'HŽ Putnički prijevoz', catalogue: 'https://data.gov.hr/ckan/dataset/vozni-red-h-putni-kog-prijevoza-u-gtfs-obliku',
    url: 'https://www.hzpp.hr/GTFS_files.zip', licence: 'Uvjeti ponovne uporabe nisu navedeni; izvor: HŽPP, informativni vozni red', kind: 'schedules', format: 'gtfs' },
];
export const LIVE_SOURCES = {
  bikes: { id: 'bajs', name: 'BAJS Zagreb / nextbike', url: 'https://bajs.zagreb.hr', licence: 'CC0-1.0' },
  air: { id: 'air', name: 'Informacijski sustav zaštite zraka RH', url: 'https://iszz.azo.hr/iskzl/', licence: 'Uvjeti ponovne uporabe nisu navedeni; preliminarni podaci' },
  river: { id: 'river', name: 'DHMZ, hidrološki bilten', url: 'https://hidro.hr/hidro_bilten.xml', licence: OD },
  consultations: { id: 'consultations', name: 'Ured za zakonodavstvo, eSavjetovanja', url: 'https://data.gov.hr/ckan/dataset/esavjetovanja', licence: OD },
} as const;
