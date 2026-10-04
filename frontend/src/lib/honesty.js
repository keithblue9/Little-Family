import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";

const LADDER = {
  1: "Koreksi pertama: poin misi ditarik + minus sebesar poinnya. Kalau anak membetulkannya, minusnya dikembalikan.",
  2: "Koreksi ke-2 (14 hari terakhir): + 1 Kartu Hukuman dan masa pengawasan beberapa hari.",
  3: "Koreksi ke-3 (14 hari terakhir): kartu langsung penuh → hukuman keluarga berlaku.",
};

/**
 * "Tidak dikerjakan": a parent corrects one mission. Asks first, saying what
 * this correction will cost, and lets the parent add a note for the child.
 * Resolves to the correction (or null when cancelled).
 */
export async function correctTask(task, strikes = 0) {
  const level = Math.min(3, (strikes || 0) + 1);
  const note = window.prompt(
    `Tandai "${task.title}" sebagai tidak dikerjakan?\n\n${LADDER[level]}\n\nPesan untuk anak (opsional):`, "");
  if (note === null) return null;
  try {
    const { data } = await api.post(`/tasks/${task.id}/correct`, { note });
    toast.success(`Dikoreksi (tingkat ${data.level}) — anak diminta membetulkan & menulis refleksi`, {
      duration: 6000,
      action: { label: "Batalkan", onClick: () => undoCorrection(data.id) },
    });
    window.dispatchEvent(new Event("app:parent-refresh"));
    return data;
  } catch (e) {
    toast.error(formatApiError(e));
    return null;
  }
}

export async function undoCorrection(id) {
  try {
    await api.post(`/corrections/${id}/undo`);
    toast.success("Koreksi dibatalkan — poin & kartu dikembalikan");
    window.dispatchEvent(new Event("app:parent-refresh"));
  } catch (e) {
    toast.error(formatApiError(e));
  }
}

export const trustTone = (t) =>
  t >= 90 ? { label: "Sangat dipercaya", cls: "text-emerald-700 bg-emerald-50" }
    : t >= 70 ? { label: "Dipercaya", cls: "text-sky-700 bg-sky-50" }
      : t >= 50 ? { label: "Sedang dibangun", cls: "text-amber-700 bg-amber-50" }
        : { label: "Perlu didampingi", cls: "text-rose-700 bg-rose-50" };
