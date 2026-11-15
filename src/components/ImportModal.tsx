"use client";

import { useState } from "react";
import { extractNumbers, parseLines, type Parsed } from "@/lib/parse";
import type { Kind } from "@/lib/types";

type Tab = "image" | "paste" | "link";

export default function ImportModal({ kind, onClose, onDone }: { kind: Kind; onClose: () => void; onDone: (msg: string) => void }) {
  const [tab, setTab] = useState<Tab>(kind === "intern" ? "image" : "link");
  const [rows, setRows] = useState<Parsed[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [source, setSource] = useState(kind === "intern" ? "College group" : "Expo");
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [text, setText] = useState("");
  const [url, setUrl] = useState(kind === "expo" ? "https://www.lubindiaexpo.com/floor-plan" : "");

  function setResult(r: Parsed[], n = "") {
    setRows(r);
    setSelected(new Set(r.map((_, i) => i)));
    setNote(r.length ? n : n || "No mobile numbers found.");
  }

  async function onImages(files: FileList | null) {
    if (!files?.length) return;
    setNote("");
    const all = new Set<string>();
    try {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("eng");
      for (let i = 0; i < files.length; i++) {
        setBusy(`Reading image ${i + 1} of ${files.length}... (first time downloads OCR data)`);
        const { data } = await worker.recognize(files[i]);
        extractNumbers(data.text).forEach((n) => all.add(n));
      }
      await worker.terminate();
      setResult([...all].map((phone) => ({ phone, name: "", company: "", email: "", website: "" })), "Check the numbers below - OCR can misread a digit.");
    } catch {
      setNote("Could not read the image. Try a clearer screenshot or use Paste.");
    }
    setBusy("");
  }

  async function fromLink() {
    setBusy("Opening link...");
    setNote("");
    const r = await fetch("/api/import-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
    const j = await r.json();
    setBusy("");
    if (!r.ok) return setNote(j.error);
    setResult(j.rows, j.note);
  }

  async function save() {
    setBusy("Saving...");
    const items = rows.filter((_, i) => selected.has(i)).map((r) => ({ ...r, source }));
    const r = await fetch("/api/contacts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, items, source }) });
    const j = await r.json();
    setBusy("");
    if (!r.ok) return setNote(j.error ?? "Failed");
    onDone(`${j.created} added, ${j.skipped} skipped (duplicates / invalid). Now use "Divide calls to employees".`);
  }

  const tabs: [Tab, string][] = [["image", "Image (OCR)"], ["paste", "Paste text / CSV"], ["link", "From link"]];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-2xl p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Import {kind === "intern" ? "students" : "expo companies"}</h2>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700">x</button>
        </div>
        <div className="mb-3 flex gap-1">
          {tabs.map(([t, l]) => (
            <button key={t} onClick={() => setTab(t)} className={`rounded-lg px-3 py-1.5 text-sm ${tab === t ? "bg-brand text-white" : "bg-soft"}`}>{l}</button>
          ))}
        </div>

        {tab === "image" && (
          <div className="space-y-2">
            <p className="text-sm text-slate-600">Upload screenshots of the WhatsApp group member list. Numbers are read in your browser.</p>
            <input type="file" accept="image/*" multiple onChange={(e) => onImages(e.target.files)} className="block text-sm" />
          </div>
        )}
        {tab === "paste" && (
          <div className="space-y-2">
            <p className="text-sm text-slate-600">One per line: Company, Name, Mobile, Website, Email (any order, only the mobile is required).</p>
            <textarea className="input" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={"ABC Industries, Rajesh Shah, 98242 26405\n+91 94275 70993"} />
            <button className="btn-ghost" onClick={() => setResult(parseLines(text))}>Find numbers</button>
          </div>
        )}
        {tab === "link" && (
          <div className="space-y-2">
            <p className="text-sm text-slate-600">Paste the expo page link; companies and mobile numbers found on it are listed for review.</p>
            <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." />
            <button className="btn-ghost" onClick={fromLink} disabled={!url}>Fetch list</button>
          </div>
        )}

        {busy && <p className="mt-3 text-sm text-brand">{busy}</p>}
        {note && <p className="mt-3 text-sm text-amber-700">{note}</p>}

        {rows.length > 0 && (
          <div className="mt-4 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium">{selected.size} of {rows.length} selected</span>
              <input className="input ml-auto max-w-48" value={source} onChange={(e) => setSource(e.target.value)} placeholder="Source label" />
            </div>
            <div className="max-h-64 overflow-y-auto rounded-lg border border-line">
              {rows.map((r, i) => (
                <label key={i} className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-sm last:border-0">
                  <input type="checkbox" checked={selected.has(i)} onChange={(e) => { const s = new Set(selected); if (e.target.checked) s.add(i); else s.delete(i); setSelected(s); }} />
                  <span className="font-medium">{r.phone}</span>
                  <span className="truncate text-slate-500">{[r.company, r.name, r.website, r.email].filter(Boolean).join(" - ")}</span>
                </label>
              ))}
            </div>
            <button className="btn-primary" disabled={!selected.size || !!busy} onClick={save}>Add {selected.size} to CRM</button>
          </div>
        )}
      </div>
    </div>
  );
}
