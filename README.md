<div align="center">

# Slice of Heaven

### *Pizzeria Noir*

**Orders · Kitchen · Service**

A full-stack dine-in pizzeria platform — self-ordering at the table, live kitchen ops, executive analytics, and an AI assistant that knows your menu.

*Digital App by SliceMatic*

<br />

[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3FCF8E?style=for-the-badge&logo=supabase&logoColor=white)](https://supabase.com/)
[![Gemini](https://img.shields.io/badge/Gemini-AI-8E75B2?style=for-the-badge&logo=google&logoColor=white)](https://ai.google.dev/)

</div>

---

## Why Slice of Heaven?

Modern dine-in service shouldn't mean juggling paper tickets, shouting across the kitchen, and guessing what's selling. **Slice of Heaven** brings the entire flow — from table QR to paid order — into one polished, dark-themed experience built for real pizzeria operations.

| For guests | For the kitchen | For leadership |
|------------|-----------------|----------------|
| Build custom pizza combos | Live order queue with stage timers | Revenue, pipeline & table analytics |
| Scan table QR to order instantly | One-click status pipeline | AI + data-driven recommendations |
| Track orders by ID or phone | QR generator for every table | Menu, staff & customer management |
| Voice-order via AI assistant | Bill & Pay (Cash / Card / UPI) | Exportable order logs & reports |

> **Staff gate:** Customers can place orders only while a staff or admin member is signed in — keeping service hours intentional and the kitchen in control.

---

## Highlights

### Dine-in customer experience
- **Combo builder** — choose crust base, pizzas (up to 10 per order), and toppings with live bill preview (GST, bulk discounts).
- **Table QR deep links** — `?table=3` pre-selects the table and shows active orders for that seat.
- **Customer lookup** — find accounts by mobile or email; name and phone required, email optional.
- **Order history** — verify status by order ID, phone, or email.

### Kitchen & front-of-house
- **Visual order queue** — filter by Confirmed → Preparing → Ready → Ready to Bill → Delivered / Cancelled with live counts.
- **Performance timers** — queue time, cooking time, and serve cycle on every ticket.
- **Combo-grouped line items** — orders displayed as readable combos, not flat SKU lists.
- **Table QR generator** — share ordering links per table.

### Admin control room
- **Analytics dashboard** — gross sales (delivered orders), pipeline value, hourly sales, popular items, staff prep times, payment mix.
- **Orders registry** — searchable table of all orders with formatted text export (mirrors `order_log.txt`).
- **Recommendations** — analytics engine + **Gemini AI** insights: peak days/hours, table preferences, trending pizzas, staff learning opportunities, cancellation patterns — each with estimated impact on delivery time, satisfaction, and revenue.
- **Menu management** — CRUD, bulk CSV/JSON upload, startup import from `input_data/`.
- **User management** — invite staff/admin by email (Resend or Supabase password reset).
- **Store settings** — bulk discount rules, GST %, currency.

### AI assistant (Gemini)
- **Support chat** — answers policy, billing, and order-status questions using the synced app-help knowledge base.
- **Voice ordering** — browser speech-to-text feeds the same chat agent; builds cart, validates customers, places orders hands-free.
- **Customer verification** — secure lookup before sharing order details in chat.

---

## Order lifecycle

```
Customer places order
        ↓
   Confirmed ──→ Preparing ──→ Ready ──→ Mark Served ──→ Bill & Pay ──→ Delivered
        │
        └── Cancel (while Confirmed only)
```

Revenue in Analytics counts only **Delivered** (paid) orders. Completed deliveries append to `output/order_log.txt` in local dev.

---

## Tech stack

| Layer | Technology |
|-------|------------|
| UI | React 19, TypeScript, Tailwind CSS 4, Lucide, Recharts |
| Build | Vite 6 (client) · esbuild (server bundle) |
| API | Express 4 · shared validation & billing in `src/lib/` |
| Database & auth | Supabase (PostgreSQL + Auth for staff/admin) |
| AI | Google Gemini (`gemini-3.5-flash`) via `@google/genai` |
| Voice | Web Speech API (Chrome / Edge) |
| Email (optional) | Resend for staff welcome emails |
| Deploy | Vercel (static UI + serverless `/api/*`) |

Architecture details: [`design/architecture.md`](design/architecture.md)

---

## Quick start

**Prerequisites:** Node.js 18+, a [Supabase](https://supabase.com/) project, and a [Gemini API key](https://ai.google.dev/).

```bash
# 1. Install dependencies
npm install

# 2. Configure environment (copy and edit)
cp .env.example .env

# 3. Run dev server (Vite HMR + Express API on port 3000)
npm run dev
```

Open **http://localhost:3000** in Chrome or Edge.

| Script | Purpose |
|--------|---------|
| `npm run dev` | Development — Vite middleware + Express API |
| `npm run build` | Production build → `dist/` (UI + `server.cjs`) |
| `npm start` | Serve production build locally |
| `npm run lint` | TypeScript check |

---

## Environment variables

Create a `.env` file in the project root:

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | Yes* | Powers Support Chat, voice ordering, and AI recommendations |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_ANON_KEY` | Yes | Public anon key (browser auth) |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-side data access (never expose to client) |
| `RESEND_API_KEY` | No | Send staff invite emails with temporary passwords |
| `STAFF_EMAIL_FROM` | No | Sender address for staff emails (with Resend) |
| `APP_URL` | No | Public app URL for links and callbacks |

\*App runs without Gemini in limited mode; chat and AI recommendations will be unavailable.

See [`.env.example`](.env.example) for a template.

---

## Roles at a glance

| Role | Tab | Access |
|------|-----|--------|
| **Customer** | Dine-In Customer | Order, history (when staff signed in) |
| **Staff** | Staff Kitchen | Queue, status updates, billing, QR codes |
| **Admin** | Admin Analytics | Everything staff has + analytics, orders export, recommendations, menu, users, settings |
| **All logged-in** | Assistant | Support chat + voice ordering |
| **Everyone** | Help | In-app guide and FAQ |

First admin account must be provisioned in Supabase; subsequent users are invited via **Admin → User Management**.

---

## Deployment (Vercel)

```bash
npm run build
```

Vercel serves static assets from `dist/` and routes `/api/*` to the bundled Express handler (`api/index.js` → `dist/server.cjs`). Set all environment variables in the Vercel project dashboard.

> **Note:** Order log files (`output/order_log.txt`) are written only in local/long-running server mode — Supabase remains the source of truth in serverless.

---

## Project structure

```
pizzeria/
├── src/
│   ├── App.tsx                 # Role router & global shell
│   ├── components/             # OrderingFlow, StaffDashboard, AdminDashboard, Chatbot…
│   ├── lib/                    # dbService, orderFormat, adminRecommendations, voiceOrderEngine
│   └── hooks/                  # useSpeechRecognition
├── server.ts                   # Express API + Gemini + Supabase
├── input_data/                 # Menu CSV/JSON for startup import
├── design/architecture.md      # System design & diagrams
├── docs/app-help.md            # User guide (synced to AI knowledge base)
└── public/                     # favicon, static assets
```

---

## Voice ordering tips

Voice input uses the **browser Web Speech API** — it requires:

- Chrome or Edge (not all embedded IDE previews support it)
- `localhost` or HTTPS
- Microphone permission granted for the site

If the mic shows “Listening” but nothing submits, ensure you're on a supported browser and tap **Stop** after speaking; the transcript is sent when recording ends.

---

## Documentation

| Doc | Contents |
|-----|----------|
| [`design/architecture.md`](design/architecture.md) | Architecture, data model, API overview, deployment |
| [`docs/app-help.md`](docs/app-help.md) | End-user guide for customers, staff, and admins |
| In-app **Help** tab | Rendered copy of the app-help guide |

---

<div align="center">

**Slice of Heaven Pizzeria Ltd.** · © 2026 · Digital App by SliceMatic

*Built with care for the table, the kitchen, and the bottom line.*

</div>
