#!/usr/bin/env bash
# Dukan Builder one-shot host installer for a fresh Ubuntu 22.04/24.04 VPS.
#
#   sudo bash scripts/host-setup.sh --domain yourdomain.com
#
# Installs: Node 22, Caddy, OpenCode CLI, build tools; creates the "builder"
# user and all directories; copies this repo to /opt/builder; prompts for the
# secrets and writes /opt/builder/.env.opencode; runs npm ci + production
# build; installs the systemd units and Caddyfile with your domain.
#
# Remaining manual steps (printed at the end):
#   1. Paste supabase/migrations/001_init.sql, 002_site_admins.sql and
#      003_site_data.sql into your Supabase project's SQL editor.
#   2. sudo -u builder -i opencode auth login
#   3. DNS: A records builder.<domain>, preview.<domain>, *.<domain> -> VPS IP
#   4. Sign up on the site and set is_admin = 1 for your account.
set -euo pipefail

DOMAIN=""
WITH_QA=0

usage() {
  echo "Usage: sudo bash scripts/host-setup.sh --domain yourdomain.com [--with-qa]"
  exit 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --with-qa) WITH_QA=1; shift ;;
    *) usage ;;
  esac
done

[ "$(id -u)" = "0" ] || { echo "Run as root: sudo bash scripts/host-setup.sh ..." >&2; exit 1; }
[ -n "$DOMAIN" ] || usage
echo "$DOMAIN" | grep -Eq '^[a-z0-9.-]+$' || { echo "Invalid --domain: $DOMAIN" >&2; exit 1; }

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ -f "$REPO_DIR/package.json" ] || { echo "Not run from inside the repo clone: $REPO_DIR" >&2; exit 1; }

say()  { echo; echo "==> $*"; }

# ---------------------------------------------------------------- packages
say "Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl git build-essential python3 openssl gpg

if ! node -v 2>/dev/null | grep -q '^v2[02]'; then
  say "Installing Node 22 (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! command -v caddy >/dev/null 2>&1; then
  say "Installing Caddy (official repo)"
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update -y
  apt-get install -y caddy
fi

# ----------------------------------------------------------- user and dirs
say "Creating builder user and directories"
id -u builder >/dev/null 2>&1 || useradd -m -s /bin/bash builder
mkdir -p /opt/builder /opt/tenants /opt/www/published /opt/preview
ln -sfn /opt/preview/current /opt/preview-current

# ------------------------------------------------------------ OpenCode CLI
say "Installing OpenCode CLI for builder"
if sudo -u builder bash -c 'curl -fsSL https://opencode.ai/install | bash'; then
  sudo -u builder bash -c '"$HOME/.opencode/bin/opencode" --version' || true
else
  echo "WARNING: OpenCode CLI install failed (network?). You can install it later:"
  echo "  sudo -u builder bash -c 'curl -fsSL https://opencode.ai/install | bash'"
fi

# ------------------------------------------------------- copy app to /opt
say "Copying repo to /opt/builder"
if [ -f /opt/builder/.env.opencode ]; then
  read -r -p "/opt/builder/.env.opencode exists — overwrite env? [y/N] " OW
  [ "${OW:-n}" = "y" ] || echo "Keeping existing /opt/builder/.env.opencode"
fi
tar -C "$REPO_DIR" --exclude node_modules --exclude .next --exclude .git \
    --exclude data --exclude backups -cf - . | tar -C /opt/builder -xf -
if [ -d "$REPO_DIR/.git" ]; then
  rm -rf /opt/builder/.git
  cp -a "$REPO_DIR/.git" /opt/builder/
fi
chown -R builder:builder /opt/builder /opt/tenants /opt/www/published /opt/preview

# ------------------------------------------------------------------- env
if [ ! -f /opt/builder/.env.opencode ] || [ "${OW:-n}" = "y" ]; then
  say "Secrets (empty = skip, add later)"
  read -r -p "DATABASE_URL (Supabase → Database → Connection string, pooler): " DBURL
  read -r -p "SUPABASE_URL (Project URL): " SUPURL
  read -r -p "NEXT_PUBLIC_SUPABASE_URL [same as above]: " NPUBURL; NPUBURL="${NPUBURL:-$SUPURL}"
  read -r -p "NEXT_PUBLIC_SUPABASE_ANON_KEY: " ANON
  read -r -p "SUPABASE_SERVICE_ROLE_KEY: " SVCROLE
  read -r -p "PIXABAY_API_KEY: " PIXA
  SITE_ADMIN_ENC_KEY="$(openssl rand -hex 32)"

  umask 077
  {
    echo "DATABASE_URL=${DBURL}"
    echo "SUPABASE_URL=${SUPURL}"
    echo "NEXT_PUBLIC_SUPABASE_URL=${NPUBURL}"
    echo "NEXT_PUBLIC_SUPABASE_ANON_KEY=${ANON}"
    echo "SUPABASE_SERVICE_ROLE_KEY=${SVCROLE}"
    echo "PIXABAY_API_KEY=${PIXA}"
    echo "SITE_ADMIN_ENC_KEY=${SITE_ADMIN_ENC_KEY}"
  } > /opt/builder/.env.opencode
  chown builder:builder /opt/builder/.env.opencode
  echo "Wrote /opt/builder/.env.opencode (SITE_ADMIN_ENC_KEY generated fresh — keep a backup of this file)"
fi

# ------------------------------------------------------------ deps + build
say "npm ci"
sudo -u builder bash -c 'cd /opt/builder && npm ci'

say "Production build"
sudo -u builder bash -c 'cd /opt/builder && set -a && . ./.env.opencode && set +a && npm run build'

# ---------------------------------------------------------------- systemd
say "Installing systemd units"
cp "$REPO_DIR/infra/builder-app.service" /etc/systemd/system/builder-app.service
cp "$REPO_DIR/infra/tls-allowlist.service" /etc/systemd/system/tls-allowlist.service
systemctl daemon-reload
systemctl enable --now builder-app
systemctl enable --now tls-allowlist

# ------------------------------------------------------ Caddy for the domain
say "Installing Caddyfile for $DOMAIN"
sed "s/dukanbot\\.website/$DOMAIN/g" "$REPO_DIR/infra/Caddyfile" > /etc/caddy/Caddyfile
sed "s/dukanbot\\.website/$DOMAIN/g" "$REPO_DIR/infra/tls-allowlist.py" > /opt/tls-allowlist.py
chmod 755 /opt/tls-allowlist.py
systemctl restart caddy
systemctl restart tls-allowlist

# ---------------------------------------------------------------- optional
if [ "$WITH_QA" = "1" ]; then
  say "Installing QA browser (Playwright Chromium)"
  sudo -u builder bash -c 'cd /opt/builder/qa && npm install && npx playwright install chromium'
  (cd /opt/builder/qa && npx playwright install-deps chromium) || true
fi

# ------------------------------------------------------------------- done
echo
echo "=============================================================="
echo " Installed. Remaining manual steps:"
echo
echo " 1. Supabase SQL editor — paste in order:"
echo "      supabase/migrations/001_init.sql"
echo "      supabase/migrations/002_site_admins.sql"
echo "      supabase/migrations/003_site_data.sql"
echo
echo " 2. Log the OpenCode CLI in (AI models):"
echo "      sudo -u builder -i opencode auth login"
echo "      sudo -u builder -i opencode models"
echo
echo " 3. DNS A records -> $(hostname -I | awk '{print $1}'):"
echo "      builder.$DOMAIN   preview.$DOMAIN   *.$DOMAIN"
echo
echo " 4. Open https://builder.$DOMAIN, sign up, then in the Supabase"
echo "    SQL editor:"
echo "      update public.profiles set is_admin = 1 where email = 'you@example.com';"
echo
echo " Verify: the bottom-left badge shows a version + build time."
echo "=============================================================="
