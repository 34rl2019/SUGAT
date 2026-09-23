# SUGAT Repository Instructions

These instructions apply to every task in this repository.

## Product language and copy

- Production user-facing UI is English-only across Passenger Web, Passenger Mobile, Driver Mobile, Admin Web, and Admin Mobile.
- Do not introduce Cebuano, Bisaya, Tagalog, mixed-language copy, slang, awkward literal translations, or competing marketing taglines unless a localization system is explicitly requested.
- Use concise professional transportation language. The official tagline is `WHERE JOURNEYS MEET`.
- Before completing UI work, audit modified and nearby user-facing strings for unintended non-English text, including accessibility labels, notifications, validation, dialogs, loading, empty, and error states.

## UI and branding

- Preserve the simple, modern, compact transportation-focused interface and the navy, gold, white, and neutral-gray palette. Gold is primarily an accent.
- Do not render the retained non-transparent raster logo. Use the current text-based `SUGAT` branding until an approved transparent production asset is supplied.
- Do not add photorealistic AI/stock hero imagery, giant promotional layouts, excessive branding, gold-filled inputs, fake maps, or decorative artwork that competes with functional UI.
- Real data, real map components, status, search, tracking, and operational controls take priority. Lightweight code-native vector/geometric illustration is acceptable only when useful and non-dominant.

## Data and functionality

- Never add hardcoded fake production vehicles, drivers, routes, stops, ETAs, GPS coordinates, schedules, statistics, or trips. Development/test fixtures must remain clearly isolated from production.
- Preserve authentication, passenger search, stop selection, trip discovery, realtime tracking, Driver GPS, trip lifecycle, Admin operations, API contracts, Socket.IO, Redis, PostgreSQL/PostGIS, Prisma, and mobile behavior unless the task explicitly changes them.

## Development and deployment workflow

- The authoritative workflow is `Local development → test/review → Git commit → GitHub → safe VPS deployment`.
- The local repository is the development source; GitHub `main` is the version-controlled deployment source; the VPS is a runtime/deployment environment, not the normal development workspace.
- Do not recommend routine direct source editing on the VPS. An emergency VPS hotfix must be reproduced locally, tested, committed, and pushed before the next deployment.
- Before production updates, run `git status --short`, then `git fetch origin`, and inspect incoming commits/files. Never pull over a modified VPS tree; stop and preserve/reconcile VPS-only work first.
- Never automatically use `git reset --hard`, `git clean -fd`, or `git stash pop` to resolve production state.
- Protect production `.env`, credentials, JWT/Redis/API secrets, signing material, Nginx configuration, PM2 configuration, and other server-specific state. Never commit or expose secrets.
- Deploy only affected applications. Never use `pm2 restart all` for SUGAT deployment.

## Database safety

- Never run `prisma migrate reset`, `prisma db push`, database recreation, or destructive development commands against production.
- Use reviewed deployment migrations. Back up production before significant schema changes and treat migrations as a separate controlled operation.

## Completion checks

- Run the relevant tests, typechecks, and builds for every affected application. Do not claim completion while an affected check fails.
- Do not change unrelated working behavior merely to silence unrelated warnings.

See [docs/ENGINEERING_STANDARDS.md](docs/ENGINEERING_STANDARDS.md) for the project-facing version of these standards and [deploy/DEPLOYMENT.md](deploy/DEPLOYMENT.md) for production procedures.
