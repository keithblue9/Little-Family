import { lazy } from "react";
import { Plus, Trash2, RotateCcw, PawPrint, Scale } from "lucide-react";
import api, { formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { TEST_IDS } from "@/constants/testIds/app";
import { ALL_MBTI, PERSONALITY_PROFILES } from "@/lib/personality";
import { QUEST_THEME_LIST } from "@/lib/questThemes";
import { btnDanger, btnPrimary } from "@/pages/parent/shared";

const ProfileEditor = lazy(() => import("@/components/ProfileEditor"));
const ConfigMenu = lazy(() => import("@/components/ConfigMenu"));
const MemberPasscodeManager = lazy(() => import("@/components/ChildPasscodeManager"));
const Achievements = lazy(() => import("@/components/Achievements"));
const PushNotificationManager = lazy(() => import("@/components/PushNotificationManager"));
const LabelEditor = lazy(() => import("@/components/LabelEditor"));
const ViewLinksManager = lazy(() => import("@/components/ViewLinksManager"));
const LevelConfigEditor = lazy(() => import("@/components/LevelConfigEditor"));
const PetConfigEditor = lazy(() => import("@/components/PetConfigEditor"));
const PetResetRequestsReview = lazy(() => import("@/components/PetResetRequestsReview"));
const MaintenanceModeCard = lazy(() => import("@/components/MaintenanceModeCard"));
const CompactScheduleCard = lazy(() => import("@/components/CompactScheduleCard"));
const LateReasonsConfig = lazy(() => import("@/components/LateReasonsConfig"));
const PunishmentConfig = lazy(() => import("@/components/PunishmentConfig"));
const DaySegmentsConfig = lazy(() => import("@/components/DaySegmentsConfig"));
const SegmentStartsConfig = lazy(() => import("@/components/SegmentStartsConfig"));
const ExamPeriodConfig = lazy(() => import("@/components/ExamPeriodConfig"));

export function SettingsView({ kids, onAdd, onRefresh }) {
  const { user } = useAuth();

  const delChild = async (c) => {
    if (!window.confirm(`Hapus ${c.name}? Ini menghapus semua tugas dan riwayatnya.`)) return;
    try { await api.delete(`/children/${c.id}`); toast.success("Anak dihapus"); onRefresh(); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  // Repairs a wallet whose three buckets no longer add up to the balance —
  // older resets zeroed the points but left the buckets behind.
  // Manual correction. Rules can't cover everything — a bug cost points, or
  // something happened worth rewarding that no mission covers.
  const adjustPoints = async (c) => {
    const raw = window.prompt(
      `Tambah atau kurangi poin ${c.name}?\n\nIsi angka positif untuk menambah (mis. 50), atau negatif untuk mengurangi (mis. -30).`
    );
    if (raw === null) return;
    const delta = parseInt(String(raw).trim(), 10);
    if (!Number.isFinite(delta) || delta === 0) {
      toast.error("Isi angka selain nol ya");
      return;
    }
    const reason = window.prompt("Alasannya apa? (tercatat di Log Aktivitas)") ?? "";
    try {
      const { data } = await api.post(`/children/${c.id}/adjust-points`, {
        points: delta, reason: reason.trim(),
      });
      toast.success(
        `${c.name}: ${data.delta > 0 ? "+" : ""}${data.delta} poin — sekarang ${data.after}`
      );
      onRefresh();
    } catch (e) {
      toast.error(formatApiError(e));
    }
  };

  const rebalanceBuckets = async (c) => {
    if (!window.confirm(
      `Perbaiki ChikyBank ${c.name}?\n\nKetiga kantong (Tabungan/Belanja/Sedekah) akan dihitung ulang dari poin saat ini sesuai persentase yang kamu atur.\n\nJumlah poinnya sendiri tidak berubah.`
    )) return;
    try {
      const { data } = await api.post(`/children/${c.id}/rebalance-buckets`);
      toast.success(`ChikyBank ${c.name} diperbaiki — total ${data.points} poin`);
      onRefresh();
    } catch (e) {
      toast.error(formatApiError(e));
    }
  };

  const resetPoints = async (c) => {
    if (!window.confirm(
      `Reset poin ${c.name} ke nol?\n\nIni mengembalikan poin, total poin, streak, misi selesai, dan makanan pet ke 0, serta menghapus riwayat penukaran & konsekuensi anak ini.\n\nTugas, passcode, avatar, dan pet TIDAK dihapus. Cocok untuk membersihkan data testing.`
    )) return;
    try { await api.post(`/children/${c.id}/reset-points`); toast.success(`Poin ${c.name} sudah direset`); onRefresh(); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  const resetPet = async (c) => {
    if (!window.confirm(
      `Reset peliharaan ${c.name}?\n\nIni menghapus peliharaan yang sedang dipelihara (beserta pakan & aksesorinya) dan membuka layar pilih peliharaan baru — tanpa harus menunggu peliharaan lama "pergi" dulu.\n\nPoin, streak, dan level TIDAK terpengaruh.`
    )) return;
    try { await api.post(`/children/${c.id}/reset-pet`); toast.success(`Peliharaan ${c.name} sudah direset`); onRefresh(); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  const resetAllPoints = async () => {
    if (kids.length === 0) return;
    if (!window.confirm(
      `Reset poin SEMUA anak ke nol?\n\nSemua scoreboard (poin, streak, riwayat penukaran & konsekuensi) akan dikosongkan. Tugas & profil tetap aman.\n\nLanjutkan?`
    )) return;
    try {
      const { data } = await api.post(`/children/reset-all-points`);
      toast.success(`Poin ${data.count} anak sudah direset`);
      onRefresh();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <h3 className="font-parent font-bold text-lg text-slate-900 mb-1">Account</h3>
        <div className="text-sm text-slate-500">
          Signed in as <span className="font-semibold text-slate-700">{user?.name}</span> ({user?.role})
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
          <h3 className="font-parent font-bold text-lg text-slate-900">Anak</h3>
          <div className="flex items-center gap-2">
            {kids.length > 0 && (
              <button
                onClick={resetAllPoints}
                className="press-btn inline-flex items-center gap-1.5 border-2 border-amber-300 text-amber-700 hover:bg-amber-50 font-semibold px-3 py-1.5 rounded-lg text-sm"
                title="Reset poin semua anak ke nol"
                data-testid="reset-all-points-btn"
              >
                <RotateCcw className="w-4 h-4" strokeWidth={2.5} /> Reset poin semua
              </button>
            )}
            <button onClick={onAdd} className={btnPrimary} data-testid={TEST_IDS.parent.addChildBtn}>
              <Plus className="w-4 h-4" strokeWidth={2.5} /> Tambah anak
            </button>
          </div>
        </div>
        {kids.length === 0 ? (
          <div className="text-sm text-slate-400 text-center py-6">Belum ada anak.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {kids.map((c) => (
              <div key={c.id} className="py-3 flex items-center gap-3 flex-wrap">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl" style={{ background: c.avatar_color }}>{c.avatar_emoji}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-900 flex items-center gap-2 flex-wrap">
                    {c.name}
                    {c.mbti && (
                      <span
                        className="text-xs font-bold px-2 py-0.5 rounded-full text-white"
                        style={{ background: PERSONALITY_PROFILES[c.mbti]?.color || "#94A3B8" }}
                        title={PERSONALITY_PROFILES[c.mbti]?.nickname || c.mbti}
                      >
                        {c.mbti}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500">
                    {c.age ? `Umur ${c.age} · ` : ""}{c.points} poin · {c.lifetime_points || 0} total
                    {c.mbti && PERSONALITY_PROFILES[c.mbti] && ` · ${PERSONALITY_PROFILES[c.mbti].nickname}`}
                  </div>
                </div>
                <select
                  value={c.mbti || ""}
                  onChange={async (e) => {
                    try {
                      await api.patch(`/children/${c.id}`, { mbti: e.target.value || null });
                      toast.success(`Kepribadian ${c.name} diperbarui`);
                      onRefresh();
                    } catch (err) { toast.error(formatApiError(err)); }
                  }}
                  className="text-xs px-2 py-1.5 rounded-lg border border-slate-200 focus:border-indigo-500 focus:outline-none"
                  title="Ubah tipe kepribadian"
                >
                  <option value="">MBTI —</option>
                  {ALL_MBTI.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <select
                  value={c.quest_theme || ""}
                  onChange={async (e) => {
                    try {
                      await api.patch(`/children/${c.id}`, { quest_theme: e.target.value || null });
                      toast.success(`Tema misi ${c.name} diperbarui`);
                      onRefresh();
                    } catch (err) { toast.error(formatApiError(err)); }
                  }}
                  className="text-xs px-2 py-1.5 rounded-lg border border-slate-200 focus:border-amber-500 focus:outline-none"
                  title="Ubah tema petualangan"
                >
                  <option value="">Tema misi —</option>
                  {QUEST_THEME_LIST.map((t) => (
                    <option key={t.key} value={t.key}>{t.emoji} {t.label}</option>
                  ))}
                </select>
                <button
                  onClick={async () => {
                    try {
                      await api.patch(`/children/${c.id}`, { simple_mode: !c.simple_mode });
                      toast.success(c.simple_mode ? `${c.name}: tampilan lengkap` : `${c.name}: mode sederhana aktif`);
                      onRefresh();
                    } catch (err) { toast.error(formatApiError(err)); }
                  }}
                  aria-pressed={!!c.simple_mode}
                  className={`press-btn text-xs px-2 py-1.5 rounded-lg border font-semibold ${c.simple_mode ? "bg-emerald-50 border-emerald-300 text-emerald-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
                  title="Mode sederhana: satu misi per layar, tombol besar, instruksi dibacakan — untuk anak yang belum lancar membaca"
                >
                  {c.simple_mode ? "🧸 Mode sederhana" : "🧸 Sederhana?"}
                </button>
                <button
                  onClick={() => resetPoints(c)}
                  className="press-btn inline-flex items-center justify-center border-2 border-amber-300 text-amber-700 hover:bg-amber-50 p-2 rounded-lg"
                  title="Reset poin anak ini ke nol"
                  data-testid={`reset-points-btn-${c.id}`}
                >
                  <RotateCcw className="w-4 h-4" strokeWidth={2.5} />
                </button>
                <button
                  onClick={() => adjustPoints(c)}
                  className="press-btn inline-flex items-center justify-center border-2 border-indigo-300 text-indigo-700 hover:bg-indigo-50 p-2 rounded-lg"
                  title="Tambah atau kurangi poin anak ini secara manual"
                >
                  <Plus className="w-4 h-4" strokeWidth={2.5} />
                </button>
                <button
                  onClick={() => rebalanceBuckets(c)}
                  className="press-btn inline-flex items-center justify-center border-2 border-emerald-300 text-emerald-700 hover:bg-emerald-50 p-2 rounded-lg"
                  title="Perbaiki ChikyBank: hitung ulang kantong dari poin saat ini"
                >
                  <Scale className="w-4 h-4" strokeWidth={2.5} />
                </button>
                <button
                  onClick={() => resetPet(c)}
                  className="press-btn inline-flex items-center justify-center border-2 border-sky-300 text-sky-700 hover:bg-sky-50 p-2 rounded-lg"
                  title="Reset peliharaan virtual anak ini"
                  data-testid={`reset-pet-btn-${c.id}`}
                >
                  <PawPrint className="w-4 h-4" strokeWidth={2.5} />
                </button>
                <button onClick={() => delChild(c)} className={btnDanger}>
                  <Trash2 className="w-4 h-4" strokeWidth={2.5} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <ProfileEditor />
      </div>

      {/* Stage 2 & 3: New Features */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <ConfigMenu />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <LabelEditor />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <ViewLinksManager />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <LevelConfigEditor />
      </div>

      <PetResetRequestsReview onChanged={onRefresh} />

      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <PetConfigEditor />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <MemberPasscodeManager />
      </div>

      {/* Stage 4: Achievements & Push Notifications */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <Achievements />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <PushNotificationManager />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <DaySegmentsConfig onChanged={onRefresh} />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <SegmentStartsConfig kids={kids} onChanged={onRefresh} />
      </div>


      <div className="bg-white rounded-2xl border-2 border-violet-100 p-6">
        <ExamPeriodConfig kids={kids} onChanged={onRefresh} />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <LateReasonsConfig kids={kids} onChanged={onRefresh} />
      </div>

      <div className="bg-white rounded-2xl border-2 border-red-100 p-6">
        <PunishmentConfig onChanged={onRefresh} />
      </div>




      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <CompactScheduleCard onChanged={onRefresh} />
      </div>

      <div className="bg-white rounded-2xl border-2 border-red-100 p-6">
        <MaintenanceModeCard />
      </div>
    </div>
  );
}
