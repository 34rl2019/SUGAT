# SUGAT Engineering Standards

These conventions are permanent project policy for current and future SUGAT development.

## English-only production UI

All user-facing production text must be natural, professional English. This includes every client’s navigation, labels, buttons, placeholders, help text, authentication, onboarding, search and results, tracking, statuses, validation, notifications, accessibility labels, loading, empty, error, dialog, modal, header, and footer copy.

Do not introduce Cebuano, Bisaya, Tagalog, mixed-language strings, slang, awkward literal translations, or additional promotional taglines unless an explicit localization project defines that behavior. The official tagline is **WHERE JOURNEYS MEET**. Prefer concise copy such as “Where are you going?”, “Find a Ride”, “View Live”, “Next Stop”, “No rides found”, “Waiting for GPS”, “Start Trip”, and “Complete Trip”.

Every UI change must include a pre-completion language audit of the modified screen and nearby existing copy.

## Development source of truth

```text
Local development
        ↓
Test and review
        ↓
Git commit
        ↓
GitHub main
        ↓
Safe VPS deployment
```

The local repository is the primary development workspace. GitHub `main` is the version-controlled deployment source. The VPS is a deployment/runtime environment, not the normal development workspace.

Do not routinely edit application source on the VPS. If a genuine emergency requires a direct production hotfix, reproduce or transfer the same change into the local repository, test it, commit it, and push it to GitHub. Reconcile all VPS-only modifications before the next deployment so production never permanently diverges from version control.

Before deploying:

1. Run `git status --short` on the VPS.
2. Stop if the working tree contains modifications. Inspect and preserve any VPS-only work.
3. Run `git fetch origin`.
4. Inspect incoming commits and changed files before updating.
5. Use only a safe fast-forward update after the tree is confirmed clean.

Never blindly use `git pull`, `git reset --hard`, `git clean -fd`, or `git stash pop` over production changes.

## Production safety

Never overwrite, expose, or commit production configuration or secrets, including `.env`, database credentials, JWT secrets, Redis/API secrets, signing credentials, mobile signing configuration, Nginx configuration, or PM2 production configuration.

Deploy only what changed:

- Passenger Web change: build Passenger Web only.
- Admin Web change: build Admin Web only.
- API change: test/build the API and restart only `sugat-api` when required.
- Mobile change: typecheck/test and create only the relevant mobile build.
- Schema change: review and apply it as a separate controlled migration operation.

Never use `pm2 restart all` for a SUGAT-only deployment.

## Database safety

Never run `prisma migrate reset`, `prisma db push`, database deletion/recreation, or other destructive development commands against production. Use reviewed deployment migrations and create a production backup before significant schema changes.

## Real data and functional integrity

Production UI must use real API/application data. Never fabricate vehicles, drivers, routes, stops, ETAs, distances, GPS coordinates, schedules, active trips, passenger counts, or statistics to make a screen appear populated. Fixtures belong only in clearly isolated development or test environments.

UI, copy, branding, and visual changes must preserve authentication, passenger ride search, stop selection, trip discovery, live maps and tracking, Socket.IO events, Driver GPS and offline sync, trip lifecycle, Admin operations, Redis, PostgreSQL/PostGIS, Prisma, mobile applications, and existing API contracts.

## Visual standard

SUGAT interfaces remain simple, modern, clean, professional, and transportation-focused. Use dark navy, gold/amber accents, white, and neutral grays. Do not return to giant cinematic heroes, photorealistic AI/stock people or vehicles, fake maps, excessive branding, giant typography, gold-filled inputs, or advertisement-style layouts.

The retained raster logo is not rendered because it lacks a production-ready transparent background. Use clean text-based `SUGAT` branding, with `WHERE JOURNEYS MEET` only where appropriate, until an approved transparent PNG or SVG is supplied. Do not invent or redraw the logo.

Real data, maps, status, search, and controls remain visually primary. Small code-native vector/geometric illustrations may support empty, unavailable, onboarding, or completion states, but must remain lightweight and non-dominant. Any animation must be subtle and respect reduced-motion preferences.

## Definition of done

Run relevant tests, typechecks, and builds for affected applications. Fix failures caused by the change and never claim completion while an affected validation is failing. Do not modify unrelated behavior merely to suppress unrelated warnings.
