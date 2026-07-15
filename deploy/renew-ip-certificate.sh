#!/usr/bin/env sh
set -eu

ROOT_DIR=${ROOT_DIR:-/opt/joblens}
CERTBOT_DIR=${CERTBOT_DIR:-$ROOT_DIR/certbot}
WEB_CONTAINER=${WEB_CONTAINER:-deploy-web-1}

restart_web() {
  sudo docker start "$WEB_CONTAINER" >/dev/null 2>&1 || true
}

trap restart_web EXIT
sudo docker stop "$WEB_CONTAINER" >/dev/null
sudo docker run --rm -p 80:80 \
  -v "$CERTBOT_DIR:/etc/letsencrypt" \
  certbot/certbot:v5.4.0 renew \
  --non-interactive --preferred-profile shortlived

restart_web
trap - EXIT
