# Satzhören

Sprachen lernen durch Hören ganzer Sätze. Alle Audios sind einmalig vorproduziert
(`scripts/generate-audio.mjs`, Gemini TTS) und liegen als MP3 unter `public/audio`.
Die App selbst braucht keine KI und keinen Schlüssel.

- `npm run dev` – lokal auf Port 3003
- `npm run audio -- src/data/<deck>.json` – Audios für einen Stapel erzeugen (einmalig)
- `npm run deploy` – Build + Veröffentlichung auf GitHub Pages
