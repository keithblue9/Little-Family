import { useEffect, useMemo, useState } from "react";
import { Command } from "cmdk";
import { Search, Plus, ArrowRight, Baby, CalendarDays } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { todayKey, shiftDateKey, humanDateKey } from "@/lib/dates";

/**
 * Ctrl/⌘+K (or the search button) for parents: jump anywhere, or type a whole
 * instruction in plain words —
 *   "tambah sikat gigi untuk adskhan besok 10 poin"
 * — and it becomes a mission without opening a form.
 */
const DAY_WORDS = { "hari ini": 0, besok: 1, lusa: 2 };

export function parseQuickAdd(text, kids) {
  const raw = text.trim();
  const m = raw.match(/^(tambah|buat|add)\s+(.+)$/i);
  if (!m) return null;
  let rest = ` ${m[2]} `;
  let offset = 0;
  for (const [word, off] of Object.entries(DAY_WORDS)) {
    const re = new RegExp(`\\s${word}\\s`, "i");
    if (re.test(rest)) { offset = off; rest = rest.replace(re, " "); }
  }
  let points = 10;
  const pm = rest.match(/\s(\d{1,4})\s*(poin|pts|point)?\s/i);
  if (pm) { points = Number(pm[1]); rest = rest.replace(pm[0], " "); }
  let targets = [];
  const um = rest.match(/\s(untuk|buat|ke)\s+(.+?)\s*$/i);
  if (um) {
    const names = um[2].toLowerCase().split(/\s*(?:,|dan|&)\s*/).filter(Boolean);
    if (names.includes("semua")) targets = kids.map((k) => k.id);
    else targets = kids.filter((k) => names.some((n) => k.name.toLowerCase().startsWith(n))).map((k) => k.id);
    if (targets.length) rest = rest.slice(0, um.index) + " ";
  }
  const title = rest.replace(/\s+/g, " ").trim();
  if (!title) return null;
  return { title, points, date_key: shiftDateKey(todayKey(), offset), target_children: targets };
}

export default function CommandPalette({ open, onOpenChange, kids, nav, onNavigate, onOpenTaskForm, onCreated }) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  useEffect(() => { if (!open) setQuery(""); }, [open]);

  const quick = useMemo(() => parseQuickAdd(query, kids), [query, kids]);
  const kidNames = (ids) => (ids.length === 0 ? "semua anak" : kids.filter((k) => ids.includes(k.id)).map((k) => k.name).join(" & "));

  const createQuick = async () => {
    if (!quick) return;
    setBusy(true);
    try {
      await api.post("/tasks", { ...quick, target_children: quick.target_children.length ? quick.target_children : [] });
      toast.success(`"${quick.title}" ditambahkan untuk ${kidNames(quick.target_children)}`);
      onOpenChange(false);
      onCreated?.();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(false);
    }
  };

  const run = (fn) => () => { onOpenChange(false); fn(); };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-start justify-center p-4 pt-[12vh]"
         onClick={() => onOpenChange(false)}>
      <Command
        label="Perintah cepat"
        className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        shouldFilter={!quick}
      >
        <div className="flex items-center gap-2 px-4 border-b border-slate-100">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <Command.Input
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder='Cari menu, atau ketik "tambah sikat gigi untuk adskhan besok"'
            className="w-full py-4 text-sm outline-none bg-transparent"
          />
        </div>
        <Command.List className="max-h-[50vh] overflow-y-auto p-2">
          <Command.Empty className="py-6 text-center text-sm text-slate-400">Tidak ditemukan.</Command.Empty>
          {quick && (
            <Command.Group heading="Tambah cepat" className="text-xs text-slate-400 px-2 pt-1">
              <Command.Item value={`quick ${query}`} onSelect={createQuick} disabled={busy}
                            className="flex items-center gap-3 px-3 py-3 rounded-xl text-sm text-slate-800 cursor-pointer data-[selected=true]:bg-indigo-50">
                <Plus className="w-4 h-4 text-indigo-500" />
                <span className="flex-1 min-w-0">
                  <b>{quick.title}</b> · {kidNames(quick.target_children)} · {humanDateKey(quick.date_key)} · {quick.points} poin
                </span>
                <span className="text-[10px] text-slate-400">Enter</span>
              </Command.Item>
            </Command.Group>
          )}
          <Command.Group heading="Buka" className="text-xs text-slate-400 px-2 pt-1">
            {nav.map((n) => (
              <Command.Item key={n.key} value={`buka ${n.label}`} onSelect={run(() => onNavigate(n.key))}
                            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-slate-700 cursor-pointer data-[selected=true]:bg-indigo-50">
                <n.icon className="w-4 h-4 text-slate-400" /> {n.label}
                <ArrowRight className="w-3.5 h-3.5 ml-auto text-slate-300" />
              </Command.Item>
            ))}
          </Command.Group>
          <Command.Group heading="Aksi" className="text-xs text-slate-400 px-2 pt-1">
            <Command.Item value="tugas baru form" onSelect={run(onOpenTaskForm)}
                          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-slate-700 cursor-pointer data-[selected=true]:bg-indigo-50">
              <Plus className="w-4 h-4 text-slate-400" /> Tugas baru (formulir lengkap)
            </Command.Item>
            <Command.Item value="jadwal besok" onSelect={run(() => {
              try { sessionStorage.setItem("tasksDateFilter", shiftDateKey(todayKey(), 1)); } catch { /* ignore */ }
              onNavigate("tasks");
            })}
                          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-slate-700 cursor-pointer data-[selected=true]:bg-indigo-50">
              <CalendarDays className="w-4 h-4 text-slate-400" /> Lihat jadwal besok
            </Command.Item>
            {kids.map((k) => (
              <Command.Item key={k.id} value={`mode anak ${k.name}`} onSelect={run(() => window.location.assign(`/kid/${k.id}`))}
                            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-slate-700 cursor-pointer data-[selected=true]:bg-indigo-50">
                <Baby className="w-4 h-4 text-slate-400" /> Lihat layar {k.name}
              </Command.Item>
            ))}
          </Command.Group>
        </Command.List>
      </Command>
    </div>
  );
}
