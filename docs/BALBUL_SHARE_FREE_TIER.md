# BalBul Share — free-tier guardrails

## Chosen hosting path

Use the existing Supabase project `okdckmorwoihndvzmhsx` and its existing Auth, Postgres, Realtime, and Storage services. Do not provision Cloudflare R2 for the initial release: R2's usage allowance is generous, but enabling R2 can require a billing profile/payment method, which violates the current no-card requirement.

No Cloudflare account, paid add-on, custom domain, or payment method is required for this Supabase-only path.

## Hard limits for the first release

- Maximum file size: **25 MiB** per file (enforced by the private Storage bucket and database checks).
- Maximum share lifetime: **24 hours** (enforced by the share-session table).
- Storage bucket: private `balbul-share-private`.
- Storage object path: `{user_id}/{share_id}/{safe_file_name}`.
- Download links: opaque random bearer token; database stores only its SHA-256 hash.
- Friend-delivery token: encrypted ciphertext only; encryption key belongs in Supabase Edge Function secrets, never in Git.
- Public bucket access is forbidden. Download must go through a server-side token validation endpoint and a short-lived signed URL.
- Expired/cancelled sessions must be rejected server-side and their objects removed by cleanup logic.

## Free-tier budget

The Supabase Free plan currently lists 1 GB Storage, 5 GB egress, 500 MB database size, 500,000 Edge Function invocations, and 2 million Realtime messages per month. The application-level 25 MiB limit is intentionally below the plan's documented 50 MB upload ceiling. The quota is shared with the rest of this BalBul project, so usage must be monitored; exceeding included quotas or changing plans is not part of this implementation.

Free projects can pause after a week of low activity. No paid plan will be enabled automatically.

## Secrets

Store any future secrets only in Supabase Edge Function secrets (for example, `BALBUL_SHARE_TOKEN_ENCRYPTION_KEY`) or the relevant provider's secret manager. Never commit R2 keys, Worker tokens, service-role keys, encryption keys, or bearer tokens.

## Database isolation

The migration creates only `balbul_share_sessions`, `balbul_share_deliveries`, a private Storage bucket, and policies scoped to those new resources. It does not alter `profiles`, `messages`, `friendships`, `tasks`, or any `push_*` table.
