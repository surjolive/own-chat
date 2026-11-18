# API overview

The backend exposes a versioned REST API under `/api/v1`.

## Authentication

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`
- `POST /api/v1/auth/change-password`

## WhatsApp

- `GET /api/v1/whatsapp/accounts`
- `POST /api/v1/whatsapp/accounts`
- `POST /api/v1/whatsapp/accounts/:id/connect`
- `GET /api/v1/whatsapp/accounts/:id/status`
- `POST /api/v1/whatsapp/accounts/:id/disconnect`
- `DELETE /api/v1/whatsapp/accounts/:id/session`

## AI

- `GET /api/v1/ai/providers`
- `GET /api/v1/ai/models`
- `POST /api/v1/ai/test`
- `PATCH /api/v1/ai/settings`

The implementation is intentionally structured for future expansion and secure ownership enforcement.
