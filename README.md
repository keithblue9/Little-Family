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
- **Misi Keluarga** mingguan, foto **sebelum/sesudah**, **Saran Jadwal** adaptif,
  **Kenangan Bulan Ini**, **Mode Sederhana** untuk anak kecil, dan **Ctrl/⌘+K**
  untuk perintah cepat orang tua.
- **5 tema**: `clean` (orang tua), `candy` & `mermaid` (anak perempuan 8-10),
  `cyber` & `galaxy` (anak laki-laki 11-14). Terapkan via `applyTheme(id)` di `src/lib/theme.js`.

## Performa & penjadwalan
- **Hari dibangun saat dibutuhkan.** Hanya hari ini dan besok yang disiapkan otomatis
  (tidak ada lagi sapuan 14 hari). Hari lain disiapkan saat orang tua membukanya
  (`POST /api/days/{tanggal}/prepare`) atau menambah tugas ke tanggal itu.
- **Rapikan Jadwal** (Pengaturan) menghapus salinan lama hari-hari ke depan yang belum
  disentuh; semuanya diarsipkan dan bisa dibatalkan.
- **Satu request per layar**: `/api/parent/bootstrap` dan `/api/kid/{id}/bootstrap`.
- **Gambar** dikirim sebagai URL bertanda tangan (`/api/media/...`) yang di-cache browser,
  bukan base64 di setiap respons. Foto tugas disimpan di koleksi `media` terpisah; dokumen
  tugas hanya menyimpan penunjuk `media:<tag>`. Foto lama dipindahkan otomatis bertahap
  oleh `/api/warmup` dan cron.
- **Cache GET bersama** (`src/lib/api.js`): GET yang sama dan sedang berjalan dipakai
  bersama; `/config`, `/children`, dll. dipakai ulang sebentar. Setiap tulis (POST/PUT/
  PATCH/DELETE) mengosongkan cache. `{ fresh: true }` untuk melewatinya.
- **Offline anak**: Mulai, centang, dan Selesai tetap jalan tanpa internet, diantrikan
  berurutan dan dikirim saat online. Mulai/Selesai membawa `happened_at` (jam asli
  ditekan, maks. 12 jam ke belakang) sehingga tidak dianggap terlambat.
- **Satu jam per bagian, bukan per tugas.** Tugas tidak punya jam/timer sendiri; durasi
  hanya informasi. Batasnya adalah jam selesai bagian (bisa diatur per anak per hari).
  Bagian yang lewat jam tanpa selesai dilaporkan ke orang tua ("Perlu keputusanmu" di
  Monitor Harian) — tidak ada hukuman otomatis.
- **Tulis ringkasan**: aktivitas bisa mewajibkan anak menulis ringkasan (min. N kata,
  bisa lewat suara) sebelum bisa dicentang; orang tua menilai 👍 / tulis ulang.
- **Salin rutinitas antar anak**: per aktivitas, per hari, atau seminggu penuh.
- **Keep-warm**: workflow `.github/workflows/keep-warm.yml` memanggil `/api/warmup` tiap
  5 menit. Isi secret `APP_URL` di GitHub agar aktif.

## Tes
```bash
cd backend
pip install mongomock-motor httpx
python test_e2e.py            # suite lengkap
python test_lazy_schedule.py  # penjadwalan lazy, bootstrap, media, fitur baru
```

## Catatan pengembangan
Repo ini sudah dibersihkan dari seluruh scaffolding/branding pihak ketiga.
Lihat commit history untuk detail perubahan.
