#!/usr/bin/env bash
# Xantum client build wizard. No host networking or sudoers changes.
set -euo pipefail
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
CLIENT_DIR="$SCRIPT_DIR/../client"
BIN_DIR="$CLIENT_DIR/bin"
profile_dir=''
cleanup() { [[ -z "$profile_dir" ]] || rm -rf -- "$profile_dir"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# A previous invocation must never silently select a private package.
unset XANTUM_CONNECTION_PROFILE
printf '\nXantum · İstemcini hazırla\n\n'
for tool in node npm; do command -v "$tool" >/dev/null || { printf 'Eksik araç: %s\n' "$tool" >&2; exit 1; }; done
node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)' || { printf 'Node.js 22.12 veya üzeri gerekli.\n' >&2; exit 1; }
printf 'Bağlantı nasıl hazırlansın?\n\n1) Uygulamada yapılandır · Genel dağıtım\n   Sunucu ve katılım anahtarı uygulama ayarlarından bir kez girilir.\n2) Hazır bağlantı · Özel dağıtım\n   Sunucu ve anahtar bu derlemeye eklenir; ilk açılışta hazır olur.\n   Paketi alan kişi anahtarı çıkarabilir. Yalnız güvendiğin kişilerle paylaş.\n\n'
read -r -p 'Bağlantı biçimi [1]: ' connection_mode
case ${connection_mode:-1} in
  1) private_build=false ;;
  2)
    private_build=true
    export -n profile_pin 2>/dev/null || true
    read -r -p 'Sunucu IP adresi veya alan adı: ' profile_host
    if [[ -t 0 ]]; then read -r -s -p 'Katılım anahtarı (gizli giriş): ' profile_pin; printf '\n';
    else read -r profile_pin; fi
    read -r -p 'API / sohbet portu [51821]: ' profile_api
    read -r -p 'XTP portu [8443]: ' profile_xtp
    profile_dir=$(mktemp -d /tmp/xantum-profile.XXXXXX)
    chmod 700 "$profile_dir"
    printf '%s\0' "$profile_host" "$profile_pin" "${profile_api:-51821}" "${profile_xtp:-8443}" |
      node "$CLIENT_DIR/build/connection-profile.cjs" "$profile_dir/connection-profile.json"
    unset profile_pin
    export XANTUM_CONNECTION_PROFILE="$profile_dir/connection-profile.json"
    printf 'Hazır bağlantı eklendi. Anahtar derleme çıktısında gösterilmeyecek.\n'
    ;;
  *) printf 'Geçersiz bağlantı biçimi.\n' >&2; exit 1 ;;
esac
printf '\n1) Linux · AppImage + deb\n2) Windows · NSIS exe\n3) Windows + Linux\n\n'
read -r -p 'Hedef platform [1]: ' platform
platform=${platform:-1}
case "$platform" in 1|2|3) ;; *) printf 'Geçersiz platform.\n' >&2; exit 1 ;; esac
mkdir -p "$BIN_DIR"
if [[ "$platform" == 1 || "$platform" == 3 ]]; then
  command -v gcc >/dev/null || { printf 'Linux derlemesi için GCC gerekli.\n' >&2; exit 1; }
  printf '\nLinux TUN yardımcısı derleniyor…\n'
  gcc -Wall -Wextra -Werror -O2 -D_FORTIFY_SOURCE=2 -o "$BIN_DIR/xtp-tun-helper" "$SCRIPT_DIR/../server/xantum-server/xtp-tun.c"
fi
win_method=''
if [[ "$platform" == 2 || "$platform" == 3 ]]; then
  for file in xtp-tun-helper.exe wintun.dll; do
    [[ -s "$BIN_DIR/$file" ]] || { printf 'Windows bileşeni eksik: %s. Önce bash scripts/compile-win-tun.sh çalıştır.\n' "$file" >&2; exit 1; }
  done
  if command -v wine >/dev/null; then win_method=wine
  elif command -v docker >/dev/null && docker info >/dev/null 2>&1; then win_method=docker
  else printf 'Windows paketlemek için Wine veya çalışan Docker gerekli. Ayrıntılar: docs/BUILDING.md\n' >&2; exit 1; fi
fi
cd "$CLIENT_DIR"
printf '\nKilit dosyasındaki bağımlılıklar hazırlanıyor…\n'
npm ci --no-audit --no-fund
printf '\nDerlemeden önce uygulamayı açıp denemek ister misin?\n'
read -r -p 'Yerel uygulama testi [h]: ' preview
if [[ ${preview:-h} =~ ^[EeYy]$ ]]; then
  printf 'Uygulamada gerekirse “Korumayı kur” adımını kullan. Test bitince uygulamadan çık. Ctrl+C derlemeyi iptal eder.\n'
  npm run dev || printf 'Önizleme kapandı. Derleme devam ediyor.\n'
fi
build_windows() {
  if [[ "$win_method" == wine ]]; then npm run build:win
  else
    local -a extra_mount=()
    if [[ "$private_build" == true ]]; then
      extra_mount=(--mount "type=bind,source=$profile_dir,target=/xantum-profile,readonly" --env XANTUM_CONNECTION_PROFILE=/xantum-profile/connection-profile.json)
    fi
    docker run --rm --mount "type=bind,source=$CLIENT_DIR,target=/project" -w /project \
      "${extra_mount[@]}" electronuserland/builder:wine /bin/bash -c 'npm ci --no-audit --no-fund && npm run build:win'
  fi
}
case "$platform" in
  1) npm run build:linux ;;
  2) build_windows ;;
  3) npm run build:linux; build_windows ;;
esac
if [[ "$private_build" == true ]]; then output="$CLIENT_DIR/dist-electron/private"; else output="$CLIENT_DIR/dist-electron"; fi
printf '\nDerleme tamamlandı\nÇıktı klasörü:\n  %s\n' "$output"
if [[ "$private_build" == true ]]; then printf 'Hazır bağlantı paketi özeldir; herkese açık GitHub sürümüne yükleme.\n'; fi
