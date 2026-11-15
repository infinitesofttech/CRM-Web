import Link from "next/link";
import { getSession } from "@/lib/auth";
import { listContacts } from "@/lib/contacts";
import { getAll } from "@/lib/store";
import { storageMode } from "@/lib/store";
import { KINDS, type Employee, type Kind } from "@/lib/types";

export default async function Dashboard() {
  const session = (await getSession())!;
  const [contacts, employees] = await Promise.all([listContacts(session), getAll<Employee>("employees")]);
  const today = new Date().toISOString().slice(0, 10);
  const callsToday = contacts.flatMap((c) => c.calls).filter((x) => x.at.slice(0, 10) === today).length;
  const dueFollowUps = contacts.filter((c) => c.followUp && c.followUp <= today && !["Won", "Joined", "Lost", "Not Interested"].includes(c.status));

  return (
    <div className="space-y-6">
      {storageMode === "memory" && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Database is not connected - data will be lost on restart. Add the Upstash Redis integration in Vercel (KV_REST_API_URL / KV_REST_API_TOKEN).
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total contacts" value={contacts.length} />
        <Stat label="Calls today" value={callsToday} />
        <Stat label="Follow-ups due" value={dueFollowUps.length} />
        <Stat label="Not yet called" value={contacts.filter((c) => c.calls.length === 0).length} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {(Object.keys(KINDS) as Kind[]).map((k) => {
          const list = contacts.filter((c) => c.kind === k);
          return (
            <Link key={k} href={`/${KINDS[k].slug}`} className="card block p-4 hover:border-brand">
              <div className="flex items-baseline justify-between">
                <h2 className="font-semibold">{KINDS[k].title}</h2>
                <span className="text-2xl font-semibold">{list.length}</span>
              </div>
              <ul className="mt-3 space-y-1 text-sm text-slate-600">
                {KINDS[k].statuses.map((s) => (
                  <li key={s} className="flex justify-between">
                    <span>{s}</span>
                    <span className="font-medium text-ink">{list.filter((c) => c.status === s).length}</span>
                  </li>
                ))}
              </ul>
            </Link>
          );
        })}
      </div>

      {session.role === "admin" && (
        <div className="card overflow-x-auto">
          <h2 className="border-b border-line p-4 font-semibold">Employee workload</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500">
              <tr>
                <th className="p-3">Employee</th>
                <th className="p-3">Assigned</th>
                <th className="p-3">Called</th>
                <th className="p-3">Pending</th>
                <th className="p-3">Calls today</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => {
                const mine = contacts.filter((c) => c.assignedTo === e.id);
                const today_ = mine.flatMap((c) => c.calls).filter((x) => x.by === e.name && x.at.slice(0, 10) === today).length;
                return (
                  <tr key={e.id} className="border-t border-line">
                    <td className="p-3 font-medium">{e.name}</td>
                    <td className="p-3">{mine.length}</td>
                    <td className="p-3">{mine.filter((c) => c.calls.length).length}</td>
                    <td className="p-3">{mine.filter((c) => !c.calls.length).length}</td>
                    <td className="p-3">{today_}</td>
                  </tr>
                );
              })}
              {!employees.length && (
                <tr>
                  <td className="p-3 text-slate-500" colSpan={5}>
                    No employees yet - add them in the Employees tab.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="card p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-semibold">{value}</p>
    </div>
  );
}
