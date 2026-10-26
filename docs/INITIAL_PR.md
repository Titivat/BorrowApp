Creates the initial React + C# equipment borrowing workspace for IT/HR and admins. Staff can photograph equipment, record any borrower, approve/reject requests, track due dates, record returns, generate reminders and inspect an audit trail. Borrowers do not need accounts.

Adds a Jira SDT → In Progress → type field → Codex implementation → fresh-runner tests → draft PR workflow with screenshot evidence. Deployment is a separate human-triggered action for an exact tested commit. AI automation and scheduled reminders remain disabled until configured.

**Validation:** backend Release build and frontend production build passed; all 4 end-to-end tests passed with SQLite and again with PostgreSQL 17 (including the initial schema migration); 2 pipeline checks passed. Tests cover auth/CSRF/roles, photo validation and upload, concurrent loan reservations, approvals/rejections/returns, reminder deduplication, audit history and mobile layout.

![Desktop dashboard](https://github.com/Titivat/BorrowApp/blob/feat/project-setup/docs/evidence/initial/dashboard-desktop.png?raw=true)

![Approval proof](https://github.com/Titivat/BorrowApp/blob/feat/project-setup/docs/evidence/initial/approval-proof.png?raw=true)

![Return proof](https://github.com/Titivat/BorrowApp/blob/feat/project-setup/docs/evidence/initial/return-proof.png?raw=true)

[Mobile proof and test results](https://github.com/Titivat/BorrowApp/tree/feat/project-setup/docs/evidence/initial)

**Activation required after review/merge:** connect Jira and configure its automation rule; add GitHub Jira/OpenAI secrets; configure Supabase and Render; configure Brevo HTTPS email delivery if wanted. Live cloud integrations have not been exercised without those credentials. The app has not been deployed.

Free pilot recommendation: Render Docker service + Supabase PostgreSQL/private Storage. Render sleeps when idle and blocks standard SMTP ports; Brevo HTTPS delivery is supported. AI API usage is separately billed. See `docs/PIPELINE.md` and `docs/HOSTING.md` for setup and pilot limitations.
