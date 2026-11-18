# Security notes

- Password hashing uses Argon2id.
- Authentication uses expiring HS256 JWTs with a 32-character minimum signing secret and Redis-backed revocation.
- Protected API routes require a valid Bearer token and an active PostgreSQL user; user ID headers are not accepted as authentication.
- Super Admin initialization requires explicit environment credentials and never creates a built-in default account.
- Secrets are protected via encryption helpers that use a SHA-256 derived key.
- Backend routes validate all input through Zod.
- Private credentials are not embedded in the dashboard or committed to Git.
- The app is intended for private local deployment and should remain behind localhost bound services.
- WhatsApp endpoints do not claim login or delivery until a real transport adapter is configured.
