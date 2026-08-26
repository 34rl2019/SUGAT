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
DATABASE_URL=postgresql://sugat_app:URL_ENCODED_PASSWORD@127.0.0.1:5432/sugat
REDIS_URL=redis://127.0.0.1:6379/2
JWT_ACCESS_SECRET=FIRST_UNIQUE_SECRET
JWT_REFRESH_SECRET=SECOND_UNIQUE_SECRET
CORS_ORIGINS=https://sugata.online,https://www.sugata.online,https://admin.sugata.online
```

Do not commit `.env`. URL-encode special characters in the database password.

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

```bash
cd /var/www/sugat
git status --short
git pull --ff-only
mkdir -p /var/backups/sugat
sudo -u postgres pg_dump --format=custom --file=/var/backups/sugat/sugat-$(date +%F-%H%M%S).dump sugat
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @sugat/api prisma generate
corepack pnpm --filter @sugat/api prisma migrate deploy
corepack pnpm --filter @sugat/api build
corepack pnpm --filter @sugat/passenger-web build
corepack pnpm --filter @sugat/admin-web build
corepack pnpm --filter @sugat/api test
pm2 reload deploy/ecosystem.config.cjs --env production --only sugat-api --update-env
sudo nginx -t
sudo systemctl reload nginx
```

Database migrations run before the process reload and must remain backward-compatible with the currently running API. Back up the database before schema-changing releases.

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
