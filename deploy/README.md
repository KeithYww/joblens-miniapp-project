# Lighthouse production deployment

This directory deploys JobLens as one HTTPS site: Caddy serves the built React app
and proxies `/api` to Fastify. PostgreSQL and Redis stay on the private Docker
network and are never exposed through server ports.

## Before the first deploy

1. Buy an Ubuntu 22.04 or 24.04 Lighthouse instance with at least 2 vCPU, 2 GB RAM,
   and a public IPv4 address. Open TCP ports `80` and `443` in the Lighthouse firewall.
2. Point the production domain's `A` record at the instance public IPv4 address.
   For a China mainland instance, complete ICP filing before opening the domain.
3. Install Docker Engine and the Docker Compose plugin on the instance.
4. Clone the repository and switch to `main`.
5. Copy the secret template and restrict it:

   ```sh
   cp deploy/.env.production.example deploy/.env.production
   chmod 600 deploy/.env.production
   openssl rand -hex 24
   ```

6. Put the generated value in `POSTGRES_PASSWORD`, then fill the domain, ACME email,
   Turnstile keys, and exactly one enabled AI provider key.

## Deploy and verify

```sh
chmod +x deploy/deploy.sh deploy/backup-postgres.sh
./deploy/deploy.sh
curl --fail https://your-domain.example/api/health
docker compose --env-file deploy/.env.production -f deploy/docker-compose.yml logs --tail=100 backend
```

The first backend startup runs `prisma migrate deploy` before accepting traffic.
Never commit `deploy/.env.production`, database dumps, or provider keys.

## Backups

Create a daily cron entry that stores a 14-day rolling local PostgreSQL backup:

```cron
17 3 * * * cd /opt/joblens && ./deploy/backup-postgres.sh >> /var/log/joblens-backup.log 2>&1
```

For recovery from server loss, copy the generated `backups/*.dump` files to a private
object-storage bucket. Periodically verify restoration in a non-production database.

## Updating

```sh
git pull --ff-only origin main
./deploy/deploy.sh
```
