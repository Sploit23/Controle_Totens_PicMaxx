# Controle Maxx — Agent Guide

Single-server Node.js backend for photo kiosk management.

## Quick start
```bash
cp .env.example .env    # then edit if needed
npm install
npm run dev             # node --watch server.js (built-in, no nodemon)
npm start               # production
npm test                # node test-db.js (plain assertions, no test framework)
```

## Commands
- `npm run dev` — uses Node 18+ `--watch` flag
- `npm test` — creates/cleans temp SQLite DB `data/test-controle.db`; exits 1 on failure
- No lint, typecheck, or build step (plain JS, no TypeScript)

## Architecture
| File | Role |
|---|---|
| `server.js` | Entrypoint. Seeds initial user + test license on startup |
| `database.js` | SQLite singleton (better-sqlite3). Auto-creates/migrates tables. WAL mode |
| `ws-manager.js` | WebSocket server for real-time totem notification |
| `routes/totem.js` | Kiosk API: register, config, confirm/fail transactions |
| `routes/admin.js` | Admin dashboard (login via `ADMIN_USER`/`ADMIN_PASS` env vars) |
| `routes/client.js` | Client dashboard (login via `users` table, email+password) |

## Routes
- `/api/totem/*` — totem device endpoints
- `/admin/*` — admin panel
- `/client/*` — client panel
- `/` → redirects to `/admin`

## Database
- SQLite at `DB_PATH` (default `./data/controle.db`)
- Tables: `totems`, `codes`, `photos`, `transactions`, `config`, `users`, `licenses`
- Schema migrations use `ALTER TABLE ADD COLUMN` wrapped in try/catch (idempotent)
- Pricing hierarchy: totem-specific (`totem_{id}_key`) > user-level (`user_{id}_key`) > global (`key`)

## Seed behavior
On first startup, creates user `flavio@reveleagora.com.br` / `HCss221087` (plan `pro`) and test license `LIC-A1B2-C3D4-E5F6`. Orphan totems are auto-bound to this user.

## WebSocket
- Path: `/` (on same HTTP server)
- Totems register by sending `{"type":"register","totemId":"..."}`
- Server sends config reload via `{"type":"reloadConfig"}`

## Deploy
- Render via `render.yaml`: `npm install` → `node server.js`

## Conventions
- Portuguese code comments and variable names
- Pricing config keys: `preco_10x15`, `preco_10x15_bulk`, `preco_10x15_threshold`, similarly for `15x20`
- Session cookies: `sid` (admin), `client_sid` (client), httpOnly
- Request ID (`req.rid`) on every request via middleware
- Stale totem cutoff: 3 min (180s) without `last_seen`
