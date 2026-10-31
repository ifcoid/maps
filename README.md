# maps

Weberek Maps: peta pendukung paket ITC (Information Technology, Communications &
Electronic Security) DED Weberek Correctional Building, Manufahi, Timor-Leste.
Dibangun dengan [CrootJS](https://croot.js.org) (`map.js`, `mapmarker.js`, `mapcontrol.js`,
`maptools.js`, `geomeasure.js` v0.0.20 dari jsDelivr): situs statis, tanpa build step.

## Peta

| Halaman | Isi |
|---|---|
| `weberek/` | Master Plan Rev.14 tergeoreferensi, koridor akses 9,4 km (rute fiber backhaul), trafo rural 50 kVA eksisting terdekat, usulan tie-in suplai ke power house, node ITC (ER/CR, PH, BTS, gerbang, menara), dan desain ITC Interim Rev.1: cincin fiber, spur, 66 kamera situs/perimeter, 12 zona deteksi tembok + microwave, grade Security Design Matrix, zona DAS, fall zone BTS, repeater DMR, sleeve |

## Data terenkripsi

Repo ini publik. Layout Master Plan dan desain keamanan ITC (kamera, zona deteksi, grade,
zona seluler) hanya di-commit dalam bentuk terenkripsi: `data/secure/weberek.bin`
(AES-256-GCM, kunci PBKDF2-SHA256 600.000 iterasi dari password). Halaman peta meminta
password lalu mendekripsi di browser (`weberek/secure.js`); tanpa password hanya lapisan
publik (koridor, listrik, sudut tapak IR) yang tampil.

- Plaintext dibangun ke `private/` (di-ignore), lalu `python3 tools/encrypt_data.py`.
- Password: `MAPS_DATA_PASSWORD` di `/home/adb/awangga/.env`. Jangan di-commit, jangan
  dikirim lewat kanal yang sama dengan tautan peta.

## Struktur

```
index.html                 katalog peta
assets/style.css           gaya bersama
weberek/                   peta koridor akses & suplai listrik
data/*.geojson             data publik hasil build (jangan diedit tangan)
data/secure/weberek.bin    data sensitif terenkripsi (master plan + desain ITC)
private/                   plaintext data sensitif (di-ignore, input encrypt_data.py)
tools/build_weberek_data.py  koridor, situs, listrik: OSM + koordinat Inception Report
tools/georef_rev14.py      transformasi grid CAD Rev.14 -> WGS84 (titik kontrol + bukti)
tools/build_masterplan.py  DXF Rev.14 -> GeoJSON master plan + titik ITC (butuh ezdxf)
tools/build_itc_design.py  lapisan desain ITC dari NetDet build_overlay_dwg.py (tanpa ezdxf)
tools/build_dwg_overlays.py  vektor DWG overlay: denah blok sel + 20 kamera (VSS-002) dan anotasi 6 lembar situs (butuh ezdxf)
tools/build_reference.py   rujukan: jalur fiber/microwave ITU (WFS) + catatan cakupan nPerf (tanpa tile nPerf)
tools/build_topo.py        kontur survei 1 m dari layer 1 KONTUR Master Plan Rev.14 (butuh ezdxf)
tools/encrypt_data.py      private/*.geojson -> data/secure/weberek.bin
```

## Data dan sumber

- Sudut situs P1–P4, existing prison building, trafo 50 kVA: Inception Report
  proyek induk (Table 3, Fig. 41–44), WGS84.
- Geometri jalan dan jalur transmisi EDTL: OpenStreetMap (ODbL), ID way
  dipatok di `tools/build_weberek_data.py`.
- Master Plan Rev.14: DWG proyek induk (`NetDet/02-referensi/proyek-induk-weberek/sumber/`),
  dikonversi ke DXF dengan `NetDet/03-survei/tools/dwg-convert.sh -f dxf`. Titik ITC
  disalin dari `NetDet/05-desain/gambar-cad/cad/build_overlay_dwg.py`.
- Desain ITC (cincin, spur, kamera, zona PIDS, grade, DAS, radio, sleeve): blok geometri
  `NetDet/05-desain/gambar-cad/cad/build_overlay_dwg.py` dijalankan langsung oleh
  `tools/build_itc_design.py`, jadi peta = lembar ITC Rev.B. Jalankan ulang setiap skrip overlay berubah.
- Vektor DWG: `ITC-CELLBLOCK-OVERLAY.dwg` (denah tipikal blok + kamera, dipasang ke 5 atap
  MP no. 8 yang ukurannya sama 40,5 x 17,0 m; ujung sally port dari kanopi) dan anotasi
  `ITC-SITE-OVERLAY-REV14.dwg`. DWG tidak disalin; hanya vektornya, terenkripsi.
- Bangun ulang: `python3 tools/build_weberek_data.py` (butuh Overpass API) dan
  `python3 tools/build_masterplan.py "<path>/MASTER PLAN Rev.14.dxf"` (butuh ezdxf).

- Rujukan konektivitas: jalur transmisi ITU Broadband Maps (dilaporkan operator, kasar,
  non-komersial dengan atribusi) dan catatan pengamatan peta nPerf 28 Okt 2026. Tile/data nPerf
  tidak direproduksi: syarat nPerf (Art. 6, 8) mewajibkan izin tertulis; tiap catatan menaut ke
  peta nPerf langsung.

Hasil cek silang koridor (build 27 Okt 2026):

- Rantai jalan OSM dari simpang jalan utama Betano–Umaboco (A) sampai ujungnya
  dekat trafo: 9.437 m. Angka ini cocok dengan 9,4 km di Inception Report. Ruas A
  sampai batas situs (E) 8.802 m, karena jalan OSM memotong sudut selatan persil.
- Garis lurus dari simpang Aldeia Weberek (D) ke trafo: 2.587 m, sedangkan IR
  menyebut ±2.577 m. Artinya garis MV eksisting berupa jalur tiang lurus, tidak
  mengikuti jalan.
- Luas poligon P1–P4 adalah 18,1 ha, sementara IR menyebut persil 25 ha.

Georeferensi Master Plan Rev.14 (27 Okt 2026):

- Grid CAD = grid survei BM1–BM3 yang digeser (E +19.650,805; N −1.815,017),
  tanpa ikatan geodetik. Semua koordinat geografis IR diambil dari Google Earth.
- Transformasi rigid (skala 1, rotasi −2,66°) hasil kuadrat terkecil dari P1–P4
  dan existing building. Residu P1 145 m, P2 71 m, P3 6 m, P4 67 m, EX 50 m,
  karena bentuk P1–P4 (18 ha) berbeda dari persil Rev.14 (24,7 ha). Akurasi ±50 m.
- Cek independen: gerbang utama MG jatuh 9 m dari titik jalan akses OSM masuk
  situs; semua titik CPT/GRS lapangan di dalam persil 25 ha; koordinat lembar
  CPT 20 m dari existing building; rural housing CAD jatuh di area permukiman OSM
  Bairo Wesa; kontur CAD berkorelasi 0,83 dengan DEM Copernicus 30 m.
- Z CAD = tinggi elipsoid GNSS: selisihnya dengan DEM ±39 m, sesuai undulasi
  geoid +41,5 m (EGM2008).
- Hipotesis "BM = UTM 51S terpotong" (E 8387 → 818387) ditolak, karena titik
  CPT/GRS lapangan jadi jatuh di luar persil.
- Kontur survei (layer 1 KONTUR, interval 1 m, El. +159 s.d. +176) ditampilkan
  sebagai lapisan `contours` (default mati). Karena Z = tinggi elipsoid, tinggi
  di atas muka laut kira-kira El. − 41,5 m (situs ±118–135 m dpl); basemap OpenTopoMap
  (SRTM) memakai muka laut.
- Usulan: satu sesi GNSS pada BM1–BM3 untuk mengikat grid ke UTM 51S dan
  menghapus ketidakpastian ±50 m.

Rute MV dan tie-in bersifat indikatif. Substation, genset, dan pekerjaan MV
termasuk lingkup MEP/EDTL; ditampilkan di sini karena menentukan antarmuka daya ITC.

## Menjalankan lokal

```
python3 -m http.server 8000
# buka http://localhost:8000/
```
