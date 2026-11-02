#!/usr/bin/env bash
# Run locally; SSH host-key verification and normal authentication stay enabled.
set -euo pipefail
deploy_validate_host() {
  local host=$1 label part
  local -a labels parts
  [[ ${#host} -le 253 && "$host" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9]$ && "$host" != *..* ]] || return 1
  if [[ "$host" =~ ^[0-9.]+$ ]]; then
    [[ "$host" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || return 1
    IFS=. read -ra parts <<< "$host"
    for part in "${parts[@]}"; do ((10#$part <= 255)) || return 1; done
  else
    IFS=. read -ra labels <<< "$host"
    for label in "${labels[@]}"; do [[ ${#label} -le 63 && "$label" != -* && "$label" != *- ]] || return 1; done
  fi
}
deploy_validate_user() { [[ "$1" =~ ^[a-zA-Z_][a-zA-Z0-9_-]*$ ]]; }
deploy_validate_port() { [[ "$1" =~ ^[0-9]{1,5}$ ]] && ((10#$1 >= 1 && 10#$1 <= 65535)); }
deploy_validate_path() { [[ "$1" =~ ^/[a-zA-Z0-9_./-]+$ ]]; }

deploy_main() {
  local script_dir server_dir server_host server_user server_port tls_mode public_host tls_cert='' tls_key=''
  local archive remote remote_dir='' command answer acme_webroot=${XANTUM_ACME_WEBROOT:-}
  script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
  server_dir="$script_dir/../server/xantum-server"
  printf '\nXantum · Sunucunu hazırla\nIP adresi yeterli. Güvenilir TLS sertifikası ve yenilemesi otomatik hazırlanır.\n\n'
  read -r -p 'VDS alan adı / IPv4: ' server_host
  read -r -p 'SSH kullanıcı adı [root]: ' server_user
  read -r -p 'SSH portu [22]: ' server_port
  server_user=${server_user:-root}; server_port=${server_port:-22}
  deploy_validate_host "$server_host" || { echo 'Geçersiz sunucu adresi.' >&2; return 1; }
  deploy_validate_user "$server_user" || { echo 'Geçersiz SSH kullanıcısı.' >&2; return 1; }
  deploy_validate_port "$server_port" || { echo 'Geçersiz SSH portu.' >&2; return 1; }
  [[ -z "$acme_webroot" ]] || deploy_validate_path "$acme_webroot" || { echo 'XANTUM_ACME_WEBROOT sunucuda mutlak, boşluksuz bir yol olmalı.' >&2; return 1; }
  printf '\n1) Otomatik güvenli kurulum (önerilen)\n2) Mevcut sertifikamı kullan (gelişmiş)\n'
  read -r -p 'Sertifika yöntemi [1]: ' tls_mode
  case ${tls_mode:-1} in 1) tls_mode=auto;; 2) tls_mode=existing;; *) echo 'Geçersiz yöntem.' >&2; return 1;; esac
  read -r -p "Uygulamada kullanılacak IP / alan adı [$server_host]: " public_host
  public_host=${public_host:-$server_host}; public_host=${public_host,,}
  deploy_validate_host "$public_host" || { echo 'Geçersiz uygulama adresi.' >&2; return 1; }
  if [[ "$tls_mode" == existing ]]; then
    printf 'Bu dosyalar VDS üzerinde bulunmalı; bilgisayarınızdaki dosyalar yüklenmez.\n'
    read -r -p 'Sunucudaki fullchain.pem dosyasının tam yolu: ' tls_cert
    read -r -p 'Sunucudaki privkey.pem dosyasının tam yolu: ' tls_key
    deploy_validate_path "$tls_cert" && deploy_validate_path "$tls_key" || { echo 'Yollar / ile başlamalı ve boşluk içermemeli.' >&2; return 1; }
  else
    printf '\nLet’s Encrypt ücretsiz, doğrulanabilir sertifika düzenleyecek.\nKoşullar: https://letsencrypt.org/repository/\n'
    printf 'VDS ve sağlayıcı güvenlik duvarında TCP 80 açık kalmalı. Nginx varsa web dizini üzerinden doğrulama denenir; servis durdurulmaz.\n'
    printf 'Alan adı kullanıyorsanız DNS kaydı bu VDS’ye yönlenmeli. IP ile alan adı gerekmez.\n'
    read -r -p 'Koşulları kabul edip kurulumu başlat? [E/h]: ' answer
    [[ ${answer:-E} =~ ^[EeYy]$ ]] || { echo 'Kurulum iptal edildi.'; return 1; }
  fi
  for command in ssh scp tar; do command -v "$command" >/dev/null || { echo "Eksik araç: $command" >&2; return 1; }; done
  archive=$(mktemp /tmp/xantum-deploy.XXXXXX.tar.gz)
  trap "rm -f -- '$archive'" EXIT
  # Explicit allowlist excludes .env, keys, logs, node_modules and local config.
  tar -czf "$archive" -C "$server_dir" setup.sh tls-setup.sh acme-webroot.py xtp-tun.c \
    backend/server.js backend/chat.js backend/xtp-server.js backend/tls-reload.js backend/package.json backend/package-lock.json
  remote="${server_user}@${server_host}"
  remote_dir=$(ssh -p "$server_port" "$remote" 'mktemp -d /tmp/xantum-deploy.XXXXXX')
  [[ "$remote_dir" =~ ^/tmp/xantum-deploy\.[a-zA-Z0-9]+$ ]] || { echo 'Uzak geçici dizin doğrulanamadı.' >&2; return 1; }
  if ! scp -P "$server_port" "$archive" "$remote:$remote_dir/source.tar.gz"; then
    ssh -p "$server_port" "$remote" "rm -rf -- '$remote_dir'" || true
    echo 'Kaynak yüklenemedi; SSH erişimini denetleyin.' >&2; return 1
  fi
  printf '\nKaynak yüklendi. Ubuntu kullanıcısında sudo parolanız istenebilir.\n'
  # All interpolated values pass strict allowlists. Passwords never enter this command.
  command="set -eu; trap 'rm -rf -- $remote_dir' EXIT; tar -xzf '$remote_dir/source.tar.gz' -C '$remote_dir'; cd '$remote_dir'; if [ \"\$(id -u)\" -eq 0 ]; then set --; else command -v sudo >/dev/null || { echo 'Bu SSH kullanıcısı için sudo gerekli.' >&2; exit 1; }; set -- sudo; fi; \"\$@\" env PUBLIC_HOST='$public_host' TLS_MODE='$tls_mode' TLS_CERT='$tls_cert' TLS_KEY='$tls_key' SSH_PORT='$server_port' XANTUM_ACME_WEBROOT='$acme_webroot' LE_AGREE_TOS=1 bash setup.sh --auto"
  if ! ssh -t -p "$server_port" "$remote" "$command"; then
    echo 'Kurulum tamamlanmadı. Yukarıdaki açıklamayı düzeltip aynı komutu yeniden çalıştırabilirsiniz.' >&2; return 1
  fi
  rm -f -- "$archive"; trap - EXIT
  printf '\nKurulum tamamlandı. Sunucu çıktısındaki katılım anahtarını özel olarak saklayın.\n'
}
if [[ ${BASH_SOURCE[0]} == "$0" ]]; then deploy_main "$@"; fi
