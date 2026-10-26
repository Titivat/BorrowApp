# Free pilot hosting

Recommended: **one Render free Docker web service** serves both React and the C# API, with **Supabase free PostgreSQL + private Storage** for durable records and item photos. Same-origin hosting avoids cross-site authentication/cookie configuration. Choose nearby regions (Singapore is configured for Render).

As checked on 2026-10-26:

- Render’s free web services sleep after 15 minutes idle and can take about a minute to wake. The filesystem is ephemeral; it must not hold your only database or photos. Render describes free services as suitable for previews, not production applications. [Render free services](https://render.com/docs/free)
- Supabase Free includes 500 MB database storage and 1 GB file storage, subject to egress and project limits; projects can pause after a week of inactivity. [Supabase pricing](https://supabase.com/pricing)
- GitHub Actions, Jira Automation, SMTP and AI API usage have their own account limits. Free app hosting does not mean unlimited or free AI execution.

## Supabase

1. Create a free project. Save the database password privately.
2. Under Storage, create bucket `item-photos`, **private**, with a 5 MB limit and MIME types `image/jpeg`, `image/png`.
3. Copy the project URL and server-side `service_role` key. Never put the service key in React, a `VITE_` variable or a public bucket policy. The backend uploads and reads objects, and authenticates every photo request.
4. Use the session pooler connection if direct PostgreSQL IPv6 connectivity is unavailable. Convert the dashboard connection details to Npgsql format, for example:

```text
Host=<pooler-host>;Port=5432;Database=postgres;Username=postgres.<project-ref>;Password=<database-password>;SSL Mode=Require
```

Use the exact host, port and username from **Connect**. Prefer session mode for migrations. If the password includes semicolons, quote/escape it according to Npgsql connection-string rules. Do not use the example literally.

The API uses EF Core, not Supabase’s public data API. Disable the Supabase Data API for this project (or remove the application schema from exposed schemas) so Identity and borrowing tables are not exposed through Supabase REST. Keep all database access behind the C# API. Startup applies the committed PostgreSQL migration.

## Render

1. Connect the GitHub repository and create a Blueprint from `render.yaml` (or a Docker Web Service with Free plan, root Dockerfile and port 8080).
2. Set these private environment variables:

| Variable | Value |
| --- | --- |
| `ASPNETCORE_ENVIRONMENT` | `Production` |
| `DatabaseProvider` | `Postgres` |
| `ConnectionStrings__Database` | Npgsql PostgreSQL connection string |
| `Storage__Url` | `https://<project-ref>.supabase.co` |
| `Storage__ServiceKey` | Supabase server-side service role key |
| `Storage__Bucket` | `item-photos` |
| `Bootstrap__Email` | First admin email |
| `Bootstrap__Password` | Unique strong password, 12+ characters |
| `Jobs__Secret` | Long random secret shared only with the reminder workflow |

3. Confirm **Auto-Deploy: Off**. Creating the service performs the initial deployment; do that only when you are ready to deploy. Later deployments are manual.
4. After first successful sign-in, remove `Bootstrap__Password`. It is not needed once an account exists. Add other accounts through Team.
5. Add Render credentials to GitHub’s `production` environment as described in [PIPELINE.md](PIPELINE.md). Use the manual workflow for later deployments.

Production startup refuses SQLite or local-only photos so a restart cannot silently erase your data. Authentication encryption keys remain instance-local for this pilot, so users may need to sign in after a restart or redeploy.

## Email reminders

Render Free blocks outbound SMTP ports 25, 465 and 587. Use the supported **Brevo HTTPS API** on the free host:

1. Create a Brevo account and verify a sender according to its account/domain requirements.
2. Create an API key and configure `Email__ApiKey` and `Email__From` on Render.
3. Enable the reminder workflow. The Brevo free plan currently allows up to 300 sends/day, subject to account approval and provider rules. [Brevo free limits](https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan)

Do not use an SMTP key as the HTTP API key. Sending is disabled until credentials are configured. Actual external email delivery has not been tested with your account.

On hosts that permit SMTP, the alternative is your company SMTP relay:

```text
Smtp__Host=<smtp host>
Smtp__Port=587
Smtp__Username=<username>
Smtp__Password=<password>
Smtp__From=<authorized sender address>
```

STARTTLS is required. The application generates one reminder per loan per UTC day for borrowed items due tomorrow, today or earlier. Manual **Generate reminders** works even without an email provider; then reminders stay in-app. Automated delivery needs the GitHub reminder workflow configured. It sends only reminders for loans still borrowed; returned items stop receiving new reminders. Delivery is at-least-once, so avoid simultaneous manual/scheduled sends if duplicates would be problematic.

## Operational notes

- Database migrations run at application startup; review migrations in PRs before human deployment. Use additive changes to preserve rollback options.
- Back up the database and Storage separately. Free-tier backups/retention are limited; this repository does not configure backups.
- Signed-in staff can see borrower names/emails and all inventory. Admin additionally provisions staff accounts.
- This pilot has no password-reset/user-disable UI. Use tested Identity administration before expanding access beyond your initial team.
- Replacing a photo leaves the prior private object for now. Periodically remove unreferenced objects using an admin retention process.
