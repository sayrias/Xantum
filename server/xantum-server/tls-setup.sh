#!/usr/bin/env bash
# Sourced by setup.sh; tests may source this file without changing the host.
TLS_SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
tls_error() { printf '[TLS] %s\n' "$*" >&2; return 1; }
tls_is_ip() { [[ "$1" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; }
tls_validate_host() {
  local host=$1 part label
  local -a parts labels
  [[ ${#host} -le 253 && "$host" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9]$ && "$host" != *..* ]] || return 1
  if tls_is_ip "$host"; then
    IFS=. read -ra parts <<< "$host"
    for part in "${parts[@]}"; do ((10#$part <= 255)) || return 1; done
  else
    [[ ! "$host" =~ ^[0-9.]+$ && "$host" == *.* ]] || return 1
    IFS=. read -ra labels <<< "$host"
    for label in "${labels[@]}"; do [[ ${#label} -le 63 && "$label" != -* && "$label" != *- ]] || return 1; done
  fi
}

tls_validate_pair() {
  local cert=$1 key=$2 host=$3 cert_public key_public
  [[ "$cert" =~ ^/[a-zA-Z0-9_./-]+$ && "$key" =~ ^/[a-zA-Z0-9_./-]+$ ]] || { tls_error 'Sertifika yolları mutlak ve boşluksuz olmalı.'; return 1; }
  [[ -f "$cert" && -r "$cert" && -f "$key" && -r "$key" ]] || { tls_error 'Sertifika veya özel anahtar okunamıyor.'; return 1; }
  tls_validate_host "$host" || { tls_error 'Geçerli IPv4 / alan adı gerekli.'; return 1; }
  openssl x509 -in "$cert" -noout -checkend 3600 >/dev/null 2>&1 || { tls_error 'Sertifika geçersiz veya bir saatten az ömrü kalmış.'; return 1; }
  cert_public=$(openssl x509 -in "$cert" -pubkey -noout | openssl pkey -pubin -outform DER | openssl dgst -sha256) || return 1
  key_public=$(openssl pkey -in "$key" -passin pass: -pubout -outform DER 2>/dev/null | openssl dgst -sha256) || return 1
  [[ "$cert_public" == "$key_public" ]] || { tls_error 'Sertifika ile özel anahtar eşleşmiyor.'; return 1; }
  local -a match=(-verify_hostname "$host")
  tls_is_ip "$host" && match=(-verify_ip "$host")
  openssl verify -purpose sslserver "${match[@]}" -untrusted "$cert" "$cert" >/dev/null 2>&1 || {
    tls_error 'Güven zinciri veya IP / alan adı eşleşmesi doğrulanamadı. fullchain.pem kullanın.'; return 1;
  }
}

tls_check_http_port() {
  local listeners host=${1:-${PUBLIC_HOST:-}}
  TLS_HTTP_AUTHENTICATOR=standalone
  TLS_HTTP_WEBROOT=''
  listeners=$(ss -H -ltn '( sport = :80 )') || { tls_error 'TCP 80 durumu denetlenemedi.'; return 1; }
  [[ -n "$listeners" || -n ${XANTUM_ACME_WEBROOT:-} ]] || return 0
  tls_validate_host "$host" || { tls_error 'Mevcut HTTP sitesi için geçerli sunucu adresi gerekli.'; return 1; }
  local -a probe=(python3 "$TLS_SCRIPT_DIR/acme-webroot.py" --host "$host")
  [[ -z ${XANTUM_ACME_WEBROOT:-} ]] || probe+=(--webroot "$XANTUM_ACME_WEBROOT")
  printf '[TLS] Mevcut HTTP sitesi korunarak ACME web kökü denetleniyor…\n' >&2
  TLS_HTTP_WEBROOT=$("${probe[@]}") || return 1
  [[ -n "$TLS_HTTP_WEBROOT" && "$TLS_HTTP_WEBROOT" == /* ]] || { tls_error 'HTTP web kökü doğrulanamadı.'; return 1; }
  TLS_HTTP_AUTHENTICATOR=webroot
  printf '[TLS] Doğrulanan web kökü: %s · Nginx/site yapılandırması değişmedi.\n' "$TLS_HTTP_WEBROOT" >&2
}

tls_ensure_certbot() {
  local candidate
  candidate=$(command -v certbot || true)
  if [[ -n "$candidate" ]] && "$candidate" --version 2>/dev/null | python3 -c 'import re,sys; m=re.search(r"(\d+)\.(\d+)",sys.stdin.read()); sys.exit(0 if m and tuple(map(int,m.groups())) >= (5,4) else 1)'; then
    CERTBOT_BIN=$candidate; return
  fi
  printf '[TLS] IP desteği olan Certbot 5.9.0 ayrı Python ortamına kuruluyor…\n'
  python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)' || { tls_error 'Python 3.10+ gerekli (Ubuntu 22.04 / Debian 12 veya üzeri önerilir).'; return 1; }
  [[ -x /opt/xantum-certbot/bin/python ]] || python3 -m venv /opt/xantum-certbot
  /opt/xantum-certbot/bin/python -m pip install --disable-pip-version-check 'certbot==5.9.0'
  CERTBOT_BIN=/opt/xantum-certbot/bin/certbot
}

tls_renewal_matches_http() {
  python3 - "$1" "$2" "${TLS_HTTP_AUTHENTICATOR:-standalone}" "${TLS_HTTP_WEBROOT:-}" <<'PY'
import ast, configparser, os, sys
file, host, method, root = sys.argv[1:]
config = configparser.ConfigParser(interpolation=None, strict=False)
try:
    with open(file, encoding='utf-8') as source:
        # ConfigObj renewal files have certificate metadata before the first
        # [renewalparams] section. ConfigParser needs a synthetic top section.
        config.read_string('[certificate]\n' + source.read())
    if config.get('renewalparams', 'authenticator') != method:
        sys.exit(1)
    if method == 'standalone':
        sys.exit(0)
    def path_value(value):
        value = value.strip()
        if value.startswith(('"', "'")):
            value = ast.literal_eval(value)
            if isinstance(value, tuple) and len(value) == 1:
                value = value[0]
        else:
            value = value.rstrip(',').strip()
        return value if isinstance(value, str) else ''
    # ConfigObj's [[webroot_map]] becomes [webroot_map] in ConfigParser.
    if config.has_option('[webroot_map]', host):
        saved = path_value(config.get('[webroot_map]', host))
    else:
        saved = path_value(config.get('renewalparams', 'webroot_path', fallback=''))
    sys.exit(0 if saved and os.path.realpath(saved) == os.path.realpath(root) else 1)
except (OSError, ValueError, SyntaxError, configparser.Error):
    sys.exit(1)
PY
}

tls_sync_renewal_http() {
  local host=$1 cert_name="xantum-$1" config="/etc/letsencrypt/renewal/xantum-$1.conf"
  # certonly may retain a not-yet-due certificate and its former standalone
  # renewal settings. Reconfigure only that existing mismatch, using Certbot's
  # staging validation and atomic settings update, never editing renewal files.
  [[ -f "$config" ]] || return 0
  tls_renewal_matches_http "$config" "$host" && return 0
  local -a args=(reconfigure --cert-name "$cert_name" --non-interactive)
  if [[ ${TLS_HTTP_AUTHENTICATOR:-standalone} == webroot ]]; then
    args+=(--authenticator webroot --webroot-path "$TLS_HTTP_WEBROOT")
  else
    args+=(--authenticator standalone --http-01-address 0.0.0.0)
  fi
  printf '[TLS] Mevcut sertifikanın otomatik yenileme yöntemi güncelleniyor…\n'
  "$CERTBOT_BIN" "${args[@]}" || {
    tls_error 'Mevcut sertifikanın yenileme yöntemi doğrulanamadı. HTTP erişimini düzeltip kurulumu tekrarlayın.'; return 1;
  }
  tls_renewal_matches_http "$config" "$host" || { tls_error 'Certbot yeni yenileme yöntemini kaydetmedi.'; return 1; }
}

tls_install_renewal() {
  local cert_name="xantum-$1"
  install -d -m 755 /usr/local/libexec/xantum
  {
    printf '#!/usr/bin/env bash\nset -euo pipefail\n'
    printf '[[ ${RENEWED_LINEAGE:-} == /etc/letsencrypt/live/%s ]] || exit 0\n' "$cert_name"
    printf 'grep -Fqx "TLS_CERT=$RENEWED_LINEAGE/fullchain.pem" /opt/xantum-backend/.env 2>/dev/null || exit 0\n'
    printf 'systemctl try-reload-or-restart xantum-backend.service\n'
  } > /usr/local/libexec/xantum/certificate-deployed
  chmod 755 /usr/local/libexec/xantum/certificate-deployed
  # A distribution/snap Certbot timer may renew first. Its default hook directory
  # must also reload our live TLS contexts; do not disable another timer.
  install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
  install -m 755 /usr/local/libexec/xantum/certificate-deployed /etc/letsencrypt/renewal-hooks/deploy/xantum-backend
  {
    printf '#!/usr/bin/env bash\nset -euo pipefail\n'
    printf 'exec %q renew --cert-name %q --quiet --no-directory-hooks --deploy-hook /usr/local/libexec/xantum/certificate-deployed' "$CERTBOT_BIN" "$cert_name"
    if [[ ${TLS_HTTP_AUTHENTICATOR:-standalone} == webroot ]]; then
      printf ' --authenticator webroot --webroot-path %q\n' "$TLS_HTTP_WEBROOT"
    else
      printf ' --authenticator standalone --http-01-address 0.0.0.0\n'
    fi
  } > /usr/local/libexec/xantum/renew-certificate
  chmod 755 /usr/local/libexec/xantum/renew-certificate
  cat > /etc/systemd/system/xantum-certificate.service <<'SERVICE'
[Unit]
Description=Renew Xantum TLS certificate
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/libexec/xantum/renew-certificate
SERVICE
  cat > /etc/systemd/system/xantum-certificate.timer <<'TIMER'
[Unit]
Description=Check Xantum certificate renewal every four hours

[Timer]
OnBootSec=15min
OnUnitActiveSec=4h
RandomizedDelaySec=10min
Persistent=true

[Install]
WantedBy=timers.target
TIMER
  systemctl daemon-reload
  systemctl enable --now xantum-certificate.timer
  systemctl is-active --quiet xantum-certificate.timer || { tls_error 'Otomatik yenileme zamanlayıcısı başlatılamadı.'; return 1; }
}

tls_configure_auto() {
  local host=$1 cert_name="xantum-$1"
  tls_validate_host "$host" || { tls_error 'Geçerli IPv4 / alan adı gerekli.'; return 1; }
  [[ ${LE_AGREE_TOS:-0} == 1 ]] || { tls_error 'Let’s Encrypt koşulları kabul edilmeli. Kolay kurulum: bash xantum.sh'; return 1; }
  if tls_is_ip "$host"; then
    python3 -c 'import ipaddress,sys; sys.exit(0 if ipaddress.ip_address(sys.argv[1]).is_global else 1)' "$host" || {
      tls_error 'İnternete açık genel IPv4 adresi gerekli.'; return 1;
    }
  fi
  tls_check_http_port "$host" || return 1
  tls_ensure_certbot || return 1
  local -a args=(certonly --preferred-challenges http
    --non-interactive --agree-tos --register-unsafely-without-email --keep-until-expiring --cert-name "$cert_name")
  if [[ ${TLS_HTTP_AUTHENTICATOR:-standalone} == webroot ]]; then
    args+=(--webroot --webroot-path "$TLS_HTTP_WEBROOT")
  else
    args+=(--standalone --http-01-address 0.0.0.0)
  fi
  if tls_is_ip "$host"; then args+=(--preferred-profile shortlived --ip-address "$host"); else args+=(-d "$host"); fi
  printf '[TLS] %s için sertifika alınıyor. Dışarıdan TCP 80 erişimi gerekli.\n' "$host"
  "$CERTBOT_BIN" "${args[@]}" || {
    tls_error 'Sertifika alınamadı. Sağlayıcı panelinde TCP 80’i açın; alan adında A/AAAA kayıtlarını kontrol edin. TLS doğrulaması kapatılmadı. Düzeltip kurulumu tekrarlayın.'; return 1;
  }
  tls_sync_renewal_http "$host" || return 1
  TLS_CERT="/etc/letsencrypt/live/$cert_name/fullchain.pem"
  TLS_KEY="/etc/letsencrypt/live/$cert_name/privkey.pem"
  tls_validate_pair "$TLS_CERT" "$TLS_KEY" "$host" || return 1
  tls_install_renewal "$host"
}
