# Contributing to Kartavya

Welcome to the team. This guide covers everything you need to get set up, make changes, and get them merged cleanly.

---

## Table of contents

1. [Before you start](#1-before-you-start)
2. [Getting the repo](#2-getting-the-repo)
3. [Project layout](#3-project-layout)
4. [The source of truth: contract and schema first](#4-the-source-of-truth-contract-and-schema-first)
5. [Branch naming](#5-branch-naming)
6. [Making changes](#6-making-changes)
7. [Commit messages](#7-commit-messages)
8. [Opening a pull request](#8-opening-a-pull-request)
9. [Code review](#9-code-review)
10. [Frontend-specific notes](#10-frontend-specific-notes)

---

## 1. Before you start

Make sure you have the following installed:

| Tool | Minimum version | Why |
|---|---|---|
| Git | 2.x | version control |
| Python | 3.11+ | backend (Flask) |
| Node.js | 18+ | frontend |
| A DBML viewer (optional) | — | reading `schema.dbml` (e.g. [dbdiagram.io](https://dbdiagram.io)) |

Pick up your task from the project board before writing any code, so no two people work on the same thing.

---

## 2. Getting the repo

There are two ways to contribute, depending on whether you have direct write access to the repository.

---

### Option A — direct collaborator (team members with repo access)

As a direct collaborator you have push access to the repository itself. There is only one remote — `origin` points straight to `<org>/MAY2026-Team-040`. You clone it, branch off `main`, and push branches back to the same repo.

Here is the full picture:

```
GitHub: <org>/MAY2026-Team-040   ←── "origin" (the real repo, you can push branches here)
              ↑
        push branches / open PRs
              |
      Your local machine
```

You can push feature branches to `origin`, but you **cannot push directly to `main`** — that is protected and only accepts changes through reviewed pull requests.

#### Step 1 — Clone the repository

```bash
git clone https://github.com/<org>/MAY2026-Team-040.git
cd MAY2026-Team-040
```

You will automatically have one remote called `origin`:

```bash
git remote -v
# origin  https://github.com/<org>/MAY2026-Team-040.git (fetch)
# origin  https://github.com/<org>/MAY2026-Team-040.git (push)
```

#### Step 2 — Get the latest main

Before creating any branch, make sure your local `main` is fully up to date:

```bash
git checkout main
git pull origin main
```

`git pull` is shorthand for `git fetch` (download new commits) followed by `git merge` (apply them to your local branch). On `main` it is safe because you are never making local commits there.

#### Step 3 — Create your feature branch

Branch off `main` with a descriptive name (see [branch naming rules](#5-branch-naming)):

```bash
git checkout -b feat/my-feature
```

This creates the branch locally and switches to it. Your changes will live here, not on `main`.

#### Step 4 — Work and commit

Make your changes, then stage and commit them:

```bash
git add <file>          # stage specific files
# or
git add -p              # interactively stage hunks (useful for mixed changes)

git commit              # opens your editor for the commit message
```

See [commit message rules](#7-commit-messages) for the required format. Make small, logical commits rather than one giant commit at the end — they are easier to review and easier to revert if something breaks.

#### Step 5 — Push your branch to origin

```bash
git push -u origin feat/my-feature
```

The `-u` flag sets `origin/feat/my-feature` as the tracking branch, so subsequent `git push` calls on this branch need no extra arguments. You can push as many times as you like while working — each push updates the remote branch and, if a PR is already open, GitHub updates it automatically.

#### Step 6 — Open a pull request

Go to the repository on GitHub. You will see a yellow banner: **"feat/my-feature had recent pushes — Compare & pull request."** Click it. Set the base branch to `main`, fill in the description, and submit.

---

### Keeping your local main up to date

Every time you start a new piece of work, sync `main` first:

```bash
git checkout main
git pull origin main
git checkout -b feat/next-feature
```

If you have been on a feature branch for a while and `main` has moved on, do not re-pull `main` to update your feature branch — use rebase instead (see the next section).

---

### Updating your feature branch when main has moved

If new commits land on `main` while you are still working on your branch, pull them in before opening your PR to avoid conflicts and to keep history clean. Use rebase, not merge:

```bash
# While on your feature branch:
git fetch origin
git rebase origin/main
```

Rebase replays your commits on top of the latest `main`. If there are conflicts, Git pauses and tells you which files to fix. For each conflicted file:

1. Open the file and look for conflict markers:
   ```
   <<<<<<< HEAD
   your change
   =======
   incoming change from main
   >>>>>>> origin/main
   ```
2. Edit the file to the correct final state and remove the markers.
3. Stage the resolved file: `git add <file>`
4. Continue: `git rebase --continue`

If things go badly wrong and you want to start over:
```bash
git rebase --abort
```

After a successful rebase, history has been rewritten, so force-push to update the remote branch:

```bash
git push origin feat/my-feature --force-with-lease
```

Use `--force-with-lease` rather than plain `--force` — it refuses to push if someone else has pushed to the same branch since your last fetch, so you cannot accidentally overwrite their work.

---

### After your PR is merged

Once I approve & merge your PR, clean up so your local environment stays tidy:

```bash
# Sync local main — it now includes your work
git checkout main
git pull origin main

# Delete the feature branch locally
git branch -d feat/my-feature

# Delete the remote branch (GitHub offers a button for this on the PR page too)
git push origin --delete feat/my-feature
```

---

### Common mistakes for direct collaborators

| Mistake | What goes wrong | How to avoid it |
|---|---|---|
| Committing directly to `main` | Push is rejected because `main` is protected; your work is stranded on local `main` | Always create a feature branch before making any changes |
| Starting a branch off stale `main` | Your PR includes changes that are already on `main`, causing false conflicts | Run `git pull origin main` before every `git checkout -b` |
| Using `git merge origin/main` instead of `git rebase` to update your branch | Creates an ugly "Merge branch 'main' into feat/..." commit in the PR | Always use `git rebase origin/main` on your feature branch |
| Force-pushing with `--force` instead of `--force-with-lease` | Can silently overwrite a teammate's push to the same branch | Always use `--force-with-lease` |
| Pushing directly to `origin/main` | Rejected if protected; or worse, succeeds and bypasses review | Only push feature branches; let the PR process land things on `main` |
| Not deleting merged branches | Branch list grows unmanageable; old branches cause confusion | Delete both local and remote branch after every merge |

---

### Option B — fork-based workflow (step-by-step)

If you do not have direct push access to the repository, you work through a **fork**. A fork is your own personal copy of the repository that lives under your GitHub account. You can push to it freely, and when your work is ready you open a pull request from your fork into the original repo.

Here is the full picture of how the remotes work:

```
GitHub: main/MAY2026-Team-040   ←── "upstream" (the original, you cannot push here)
              ↑
        pull requests
              |
GitHub: <you>/MAY2026-Team-040   ←── "origin" (your fork, you own this)
              ↑
            push
              |
      Your local machine
```

#### Step 1 — Fork on GitHub

1. Go to the repository page on GitHub.
2. Click the **Fork** button in the top-right corner.
3. GitHub will create a copy at `https://github.com/<your-username>/MAY2026-Team-040`. This is your fork — only you can push to it.

#### Step 2 — Clone your fork locally

Clone **your fork**, not the original:

```bash
git clone https://github.com/<your-username>/MAY2026-Team-040.git
cd MAY2026-Team-040
```

At this point, `origin` points to your fork. You can verify:

```bash
git remote -v
# origin  https://github.com/<your-username>/MAY2026-Team-040.git (fetch)
# origin  https://github.com/<your-username>/MAY2026-Team-040.git (push)
```

#### Step 3 — Add the original repo as "upstream"

You need a second remote so you can pull in changes that other contributors land on the original repo. The convention is to call it `upstream`:

```bash
git remote add upstream https://github.com/<org>/MAY2026-Team-040.git
```

Verify both remotes are now set up:

```bash
git remote -v
# origin    https://github.com/<your-username>/MAY2026-Team-040.git (fetch)
# origin    https://github.com/<your-username>/MAY2026-Team-040.git (push)
# upstream  https://github.com/<org>/MAY2026-Team-040.git           (fetch)
# upstream  https://github.com/<org>/MAY2026-Team-040.git           (push)
```

You will **fetch** from upstream (to get others' changes) but you will **never push** to it — you don't have permission, and that's intentional.

#### Step 4 — Fetch the latest upstream state

Before creating any branch, always grab the latest state from upstream:

```bash
git fetch upstream
```

This downloads all branches and commits from the original repo into your local Git, but does not change any of your files yet.

#### Step 5 — Create your feature branch off upstream/main

**Never branch off your local `main` without syncing first.** Instead, branch directly from the freshly fetched `upstream/main`:

```bash
git checkout -b feat/my-feature upstream/main
```

This ensures your branch starts from the very latest code, even if your fork's `main` has fallen behind.

#### Step 6 — Work, commit, and push to your fork

Make your changes locally, commit them (see [commit message rules](#7-commit-messages)), then push to **your fork** (`origin`):

```bash
git push -u origin feat/my-feature
```

The `-u` flag sets `origin/feat/my-feature` as the tracking branch, so future `git push` commands on this branch need no extra arguments.

#### Step 7 — Open a pull request

Go to your fork on GitHub. You will see a banner saying "your branch is ahead of upstream" with a **Compare & pull request** button. Click it, make sure the base is set to `<org>/MAY2026-Team-040 : main` (not your fork's main), fill in the description, and submit.

---

### Keeping your fork in sync

The original repo moves forward as other contributors merge their PRs. Your fork does not update automatically — you have to pull those changes in manually. Do this **before starting every new branch** and whenever you see your branch falling behind.

```bash
# Download the latest upstream changes (does not touch your files)
git fetch upstream

# Switch to your local main
git checkout main

# Fast-forward your local main to match upstream/main
# (this should always be a fast-forward since you never commit directly to main)
git merge --ff-only upstream/main

# Push the updated main to your fork on GitHub
git push origin main
```

If `merge --ff-only` fails it means you accidentally committed to `main` locally. Undo by running:

```bash
git checkout main
git reset --hard upstream/main   # discards local commits on main
git push origin main --force
```

This is why the rule exists — **never commit directly to `main`**, so syncing always stays simple.

---

### Updating your feature branch when upstream has moved

If new commits land on upstream while you are still working on your branch, you need to pull them in before opening your PR to avoid conflicts. Use rebase, not merge, to keep history clean:

```bash
# While on your feature branch:
git fetch upstream
git rebase upstream/main
```

Rebase replays your commits on top of the latest upstream state. If there are conflicts, Git will pause and tell you which files to fix. For each conflicted file:

1. Open the file and look for conflict markers:
   ```
   <<<<<<< HEAD
   your change
   =======
   upstream change
   >>>>>>> upstream/main
   ```
2. Edit the file to the correct final state (delete the markers too).
3. Mark it resolved: `git add <file>`
4. Continue the rebase: `git rebase --continue`

If things go badly wrong and you want to abort and start over:
```bash
git rebase --abort
```

After a successful rebase, your local branch has rewritten history, so you need to force-push to your fork:

```bash
git push origin feat/my-feature --force-with-lease
```

Use `--force-with-lease` rather than plain `--force` — it is a safer version that refuses to push if someone else has pushed to the same branch since you last fetched, preventing you from accidentally overwriting their work.

---

### After your PR is merged

Once a maintainer merges your PR, clean up:

```bash
# Sync your local main with upstream (it now includes your work)
git fetch upstream
git checkout main
git merge --ff-only upstream/main
git push origin main

# Delete the feature branch locally
git branch -d feat/my-feature

# Delete it from your fork on GitHub
git push origin --delete feat/my-feature
```

Your fork's `main` is now back in sync and you are ready to start the next task.

---

### Common mistakes with forks

| Mistake | What goes wrong | How to avoid it |
|---|---|---|
| Cloning the original repo instead of the fork | You cannot push your commits anywhere | Always clone `github.com/<your-username>/...` |
| Forgetting to add the `upstream` remote | You cannot pull in others' changes | Add it immediately after cloning (Step 3) |
| Branching off a stale local `main` | Your PR starts from old code, conflicts pile up | Always run `git fetch upstream` first, then branch off `upstream/main` |
| Committing directly to `main` on your fork | Sync with upstream breaks | Only ever commit to feature branches, never to `main` |
| Using `git merge` instead of `git rebase` to update your branch | Creates an ugly merge commit in your PR history | Use `git rebase upstream/main` on your branch |
| Force-pushing with `--force` instead of `--force-with-lease` | Can silently overwrite a teammate's push | Always use `--force-with-lease` |
| Opening the PR against your fork's `main` instead of upstream's `main` | The PR goes nowhere and reviewers are confused | Double-check the "base repository" dropdown when creating the PR |

---

## 3. Project layout

```text
Kartavya/
├── backend/
│   ├── api/openapi.yaml        ← canonical API contract (read this first)
│   ├── database/schema.dbml    ← SQLite schema, mirrors the contract
│   └── app/                    ← Flask application (implement here)
│       ├── config/
│       ├── controllers/
│       ├── middlewares/
│       ├── models/
│       ├── routes/
│       ├── services/
│       └── views/
├── frontend/
│   └── src/                    ← React application (implement here)
│       ├── components/
│       ├── hooks/
│       ├── pages/
│       ├── routes/
│       ├── services/
│       └── types/
├── shared/contracts/           ← cross-cutting contracts (currently empty)
└── docs/
    └── DOCUMENTATION.md
```

Full folder descriptions are in [docs/DOCUMENTATION.md](docs/DOCUMENTATION.md).

---

## 4. The source of truth: contract and schema first

**Read `backend/api/openapi.yaml` and `backend/database/schema.dbml` before writing any code.**

These two files are the single source of truth for the entire project:

- `openapi.yaml` defines every endpoint, every request body, every response shape, and every status code the API must return. If it is not in the spec, do not implement it.
- `schema.dbml` defines every table, column, type, index, and relationship the database must have. Your SQLAlchemy models must mirror this exactly.

---

## 5. Branch naming

Use the format `<type>/<short-description>`, all lowercase, hyphens only.

| Type | When to use | Example |
|---|---|---|
| `feat/` | new feature or endpoint | `feat/complaint-submission` |
| `fix/` | bug fix | `fix/sla-timer-pause` |
| `refactor/` | restructuring with no behaviour change | `refactor/auth-middleware` |
| `test/` | adding or fixing tests | `test/evidence-upload` |
| `docs/` | documentation only | `docs/setup-guide` |
| `chore/` | tooling, config, deps | `chore/add-ruff-config` |

Keep the description short (3–5 words). Use the issue or ticket number if there is one: `feat/42-officer-queue`.

---

## 6. Making changes

A few rules to keep the codebase clean:

- **One concern per PR.** A PR that adds an endpoint should not also rename unrelated files or fix an unrelated bug. Small, focused PRs are reviewed faster and revert cleanly if something goes wrong.
- **Backend and frontend in separate PRs** unless a change is so tightly coupled that splitting it creates more confusion than it saves.
- **Never commit directly to `main`.** All changes go through a pull request, regardless of how small.
- **Do not commit secrets.** API keys, `.env` files, and database files (`*.sqlite3`, `db.sqlite3`) are already in `.gitignore`. Double-check before staging.
- **Remove debug code** (`print()`, `console.log()`, commented-out blocks) before opening a PR.

If you end up violating any of these I'll personally deduct your social credits.

---

## 7. Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).

```
<type>(<scope>): <short summary in present tense>

<optional body: what and why, not how. Wrap at 72 chars.>
```

**Types:** `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `style`, `perf`

**Scope:** the part of the codebase touched — e.g. `auth`, `complaints`, `evidence`, `gamification`, `schema`, `openapi`, `frontend`

**Good examples:**

```
feat(complaints): add POST /complaints endpoint

Implements complaint creation per openapi.yaml §/complaints.
Zone is resolved from latitude/longitude at submit time using
Haversine distance against the zones table.
```

```
fix(sla): exclude NEEDS_MORE_EVIDENCE time from SLA calculation

The timer was not writing to sla_paused_seconds on status
transition, so all paused complaints showed as overdue.
```

```
docs(contributing): add setup and PR process guide
```

**Rules:**
- Summary line ≤ 72 characters, lowercase, no trailing period.
- Use the imperative mood: "add endpoint", not "added endpoint" or "adding endpoint".
- If the commit closes an issue, add `Closes #<n>` at the end of the body.
- One logical change per commit. Use `git add -p` if you have mixed changes.

---

## 8. Opening a pull request

1. **Sync your branch with main** before pushing, so your PR has no avoidable conflicts:

   Direct collaborators:
   ```bash
   git fetch origin
   git rebase origin/main
   ```

   Fork-based contributors:
   ```bash
   git fetch upstream
   git rebase upstream/main
   # if rebase rewrote history, force-push safely:
   git push origin <your-branch> --force-with-lease
   ```

2. **Push your branch** to your own remote (`origin` in both cases):
   ```bash
   git push -u origin <your-branch>
   ```

3. **Open the PR on GitHub.**
   - Fork-based: GitHub will show a "Compare & pull request" banner on your fork's page. Click it.
   - In the PR form, confirm the **base repository** is `<org>/MAY2026-Team-040` and the **base branch** is `main`. Never target your fork's `main`.

4. **Fill in the PR description** — at minimum:
   - What this PR does (2–3 sentences or bullets).
   - How to test it manually.
   - Any API contract or schema changes made (if any).
   - Screenshots for UI changes.

5. **Link the related issue** if one exists (`Closes #n` in the description).

6. **Do not merge your own PR.** At least one other team member must approve it.

---

## 9. Code review

**As an author:**
- Respond to all comments before merging, even if just to say "done" or "disagree, see reply."
- Do not force-push after a review has started — add new commits instead, so reviewers can see what changed.

**As a reviewer:**
- Check that the implementation matches `openapi.yaml` (status codes, field names, required vs optional fields).
- Check that any new models match `schema.dbml` (column names, types, nullable rules, indexes).
- Approve only when you have actually read the diff, not just skimmed it.
- Use GitHub's "Request changes" for blockers, inline comments for nitpicks.

---

## 10. Frontend-specific notes

- **API contract first:** build against `backend/api/openapi.yaml`. Use it to mock responses while the backend is not yet ready — every response shape is fully specified.
- **Folder conventions:**
  - `components/` — reusable UI pieces (buttons, cards, form fields). Should not call the API directly.
  - `hooks/` — custom hooks that encapsulate state and side effects, including API calls.
  - `pages/` — one folder per route/screen. Compose components and hooks here.
  - `services/` — the raw API client layer. Keep fetch/axios calls here, out of components and hooks.
  - `types/` — TypeScript interfaces that mirror the `components/schemas` in `openapi.yaml`. Keep them in sync manually until a code generator is set up.
- **Roles:** the UI must enforce the three-role model. Citizens must not see officer or admin views, and vice versa.
- **AI feature degradation:** all AI-backed features (`aiAvailable`, `ai_screen_status`, category suggestion) can return an "unavailable" signal. The UI must handle this gracefully — never show a broken state.
- **No raw complaint reporter details** should ever be rendered in officer or public views. The API already strips them; the frontend should not re-introduce them via local state.

---

If something in this guide is unclear or out of date, open a `docs/` PR to fix it — the best contributors are the ones who leave the codebase better than they found it.