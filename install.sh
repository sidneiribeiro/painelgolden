#!/usr/bin/env bash
# Xtream Novo — instalador oficial (Ubuntu 20.04/22.04/24.04 ou Debian 11/12)
# Uso:
#   sudo bash install.sh                                   # interativo
# Flags: --non-interactive  --no-nginx
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${BLUE}ℹ  $*${NC}"; }
ok()   { echo -e "${GREEN}✔  $*${NC}"; }
warn() { echo -e "${YELLOW}⚠  $*${NC}"; }
err()  { echo -e "${RED}✘  $*${NC}" >&2; }

NON_INTERACTIVE=0; ENABLE_SSL=0; SKIP_NGINX=0
APPLY_EDGE_ALLOWLIST=0
for arg in "$@"; do
  case "$arg" in
    --non-interactive) NON_INTERACTIVE=1 ;;
    --ssl) warn "SSL desativado: o instalador roda somente em HTTP (ignorando --ssl)"; ENABLE_SSL=0 ;;
    --no-nginx) SKIP_NGINX=1 ;;
    --apply-edge-allowlist) APPLY_EDGE_ALLOWLIST=1 ;;
  esac
done

[[ $EUID -eq 0 ]] || { err "Execute como root (sudo bash install.sh)."; exit 1; }
cd "$(dirname "$(readlink -f "$0")")"

cat <<'BANNER'
╔═══════════════════════════════════════════════════════════════╗
║               Xtream Novo — Instalador Oficial                ║
╚═══════════════════════════════════════════════════════════════╝
BANNER

# 1. Dependências de sistema
log "Atualizando pacotes do sistema..."
apt-get update -y
apt-get install -y curl ca-certificates gnupg lsb-release ufw openssl

if ! command -v docker >/dev/null 2>&1; then
  log "Instalando Docker Engine..."
  install -m 0755 -d /etc/apt/keyrings
  . /etc/os-release
  curl -fsSL "https://download.docker.com/linux/${ID}/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  ok "Docker instalado"
else
  ok "Docker presente ($(docker --version))"
fi
systemctl enable --now docker

# 2. Perguntas interativas
read_var() {
  local var="$1" prompt="$2" default="${3:-}"; local current; current="${!var-}"
  [[ -n "$current" ]] && return
  if [[ $NON_INTERACTIVE -eq 1 ]]; then printf -v "$var" '%s' "$default"; return; fi
  if [[ -n "$default" ]]; then
    read -r -p "$prompt [$default]: " value; value="${value:-$default}"
  else
    read -r -p "$prompt: " value
  fi
  printf -v "$var" '%s' "$value"
}

EDGE_POSTGRES_ALLOWLIST="${EDGE_POSTGRES_ALLOWLIST:-}"

if [[ $APPLY_EDGE_ALLOWLIST -eq 1 ]]; then
  NON_INTERACTIVE=1
  if [[ -z "$EDGE_POSTGRES_ALLOWLIST" ]]; then
    err "Defina EDGE_POSTGRES_ALLOWLIST (CSV) para aplicar (ex: EDGE_POSTGRES_ALLOWLIST=164.163.9.90,164.163.9.91)"
    exit 1
  fi
  log "Aplicando allowlist do Postgres para balances: $EDGE_POSTGRES_ALLOWLIST"
  if grep -q '"127.0.0.1:5432:5432"' docker-compose.yml; then
    sed -i 's#"127.0.0.1:5432:5432"#"0.0.0.0:5432:5432"#g' docker-compose.yml
    ok "Postgres exposto em 0.0.0.0:5432 (restrinja via firewall)"
  fi
  docker compose up -d postgres
  if command -v ufw >/dev/null 2>&1; then
    IFS=',' read -r -a edge_ips <<<"$EDGE_POSTGRES_ALLOWLIST"
    for ip in "${edge_ips[@]}"; do
      ip="$(echo "$ip" | xargs)"
      [[ -z "$ip" ]] && continue
      ufw allow from "$ip" to any port 5432 proto tcp >/dev/null 2>&1 || true
    done
    ufw deny 5432/tcp >/dev/null 2>&1 || true
    ufw reload >/dev/null 2>&1 || true
  fi
  ok "Allowlist aplicada. Verifique: ufw status | grep 5432"
  exit 0
fi

DOMAIN=""
ADMIN_USERNAME="admin"
ADMIN_EMAIL="admin@admin.com"
ADMIN_PASSWORD="admin123"

# 3. Gerar .env
if [[ ! -f .env ]]; then
  log "Gerando .env..."
  cp .env.example .env

  POSTGRES_PW="$(openssl rand -hex 16)"
  JWT1="$(openssl rand -hex 32)"
  JWT2="$(openssl rand -hex 32)"
  ENC_KEY="$(openssl rand -hex 16)"

  sed -i "s#TROQUE_POSTGRES_PASS#${POSTGRES_PW}#g" .env
  awk -v j1="$JWT1" -v j2="$JWT2" '
    /^JWT_SECRET=TROQUE/          { print "JWT_SECRET=" j1; next }
    /^JWT_REFRESH_SECRET=TROQUE/  { print "JWT_REFRESH_SECRET=" j2; next }
    { print }' .env > .env.tmp && mv .env.tmp .env
  sed -i "s#TROQUE_32_CHARS_EXATOS_0123456789#${ENC_KEY}#g" .env
  sed -i "s#^SEED_ADMIN_USERNAME=.*#SEED_ADMIN_USERNAME=${ADMIN_USERNAME}#g" .env
  sed -i "s#^SEED_ADMIN_EMAIL=.*#SEED_ADMIN_EMAIL=${ADMIN_EMAIL}#g" .env
  sed -i "s#^SEED_ADMIN_PASSWORD=.*#SEED_ADMIN_PASSWORD=${ADMIN_PASSWORD}#g" .env

  if [[ -n "$DOMAIN" ]]; then
    sed -i "s#painel.seudominio.com#${DOMAIN}#g" .env
  fi

  if [[ $ENABLE_SSL -eq 0 ]]; then
    sed -i 's#^FRONTEND_URL=https://#FRONTEND_URL=http://#' .env
    sed -i 's#^API_URL=https://#API_URL=http://#' .env
    sed -i '/^ALLOWED_ORIGINS=/ s#https://#http://#g' .env
    if grep -q '^ENABLE_HSTS=' .env; then
      sed -i 's/^ENABLE_HSTS=.*/ENABLE_HSTS=false/' .env
    else
      echo 'ENABLE_HSTS=false' >> .env
    fi
    if grep -q '^EDGE_FORCE_HTTP=' .env; then
      sed -i 's/^EDGE_FORCE_HTTP=.*/EDGE_FORCE_HTTP=true/' .env
    else
      echo 'EDGE_FORCE_HTTP=true' >> .env
    fi
    if grep -q '^COOKIE_SECURE=' .env; then
      sed -i 's/^COOKIE_SECURE=.*/COOKIE_SECURE=false/' .env
    else
      echo 'COOKIE_SECURE=false' >> .env
    fi
  else
    if grep -q '^COOKIE_SECURE=' .env; then
      sed -i 's/^COOKIE_SECURE=.*/COOKIE_SECURE=true/' .env
    else
      echo 'COOKIE_SECURE=true' >> .env
    fi
  fi
  chmod 600 .env
  ok ".env gerado."
else
  warn ".env já existe; mantendo."
  sed -i "s#^SEED_ADMIN_USERNAME=.*#SEED_ADMIN_USERNAME=${ADMIN_USERNAME}#g" .env || true
  sed -i "s#^SEED_ADMIN_EMAIL=.*#SEED_ADMIN_EMAIL=${ADMIN_EMAIL}#g" .env || true
  sed -i "s#^SEED_ADMIN_PASSWORD=.*#SEED_ADMIN_PASSWORD=${ADMIN_PASSWORD}#g" .env || true
fi

if [[ -n "$EDGE_POSTGRES_ALLOWLIST" ]]; then
  log "Habilitando acesso do Postgres para balances: $EDGE_POSTGRES_ALLOWLIST"
  if grep -q '"127.0.0.1:5432:5432"' docker-compose.yml; then
    sed -i 's#"127.0.0.1:5432:5432"#"0.0.0.0:5432:5432"#g' docker-compose.yml
    ok "Postgres exposto em 0.0.0.0:5432 (restrinja via firewall)"
  else
    warn "Não encontrei a porta 127.0.0.1:5432:5432 no docker-compose.yml (nada para alterar)"
  fi
fi

# 4. Build + up
log "Buildando imagens Docker (pode demorar na primeira vez)..."
docker compose build
log "Subindo stack..."
docker compose up -d

log "Aguardando backend ficar saudável..."
for i in {1..60}; do
  if curl -sf http://127.0.0.1:3001/api/health >/dev/null 2>&1; then
    ok "Backend respondeu em /api/health"
    break
  fi
  sleep 2
done

# 5. Nginx do host
if [[ $SKIP_NGINX -eq 0 ]]; then
  log "Configurando nginx..."
  apt-get install -y nginx
  SERVER_NAME="_"
  cat > /etc/nginx/sites-available/painelmaster <<NGINX
map \$http_upgrade \$connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80 default_server;
    server_name ${SERVER_NAME};
    client_max_body_size 100M;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;

    location ^~ /api {
        proxy_pass http://127.0.0.1:3001;
        include /etc/nginx/proxy_params;
        proxy_http_version 1.1;
        proxy_read_timeout 300s;
    }
    location = /get.php {
        proxy_pass http://127.0.0.1:3001;
        include /etc/nginx/proxy_params;
        proxy_http_version 1.1;
        proxy_read_timeout 3600s;
    }
    location = /player_api.php {
        proxy_pass http://127.0.0.1:3001;
        include /etc/nginx/proxy_params;
        proxy_http_version 1.1;
        proxy_read_timeout 3600s;
    }
    location = /panel_api.php {
        proxy_pass http://127.0.0.1:3001;
        include /etc/nginx/proxy_params;
        proxy_http_version 1.1;
        proxy_read_timeout 3600s;
    }
    location = /xmltv.php {
        proxy_pass http://127.0.0.1:3001;
        include /etc/nginx/proxy_params;
        proxy_http_version 1.1;
        proxy_read_timeout 3600s;
    }
    location ^~ /hls/ {
        proxy_pass http://127.0.0.1:3001;
        include /etc/nginx/proxy_params;
        proxy_http_version 1.1;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
        proxy_request_buffering off;
    }
    location ^~ /live/ {
        proxy_pass http://127.0.0.1:3001;
        include /etc/nginx/proxy_params;
        proxy_http_version 1.1;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
        proxy_request_buffering off;
    }
    location ^~ /timeshift/ {
        proxy_pass http://127.0.0.1:3001;
        include /etc/nginx/proxy_params;
        proxy_http_version 1.1;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
        proxy_request_buffering off;
    }
    location ^~ /movie/ {
        proxy_pass http://127.0.0.1:3001;
        include /etc/nginx/proxy_params;
        proxy_http_version 1.1;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
        proxy_request_buffering off;
    }
    location ^~ /series/ {
        proxy_pass http://127.0.0.1:3001;
        include /etc/nginx/proxy_params;
        proxy_http_version 1.1;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
        proxy_request_buffering off;
    }
    location ^~ /storage {
        proxy_pass http://127.0.0.1:3001;
        include /etc/nginx/proxy_params;
    }
    location ^~ /uploads {
        proxy_pass http://127.0.0.1:3001;
        include /etc/nginx/proxy_params;
    }
    location ^~ /socket.io {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        include /etc/nginx/proxy_params;
    }
    location / {
        proxy_pass http://127.0.0.1:8080;
        include /etc/nginx/proxy_params;
    }
    location ~ /\. { deny all; }
}
NGINX
  ln -sf /etc/nginx/sites-available/painelmaster /etc/nginx/sites-enabled/painelmaster
  rm -f /etc/nginx/sites-enabled/default
  nginx -t && systemctl reload nginx
  ok "nginx configurado"

  if [[ $ENABLE_SSL -eq 1 && -n "$DOMAIN" && -n "$EMAIL" ]]; then
    log "Emitindo certificado Let's Encrypt..."
    apt-get install -y certbot python3-certbot-nginx
    set_hsts() {
      local v="$1"
      if [[ -f .env ]]; then
        if grep -q '^ENABLE_HSTS=' .env; then
          sed -i "s/^ENABLE_HSTS=.*/ENABLE_HSTS=${v}/" .env
        else
          echo "ENABLE_HSTS=${v}" >> .env
        fi
      fi
    }

    if certbot --nginx --non-interactive --agree-tos -m "$EMAIL" -d "$DOMAIN" --redirect; then
      set_hsts true
      ok "SSL aplicado com Let's Encrypt"
    else
      warn "Certbot falhou (Let's Encrypt pode estar instável)."
      set_hsts false
    fi

    if ! ss -lntp 2>/dev/null | grep -q ':443'; then
      warn "Porta 443 não está ouvindo; criando SSL temporário (self-signed) para evitar conexão recusada."
      mkdir -p /etc/ssl/painelmaster
      if [[ ! -f /etc/ssl/painelmaster/selfsigned.key || ! -f /etc/ssl/painelmaster/selfsigned.crt ]]; then
        openssl req -x509 -nodes -newkey rsa:2048 \
          -keyout /etc/ssl/painelmaster/selfsigned.key \
          -out /etc/ssl/painelmaster/selfsigned.crt \
          -days 30 -subj "/CN=$DOMAIN" >/dev/null 2>&1 || true
      fi
      if ! grep -q 'listen 443' /etc/nginx/sites-available/painelmaster; then
        SERVER_NAME="${DOMAIN:-_}"
        cat >> /etc/nginx/sites-available/painelmaster <<NGINXSSL

server {
    listen 443 ssl http2;
    server_name ${SERVER_NAME};
    client_max_body_size 100M;

    ssl_certificate /etc/ssl/painelmaster/selfsigned.crt;
    ssl_certificate_key /etc/ssl/painelmaster/selfsigned.key;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;

    location ^~ /api {
        proxy_pass http://127.0.0.1:3001;
        include /etc/nginx/proxy_params;
        proxy_http_version 1.1;
        proxy_read_timeout 300s;
    }
    location = /get.php {
        proxy_pass http://127.0.0.1:3001;
        include /etc/nginx/proxy_params;
        proxy_http_version 1.1;
        proxy_read_timeout 3600s;
    }
    location = /player_api.php {
        proxy_pass http://127.0.0.1:3001;
        include /etc/nginx/proxy_params;
        proxy_http_version 1.1;
        proxy_read_timeout 3600s;
    }
    location = /panel_api.php {
        proxy_pass http://127.0.0.1:3001;
        include /etc/nginx/proxy_params;
        proxy_http_version 1.1;
        proxy_read_timeout 3600s;
    }
    location = /xmltv.php {
        proxy_pass http://127.0.0.1:3001;
        include /etc/nginx/proxy_params;
        proxy_http_version 1.1;
        proxy_read_timeout 3600s;
    }
    location ^~ /hls/ {
        proxy_pass http://127.0.0.1:3001;
        include /etc/nginx/proxy_params;
        proxy_http_version 1.1;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
        proxy_request_buffering off;
    }
    location ^~ /live/ {
        proxy_pass http://127.0.0.1:3001;
        include /etc/nginx/proxy_params;
        proxy_http_version 1.1;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
        proxy_request_buffering off;
    }
    location ^~ /movie/ {
        proxy_pass http://127.0.0.1:3001;
        include /etc/nginx/proxy_params;
        proxy_http_version 1.1;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
        proxy_request_buffering off;
    }
    location ^~ /series/ {
        proxy_pass http://127.0.0.1:3001;
        include /etc/nginx/proxy_params;
        proxy_http_version 1.1;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
        proxy_request_buffering off;
    }
    location ^~ /storage {
        proxy_pass http://127.0.0.1:3001;
        include /etc/nginx/proxy_params;
    }
    location ^~ /uploads {
        proxy_pass http://127.0.0.1:3001;
        include /etc/nginx/proxy_params;
    }
    location ^~ /socket.io {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        include /etc/nginx/proxy_params;
    }
    location / {
        proxy_pass http://127.0.0.1:8080;
        include /etc/nginx/proxy_params;
    }
    location ~ /\. { deny all; }
}
NGINXSSL
      fi
      nginx -t && systemctl reload nginx
    fi
  fi
fi

# 6. UFW
if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH >/dev/null 2>&1 || true
  ufw allow 80/tcp  >/dev/null 2>&1 || true
  if [[ -n "$EDGE_POSTGRES_ALLOWLIST" ]]; then
    IFS=',' read -r -a edge_ips <<<"$EDGE_POSTGRES_ALLOWLIST"
    for ip in "${edge_ips[@]}"; do
      ip="$(echo "$ip" | xargs)"
      [[ -z "$ip" ]] && continue
      ufw allow from "$ip" to any port 5432 proto tcp >/dev/null 2>&1 || true
    done
    ufw deny 5432/tcp >/dev/null 2>&1 || true
  fi
  if ufw status 2>/dev/null | grep -qi inactive; then
    ufw --force enable >/dev/null 2>&1 || true
  fi
fi

PUB_URL="${DOMAIN:+http://$DOMAIN}"
PUB_URL="${PUB_URL:-http://$(curl -s ifconfig.me 2>/dev/null || echo 'SEU-IP')}"

echo
ok "Instalação concluída."
echo
echo "  URL:       $PUB_URL"
echo "  Admin:     $ADMIN_USERNAME"
echo "  Senha:     $ADMIN_PASSWORD"
echo
echo "  Logs:      docker compose logs -f backend"
echo "  Update:    git pull && docker compose up -d --build"
echo "  Parar:     docker compose down"
echo
