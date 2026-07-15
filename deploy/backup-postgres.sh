#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."
set -a
. deploy/.env.production
set +a

mkdir -p backups
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
docker compose --project-name deploy --env-file deploy/.env.production -f deploy/docker-compose.yml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom > "backups/joblens-${timestamp}.dump"
find backups -type f -name 'joblens-*.dump' -mtime +14 -delete
