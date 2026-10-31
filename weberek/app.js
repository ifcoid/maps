import {
    createMap, addGeoJSON, clearMap, fitMap, showLayer, hideLayer, getGeoJSON, getBBox, addMapControl, setTiles
} from "https://cdn.jsdelivr.net/gh/crootjs/lib@0.0.19/map.min.js";
import { addMarker } from "https://cdn.jsdelivr.net/gh/crootjs/lib@0.0.19/mapmarker.min.js";
import {
    addScaleBar, addCoordinateControl, addFullscreenButton
} from "https://cdn.jsdelivr.net/gh/crootjs/lib@0.0.19/mapcontrol.min.js";
import { addMeasureControl, downloadMapImage } from "https://cdn.jsdelivr.net/gh/crootjs/lib@0.0.19/maptools.min.js";
import { createAffineTransform } from "https://cdn.jsdelivr.net/gh/crootjs/lib@0.0.19/geomeasure.min.js";
import { unlock } from "./secure.js";

const MAP_ID = "map";
// Data terenkripsi: nama berkas di bundel -> nama sumber di state.data.
const SECURE_URL = "../data/secure/weberek.bin";
const SECURE_SOURCES = {
    "weberek-masterplan-rev14": "masterplan", "weberek-itc": "itc", "weberek-itc-design": "design",
    "weberek-dwg-overlays": "dwg", "weberek-reference": "reference", "weberek-topo": "topo"
};
const PASSWORD_KEY = "weberek-maps-password";
// Pilihan peta dasar (kontrol kanan atas). `imagery` = citra foto, garis data digambar terang.
// Tile ArcGIS di lokasi ini: citra sampai z18, peta jalan/topografi sampai z17; di atasnya
// tile level itu diperbesar (maxNativeZoom).
const esri = service => `https://server.arcgisonline.com/ArcGIS/rest/services/${service}/MapServer/tile/{z}/{y}/{x}`;
const BASEMAPS = {
    hybrid: {
        name: "ArcGIS Hybrid", tiles: esri("World_Imagery"), imagery: true,
        labels: [esri("Reference/World_Transportation"), esri("Reference/World_Boundaries_and_Places")],
        attribution: "Imagery and labels © Esri, Maxar, Earthstar Geographics · Data © OpenStreetMap contributors",
        maxZoom: 21, maxNativeZoom: 18
    },
    satellite: {
        name: "ArcGIS Imagery", tiles: esri("World_Imagery"), imagery: true,
        attribution: "Imagery © Esri, Maxar, Earthstar Geographics · Data © OpenStreetMap contributors",
        maxZoom: 21, maxNativeZoom: 18
    },
    streets: {
        name: "ArcGIS Streets", tiles: esri("World_Street_Map"),
        attribution: "Map © Esri, HERE, Garmin, OpenStreetMap contributors",
        maxZoom: 21, maxNativeZoom: 17
    },
    topographic: {
        name: "ArcGIS Topographic", tiles: esri("World_Topo_Map"),
        attribution: "Map © Esri, HERE, Garmin, USGS, OpenStreetMap contributors",
        maxZoom: 21, maxNativeZoom: 17
    },
    osm: { name: "OpenStreetMap", tiles: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", maxZoom: 21, maxNativeZoom: 19 },
    topo: {
        name: "OpenTopoMap", tiles: "https://tile.opentopomap.org/{z}/{x}/{y}.png",
        attribution: "Map data © OpenStreetMap contributors, SRTM · Map style © OpenTopoMap (CC-BY-SA)",
        maxZoom: 21, maxNativeZoom: 17
    }
};
const BASEMAP_KEY = "weberek-maps-basemap";
// Gambar kartu pemilih peta dasar: tile yang memuat situs, jadi pratinjaunya lokasi ini.
const THUMB = { zoom: 14, center: [125.8959, -9.0140] };
// Grid CAD Master Plan Rev.14 (m) <-> [lng, lat]: empat sudut kompleks dari
// tools/georef_rev14.py cad_to_lonlat (rigid, +-50 m), untuk tampilan koordinat.
const CAD_GRID = createAffineTransform(
    [[27900, -250], [28550, -250], [28550, 470], [27900, 470]],
    [[125.8928434, -9.0171003], [125.8987486, -9.0173727], [125.8990521, -9.0108699], [125.8931469, -9.0105975]]);

// Urutan lapisan = urutan gambar (yang belakangan di atas). `match` memilih fitur dari data.
// text (label di peta), labelOptions, renderer, minZoom diteruskan ke addGeoJSON (crootjs map.js);
// `label` adalah nama lapisan di legenda.
const LAYERS = [
    { key: "nperf", label: "Mobile coverage notes (nPerf)", note: "no samples within 10 km; nearest signal 11.5 km · reference", source: "reference",
      match: f => f.properties.kind.startsWith("ref-nperf"),
      style: f => f.properties.kind === "ref-nperf-ring" ? { stroke: "#fbbf24", strokeWidth: 2, strokeDasharray: "8 6", fill: "#fbbf24", fillOpacity: 0.04 }
          : { radius: 7, fill: "#fbbf24", stroke: "#0f172a", strokeWidth: 2 },
      swatch: "#fbbf24", area: true, text: f => f.properties.kind === "ref-nperf" ? "nPerf" : null,
      labelOptions: { className: "ref-tag", overlap: true } },
    { key: "itu", label: "Fiber & microwave routes (ITU, reference)", note: "operator-reported, rough; pink = fiber, grey = microwave", source: "reference",
      match: f => f.properties.kind.startsWith("ref-itu"),
      style: f => ituStyle(f), swatch: "#ec4899" },
    { key: "transmission", label: "EDTL transmission line", note: "OSM, context", source: "power",
      match: f => f.properties.kind === "transmission",
      style: { stroke: "#a855f7", strokeWidth: 2, strokeOpacity: 0.8 }, swatch: "#a855f7" },
    { key: "contours", label: "Survey contours, 1 m", note: "El. +159 to +176 (GNSS) · ±0.000 = El. +160.00", source: "topo",
      match: f => f.properties.kind === "topo-contour",
      style: f => contourStyle(f), swatch: "#d97706", off: true,
      text: "tag", labelOptions: { className: "contour-tag", minZoom: 16 } },
    { key: "agri", label: "Agricultural area (58 ha)", note: "Master Plan Rev.14", source: "masterplan",
      match: f => f.properties.kind === "mp-agri",
      style: { stroke: "#fb923c", strokeWidth: 2, fill: "#fb923c", fillOpacity: 0.06 }, swatch: "#fb923c", area: true },
    { key: "site", label: "Site corners P1–P4 (IR)", note: "Google Earth picks, Table 3", source: "site",
      match: f => f.properties.kind === "site",
      style: { stroke: "#facc15", strokeWidth: 1.5, strokeDasharray: "5 4", fill: "#facc15", fillOpacity: 0.05 },
      swatch: "#facc15", area: true },
    { key: "parcel", label: "Prison parcel (25 ha)", note: "Master Plan Rev.14, georeferenced ±50 m", source: "masterplan",
      match: f => f.properties.kind === "mp-boundary",
      style: { stroke: "#f87171", strokeWidth: 2.5, fill: "#f87171", fillOpacity: 0.08 }, swatch: "#f87171", area: true },
    { key: "grades", label: "Security zoning, grades 1–4", note: "SDM proposal · ITC-GEN-003", source: "design",
      match: f => f.properties.kind.startsWith("itc-grade"),
      style: f => gradeStyle(f), swatch: "#dc2626", area: true, off: true },
    { key: "das", label: "Cellular: DAS zones, no-DAS zone, BTS", note: "purple = DAS, red = no DAS · ITC-COM-002", source: "design",
      match: f => ["itc-das", "itc-nodas", "itc-bts-fall", "itc-bts-yard"].includes(f.properties.kind),
      style: f => DAS_STYLES[f.properties.kind], swatch: "#a855f7", area: true, off: true },
    { key: "layout", label: "Master Plan Rev.14 layout", note: "buildings, roads, survey boundary", source: "masterplan",
      match: f => ["mp-line", "mp-roof", "mp-survey", "mp-existing"].includes(f.properties.kind),
      style: f => layoutStyle(f), swatch: "#e2e8f0", renderer: "canvas" },
    { key: "walls", label: "Prison wall & fences", note: "PAGAR 01 / 02 / 03", source: "masterplan",
      match: f => ["mp-wall", "mp-fence"].includes(f.properties.kind),
      style: f => f.properties.kind === "mp-wall" ? { stroke: "#4ade80", strokeWidth: 3 } : { stroke: "#86efac", strokeWidth: 1.5 },
      swatch: "#4ade80" },
    { key: "frontage", label: "Existing track across the site", note: "superseded by the site layout", source: "corridor",
      match: f => f.properties.kind === "road-frontage",
      style: { stroke: "#cbd5e1", strokeWidth: 3 }, swatch: "#cbd5e1" },
    { key: "concrete", label: "A–C concrete-stabilized", note: "first 4.0 km", source: "corridor",
      match: f => f.properties.kind === "road-concrete",
      style: { stroke: "#f59e0b", strokeWidth: 5 }, swatch: "#f59e0b" },
    { key: "unpaved", label: "C–E degraded unpaved", note: "wet-season impassable", source: "corridor",
      match: f => f.properties.kind === "road-unpaved",
      style: { stroke: "#ef4444", strokeWidth: 5 }, swatch: "#ef4444" },
    { key: "mv", label: "Existing MV line D → transformer", note: "IR Fig. 42, ≈2.6 km, not surveyed", source: "power",
      match: f => f.properties.kind === "mv-existing",
      style: { stroke: "#3b82f6", strokeWidth: 2.5, strokeDasharray: "8 5" }, swatch: "#3b82f6" },
    { key: "tiein", label: "Proposed supply tie-in", note: "transformer → parcel edge → MG → PH, indicative", source: "power",
      match: f => f.properties.kind === "mv-proposed",
      style: { stroke: "#e879f9", strokeWidth: 4, strokeDasharray: "10 6" }, swatch: "#e879f9" },
    { key: "backhaul", label: "Fiber backhaul duct (ITC)", note: "ER/CR → MG → site exit to Dotik", source: "itc",
      match: f => f.properties.kind === "itc-backhaul",
      style: { stroke: "#22d3ee", strokeWidth: 3.5 }, swatch: "#22d3ee" },
    { key: "spurs", label: "Building spurs & BDA feed", note: "12-core, schematic · ITC-NET-002", source: "design",
      match: f => f.properties.kind === "itc-spur" || f.properties.kind === "itc-bda",
      style: f => f.properties.kind === "itc-bda" ? { stroke: "#c084fc", strokeWidth: 2.5 } : { stroke: "#60a5fa", strokeWidth: 1.8 },
      swatch: "#60a5fa" },
    { key: "pids", label: "Wall detection zones Z01–Z12 + microwave", note: "fiber sensing on the wall top · ITC-PID-001", source: "design",
      match: f => f.properties.kind === "itc-pids" || f.properties.kind === "itc-mw",
      style: f => f.properties.kind === "itc-mw" ? { radius: 5, fill: "#a855f7", stroke: "#fff", strokeWidth: 2 }
          : { stroke: f.properties.zone_index % 2 ? "#facc15" : "#f97316", strokeWidth: 7, strokeOpacity: 0.9 },
      swatch: "#f97316", text: f => f.properties.kind === "itc-pids" ? f.properties.name.replace("Detection zone ", "") : null,
      labelOptions: { className: "itc-tag zone", minZoom: 16 } },
    { key: "ring", label: "Perimeter fiber ring, 9 nodes", note: "24-core, ≈1.4 km, ERPS · ITC-NET-002", source: "design",
      match: f => f.properties.kind === "itc-ring",
      style: { stroke: "#f43f5e", strokeWidth: 3.5 }, swatch: "#f43f5e" },
    { key: "cams", label: "Cameras, site & perimeter (66 of 144)", note: "positions provisional · ITC-VSS-001", source: "design",
      match: f => f.properties.kind === "itc-cam",
      style: f => ({ radius: 4.5, fill: CAM_COLORS[f.properties.cam], stroke: "#0f172a", strokeWidth: 1.5 }),
      swatch: "#ef4444", dot: true },
    { key: "cellblocks", label: "Cell blocks: plan, 20 cameras, fields of view", note: "typical plan on 5 blocks · ITC-VSS-002 DWG", source: "dwg",
      match: f => f.properties.kind.startsWith("cb-") || f.properties.kind === "itc-cam",
      style: f => cellBlockStyle(f), swatch: "#facc15", renderer: "canvas", minZoom: 16 },
    { key: "notes", label: "Drawing annotations", note: "labels of the sheet chosen below · site overlay DWG", source: "dwg",
      match: f => f.properties.sheet === state.sheet,
      style: { stroke: "#fef08a", strokeWidth: 1.2, strokeOpacity: 0.9 }, swatch: "#fef08a",
      text: f => f.properties.kind === "dwg-note" ? f.properties.text : null, labelOptions: { className: "dwg-note" } },
    { key: "buildings", label: "Devices per building", note: "click: cameras, doors, intercom, duress, PA", source: "design",
      match: f => f.properties.kind === "itc-building" && !f.properties.node,
      style: { radius: 7, fill: "#f8fafc", stroke: "#0f172a", strokeWidth: 2.5 }, swatch: "#f8fafc", dot: true,
      text: f => String(deviceCount(f.properties.devices, "Cameras")), labelOptions: { className: "building-tag", minZoom: 17 } },
    { key: "radio", label: "Radio repeaters, DAS head-end, sleeves", note: "DMR on T5 + control room · 3 retaining-wall sleeves", source: "design",
      match: f => ["itc-radio", "itc-das-he", "itc-sleeve"].includes(f.properties.kind),
      style: f => POINT_STYLES[f.properties.kind], swatch: "#34d399", dot: true },
    { key: "itc", label: "ITC nodes, gates & towers", note: "ER/CR, PH, BTS, MG/NG/SG, T1–T5", source: "itc",
      match: f => f.geometry.type === "Point" && f.properties.kind.startsWith("itc-"),
      style: f => POINT_STYLES[f.properties.kind], swatch: "#22d3ee", dot: true,
      text: "name", labelOptions: { className: "itc-tag", overlap: true } },
    { key: "survey", label: "Benchmarks & water sources", note: "BM1–BM3, boreholes W1–W3", source: "itc",
      match: f => f.properties.kind === "mp-benchmark" || f.properties.kind === "mp-water",
      style: f => POINT_STYLES[f.properties.kind], swatch: "#f8fafc", dot: true },
    { key: "points", label: "Transformer · existing building · corners", note: "click for details", source: "points",
      match: () => true,
      style: f => POINT_STYLES[f.properties.kind] || { radius: 4 }, swatch: "#2563eb", dot: true }
];

const POINT_STYLES = {
    transformer: { radius: 9, fill: "#2563eb", stroke: "#fff", strokeWidth: 3 },
    building: { radius: 6, fill: "#111827", stroke: "#fff", strokeWidth: 2 },
    boundary: { radius: 4, fill: "#facc15", stroke: "#111827", strokeWidth: 1.5 },
    "itc-node": { radius: 7, fill: "#22d3ee", stroke: "#0f172a", strokeWidth: 2 },
    "itc-gate": { radius: 5, fill: "#f8fafc", stroke: "#0f172a", strokeWidth: 2 },
    "itc-tower": { radius: 5, fill: "#fbbf24", stroke: "#0f172a", strokeWidth: 2 },
    "itc-radio": { radius: 8, fill: "#34d399", stroke: "#0f172a", strokeWidth: 2 },
    "itc-das-he": { radius: 4, fill: "#a855f7", stroke: "#fff", strokeWidth: 1.5 },
    "itc-sleeve": { radius: 5, fill: "#fde047", stroke: "#0f172a", strokeWidth: 2 },
    "mp-benchmark": { radius: 5, fill: "#ef4444", stroke: "#fff", strokeWidth: 2 },
    "mp-water": { radius: 5, fill: "#0ea5e9", stroke: "#fff", strokeWidth: 2 }
};

// Warna kamera mengikuti legenda lembar ITC-VSS-001 (kamera blok: ITC-VSS-002).
const CAM_COLORS = {
    wall: "#ef4444", f2: "#f97316", ptz: "#3b82f6", thermal: "#d946ef",
    gate: "#fca5a5", anpr: "#fb923c", site: "#22c55e", block: "#facc15"
};

// Denah blok sel dari DWG: garis tipis terang di citra satelit, gelap di peta jalan.
function cellBlockStyle(feature) {
    const kind = feature.properties.kind;
    if (kind === "itc-cam") return { radius: 4, fill: CAM_COLORS.block, stroke: "#0f172a", strokeWidth: 1.5 };
    if (kind === "cb-fov") return { stroke: "#facc15", strokeWidth: 1, fill: "#facc15", fillOpacity: 0.28 };
    return { stroke: BASEMAPS[state.basemap].imagery ? "#f8fafc" : "#334155", strokeWidth: 0.7, strokeOpacity: 0.85 };
}

// Kontur survei: kontur indeks (tiap 5 m) lebih tebal; terang di citra satelit.
function contourStyle(feature) {
    const index = feature.properties.index;
    const color = BASEMAPS[state.basemap].imagery ? (index ? "#fcd34d" : "#fde68a") : (index ? "#92400e" : "#b45309");
    return { stroke: color, strokeWidth: index ? 1.8 : 0.9, strokeOpacity: index ? 0.95 : 0.7 };
}

const DAS_STYLES = {
    "itc-das": { stroke: "#a855f7", strokeWidth: 1.5, fill: "#a855f7", fillOpacity: 0.4 },
    "itc-nodas": { stroke: "#ef4444", strokeWidth: 2, fill: "#ef4444", fillOpacity: 0.18 },
    "itc-bts-fall": { stroke: "#a855f7", strokeWidth: 2, strokeDasharray: "6 4", fill: "#a855f7", fillOpacity: 0.08 },
    "itc-bts-yard": { stroke: "#e9d5ff", strokeWidth: 1.5, fill: "#a855f7", fillOpacity: 0.2 }
};

// Jalur ITU: fiber tebal merah muda, microwave abu-abu, rencana lebih pudar.
function ituStyle(feature) {
    const p = feature.properties;
    if (p.kind === "ref-itu-node") return { radius: 4.5, fill: "#ec4899", stroke: "#fff", strokeWidth: 1.5 };
    const fiber = (p.label || "").startsWith("Fibre");
    const planned = (p.label || "").includes("Planned");
    return { stroke: fiber ? "#ec4899" : "#cbd5e1", strokeWidth: fiber ? 3 : 1.8, strokeOpacity: 0.9,
             strokeDasharray: planned ? "6 5" : undefined };
}

// Zona Security Design Matrix: warna sama dengan lembar ITC-GEN-003.
function gradeStyle(feature) {
    const p = feature.properties;
    if (p.kind === "itc-grade4-line") return { stroke: "#b91c1c", strokeWidth: 6 };
    if (p.kind === "itc-grade4-point") return { stroke: "#b91c1c", strokeWidth: 2.5, fill: "#b91c1c", fillOpacity: 0.15 };
    const fills = { 3: ["#f87171", 0.22], "3c": ["#dc2626", 0.35], 2: ["#3b82f6", 0.4], 1: ["#22c55e", 0.35] };
    const [color, opacity] = fills[p.grade];
    return { stroke: color, strokeWidth: 1.5, fill: color, fillOpacity: opacity };
}

// Garis layout master plan: terang di atas citra satelit, gelap di atas peta jalan.
function layoutStyle(feature) {
    const light = BASEMAPS[state.basemap].imagery;
    const kind = feature.properties.kind;
    if (kind === "mp-existing") return { stroke: "#f97316", strokeWidth: 2.5, fill: "#f97316", fillOpacity: 0.35 };
    if (kind === "mp-survey") return { stroke: light ? "#93c5fd" : "#2563eb", strokeWidth: 1.5, strokeOpacity: 0.9 };
    if (kind === "mp-roof") return { stroke: light ? "#ffffff" : "#334155", strokeWidth: 1.4 };
    return { stroke: light ? "#e2e8f0" : "#64748b", strokeWidth: 0.8, strokeOpacity: 0.75 };
}

const state = { sheet: "", basemap: savedBasemap(), visible: new Set(LAYERS.filter(l => !l.off).map(l => l.key)), data: {} };

function km(m) {
    return (m / 1000).toFixed(1);
}

function features(collection, match) {
    return { type: "FeatureCollection", features: collection.features.filter(match) };
}

// Titik dari semua sumber (selain simpul koridor yang digambar sebagai badge HTML).
function pointData() {
    const all = [...state.data.site.features, ...state.data.power.features];
    return { type: "FeatureCollection", features: all.filter(f => f.geometry.type === "Point") };
}

// Jumlah satu jenis perangkat dari tabel `devices` (0 bila tidak ada).
function deviceCount(devices, item) {
    const row = (devices || []).find(r => r.item === item);
    return row && row.qty ? row.qty : 0;
}

// Tabel perangkat untuk popup dan panel total.
function deviceTable(devices) {
    const table = document.createElement("table");
    table.className = "devices";
    devices.forEach(({ item, qty, detail }) => {
        const tr = table.insertRow();
        tr.insertCell().textContent = item;
        tr.insertCell().textContent = qty === null ? "shared" : qty === 0 ? "–" : qty;
        tr.insertCell().textContent = detail || "";
    });
    return table;
}

// Ringkasan perangkat yang ditempel ke simbol node (gerbang, menara, ER/CR).
function nodeDevices(name) {
    if (!state.data.design) return null;
    return state.data.design.features.find(f => f.properties.kind === "itc-building" && f.properties.node === name);
}

function popupContent(feature) {
    const p = feature.properties;
    const box = document.createElement("div");
    box.className = "pop";
    const add = (tag, text, cls) => {
        if (text === undefined || text === null || text === "") return;
        const el = document.createElement(tag);
        if (cls) el.className = cls;
        el.textContent = text;
        box.appendChild(el);
    };
    add("h3", p.name + (p.label ? ": " + p.label : ""));
    if (p.grade) add("p", `Security grade ${p.grade === "3c" ? "3 (core)" : p.grade}`, "metric");
    if (p.length_m) add("p", `Length ≈ ${p.length_m.toLocaleString("en")} m`, "metric");
    if (p.chainage_m !== undefined) add("p", `Chainage ${p.chainage_m.toLocaleString("en")} m from A`, "metric");
    if (p.area_ha) add("p", `P1–P4 area ≈ ${p.area_ha} ha`, "metric");
    if (p.distance_to_power_house_m) add("p", `≈ ${p.distance_to_power_house_m.toLocaleString("en")} m to the power house (outside the parcel, via MG)`, "metric");
    add("p", p.detail);
    add("p", p.location);
    add("p", p.coordinate);
    add("p", p.zone && "Location: " + p.zone);
    add("p", p.note);
    if (p.link) {
        const a = document.createElement("a");
        a.href = p.link;
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = "Open the live nPerf map ↗";
        const para = document.createElement("p");
        para.appendChild(a);
        box.appendChild(para);
    }
    const linked = feature.properties.kind && feature.properties.kind.startsWith("itc-") && nodeDevices(p.name);
    const devices = p.devices || (linked && linked.properties.devices);
    if (linked) add("p", linked.properties.name + (linked.properties.detail ? " · " + linked.properties.detail : ""), "metric");
    if (devices) {
        box.appendChild(deviceTable(devices));
        if (linked && !p.devices) {
            add("p", "Device schedule: " + linked.properties.source, "src");
            return box;
        }
        if (p.devices_source) add("p", "Device schedule: " + p.devices_source, "src");
    }
    add("p", p.source ? "Source: " + p.source : p.layer && `Source: Master Plan Rev.14, CAD layer "${p.layer}"`, "src");
    return box;
}

function renderFacts() {
    const corridor = state.data.corridor.features;
    const byKind = kind => corridor.find(f => f.properties.kind === kind);
    const entry = corridor.find(f => f.properties.name === "E");
    const tiein = state.data.power.features.find(f => f.properties.kind === "mv-proposed");
    const facts = [
        ["Access corridor A → E", `${km(entry.properties.chainage_m)} km`, "IR: 9.4 km"],
        ["A–C concrete / C–E unpaved", `${km(byKind("road-concrete").properties.length_m)} / ${km(byKind("road-unpaved").properties.length_m)}`, "km"],
        ["Nearest transformer", "50 kVA", "pole-mounted"],
        ["Tie-in to power house", `${tiein.properties.length_m.toLocaleString("en")} m`, "indicative"]
    ];
    const dl = document.getElementById("facts");
    dl.replaceChildren(...facts.map(([label, value, unit]) => {
        const wrap = document.createElement("div");
        const dt = document.createElement("dt");
        dt.textContent = label;
        const dd = document.createElement("dd");
        dd.textContent = value + " ";
        const small = document.createElement("small");
        small.textContent = unit;
        dd.appendChild(small);
        wrap.append(dt, dd);
        return wrap;
    }));
}

// Lapisan yang datanya sudah ada (lapisan terenkripsi muncul setelah password benar).
function availableLayers() {
    return LAYERS.filter(layer => layer.source === "points" || state.data[layer.source]);
}

function renderLegend() {
    const list = document.getElementById("legend");
    list.replaceChildren(...[...availableLayers()].reverse().map(layer => {
        const li = document.createElement("li");
        const label = document.createElement("label");
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = state.visible.has(layer.key);
        input.addEventListener("change", () => {
            if (input.checked) state.visible.add(layer.key);
            else state.visible.delete(layer.key);
            (input.checked ? showLayer : hideLayer)(MAP_ID, layer.key);
        });
        const swatch = document.createElement("span");
        swatch.className = "swatch";
        const mark = document.createElement("i");
        if (layer.area) {
            mark.className = "area";
            mark.style.borderColor = layer.swatch;
            mark.style.background = layer.swatch + "33";
        } else if (layer.dot) {
            mark.className = "dot";
            mark.style.background = layer.swatch;
        } else {
            mark.style.background = layer.swatch;
        }
        swatch.appendChild(mark);
        const text = document.createElement("span");
        text.className = "text";
        text.textContent = layer.label;
        const note = document.createElement("small");
        note.textContent = layer.note;
        text.appendChild(note);
        label.append(input, swatch, text);
        li.appendChild(label);
        return li;
    }));
}

// Semua lapisan yang datanya ada digambar sebagai lapisan bernama (nama = key); centang di
// legenda hanya menampilkan/menyembunyikan. Digambar ulang saat data dibuka, lembar anotasi
// diganti, atau peta dasar diganti (gaya garis terang/gelap).
function drawLayers() {
    clearMap(MAP_ID);
    availableLayers().forEach((layer, order) => {
        const source = layer.source === "points" ? pointData() : state.data[layer.source];
        const pick = layer.source === "points" ? source : features(source, layer.match);
        addGeoJSON(MAP_ID, pick, {
            name: layer.key, order, visible: state.visible.has(layer.key),
            style: layer.style, popup: popupContent, tooltip: f => f.properties.name || null,
            label: layer.text, labelOptions: layer.labelOptions, renderer: layer.renderer, minZoom: layer.minZoom
        });
    });
}

function drawMarkers() {
    state.data.corridor.features.filter(f => f.geometry.type === "Point").forEach(f => {
        const p = f.properties;
        const element = document.createElement("div");
        if (p.kind === "node") {
            element.className = "node-badge";
            element.textContent = p.name;
        } else {
            element.className = "place-tag";
            element.textContent = p.name;
        }
        addMarker(MAP_ID, f.geometry.coordinates, {
            element, anchor: "center", title: p.label || p.name, popup: popupContent(f)
        });
    });
    const transformer = state.data.power.features.find(f => f.properties.kind === "transformer");
    const tag = document.createElement("div");
    tag.className = "place-tag";
    tag.textContent = "50 kVA";
    addMarker(MAP_ID, transformer.geometry.coordinates, {
        element: tag, anchor: "bottom", title: "Existing 50 kVA transformer", popup: popupContent(transformer)
    });
}

function build() {
    const base = BASEMAPS[state.basemap];
    createMap(MAP_ID, { ...base, center: [125.905, -9.04], zoom: 13 });
    addBasemapPicker();
    addFullscreenButton(MAP_ID, "top-left");
    addMeasureControl(MAP_ID, { corner: "top-left" });
    addScaleBar(MAP_ID, "bottom-right");
    addCoordinateControl(MAP_ID, { corner: "bottom-left", format: coordinateText });
    drawLayers();
    drawMarkers();
    fitTo("corridor");
}

function thumbUrl(template) {
    const n = 2 ** THUMB.zoom, [lng, lat] = THUMB.center, rad = lat * Math.PI / 180;
    const x = Math.floor((lng + 180) / 360 * n);
    const y = Math.floor((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2 * n);
    return template.replace("{z}", THUMB.zoom).replace("{x}", x).replace("{y}", y).replace("{s}", "a");
}

function basemapCard(key) {
    const base = BASEMAPS[key];
    const button = document.createElement("button");
    button.type = "button";
    button.className = "basemap-card";
    button.dataset.key = key;
    const thumb = document.createElement("span");
    thumb.className = "basemap-thumb";
    // label di atas citra (Hybrid): background pertama digambar paling atas
    thumb.style.backgroundImage = [...(base.labels || []), base.tiles].map(t => `url("${thumbUrl(t)}")`).join(", ");
    const name = document.createElement("span");
    name.textContent = base.name;
    button.append(thumb, name);
    return button;
}

// Pemilih peta dasar berupa kartu bergambar seperti di Google Maps/nPerf: kartu peta aktif
// di kanan atas; diarahkan (mouse) atau diklik membuka kisi semua pilihan.
function addBasemapPicker() {
    const root = document.createElement("div");
    root.className = "basemap-picker";
    const toggle = basemapCard(state.basemap);
    toggle.classList.add("basemap-toggle");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-haspopup", "true");
    const grid = document.createElement("div");
    grid.className = "basemap-grid";
    grid.setAttribute("role", "group");
    grid.setAttribute("aria-label", "Basemap");
    const title = document.createElement("p");
    title.textContent = "Basemap";
    const cards = Object.keys(BASEMAPS).map(basemapCard);
    grid.append(title, ...cards);
    root.append(toggle, grid);

    const sync = () => {
        toggle.replaceChildren(...basemapCard(state.basemap).childNodes);
        toggle.title = `Basemap: ${BASEMAPS[state.basemap].name}`;
        cards.forEach(card => card.setAttribute("aria-pressed", String(card.dataset.key === state.basemap)));
    };
    const open = show => {
        root.classList.toggle("open", show);
        toggle.setAttribute("aria-expanded", String(show));
    };
    toggle.addEventListener("click", () => {
        open(true);
        grid.querySelector('[aria-pressed="true"]').focus();
    });
    cards.forEach(card => card.addEventListener("click", () => {
        state.basemap = card.dataset.key;
        try { localStorage.setItem(BASEMAP_KEY, state.basemap); } catch { /* tidak disimpan */ }
        setTiles(MAP_ID, BASEMAPS[state.basemap].tiles, BASEMAPS[state.basemap]);
        drawLayers();
        sync();
        open(false);
        toggle.focus();
    }));
    if (window.matchMedia("(hover: hover)").matches) {
        root.addEventListener("mouseenter", () => open(true));
        root.addEventListener("mouseleave", () => open(false));
    }
    root.addEventListener("keydown", event => {
        if (event.key === "Escape" && root.classList.contains("open")) { open(false); toggle.focus(); }
    });
    document.addEventListener("pointerdown", event => { if (!root.contains(event.target)) open(false); });
    sync();
    addMapControl(MAP_ID, root, "top-right");
}

// Koordinat di bawah kursor: WGS84 dan grid CAD Rev.14 (X, Y meter, seperti di DWG).
function coordinateText([lng, lat]) {
    const [x, y] = CAD_GRID.inverse([lng, lat]);
    return `${lat.toFixed(6)}, ${lng.toFixed(6)} · CAD X ${x.toFixed(1)}, Y ${y.toFixed(1)}`;
}

// Paskan tampilan ke data, dengan padding di sisi panel legenda (kiri di layar lebar,
// bawah di ponsel) supaya datanya tidak tertutup panel.
function fitTo(target) {
    const data = target === "region" && state.data.reference
        ? features(state.data.reference, f => f.properties.kind.startsWith("ref-nperf"))
        : target === "compound"
        ? features(state.data.design, f => f.properties.kind === "itc-ring" || f.properties.kind === "itc-bts-fall")
        : target === "site" && !state.data.masterplan
        ? state.data.site
        : target === "site"
        ? { type: "FeatureCollection", features: [
            ...state.data.masterplan.features.filter(f => f.properties.kind === "mp-boundary"),
            ...state.data.power.features.filter(f => f.properties.kind === "transformer")] }
        : state.data.corridor;
    const panel = document.getElementById("panel").getBoundingClientRect();
    const narrow = window.matchMedia("(max-width: 640px)").matches;
    const padding = narrow
        ? { top: 40, right: 24, bottom: Math.min(panel.height, window.innerHeight / 2) + 24, left: 24 }
        : { top: 40, right: 40, bottom: 40, left: panel.right + 24 };
    fitMap(MAP_ID, getBBox(data), padding);
}

function savedBasemap() {
    try {
        const key = localStorage.getItem(BASEMAP_KEY);
        if (BASEMAPS[key]) return key;
    } catch { /* penyimpanan diblokir: pakai bawaan */ }
    return "hybrid";
}

function bindUI() {
    document.getElementById("sheetNotes").addEventListener("change", event => {
        state.sheet = event.target.value;
        state.visible.add("notes");
        renderLegend();
        drawLayers();
    });
    document.querySelectorAll("[data-fit]").forEach(button =>
        button.addEventListener("click", () => fitTo(button.dataset.fit)));
    document.getElementById("exportPng").addEventListener("click", () =>
        downloadMapImage(MAP_ID, "weberek-map.png"));
    const panel = document.getElementById("panel");
    const toggle = document.getElementById("panelToggle");
    // Di ponsel panel mulai tertutup supaya petanya langsung terlihat.
    if (window.matchMedia("(max-width: 640px)").matches) {
        panel.classList.add("collapsed");
        toggle.setAttribute("aria-expanded", "false");
    }
    toggle.addEventListener("click", () => {
        const collapsed = panel.classList.toggle("collapsed");
        toggle.setAttribute("aria-expanded", String(!collapsed));
    });
}

function load(name, url) {
    return new Promise((resolve, reject) => getGeoJSON(url, ({ status, data }) => {
        if (status === 200 && data) resolve([name, data]);
        else reject(new Error(`${url}: HTTP ${status}`));
    }));
}

function renderTotals() {
    const totals = state.data.design && state.data.design.features.find(f => f.properties.kind === "itc-totals");
    const box = document.getElementById("totals");
    if (!totals) return;
    box.replaceChildren(deviceTable(totals.properties.devices));
    const src = document.createElement("p");
    src.className = "src";
    src.textContent = "Source: " + totals.properties.source;
    box.appendChild(src);
}

function showLock(message) {
    const lock = document.getElementById("lock");
    lock.hidden = false;
    document.getElementById("lockError").textContent = message || "";
    document.getElementById("lockPassword").focus();
}

async function openSecure(password, remember) {
    const bundle = await unlock(SECURE_URL, password);
    Object.entries(SECURE_SOURCES).forEach(([file, source]) => {
        if (bundle[file]) state.data[source] = bundle[file];
    });
    if (remember) {
        try { sessionStorage.setItem(PASSWORD_KEY, password); } catch { /* penyimpanan diblokir */ }
    }
    document.getElementById("lock").hidden = true;
    document.body.classList.add("unlocked");
    renderTotals();
    renderLegend();
    drawLayers();
    fitTo("site");
}

function bindLock() {
    const form = document.getElementById("lockForm");
    form.addEventListener("submit", async event => {
        event.preventDefault();
        const input = document.getElementById("lockPassword");
        const button = form.querySelector("button[type=submit]");
        button.disabled = true;
        document.getElementById("lockError").textContent = "Decrypting…";
        try {
            await openSecure(input.value.trim(), true);
            input.value = "";
        } catch (error) {
            showLock(error.message === "Wrong password" ? "Wrong password." : "Could not open the data: " + error.message);
        } finally {
            button.disabled = false;
        }
    });
    document.getElementById("lockSkip").addEventListener("click", () => {
        document.getElementById("lock").hidden = true;
    });
    document.getElementById("unlockButton").addEventListener("click", () => showLock());
}

Promise.all([
    load("site", "../data/weberek-site.geojson"),
    load("corridor", "../data/weberek-access-corridor.geojson"),
    load("power", "../data/weberek-power.geojson")
]).then(async entries => {
    state.data = Object.fromEntries(entries);
    renderFacts();
    renderLegend();
    bindUI();
    bindLock();
    build();
    let saved = null;
    try { saved = sessionStorage.getItem(PASSWORD_KEY); } catch { /* penyimpanan diblokir */ }
    if (saved) {
        try { await openSecure(saved, false); return; } catch { /* password lama tidak berlaku */ }
    }
    showLock();
}).catch(error => {
    document.getElementById("facts").textContent = "Map data failed to load: " + error.message;
});
