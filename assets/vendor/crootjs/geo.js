const DEFAULT_TIMEOUT_MS = 15000;

// Kedalaman array coordinates tiap tipe geometri GeoJSON (RFC 7946):
// Point = satu posisi [lng, lat], LineString = array posisi, Polygon = array ring, dst.
const COORDINATE_DEPTH = {
    Point: 0,
    MultiPoint: 1,
    LineString: 1,
    MultiLineString: 2,
    Polygon: 2,
    MultiPolygon: 3
};

function isPosition(position) {
    return Array.isArray(position) && position.length >= 2
        && Number.isFinite(position[0]) && Number.isFinite(position[1]);
}

function isCoordinates(coordinates, depth) {
    if (depth === 0) return isPosition(coordinates);
    return Array.isArray(coordinates) && coordinates.every(item => isCoordinates(item, depth - 1));
}

function isGeometry(geometry) {
    if (geometry === null || typeof geometry !== 'object') return false;
    if (geometry.type === 'GeometryCollection') {
        return Array.isArray(geometry.geometries) && geometry.geometries.every(isGeometry);
    }
    const depth = COORDINATE_DEPTH[geometry.type];
    return typeof depth === 'number' && isCoordinates(geometry.coordinates, depth);
}

// Mengubah satu Feature atau satu geometri polos menjadi Feature yang properties-nya
// selalu object (bukan null). Mengembalikan null kalau bentuknya bukan GeoJSON.
function toFeature(item) {
    if (item === null || typeof item !== 'object') return null;
    if (item.type === 'Feature') {
        // geometry: null sah menurut RFC 7946 (fitur tanpa lokasi).
        const geometry = item.geometry === undefined ? null : item.geometry;
        if (geometry !== null && !isGeometry(geometry)) return null;
        const hasProperties = item.properties !== null && typeof item.properties === 'object' && !Array.isArray(item.properties);
        return { ...item, geometry, properties: hasProperties ? item.properties : {} };
    }
    if (isGeometry(item)) return { type: 'Feature', properties: {}, geometry: item };
    return null;
}

// Semua posisi [lng, lat] milik satu geometri, diratakan jadi satu array.
function positionsOf(geometry) {
    if (!geometry) return [];
    if (geometry.type === 'GeometryCollection') return geometry.geometries.flatMap(positionsOf);
    const depth = COORDINATE_DEPTH[geometry.type];
    return depth === 0 ? [geometry.coordinates] : geometry.coordinates.flat(depth - 1);
}

// Halaman file di GitHub (github.com/<owner>/<repo>/blob/<ref>/<path>) membalas HTML, dan
// versi ?raw=true-nya redirect tanpa header CORS. Yang bisa di-fetch browser hanya alamat
// raw.githubusercontent.com-nya.
function toRawGitHubURL(target_url) {
    const match = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:blob|raw)\/([^?#]+)/.exec(target_url);
    return match ? `https://raw.githubusercontent.com/${match[1]}/${match[2]}/${match[3]}` : target_url;
}

// Menerima teks JSON atau object hasil JSON.parse, mengembalikan FeatureCollection -
// apa pun bentuk masukannya: FeatureCollection, satu Feature, satu geometri polos, atau
// array berisi Feature/geometri (bentuk yang biasa dibalas backend dari query MongoDB).
// Mengembalikan null kalau masukannya bukan GeoJSON. Item yang tidak valid di dalam
// sebuah koleksi dilewati (dilaporkan di console), tidak menggagalkan seluruh data.
export function parseGeoJSON(input) {
    let geojson = input;
    if (typeof input === 'string') {
        try {
            geojson = JSON.parse(input);
        } catch (parseError) {
            return null;
        }
    }
    if (geojson === null || typeof geojson !== 'object') return null;

    const isCollection = geojson.type === 'FeatureCollection';
    if (isCollection && !Array.isArray(geojson.features)) return null;
    const items = isCollection ? geojson.features : (Array.isArray(geojson) ? geojson : [geojson]);

    const features = [];
    const skipped = [];
    items.forEach((item, index) => {
        const feature = toFeature(item);
        if (feature) {
            features.push(feature);
        } else {
            skipped.push(index);
        }
    });
    if (!isCollection && items.length > 0 && features.length === 0) return null;
    if (skipped.length > 0) {
        console.log('parseGeoJSON: item bukan Feature/geometri yang valid, dilewati. Indeks:', skipped);
    }
    return isCollection ? { ...geojson, features } : { type: 'FeatureCollection', features };
}

// Mengambil GeoJSON dari URL. responseFunction selalu dipanggil dengan { status, data }:
// data berisi FeatureCollection, atau null kalau isi balasannya bukan GeoJSON;
// { status: 0, data: null } kalau jaringan gagal, CORS ditolak, atau request timeout.
export function getGeoJSON(target_url, responseFunction, tokenkey = null, tokenvalue = null) {
    let requestOptions = {
        method: 'GET',
        redirect: 'follow'
    };

    // Header hanya ditambahkan kalau ada token. Tanpa header tambahan browser tidak
    // mengirim preflight CORS - host file statis seperti raw.githubusercontent.com menolak
    // preflight (403), jadi getJSON dari api.js (yang selalu mengirim Content-Type)
    // tidak bisa mengambil file dari sana.
    if (tokenkey && tokenvalue) {
        let myHeaders = new Headers();
        myHeaders.append(tokenkey, tokenvalue);
        requestOptions.headers = myHeaders;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    requestOptions.signal = controller.signal;

    fetch(toRawGitHubURL(target_url), requestOptions)
        .then(response => response.text().then(result => ({ status: response.status, data: parseGeoJSON(result) })))
        .catch(error => {
            console.log('error', error);
            return { status: 0, data: null };
        })
        .finally(() => clearTimeout(timeoutId))
        // Dipanggil di luar catch di atas: exception dari dalam responseFunction tidak boleh
        // dilaporkan sebagai kegagalan request (dan memanggil responseFunction dua kali).
        .then(responseFunction);
}

// Membaca file GeoJSON yang dipilih user di <input type="file" id="...">.
// responseFunction dipanggil dengan FeatureCollection, atau null kalau belum ada file
// yang dipilih, file gagal dibaca, atau isinya bukan GeoJSON.
export function readGeoJSONFile(id, responseFunction) {
    const input = document.getElementById(id);
    const file = input && input.files ? input.files[0] : null;
    if (!file) {
        responseFunction(null);
        return;
    }

    file.text()
        .then(parseGeoJSON, error => {
            console.log('error', error);
            return null;
        })
        .then(responseFunction);
}

// Semua posisi [lng, lat] di dalam data, diratakan jadi satu array.
export function getCoordinates(geojson) {
    const collection = parseGeoJSON(geojson);
    return collection ? collection.features.flatMap(feature => positionsOf(feature.geometry)) : [];
}

// Kotak pembatas data: [minLng, minLat, maxLng, maxLat] (urutan bbox RFC 7946).
// null kalau datanya tidak punya koordinat sama sekali.
export function getBBox(geojson) {
    const positions = getCoordinates(geojson);
    if (positions.length === 0) return null;

    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;
    positions.forEach(position => {
        if (position[0] < minLng) minLng = position[0];
        if (position[0] > maxLng) maxLng = position[0];
        if (position[1] < minLat) minLat = position[1];
        if (position[1] > maxLat) maxLat = position[1];
    });
    return [minLng, minLat, maxLng, maxLat];
}

// Titik tengah kotak pembatas sebagai [lng, lat] - untuk memusatkan peta, bukan centroid geometri.
// null kalau datanya tidak punya koordinat.
export function getCenter(geojson) {
    const bbox = getBBox(geojson);
    if (!bbox) return null;
    return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
}

// Nama-nama properti yang dipakai fitur di dalam data, tanpa duplikat, urut sesuai
// kemunculan pertama. Berguna untuk membuat header tabel.
export function getPropertyKeys(geojson) {
    const collection = parseGeoJSON(geojson);
    const keys = new Set();
    if (collection) {
        collection.features.forEach(feature => Object.keys(feature.properties).forEach(key => keys.add(key)));
    }
    return [...keys];
}

// GeoJSON menyimpan posisi sebagai [longitude, latitude]; Leaflet dan Google Maps
// memintanya terbalik: [latitude, longitude].
export function toLatLng(position) {
    return [position[1], position[0]];
}
