---
name: morning-blues-visualizer-dev
version: 1.0.0
description: Core knowledge and rules for developing the Morning Blues Audio Visualizer using HTML5 Canvas and Web Audio API.
author: jf-c0des
tags:
  - frontend
  - vanilla-js
  - web-audio-api
  - canvas-2d
  - retro-futuristic
---

# Skill: Morning Blues Audio Visualizer Development

Dokumen ini mendefinisikan standar, arsitektur, dan aturan (rules) untuk pengembangan **Morning Blues Audio Visualizer**. Setiap kontribusi atau modifikasi kode pada project ini harus mematuhi panduan di bawah ini.

## 1. Deskripsi Project
Morning Blues Audio Visualizer adalah web-based audio visualizer yang mengusung estetika *retro-futuristic* dan industrial (terinspirasi dari speaker Morning Blues / SonicGlass). Project ini murni berjalan di sisi klien (frontend) tanpa backend, bertugas untuk menangkap audio sistem secara real-time dan merendernya menjadi elemen visual (gelombang osiloskop, grain, dan teks telemetri) pada HTML5 Canvas.

## 2. Arsitektur Inti
- **Core Engine:** Vanilla JavaScript / TypeScript (ES6+). Dilarang menggunakan framework berat seperti React atau Vue untuk tahap ini agar memori tetap ringan.
- **Audio Engine:** `Web Audio API` (`AudioContext`, `AnalyserNode`).
- **Render Engine:** `HTML5 Canvas 2D API`.
- **Environment:** Local Web Server (misal: Vite, Live Server) dengan protokol `http://localhost` atau `https://` (wajib untuk izin akses media browser).

## 3. Aturan Audio (`getDisplayMedia`)
Penangkapan audio tidak menggunakan mikrofon, melainkan audio internal perangkat. Aturan implementasinya:
1. **User Interaction Required:** Inisialisasi `AudioContext` **harus** dipicu oleh interaksi langsung dari user (contoh: event klik pada tombol "Start"). Browser akan memblokir autoplay jika ini dilanggar.
2. **Stream Capture:** Gunakan `navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })`.
3. **Video Track Handling:** Karena `getDisplayMedia` memaksa *screen sharing*, track video akan ikut terbawa. **Wajib** sembunyikan atau matikan track video segera setelah stream didapatkan untuk menghemat resource memori.
4. **Data Ekstraksi:** Gunakan `AnalyserNode.getByteFrequencyData()` atau `getByteTimeDomainData()` untuk memecah frekuensi (Sub-bass, Mid, Treble).

## 4. Aturan Canvas & Render
1. **Render Loop:** Wajib menggunakan `window.requestAnimationFrame()` untuk render loop. Dilarang keras menggunakan `setInterval` atau `setTimeout` untuk animasi visualizer.
2. **Target Performa:** Harus stabil di **60 FPS**. Kurangi kalkulasi matematika kompleks di dalam render loop. Lakukan *pre-calculation* jika memungkinkan.
3. **Style & Warna:**
   - Palet utama: Warna oranye hangat (contoh: `#ff4d00`).
   - Latar belakang: Gelap/Hitam transparan (persiapan untuk fitur transparent desktop window).
   - Efek pudar (Fade/Trail): Alih-alih menggunakan `ctx.clearRect()`, gunakan `ctx.fillStyle = 'rgba(0, 0, 0, 0.2)'` dan `ctx.fillRect()` untuk menciptakan efek *motion blur* atau jejak visual ala layar CRT.
4. **Tipografi (Telemetri):** Gunakan font berjenis monospace (seperti `VT323`, `Share Tech Mono`, atau `Space Mono`) yang dimuat dengan benar sebelum canvas merender teks (gunakan `document.fonts.ready`).

## 5. Struktur Folder
Project harus dijaga agar tetap datar dan sederhana:

```text
morning-blues/
├── index.html       # Entry point, berisi deklarasi canvas dan tombol pancingan audio
├── style.css        # Styling dasar (reset margin, full screen canvas, custom font)
├── visualizer.js    # Logic Web Audio API dan Canvas Render Loop
└── assets/
    └── fonts/       # (Opsional) Local font files jika tidak menggunakan Google Fonts
```

---
**Catatan untuk AI/Cursor:** Saat memodifikasi `visualizer.js`, prioritaskan pemisahan antara fungsi *Audio Setup* dan fungsi *Canvas Drawing* agar kode mudah di-debug.