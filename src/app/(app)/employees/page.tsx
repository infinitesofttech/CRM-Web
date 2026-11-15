import { redirect } from "next/navigation";
import EmployeesView from "@/components/EmployeesView";
import { getSession } from "@/lib/auth";
import { getAll } from "@/lib/store";
import type { Employee } from "@/lib/types";

export default async function EmployeesPage() {
  const s = await getSession();
  if (s?.role !== "admin") redirect("/");
  const list = (await getAll<Employee>("employees"))
    .map(({ passwordHash: _h, ...e }) => e)
    .sort((a, b) => a.name.localeCompare(b.name));
  return <EmployeesView initial={list} />;
}
