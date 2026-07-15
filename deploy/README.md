# Isolated China production deployment

This directory deploys the China production stack independently from the
Vercel/Render stack. Caddy serves the React app and proxies `/api` to Fastify.
Its PostgreSQL, Redis, quotas, caches, tokens, feedback, and reports are isolated
from the global production environment.

## Before the first deploy

1. Buy an Ubuntu 22.04 or 24.04 instance with at least 2 vCPU, 2 GB RAM,
   and a public IPv4 address. Open TCP ports `80` and `443` in the Lighthouse firewall.
2. The production workflow uses a free, short-lived Let's Encrypt IP certificate.
   Set `SITE_ADDRESS` to the public IP, `PUBLIC_ORIGIN=https://SERVER_IP`, and
   `TLS_MODE=ip`. The certificate must already exist under
   `/opt/joblens/certbot/live/SERVER_IP`; `renew-ip-certificate.sh` renews it daily.
3. Install Docker Engine and the Docker Compose plugin on the instance.
4. Clone the repository and switch to `main`.
5. Copy the secret template and restrict it:

   ```sh
   cp deploy/.env.production.example deploy/.env.production
   chmod 600 deploy/.env.production
   openssl rand -hex 24
   ```

6. Put the generated value in `POSTGRES_PASSWORD`, generate independent admin,
   monitoring and backup tokens, and configure exactly one AI provider. Do not
   reuse the global production database, Redis URL, or operational tokens.

## Deploy and verify

```sh
chmod +x deploy/deploy.sh deploy/backup-postgres.sh
./deploy/deploy.sh
curl --fail https://your-domain.example/api/health
docker compose --env-file deploy/.env.production -f deploy/docker-compose.yml logs --tail=100 backend
```

The first backend startup runs `prisma migrate deploy` before accepting traffic.
Never commit `deploy/.env.production`, database dumps, or provider keys.

For an IP-only deployment set `CAPTCHA_MODE=disabled` and leave both Turnstile
keys empty. Production bypass is intentionally unsupported; hard visitor, IP,
daily-credit and concurrency limits remain active.

## Backups

Create a daily cron entry that stores a 14-day rolling local PostgreSQL backup:

```cron
17 3 * * * cd /opt/joblens && ./deploy/backup-postgres.sh >> /var/log/joblens-backup.log 2>&1
```

For recovery from server loss, copy the generated `backups/*.dump` files to a private
object-storage bucket. Periodically verify restoration in a non-production database.

## Automated updating

After CI succeeds on `main`, `.github/workflows/deploy-production.yml` packages the
exact tested commit, creates a database backup, deploys it through a pinned SSH
host key, and verifies both frontend and backend versions. The release is accepted
only when China and global production report the same commit SHA.

The server stores immutable releases under `/opt/joblens/releases`, secrets in
`/opt/joblens/shared/.env.production`, and local backups in
`/opt/joblens/backups`. Do not deploy a local working tree with `tar` or `git stash`.
