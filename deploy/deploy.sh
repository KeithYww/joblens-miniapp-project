#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."
docker compose --env-file deploy/.env.production -f deploy/docker-compose.yml up -d --build --remove-orphans
docker compose --env-file deploy/.env.production -f deploy/docker-compose.yml ps
