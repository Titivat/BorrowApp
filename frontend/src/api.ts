export type User = { email: string; role: "Admin" | "Staff" };
export type Item = {
  id: string;
  name: string;
  assetTag: string;
  category: string;
  location: string;
  notes: string;
  status: string;
  hasPhoto: boolean;
};
export type Loan = {
  id: string;
  itemId: string;
  itemName: string;
  assetTag: string;
  borrowerName: string;
  borrowerEmail: string;
  department: string;
  purpose: string;
  status: string;
  dueAt: string;
  requestedAt: string;
  returnedAt?: string;
  returnNotes: string;
};
export type Audit = {
  id: number;
  at: string;
  actor: string;
  action: string;
  detail: string;
};
export type Reminder = {
  id: string;
  day: string;
  recipient: string;
  message: string;
  sentAt?: string;
};
let csrf = "";
export async function session() {
  const response = await fetch("/api/session");
  if (!response.ok)
    throw new Error("Cannot reach the server. Please try again.");
  const data = await response.json();
  csrf = data.csrfToken;
  return data.user as User | null;
}
export async function api<T = void>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const form = body instanceof FormData;
  const response = await fetch("/api" + path, {
    method,
    headers: {
      ...(body && !form ? { "Content-Type": "application/json" } : {}),
      ...(method !== "GET" ? { "X-CSRF-TOKEN": csrf } : {}),
    },
    body: body ? (form ? body : JSON.stringify(body)) : undefined,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(
      data.error ||
        (response.status === 401
          ? "Your session expired. Please sign in again."
          : response.status === 403
            ? "You do not have permission for this action."
            : "The request failed. Please try again."),
    );
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
export const prettyDate = (date: string) =>
  new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(date));
export const overdue = (loan: Loan) =>
  loan.status === "Borrowed" && new Date(loan.dueAt) < new Date();
