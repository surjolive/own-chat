# Installation guide

1. Install Node.js 20+ and pnpm.
2. Copy `.env.example` to `.env` and configure PostgreSQL, Redis, and a Super Admin username, email, and unique password (at least 12 characters). The server intentionally has no default signing keys or admin credentials.
3. Generate independent random values of at least 32 characters for `JWT_SECRET`, `COOKIE_SECRET`, and `SESSION_ENCRYPTION_KEY`; do not commit `.env`.
4. Start PostgreSQL and Redis with `docker compose -f infra/docker-compose.yml up -d`.
5. Run `pnpm install`, `pnpm db:generate`, and `pnpm db:migrate`.
6. Start the backend with `pnpm --dir apps/server dev` and the dashboard with `pnpm --dir apps/dashboard dev`.
7. Check `http://127.0.0.1:3000/health`. It returns ready only when PostgreSQL and Redis are connected.

On first server startup, the configured Super Admin is created in PostgreSQL with an Argon2id password hash. Repeated starts do not replace the existing password. New users register from the dashboard; login sessions are signed JWTs whose revocation state is stored in Redis.

WhatsApp QR login and message delivery stay unavailable until a real transport adapter is configured. The API returns `503` rather than reporting a simulated login or delivery as successful.

## Windows notes

The project is designed for local Windows machines and keeps traffic bound to localhost unless explicitly configured otherwise.
