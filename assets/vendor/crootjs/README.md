# crootjs (vendored)

`map.js` dan `geo.js` dari [crootjs/lib](https://github.com/crootjs/lib) v0.0.16
(GPL-2.0, lihat `LICENSE`). Modul lain (`mapmarker.js`, `mapcontrol.js`) tetap
dimuat dari jsDelivr karena tidak mengimpor `map.js`.

Satu perubahan di `map.js`: opsi `maxNativeZoom` (overzoom). Tile diambil sampai
level ini lalu diperbesar, sehingga `maxZoom` bisa lebih tinggi daripada level
tile yang tersedia. Citra Esri di Weberek hanya ada sampai z18, sedangkan peta
perlu zoom sampai z21 (skala ±5 m) untuk membaca detail layout Rev.14.
Usulan: ajukan opsi ini ke crootjs/lib, lalu kembali ke CDN.
