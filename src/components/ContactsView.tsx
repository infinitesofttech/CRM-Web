"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ImportModal from "./ImportModal";
import { CALL_OUTCOMES, KINDS, type Contact, type Kind, type PublicEmployee } from "@/lib/types";

const fmt = (iso: string) => new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
const waLink = (p: string) => `https://wa.me/${p.replace(/\D/g, "")}`;

const badge: Record<string, string> = {
  New: "bg-slate-100 text-slate-700",
  Won: "bg-green-100 text-green-700",
  Joined: "bg-green-100 text-green-700",
  Lost: "bg-red-100 text-red-700",
  "Not Interested": "bg-red-100 text-red-700",
  Interested: "bg-blue-100 text-blue-700",
  "Follow-up": "bg-amber-100 text-amber-800",
};

export default function ContactsView({
  kind, role, initialContacts, initialEmployees,
}: {
  kind: Kind; role: "admin" | "employee"; initialContacts: Contact[]; initialEmployees: PublicEmployee[];
}) {
  const cfg = KINDS[kind];
  const [contacts, setContacts] = useState<Contact[]>(initialContacts);
  const [employees, setEmployees] = useState<PublicEmployee[]>(initialEmployees);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [who, setWho] = useState("");
  const [calling, setCalling] = useState<Contact | null>(null);
  const [editing, setEditing] = useState<Contact | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const c = await fetch(`/api/contacts?kind=${kind}`);
    if (c.ok) setContacts((await c.json()).contacts);
  }, [kind]);

  /** Replace one contact in local state (no full reload needed after a call / edit). */
  const patch = (c: Contact) => setContacts((list) => list.map((x) => (x.id === c.id ? c : x)));

  const empName = (id: string | null) => employees.find((e) => e.id === id)?.name ?? "";

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return contacts.filter(
      (c) =>
        (!status || c.status === status) &&
        (!who || (who === "none" ? !c.assignedTo : c.assignedTo === who)) &&
        (!s || [c.name, c.company, c.phone, c.email, c.website ?? "", c.notes].some((v) => v.toLowerCase().includes(s))),
    );
  }, [contacts, q, status, who]);

  async function del(c: Contact) {
    if (!confirm("Delete this contact?")) return;
    setContacts((list) => list.filter((x) => x.id !== c.id));
    const r = await fetch(`/api/contacts/${c.id}`, { method: "DELETE" });
    if (!r.ok) load();
  }

  const notCalled = contacts.filter((c) => !c.calls.length).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold">
          {cfg.title} <span className="text-base font-normal text-slate-500">({contacts.length})</span>
        </h1>
        <button className="btn-ghost" onClick={() => setEditing("new")}>
          + Add {cfg.singular}
        </button>
        {role === "admin" && kind !== "lead" && (
          <button className="btn-primary" onClick={() => setImporting(true)}>
            Import {kind === "intern" ? "from image / paste" : "expo list"}
          </button>
        )}
        {role === "admin" && (
          <button className="btn-ghost" onClick={() => setAssigning(true)}>
            Divide calls to employees
          </button>
        )}
      </div>

      {msg && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{msg}</p>}

      <div className="flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder="Search name, company, number..." value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input max-w-44" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {cfg.statuses.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        {role === "admin" && (
          <select className="input max-w-48" value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">All employees</option>
            <option value="none">Unassigned</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        )}
        <span className="self-center text-sm text-slate-500">
          {rows.length} shown - {notCalled} not called yet
        </span>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-soft text-left text-slate-500">
            <tr>
              <th className="p-3">Contact</th>
              <th className="p-3">Phone</th>
              <th className="p-3">Status</th>
              {role === "admin" && <th className="p-3">Assigned</th>}
              <th className="p-3">Last call</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const last = c.calls[c.calls.length - 1];
              return (
                <tr key={c.id} className="border-t border-line align-top">
                  <td className="p-3">
                    <p className="font-medium">{c.name || c.company || "(no name)"}</p>
                    {c.name && c.company && <p className="text-slate-500">{c.company}</p>}
                    {c.website && (
                      <a className="text-xs text-brand" href={/^https?:/i.test(c.website) ? c.website : `https://${c.website}`} target="_blank" rel="noreferrer">
                        {c.website.replace(/^https?:\/\//i, "")}
                      </a>
                    )}
                    <p className="text-xs text-slate-400">{c.source}</p>
                  </td>
                  <td className="whitespace-nowrap p-3">
                    {c.phone ? (
                      <>
                        <a className="font-medium text-brand" href={`tel:${c.phone.replace(/\s/g, "")}`}>
                          {c.phone}
                        </a>
                        <a className="ml-2 text-xs text-green-600" href={waLink(c.phone)} target="_blank" rel="noreferrer">
                          WhatsApp
                        </a>
                      </>
                    ) : (
                      <span className="text-slate-400">-</span>
                    )}
                  </td>
                  <td className="p-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${badge[c.status] ?? "bg-violet-100 text-violet-700"}`}>{c.status}</span>
                    {c.followUp && <p className="mt-1 text-xs text-amber-700">Follow-up: {c.followUp}</p>}
                  </td>
                  {role === "admin" && <td className="p-3">{empName(c.assignedTo) || <span className="text-slate-400">Unassigned</span>}</td>}
                  <td className="p-3 text-xs text-slate-500">
                    {last ? (
                      <>
                        {last.outcome}
                        <br />
                        {fmt(last.at)} ({c.calls.length})
                      </>
                    ) : (
                      "Never called"
                    )}
                  </td>
                  <td className="whitespace-nowrap p-3 text-right">
                    <button className="btn-primary" onClick={() => setCalling(c)}>
                      Log call
                    </button>{" "}
                    <button className="btn-ghost" onClick={() => setEditing(c)}>
                      Edit
                    </button>
                    {role === "admin" && (
                      <>
                        {" "}
                        <button className="btn-danger" onClick={() => del(c)}>
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-slate-500">
                  No contacts yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {calling && <CallModal contact={calling} onClose={() => setCalling(null)} onSaved={(c) => { setCalling(null); if (c) patch(c); else load(); }} />}
      {editing && (
        <EditModal
          kind={kind}
          role={role}
          contact={editing === "new" ? null : editing}
          employees={employees}
          onClose={() => setEditing(null)}
          onSaved={(c) => { setEditing(null); if (c) patch(c); else load(); }}
        />
      )}
      {importing && (
        <ImportModal
          kind={kind}
          onClose={() => setImporting(false)}
          onDone={(m) => { setImporting(false); setMsg(m); load(); }}
        />
      )}
      {assigning && (
        <AssignModal
          kind={kind}
          employees={employees}
          unassigned={contacts.filter((c) => !c.assignedTo).length}
          total={contacts.length}
          onClose={() => setAssigning(false)}
          onDone={(m) => { setAssigning(false); setMsg(m); load(); }}
        />
      )}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-lg p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700" aria-label="Close">
            x
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function CallModal({ contact, onClose, onSaved }: { contact: Contact; onClose: () => void; onSaved: (c?: Contact) => void }) {
  const cfg = KINDS[contact.kind];
  const [outcome, setOutcome] = useState("Connected");
  const [status, setStatus] = useState(contact.status);
  const [note, setNote] = useState("");
  const [followUp, setFollowUp] = useState(contact.followUp);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const r = await fetch(`/api/contacts/${contact.id}/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outcome, status, note, followUp }),
    });
    if (!r.ok) {
      setBusy(false);
      return alert("Could not save the call. Please try again.");
    }
    onSaved((await r.json()).contact);
  }

  return (
    <Modal title={`Call: ${contact.name || contact.company || contact.phone}`} onClose={onClose}>
      <div className="space-y-3">
        {contact.phone && (
          <a href={`tel:${contact.phone.replace(/\s/g, "")}`} className="btn-primary">
            Call {contact.phone}
          </a>
        )}
        <div className="grid grid-cols-2 gap-2">
          <label className="text-sm">
            Call result
            <select className="input mt-1" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
              {CALL_OUTCOMES.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Status
            <select className="input mt-1" value={status} onChange={(e) => setStatus(e.target.value)}>
              {cfg.statuses.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="block text-sm">
          Follow-up date
          <input type="date" className="input mt-1" value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
        </label>
        <textarea className="input" rows={3} placeholder="What did they say?" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn-primary" disabled={busy} onClick={save}>
          Save call
        </button>
        {contact.calls.length > 0 && (
          <div className="max-h-48 overflow-y-auto border-t border-line pt-3 text-sm">
            <p className="mb-1 font-medium">History</p>
            {[...contact.calls].reverse().map((c, i) => (
              <p key={i} className="border-b border-line py-1 text-slate-600">
                <span className="text-xs text-slate-400">{fmt(c.at)} - {c.by}</span>
                <br />
                {c.outcome}
                {c.note && `: ${c.note}`}
              </p>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

function EditModal({
  kind, role, contact, employees, onClose, onSaved,
}: {
  kind: Kind; role: "admin" | "employee"; contact: Contact | null; employees: PublicEmployee[]; onClose: () => void; onSaved: (c?: Contact) => void;
}) {
  const [error, setError] = useState("");
  const cfg = KINDS[kind];

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const res = contact
      ? await fetch(`/api/contacts/${contact.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) })
      : await fetch("/api/contacts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, items: [f], source: "Manual" }) });
    const j = await res.json();
    if (!res.ok) return setError(j.error ?? "Failed");
    if (!contact && !j.created) return setError("Not added - invalid or duplicate number");
    onSaved(contact ? j.contact : undefined);
  }

  return (
    <Modal title={contact ? `Edit ${cfg.singular}` : `Add ${cfg.singular}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-2">
        <input name="name" className="input" placeholder="Name" defaultValue={contact?.name} />
        <input name="company" className="input" placeholder={kind === "intern" ? "College" : "Company"} defaultValue={contact?.company} />
        <input name="phone" className="input" placeholder="Mobile number" defaultValue={contact?.phone} />
        <input name="website" className="input" placeholder="Website" defaultValue={contact?.website} />
        <input name="email" type="email" className="input" placeholder="Email" defaultValue={contact?.email} />
        {contact && (
          <select name="status" className="input" defaultValue={contact.status}>
            {cfg.statuses.map((s) => <option key={s}>{s}</option>)}
          </select>
        )}
        {contact && role === "admin" && (
          <select name="assignedTo" className="input" defaultValue={contact.assignedTo ?? ""}>
            <option value="">Unassigned</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        )}
        <textarea name="notes" className="input" rows={3} placeholder="Notes" defaultValue={contact?.notes} />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="btn-primary">Save</button>
      </form>
    </Modal>
  );
}

function AssignModal({
  kind, employees, unassigned, total, onClose, onDone,
}: {
  kind: Kind; employees: PublicEmployee[]; unassigned: number; total: number; onClose: () => void; onDone: (m: string) => void;
}) {
  const [ids, setIds] = useState<string[]>(employees.map((e) => e.id));
  const [reassign, setReassign] = useState(false);
  const [busy, setBusy] = useState(false);
  const count = reassign ? total : unassigned;

  async function go() {
    setBusy(true);
    const r = await fetch("/api/assign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, employeeIds: ids, reassign }) });
    const j = await r.json();
    onDone(r.ok ? `${j.assigned} contacts divided between ${ids.length} employee(s).` : j.error);
  }

  return (
    <Modal title="Divide calls between employees" onClose={onClose}>
      {!employees.length ? (
        <p className="text-sm text-slate-600">First add employees in the Employees tab.</p>
      ) : (
        <div className="space-y-3 text-sm">
          {employees.map((e) => (
            <label key={e.id} className="flex items-center gap-2">
              <input type="checkbox" checked={ids.includes(e.id)} onChange={(ev) => setIds(ev.target.checked ? [...ids, e.id] : ids.filter((x) => x !== e.id))} />
              {e.name}
            </label>
          ))}
          <label className="flex items-center gap-2 text-slate-600">
            <input type="checkbox" checked={reassign} onChange={(e) => setReassign(e.target.checked)} />
            Also re-divide contacts that are already assigned
          </label>
          <p className="text-slate-500">
            {count} contacts will be split equally between {ids.length} employee(s).
          </p>
          <button className="btn-primary" disabled={busy || !ids.length || !count} onClick={go}>
            Divide now
          </button>
        </div>
      )}
    </Modal>
  );
}
