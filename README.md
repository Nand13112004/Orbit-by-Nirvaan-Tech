# Nirvaan Portal

Orbit by Nirvaan Tech is a role-based business workspace built as a pnpm monorepo with a Next.js/TypeScript frontend, NestJS REST API, and MongoDB Atlas persistence through Prisma. The API is the authority for identity, authorization, lead visibility, and mutations.

## Requirements

- Node.js 20.9 or later
- pnpm 10
- MongoDB Atlas (replica-set deployment)

## Local setup

1. Install dependencies from the repository root:
 
   ```sh
   pnpm install
   ```

2. Create a MongoDB Atlas database and configure the backend environment:

   ```sh
   Copy-Item .env.example apps/api/.env
   ```

   Edit `apps/api/.env` and set `MONGODB_URI`, a random `SESSION_SECRET` of at least 32 characters, and the three initial account names, emails, and strong passwords. Use unique passwords of at least 16 characters, with upper- and lowercase letters, a number, and a symbol. Do not reuse the example addresses or passwords in production.

   The environment file is backend-only and excluded from Git. Never put database credentials, session secrets, or initial passwords in `apps/web`, `NEXT_PUBLIC_*` variables, source control, or client responses. `APP_ORIGIN` must exactly match the browser origin (locally `http://localhost:3000`). Use `APP_ORIGINS` only for additional, exact origins. Keep `TRUST_PROXY_HOPS=0` for direct local development.

3. Generate the Prisma client and apply the MongoDB schema:

   ```sh
   pnpm db:generate
   pnpm db:push
   ```

   MongoDB uses Prisma `db push`; PostgreSQL SQL migrations remain in the repository as historical records and are not used by the Atlas application.

4. Explicitly initialize the initial accounts once per environment:

   ```sh
   pnpm db:seed
   ```

   Seeding is not run by application startup. It validates all required values before creating accounts, uses Argon2id, refuses placeholder/weak/duplicate credentials, and does not change an existing user's password. A newly seeded Team Member is attached to the initial Manager. If a configured email already exists with another role, the seed stops and requires an administrator to resolve the conflict.

5. Start the frontend and API:

   ```sh
   pnpm dev
   ```

   Open `http://localhost:3000`. The API listens at `http://localhost:4000/api`. In development, the frontend talks directly to that local API.

## Accounts and access

- **Admin:** all leads and analytics; user creation/management, lead sources, settings, and password resets.
- **Manager:** leads assigned to their direct team members; can create and assign leads to those members; can see team users and team follow-ups/analytics. Cannot manage users, change roles, or manage Admin accounts.
- **Team Member:** only assigned leads; can create leads, update lead data/status, add notes, and schedule follow-ups. Cannot manage users or permissions.

The leads table loads 25 records at a time and supports server-side search, status filtering, and sorting. Dashboard queries reuse recent results briefly, and expensive charts are split into a separate frontend chunk.

Performance diagnostics are available without changing business data: the API emits structured `http_response` and `controller_response` timing records, and exposes controller time in the `Server-Timing` header. Prisma logs client-observed database durations in development and flags queries taking at least 100 ms in every environment. The browser console and dashboard's development-only panel show frontend API and controller timings. Analytics uses role-scoped Prisma aggregates; lead search, filtering, sorting, and pagination use Prisma queries. MongoDB relations are represented by string IDs and enforced by Prisma's relation handling rather than PostgreSQL foreign keys.

## Moving existing PostgreSQL data to Atlas

The PostgreSQL database is left intact. Use an empty, dedicated Atlas database for the copy. Set `POSTGRES_SOURCE_URL` to the existing PostgreSQL URI and `MONGODB_URI` to the Atlas URI in the backend environment; keep both values private. Pause application writes for the copy and cutover window so the imported collections represent one consistent source snapshot.

```sh
pnpm db:push
pnpm db:migrate:data -- --target-db=<Atlas database name>
```

The copy tool checks the target name and refuses to import into non-empty application collections. It copies users (including password hashes), leads, follow-ups, notes, sources, settings, and audit records in batches, then verifies collection counts. It does not delete or modify PostgreSQL data. Existing PostgreSQL sessions are intentionally not copied; users will sign in again after cutover. Configure `MONGODB_URI` before starting the API. The app creates the TTL index for expiring MongoDB sessions on startup.

There is no public registration. User roles and lead visibility are checked by the API from the authenticated database user, never from a client-supplied role. Only Admin can create accounts; account creation makes Managers or Members. An active Admin can explicitly promote an existing account to Admin or change another Admin's role/status through the audited user-management endpoint; self role/status changes are blocked, and at least one active Admin must remain. Password resets are Admin-only and revoke the target user's sessions. Users can change their own passwords; changing a password signs out the current session.

## Security and production deployment

- Provision the database and app environment variables through the deployment platform's secret manager. Keep `.env` files out of images, frontend build contexts, logs, artifacts, and Git.
- Use a unique random `SESSION_SECRET` with at least 32 characters. Use HTTPS in production; production session and CSRF cookies are Secure and HttpOnly where applicable.
- The Vercel frontend proxies `/api/*` to the Northflank API. This keeps browser requests same-origin so the `SameSite=Lax` session and CSRF cookies work without exposing the API host in client-side configuration.
- Run `pnpm db:generate` during build and `pnpm db:push` when provisioning the Atlas schema. Run `pnpm db:seed` explicitly only during initial provisioning (or for a new environment), not on every restart.
- Use individual, unique, administrator-selected passwords for all initial accounts. Transfer them through a secure channel, rotate them after provisioning, and never write them to logs or source control. The seed checks for configured password uniqueness but does not print credentials.
- Keep database backups and apply the hosting provider's least-privilege access controls. Review `AuditLog` for administrative and authentication events.

## Deploying to Vercel and Northflank

The web app is deployed on Vercel and the API as a Docker service on Northflank. Use a MongoDB Atlas replica-set database reachable from Northflank. Prefer a custom domain on the Vercel frontend; the API does not need a browser-facing public URL because Vercel proxies its requests.
Create the Vercel project/domain first (or choose its expected `*.vercel.app` origin) so it can be set as the API's allowed origin.

### 1. Deploy the API to Northflank

Create a Northflank service from this repository using the Dockerfile build option:

- Build context: repository root.
- Dockerfile path: `apps/api/Dockerfile`.
- Container port: `4000` (or use the `PORT` assigned by Northflank).
- Health check: HTTP `GET /api/ready`; the endpoint returns healthy only when MongoDB responds. The container's built-in liveness check uses `/api/health`.

Set these service variables in Northflank (keep secrets in its secret manager):

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `APP_ORIGIN` | Exact public Vercel frontend origin, e.g. `https://orbit.example.com` (no path or trailing slash). |
| `APP_ORIGINS` | Optional comma-separated list of additional exact HTTPS frontend origins. |
| `MONGODB_URI` | Private Atlas connection string for the production database. |
| `SESSION_SECRET` | Unique random secret, at least 32 characters. |
| `TRUST_PROXY_HOPS` | Exact number of trusted proxies in Northflank's request chain; verify the platform's forwarded headers. |
| `PORT` | Omit if Northflank supplies it; otherwise set to the configured container port. |

Allow Northflank to connect to the Atlas cluster using the narrowest available network access rules. Do not copy the development `.env` or its database into production.

### 2. Provision production data once

Before accepting traffic, use a trusted workstation or one-off provisioning job with production-only environment variables to apply the Prisma MongoDB schema and create initial accounts:

```sh
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:push
pnpm db:seed
```

Provide `MONGODB_URI` and the initial account values securely to that process. Do not put initial account passwords in the long-running Northflank service unless needed for a controlled re-seed. Keep `db:push` and `db:seed` out of the API startup command.

### 3. Deploy the frontend to Vercel

Import the same repository into Vercel and configure:

- Root Directory: `apps/web` (leave “Include files outside the Root Directory” enabled so pnpm can use the workspace lockfile).
- Framework preset: Next.js.
- `API_PROXY_TARGET`: the HTTPS **origin only** of the Northflank service, e.g. `https://orbit-api.example.com`. Do not include `/api`, a path, credentials, query, or trailing slash.

Set `API_PROXY_TARGET` for each Vercel environment you deploy. The app builds fail-fast in production if it is missing or invalid. Do not set `NEXT_PUBLIC_API_URL`: production browser requests use the same-origin `/api` route, and Next.js rewrites it to Northflank.

Set `APP_ORIGIN` in Northflank to the exact Vercel production/custom-domain origin. Add any fixed preview origin to `APP_ORIGINS`; do not allow arbitrary origins. Configure DNS and HTTPS for custom domains on their respective platforms.

After deployment, verify `https://<your-vercel-domain>/api/ready` returns `{"status":"ok"}` and confirm login, refresh, and logout work. The readiness endpoint checks MongoDB connectivity. Review Northflank logs and Vercel build logs if either deployment fails.

## Useful commands

```sh
pnpm dev
pnpm build
pnpm db:generate
pnpm db:push
pnpm db:migrate:data -- --target-db=<Atlas database name>
pnpm db:seed
```

The initial app uses a modular REST API. Optional GraphQL, WebSockets, Valkey, and BullMQ infrastructure is intentionally not required for the core portal.
