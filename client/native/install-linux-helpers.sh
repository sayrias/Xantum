#!/usr/bin/env bash
set -euo pipefail

# Run this explicit administrator installer from a reviewed source checkout.
# Electron itself must run as the normal desktop user.
if [ "$(id -u)" != 0 ]; then
  echo 'Yönetici kurulumu gerekli: sudo bash client/native/install-linux-helpers.sh' >&2
  exit 1
fi
script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
project_dir=$(CDPATH='' cd -- "$script_dir/../.." && pwd)
for dependency in gcc python3 nft pkexec; do
  command -v "$dependency" >/dev/null || { echo "Eksik bağımlılık: $dependency" >&2; exit 1; }
done
build_dir=$(mktemp -d)
trap 'rm -rf -- "$build_dir"' EXIT
gcc -Wall -Wextra -Werror -O2 -D_FORTIFY_SOURCE=2 -o "$build_dir/xtp-tun-helper" "$project_dir/server/xantum-server/xtp-tun.c"
install -d -m 0755 -o root -g root /usr/local/libexec/xantum
install -m 0755 -o root -g root "$build_dir/xtp-tun-helper" /usr/local/libexec/xantum/xtp-tun-helper
install -m 0755 -o root -g root "$script_dir/network-protection-linux.py" /usr/local/libexec/xantum/network-protection-linux.py
install -m 0644 -o root -g root "$script_dir/org.xantum.helpers.policy" /usr/share/polkit-1/actions/org.xantum.helpers.policy
echo 'Xantum yardımcıları kuruldu. Uygulamayı masaüstü kullanıcınızla açın; bağlantı için polkit yönetici onayı ister.'
