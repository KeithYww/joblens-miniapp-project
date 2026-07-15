#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."
COMPOSE="docker compose --project-name deploy --env-file deploy/.env.production -f deploy/docker-compose.yml"

$COMPOSE config --quiet
$COMPOSE up -d --build --remove-orphans
$COMPOSE ps
