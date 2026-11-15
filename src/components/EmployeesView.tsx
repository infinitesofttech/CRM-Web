"use client";

import { useCallback, useState } from "react";
import type { PublicEmployee } from "@/lib/types";

export default function EmployeesView({ initial }: { initial: PublicEmployee[] }) {
  const [list, setList] = useState<PublicEmployee[]>(initial);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const r = await fetch("/api/employees");
    if (r.ok) setList((await r.json()).employees);
  }, []);

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const r = await fetch("/api/employees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(f)),
    });
    const j = await r.json();
    if (!r.ok) return setError(j.error);
    setError("");
    form.reset();
    load();
  }

  async function del(e: PublicEmployee) {
    if (!confirm(`Remove ${e.name}? Their contacts become unassigned.`)) return;
    await fetch(`/api/employees/${e.id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="card">
        <h1 className="border-b border-line p-4 font-semibold">Employees ({list.length})</h1>
        <ul>
          {list.map((e) => (
            <li key={e.id} className="flex items-center justify-between border-b border-line p-3 last:border-0">
              <div>
                <p className="font-medium">{e.name}</p>
                <p className="text-sm text-slate-500">login: {e.username}</p>
              </div>
              <button className="btn-danger" onClick={() => del(e)}>
                Remove
              </button>
            </li>
          ))}
          {!list.length && <li className="p-4 text-sm text-slate-500">No employees yet.</li>}
        </ul>
      </div>
      <form onSubmit={add} className="card space-y-3 p-4">
        <h2 className="font-semibold">Add employee</h2>
        <input name="name" className="input" placeholder="Full name" required />
        <input name="username" className="input" placeholder="Username (login)" required />
        <input name="password" type="password" className="input" placeholder="Password (min 6)" required minLength={6} />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="btn-primary">Add employee</button>
        <p className="text-xs text-slate-500">Employees only see the contacts assigned to them and can log calls + update status.</p>
      </form>
    </div>
  );
}
