#!/usr/bin/env sh
set -eu

: "${DEPLOY_SHA:?DEPLOY_SHA is required}"
: "${ARCHIVE_PATH:?ARCHIVE_PATH is required}"
: "${PUBLIC_ORIGIN:?PUBLIC_ORIGIN is required}"

ROOT_DIR=${ROOT_DIR:-/opt/joblens}
RELEASES_DIR="$ROOT_DIR/releases"
SHARED_DIR="$ROOT_DIR/shared"
BACKUP_DIR="$ROOT_DIR/backups"
RELEASE_DIR="$RELEASES_DIR/$DEPLOY_SHA"
ENV_FILE="$SHARED_DIR/.env.production"
CURRENT_LINK="$ROOT_DIR/current"
PREVIOUS_RELEASE=$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)

sudo mkdir -p "$RELEASES_DIR" "$SHARED_DIR" "$BACKUP_DIR"
sudo chown -R "$(id -u):$(id -g)" "$RELEASES_DIR" "$SHARED_DIR" "$BACKUP_DIR"

if [ ! -f "$ENV_FILE" ]; then
  if [ -f "$ROOT_DIR/deploy/.env.production" ]; then
    cp "$ROOT_DIR/deploy/.env.production" "$ENV_FILE"
  elif [ -f "$ROOT_DIR/deploy/.env" ]; then
    cp "$ROOT_DIR/deploy/.env" "$ENV_FILE"
  else
    echo "No production environment file is available." >&2
    exit 1
  fi
  chmod 600 "$ENV_FILE"
fi

upsert_env() {
  key=$1
  value=$2
  tmp=$(mktemp)
  awk -F= -v key="$key" '$1 != key { print }' "$ENV_FILE" > "$tmp"
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  cat "$tmp" > "$ENV_FILE"
  rm -f "$tmp"
}

upsert_env PUBLIC_ORIGIN "$PUBLIC_ORIGIN"
upsert_env SITE_ADDRESS "${SITE_ADDRESS:-:80}"
upsert_env CAPTCHA_MODE "${CAPTCHA_MODE:-disabled}"
upsert_env TLS_MODE "${TLS_MODE:-http}"

if [ "${TLS_MODE:-http}" = 'ip' ]; then
  CERTBOT_DIR=${CERTBOT_DIR:-$ROOT_DIR/certbot}
  upsert_env CERTBOT_DIR "$CERTBOT_DIR"
  upsert_env CADDY_CONFIG_FILE 'Caddyfile.https'
  sudo test -r "$CERTBOT_DIR/live/${SITE_ADDRESS}/fullchain.pem"
  sudo test -r "$CERTBOT_DIR/live/${SITE_ADDRESS}/privkey.pem"
else
  upsert_env CADDY_CONFIG_FILE 'Caddyfile'
fi

for required in POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD AI_PROVIDER MONITORING_TOKEN BACKUP_TOKEN ADMIN_TOKEN; do
  value=$(sed -n "s/^${required}=//p" "$ENV_FILE" | tail -1)
  if [ -z "$value" ] || printf '%s' "$value" | grep -qi 'placeholder'; then
    echo "$required must contain a non-placeholder value." >&2
    exit 1
  fi
done

set -a
. "$ENV_FILE"
set +a

if sudo docker ps --format '{{.Names}}' | grep -qx 'deploy-postgres-1'; then
  timestamp=$(date -u +%Y%m%dT%H%M%SZ)
  sudo docker exec deploy-postgres-1 pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom \
    > "$BACKUP_DIR/joblens-${timestamp}-${DEPLOY_SHA}.dump"
fi

rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"
tar xzf "$ARCHIVE_PATH" -C "$RELEASE_DIR"

compose() {
  BUILD_SHA="$DEPLOY_SHA" sudo -E docker compose --project-name deploy \
    --env-file "$ENV_FILE" -f "$RELEASE_DIR/deploy/docker-compose.yml" "$@"
}

rollback() {
  if [ -z "$PREVIOUS_RELEASE" ] || [ ! -f "$PREVIOUS_RELEASE/deploy/docker-compose.yml" ]; then
    return
  fi
  previous_sha=$(basename "$PREVIOUS_RELEASE")
  echo "Rolling back containers to $previous_sha." >&2
  BUILD_SHA="$previous_sha" sudo -E docker compose --project-name deploy \
    --env-file "$ENV_FILE" -f "$PREVIOUS_RELEASE/deploy/docker-compose.yml" \
    up -d --no-build --remove-orphans || true
}

compose config --quiet
compose build
compose up -d --remove-orphans

healthy=false
for _ in $(seq 1 60); do
  health=$(curl --silent --show-error --max-time 10 "$PUBLIC_ORIGIN/api/health" || true)
  version=$(printf '%s' "$health" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')
  status=$(printf '%s' "$health" | sed -n 's/.*"status":"\([^"]*\)".*/\1/p')
  if [ "$status" = 'ok' ] && [ "$version" = "$DEPLOY_SHA" ]; then
    healthy=true
    break
  fi
  sleep 5
done

if [ "$healthy" != 'true' ]; then
  compose logs --tail=150 backend web >&2 || true
  rollback
  echo "China deployment did not become healthy for $DEPLOY_SHA." >&2
  exit 1
fi

ln -sfn "$RELEASE_DIR" "$CURRENT_LINK"
if [ "${TLS_MODE:-http}" = 'ip' ]; then
  printf '%s\n' '17 3 * * * root /opt/joblens/current/deploy/renew-ip-certificate.sh >> /var/log/joblens-certbot.log 2>&1' \
    | sudo tee /etc/cron.d/joblens-certbot >/dev/null
  sudo chmod 644 /etc/cron.d/joblens-certbot
fi
find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf {} +
find "$BACKUP_DIR" -type f -name 'joblens-*.dump' -mtime +14 -delete
rm -f "$ARCHIVE_PATH"

echo "China deployment is healthy at $DEPLOY_SHA."
