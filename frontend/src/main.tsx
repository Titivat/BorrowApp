import React, { useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import {
  Archive,
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  Camera,
  Check,
  ChevronRight,
  ClipboardList,
  Clock3,
  LayoutDashboard,
  LogOut,
  Package,
  Plus,
  Search,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import {
  api,
  session,
  prettyDate,
  overdue,
  type Item,
  type Loan,
  type User,
  type Audit,
  type Reminder,
} from "./api";
import "./styles.css";

type View =
  | "Overview"
  | "Inventory"
  | "Loans"
  | "Approvals"
  | "Reminders"
  | "Activity"
  | "Team";
type Modal = "item" | "loan" | "user" | "return" | null;
const nav = [
  { name: "Overview", icon: LayoutDashboard },
  { name: "Inventory", icon: Package },
  { name: "Loans", icon: ArrowUpRight },
  { name: "Approvals", icon: ClipboardList },
  { name: "Reminders", icon: Bell },
  { name: "Activity", icon: Clock3 },
  { name: "Team", icon: Users },
] as const;
const field = (form: FormData, name: string) => String(form.get(name) || "");
function App() {
  const [user, setUser] = useState<User | null>(null),
    [ready, setReady] = useState(false);
  const [view, setView] = useState<View>("Overview"),
    [items, setItems] = useState<Item[]>([]),
    [loans, setLoans] = useState<Loan[]>([]),
    [audit, setAudit] = useState<Audit[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]),
    [emailConfigured, setEmailConfigured] = useState(false),
    [team, setTeam] = useState<
      { id: string; email: string; roles: string[] }[]
    >([]);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("All");
  const [modal, setModal] = useState<Modal>(null),
    [selected, setSelected] = useState(""),
    [returnLoan, setReturnLoan] = useState<Loan | null>(null),
    [photoVersion, setPhotoVersion] = useState(0);
  async function refresh(current = user) {
    if (!current) return;
    const [i, l, a, r] = await Promise.all([
      api<Item[]>("/items"),
      api<Loan[]>("/loans"),
      api<Audit[]>("/audit"),
      api<{ entries: Reminder[]; emailConfigured: boolean }>("/reminders"),
    ]);
    setItems(i);
    setLoans(l);
    setAudit(a);
    setReminders(r.entries);
    setEmailConfigured(r.emailConfigured);
    if (current.role === "Admin") setTeam(await api("/users"));
  }
  useEffect(() => {
    session()
      .then(async (u) => {
        setUser(u);
        await refresh(u);
      })
      .catch((e) => setError(e.message))
      .finally(() => setReady(true));
  }, []);
  async function run(fn: () => Promise<void>, message = "") {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      if (message) setNotice(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function navigate(next: View) {
    setView(next);
    setSearch("");
    setFilter("All");
  }
  function open(next: Modal, id = "") {
    setSelected(id);
    setModal(next);
    setError("");
    setNotice("");
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      if (modal === "item") {
        const created = await api<{ id: string }>("/items", "POST", {
          name: field(form, "name"),
          assetTag: field(form, "assetTag"),
          category: field(form, "category"),
          location: field(form, "location"),
          notes: field(form, "notes"),
        });
        const photo = form.get("photo") as File;
        // The inventory record is saved even if the photo upload fails; it can be retried on its card.
        setModal(null);
        await refresh();
        if (photo?.size) {
          const upload = new FormData();
          upload.set("photo", photo);
          await api(`/items/${created.id}/photo`, "POST", upload);
        }
      }
      if (modal === "loan")
        await api("/loans", "POST", {
          itemId: field(form, "itemId"),
          borrowerName: field(form, "borrowerName"),
          borrowerEmail: field(form, "borrowerEmail"),
          department: field(form, "department"),
          purpose: field(form, "purpose"),
          dueAt: new Date(field(form, "dueAt") + "T17:00:00").toISOString(),
        });
      if (modal === "user")
        await api("/users", "POST", {
          email: field(form, "email"),
          password: field(form, "password"),
          role: field(form, "role"),
        });
      if (modal === "return" && returnLoan)
        await api(`/loans/${returnLoan.id}/return`, "POST", {
          notes: field(form, "notes"),
        });
      setModal(null);
      await refresh();
    }, "Saved successfully.");
  }
  async function action(loan: Loan, action: string) {
    await run(
      async () => {
        await api(`/loans/${loan.id}/${action}`, "POST", { notes: "" });
        await refresh();
      },
      action === "approve"
        ? "Approved. The item is now checked out."
        : "Request rejected. The item is available again.",
    );
  }
  const active = loans.filter((l) => l.status === "Borrowed"),
    pending = loans.filter((l) => l.status === "Pending"),
    late = loans.filter(overdue);
  const available = items.filter((i) => i.status === "Available");
  const visibleItems = items.filter(
    (i) =>
      `${i.name} ${i.assetTag} ${i.category} ${i.location}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (filter === "All" || i.status === filter),
  );
  const visibleLoans = (view === "Approvals" ? pending : loans).filter(
    (l) =>
      `${l.borrowerName} ${l.borrowerEmail} ${l.itemName} ${l.assetTag}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (filter === "All" ||
        (filter === "Overdue" ? overdue(l) : l.status === filter)),
  );
  const banner = (
    <>
      {error && (
        <div role="alert" className="banner error">
          {error}
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {notice && (
        <div role="status" className="banner success">
          {notice}
          <button aria-label="Dismiss notice" onClick={() => setNotice("")}>
            <X size={16} />
          </button>
        </div>
      )}
    </>
  );
  if (!ready)
    return (
      <div className="loading">
        <Package size={36} />
        <p>Opening your workspace…</p>
      </div>
    );
  if (!user)
    return (
      <div className="login">
        <div className="login-story">
          <div className="brand">
            <span>
              <Package />
            </span>
            borrow<span className="brand-light">app</span>
          </div>
          <div>
            <span className="eyebrow">YOUR TEAM’S EVERYDAY ESSENTIALS</span>
            <h1>
              Good equipment.
              <br />
              In good hands.
            </h1>
            <p>
              A little less chasing. A lot more clarity.
              <br />
              Keep track of what’s out, who has it, and when it’s coming back.
            </p>
            <div className="login-graphic">
              <Package size={80} strokeWidth={1} />
              <ArrowUpRight size={32} />
              <Users size={64} strokeWidth={1} />
            </div>
          </div>
          <small>Equipment, accounted for.</small>
        </div>
        <main className="login-form">
          <span className="eyebrow">IT / HR WORKSPACE</span>
          <h2>Welcome back.</h2>
          <p>Sign in to manage your team’s equipment.</p>
          {banner}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void run(async () => {
                await api("/login", "POST", {
                  email: field(f, "email"),
                  password: field(f, "password"),
                });
                const u = await session();
                setUser(u);
                await refresh(u);
              });
            }}
          >
            <label>
              Company email
              <input
                name="email"
                type="email"
                autoComplete="username"
                required
                placeholder="you@company.com"
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                placeholder="Enter your password"
              />
            </label>
            <button className="primary" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
              <ArrowUpRight size={18} />
            </button>
          </form>
          <div className="login-note">
            <ShieldCheck size={18} />
            <span>
              For IT, HR and administrators.
              <br />
              Need access? Contact your workspace admin.
            </span>
          </div>
        </main>
      </div>
    );
  function loanTable(rows: Loan[]) {
    return rows.length ? (
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ITEM / ASSET</th>
              <th>BORROWER</th>
              <th>DUE DATE</th>
              <th>STATUS</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id}>
                <td>
                  <div className="table-item">
                    <span className="mini-icon">
                      <Package size={20} />
                    </span>
                    <div>
                      <strong>{l.itemName}</strong>
                      <small>{l.assetTag}</small>
                    </div>
                  </div>
                </td>
                <td>
                  <strong>{l.borrowerName}</strong>
                  <small>{l.department || l.borrowerEmail}</small>
                </td>
                <td className={overdue(l) ? "late" : ""}>
                  {prettyDate(l.dueAt)}
                </td>
                <td>
                  <Badge status={overdue(l) ? "Overdue" : l.status} />
                </td>
                <td>
                  <div className="row-actions">
                    {l.status === "Pending" && (
                      <>
                        <button
                          disabled={busy}
                          className="small-button"
                          onClick={() => void action(l, "approve")}
                        >
                          <Check size={14} />
                          Approve
                        </button>
                        <button
                          disabled={busy}
                          className="text-button"
                          onClick={() => void action(l, "reject")}
                        >
                          Reject
                        </button>
                      </>
                    )}
                    {l.status === "Borrowed" && (
                      <button
                        className="small-button"
                        onClick={() => {
                          setReturnLoan(l);
                          open("return");
                        }}
                      >
                        <ArrowDownLeft size={14} />
                        Return
                      </button>
                    )}
                    {l.status === "Returned" && (
                      <small title={l.returnNotes}>
                        {l.returnedAt && prettyDate(l.returnedAt)}
                      </small>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <Empty
        title="Nothing here yet"
        text="New borrowing activity will appear here."
      />
    );
  }
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span>
            <Package />
          </span>
          borrow<span className="brand-light">app</span>
        </div>
        <div className="workspace">
          <span className="workspace-icon">W</span>
          <div>
            <strong>Team workspace</strong>
            <small>IT & Human Resources</small>
          </div>
          <ChevronRight size={14} />
        </div>
        <span className="nav-label">WORKSPACE</span>
        <nav>
          {nav
            .filter((n) => n.name !== "Team" || user.role === "Admin")
            .map((n) => (
              <button
                className={view === n.name ? "active" : ""}
                key={n.name}
                onClick={() => navigate(n.name)}
              >
                <n.icon size={19} />
                {n.name}
                {n.name === "Approvals" && pending.length > 0 && (
                  <span className="nav-count">{pending.length}</span>
                )}
              </button>
            ))}
        </nav>
        <div className="sidebar-note">
          <ShieldCheck size={22} />
          <strong>A clear trail, every time.</strong>
          <p>Every checkout and return is recorded for your team.</p>
        </div>
        <button
          className="profile"
          onClick={() =>
            void run(async () => {
              await api("/logout", "POST");
              setUser(null);
              await session();
            })
          }
        >
          <span className="avatar">{user.email[0].toUpperCase()}</span>
          <span>
            <strong>{user.email.split("@")[0]}</strong>
            <small>
              {user.role === "Admin" ? "Administrator" : "IT / HR staff"}
            </small>
          </span>
          <LogOut size={16} />
        </button>
      </aside>
      <div className="content">
        <header className="topbar">
          <span>
            Workspace <ChevronRight size={13} />
            <strong>{view}</strong>
          </span>
          <span className="topbar-right">
            <span className="live-dot" />{" "}
            <span className="staff-label">Staff workspace</span>
            <button
              aria-label="Open reminders"
              onClick={() => navigate("Reminders")}
            >
              <Bell size={19} />
            </button>
            <button
              className="mobile-signout"
              aria-label="Sign out"
              onClick={() =>
                void run(async () => {
                  await api("/logout", "POST");
                  setUser(null);
                  await session();
                })
              }
            >
              <LogOut size={17} />
            </button>
          </span>
        </header>
        <main className="main">
          <div className="page-title">
            <div>
              <span className="eyebrow">
                {view === "Overview"
                  ? "A PLACE FOR EVERYTHING"
                  : "YOUR TEAM WORKSPACE"}
              </span>
              <h1>
                {view === "Overview" ? "Equipment, accounted for." : view}
              </h1>
              <p>
                {
                  {
                    Overview:
                      "A clear view of your equipment and the people using it.",
                    Inventory: "Your shared equipment, all in one place.",
                    Loans: "Track every handoff, from request to return.",
                    Approvals:
                      "Review requests before equipment leaves the shelf.",
                    Reminders: "A friendly nudge to bring things back on time.",
                    Activity: "The who, what and when of your workspace.",
                    Team: "Manage access for your IT, HR and admin team.",
                  }[view]
                }
              </p>
            </div>
            <button
              className="primary"
              onClick={() =>
                open(
                  view === "Inventory"
                    ? "item"
                    : view === "Team"
                      ? "user"
                      : "loan",
                )
              }
            >
              <Plus size={18} />
              {view === "Inventory"
                ? "Add item"
                : view === "Team"
                  ? "Add team member"
                  : "New loan"}
            </button>
          </div>
          {!modal && banner}
          {view === "Overview" && (
            <>
              <section className="stats">
                {[
                  {
                    title: "Total equipment",
                    value: items.length,
                    caption: "Across your workspace",
                    icon: Package,
                    color: "mint",
                  },
                  {
                    title: "Available",
                    value: available.length,
                    caption: "Ready for the next handoff",
                    icon: Archive,
                    color: "green",
                  },
                  {
                    title: "On loan",
                    value: active.length,
                    caption: "Out with your people",
                    icon: ArrowUpRight,
                    color: "blue",
                  },
                  {
                    title: "Overdue",
                    value: late.length,
                    caption: late.length
                      ? "Time for a friendly reminder"
                      : "Everything is on track",
                    icon: Clock3,
                    color: "orange",
                  },
                ].map((s) => (
                  <div className="stat" key={s.title}>
                    <div>
                      <span>{s.title}</span>
                      <span className={"stat-icon " + s.color}>
                        <s.icon size={19} />
                      </span>
                    </div>
                    <strong>{s.value.toString().padStart(2, "0")}</strong>
                    <small>{s.caption}</small>
                  </div>
                ))}
              </section>
              <div className="overview-grid">
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Current loans</h2>
                      <p>What’s out and when it’s coming back.</p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => navigate("Loans")}
                    >
                      View all <ArrowUpRight size={15} />
                    </button>
                  </div>
                  {loanTable(active.slice(0, 5))}
                </section>
                <section className="attention">
                  <span className="attention-icon">
                    <ClipboardList size={24} />
                  </span>
                  <span className="eyebrow">NEXT UP</span>
                  <h2>
                    {pending.length
                      ? `${pending.length} request${pending.length === 1 ? "" : "s"} to review`
                      : "You’re all caught up."}
                  </h2>
                  <p>
                    {pending.length
                      ? "A quick review gets your team the equipment they need."
                      : "New requests will land here, ready for your review."}
                  </p>
                  <button onClick={() => navigate("Approvals")}>
                    Review requests <ArrowUpRight size={17} />
                  </button>
                  <div className="attention-footer">
                    <ShieldCheck size={15} />
                    Every handoff has a history.
                  </div>
                </section>
              </div>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>On the shelf</h2>
                    <p>Ready to go when your team needs it.</p>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => navigate("Inventory")}
                  >
                    Browse inventory <ArrowUpRight size={15} />
                  </button>
                </div>
                {available.length ? (
                  <div className="shelf">
                    {available.slice(0, 4).map((i) => (
                      <button
                        key={i.id}
                        className="shelf-item"
                        onClick={() => open("loan", i.id)}
                      >
                        <ItemPhoto item={i} version={photoVersion} />
                        <div>
                          <strong>{i.name}</strong>
                          <small>
                            {i.assetTag} · {i.category}
                          </small>
                        </div>
                        <ArrowUpRight size={17} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <Empty
                    title={
                      items.length
                        ? "Everything is in use"
                        : "Your equipment belongs here"
                    }
                    text={
                      items.length
                        ? "Returned items will appear here."
                        : "Add your first item to start tracking handoffs."
                    }
                    action={() => open("item")}
                    actionText="Add equipment"
                  />
                )}
              </section>
            </>
          )}
          {view === "Inventory" && (
            <>
              <div className="toolbar">
                <SearchBox
                  value={search}
                  onChange={setSearch}
                  placeholder="Search equipment, asset tags…"
                />
                <div className="tabs">
                  {["All", "Available", "Requested", "Borrowed"].map((t) => (
                    <button
                      className={filter === t ? "selected" : ""}
                      onClick={() => setFilter(t)}
                      key={t}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div className="inventory-grid">
                {visibleItems.map((i) => (
                  <article className="item-card" key={i.id}>
                    <div className="item-image">
                      <ItemPhoto item={i} version={photoVersion} />
                      <Badge status={i.status} />
                      <label className="photo-button" title="Upload item photo">
                        <Camera size={17} />
                        <span className="sr-only">Photo for {i.name}</span>
                        <input
                          type="file"
                          accept="image/jpeg,image/png"
                          capture="environment"
                          disabled={busy}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file)
                              void run(async () => {
                                const form = new FormData();
                                form.set("photo", file);
                                await api(`/items/${i.id}/photo`, "POST", form);
                                setPhotoVersion((v) => v + 1);
                                await refresh();
                              }, "Photo updated.");
                          }}
                        />
                      </label>
                    </div>
                    <div className="item-details">
                      <span className="eyebrow">{i.category}</span>
                      <h2>{i.name}</h2>
                      <p>
                        {i.assetTag} <span>·</span> {i.location}
                      </p>
                      {i.notes && <p className="item-notes">{i.notes}</p>}
                      <button
                        className="outline"
                        disabled={i.status !== "Available"}
                        onClick={() => open("loan", i.id)}
                      >
                        {i.status === "Available"
                          ? "Create loan request"
                          : i.status === "Requested"
                            ? "Awaiting approval"
                            : "Currently on loan"}
                        <ArrowUpRight size={16} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              {!visibleItems.length && (
                <Empty
                  title="No equipment found"
                  text="Add an item or try another search."
                  action={() => open("item")}
                  actionText="Add item"
                />
              )}
            </>
          )}
          {(view === "Loans" || view === "Approvals") && (
            <section className="panel">
              <div className="toolbar inset">
                <SearchBox
                  value={search}
                  onChange={setSearch}
                  placeholder="Search borrower or equipment…"
                />
                {view === "Loans" && (
                  <select
                    aria-label="Filter loans"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    {[
                      "All",
                      "Pending",
                      "Borrowed",
                      "Overdue",
                      "Returned",
                      "Rejected",
                    ].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                )}
              </div>
              {loanTable(visibleLoans)}
            </section>
          )}
          {view === "Reminders" && (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Return reminders</h2>
                  <p>
                    {emailConfigured
                      ? "Email is configured. Due and overdue loans are included."
                      : "In-app reminders are ready. Configure email delivery to send borrower emails."}
                  </p>
                </div>
                <button
                  className="outline"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api("/reminders/run", "POST");
                      await refresh();
                    }, "Reminders refreshed.")
                  }
                >
                  Generate reminders
                </button>
              </div>
              {reminders.length ? (
                reminders.map((r) => (
                  <div className="activity" key={r.id}>
                    <span className="mini-icon">
                      <Bell size={18} />
                    </span>
                    <div>
                      <strong>{r.recipient}</strong>
                      <p>{r.message}</p>
                      <small>
                        {prettyDate(r.day)} ·{" "}
                        {r.sentAt ? "Email sent" : "In-app / email queued"}
                      </small>
                    </div>
                  </div>
                ))
              ) : (
                <Empty
                  title="No reminders yet"
                  text="Generate reminders for items due tomorrow or overdue."
                />
              )}
            </section>
          )}
          {view === "Activity" && (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Workspace history</h2>
                  <p>Latest 200 events, recorded automatically.</p>
                </div>
                <Badge status="Read only" />
              </div>
              {audit.length ? (
                audit.map((a) => (
                  <div className="activity" key={a.id}>
                    <span className="mini-icon">
                      <Clock3 size={18} />
                    </span>
                    <div>
                      <strong>{a.action}</strong>
                      <p>{a.detail}</p>
                      <small>
                        {a.actor} · {new Date(a.at).toLocaleString()}
                      </small>
                    </div>
                  </div>
                ))
              ) : (
                <Empty
                  title="A fresh start"
                  text="Your workspace activity will appear here."
                />
              )}
            </section>
          )}
          {view === "Team" && (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Workspace members</h2>
                  <p>Borrowers do not need accounts.</p>
                </div>
              </div>
              {team.map((t) => (
                <div className="activity" key={t.id}>
                  <span className="avatar">{t.email[0].toUpperCase()}</span>
                  <div>
                    <strong>{t.email}</strong>
                    <small>{t.roles.join(", ")}</small>
                  </div>
                </div>
              ))}
            </section>
          )}
          <footer>
            BorrowApp <span>Thoughtful handoffs. Clear accountability.</span>
          </footer>
        </main>
      </div>
      {modal && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">WORKSPACE</span>
                <h2 id="modal-title">
                  {modal === "item"
                    ? "Add equipment"
                    : modal === "loan"
                      ? "New loan request"
                      : modal === "return"
                        ? "Record a return"
                        : "Add team member"}
                </h2>
              </div>
              <button
                aria-label="Close dialog"
                disabled={busy}
                onClick={() => setModal(null)}
              >
                <X />
              </button>
            </div>
            {banner}
            <form onSubmit={submit}>
              {modal === "item" && (
                <>
                  <label>
                    Item name
                    <input
                      name="name"
                      required
                      maxLength={160}
                      autoFocus
                      placeholder="e.g. MacBook Air 13-inch"
                    />
                  </label>
                  <div className="form-row">
                    <label>
                      Asset tag
                      <input
                        name="assetTag"
                        required
                        maxLength={80}
                        placeholder="IT-001"
                      />
                    </label>
                    <label>
                      Category
                      <input
                        aria-label="Category"
                        name="category"
                        required
                        maxLength={80}
                        placeholder="Laptops"
                        list="categories"
                      />
                      <datalist id="categories">
                        {[
                          "Laptops",
                          "Displays",
                          "Accessories",
                          "Cameras",
                          "Other",
                        ].map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </datalist>
                    </label>
                  </div>
                  <label>
                    Location
                    <input
                      name="location"
                      required
                      maxLength={160}
                      placeholder="Bangkok office · IT storage"
                    />
                  </label>
                  <label>
                    Item photo
                    <input
                      type="file"
                      name="photo"
                      accept="image/jpeg,image/png"
                      capture="environment"
                    />
                    <small>
                      Photograph the equipment. JPEG or PNG, up to 5 MB.
                    </small>
                  </label>
                  <label>
                    Notes
                    <textarea
                      name="notes"
                      maxLength={2000}
                      placeholder="Condition, included accessories…"
                    />
                  </label>
                </>
              )}
              {modal === "loan" && (
                <>
                  <label>
                    Equipment
                    <select
                      name="itemId"
                      defaultValue={selected}
                      required
                      autoFocus
                    >
                      <option value="">Choose an available item</option>
                      {available.map((i) => (
                        <option value={i.id} key={i.id}>
                          {i.name} · {i.assetTag}
                        </option>
                      ))}
                    </select>
                  </label>
                  {!available.length && (
                    <p className="hint">
                      Add an available item to create a loan.
                    </p>
                  )}
                  <div className="form-row">
                    <label>
                      Borrower name
                      <input name="borrowerName" required maxLength={160} />
                    </label>
                    <label>
                      Borrower email
                      <input
                        name="borrowerEmail"
                        type="email"
                        required
                        maxLength={254}
                      />
                    </label>
                  </div>
                  <div className="form-row">
                    <label>
                      Department / organization
                      <input name="department" maxLength={160} />
                    </label>
                    <label>
                      Due date
                      <input
                        name="dueAt"
                        type="date"
                        required
                        min={new Date().toLocaleDateString("en-CA")}
                      />
                    </label>
                  </div>
                  <label>
                    Purpose
                    <textarea name="purpose" maxLength={2000} />
                  </label>
                  <div className="hint">
                    <ShieldCheck size={18} />A staff member must approve this
                    request before checkout.
                  </div>
                </>
              )}
              {modal === "return" && (
                <>
                  <p>
                    Return <strong>{returnLoan?.itemName}</strong> from{" "}
                    {returnLoan?.borrowerName}.
                  </p>
                  <label>
                    Condition / return notes
                    <textarea
                      name="notes"
                      autoFocus
                      maxLength={2000}
                      placeholder="Condition checked, accessories received…"
                    />
                  </label>
                </>
              )}
              {modal === "user" && (
                <>
                  <label>
                    Company email
                    <input name="email" type="email" autoFocus required />
                  </label>
                  <label>
                    Password
                    <input
                      name="password"
                      type="password"
                      autoComplete="new-password"
                      minLength={12}
                      required
                    />
                    <small>
                      At least 12 characters, with upper/lowercase, number and
                      symbol.
                    </small>
                  </label>
                  <label>
                    Role
                    <select name="role">
                      <option value="Staff">IT / HR staff</option>
                      <option value="Admin">Administrator</option>
                    </select>
                  </label>
                </>
              )}
              <div className="modal-footer">
                <button
                  type="button"
                  className="outline"
                  disabled={busy}
                  onClick={() => setModal(null)}
                >
                  Cancel
                </button>
                <button
                  className="primary"
                  disabled={busy || (modal === "loan" && !available.length)}
                >
                  {busy
                    ? "Saving…"
                    : modal === "loan"
                      ? "Submit request"
                      : modal === "return"
                        ? "Confirm return"
                        : "Save"}
                  <Check size={16} />
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
function Badge({ status }: { status: string }) {
  return (
    <span className={"badge " + status.toLowerCase().replaceAll(" ", "-")}>
      <span />
      {status}
    </span>
  );
}
function ItemPhoto({ item, version }: { item: Item; version: number }) {
  return item.hasPhoto ? (
    <img src={`/api/items/${item.id}/photo?v=${version}`} alt={item.name} />
  ) : (
    <div className="photo-placeholder">
      <Package size={48} strokeWidth={1.2} />
      <span>Item photo</span>
    </div>
  );
}
function Empty({
  title,
  text,
  action,
  actionText,
}: {
  title: string;
  text: string;
  action?: () => void;
  actionText?: string;
}) {
  return (
    <div className="empty">
      <span>
        <Package size={28} strokeWidth={1.3} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action && (
        <button className="small-button" onClick={action}>
          <Plus size={15} />
          {actionText}
        </button>
      )}
    </div>
  );
}
function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <label className="search">
      <Search size={17} />
      <input
        aria-label="Search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
