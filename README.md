# My Lil Famz

Aplikasi tugas & to-do list keluarga yang seru untuk anak — lengkap dengan reward,
konsekuensi, gamifikasi (poin, streak, badge), dan pemantauan orang tua.

## Arsitektur
- **Frontend:** React (Create React App + CRACO), Tailwind + shadcn/ui, React Router, React Query.
- **Backend:** FastAPI + MongoDB (Motor), autentikasi JWT (cookie) + bcrypt.
- **PWA:** dapat di-*install* ke layar utama dan bekerja offline (service worker).

## Menjalankan secara lokal

### Backend
```bash
cd backend
pip install -r requirements.txt
# buat file .env berisi:
#   MONGO_URL=mongodb://localhost:27017
#   DB_NAME=mylilfamz
#   JWT_SECRET=ganti-dengan-string-acak-panjang
#   CORS_ORIGINS=http://localhost:3000
uvicorn server:app --reload --port 8000
```

### Frontend
```bash
cd frontend
yarn install     # atau: npm install
# buat file .env berisi:
#   REACT_APP_BACKEND_URL=http://localhost:8000
yarn start       # atau: npm start
```

Buka http://localhost:3000.

## Fitur
- Peran **orang tua/admin** dan **anak**, dengan PIN Gate untuk masuk mode orang tua.
- Tugas per anak (poin, penalti, jatuh tempo, pengulangan), reward, dan konsekuensi.
- Poin, streak, dan badge otomatis; log aktivitas & statistik dashboard untuk pemantauan.
- **PWA**: tombol *Install App* (Android/desktop) dan petunjuk *Add to Home Screen* (iOS).
- **5 tema**: `clean` (orang tua), `candy` & `mermaid` (anak perempuan 8-10),
  `cyber` & `galaxy` (anak laki-laki 11-14). Terapkan via `applyTheme(id)` di `src/lib/theme.js`.

## Catatan pengembangan
Repo ini sudah dibersihkan dari seluruh scaffolding/branding pihak ketiga.
Lihat commit history untuk detail perubahan.
