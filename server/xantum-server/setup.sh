#!/usr/bin/env bash
# Run on the VPS. Tests may source functions without changing the host.
set -euo pipefail
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$SCRIPT_DIR/tls-setup.sh"
setup_log() { printf '[Xantum] %s\n' "$*"; }
setup_error() { printf '[Xantum] %s\n' "$*" >&2; return 1; }
setup_validate_port() { [[ "$1" =~ ^[0-9]{1,5}$ ]] && ((10#$1 >= 1 && 10#$1 <= 65535)); }
setup_normalize_port() { setup_validate_port "$1" || return 1; printf '%d' "$((10#$1))"; }
# Read .env as data, never source/eval it. Preserve literal '$' and quoted secrets.
setup_read_env() {
  local key=$1 file=$2 line value='' found=false
  local double_quoted='^"(.*)"[[:space:]]*(#.*)?$' single_quoted="^'(.*)'[[:space:]]*(#.*)?$"
  [[ "$key" =~ ^[A-Z_][A-Z0-9_]*$ && -f "$file" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    line=${line%$'\r'}
    if [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?$key[[:space:]]*=(.*)$ ]]; then
      value=${BASH_REMATCH[2]}
      value="${value#"${value%%[![:space:]]*}"}"; value="${value%"${value##*[![:space:]]}"}"
      if [[ "$value" =~ $double_quoted || "$value" =~ $single_quoted ]]; then value=${BASH_REMATCH[1]};
      else value=${value%%#*}; value="${value%"${value##*[![:space:]]}"}"; fi
      found=true
    fi
  done < "$file"
  [[ "$found" != true ]] || printf '%s' "$value"
}

setup_dependencies() {
  local package
  local -a missing=()
  if command -v apt-get >/dev/null; then
    for package in gcc curl ca-certificates openssl iptables iproute2 python3 python3-venv xz-utils; do
      [[ $(dpkg-query -W -f='${Status}' "$package" 2>/dev/null || true) == 'install ok installed' ]] || missing+=("$package")
    done
    ((${#missing[@]})) || { setup_log 'Gerekli sistem paketleri zaten kurulu; paket güncellemesi yapılmadı.'; return 0; }
    NEEDRESTART_MODE=l DEBIAN_FRONTEND=noninteractive apt-get update -qq
    NEEDRESTART_MODE=l DEBIAN_FRONTEND=noninteractive apt-get install -y --no-upgrade --no-install-recommends "${missing[@]}"
  elif command -v dnf >/dev/null; then
    for package in gcc curl ca-certificates openssl iptables iproute python3 python3-pip xz; do
      rpm -q --quiet "$package" || missing+=("$package")
    done
    ((${#missing[@]})) || { setup_log 'Gerekli sistem paketleri zaten kurulu; paket güncellemesi yapılmadı.'; return 0; }
    dnf install -y "${missing[@]}"
  else
    setup_error 'Desteklenen paket yöneticisi bulunamadı. Ubuntu 22.04+ / Debian 12+ önerilir.'; return 1
  fi
}

setup_node() {
  local node_path architecture archive manifest runtime staging
  node_path=$(command -v node || true)
  node_path=$(readlink -f "$node_path" 2>/dev/null || true)
  if [[ -n "$node_path" && "$node_path" != /root/* && "$node_path" != /home/* ]] && "$node_path" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)'; then
    NODE_BIN=$(readlink -f "$node_path")
    command -v npm >/dev/null || { setup_error 'Node.js bulundu fakat npm eksik.'; return 1; }
    NPM_BIN=$(command -v npm); return
  fi
  case $(uname -m) in x86_64) architecture=x64;; aarch64|arm64) architecture=arm64;; *) setup_error 'Otomatik Node kurulumu x86_64 / arm64 destekler.'; return 1;; esac
  setup_log 'Node.js 22 LTS ayrı dizine kuruluyor; sistem Node sürümü değiştirilmiyor.'
  staging=$(mktemp -d /opt/.xantum-node.XXXXXX)
  NODE_STAGE=$staging
  manifest="$staging/SHASUMS256.txt"
  curl --fail --show-error --silent --proto '=https' --tlsv1.2 https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt -o "$manifest"
  archive=$(awk -v arch="$architecture" '$2 ~ "^node-v22\\.[0-9]+\\.[0-9]+-linux-" arch "\\.tar\\.xz$" { print $2 }' "$manifest")
  [[ "$archive" =~ ^node-v22\.[0-9]+\.[0-9]+-linux-(x64|arm64)\.tar\.xz$ ]] || { setup_error 'Node SHA256 manifesti doğrulanamadı.'; return 1; }
  curl --fail --show-error --silent --proto '=https' --tlsv1.2 "https://nodejs.org/dist/latest-v22.x/$archive" -o "$staging/$archive"
  (cd "$staging"; awk -v file="$archive" '$2 == file' SHASUMS256.txt | sha256sum --check --status) || { setup_error 'Node SHA256 kontrolü başarısız.'; return 1; }
  runtime="/opt/xantum-runtimes/${archive%.tar.xz}"
  install -d -m 755 /opt/xantum-runtimes
  if [[ ! -x "$runtime/bin/node" ]]; then
    tar -xJf "$staging/$archive" -C "$staging"
    mv -- "$staging/${archive%.tar.xz}" "$runtime"
  fi
  rm -rf -- "$staging"
  NODE_STAGE=''
  NODE_BIN="$runtime/bin/node"; NPM_BIN="$runtime/bin/npm"
  "$NODE_BIN" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)'
}

setup_firewall() {
  local state
  if command -v ufw >/dev/null; then
    state=$(LC_ALL=C ufw status)
    if [[ "$state" == *'Status: active'* ]]; then
      # Preserve the actual SSH port first; never reset, enable or alter UFW defaults.
      ufw allow "$SSH_PORT/tcp" comment 'Xantum preserve SSH access'
      ufw allow "$API_PORT/tcp" comment 'Xantum API and chat'
      ufw allow "$XTP_PORT/tcp" comment 'Xantum tunnel'
      [[ "$TLS_MODE" != auto ]] || ufw allow 80/tcp comment 'Xantum certificate renewal'
      ufw route allow in on xtp0 out on "$NET_IFACE" from 10.8.0.0/24 comment 'Xantum tunnel forwarding'
      return
    fi
  fi
  setup_log "Güvenlik duvarı etkinleştirilmedi veya sıfırlanmadı. Sağlayıcı panelinde TCP $API_PORT, $XTP_PORT$([[ "$TLS_MODE" != auto ]] || printf ', 80') açık olmalı."
}

setup_write_env() {
  PUBLIC_HOST=$PUBLIC_HOST API_PORT=$API_PORT XTP_PORT=$XTP_PORT TLS_CERT=$TLS_CERT TLS_KEY=$TLS_KEY \
    python3 - "$1" "$2" <<'PY'
import os, re, secrets, sys
source, target = sys.argv[1:]
lines = open(source, encoding='utf-8').read().splitlines() if os.path.isfile(source) else []
updates = {key: os.environ[key] for key in ('API_PORT', 'XTP_PORT', 'TLS_CERT', 'TLS_KEY')}
updates.update(VPN_IP=os.environ['PUBLIC_HOST'], TUN_HELPER='/opt/xantum-backend/xtp-tun-helper')
result = [line for line in lines if not any(re.match(r'^\s*(?:export\s+)?' + key + r'\s*=', line) for key in updates)]
if not any(re.match(r'^\s*(?:export\s+)?VPN_PIN\s*=', line) for line in lines):
    result.append('VPN_PIN=' + secrets.token_hex(24))
result += [key + '=' + value for key, value in updates.items()]
descriptor = os.open(target, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
with os.fdopen(descriptor, 'w', encoding='utf-8') as output:
    output.write('\n'.join(result) + '\n')
PY
}

setup_stage_backend() {
  STAGE=$(mktemp -d /opt/.xantum-backend.new.XXXXXX)
  chmod 700 "$STAGE"
  local file
  for file in server.js chat.js xtp-server.js tls-reload.js package.json package-lock.json; do install -m 644 "$SCRIPT_DIR/backend/$file" "$STAGE/$file"; done
  gcc -Wall -Wextra -Werror -O2 -D_FORTIFY_SOURCE=2 -o "$STAGE/xtp-tun-helper" "$SCRIPT_DIR/xtp-tun.c"
  chmod 755 "$STAGE/xtp-tun-helper"
  setup_write_env /opt/xantum-backend/.env "$STAGE/.env"
  (
    cd "$STAGE"
    PATH="$(dirname "$NODE_BIN"):$PATH" "$NPM_BIN" ci --omit=dev --ignore-scripts --no-audit --no-fund
    for file in server.js chat.js xtp-server.js tls-reload.js; do "$NODE_BIN" --check "$file"; done
    "$NODE_BIN" - <<'JS'
const fs = require('node:fs'), tls = require('node:tls')
require('dotenv').config()
if (!process.env.VPN_PIN || process.env.VPN_PIN.length < 12 || process.env.VPN_PIN.length > 256) throw new Error('Mevcut VPN_PIN 12–256 karakter olmalı.')
if (!Array.isArray(JSON.parse(process.env.ICE_SERVERS || '[]'))) throw new Error('ICE_SERVERS JSON dizisi olmalı.')
tls.createSecureContext({ cert: fs.readFileSync(process.env.TLS_CERT), key: fs.readFileSync(process.env.TLS_KEY), minVersion: 'TLSv1.3' })
JS
  )
}

setup_rollback_service() {
  # Bash's dynamic scope supplies the transaction locals from setup_install_service.
  local failed
  set +e
  if [[ "$transition_started" == true ]]; then
    systemctl stop xantum-backend.service
    if [[ "$promoted" == true && -d /opt/xantum-backend ]]; then
      failed=$(mktemp -d /opt/.xantum-backend.failed.XXXXXX)
      if [[ -n "$failed" ]]; then
        rmdir "$failed"; mv /opt/xantum-backend "$failed"
        printf '[Xantum] Başarısız sürümün özel tanı dizini: %s\n' "$failed" >&2
      fi
    fi
    [[ -z "$backup" || ! -d "$backup" ]] || mv -- "$backup" /opt/xantum-backend
  fi
  if [[ -n "$prior_unit" ]]; then printf '%s\n' "$prior_unit" > "$unit";
  else systemctl disable xantum-backend.service; rm -f -- "$unit"; fi
  if [[ -n "$prior_unit" ]]; then
    if [[ "$old_enabled" == enabled ]]; then systemctl enable xantum-backend.service;
    elif [[ "$old_enabled" == enabled-runtime ]]; then systemctl disable xantum-backend.service; systemctl enable --runtime xantum-backend.service;
    else systemctl disable xantum-backend.service; fi
  fi
  [[ -z "$unit_temp" ]] || rm -f -- "$unit_temp"
  systemctl daemon-reload
  if [[ "$transition_started" == true ]]; then
    [[ "$old_service" != true ]] || systemctl start xantum-backend.service
    [[ "$old_pm2" != true ]] || pm2 restart xantum-backend
  fi
  printf '[Xantum] Güncelleme durduruldu; önceki kurulum geri yüklendi.\n' >&2
  set -e
}

setup_install_service() {
  local old_service=false old_pm2=false backup='' prior_unit='' healthy=false attempt old_enabled
  local transition_started=false promoted=false unit_temp=''
  local unit=/etc/systemd/system/xantum-backend.service
  [[ ! -L "$unit" ]] || { setup_error 'Mevcut Xantum systemd ünitesi sembolik bağ / maske; önce kendi servis yapılandırmanızı denetleyin.'; return 1; }
  [[ ! -f "$unit" ]] || prior_unit=$(cat "$unit")
  old_enabled=$(systemctl is-enabled xantum-backend.service 2>/dev/null || true)
  systemctl is-active --quiet xantum-backend.service && old_service=true
  if command -v pm2 >/dev/null && pm2 describe xantum-backend >/dev/null 2>&1; then old_pm2=true; fi
  # Preflight passed: source, dependencies, helper, private config and TLS all validate.
  install -d -m 755 /usr/local/bin/xantum
  printf 'net.ipv4.ip_forward = 1\n' > /etc/sysctl.d/99-xantum.conf
  sysctl -p /etc/sysctl.d/99-xantum.conf >/dev/null
  unit_temp=$(mktemp /etc/systemd/system/.xantum-backend.service.XXXXXX)
  trap 'result=$?; trap - ERR; setup_rollback_service; exit "$result"' ERR
  cat > "$unit_temp" <<SERVICE
[Unit]
Description=Xantum XTP VPN and chat server
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/xantum-backend
Environment=PATH=$(dirname "$NODE_BIN"):/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=$NODE_BIN /opt/xantum-backend/server.js
ExecReload=/bin/kill -HUP \$MAINPID
Restart=on-failure
RestartSec=3
TimeoutStopSec=10
KillMode=mixed
UMask=0077
ProtectHome=true
PrivateTmp=true
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
SERVICE
  mv -- "$unit_temp" "$unit"; unit_temp=''
  transition_started=true
  [[ "$old_service" != true ]] || systemctl stop xantum-backend.service
  [[ "$old_pm2" != true ]] || pm2 stop xantum-backend
  if [[ -d /opt/xantum-backend ]]; then
    backup=$(mktemp -d /opt/.xantum-backend.backup.XXXXXX); rmdir "$backup"
    mv /opt/xantum-backend "$backup"; chmod 700 "$backup"
  fi
  mv -- "$STAGE" /opt/xantum-backend; STAGE=''; promoted=true
  systemctl daemon-reload
  if systemctl enable --now xantum-backend.service; then
    for attempt in {1..20}; do
      if curl --silent --fail --max-time 2 --noproxy '*' --resolve "$PUBLIC_HOST:$API_PORT:127.0.0.1" \
          "https://$PUBLIC_HOST:$API_PORT/health" | python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("status") == "ok" else 1)' 2>/dev/null; then
        healthy=true; break
      fi
      sleep 1
    done
  fi
  if [[ "$healthy" != true ]]; then
    journalctl -u xantum-backend.service -n 35 --no-pager >&2 || true
    trap - ERR
    setup_rollback_service
    setup_error 'Yeni servis sağlıklı başlamadı.'; return 1
  fi
  trap - ERR
  if [[ "$old_pm2" == true ]]; then pm2 delete xantum-backend; pm2 save; fi
  ln -sfn /opt/xantum-backend/xtp-tun-helper /usr/local/bin/xantum/xtp-tun-helper
  cat > /usr/local/bin/xantum/status.sh <<'STATUS'
#!/usr/bin/env bash
systemctl --no-pager status xantum-backend.service
systemctl --no-pager list-timers xantum-certificate.timer
STATUS
  chmod 755 /usr/local/bin/xantum/status.sh
  [[ -z "$backup" ]] || setup_log "Önceki sürümün özel yedeği: $backup"
}

setup_print_summary() {
  local env_file=${1:-/opt/xantum-backend/.env} pin strong='' value='' reset=''
  # Keep the key inside this shell: never pass it to a process or export it.
  pin=$(setup_read_env VPN_PIN "$env_file")
  [[ -n "$pin" ]] || { setup_error 'Kurulum bilgileri gösterilemedi: katılım anahtarı okunamıyor.'; return 1; }
  if [[ -t 1 && -z ${NO_COLOR+x} && ${TERM:-dumb} != dumb ]]; then
    strong=$'\033[1m'; value=$'\033[1;7m'; reset=$'\033[0m'
  fi
  printf '\n============================================================\n'
  printf '%sXANTUM KURULUMU TAMAMLANDI%s\n' "$strong" "$reset"
  printf 'TLS doğrulaması açık.\n'
  printf '============================================================\n\n'
  printf '%sUYGULAMAYA GİRİLECEK BİLGİLER%s\n\n' "$strong" "$reset"
  printf '%sSunucu adresi / IP:%s\n' "$strong" "$reset"
  printf '%s%s%s\n\n' "$value" "$PUBLIC_HOST" "$reset"
  printf '%sKatılım anahtarı:%s\n' "$strong" "$reset"
  printf '%s%s%s\n\n' "$value" "$pin" "$reset"
  printf 'API + sohbet portu: %s / TCP\n' "$API_PORT"
  printf 'XTP tünel portu:   %s / TCP\n\n' "$XTP_PORT"
  printf '%sXantum uygulaması → Ayarlar → Sunucun%s\n' "$strong" "$reset"
  printf '“Sunucu IP adresi veya alan adı” alanına yukarıdaki adresi girin.\n'
  printf '“Katılım anahtarı” alanına anahtarın tamamını yapıştırın.\n'
  printf '“Sunucuyu kaydet” düğmesine basın; ana sayfadan bağlanın.\n'
  printf 'Katılım anahtarını gizli tutun; ekran görüntüsü veya log paylaşırken çıkarın.\n\n'
  printf 'Durum: sudo /usr/local/bin/xantum/status.sh\n'
  printf 'Log:   sudo journalctl -u xantum-backend -f\n'
  if [[ "$TLS_MODE" == auto ]]; then
    printf 'Sertifika yenilemesi 4 saatte bir denetlenir. TCP 80 dışarıdan erişilebilir kalmalı.\n'
    if tls_is_ip "$PUBLIC_HOST"; then printf 'IP sertifikaları yaklaşık 6 günlük; otomatik yenileme zorunludur.\n'; fi
  else
    printf 'Mevcut sertifikanız yenilendiğinde: sudo systemctl reload xantum-backend\n'
  fi
}

setup_main() {
  [[ $EUID -eq 0 ]] || { setup_error 'Bu betik VDS üzerinde sudo ile çalıştırılır.'; return 1; }
  if [[ ${1:-} != --auto ]]; then
    local answer
    printf 'Bu betik VDS üzerinde paketler, Xantum servisi ve VPN yönlendirmesi kurar.\n'
    read -r -p 'VDS üzerinde devam et? [E/h]: ' answer
    [[ ${answer:-E} =~ ^[EeYy]$ ]] || return 1
  fi
  command -v systemctl >/dev/null && [[ -d /run/systemd/system ]] || { setup_error 'Systemd kullanan Linux VDS gerekli.'; return 1; }
  [[ -c /dev/net/tun ]] || { setup_error 'VDS üzerinde /dev/net/tun yok; sağlayıcınızdan TUN desteğini açın.'; return 1; }
  [[ ! -L /opt/xantum-backend && ! -L /opt/xantum-backend/.env ]] || { setup_error 'Backend dizini / .env sembolik bağ olamaz.'; return 1; }
  PUBLIC_HOST=${PUBLIC_HOST:-$(setup_read_env VPN_IP /opt/xantum-backend/.env)}
  if [[ -z "$PUBLIC_HOST" ]]; then read -r -p 'Uygulamada kullanılacak genel IPv4 / alan adı: ' PUBLIC_HOST; fi
  PUBLIC_HOST=${PUBLIC_HOST,,}
  tls_validate_host "$PUBLIC_HOST" || { setup_error 'Geçersiz IPv4 / alan adı.'; return 1; }
  API_PORT=${API_PORT:-$(setup_read_env API_PORT /opt/xantum-backend/.env)}; API_PORT=${API_PORT:-51821}
  XTP_PORT=${XTP_PORT:-$(setup_read_env XTP_PORT /opt/xantum-backend/.env)}; XTP_PORT=${XTP_PORT:-8443}
  # sshd's server port is field four; the wizard explicitly passes it through sudo.
  SSH_PORT=${SSH_PORT:-${SSH_CONNECTION:-}}; SSH_PORT=${SSH_PORT##* }; SSH_PORT=${SSH_PORT:-22}
  setup_validate_port "$API_PORT" && setup_validate_port "$XTP_PORT" && setup_validate_port "$SSH_PORT" || { setup_error 'Portlar 1–65535 arasında olmalı.'; return 1; }
  API_PORT=$(setup_normalize_port "$API_PORT"); XTP_PORT=$(setup_normalize_port "$XTP_PORT"); SSH_PORT=$(setup_normalize_port "$SSH_PORT")
  [[ "$API_PORT" != "$XTP_PORT" && "$API_PORT" != "$SSH_PORT" && "$XTP_PORT" != "$SSH_PORT" ]] || { setup_error 'SSH, API ve XTP portları farklı olmalı.'; return 1; }
  if [[ -z ${TLS_MODE:-} ]]; then
    if [[ -n ${TLS_CERT:-} || -n ${TLS_KEY:-} ]]; then TLS_MODE=existing; else TLS_MODE=auto; fi
  fi
  [[ "$TLS_MODE" == auto || "$TLS_MODE" == existing ]] || { setup_error 'TLS_MODE auto veya existing olmalı.'; return 1; }
  if [[ "$TLS_MODE" == auto && ( "$API_PORT" == 80 || "$XTP_PORT" == 80 || "$SSH_PORT" == 80 ) ]]; then
    setup_error 'Otomatik sertifika TCP 80 üzerindeki HTTP doğrulamasını kullanır; SSH / API / XTP farklı port kullanmalı.'; return 1
  fi
  if [[ "$TLS_MODE" == existing ]]; then
    TLS_CERT=${TLS_CERT:-$(setup_read_env TLS_CERT /opt/xantum-backend/.env)}
    TLS_KEY=${TLS_KEY:-$(setup_read_env TLS_KEY /opt/xantum-backend/.env)}
    command -v openssl >/dev/null || { setup_error 'Sertifika doğrulamak için openssl gerekli.'; return 1; }
    tls_validate_pair "$TLS_CERT" "$TLS_KEY" "$PUBLIC_HOST" || return 1
  elif [[ ${LE_AGREE_TOS:-0} != 1 ]]; then
    local consent
    printf 'Let’s Encrypt koşulları: https://letsencrypt.org/repository/\n'
    read -r -p 'Koşulları kabul et? [E/h]: ' consent
    [[ ${consent:-E} =~ ^[EeYy]$ ]] || return 1
    LE_AGREE_TOS=1
  fi
  umask 077
  STAGE=''
  NODE_STAGE=''
  trap 'result=$?; [[ -z ${STAGE:-} ]] || rm -rf -- "$STAGE"; [[ -z ${NODE_STAGE:-} ]] || rm -rf -- "$NODE_STAGE"; if ((result)); then printf "[Xantum] Kurulum tamamlanmadı; yukarıdaki hatayı düzeltip tekrar deneyin.\n" >&2; fi' EXIT
  setup_dependencies
  # A busy HTTP port is safe only after a nonce confirms the existing site's
  # webroot. Never stop a web server or rewrite its sites to obtain a certificate.
  [[ "$TLS_MODE" != auto ]] || tls_check_http_port "$PUBLIC_HOST"
  NET_IFACE=$(ip -j route get 1.1.1.1 | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["dev"])')
  [[ "$NET_IFACE" =~ ^[a-zA-Z0-9_.-]{1,15}$ ]] || { setup_error 'Çıkış ağ arayüzü belirlenemedi.'; return 1; }
  setup_firewall
  [[ "$TLS_MODE" != auto ]] || tls_configure_auto "$PUBLIC_HOST"
  setup_node
  setup_stage_backend
  setup_install_service
  trap - EXIT
  setup_print_summary
}
if [[ ${BASH_SOURCE[0]} == "$0" ]]; then setup_main "$@"; fi
