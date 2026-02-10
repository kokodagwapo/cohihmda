# Git Workflow and Change Management Guide

> How the Cohi team works with Git: branching, merging, parallel development, conflict resolution, and release management.

---

## Table of Contents

- [Branch Structure](#1-branch-structure)
- [Daily Workflow](#2-daily-workflow)
- [Working in Parallel](#3-working-in-parallel)
- [Merging and Pull Requests](#4-merging-and-pull-requests)
- [Handling Merge Conflicts](#5-handling-merge-conflicts)
- [Database Migrations in a Team](#6-database-migrations-in-a-team)
- [Release Process](#7-release-process)
- [Rules and Best Practices](#8-rules-and-best-practices)
- [Common Scenarios](#9-common-scenarios)
- [Emergency Fixes (Hotfixes)](#10-emergency-fixes-hotfixes)

---

## 1. Branch Structure

```text
main          Production. Deployed to AWS prod via Bitbucket Pipelines.
  |
  +-- dev     Integration branch. Deployed to AWS dev environment.
       |
       +-- marko         Developer branch (long-lived)
       +-- chays         Developer branch (long-lived)
       +-- jdia          Developer branch (long-lived)
       +-- feature/xyz   Short-lived feature branches (preferred)
```

### Branch Roles

| Branch         | Purpose                         | Deploys To  | Who Merges Into It        |
| -------------- | ------------------------------- | ----------- | ------------------------- |
| `main`         | Production-ready code           | Production  | PR from `dev` only        |
| `dev`          | Integration / staging           | Dev env     | PRs from feature branches |
| `<name>`       | Developer's working branch      | Nothing     | Developer pushes directly |
| `feature/xyz`  | Short-lived feature work        | Nothing     | Developer pushes directly |

### Current Pattern vs Recommended

The team currently uses **long-lived developer branches** (e.g., `marko`, `chays`, `jdia`) that accumulate many commits before merging to `dev`. This works but can lead to large, painful merges.

The recommended shift is toward **short-lived feature branches** that merge to `dev` more frequently:

```text
# Current (works, but merges are large)
dev <-- marko (20+ commits over 2 weeks) <-- chays (15+ commits)

# Recommended (smaller, more frequent merges)
dev <-- feature/add-loan-filter (3 commits, merged in 2 days)
dev <-- feature/scorecard-weights (5 commits, merged in 3 days)
dev <-- fix/migration-checksum (1 commit, merged same day)
```

Both approaches work. The key is: **merge to `dev` frequently** -- at least once or twice a week -- regardless of which pattern you use.

---

## 2. Daily Workflow

### Starting Your Day

```bash
# Switch to your working branch
git checkout marko          # or your branch name

# Pull the latest from your branch (if you work from multiple machines)
git pull origin marko

# Pull the latest from dev into your branch to stay current
git pull origin dev
```

**Pull from `dev` regularly** -- ideally daily. The longer you wait, the more conflicts you accumulate.

### During the Day

```bash
# Stage and commit your work frequently
git add -A
git commit -m "add loan status filter to dashboard query"

# Push to your remote branch
git push origin marko
```

**Commit messages:** Keep them short and descriptive. Describe *what* changed and *why*, not *how*:

```text
# Good
add loan status filter to dashboard query
fix checksum mismatch on Windows by normalizing line endings
update scorecard weights for Q1 2026 targets

# Bad
fix stuff
WIP
changes
update files
```

### End of Day

```bash
# Push whatever you have, even if it's work-in-progress
git add -A
git commit -m "WIP: scorecard trend chart layout"
git push origin marko
```

It's fine to push WIP commits to your own branch. You can clean them up before merging to `dev`.

---

## 3. Working in Parallel

### The Problem

Multiple developers editing the same files at the same time will cause merge conflicts. You can't eliminate this entirely, but you can minimize it.

### Strategies to Reduce Conflicts

**1. Communicate what you're working on**

Before starting work, let the team know which area you're touching. A simple "I'm working on the scorecard routes today" in chat prevents two people from editing the same files.

**2. Stay synced with `dev`**

```bash
# Pull dev into your branch daily
git pull origin dev
```

This catches conflicts early when they're small, instead of discovering a massive conflict after 2 weeks.

**3. Separate concerns by file**

The codebase is structured to support parallel work:

| Area               | Files                                    | Typical Owner |
| ------------------ | ---------------------------------------- | ------------- |
| Dashboard UI       | `src/components/dashboard/`              | Any           |
| Scorecard UI       | `src/components/scorecard/`              | Any           |
| Workbench UI       | `src/components/workbench/`              | Any           |
| Backend routes     | `server/src/routes/<feature>.ts`         | Any           |
| Backend services   | `server/src/services/<feature>/`         | Any           |
| Predictions        | `server/src/services/dashboard/predictionService.ts` | One person at a time |
| Database schema    | `server/migrations/`                     | Coordinate    |

**4. Avoid editing shared files unnecessarily**

Files that everyone touches (and that cause the most conflicts):
- `src/App.tsx` -- only edit to add routes
- `server/src/routes/index.ts` -- only edit to register new routes
- `package.json` / `server/package.json` -- only edit to add/remove dependencies

**5. If two people must edit the same file**

Work in different functions or sections of the file. Communicate which section you're in. Git can auto-merge changes in different parts of the same file.

---

## 4. Merging and Pull Requests

### Merging Your Branch to `dev`

**Step 1: Sync with `dev` first**

```bash
git checkout marko
git pull origin dev       # Pull latest dev into your branch
# Resolve any conflicts HERE, in your branch
git push origin marko     # Push the resolved state
```

**Step 2: Create a Pull Request on Bitbucket**

- Source: `marko` (your branch)
- Destination: `dev`
- Title: Short summary of what's included
- Description: List the main changes (bullet points)

**Step 3: Review and merge**

- At least one team member should review the PR (even briefly)
- Use **"Merge commit"** strategy (not squash, not rebase) -- this preserves history
- Delete the source branch only if it's a short-lived feature branch (not your personal long-lived branch)

### PR Size Guidelines

| PR Size      | Commits | Review Time | Risk    |
| ------------ | ------- | ----------- | ------- |
| Small        | 1-5     | 15 min      | Low     |
| Medium       | 5-15    | 30 min      | Medium  |
| Large        | 15+     | 1+ hour     | High    |

**Aim for small-to-medium PRs.** If your branch has 20+ commits, consider splitting the PR into logical chunks (e.g., "backend changes" then "frontend changes").

### Squashing Commits (Optional)

If your branch has many messy WIP commits, you can squash before creating the PR:

```bash
# Interactive rebase to squash last N commits into fewer, cleaner ones
# WARNING: Only do this on YOUR branch, never on dev or main
git rebase -i HEAD~10
# In the editor, change "pick" to "squash" for commits you want to combine
# Save and edit the combined commit message
git push origin marko --force-with-lease
```

`--force-with-lease` is safer than `--force` -- it refuses to push if someone else pushed to the branch since your last pull.

---

## 5. Handling Merge Conflicts

### When Conflicts Happen

Conflicts occur when two branches modify the same lines of the same file. Git can auto-merge changes in *different* parts of a file but not the *same* lines.

### Resolving Conflicts

**Step 1: Pull `dev` and see the conflicts**

```bash
git checkout marko
git pull origin dev
# Git will tell you which files have conflicts
```

**Step 2: Open conflicted files**

Conflict markers look like this:

```text
<<<<<<< HEAD
// Your version (from your branch)
const threshold = calculateDynamic(orgRate);
=======
// Their version (from dev)
const threshold = 7; // Fixed threshold
>>>>>>> origin/dev
```

**Step 3: Resolve by choosing the right version**

- **Keep yours** if your change is newer/better
- **Keep theirs** if their change is the correct one
- **Combine both** if both changes are needed (most common)

Delete the conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) and leave only the correct code.

**Step 4: Mark resolved and commit**

```bash
git add .
git commit -m "merge dev into marko, resolve conflicts in predictionService"
git push origin marko
```

### Using VS Code / Cursor to Resolve

Cursor/VS Code shows conflict markers with clickable buttons:
- **Accept Current Change** -- keep your version
- **Accept Incoming Change** -- keep their version
- **Accept Both Changes** -- keep both (you'll need to manually combine)

### Preventing Large Conflicts

The single most effective practice: **pull from `dev` every day**.

```bash
# Make this a daily habit
git pull origin dev
```

A 1-file conflict from yesterday is easy. A 20-file conflict from 2 weeks ago is painful.

---

## 6. Database Migrations in a Team

Migrations are the highest-risk area for parallel development because they have **sequential version numbers** and modify shared schema.

### The Problem

If two developers both create migration `028_something.sql` on their branches, you get a version number collision when both merge to `dev`.

### Rules for Migrations

**1. Coordinate migration creation**

Before creating a migration, check if anyone else has pending migrations:

```bash
# Check what's in dev that you don't have
git fetch origin
git log origin/dev --oneline -- server/migrations/
```

Or simply ask in chat: "Anyone have pending migrations?"

**2. Number migrations at merge time, not creation time**

If you create a migration on your branch, be prepared to renumber it when you merge to `dev`. For example, if your branch has `028_add_widget.sql` but someone else already merged `028_add_report.sql` to `dev`, rename yours to `029_add_widget.sql`.

**3. Never modify someone else's migration**

If you see a migration from another developer that you think needs changes, create a **new** migration with your changes. Never edit their file.

**4. Test migrations on a fresh database**

Before creating a PR with migrations:

```bash
cd server
npm run init:local -- --reset   # Full reset
npx tsx src/migrations/cli.ts all  # Run all migrations fresh
```

This confirms your migration works from scratch, not just incrementally.

**5. Migration file checklist before PR**

- [ ] Version number doesn't conflict with any migration in `dev`
- [ ] Uses `IF NOT EXISTS` / `DO $$ BEGIN ... END $$` for idempotency
- [ ] Tested on a fresh local database
- [ ] No breaking changes to existing columns (add columns, don't rename/delete)

---

## 7. Release Process

### Dev to Production Flow

```text
Feature branches --> dev (auto-deploys to dev env) --> main (auto-deploys to production)
```

### Releasing to Production

**Step 1: Verify dev is stable**

- All features for the release are merged to `dev`
- The dev environment has been tested
- No broken functionality

**Step 2: Create a PR from `dev` to `main`**

- Source: `dev`
- Destination: `main`
- Title: e.g., "Release 2026-02-09"
- Description: List all changes since last release

**Step 3: Review and merge**

- All team members should review (or at least be aware)
- Merge using **merge commit** (preserves the full history)

**Step 4: Monitor the deployment**

After merging to `main`, Bitbucket Pipelines automatically:
1. Detects what changed (frontend, backend, infrastructure)
2. Builds and deploys only the changed components
3. Invalidates CloudFront cache (frontend) or updates ECS service (backend)

**Step 5: Run production migrations if needed**

If the release includes database migrations, run them via ECS Exec (see [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md#10-deployment-overview)).

### Rollback

If something breaks after deploying to production:

1. **Frontend:** Revert the S3 deployment or redeploy the previous version
2. **Backend:** Update ECS service to the previous Docker image tag
3. **Database:** Migrations cannot be automatically rolled back. If a migration caused issues, create a new migration that reverses the changes.

---

## 8. Rules and Best Practices

### The Golden Rules

1. **Never force-push to `dev` or `main`.** Only force-push to your own branch, and only with `--force-with-lease`.
2. **Never commit directly to `main`.** All changes go through `dev` first.
3. **Pull from `dev` daily.** This is the single most important habit.
4. **Don't merge broken code to `dev`.** If your feature isn't working, keep it on your branch.
5. **Communicate before editing shared files.** Especially `predictionService.ts`, migrations, and route registrations.

### Commit Hygiene

- **One logical change per commit.** Don't mix a bug fix with a new feature in the same commit.
- **No secrets in commits.** Never commit `.env` files, API keys, or passwords.
- **No generated files.** Don't commit `node_modules/`, `dist/`, or build artifacts.
- **No massive files.** If a file is > 1MB, it probably doesn't belong in Git (use `.gitignore`).

### Branch Hygiene

- **Delete merged feature branches.** After a short-lived feature branch is merged to `dev`, delete it.
- **Keep long-lived branches synced.** If you use a personal branch (e.g., `marko`), pull from `dev` at least daily.
- **Don't let branches diverge for more than a week.** The longer you wait to merge, the harder it gets.

### What NOT to Do

| Don't                                          | Why                                         | Do Instead                            |
| ---------------------------------------------- | ------------------------------------------- | ------------------------------------- |
| `git push --force` to `dev` or `main`          | Destroys other people's work                | Use `--force-with-lease` on your own branch only |
| Commit directly to `main`                      | Bypasses review, breaks CI/CD               | Create PR from `dev`                  |
| Edit old migrations                            | Breaks checksum verification                | Create a new migration                |
| Merge `main` into a feature branch             | Creates confusing history                   | Merge `dev` into your branch          |
| Wait 2+ weeks to merge                         | Causes massive conflicts                    | Merge to `dev` at least weekly        |
| Resolve conflicts on `dev`                     | Puts risk on the shared branch              | Resolve conflicts on your branch first |

---

## 9. Common Scenarios

### Scenario: I need to start a new feature

```bash
# Option A: Branch from dev (recommended for short-lived work)
git checkout dev
git pull origin dev
git checkout -b feature/add-loan-export

# Option B: Use your existing personal branch
git checkout marko
git pull origin dev    # Get latest first
# Start working
```

### Scenario: Someone else's changes broke my branch

```bash
git checkout marko
git pull origin dev
# If there are conflicts, resolve them
# If their changes broke your code logically (not a git conflict),
# fix your code to work with the new state of dev
git add -A
git commit -m "adapt to new dashboard API changes from dev"
```

### Scenario: I need to undo my last commit

```bash
# Undo the last commit but keep the changes as unstaged files
git reset --soft HEAD~1

# Or, if you already pushed and need to revert on the remote
git revert HEAD
git push origin marko
```

### Scenario: I accidentally committed to the wrong branch

```bash
# You committed to dev instead of your branch
# First, save the commit hash
git log --oneline -1
# e.g., abc1234

# Undo the commit on dev (keep the changes)
git reset --soft HEAD~1

# Stash the changes
git stash

# Switch to your branch and apply
git checkout marko
git stash pop
git add -A
git commit -m "your commit message"
```

### Scenario: Two people created the same migration number

Developer A created `028_add_report_settings.sql` and merged to `dev`.
Developer B created `028_add_widget_table.sql` on their branch.

```bash
# Developer B needs to renumber their migration
git checkout my-branch
git pull origin dev
# Rename the file
mv server/migrations/tenant/028_add_widget_table.sql \
   server/migrations/tenant/029_add_widget_table.sql
git add -A
git commit -m "renumber migration 028->029 to avoid conflict with dev"
```

### Scenario: I need to cherry-pick a specific fix from someone's branch

```bash
# Find the commit hash on their branch
git log origin/chays --oneline -10

# Cherry-pick just that one commit
git cherry-pick abc1234
```

---

## 10. Emergency Fixes (Hotfixes)

If production is broken and you need an immediate fix:

```bash
# 1. Create a hotfix branch from main
git checkout main
git pull origin main
git checkout -b hotfix/fix-auth-crash

# 2. Make the minimal fix
# ... edit files ...
git add -A
git commit -m "fix: prevent auth crash when tenant pool is null"

# 3. Push and create PR directly to main
git push origin hotfix/fix-auth-crash
# Create PR: hotfix/fix-auth-crash -> main

# 4. After merging to main, also merge to dev so dev stays in sync
git checkout dev
git pull origin dev
git merge origin/main
git push origin dev
```

Hotfixes skip `dev` and go directly to `main` because the production environment is broken and needs an immediate fix. Always backport the fix to `dev` afterward.

---

## Quick Reference Card

```text
DAILY ROUTINE:
  git pull origin dev              Pull latest shared changes
  git add -A && git commit -m ""   Commit your work
  git push origin <branch>         Push to remote

BEFORE CREATING A PR:
  git pull origin dev              Sync with dev
  (resolve conflicts)              Fix any conflicts on YOUR branch
  git push origin <branch>         Push resolved state
  Create PR on Bitbucket           <branch> -> dev

WEEKLY:
  Merge your branch to dev         At least once a week
  Delete merged feature branches   Keep repo clean

NEVER:
  git push --force dev             Destroys team's work
  git push --force main            Destroys team's work
  Edit applied migration files     Breaks checksum system
  Commit .env or secrets           Security risk
```
