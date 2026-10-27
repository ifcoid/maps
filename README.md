# maps

Weberek Maps: peta pendukung paket ITC (Information Technology, Communications &
Electronic Security) DED Weberek Correctional Building, Manufahi, Timor-Leste.
Dibangun dengan [CrootJS](https://croot.js.org) (`map.js`, `mapmarker.js`,
`mapcontrol.js` v0.0.16 dari jsDelivr): situs statis, tanpa build step.

## Peta

| Halaman | Isi |
|---|---|
| `weberek/` | Koridor akses 9,4 km (rute fiber backhaul), trafo rural 50 kVA eksisting terdekat, usulan tie-in suplai ke situs |

## Struktur

```
index.html                 katalog peta
assets/style.css           gaya bersama
weberek/                   peta koridor akses & suplai listrik
data/*.geojson             data hasil build (jangan diedit tangan)
tools/build_weberek_data.py  bangun ulang data dari OSM + koordinat Inception Report
```

## Data dan sumber

- Sudut situs P1–P4, existing prison building, trafo 50 kVA: Inception Report
  proyek induk (Table 3, Fig. 41–44), WGS84.
- Geometri jalan, track selatan, jalur transmisi EDTL: OpenStreetMap (ODbL), ID way
  dipatok di `tools/build_weberek_data.py`.
- Bangun ulang: `python3 tools/build_weberek_data.py` (butuh akses ke Overpass API).

Hasil cek silang (build 27 Okt 2026):

- Rantai jalan OSM dari simpang jalan utama Betano–Umaboco (A) sampai ujungnya
  dekat trafo: 9.437 m. Angka ini cocok dengan 9,4 km di Inception Report. Ruas A
  sampai batas situs (E) 8.802 m, karena jalan OSM memotong sudut selatan persil.
- Garis lurus dari simpang Aldeia Weberek (D) ke trafo: 2.587 m, sedangkan IR
  menyebut ±2.577 m. Artinya garis MV eksisting berupa jalur tiang lurus, tidak
  mengikuti jalan.
- Luas poligon P1–P4 adalah 18,1 ha, sementara IR menyebut persil 25 ha. P1–P4
  hanya titik sudut hasil survei, bukan batas persil penuh.

Rute MV dan tie-in bersifat indikatif. Substation, genset, dan pekerjaan MV
termasuk lingkup MEP/EDTL; ditampilkan di sini karena menentukan antarmuka daya ITC.

## Menjalankan lokal

```
python3 -m http.server 8000
# buka http://localhost:8000/
```
