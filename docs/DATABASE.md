# Database design

The Prisma schema defines tenant-aware models for users, WhatsApp accounts, sessions, AI provider configuration, conversations, messages, contact policies, approvals, and audit logs.

## Notable design choices

- Every user has an isolated tenant ID.
- Account ownership is enforced via foreign keys and runtime check logic.
- Session credentials are stored encrypted at rest and reference encrypted session files.
- Audit logs capture approval, login, and configuration changes.
