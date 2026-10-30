import { parseGeoJSON, getBBox } from "./geo.js";

// Halaman yang menampilkan peta hampir selalu juga membaca datanya. Fungsi geo.js diekspor
// ulang dari sini supaya cukup satu import - dan supaya geo.js tidak terunduh dua kali
// (sekali sebagai geo.min.js oleh halaman, sekali sebagai ./geo.js oleh modul ini).
export * from "./geo.js";

const TILE_SIZE = 256;
const MAX_LATITUDE = 85.0511287798; // batas lintang proyeksi Web Mercator
const DEFAULT_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const SVG_NS = "http://www.w3.org/2000/svg";
const DRAG_THRESHOLD = 4;       // piksel gerakan sebelum sebuah tekanan dianggap geser, bukan klik
const REBUILD_DISTANCE = 4096;  // piksel geser sebelum path SVG dihitung ulang
const SINGLE_POINT_ZOOM = 17;   // zoom fitMap untuk data yang hanya berupa satu titik
const ZOOM_DURATION = 200;      // ms

// Opsi style -> properti CSS SVG-nya.
const STYLE_PROPERTIES = {
    stroke: "stroke",
    strokeWidth: "stroke-width",
    strokeOpacity: "stroke-opacity",
    fill: "fill",
    fillOpacity: "fill-opacity"
};

const maps = new Map();        // id elemen -> state peta
const records = new WeakMap(); // elemen SVG -> { feature, layer, shape } pemiliknya
const taps = new WeakMap();    // elemen milik modul tambahan -> function yang menangani tap padanya

const CORNERS = ["top-left", "top-right", "bottom-left", "bottom-right"];

function injectStyles() {
    if (document.getElementById("crootjs-map-style")) return;
    const style = document.createElement("style");
    style.id = "crootjs-map-style";
    style.textContent = `
.crootjs-map {
    position: absolute;
    inset: 0;
    z-index: 0;
    overflow: hidden;
    background-color: #e5e3df;
    cursor: grab;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-tap-highlight-color: transparent;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 13px;
    line-height: 1.4;
    color: #1f2937;
}
.crootjs-map:focus-visible { outline: 2px solid #2563eb; outline-offset: -2px; }
.crootjs-map-dragging { cursor: grabbing; }
.crootjs-map-tiles,
.crootjs-map svg.crootjs-map-vectors {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    height: 100%;
    max-width: none;
}
/* z-index di sini membuat tiap lapisan punya urutan tumpuk sendiri: z-index gambar tile
   hanya berlaku di antara sesama tile, tidak sampai menutupi lapisan data di atasnya. */
.crootjs-map-tiles { z-index: 0; }
.crootjs-map svg.crootjs-map-vectors { z-index: 1; }
/* Tempat modul tambahan (marker, penanda lokasi) menaruh elemen HTML-nya: di atas data,
   di bawah popup. Lapisannya sendiri tembus klik; hanya elemen di dalamnya yang bisa diklik. */
.crootjs-map-overlay {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    height: 100%;
    z-index: 2;
    pointer-events: none;
}
.crootjs-map-overlay > * { pointer-events: auto; }
.crootjs-map-corner {
    position: absolute;
    z-index: 4;
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 10px;
    pointer-events: none;
}
.crootjs-map-corner > * { pointer-events: auto; cursor: auto; }
.crootjs-map-top-left { left: 0; top: 0; align-items: flex-start; }
.crootjs-map-top-right { right: 0; top: 0; align-items: flex-end; }
.crootjs-map-bottom-left { left: 0; bottom: 0; align-items: flex-start; flex-direction: column-reverse; }
/* naik sedikit supaya tidak menimpa atribusi peta dasar di pojok ini */
.crootjs-map-bottom-right { right: 0; bottom: 14px; align-items: flex-end; flex-direction: column-reverse; }
.crootjs-map img.crootjs-map-tile {
    position: absolute;
    max-width: none;
    max-height: none;
    margin: 0;
    padding: 0;
    border: 0;
    opacity: 0;
    transition: opacity 150ms linear;
    pointer-events: none;
}
.crootjs-map img.crootjs-map-tile-loaded { opacity: 1; }
.crootjs-map-vectors path,
.crootjs-map-vectors circle { vector-effect: non-scaling-stroke; cursor: pointer; }
.crootjs-map-polygon { fill: #2563eb; fill-opacity: 0.25; fill-rule: evenodd; stroke: #2563eb; stroke-width: 2; stroke-linejoin: round; }
.crootjs-map-line { fill: none; stroke: #2563eb; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
.crootjs-map-hit { fill: none; stroke: transparent; stroke-width: 20; pointer-events: stroke; }
.crootjs-map-point { fill: #2563eb; stroke: #fff; stroke-width: 2; }
.crootjs-map-popup {
    position: absolute;
    left: 0;
    top: 0;
    z-index: 3;
    box-sizing: border-box;
    max-width: 260px;
    padding: 10px 30px 10px 12px;
    border-radius: 8px;
    background-color: #fff;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
    cursor: auto;
    user-select: text;
    -webkit-user-select: text;
    overflow-wrap: anywhere;
}
.crootjs-map-popup::after {
    content: "";
    position: absolute;
    left: 50%;
    top: 100%;
    margin-left: -8px;
    border: 8px solid transparent;
    border-top-color: #fff;
    pointer-events: none;
}
.crootjs-map button.crootjs-map-popup-close {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 26px;
    height: 26px;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: none;
    color: #6b7280;
    font: inherit;
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
}
.crootjs-map button.crootjs-map-popup-close:hover { background-color: #f3f4f6; color: #111827; }
.crootjs-map-zoom {
    display: flex;
    flex-direction: column;
    border-radius: 6px;
    overflow: hidden;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
}
.crootjs-map-zoom button {
    width: 32px;
    min-width: 0;
    height: 32px;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 0;
    background-color: #fff;
    color: #1f2937;
    font: inherit;
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
}
.crootjs-map-zoom button + button { border-top: 1px solid #d1d5db; }
.crootjs-map-zoom button:hover { background-color: #f3f4f6; }
.crootjs-map-zoom button:disabled { color: #9ca3af; cursor: default; }
.crootjs-map-attribution {
    position: absolute;
    right: 0;
    bottom: 0;
    z-index: 4;
    padding: 1px 6px;
    background-color: rgba(255, 255, 255, 0.8);
    font-size: 11px;
    cursor: auto;
}
.crootjs-map-attribution a { color: #1d4ed8; text-decoration: none; }
`;
    document.head.appendChild(style);
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

// Proyeksi Web Mercator: posisi GeoJSON [lng, lat] <-> titik [x, y] dengan seluruh dunia
// dipetakan ke rentang 0..1 (x ke timur, y ke selatan). Dikalikan ukuran dunia dalam
// piksel pada sebuah zoom, hasilnya koordinat piksel.
function project(position) {
    const sin = Math.sin(clamp(position[1], -MAX_LATITUDE, MAX_LATITUDE) * Math.PI / 180);
    return [
        (position[0] + 180) / 360,
        0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)
    ];
}

function unproject(point) {
    return [
        point[0] * 360 - 180,
        Math.atan(Math.sinh(Math.PI * (1 - 2 * point[1]))) * 180 / Math.PI
    ];
}

function worldSize(zoom) {
    return TILE_SIZE * Math.pow(2, zoom);
}

function getMap(id) {
    const state = maps.get(id);
    if (!state) console.warn(`Peta dengan ID "${id}" belum dibuat. Panggil createMap("${id}") lebih dulu.`);
    return state;
}

// Pusat tampilan disimpan sebagai titik proyeksi (state.x, state.y), bukan [lng, lat],
// supaya geser dan zoom tidak bolak-balik lewat proyeksi.
function setView(state, x, y, zoom) {
    if (Number.isFinite(zoom)) state.zoom = clamp(zoom, state.minZoom, state.maxZoom);
    if (Number.isFinite(x)) state.x = clamp(x, 0, 1);
    if (Number.isFinite(y)) state.y = clamp(y, 0, 1);
}

// Menggeser isi peta sejauh dx, dy piksel layar (mengikuti arah jari).
function panBy(state, dx, dy) {
    const world = worldSize(state.zoom);
    setView(state, state.x - dx / world, state.y - dy / world, state.zoom);
}

// Mengubah zoom dengan posisi di bawah `point` tetap berada di bawah `point`.
function zoomAround(state, zoom, point) {
    const before = worldSize(state.zoom);
    const after = worldSize(clamp(zoom, state.minZoom, state.maxZoom));
    const dx = point[0] - state.width / 2;
    const dy = point[1] - state.height / 2;
    setView(state, state.x + dx / before - dx / after, state.y + dy / before - dy / after, zoom);
}

function toPoint(state, position) {
    const world = worldSize(state.zoom);
    const point = project(position);
    return [
        (point[0] - state.x) * world + state.width / 2,
        (point[1] - state.y) * world + state.height / 2
    ];
}

function toPosition(state, point) {
    const world = worldSize(state.zoom);
    return unproject([
        state.x + (point[0] - state.width / 2) / world,
        state.y + (point[1] - state.height / 2) / world
    ]);
}

function requestRender(state) {
    if (state.renderFrame || state.removed) return;
    state.renderFrame = requestAnimationFrame(() => {
        state.renderFrame = 0;
        render(state);
    });
}

function render(state) {
    if (state.removed) return;
    state.width = state.root.clientWidth;
    state.height = state.root.clientHeight;
    renderTiles(state);
    renderVectors(state);
    renderPopup(state);
    if (state.zoomIn) {
        state.zoomIn.disabled = state.zoom >= state.maxZoom;
        state.zoomOut.disabled = state.zoom <= state.minZoom;
    }

    // Pendengar onMapMove dipanggil di frame yang sama dengan gambar barunya, supaya elemen
    // yang mengikuti peta (marker) tidak tertinggal. Hanya kalau tampilannya memang berubah:
    // render juga terpicu oleh hal lain, misalnya tile yang selesai dimuat.
    const signature = [state.x, state.y, state.zoom, state.width, state.height].join(",");
    if (signature !== state.signature) {
        state.signature = signature;
        const view = currentView(state);
        state.moveHandlers.slice().forEach(runFunction => runFunction(view));
    }
}

function currentView(state) {
    return { center: unproject([state.x, state.y]), zoom: state.zoom };
}

function subscribeMove(state, runFunction) {
    state.moveHandlers.push(runFunction);
    return function stop() {
        const index = state.moveHandlers.indexOf(runFunction);
        if (index !== -1) state.moveHandlers.splice(index, 1);
    };
}

// Menaruh sebuah elemen di salah satu pojok peta. Elemennya dibungkus supaya klik dan
// geser di dalamnya tidak ikut menggeser peta.
function addControl(state, element, corner) {
    const name = CORNERS.includes(corner) ? corner : "top-right";
    if (!state.corners[name]) {
        const box = document.createElement("div");
        box.className = "crootjs-map-corner crootjs-map-" + name;
        state.root.appendChild(box);
        state.corners[name] = box;
    }
    const slot = document.createElement("div");
    slot.appendChild(element);
    isolate(slot);
    state.corners[name].appendChild(slot);
    return function remove() {
        slot.remove();
    };
}

function addTile(state, z, x, y, key) {
    const img = document.createElement("img");
    const tile = { img, z, x, y, loaded: false };
    img.className = "crootjs-map-tile";
    img.alt = "";
    img.draggable = false;
    img.onload = () => {
        tile.loaded = true;
        img.classList.add("crootjs-map-tile-loaded");
        requestRender(state);
    };
    // Tile yang gagal dimuat dibiarkan kosong, tapi tetap dihitung selesai supaya tidak
    // menahan pembersihan tile lama di renderTiles.
    img.onerror = () => {
        tile.loaded = true;
        requestRender(state);
    };
    img.src = state.tileURL.replace("{z}", z).replace("{x}", x).replace("{y}", y);
    state.tiles.set(key, tile);
    state.tilePane.appendChild(img);
    // Tile label (transparan) di atas tile dasar, posisinya ikut tile dasar.
    tile.labels = state.labelURLs.map(url => {
        const label = document.createElement("img");
        label.className = "crootjs-map-tile";
        label.alt = "";
        label.draggable = false;
        label.onload = () => label.classList.add("crootjs-map-tile-loaded");
        label.src = url.replace("{z}", z).replace("{x}", x).replace("{y}", y);
        state.tilePane.appendChild(label);
        return label;
    });
}

function renderTiles(state) {
    if (!state.tileURL) return;

    // Zoom boleh pecahan (saat pinch atau animasi); tile diambil dari level bulat terdekat
    // lalu diskalakan.
    const tileZoom = clamp(Math.round(state.zoom), 0, Math.floor(Math.min(state.maxZoom, state.maxNativeZoom)));
    const count = Math.pow(2, tileZoom);
    const world = worldSize(state.zoom);
    const left = state.x * world - state.width / 2;  // tepi kiri-atas tampilan, dalam piksel dunia
    const top = state.y * world - state.height / 2;
    const size = world / count;

    const needed = new Set();
    const xEnd = Math.min(count - 1, Math.floor((left + state.width) / size));
    const yEnd = Math.min(count - 1, Math.floor((top + state.height) / size));
    for (let x = Math.max(0, Math.floor(left / size)); x <= xEnd; x++) {
        for (let y = Math.max(0, Math.floor(top / size)); y <= yEnd; y++) {
            const key = `${tileZoom}/${x}/${y}`;
            needed.add(key);
            if (!state.tiles.has(key)) addTile(state, tileZoom, x, y, key);
        }
    }

    let loading = false;
    needed.forEach(key => {
        if (!state.tiles.get(key).loaded) loading = true;
    });

    state.tiles.forEach((tile, key) => {
        const tileSize = world / Math.pow(2, tile.z);
        const x = tile.x * tileSize - left;
        const y = tile.y * tileSize - top;
        const visible = x < state.width && y < state.height && x + tileSize > 0 && y + tileSize > 0;
        // Tile dari level zoom sebelumnya dipertahankan (diskalakan) sampai tile level
        // sekarang selesai dimuat, supaya peta tidak berkedip kosong setiap kali zoom berubah.
        const keep = needed.has(key) || (loading && tile.loaded && visible && Math.abs(tile.z - tileZoom) <= 2);
        if (!keep) {
            tile.img.onload = null;
            tile.img.onerror = null;
            tile.img.remove();
            tile.labels.forEach(label => label.remove());
            state.tiles.delete(key);
            return;
        }
        // Tepi kiri dan kanan dibulatkan sendiri-sendiri supaya tile bersebelahan tidak
        // menyisakan garis celah pada zoom pecahan.
        const px = Math.round(x);
        const py = Math.round(y);
        tile.img.style.left = px + "px";
        tile.img.style.top = py + "px";
        tile.img.style.width = (Math.round(x + tileSize) - px) + "px";
        tile.img.style.height = (Math.round(y + tileSize) - py) + "px";
        tile.img.style.zIndex = tile.z === tileZoom ? 1 : 0;
        tile.labels.forEach(label => {
            label.style.cssText = tile.img.style.cssText;
            label.style.zIndex = tile.z === tileZoom ? 3 : 2;
        });
    });
}

// Geometri GeoJSON -> daftar bentuk siap gambar, dengan koordinat sudah diproyeksikan
// sekali di sini (bukan di setiap frame).
function shapesOf(geometry) {
    if (!geometry) return [];
    const ring = positions => positions.map(project);
    const coordinates = geometry.coordinates;
    switch (geometry.type) {
        case "Point": return [{ kind: "point", point: project(coordinates) }];
        case "MultiPoint": return coordinates.map(position => ({ kind: "point", point: project(position) }));
        case "LineString": return [{ kind: "line", rings: [ring(coordinates)] }];
        case "MultiLineString": return [{ kind: "line", rings: coordinates.map(ring) }];
        case "Polygon": return [{ kind: "polygon", rings: coordinates.map(ring) }];
        case "MultiPolygon": return [{ kind: "polygon", rings: coordinates.flat().map(ring) }];
        case "GeometryCollection": return geometry.geometries.flatMap(shapesOf);
        default: return [];
    }
}

// Menulis koordinat sebuah bentuk dalam piksel relatif terhadap titik acuan `built`.
function drawShape(shape, built, size) {
    const local = value => Math.round(value * size * 10) / 10;
    if (shape.kind === "point") {
        shape.element.setAttribute("cx", local(shape.point[0] - built.x));
        shape.element.setAttribute("cy", local(shape.point[1] - built.y));
        return;
    }
    const d = shape.rings
        .filter(ring => ring.length > 0)
        .map(ring => "M" + ring.map(point => local(point[0] - built.x) + " " + local(point[1] - built.y)).join("L") + (shape.kind === "polygon" ? "Z" : ""))
        .join("");
    shape.element.setAttribute("d", d);
    if (shape.hit) shape.hit.setAttribute("d", d);
}

function renderVectors(state) {
    const world = worldSize(state.zoom);
    let built = state.built;

    // Path SVG ditulis sekali dalam piksel relatif terhadap pusat tampilan saat itu; geser
    // dan zoom sesudahnya cukup mengubah transform grupnya. Path baru dihitung ulang kalau
    // tampilan sudah menjauh dari titik acuan itu: SVG menghitung dengan presisi tunggal,
    // jadi koordinat piksel yang terlalu besar (atau skala yang terlalu jauh) membuat
    // bentuk bergeser beberapa piksel pada zoom tinggi.
    if (!built
        || Math.abs(state.zoom - built.zoom) > 1
        || Math.abs(state.x - built.x) * world > REBUILD_DISTANCE
        || Math.abs(state.y - built.y) * world > REBUILD_DISTANCE) {
        built = state.built = { x: state.x, y: state.y, zoom: state.zoom, scale: 0 };
        state.layers.forEach(layer => layer.shapes.forEach(shape => drawShape(shape, built, world)));
    }

    const scale = Math.pow(2, state.zoom - built.zoom);
    const tx = (built.x - state.x) * world + state.width / 2;
    const ty = (built.y - state.y) * world + state.height / 2;
    state.group.setAttribute("transform", `translate(${tx} ${ty}) scale(${scale})`);

    if (scale !== built.scale) {
        built.scale = scale;
        // Lingkaran ikut diskalakan bersama grupnya; jari-jarinya dibagi skala supaya
        // ukurannya di layar tetap.
        state.layers.forEach(layer => layer.shapes.forEach(shape => {
            if (shape.kind === "point") shape.element.setAttribute("r", shape.radius / scale);
        }));
    }
}

function renderPopup(state) {
    if (!state.popup) return;
    const world = worldSize(state.zoom);
    const x = (state.popup.x - state.x) * world + state.width / 2;
    const y = (state.popup.y - state.y) * world + state.height / 2 - state.popup.offset - 10;
    state.popupElement.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
}

function formatValue(value) {
    if (value === undefined || value === null) return "";
    return typeof value === "object" ? JSON.stringify(value) : String(value);
}

// Isi popup bawaan: daftar "nama: nilai" dari properties. Dipasang sebagai teks, bukan
// HTML - datanya bisa berasal dari URL atau file sembarang.
function defaultPopupContent(feature) {
    const entries = Object.entries(feature.properties || {});
    if (entries.length === 0) return null;
    const list = document.createElement("div");
    entries.forEach(([key, value]) => {
        const row = document.createElement("div");
        const name = document.createElement("b");
        name.textContent = key + ": ";
        row.append(name, formatValue(value));
        list.appendChild(row);
    });
    return list;
}

function openPopup(state, point, content, offset = 0) {
    if (content === null || content === undefined || content === "") {
        hidePopup(state);
        return;
    }
    if (!state.popupElement) {
        const element = document.createElement("div");
        element.className = "crootjs-map-popup";
        const close = document.createElement("button");
        close.type = "button";
        close.className = "crootjs-map-popup-close";
        close.setAttribute("aria-label", "Tutup");
        close.textContent = "×";
        close.addEventListener("click", () => hidePopup(state));
        const body = document.createElement("div");
        element.append(close, body);
        isolate(element);
        state.root.appendChild(element);
        state.popupElement = element;
        state.popupBody = body;
    }
    if (content instanceof Node) {
        state.popupBody.replaceChildren(content);
    } else {
        state.popupBody.textContent = String(content);
    }
    state.popupElement.hidden = false;
    state.popup = { x: point[0], y: point[1], offset };
    renderPopup(state);

    // Popup yang terpotong tepi peta dibawa masuk dengan menggeser petanya. Hanya kalau
    // titik jangkarnya sendiri sedang terlihat: showPopup() di tempat yang jauh tidak
    // boleh membuat peta melompat ke sana.
    const world = worldSize(state.zoom);
    const anchorX = (point[0] - state.x) * world + state.width / 2;
    const anchorY = (point[1] - state.y) * world + state.height / 2;
    if (anchorX < 0 || anchorX > state.width || anchorY < 0 || anchorY > state.height) return;
    const bounds = state.root.getBoundingClientRect();
    const rect = state.popupElement.getBoundingClientRect();
    const margin = 8;
    let dx = 0;
    if (rect.left < bounds.left + margin) dx = bounds.left + margin - rect.left;
    else if (rect.right > bounds.right - margin) dx = bounds.right - margin - rect.right;
    const dy = Math.max(0, bounds.top + margin - rect.top);
    if (dx !== 0 || dy !== 0) {
        panBy(state, dx, dy);
        render(state);
    }
}

function hidePopup(state) {
    state.popup = null;
    if (state.popupElement) state.popupElement.hidden = true;
}

// Klik atau geser di dalam kontrol dan popup tidak boleh ikut menggeser/men-zoom peta.
function isolate(element) {
    ["pointerdown", "dblclick"].forEach(type => element.addEventListener(type, event => event.stopPropagation()));
}

function stopAnimation(state) {
    cancelAnimationFrame(state.zoomFrame);
    clearTimeout(state.snapTimer);
    state.zoomFrame = 0;
}

function animateZoom(state, zoom, point) {
    stopAnimation(state);
    const from = state.zoom;
    const to = clamp(zoom, state.minZoom, state.maxZoom);
    if (to === from) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        zoomAround(state, to, point);
        render(state);
        return;
    }
    const start = performance.now();
    const step = now => {
        const t = clamp((now - start) / ZOOM_DURATION, 0, 1);
        zoomAround(state, from + (to - from) * t * (2 - t), point);
        render(state);
        state.zoomFrame = t < 1 ? requestAnimationFrame(step) : 0;
    };
    state.zoomFrame = requestAnimationFrame(step);
}

// Tile raster hanya tajam pada zoom bulat, jadi setelah sebuah gestur selesai zoom
// dirapikan ke level bulat: searah gesturnya (direction 1 atau -1), atau ke yang terdekat.
// Peta tanpa tile dibiarkan di zoom pecahan.
function snapZoom(state, point, direction = 0) {
    if (!state.tileURL) return;
    let zoom = Math.round(state.zoom);
    if (direction > 0) zoom = Math.ceil(state.zoom - 0.02);
    if (direction < 0) zoom = Math.floor(state.zoom + 0.02);
    animateZoom(state, zoom, point);
}

function handleTap(state, target, point) {
    // Elemen modul tambahan yang mendaftar lewat onTap() menangani tap-nya sendiri: peta tidak
    // menganggapnya klik peta, dan popup yang sedang terbuka tidak ditutup.
    for (let element = target; element && element !== state.root; element = element.parentElement) {
        const runFunction = taps.get(element);
        if (runFunction) {
            runFunction();
            return;
        }
    }

    const record = records.get(target);
    const world = worldSize(state.zoom);
    const tapped = [
        state.x + (point[0] - state.width / 2) / world,
        state.y + (point[1] - state.height / 2) / world
    ];

    if (record && record.layer.popup !== false) {
        const content = typeof record.layer.popup === "function" ? record.layer.popup(record.feature) : defaultPopupContent(record.feature);
        // Popup sebuah titik menempel di titiknya; untuk garis dan polygon, di tempat yang diklik.
        if (record.shape.kind === "point") {
            openPopup(state, record.shape.point, content, record.shape.radius);
        } else {
            openPopup(state, tapped, content);
        }
    } else {
        hidePopup(state);
    }

    const position = unproject(tapped);
    state.clickHandlers.forEach(runFunction => runFunction(position, record ? record.feature : null));
}

function bindGestures(state) {
    const root = state.root;
    const pointers = new Map(); // pointerId -> titik terakhirnya di dalam peta
    let start = null;
    let moved = false;

    const pointOf = event => {
        const rect = root.getBoundingClientRect();
        return [event.clientX - rect.left, event.clientY - rect.top];
    };

    // Titik tengah semua jari yang menempel, dan jarak antara dua jari pertama.
    const gesture = () => {
        const points = [...pointers.values()];
        return {
            center: [
                points.reduce((sum, point) => sum + point[0], 0) / points.length,
                points.reduce((sum, point) => sum + point[1], 0) / points.length
            ],
            distance: points.length > 1 ? Math.hypot(points[0][0] - points[1][0], points[0][1] - points[1][1]) : 0
        };
    };

    const capture = pointerId => {
        try {
            root.setPointerCapture(pointerId);
        } catch (captureError) {
            // pointer sudah tidak aktif; geser tetap jalan selama pointer masih di dalam peta
        }
    };

    root.addEventListener("pointerdown", event => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        stopAnimation(state);
        if (pointers.size === 0) {
            start = pointOf(event);
            moved = false;
        }
        pointers.set(event.pointerId, pointOf(event));
        if (pointers.size > 1) {
            // Dua jari tidak pernah dihitung sebagai klik.
            moved = true;
            pointers.forEach((point, pointerId) => capture(pointerId));
        }
    });

    root.addEventListener("pointermove", event => {
        if (!pointers.has(event.pointerId)) return;
        const point = pointOf(event);
        if (!moved) {
            if (Math.hypot(point[0] - start[0], point[1] - start[1]) < DRAG_THRESHOLD) return;
            moved = true;
            // Pointer baru ditangkap setelah jelas ini geseran: kalau ditangkap sejak
            // pointerdown, target pointerup selalu peta dan fitur yang diklik tidak diketahui.
            capture(event.pointerId);
            root.classList.add("crootjs-map-dragging");
        }
        const before = gesture();
        pointers.set(event.pointerId, point);
        const after = gesture();
        panBy(state, after.center[0] - before.center[0], after.center[1] - before.center[1]);
        if (before.distance > 0 && after.distance > 0) {
            zoomAround(state, state.zoom + Math.log2(after.distance / before.distance), after.center);
        }
        requestRender(state);
    });

    const release = event => {
        if (!pointers.has(event.pointerId)) return;
        const center = gesture().center;
        const pinching = pointers.size > 1;
        pointers.delete(event.pointerId);
        // Pinch berakhir begitu jari tinggal satu: zoom dirapikan di titik tengah kedua jari
        // tadi, bukan di jari yang kebetulan diangkat terakhir.
        if (pinching && pointers.size < 2) snapZoom(state, center);
        if (pointers.size > 0) return;
        root.classList.remove("crootjs-map-dragging");
        if (!moved && event.type === "pointerup") handleTap(state, event.target, pointOf(event));
    };
    root.addEventListener("pointerup", release);
    root.addEventListener("pointercancel", release);

    root.addEventListener("dblclick", event => {
        animateZoom(state, Math.round(state.zoom) + 1, pointOf(event));
    });

    if (state.scrollZoom) {
        root.addEventListener("wheel", event => {
            event.preventDefault();
            stopAnimation(state);
            const point = pointOf(event);
            const lines = event.deltaMode === 1 ? 33 : 1; // Firefox melaporkan baris, bukan piksel
            // ctrlKey = pinch di trackpad, yang deltanya jauh lebih kecil daripada scroll biasa.
            const delta = clamp(-event.deltaY * lines * (event.ctrlKey ? 0.01 : 0.003), -1, 1);
            zoomAround(state, state.zoom + delta, point);
            requestRender(state);
            state.snapTimer = setTimeout(() => snapZoom(state, point, delta), 100);
        }, { passive: false });
    }

    root.addEventListener("keydown", event => {
        if (event.target !== root) return;
        const center = [state.width / 2, state.height / 2];
        const pans = { ArrowLeft: [80, 0], ArrowRight: [-80, 0], ArrowUp: [0, 80], ArrowDown: [0, -80] };
        if (pans[event.key]) {
            panBy(state, pans[event.key][0], pans[event.key][1]);
            requestRender(state);
        } else if (event.key === "+" || event.key === "=") {
            animateZoom(state, Math.round(state.zoom) + 1, center);
        } else if (event.key === "-") {
            animateZoom(state, Math.round(state.zoom) - 1, center);
        } else {
            return;
        }
        event.preventDefault();
    });
}

function addZoomControl(state) {
    const control = document.createElement("div");
    control.className = "crootjs-map-zoom";
    const button = (label, text, step) => {
        const element = document.createElement("button");
        element.type = "button";
        element.setAttribute("aria-label", label);
        element.textContent = text;
        element.addEventListener("click", () => {
            animateZoom(state, Math.round(state.zoom) + step, [state.width / 2, state.height / 2]);
        });
        control.appendChild(element);
        return element;
    };
    state.zoomIn = button("Perbesar", "+", 1);
    state.zoomOut = button("Perkecil", "−", -1);
    addControl(state, control, "top-left");
}

function addAttribution(state, text) {
    const element = document.createElement("div");
    element.className = "crootjs-map-attribution";
    if (text) {
        element.textContent = text;
    } else {
        // Lisensi data OpenStreetMap mewajibkan atribusi ini selama tile-nya dipakai.
        const link = document.createElement("a");
        link.href = "https://www.openstreetmap.org/copyright";
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent = "OpenStreetMap";
        element.append("© ", link, " contributors");
    }
    isolate(element);
    state.root.appendChild(element);
}

// Membuat peta di dalam elemen ber-ID `id`. Elemen itu harus sudah punya tinggi dari CSS.
// options (semua opsional):
//   center      [lng, lat] - urutan GeoJSON. Default: Indonesia.
//   zoom        default 4
//   minZoom     default 1
//   maxZoom     default 19
//   maxNativeZoom  level tile tertinggi yang tersedia di server. Di atasnya tile level ini
//               diperbesar (overzoom), jadi maxZoom boleh lebih tinggi. Default: maxZoom.
//               [Tambahan ifcoid/maps, belum ada di crootjs/lib 0.0.16.]
//   tiles       pola URL tile raster dengan {z}, {x}, {y}. Default: OpenStreetMap.
//               false = tanpa peta dasar, hanya data yang digambar.
//   labels      pola URL (atau daftar pola) tile label transparan yang digambar di atas
//               `tiles`, misalnya nama tempat dan jalan untuk citra satelit (hybrid).
//               [Tambahan ifcoid/maps, belum ada di crootjs/lib 0.0.16.]
//   attribution teks atribusi untuk `tiles` buatan sendiri
//   zoomControl false = tanpa tombol +/-
//   scrollZoom  false = roda mouse tetap menggulung halaman, tidak men-zoom peta
export function createMap(id, options = {}) {
    const container = document.getElementById(id);
    if (!container) {
        console.warn(`Elemen dengan ID "${id}" tidak ditemukan.`);
        return;
    }
    removeMap(id);
    injectStyles();

    const root = document.createElement("div");
    root.className = "crootjs-map";
    root.tabIndex = 0;
    root.setAttribute("role", "application");
    root.setAttribute("aria-label", "Peta");

    const tilePane = document.createElement("div");
    tilePane.className = "crootjs-map-tiles";
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "crootjs-map-vectors");
    const group = document.createElementNS(SVG_NS, "g");
    svg.appendChild(group);
    const overlay = document.createElement("div");
    overlay.className = "crootjs-map-overlay";
    root.append(tilePane, svg, overlay);

    const useDefaultTiles = options.tiles === undefined || options.tiles === true;
    const state = {
        container,
        root,
        tilePane,
        group,
        overlay,
        corners: {},
        moveHandlers: [],
        signature: "",
        x: 0.5,
        y: 0.5,
        zoom: 0,
        width: 0,
        height: 0,
        minZoom: Number.isFinite(options.minZoom) ? options.minZoom : 1,
        maxZoom: Number.isFinite(options.maxZoom) ? options.maxZoom : 19,
        maxNativeZoom: Number.isFinite(options.maxNativeZoom) ? options.maxNativeZoom
            : (Number.isFinite(options.maxZoom) ? options.maxZoom : 19),
        tileURL: useDefaultTiles ? DEFAULT_TILES : (options.tiles || null),
        labelURLs: [].concat(options.labels || []),
        scrollZoom: options.scrollZoom !== false,
        tiles: new Map(),
        layers: [],
        built: null,
        popup: null,
        popupElement: null,
        clickHandlers: [],
        renderFrame: 0,
        zoomFrame: 0,
        snapTimer: 0,
        removed: false,
        // Lapisan peta diposisikan absolut terhadap elemen ini.
        restorePosition: getComputedStyle(container).position === "static"
    };

    if (state.restorePosition) container.style.position = "relative";
    container.appendChild(root);
    // Elemen yang sedang display: none (misalnya tab yang belum dibuka) tidak diperingatkan:
    // petanya menyesuaikan diri begitu elemennya ditampilkan.
    if (container.clientHeight === 0 && container.getClientRects().length > 0) {
        console.warn(`Elemen "${id}" tingginya 0, jadi petanya tidak akan terlihat. Beri tinggi lewat CSS, misalnya height: 360px.`);
    }

    const center = project(Array.isArray(options.center) ? options.center : [118, -2.5]);
    setView(state, center[0], center[1], Number.isFinite(options.zoom) ? options.zoom : 4);

    if (options.zoomControl !== false) addZoomControl(state);
    if (useDefaultTiles || options.attribution) addAttribution(state, options.attribution);
    bindGestures(state);

    state.resizeObserver = new ResizeObserver(() => requestRender(state));
    state.resizeObserver.observe(root);

    // Antarmuka untuk modul tambahan (mapmarker.js, mapcontrol.js, atau buatanmu sendiri).
    // Dititipkan di elemennya, bukan diekspor, karena modul tambahan tidak boleh mengimpor
    // map.js: halaman biasanya memuat map.min.js, sedangkan import "./map.js" dari modul lain
    // memuat salinan kedua dengan daftar peta yang terpisah - dan petanya tidak akan ketemu.
    container.crootjsMap = {
        overlay,
        toPoint: position => toPoint(state, position),
        toPosition: point => toPosition(state, point),
        getView: () => currentView(state),
        setView: (center, zoom) => {
            stopAnimation(state);
            const point = project(center);
            setView(state, point[0], point[1], zoom);
            render(state);
        },
        panBy: (dx, dy) => {
            panBy(state, dx, dy);
            requestRender(state);
        },
        onMove: runFunction => subscribeMove(state, runFunction),
        // Tap (klik tanpa geser) pada sebuah elemen di overlay. Geseran yang berawal di elemen
        // itu tetap menggeser peta, karena gesturnya tetap ditangani peta.
        onTap: (element, runFunction) => taps.set(element, runFunction),
        addControl: (element, corner) => addControl(state, element, corner),
        showPopup: (position, content, offset) => openPopup(state, project(position), content, offset),
        closePopup: () => hidePopup(state)
    };

    maps.set(id, state);
    render(state);
}

// Menghapus peta dari elemennya dan menghentikan semua listener-nya.
export function removeMap(id) {
    const state = maps.get(id);
    if (!state) return;
    state.removed = true;
    stopAnimation(state);
    cancelAnimationFrame(state.renderFrame);
    state.resizeObserver.disconnect();
    state.root.remove();
    if (state.restorePosition) state.container.style.position = "";
    delete state.container.crootjsMap;
    maps.delete(id);
}

// Memindahkan tampilan ke center [lng, lat]. zoom opsional; tanpa zoom, level sekarang dipertahankan.
export function setMapView(id, center, zoom) {
    const state = getMap(id);
    if (!state) return;
    stopAnimation(state);
    const point = project(center);
    setView(state, point[0], point[1], zoom);
    render(state);
}

// Tampilan sekarang: { center: [lng, lat], zoom }.
export function getMapView(id) {
    const state = getMap(id);
    if (!state) return null;
    return { center: unproject([state.x, state.y]), zoom: state.zoom };
}

// Bagian dunia yang sedang terlihat, sebagai bbox [minLng, minLat, maxLng, maxLat].
// Berguna untuk meminta ke backend hanya data di area yang tampak.
export function getMapBounds(id) {
    const state = getMap(id);
    if (!state) return null;
    const world = worldSize(state.zoom);
    const halfWidth = state.width / 2 / world;
    const halfHeight = state.height / 2 / world;
    const southWest = unproject([clamp(state.x - halfWidth, 0, 1), clamp(state.y + halfHeight, 0, 1)]);
    const northEast = unproject([clamp(state.x + halfWidth, 0, 1), clamp(state.y - halfHeight, 0, 1)]);
    return [southWest[0], southWest[1], northEast[0], northEast[1]];
}

// Posisi [lng, lat] -> titik [x, y] dalam piksel, dihitung dari pojok kiri-atas peta.
// Hasilnya bisa di luar ukuran peta kalau posisinya sedang tidak terlihat.
export function mapToPoint(id, position) {
    const state = getMap(id);
    if (!state) return null;
    return toPoint(state, position);
}

// Kebalikannya: titik [x, y] piksel dari pojok kiri-atas peta -> posisi [lng, lat].
export function pointToPosition(id, point) {
    const state = getMap(id);
    if (!state) return null;
    return toPosition(state, point);
}

// runFunction({ center, zoom }) dipanggil setiap kali tampilan berubah: digeser, di-zoom,
// atau ukuran petanya berubah - termasuk di setiap frame selama gestur berlangsung.
// Mengembalikan function stop() untuk berhenti mendengarkan.
export function onMapMove(id, runFunction) {
    const state = getMap(id);
    if (!state) return () => {};
    return subscribeMove(state, runFunction);
}

// Menaruh elemen buatanmu (tombol, legenda, dsb) di pojok peta: "top-left", "top-right"
// (bawaan), "bottom-left", atau "bottom-right". Klik di dalamnya tidak menggeser peta.
// Mengembalikan function remove() untuk mencabutnya lagi.
export function addMapControl(id, element, corner = "top-right") {
    const state = getMap(id);
    if (!state) return () => {};
    return addControl(state, element, corner);
}

// Memaskan tampilan ke seluruh data. `geojson` boleh GeoJSON apa pun yang diterima
// parseGeoJSON, atau langsung sebuah bbox [minLng, minLat, maxLng, maxLat].
// padding: jarak kosong (piksel) antara data dan tepi peta.
export function fitMap(id, geojson, padding = 24) {
    const state = getMap(id);
    if (!state) return;
    const isBBox = Array.isArray(geojson) && geojson.length === 4 && geojson.every(Number.isFinite);
    const bbox = isBBox ? geojson : getBBox(geojson);
    if (!bbox) return;

    stopAnimation(state);
    state.width = state.root.clientWidth;
    state.height = state.root.clientHeight;
    const southWest = project([bbox[0], bbox[1]]);
    const northEast = project([bbox[2], bbox[3]]);
    const spanX = Math.abs(northEast[0] - southWest[0]);
    const spanY = Math.abs(southWest[1] - northEast[1]);

    let zoom = SINGLE_POINT_ZOOM;
    if (spanX > 0 || spanY > 0) {
        zoom = Math.log2(Math.min(
            (state.width - 2 * padding) / (spanX * TILE_SIZE),
            (state.height - 2 * padding) / (spanY * TILE_SIZE)
        ));
        // Peta yang belum punya ukuran (misalnya masih display: none) tidak bisa dipaskan.
        if (!Number.isFinite(zoom)) zoom = state.minZoom;
        // Dibulatkan ke bawah supaya tile raster tetap tajam dan datanya tetap muat.
        if (state.tileURL) zoom = Math.floor(zoom);
    }
    setView(state, (southWest[0] + northEast[0]) / 2, (southWest[1] + northEast[1]) / 2, zoom);
    render(state);
}

// Menggambar GeoJSON di atas peta. `geojson` boleh apa pun yang diterima parseGeoJSON:
// FeatureCollection, satu Feature, satu geometri, atau array-nya.
// options (semua opsional):
//   style  object { stroke, strokeWidth, strokeOpacity, fill, fillOpacity, radius },
//          atau function (feature) => object untuk membedakan tiap fitur
//   popup  function (feature) => teks atau elemen DOM yang ditampilkan saat fitur diklik
//          (null = tanpa popup untuk fitur itu). Default: daftar properties-nya.
//          false = tanpa popup sama sekali.
// Mengembalikan function remove() untuk menghapus lapisan ini dari peta.
export function addGeoJSON(id, geojson, options = {}) {
    const state = getMap(id);
    if (!state) return () => {};
    const collection = parseGeoJSON(geojson);
    if (!collection) {
        console.warn("addGeoJSON: datanya bukan GeoJSON, tidak ada yang digambar.");
        return () => {};
    }

    const layer = {
        group: document.createElementNS(SVG_NS, "g"),
        shapes: [],
        popup: options.popup
    };
    const markers = [];

    collection.features.forEach(feature => {
        const style = (typeof options.style === "function" ? options.style(feature) : options.style) || {};
        shapesOf(feature.geometry).forEach(shape => {
            const element = document.createElementNS(SVG_NS, shape.kind === "point" ? "circle" : "path");
            element.setAttribute("class", "crootjs-map-" + shape.kind);
            Object.keys(STYLE_PROPERTIES).forEach(key => {
                // Garis tidak pernah diisi, walaupun style yang sama dipakai untuk polygon.
                if (style[key] === undefined || (shape.kind === "line" && key.startsWith("fill"))) return;
                element.style.setProperty(STYLE_PROPERTIES[key], style[key]);
            });
            shape.element = element;
            records.set(element, { feature, layer, shape });
            layer.shapes.push(shape);
            if (shape.kind === "point") {
                shape.radius = Number.isFinite(style.radius) ? style.radius : 7;
                markers.push(element);
                return;
            }
            layer.group.appendChild(element);
            if (shape.kind === "line") {
                // Garis tipis sulit diklik, apalagi dengan jari: path transparan yang lebih
                // lebar menjadi area kliknya. Ditaruh paling bawah supaya tidak merebut klik
                // dari bentuk lain yang terlihat.
                shape.hit = document.createElementNS(SVG_NS, "path");
                shape.hit.setAttribute("class", "crootjs-map-hit");
                records.set(shape.hit, { feature, layer, shape });
                layer.group.prepend(shape.hit);
            }
        });
    });
    // Titik digambar paling atas, apa pun urutannya di data: kalau tidak, polygon yang
    // datang belakangan menutupi marker di dalamnya.
    markers.forEach(element => layer.group.appendChild(element));

    state.group.appendChild(layer.group);
    state.layers.push(layer);
    state.built = null; // paksa renderVectors menulis koordinat lapisan baru ini
    render(state);

    return function remove() {
        const index = state.layers.indexOf(layer);
        if (index === -1) return;
        state.layers.splice(index, 1);
        layer.group.remove();
    };
}

// Menghapus semua lapisan GeoJSON dan menutup popup. Peta dasarnya tetap.
export function clearMap(id) {
    const state = getMap(id);
    if (!state) return;
    state.layers.forEach(layer => layer.group.remove());
    state.layers = [];
    hidePopup(state);
}

// Menampilkan popup di position [lng, lat]. content: teks, atau elemen DOM.
export function showPopup(id, position, content) {
    const state = getMap(id);
    if (!state) return;
    openPopup(state, project(position), content);
}

export function closePopup(id) {
    const state = getMap(id);
    if (!state) return;
    hidePopup(state);
}

// runFunction(position, feature) dipanggil setiap kali peta diklik atau di-tap (bukan
// digeser). position = [lng, lat] titik yang diklik; feature = fitur GeoJSON yang kena
// klik, atau null kalau yang diklik peta dasarnya.
export function onMapClick(id, runFunction) {
    const state = getMap(id);
    if (!state) return;
    state.clickHandlers.push(runFunction);
}
