# OptiPass — agent working rules

## PMS Task Logging

We log all our work to the PMS tool (pms-nu-eight.vercel.app). Several fields
fail **silently** (HTTP 200 but ignored) if the shape is wrong — follow exactly.

- Credentials: read `PMS_API_BASE`, `PMS_API_TOKEN`, `PMS_PROJECT_ID` from
  `.env.local` (gitignored). Auth: `Authorization: Bearer $PMS_API_TOKEN` on
  every call, `Content-Type: application/json` on writes.
- **Always log our work.** Every substantive piece of work gets a PMS task.
  When planning, create tasks up front in **Backlog**; move them forward as
  work happens.
- **Task code for this project: `OPT`.** Title format: `[OPT-###] Short
  imperative summary`. Next number = scan `GET
  /api/projects/{PMS_PROJECT_ID}/tasks` for max `[OPT-NN]` + 1.
- **Assignee = Christian Albea**, every task. Field is
  `assigneeIds: ["<id>"]` — an array of plain id strings (NOT `assignees`,
  NOT `[{userId}]`; wrong shapes are silently dropped). After creating,
  re-read the task and confirm `assignees[].user.name`.
- **`dueDate` is required on create and must be date-only** (`"2026-07-31"`);
  full ISO datetimes return `400`.
- **`columnId` is REQUIRED on create** (learned from `GET /api/openapi.json`;
  the older notes omit this) — create in the Backlog column explicitly.
- **Column flow: Backlog → To Do → In Progress → Done, one move at a time,**
  even for already-finished work (the daily report is built from movement
  events). Moves use `PATCH /api/tasks/{taskId}/move` with **both**
  `{ columnId, position }` — sending `columnId` to `PATCH /api/tasks/{id}`
  returns 400.
- Path asymmetry: create/list at `/api/projects/{id}/tasks`; patch/move/delete
  at `/api/tasks/{id}`. `GET /api/me` doesn't exist — use `project.viewer.id`.
  `GET /api/openapi.json` (authed) is the source of truth for request bodies.

### Discovered ids for this project (cms90gtw0000004lj330s9yyp)

Re-verify with `GET /api/projects/{id}` if anything 404s — never reuse these
in another project.

| Thing | Id |
|---|---|
| Backlog column | `cms90gtyh000104ljpw0c0mem` |
| To Do column | `cms90gtyh000204ljl0syc2nc` |
| In Progress column | `cms90gtyh000304ljucb93mcw` |
| Done column (= doneColumnId) | `cms90gtyh000604ljnrtcalkg` |
| Christian Albea (assignee) | `cmnn0efnn000004l45ei56r92` |

Tasks `[OPT-1]`…`[OPT-63]` (2026-07-31) cover all work from v1 planning
through the credit-box UI merge — continue numbering from there.

## Project notes

- Chrome MV3 extension, plain ES modules, no build step. Syntax check with
  `node --check` (copy to `.mjs`).
- Zero-knowledge crypto: server stores ciphertext only. Never log or store
  plaintext secrets server-side; API keys for monitors are E2E-encrypted
  under a vault key.
- Supabase schema changes ship as `supabase/migration-00N-*.sql` files AND
  get folded into `supabase/schema.sql` (fresh-install master). The user runs
  migrations manually in the Supabase SQL Editor — call out clearly when a
  new migration must be run.
- Test crypto changes in Node against known vectors before shipping; verify
  UI changes with headless-Chrome screenshots in both themes.
