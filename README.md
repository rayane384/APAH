# APAH Ticket System

A Next.js internal ticket system for campus departments. Admins manage and route tickets; non-admin users (professors, delegates, club presidents) submit them.

---

## Table of Contents

- [Tech Stack](#tech-stack)
- [For the Project Owner (Before Pushing)](#for-the-project-owner-before-pushing)
- [For Collaborators — Getting Started](#for-collaborators--getting-started)
  - [Prerequisites](#prerequisites)
  - [1. Clone the Repository](#1-clone-the-repository)
  - [2. Install Dependencies](#2-install-dependencies)
  - [3. Set Up the Database](#3-set-up-the-database)
  - [4. Configure Environment Variables](#4-configure-environment-variables)
  - [5. Run Migrations and Generate Prisma Client](#5-run-migrations-and-generate-prisma-client)
  - [6. Seed the Database](#6-seed-the-database)
  - [7. Start the Dev Server](#7-start-the-dev-server)
- [Git & GitHub Crash Course](#git--github-crash-course)
  - [One-Time Setup](#one-time-setup)
  - [Daily Workflow](#daily-workflow)
  - [Branches](#branches)
  - [Pull Requests](#pull-requests)
  - [Resolving Merge Conflicts](#resolving-merge-conflicts)
  - [Common Git Commands Cheat Sheet](#common-git-commands-cheat-sheet)
- [Project Structure Overview](#project-structure-overview)
- [Test Accounts (from seed)](#test-accounts-from-seed)
- [API Conventions](#api-conventions)

---

## Tech Stack

| Layer       | Technology                          |
| ----------- | ----------------------------------- |
| Framework   | Next.js 16 (App Router, Turbopack) |
| Language    | TypeScript 5                        |
| Database    | PostgreSQL                          |
| ORM         | Prisma 7                            |
| Auth        | NextAuth v4 (Credentials)           |
| Styling     | Tailwind CSS 4 + custom CSS         |
| Runtime     | Node.js v20+ (tested on v24)        |

---

## READ THIS !!!!!!!!!!!!!!


### AI Experimental Workflow

If you'd rather let the AI collaborator prototype before agreeing on a final API, you can allow experimentation safely by following these guidelines:

- Work on a dedicated branch (e.g. `ai-experiments`) and push experimental changes there, not to `main`.
- Expose an explicit experimental endpoint such as `POST /api/ai/experimental` and clearly label it as experimental in code and docs.
- Feature-flag the experiment with an env var (e.g. `AI_EXPERIMENT=true`) and add placeholder keys to `.env.example`:

```env
OPENAI_API_KEY=""
AI_EXPERIMENT=true
```

- Ensure the experimental endpoint returns a safe mock/fallback when no API key is present so the app continues to work for other contributors.
- Use sandbox/test API keys for development; never commit production keys. Rotate or revoke shared keys after testing.
- Keep any schema/migration changes on the feature branch and include the migration files in the PR (so reviewers can inspect them).
- Document the experimental API shapes and any notable findings in the PR description or in `README.md` so others can reproduce and iterate.

When experiments are ready to be promoted:

- Open a PR from the experiment branch to `main` and request reviews.
- Agree on the final endpoint contract and DB changes, include migrations and tests in the PR, then merge.
- Remove or rename experimental routes/flags as part of the PR cleanup so `main` remains tidy.

This allows the AI collaborator to explore and iterate while keeping your primary branch stable.

### IF YOU CAN'T/ DON'T WANT TO DO THIS:
just work locally and i'll check with you.


## For Collaborators — Getting Started

### Prerequisites

Install these on your machine before anything else:

1. **Node.js v20 or later** — download from [nodejs.org](https://nodejs.org/)
   - After installing, verify: `node -v` and `npm -v`
2. **PostgreSQL** — download from [postgresql.org](https://www.postgresql.org/download/)
   - Remember the username, password, and port you set during installation (default port is `5432`)
3. **Git** — download from [git-scm.com](https://git-scm.com/downloads)
   - After installing, verify: `git --version`
4. **A code editor** — [VS Code](https://code.visualstudio.com/) is recommended

### 1. Clone the Repository

Open a terminal (PowerShell on Windows, Terminal on Mac/Linux) and run:

```bash
git clone https://github.com/OWNER/REPO_NAME.git
cd REPO_NAME
```

> Replace `OWNER/REPO_NAME` with the actual repository URL the project owner gave you.

### 2. Install Dependencies

```bash
npm install
```

This downloads all the packages listed in `package.json`. It may take a minute.

### 3. Set Up the Database

Open your PostgreSQL client (pgAdmin, psql, or any tool) and create a database:

```sql
CREATE DATABASE apahdb;
```

If you want a dedicated user (optional):

```sql
CREATE USER apah WITH PASSWORD 'your_password_here';
GRANT ALL PRIVILEGES ON DATABASE apahdb TO apah;
```

### 4. Configure Environment Variables

1. Copy the example file:
   ```bash
   cp .env.example .env
   ```
   On Windows PowerShell:
   ```powershell
   Copy-Item .env.example .env
   ```

2. Open `.env` and fill in your values:
   ```env
   DATABASE_URL="postgresql://apah:your_password_here@localhost:5432/apahdb?schema=public"
   NEXTAUTH_SECRET="any-random-string-you-want"
   NEXTAUTH_URL="http://localhost:3000"
   ```

> **Important:** Never commit your `.env` file. It's already in `.gitignore`.

### 5. Run Migrations and Generate Prisma Client

This creates all the database tables and generates the TypeScript client:

```bash
npx prisma migrate dev
```

If you see a prompt about data loss (only relevant on empty DBs), type `yes`.

After migration, the Prisma client will be auto-generated. If you ever need to regenerate it manually:

```bash
npx prisma generate
```

### 6. Seed the Database

This populates the database with test departments, users, and categories:

```bash
npx prisma db seed
```

### 7. Start the Dev Server

```bash
npm run dev -- --turbopack
```

Open [http://localhost:3000](http://localhost:3000) in your browser. You should see the login page.

> To stop the server, press `Ctrl + C` in the terminal.

---

## Git & GitHub Crash Course

If you've never used Git before, this section is for you.

### One-Time Setup

After installing Git, tell it who you are (use the email linked to your GitHub account):

```bash
git config --global user.name "Your Full Name"
git config --global user.email "your.email@example.com"
```

### Daily Workflow

Here's the routine you'll follow every time you make changes:

```
1. Pull the latest code    →  git pull origin main
2. Create a branch         →  git checkout -b my-feature
3. Make your changes       →  (edit files in VS Code)
4. Stage your changes      →  git add .
5. Commit                  →  git commit -m "describe what you changed"
6. Push your branch        →  git push origin my-feature
7. Open a Pull Request     →  (on GitHub website)
```

Let's break each step down.

### Branches

A **branch** is a separate copy of the code where you can work without affecting other people. Think of it like a draft.

```bash
# Create a new branch and switch to it
git checkout -b ai-classification

# See all branches
git branch

# Switch to an existing branch
git checkout main

# Switch back to your branch
git checkout ai-classification
```

**Rule:** Never commit directly to `main`. Always create a branch for your work.

### Pull Requests

When your feature is ready, you'll open a **Pull Request (PR)** on GitHub so the team can review your code before merging it into `main`.

1. Push your branch: `git push origin ai-classification`
2. Go to the repository on GitHub
3. You'll see a yellow banner: "ai-classification had recent pushes — **Compare & pull request**"
4. Click it, add a title and description of what you changed, and click **Create pull request**
5. Wait for your teammate to review. They might leave comments or request changes.
6. Once approved, click **Merge pull request**

### Resolving Merge Conflicts

Sometimes two people edit the same file. Git will tell you there's a **conflict**. Here's how to handle it:

```bash
# First, make sure you're on your branch
git checkout my-feature

# Pull the latest main into your branch
git pull origin main
```

If there's a conflict, Git will mark the file like this:

```
your version of the code
```

- Edit the file to keep the correct version (remove the `<<<<<<<`, `=======`, `>>>>>>>` markers)
- Then:

```bash
git add .
git commit -m "resolve merge conflict"
git push origin my-feature
```

### Common Git Commands Cheat Sheet

| Command                        | What it does                             |
| ------------------------------ | ---------------------------------------- |
| `git status`                   | See what files have changed              |
| `git add .`                    | Stage all changes for commit             |
| `git commit -m "message"`      | Save a snapshot with a description       |
| `git push origin branch-name`  | Upload your branch to GitHub             |
| `git pull origin main`         | Download the latest `main` branch        |
| `git checkout -b new-branch`   | Create and switch to a new branch        |
| `git checkout branch-name`     | Switch to an existing branch             |
| `git log --oneline`            | View commit history (compact)            |
| `git diff`                     | See what changed (before staging)        |
| `git stash`                    | Temporarily save uncommitted changes     |
| `git stash pop`                | Restore stashed changes                  |

---

## Project Structure Overview

```
my-app/
├── app/                        # Next.js App Router
│   ├── api/                    # API routes (REST endpoints)
│   │   ├── auth/               # NextAuth authentication
│   │   ├── tickets/            # Ticket CRUD + actions (pick, route, status)
│   │   ├── departments/        # Department listing
│   │   └── me/                 # Current user info
│   ├── dashboard/              # Admin & user dashboard pages
│   │   ├── page.tsx            # Dashboard home (stats)
│   │   └── tickets/            # Ticket list & detail pages
│   ├── components/             # Shared React components
│   ├── generated/prisma/       # Auto-generated Prisma client (do NOT edit)
│   ├── lib/                    # Shared utilities (prisma client, auth helpers)
│   ├── globals.css             # Global styles + design system
│   ├── layout.tsx              # Root layout
│   └── page.tsx                # Login page
├── prisma/
│   ├── schema.prisma           # Database schema (models, enums, relations)
│   ├── migrations/             # Migration history (SQL files)
│   ├── seed.ts                 # Database seed script
│   └── seed.cjs                # Alternative CJS seed script
├── src/types/                  # TypeScript type declarations
├── auth.ts                     # NextAuth configuration
├── prisma.config.ts            # Prisma configuration (engine, datasource)
├── next.config.ts              # Next.js configuration
├── package.json                # Dependencies and scripts
└── .env                        # Environment variables (not committed)
```

**Key files to know:**

- **`prisma/schema.prisma`** — The single source of truth for database structure. If you add a field or table, edit this file and run `npx prisma migrate dev --name your_change`.
- **`app/api/`** — All backend logic lives here as Next.js Route Handlers.
- **`app/dashboard/`** — All frontend pages (React components).
- **`app/generated/prisma/`** — Auto-generated. Do NOT edit manually. It's in `.gitignore`.

---

## Test Accounts (from seed)

After seeding, these accounts are available:

### Admin Accounts (password for all: `AdminPass123!`)

| Email                        | Department             |
| ---------------------------- | ---------------------- |
| admin-it@example.com         | IT Support             |
| admin-it2@example.com        | IT Support             |
| admin-fac@example.com        | Facilities             |
| admin-fac2@example.com       | Facilities             |
| admin-adm@example.com        | Administration         |
| admin-adm2@example.com       | Administration         |
| admin-resv@example.com       | Reservation            |
| admin-resv2@example.com      | Reservation            |
| admin-triage@example.com     | Escalation / Triage    |
| admin-triage2@example.com    | Escalation / Triage    |

### Non-Admin Accounts

| Email                  | Password           | Profile         |
| ---------------------- | ------------------ | --------------- |
| prof@example.com       | ProfPass123!       | Professor       |
| delegue@example.com    | DelegatePass123!   | Delegate        |
| club@example.com       | ClubPass123!       | Club President  |

---

## API Conventions

When adding new API routes, follow these patterns already used in the project:

- **Location:** `app/api/your-feature/route.ts`
- **Auth check:** Always call `getCurrentUser()` from `app/lib/auth-helpers.ts` at the top of every handler
- **Response format:** Return JSON via `NextResponse.json(data)` or `NextResponse.json({ error: "..." }, { status: 4xx })`
- **Database access:** Import `prisma` from `app/lib/prisma.ts`
- **Admin check:** Use `isAdmin(user)` from `app/lib/auth-helpers.ts`

Example skeleton for a new endpoint:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../lib/prisma";
import { getCurrentUser, isAdmin } from "../../lib/auth-helpers";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  // ... your logic here ...

  return NextResponse.json({ success: true });
}
```
