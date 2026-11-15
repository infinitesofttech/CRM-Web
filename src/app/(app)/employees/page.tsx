import { redirect } from "next/navigation";
import EmployeesView from "@/components/EmployeesView";
import { getSession } from "@/lib/auth";

export default async function EmployeesPage() {
  const s = await getSession();
  if (s?.role !== "admin") redirect("/");
  return <EmployeesView />;
}
