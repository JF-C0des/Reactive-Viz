# Reactive-Viz

MorningBlues **SonicGlass A1** inspired real-time web audio visualizer built with Vanilla JS, HTML5 Canvas 2D, Web Audio API (`getDisplayMedia`), GSAP, and optional Spotify PKCE Now-Playing album palette & backdrop sync.

## Quick Start

1. **(Optional — Spotify Sync)** Copy `config.example.js` to `config.js` and add your Spotify App `SPOTIFY_CLIENT_ID` (with `http://127.0.0.1:3000/` added to Redirect URIs in your Spotify Developer Dashboard):
   ```powershell
   Copy-Item config.example.js config.js
   ```
2. Serve the project locally on port `3000`:
   ```powershell
   npx serve . -l 3000
   ```
3. Open `http://127.0.0.1:3000/` in **Chrome** or **Edge**, click **Connect System Audio** (enable **"Also share system/tab audio"**), and optionally click **Connect Spotify**.
