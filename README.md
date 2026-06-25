# UniFlow Portal

Graduation project for the Faculty of Computers and Data Science (FCDS), Alexandria University.

A multi-role college portal — student, professor, TA, student affairs, and admin — with course registration, attendance, payments, course content, gradebook, real-time chatroom, and a Mistral-powered regulations chatbot.

> ### MVP scope
> This is an MVP. The **Student** and **Professor** dashboards are backed by the
> full backend (auth, registration, attendance, course content, gradebook,
> chatbot, etc.) — sign in with a real account to use them.
>
> The **TA, Student Affairs, Admin, Financial, and IT** dashboards are front-end
> **UI previews** populated with static sample data — there is no backend behind
> them. Open any of them from the **"Preview a dashboard"** buttons on the
> sign-in screen (no login required).

## Stack

- **Frontend** — React 19 + TypeScript + Tailwind 3 + Capacitor (Android/iOS)
- **Backend** — Express × 10 services + Prisma + PostgreSQL + Socket.io
- **Chatbot** — Mistral AI (`mistral-small-latest`) + BM25 RAG over the FCDS regulations corpus
- **Auth** — JWT + bcryptjs

## Quick Start

```bash
# 1. Clone
git clone https://github.com/El-Howera/uniflow-portal.git
cd uniflow-portal

# 2. Configure
cp .env.example .env
#   Fill in DATABASE_URL, JWT_SECRET, MISTRAL_API_KEY, SMTP_USER/PASS

# 3. Install
npm install                       # backend deps + tooling
npm --prefix frontend install     # CRA + frontend deps

# 4. Database — sync the schema straight to the DB (no migration files)
npx prisma db push                # creates the tables + Prisma client from schema.prisma

# 5. Run
npm run dev                       # frontend on :3000 + 10 backend services
```

## Repo Layout

| Path | Purpose |
|---|---|
| `frontend/` | React app — pages by role, components, context, utils |
| `backend/servers/<name>/` | Each Express service |
| `backend/lib/` | Shared Prisma client, auth middleware, error helpers |
| `backend/prisma/schema.prisma` | Database schema |
| `backend/corpus/` | Mistral RAG corpus (regulations) |
| `shared/config.ts` | API URL resolver — single source of port config |

## License

Educational use — graduation project at Alexandria University.
