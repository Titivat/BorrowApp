# Jira and GitHub pipeline setup

Target Jira: https://titivatmo.atlassian.net — project **SDT**, board **3**.
Target repository: https://github.com/Titivat/BorrowApp.

## 1. Jira field and board

Use **To do → In Progress → In Review → Done**. A person moving an issue into In Progress is the trigger. “Bug / Implement / etc.” should be a field separate from the board’s workflow status columns.

The workflow supports either the standard Jira **Issue type** or a single-select custom field such as **Work type**. Allowed values (case insensitive): Bug, Implement, Implementation, Feature, Story, Task, Improvement. For a custom field, set GitHub repository variable `JIRA_WORK_TYPE_FIELD` to its ID, e.g. `customfield_10042`. Leave it unset to use Issue type. The field ID must be discovered in your Jira project; the example is not your actual ID.

Every ticket needs a description with acceptance criteria. Suggested template:

```text
Problem / requested behavior:
Who uses this:
Acceptance criteria:
1.
2.
Evidence required:
```

## 2. Repository configuration

In GitHub **Settings → Secrets and variables → Actions**, add:

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `JIRA_EMAIL` | Email of an account that can read SDT tickets |
| Secret | `JIRA_API_TOKEN` | Jira API token for that account |
| Secret | `OPENAI_API_KEY` | OpenAI API key with an appropriate usage budget |
| Variable | `ENABLE_AI_AUTOMATION` | `true` only when ready to activate |
| Variable | `JIRA_WORK_TYPE_FIELD` | Optional custom field ID |

The API key is used only for the coding job. Jira secrets stay in the ticket-fetch job. No production secrets are provided to the coding or test jobs. OpenAI API usage is separate from hosting and can incur charges.

Under **Settings → Actions → General**, allow GitHub Actions to create pull requests. Workflow jobs request only the permissions they use. Protect `main` with required human review and the **Build and browser acceptance tests** check. Protection features and required environment reviewers depend on the repository’s visibility and GitHub plan; verify availability in your account. Do not enable auto-merge.

## 3. Jira Automation rule

In SDT project settings, create an automation rule:

1. Trigger: **Issue transitioned**, destination **In Progress**.
2. Condition: project key equals **SDT**. Restrict who can transition issues if the project has untrusted collaborators. Require a nonempty description and one of the allowed work types.
3. Action: **Send web request**.
   - URL: `https://api.github.com/repos/Titivat/BorrowApp/dispatches`
   - Method: `POST`.
   - Headers: `Accept: application/vnd.github+json`, `Content-Type: application/json`, `Authorization: Bearer <GITHUB_DISPATCH_TOKEN>`.
   - Mark the authorization header **hidden**.
   - Body:

```json
{
  "event_type": "jira-in-progress",
  "client_payload": { "issue_key": "{{issue.key}}" }
}
```

Use a fine-grained GitHub token limited to **BorrowApp** with **Contents: write** (GitHub’s requirement for repository dispatch) and Metadata: read. Store it in Jira’s hidden header; never in a ticket or this repository. Use an account with repository write access so Codex’s trigger authorization permits it. Keep this rule disabled until GitHub secrets are configured and the workflow is on `main`.

The payload intentionally carries only the key. GitHub re-fetches the canonical ticket, validates its current status, and reads the configured type field. Ticket content is handled as data, never interpolated into shell commands.

## 4. Test and review

1. Create a small SDT ticket with specific acceptance criteria. Move it to In Progress.
2. Inspect **Actions → Jira to tested PR**. You can also run it manually with the issue key.
3. It creates `automation/SDT-N`, performs builds and browser tests in a fresh job, then creates a **draft PR** with screenshot images and a report link.
4. Inspect feature-specific screenshots as well as generic dashboard proof; tests cannot replace human product review.
5. Mark the PR ready, review, then merge. Update Jira to In Review / Done manually. This implementation does not post Jira comments or transition tickets automatically.
6. A human runs **Deploy manually**, selecting a full tested commit SHA on main.

An existing `automation/SDT-N` branch prevents duplicate runs for the same ticket. If the first run failed before branch creation, fix the cause and rerun. If it already created a branch, continue that PR manually or explicitly delete an abandoned unmerged branch before retrying. A follow-up change after merge should use a new ticket. Checks that fail retain diagnostic artifacts and do not open a successful PR.

The automation intentionally limits patches to `frontend/`, `backend/` and `docs/`. Pipeline/infrastructure changes need a human-authored PR. AI-generated PRs receive an explicit CI workflow dispatch because PR events created with GitHub’s built-in token do not automatically trigger another workflow.

## 5. Manual deployment and reminders

Create a GitHub environment named `production`. Add required human reviewers if your plan supports them. Store `RENDER_API_KEY` and `RENDER_SERVICE_ID` there. `Deploy manually` accepts a full commit SHA, checks that it is on main and has successful push CI, then deploys exactly that commit and waits for Render’s result. Render auto-deploy is disabled in `render.yaml`; confirm it stays off in the dashboard.

For scheduled reminders, add repository variable `APP_URL`, secret `JOB_SECRET` matching Render’s `Jobs__Secret`, and `ENABLE_REMINDERS=true`. The schedule is 02:00 UTC / 09:00 Bangkok. GitHub scheduled runs may be delayed and public-repository schedules may be disabled after inactivity. Without an email provider, the scheduled job generates in-app reminders only. The scheduler is enabled independently of AI automation.

## References

- [GitHub repository dispatch API](https://docs.github.com/en/rest/repos/repos#create-a-repository-dispatch-event)
- [Codex GitHub Action](https://learn.chatgpt.com/docs/github-action)
- [Jira Automation send web request](https://support.atlassian.com/cloud-automation/docs/jira-automation-actions/)
- [Render deploy API](https://api-docs.render.com/reference/create-deploy)
