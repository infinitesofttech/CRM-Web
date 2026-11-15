export type Kind = "lead" | "intern" | "expo";

export const KINDS: Record<Kind, { slug: string; title: string; singular: string; statuses: string[] }> = {
  lead: {
    slug: "leads",
    title: "Leads (Clients)",
    singular: "Lead",
    statuses: ["New", "Contacted", "Interested", "Follow-up", "Proposal Sent", "Won", "Lost"],
  },
  intern: {
    slug: "internships",
    title: "Internship (Students)",
    singular: "Student",
    statuses: ["New", "Called", "Interested", "Follow-up", "Joined", "Not Interested"],
  },
  expo: {
    slug: "expo",
    title: "Expo Clients",
    singular: "Expo Client",
    statuses: ["New", "Called", "Interested", "Follow-up", "Meeting Booked", "Won", "Not Interested"],
  },
};

export const SLUG_TO_KIND: Record<string, Kind> = { leads: "lead", internships: "intern", expo: "expo" };

export const CALL_OUTCOMES = ["Connected", "No Answer", "Busy", "Switched Off", "Wrong Number", "Call Back Later"];

export type Call = { at: string; by: string; outcome: string; note: string };

export type Contact = {
  id: string;
  kind: Kind;
  name: string;
  company: string;
  phone: string;
  email: string;
  source: string;
  status: string;
  assignedTo: string | null;
  notes: string;
  followUp: string;
  calls: Call[];
  createdAt: string;
  updatedAt: string;
};

export type Employee = { id: string; name: string; username: string; passwordHash: string; createdAt: string };
export type PublicEmployee = Omit<Employee, "passwordHash">;

export type Session = { role: "admin" | "employee"; name: string; employeeId: string | null };
