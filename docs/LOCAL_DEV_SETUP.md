# Cohi - Local Development Environment Setup (Windows)

Complete guide for new developers to get the Cohi platform running on a Windows machine.

## Table of Contents

- [Prerequisites](#prerequisites)
- [1. Install Core Tools](#1-install-core-tools)
- [2. Set Up SSH for Bitbucket](#2-set-up-ssh-for-bitbucket)
- [3. Clone the Repository](#3-clone-the-repository)
- [4. Install Docker Desktop](#4-install-docker-desktop)
- [5. Start the PostgreSQL Database](#5-start-the-postgresql-database)
- [6. Configure Environment Variables](#6-configure-environment-variables)
- [7. Install Dependencies](#7-install-dependencies)
- [8. Initialize the Database](#8-initialize-the-database)
- [9. Run the Application](#9-run-the-application)
- [10. AWS CLI & SSO Setup](#10-aws-cli--sso-setup)
- [11. Git Workflow & Branching](#11-git-workflow--branching)
- [12. Useful Commands Reference](#12-useful-commands-reference)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | **20.x** (LTS) | Runtime for frontend and backend |
| npm | Ships with Node | Package manager |
| Git for Windows | Latest | Version control |
| Docker Desktop | Latest | PostgreSQL database container |
| AWS CLI v2 | Latest | AWS services access (SSO, S3, ECS, etc.) |
| VS Code or Cursor | Latest | Recommended editor |

---

## 1. Install Core Tools

### Node.js 20

The project uses **Node 20** in CI (Bitbucket Pipelines) and Docker. Install via nvm-windows so you can switch versions easily.

1. Download the latest [nvm-windows installer](https://github.com/coreybutler/nvm-windows/releases) (`nvm-setup.exe`) and run it.
2. Close and reopen your PowerShell terminal, then:

```powershell
nvm install 20
nvm use 20
node --version   # should print v20.x.x
npm --version
```

### Git for Windows

1. Download from [git-scm.com](https://git-scm.com/download/win) and run the installer.
2. During installation, accept the defaults. Make sure **"Git from the command line and also from 3rd-party software"** is selected.
3. When asked about the default branch name, select **"Override the default branch name"** and set it to `main`.
4. For line ending conversions, select **"Checkout as-is, commit Unix-style line endings"** to avoid CRLF issues.

Verify in a new PowerShell terminal:

```powershell
git --version
```

### Configure Git Identity

```powershell
git config --global user.name "Your Name"
git config --global user.email "your-email@teraverde.com"
```

---

## 2. Set Up SSH for Bitbucket

The repository is hosted on Bitbucket at `git@bitbucket.org:teraverde/cohi.git`. You need an SSH key to push and pull.

### Generate an SSH Key

Open PowerShell and run:

```powershell
ssh-keygen -t ed25519 -C "your-email@teraverde.com"
```

Press Enter to accept the default file location (`C:\Users\<you>\.ssh\id_ed25519`). Set a passphrase if desired.

### Start the SSH Agent and Add Your Key

Run PowerShell **as Administrator** and enable the SSH agent service:

```powershell
Get-Service ssh-agent | Set-Service -StartupType Automatic
Start-Service ssh-agent
```

Then in a normal (non-admin) PowerShell:

```powershell
ssh-add "$env:USERPROFILE\.ssh\id_ed25519"
```

### Add the Public Key to Bitbucket

1. Copy the public key to your clipboard:

```powershell
Get-Content "$env:USERPROFILE\.ssh\id_ed25519.pub" | Set-Clipboard
```

2. Open [Bitbucket](https://bitbucket.org) in your browser.
3. Go to **Personal settings** (click your avatar, bottom-left) > **SSH keys** > **Add key**.
4. Paste the key and save.

### Test the Connection

```powershell
ssh -T git@bitbucket.org
```

You should see: `logged in as your-username. You can use git to connect to Bitbucket.`

---

## 3. Clone the Repository

```powershell
git clone git@bitbucket.org:teraverde/cohi.git
cd cohi
```

---

## 4. Install Docker Desktop

Docker runs the PostgreSQL database locally so you don't need to install Postgres natively.

### Install

1. Download [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop/).
2. Run the installer. When prompted, enable the **WSL 2 backend** (recommended over Hyper-V).
3. Restart your computer if asked.
4. Open Docker Desktop from the Start menu and wait for it to finish starting (the whale icon in the system tray should stop animating).

### Enable WSL 2 (if not already enabled)

Docker Desktop requires WSL 2. If the installer didn't set it up automatically, open PowerShell as Administrator:

```powershell
wsl --install
```

Restart your machine, then Docker Desktop should start normally.

### Verify

```powershell
docker --version
docker compose version
docker run hello-world
```

If you see "Hello from Docker!" you're good to go.

---

## 5. Start the PostgreSQL Database

From the project root:

```powershell
docker compose up -d postgres
```

This starts a PostgreSQL 15 container (with the [pgvector](https://github.com/pgvector/pgvector) extension for AI/RAG embedding features) named `coheus-postgres` with:

| Setting | Value |
|---------|-------|
| Host | `localhost` |
| Port | `5432` |
| Database | `coheus` |
| Username | `postgres` |
| Password | `postgres` |

**Verify it's running:**

```powershell
docker ps
```

You should see a container named `coheus-postgres` with status `Up` and port `0.0.0.0:5432->5432/tcp`.

**Useful Docker commands:**

```powershell
docker compose up -d postgres       # Start the database
docker compose stop postgres        # Stop (data preserved)
docker compose down                 # Stop and remove containers (data preserved in volume)
docker compose down -v              # Stop, remove containers AND delete all data
docker logs coheus-postgres         # View database logs
docker exec -it coheus-postgres psql -U postgres   # Open a psql shell
```

---

## 6. Configure Environment Variables

The project has two `.env` files: one for the frontend (root) and one for the backend (`server/`).

### Copy the Templates

```powershell
Copy-Item .env.example .env
Copy-Item server\.env.example server\.env
```

### Backend (`server\.env`) - Key Settings

Open `server\.env` in your editor and review these values. For basic local development, the database defaults already match the Docker container:

```env
# Database - these match the Docker container defaults
DB_HOST=localhost
DB_PORT=5432
DB_NAME=coheus
DB_USER=postgres
DB_PASSWORD=postgres

# JWT - change this to any random string (min 32 chars)
JWT_SECRET=your-jwt-secret-key-change-this-in-production

# AI Services - get keys from your team lead or the provider dashboards
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...

# App config
NODE_ENV=development
PORT=3001
FRONTEND_URL=http://localhost:5000

# Cognito SSO - get these values from your team lead
# For local dev with password auth enabled:
COGNITO_PASSWORD_AUTH=true
```

> **Note:** You don't need every API key to run the app. Features that require missing keys will gracefully degrade. At minimum, set the DB and JWT values to get the app booting.

### Frontend (`.env`) - Key Settings

The defaults in `.env.example` should work as-is for local development:

```env
VITE_API_URL=http://localhost:3001
VITE_WS_URL=ws://localhost:3001
```

---

## 7. Install Dependencies

From the project root, install both frontend and backend dependencies in one command:

```powershell
npm run install:all
```

This runs `npm install` in the root (frontend) and then `cd server && npm install` (backend).

---

## 8. Initialize the Database

The `init:local` script creates the management database, runs all migrations, provisions a test tenant, and seeds test user accounts.

```powershell
cd server
npm run init:local
```

This creates:

| Database | Purpose |
|----------|---------|
| `coheus_management` | Platform-level tables (tenants, super admins, subscriptions) |
| `tenant_acme_mortgage` | Test tenant database with sample data |

And these test accounts:

| Role | Username | Password |
|------|----------|----------|
| Super Admin | `superadmin` | `super123` |
| Tenant Admin | `admin@acme.local` | `admin123` |
| Loan Officer | `user@acme.local` | `user123` |

**Alternative** (PowerShell script, from project root):

```powershell
.\scripts\init-local-db.ps1
```

Go back to the project root when done:

```powershell
cd ..
```

---

## 9. Run the Application

You need **two terminals** running simultaneously: one for the backend and one for the frontend.

### Option A: Run Both at Once

```powershell
npm run dev:all
```

This uses `concurrently` to start both servers in a single terminal.

### Option B: Run Separately (Recommended for Debugging)

**Terminal 1 - Backend:**

```powershell
cd server
npm run dev
```

The backend starts on `http://localhost:3001` with hot-reload via `tsx watch`.

**Terminal 2 - Frontend (from project root):**

```powershell
npm run dev
```

The frontend Vite dev server starts on `http://localhost:5000` with HMR. It proxies `/api` and `/ws` requests to the backend automatically.

### Access the App

Open your browser to **http://localhost:5000** and log in with one of the test accounts from [Step 8](#8-initialize-the-database).

---

## 10. AWS CLI & SSO Setup

You need AWS access for certain features (S3 uploads, SES email, Cognito SSO, deploying to dev/prod environments, running remote migrations via ECS Exec).

### Install the AWS CLI v2

Download and run the official MSI installer: [AWS CLI v2 for Windows](https://awscli.amazonaws.com/AWSCLIV2.msi)

Or install via winget:

```powershell
winget install Amazon.AWSCLI
```

Close and reopen your terminal, then verify:

```powershell
aws --version
```

### Install the Session Manager Plugin

Required for ECS Exec (running commands inside deployed containers, e.g. remote migrations).

Download and run the installer from the [AWS docs](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html#install-plugin-windows).

Or if you have Chocolatey:

```powershell
choco install session-manager-plugin
```

### Configure AWS SSO

Ask your team lead for:
- The **AWS SSO start URL** (e.g. `https://teraverde.awsapps.com/start`)
- The **AWS region** (the project uses `us-east-2`)
- Your **SSO profile name** (e.g. `DevEnvPerms-339712788893`)

Then configure:

```powershell
aws configure sso
```

Follow the prompts:

```
SSO session name (Recommended): teraverde
SSO start URL: https://teraverde.awsapps.com/start
SSO region: us-east-2
SSO registration scopes [sso:account:access]:    (press Enter for default)
```

A browser window opens to authenticate. After completing the flow:

```
CLI default client Region: us-east-2
CLI default output format: json
CLI profile name: DevEnvPerms-339712788893
```

### Log In via SSO

Each time your session expires (typically 8-12 hours), re-authenticate:

```powershell
aws sso login --profile DevEnvPerms-339712788893
```

### Verify Access

```powershell
aws sts get-caller-identity --profile DevEnvPerms-339712788893
```

You should see your account ID and role ARN.

### Using the AWS Profile

When running AWS commands manually, always pass `--profile DevEnvPerms-339712788893`. The deploy scripts (`scripts\deploy\config.ps1`) set this automatically via `$env:AWS_PROFILE`.

---

## 11. Git Workflow & Branching

### Branch Strategy

| Branch | Purpose | Deploys To |
|--------|---------|------------|
| `main` | Production-ready code | Production (manual trigger in Bitbucket) |
| `dev` | Integration branch for testing | Dev environment (automatic on push) |
| `feature/*` | New features | PR validation only |
| `bugfix/*` | Bug fixes | PR validation only |
| `fix/*` | Quick fixes | PR validation only |

### Creating a Feature Branch

Always branch off `dev` for new work:

```powershell
git checkout dev
git pull origin dev
git checkout -b feature/COHI-123-short-description
```

The naming convention is `feature/COHI-<ticket-number>-<brief-description>`.

### Committing and Pushing

```powershell
git add .
git commit -m "COHI-123: Add the thing that does the stuff"
git push -u origin feature/COHI-123-short-description
```

The `-u` flag sets the upstream tracking branch so future pushes only need `git push`.

### Creating a Pull Request

1. Push your branch to Bitbucket.
2. Go to the [Bitbucket repo](https://bitbucket.org/teraverde/cohi) > **Pull Requests** > **Create pull request**.
3. Set the **destination** branch to `dev` (not `main`).
4. Add reviewers and a description.
5. The CI pipeline automatically runs build + unit tests + integration tests + E2E smoke tests on PRs targeting `dev` or `main`.

### Keeping Your Branch Up to Date

```powershell
git checkout dev
git pull origin dev
git checkout feature/COHI-123-short-description
git merge dev
# resolve any conflicts, then:
git push
```

### After Your PR is Merged

Clean up your local branch:

```powershell
git checkout dev
git pull origin dev
git branch -d feature/COHI-123-short-description
```

---

## 12. Useful Commands Reference

### Development

| Command | Location | Description |
|---------|----------|-------------|
| `npm run dev` | root | Start Vite frontend dev server (port 5000) |
| `npm run dev:backend` | root | Start backend dev server (port 3001) |
| `npm run dev:all` | root | Start both frontend and backend concurrently |
| `npm run lint` | root | Run ESLint |
| `npm run build:all` | root | Production build (backend then frontend) |

### Database & Migrations

| Command | Location | Description |
|---------|----------|-------------|
| `npm run init:local` | server | Full local DB setup (management + tenant + seeds) |
| `npm run migrate` | server | Run pending management migrations |
| `npm run migrate:status` | server | Show migration status |
| `npm run migrate:all` | server | Run migrations for all tenants |
| `npm run migrate:tenant -- acme-mortgage` | server | Run migrations for a specific tenant |
| `npm run migrate:create -- description` | server | Create a new migration file |
| `npm run seed:super-admin` | server | Create/reset the super admin account |
| `npm run seed:local` | server | Seed local development data |

### Testing

| Command | Location | Description |
|---------|----------|-------------|
| `npm run test:run` | root | Run frontend unit tests (Vitest) |
| `npm run test:run` | server | Run backend unit tests (Vitest) |
| `npm run test:integration` | server | Run backend integration tests (needs Postgres) |
| `npm run test:e2e:smoke` | root | Run Playwright smoke tests |
| `npm run test:e2e:ui` | root | Open Playwright test runner UI |

### Docker

| Command | Description |
|---------|-------------|
| `docker compose up -d postgres` | Start PostgreSQL |
| `docker compose stop` | Stop all containers |
| `docker compose down -v` | Remove containers and all data |
| `docker logs coheus-postgres` | View Postgres logs |
| `docker exec -it coheus-postgres psql -U postgres` | Open psql shell |

---

## Troubleshooting

### "ECONNREFUSED" on backend startup

The backend can't connect to PostgreSQL. Make sure the Docker container is running:

```powershell
docker compose up -d postgres
docker ps   # verify it's healthy
```

### IPv6 resolution issues

If you get connection errors pointing to `::1` instead of `127.0.0.1`, the backend config already handles this by rewriting `localhost` to `127.0.0.1`. If it still fails, set `DB_HOST=127.0.0.1` explicitly in `server\.env`.

### Port 5432 already in use

If you have a local PostgreSQL installation competing with the Docker container, either stop the local Postgres service or change the Docker port mapping. To stop a local Postgres Windows service:

```powershell
Stop-Service postgresql-x64-15   # service name may vary
```

### "Cannot find module" errors after pulling

If someone added new dependencies, reinstall:

```powershell
npm run install:all
```

### Database schema out of sync

If you see migration errors or missing tables after pulling new code:

```powershell
cd server
npm run migrate
npm run migrate:all   # for tenant databases
```

### Docker Desktop won't start

1. Make sure WSL 2 is installed. Open PowerShell as Administrator:

```powershell
wsl --install
```

2. Restart your machine.
3. Make sure **virtualization** is enabled in your BIOS/UEFI settings (Intel VT-x or AMD-V). This is usually under CPU or Advanced settings.
4. If you're on a corporate machine, check with IT that Hyper-V or Virtual Machine Platform features are enabled in **Turn Windows features on or off**.

### "Permission denied (publickey)" on git push

Your SSH key isn't configured correctly. Verify:

```powershell
ssh -T git@bitbucket.org
```

If it fails, check that the SSH agent is running and your key is added:

```powershell
Get-Service ssh-agent   # should show Running
ssh-add -l              # should list your key
```

If the agent isn't running, re-run the setup from [Step 2](#2-set-up-ssh-for-bitbucket).

### PowerShell script execution policy

If `.ps1` scripts fail with "running scripts is disabled on this system", run PowerShell as Administrator:

```powershell
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Resetting the local database completely

```powershell
docker compose down -v              # delete the volume
docker compose up -d postgres       # recreate the container
cd server
npm run init:local                  # re-initialize everything
```
