"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Nav({ name, role }: { name: string; role: "admin" | "employee" }) {
  const path = usePathname();
  const items = [
    { href: "/", label: "Dashboard" },
    { href: "/leads", label: "Leads" },
    { href: "/internships", label: "Internship" },
    { href: "/expo", label: "Expo" },
    ...(role === "admin" ? [{ href: "/employees", label: "Employees" }] : []),
  ];
  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }
  return (
    <header className="border-b border-line bg-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <span className="font-semibold">Infinite CRM</span>
        <nav className="flex flex-1 flex-wrap gap-1">
          {items.map((i) => {
            const active = i.href === "/" ? path === "/" : path.startsWith(i.href);
            return (
              <Link
                key={i.href}
                href={i.href}
                className={`rounded-lg px-3 py-1.5 text-sm ${active ? "bg-brand text-white" : "text-slate-600 hover:bg-soft"}`}
              >
                {i.label}
              </Link>
            );
          })}
        </nav>
        <span className="text-sm text-slate-500">
          {name} ({role})
        </span>
        <button onClick={logout} className="btn-ghost">
          Logout
        </button>
      </div>
    </header>
  );
}
