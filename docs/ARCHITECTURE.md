# Architecture overview

The platform is split into a React dashboard frontend and a Fastify backend. Shared models and security helpers are isolated into workspace packages to keep tenant boundaries and encryption logic explicit.

## Key modules

- `apps/server`: REST API and authentication routes
- `apps/dashboard`: tenant dashboard shell with stats and navigation
- `packages/whatsapp-engine`: adapter replacement point for Baileys/cloud API providers
- `packages/ai-engine`: OmniRoute and Ollama provider adapters
- `packages/security`: password hashing and value encryption
- `packages/database`: Prisma schema for tenant-aware data modeling

## Tenant isolation

Every authenticated user gets a `tenantId`, and the backend enforces ownership checks before exposing account, message, session, or AI settings. This is intended to prevent cross-tenant access even when a user is authenticated to the same application run.
