# Slice of Heaven Pizzeria — Developer & Deployment Setup

Technical guide for installing, configuring, and running the application. For day-to-day use by staff, admins, and customers, see **`docs/app-help.md`** (shown in the **Help** tab and used by the support chatbot).

---

## Prerequisites

- Node.js 18+ and npm
- A [Supabase](https://supabase.com) project with required tables (`profiles`, `customers`, `menu_items`, `orders`, `order_items`, `table_info`, `app_settings`, etc.)
- Optional: [Gemini API key](https://ai.google.dev/) for the support chatbot
- Optional: [Resend](https://resend.com) for staff credential emails

---

## Run locally

```bash
npm install
cp .env.example .env   # then fill in secrets
npm run dev            # Express + Vite on http://localhost:3000
```

- Use **`npm run dev`** (not Vite alone) so API routes and hot reload work together.
- Restart the dev server after changing **`server.ts`** or environment variables.
- Production: `npm run build` then `npm start`.

---

## Environment variables

Configure in `.env` or your hosting secrets panel:

| Variable | Required | Purpose |
|----------|----------|---------|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_ANON_KEY` | Yes | Browser auth (public) |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server API (never expose to browsers) |
| `GEMINI_API_KEY` | For chat | AI support chatbot |
| `SUPABASE_REDIRECT_URL` | Optional | Staff return URL after invite links |
| `APP_URL` | Optional | Public app URL for emails and links |
| `RESEND_API_KEY` | Optional | Send staff temporary passwords |
| `STAFF_EMAIL_FROM` | With Resend | Sender address for staff emails |

---

## First admin account

The **first admin** cannot be created from the app UI. Create them once in:

**Supabase Dashboard → Authentication → Users**

Link the user to `profiles` with `role = admin`. After that, all other staff and admins are invited from **Admin → User Management**.

---

## Menu data (`input_data/`)

On server startup, menu items are imported from semicolon-separated text files (CSV fallback if `.txt` is missing):

| File | Category | Format |
|------|----------|--------|
| `Types_of_Base.txt` | Bases / crusts | `code;name;price` |
| `Types_of_Pizza.txt` | Pizzas | `code;name;price` |
| `Types_of_Toppings.txt` | Toppings | `code;name;price` |

**Example:** `P1;Margherita;299`

- Delimiter: **semicolon (`;`)** — comma also supported  
- Optional header row: `code;name;price_inr`  
- Fallback files: `bases.csv`, `pizzas.csv`, `toppings.csv`  

If import has errors, the app still starts. Fix files and use **Admin → Pizza & Master Menu → Reload input_data**, or bulk upload via the Admin UI.

Requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

---

## Order log

Completed (paid) orders append formatted blocks to:

**`output/order_log.txt`**

The `output/` folder is created on server start. The file is created on first delivery.

---

## Help doc & chatbot knowledge base

- **`docs/app-help.md`** — functional guide for staff, admin, and customers (Help tab + chatbot).
- On startup, the server syncs `app-help.md` → **`km.txt`** for the chatbot.
- Edit `app-help.md` and restart the server to refresh chat answers.
- Chatbot uploads to `km.txt` are temporary until the next restart (when `app-help.md` is synced again).

---

## Email & authentication (Supabase)

- **Staff invites:** configure `RESEND_API_KEY` + `STAFF_EMAIL_FROM`, or rely on Supabase Auth password-reset emails.
- **Supabase SMTP:** Authentication → Email Templates for invite/reset delivery.
- Staff must change password on first login when using temporary credentials.

---

## Troubleshooting

| Issue | Action |
|-------|--------|
| API returns HTML instead of JSON | Run `npm run dev`, not `vite` alone |
| HMR / 404 on `/src/*` | Restart dev server; hard-refresh browser |
| Chatbot: Gemini key missing | Set `GEMINI_API_KEY` and restart |
| Menu import failed at startup | Fix `input_data/` files; use Admin → Reload input_data |
| Port 3000 in use | Stop the existing Node process, then `npm run dev` |
