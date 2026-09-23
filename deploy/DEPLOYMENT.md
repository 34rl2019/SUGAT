# SUGAT production deployment — Hostinger Ubuntu VPS

This runbook installs SUGAT under `/var/www/sugat` without modifying or restarting unrelated PM2 processes or Nginx sites. Replace placeholders before running commands. Inspect existing ports first.

## DNS

Create these `A` records pointing to the existing VPS IPv4 address (`VPS_IPV4`):

| Host | Type | Value |
|---|---|---|
| `@` | A | `VPS_IPV4` |
| `www` | A | `VPS_IPV4` |
| `api` | A | `VPS_IPV4` |
| `admin` | A | `VPS_IPV4` |

## Packages

```bash
sudo apt update
sudo apt install -y git curl nginx postgresql postgresql-contrib postgis redis-server certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo corepack enable
sudo npm install -g pm2
node --version
corepack pnpm --version
psql --version
redis-server --version
nginx -v
```

If the VPS already has Node, PostgreSQL, Redis, Nginx, or PM2, inspect their versions/configuration and do not replace a working shared installation blindly.

## PostgreSQL/PostGIS

Open PostgreSQL as its administrative OS user:

```bash
sudo -u postgres psql
```

Run the following SQL, replacing `GENERATE_A_LONG_DATABASE_PASSWORD`:

```sql
CREATE ROLE sugat_app LOGIN PASSWORD 'GENERATE_A_LONG_DATABASE_PASSWORD';
CREATE DATABASE sugat OWNER sugat_app;
\connect sugat
CREATE EXTENSION IF NOT EXISTS postgis;
GRANT CONNECT ON DATABASE sugat TO sugat_app;
GRANT USAGE, CREATE ON SCHEMA public TO sugat_app;
ALTER SCHEMA public OWNER TO sugat_app;
\q
```

Verify:

```bash
sudo -u postgres psql -d sugat -c 'SELECT PostGIS_Version();'
sudo -u postgres psql -d sugat -c '\dn+'
```

## Redis

SUGAT uses Redis logical database 2 by default and never flushes shared Redis data:

```bash
sudo systemctl enable --now redis-server
redis-cli -n 2 ping
```

Expected response: `PONG`. If shared Redis requires authentication/TLS, use the corresponding credentialed `REDIS_URL`. Do not expose port 6379 publicly. If Redis is temporarily unavailable, the API logs the failure and uses single-process Socket.IO; restart only `sugat-api` after Redis returns to restore cross-process pub/sub.

## Clone and environment

```bash
sudo mkdir -p /var/www/sugat /var/log/sugat
sudo chown -R "$USER":"$USER" /var/www/sugat /var/log/sugat
git clone GITHUB_REPOSITORY_URL /var/www/sugat
cd /var/www/sugat
cp .env.example .env
chmod 600 .env
```

Edit `.env`. Generate independent JWT secrets, for example:

```bash
openssl rand -base64 48
openssl rand -base64 48
nano /var/www/sugat/.env
```

The production values must include:

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=5002
DATABASE_URL=postgresql://sugat_app:URL_ENCODED_PASSWORD@127.0.0.1:5432/sugat?options=-c%20timezone%3DUTC
REDIS_URL=redis://127.0.0.1:6379/2
JWT_ACCESS_SECRET=FIRST_UNIQUE_SECRET
JWT_REFRESH_SECRET=SECOND_UNIQUE_SECRET
CORS_ORIGINS=https://sugata.online,https://www.sugata.online,https://admin.sugata.online
```

Do not commit `.env`. URL-encode special characters in the database password.

### Required UTC database sessions

SUGAT stores Prisma `DateTime` values in PostgreSQL `timestamp(3)` columns as UTC.
Every API database session must use `TimeZone=UTC`, including new/replacement pool
connections. `PrismaService` appends the PostgreSQL startup option `-c timezone=UTC`
to its connection URL, overriding conflicting timezone options while preserving
other connection settings. It verifies the actual session on startup; a mismatch
prevents startup. `/readiness` also verifies UTC and fails if it is not confirmed.
`/health` alone is not a database readiness check.

Use the documented direct PostgreSQL connection. A connection proxy that drops
startup options or substitutes differently configured transaction sessions is not
validated. Do not issue `SET TIME ZONE` to a non-UTC zone on application connections.
Setting only the operating-system/Node `TZ` variable is insufficient.

For Prisma CLI, seed/import scripts and maintenance connections that do not use
`PrismaService`, include `options=-c%20timezone%3DUTC` in `DATABASE_URL` (use `&` if
other query parameters already exist). The same option can be present in the API
URL. Alternatively, an authorized DBA can set UTC defaults for the application
role/database; reconnect existing sessions afterward. Keep UTC defaults as defense
in depth. Do not change any production setting as part of local validation.

Before accepting staging, verify `/readiness` returns success from each API instance
and execute `SHOW TimeZone;` through the actual maintenance connection; it must return
`UTC`. Run the GPS timestamp regression against isolated PostgreSQL with a non-UTC
default (`apps/api/scripts/utc-release-gate.ts`) before promotion. ISO timestamps keep
their existing UTC `Z` contract; no schema migration or date display change is needed.
Previously shifted records are not automatically repaired; investigate any suspected
historical corruption separately with authoritative evidence and a reviewed backup.

Create the private verification-evidence directory before starting the API. It
must be owned by the account that runs `sugat-api`, must not be below either
Nginx web root, and must not be served by an Nginx `location` block:

```bash
sudo install -d -m 0700 -o "$USER" -g "$USER" /var/lib/sugat/private/driver-verification
sudo test "$(stat -c '%a' /var/lib/sugat/private/driver-verification)" = 700
```

The upload contract is exactly three documents (`licenseFront`, `licenseBack`,
and `selfie`), JPEG/PNG/PDF only, at most 5 MiB per file. Nginx limits the total
multipart request to 16 MiB. Stored files are created with mode `0600`. Treat
this directory as sensitive personal data: encrypt and access-control backups,
define a reviewed retention period, and test restoration separately. Never copy
its contents into `apps/*/public`, `apps/*/dist`, or another web-served path.

## Install, migrate, and build

```bash
cd /var/www/sugat
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @sugat/api prisma generate
corepack pnpm --filter @sugat/api prisma migrate deploy
corepack pnpm --filter @sugat/api build
corepack pnpm --filter @sugat/passenger-web build
corepack pnpm --filter @sugat/admin-web build
corepack pnpm --filter @sugat/api prisma migrate status
```

Never use `prisma db push` in production. The initial migration is intended for a new SUGAT database. If an earlier SUGAT migration was already applied anywhere, stop and reconcile migration history before deployment.

## PM2

```bash
cd /var/www/sugat
pm2 start deploy/ecosystem.config.cjs --env production --only sugat-api
pm2 status sugat-api
pm2 logs sugat-api --lines 100
pm2 save
pm2 startup
```

Run the command printed by `pm2 startup`, then run `pm2 save` again. Never use `pm2 restart all` or `pm2 delete all`.

## Nginx

```bash
sudo cp /var/www/sugat/deploy/nginx/sugat.conf /etc/nginx/sites-available/sugat.conf
sudo ln -s /etc/nginx/sites-available/sugat.conf /etc/nginx/sites-enabled/sugat.conf
sudo nginx -t
sudo systemctl reload nginx
```

This is a separate site file and does not replace BotPilot or any default/existing site. If the symlink already exists, inspect it rather than forcing replacement.

## HTTPS

Only after all four DNS names resolve to the VPS:

```bash
dig +short sugata.online
dig +short www.sugata.online
dig +short api.sugata.online
dig +short admin.sugata.online
sudo certbot --nginx -d sugata.online -d www.sugata.online -d api.sugata.online -d admin.sugata.online
sudo certbot renew --dry-run
```

Certbot edits only matching SUGAT server blocks. Review `sudo nginx -T` before and after issuance.

## Safe updates

The VPS must have a clean, understood working tree before any update. Never pull over local production modifications. If `git status --short` prints anything, stop, inspect the changes, and preserve/reconcile them in the local repository and GitHub before continuing.

```bash
cd /var/www/sugat
git status --short
git fetch origin
git log --oneline --decorate HEAD..origin/main
git diff --stat HEAD..origin/main
git diff --name-status HEAD..origin/main
git merge --ff-only origin/main
```

Inspect the fetched commits and changed-file lists before running the fast-forward merge. Do not use `git reset --hard`, `git clean -fd`, or `git stash pop` as an automatic workaround for a dirty production tree. Emergency VPS hotfixes must be reproduced locally and committed to GitHub before the next deployment.

After the safe update, run only the commands required by the changed files:

```bash
# Run only when package manifests or the lockfile changed.
corepack pnpm install --frozen-lockfile

# Passenger Web changes only.
corepack pnpm --filter @sugat/passenger-web build

# Admin Web changes only.
corepack pnpm --filter @sugat/admin-web build

# API changes only. Restart no other PM2 process.
corepack pnpm --filter @sugat/api test
corepack pnpm --filter @sugat/api build
pm2 reload deploy/ecosystem.config.cjs --env production --only sugat-api --update-env

# Nginx configuration changes only.
sudo nginx -t
sudo systemctl reload nginx
```

For a reviewed backward-compatible database expansion, perform the backup and
migration as a separate controlled operation before reloading the API:

```bash
mkdir -p /var/backups/sugat
sudo -u postgres pg_dump --format=custom --file=/var/backups/sugat/sugat-$(date +%F-%H%M%S).dump sugat
corepack pnpm --filter @sugat/api prisma generate
corepack pnpm --filter @sugat/api prisma migrate deploy
corepack pnpm --filter @sugat/api prisma migrate status
```

Database migrations run before the process reload and must remain backward-compatible with the currently running API. Back up the database before schema-changing releases.

### GPS expand → application deploy → contract

The GPS minimization rollout is deliberately split. Never copy the deferred
contract SQL into Prisma's active migration directory during the expand deploy.

1. **Expand:** back up PostgreSQL and run `prisma migrate deploy`. Migration
   `202608290002_gps_location_expand` adds `GpsIngestionEvent`, retains
   `TripLocationHistory`, and adds the vehicle foreign key as `NOT VALID`. The
   currently running legacy API remains compatible and may continue writing its
   history table.
2. **Application deploy:** generate Prisma Client, build, and reload only
   `sugat-api`. Confirm new GPS events update `VehicleCurrentLocation` and
   `GpsIngestionEvent`, and observe logs/health before proceeding.
3. **Read-only preflight:** run the following queries. Every count must be zero:

```sql
SELECT count(*) AS orphaned_trip_ids
FROM "VehicleCurrentLocation" l
LEFT JOIN "trips" t ON t."id" = l."tripId"
WHERE t."id" IS NULL;

SELECT count(*) AS orphaned_vehicle_ids
FROM "VehicleCurrentLocation" l
LEFT JOIN "Vehicle" v ON v."id" = l."vehicleId"
WHERE v."id" IS NULL;

SELECT count(*) AS trip_vehicle_mismatches
FROM "VehicleCurrentLocation" l
JOIN "trips" t ON t."id" = l."tripId"
WHERE l."vehicleId" <> t."vehicleId";

SELECT count(*) - count(DISTINCT "tripId") AS duplicate_trip_locations
FROM "VehicleCurrentLocation";
```

Stop if any result is non-zero. Preserve and reconcile the records explicitly;
do not delete or rewrite production data automatically.

4. **Contract:** after a separate approval and fresh backup, promote the reviewed
   SQL in `deploy/migrations/deferred/202608290003_gps_history_contract.sql` to a
   new Prisma migration. It validates the foreign key and drops the legacy raw
   history table. Deploy that migration only while every running API version no
   longer depends on `TripLocationHistory`.

## Verification

```bash
curl -fsS http://127.0.0.1:5002/health
curl -fsS http://127.0.0.1:5002/readiness
curl -I https://sugata.online
curl -I https://admin.sugata.online
curl -fsS https://api.sugata.online/health
curl -fsS https://api.sugata.online/readiness
pm2 status sugat-api
pm2 logs sugat-api --lines 100 --nostream
redis-cli -n 2 ping
sudo nginx -t
sudo ss -ltnp | grep 5002
```

The final command must show the API bound to `127.0.0.1:5002`, not `0.0.0.0:5002`.
