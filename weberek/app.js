import {
    createMap, removeMap, addGeoJSON, clearMap, fitMap, getMapView, setMapView, getGeoJSON, getBBox
} from "https://cdn.jsdelivr.net/gh/crootjs/lib@0.0.16/map.min.js";
import { addMarker } from "https://cdn.jsdelivr.net/gh/crootjs/lib@0.0.16/mapmarker.min.js";
import { addScaleBar } from "https://cdn.jsdelivr.net/gh/crootjs/lib@0.0.16/mapcontrol.min.js";

const MAP_ID = "map";
const BASEMAPS = {
    satellite: {
        tiles: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        attribution: "Imagery © Esri, Maxar, Earthstar Geographics · Data © OpenStreetMap contributors",
        maxZoom: 18
    },
    osm: { tiles: true, maxZoom: 19 }
};

// Urutan lapisan = urutan gambar (yang belakangan di atas). `match` memilih fitur dari data.
const LAYERS = [
    { key: "transmission", label: "EDTL transmission line", note: "OSM, context", source: "power",
      match: f => f.properties.kind === "transmission",
      style: { stroke: "#a855f7", strokeWidth: 2, strokeOpacity: 0.8 }, swatch: "#a855f7" },
    { key: "agri", label: "Agricultural area (58 ha)", note: "Master Plan Rev.14", source: "masterplan",
      match: f => f.properties.kind === "mp-agri",
      style: { stroke: "#fb923c", strokeWidth: 2, fill: "#fb923c", fillOpacity: 0.06 }, swatch: "#fb923c", area: true },
    { key: "site", label: "Site corners P1–P4 (IR)", note: "Google Earth picks, Table 3", source: "site",
      match: f => f.properties.kind === "site",
      style: { stroke: "#facc15", strokeWidth: 1.5, fill: "#facc15", fillOpacity: 0.05 }, swatch: "#facc15", area: true },
    { key: "parcel", label: "Prison parcel (25 ha)", note: "Master Plan Rev.14, georeferenced ±50 m", source: "masterplan",
      match: f => f.properties.kind === "mp-boundary",
      style: { stroke: "#f87171", strokeWidth: 2.5, fill: "#f87171", fillOpacity: 0.08 }, swatch: "#f87171", area: true },
    { key: "layout", label: "Master Plan Rev.14 layout", note: "buildings, roads, survey boundary", source: "masterplan",
      match: f => ["mp-line", "mp-roof", "mp-survey", "mp-existing"].includes(f.properties.kind),
      style: f => layoutStyle(f), popup: f => f.properties.name ? popupContent(f) : null, swatch: "#e2e8f0" },
    { key: "walls", label: "Prison wall & fences", note: "PAGAR 01 / 02 / 03", source: "masterplan",
      match: f => ["mp-wall", "mp-fence"].includes(f.properties.kind),
      style: f => f.properties.kind === "mp-wall" ? { stroke: "#4ade80", strokeWidth: 3 } : { stroke: "#86efac", strokeWidth: 1.5 },
      popup: false, swatch: "#4ade80" },
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
      style: { stroke: "#3b82f6", strokeWidth: 2.5 }, swatch: "#3b82f6" },
    { key: "tiein", label: "Proposed supply tie-in", note: "transformer → parcel edge → MG → PH, indicative", source: "power",
      match: f => f.properties.kind === "mv-proposed",
      style: { stroke: "#e879f9", strokeWidth: 4 }, swatch: "#e879f9" },
    { key: "backhaul", label: "Fiber backhaul duct (ITC)", note: "ER/CR → MG → site exit to Dotik", source: "itc",
      match: f => f.properties.kind === "itc-backhaul",
      style: { stroke: "#22d3ee", strokeWidth: 3.5 }, swatch: "#22d3ee" },
    { key: "itc", label: "ITC nodes, gates & towers", note: "ER/CR, PH, BTS, MG/NG/SG, T1–T5", source: "itc",
      match: f => f.geometry.type === "Point" && f.properties.kind.startsWith("itc-"),
      style: f => POINT_STYLES[f.properties.kind], swatch: "#22d3ee", dot: true, markers: true },
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
    "mp-benchmark": { radius: 5, fill: "#ef4444", stroke: "#fff", strokeWidth: 2 },
    "mp-water": { radius: 5, fill: "#0ea5e9", stroke: "#fff", strokeWidth: 2 }
};

// Garis layout master plan: terang di atas citra satelit, gelap di atas peta jalan.
function layoutStyle(feature) {
    const light = state.basemap === "satellite";
    const kind = feature.properties.kind;
    if (kind === "mp-existing") return { stroke: "#f97316", strokeWidth: 2.5, fill: "#f97316", fillOpacity: 0.35 };
    if (kind === "mp-survey") return { stroke: light ? "#93c5fd" : "#2563eb", strokeWidth: 1.5, strokeOpacity: 0.9 };
    if (kind === "mp-roof") return { stroke: light ? "#ffffff" : "#334155", strokeWidth: 1.4 };
    return { stroke: light ? "#e2e8f0" : "#64748b", strokeWidth: 0.8, strokeOpacity: 0.75 };
}

const state = { basemap: "satellite", visible: new Set(LAYERS.map(l => l.key)), data: {}, view: null };

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
    if (p.length_m) add("p", `Length ≈ ${p.length_m.toLocaleString("en")} m`, "metric");
    if (p.chainage_m !== undefined) add("p", `Chainage ${p.chainage_m.toLocaleString("en")} m from A`, "metric");
    if (p.area_ha) add("p", `P1–P4 area ≈ ${p.area_ha} ha`, "metric");
    if (p.distance_to_power_house_m) add("p", `≈ ${p.distance_to_power_house_m.toLocaleString("en")} m to the power house (outside the parcel, via MG)`, "metric");
    add("p", p.detail);
    add("p", p.location);
    add("p", p.coordinate);
    add("p", p.note);
    add("p", p.source && "Source: " + p.source, "src");
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

function renderLegend() {
    const list = document.getElementById("legend");
    list.replaceChildren(...[...LAYERS].reverse().map(layer => {
        const li = document.createElement("li");
        const label = document.createElement("label");
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = state.visible.has(layer.key);
        input.addEventListener("change", () => {
            if (input.checked) state.visible.add(layer.key);
            else state.visible.delete(layer.key);
            drawLayers();
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

// Label HTML untuk lapisan bertanda `markers`; dicabut dan dipasang ulang bersama lapisannya.
let labelMarkers = [];

function drawLayers() {
    clearMap(MAP_ID);
    labelMarkers.forEach(marker => marker.remove());
    labelMarkers = [];
    LAYERS.filter(layer => state.visible.has(layer.key)).forEach(layer => {
        const source = layer.source === "points" ? pointData() : state.data[layer.source];
        const pick = layer.source === "points" ? source : features(source, layer.match);
        const popup = layer.popup === undefined ? popupContent : layer.popup;
        addGeoJSON(MAP_ID, pick, { style: layer.style, popup });
        if (layer.markers) {
            pick.features.filter(f => f.properties.kind === "itc-node").forEach(f => {
                const tag = document.createElement("div");
                tag.className = "itc-tag";
                tag.textContent = f.properties.name;
                labelMarkers.push(addMarker(MAP_ID, f.geometry.coordinates, {
                    element: tag, anchor: "bottom", title: f.properties.label, popup: popupContent(f)
                }));
            });
        }
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
    removeMap(MAP_ID);
    createMap(MAP_ID, {
        tiles: base.tiles,
        attribution: base.attribution,
        maxZoom: base.maxZoom,
        center: [125.905, -9.04],
        zoom: 13
    });
    addScaleBar(MAP_ID, "bottom-right");
    drawLayers();
    drawMarkers();
    if (state.view) setMapView(MAP_ID, state.view.center, Math.min(state.view.zoom, base.maxZoom));
    else fitTo("corridor");
}

// Paskan tampilan ke data, dengan bbox dilebarkan ke arah panel legenda (kiri di layar
// lebar, bawah di ponsel) supaya datanya tidak tertutup panel.
function fitTo(target) {
    const data = target === "site"
        ? { type: "FeatureCollection", features: [
            ...state.data.masterplan.features.filter(f => f.properties.kind === "mp-boundary"),
            ...state.data.power.features.filter(f => f.properties.kind === "transformer")] }
        : state.data.corridor;
    const [minLng, minLat, maxLng, maxLat] = getBBox(data);
    const narrow = window.matchMedia("(max-width: 640px)").matches;
    const bbox = narrow
        ? [minLng, minLat - (maxLat - minLat) * 0.12, maxLng, maxLat]
        : [minLng - (maxLng - minLng) * 0.45, minLat, maxLng, maxLat];
    fitMap(MAP_ID, bbox, 40);
}

function bindUI() {
    document.querySelectorAll("[data-basemap]").forEach(button => {
        button.addEventListener("click", () => {
            if (state.basemap === button.dataset.basemap) return;
            state.view = getMapView(MAP_ID);
            state.basemap = button.dataset.basemap;
            document.querySelectorAll("[data-basemap]").forEach(b =>
                b.setAttribute("aria-pressed", String(b === button)));
            build();
        });
    });
    document.querySelectorAll("[data-fit]").forEach(button =>
        button.addEventListener("click", () => fitTo(button.dataset.fit)));
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

Promise.all([
    load("site", "../data/weberek-site.geojson"),
    load("corridor", "../data/weberek-access-corridor.geojson"),
    load("power", "../data/weberek-power.geojson"),
    load("masterplan", "../data/weberek-masterplan-rev14.geojson"),
    load("itc", "../data/weberek-itc.geojson")
]).then(entries => {
    state.data = Object.fromEntries(entries);
    renderFacts();
    renderLegend();
    bindUI();
    build();
}).catch(error => {
    document.getElementById("facts").textContent = "Map data failed to load: " + error.message;
});
