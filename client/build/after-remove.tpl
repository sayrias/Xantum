#!/bin/bash
set -e
# Keep the new version's helpers and firewall recovery during package upgrades.
case "$1" in upgrade|failed-upgrade|abort-upgrade) exit 0 ;; esac
if [ -f /run/xantum-protection/state.json ]; then
  owner_uid=$(/usr/bin/python3 -I -c 'import json,os,pathlib; p=pathlib.Path("/run/xantum-protection/state.json"); s=p.lstat(); assert not p.is_symlink() and s.st_uid==0 and not s.st_mode & 0o022 and s.st_size<65536; u=json.loads(p.read_text())["owner"]; assert type(u) is int and u>=0; print(u)')
  # The separately copied helper still exists after the app payload is removed.
  # Failure leaves it installed, preserving explicit recovery rather than leaking.
  PKEXEC_UID="$owner_uid" /usr/local/libexec/xantum/network-protection-linux.py release
fi
rm -f /usr/local/libexec/xantum/xtp-tun-helper /usr/local/libexec/xantum/network-protection-linux.py
rm -f /usr/share/polkit-1/actions/org.xantum.helpers.policy
rmdir /usr/local/libexec/xantum 2>/dev/null || true


# Delete the link to the binary
# update-alternatives --remove <name> <path>: 'path' must be the registered alternative binary,
# not the generic symlink — see https://man7.org/linux/man-pages/man1/update-alternatives.1.html
if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove '${executable}' '/opt/${sanitizedProductName}/${executable}'
else
    rm -f '/usr/bin/${executable}'
fi

APPARMOR_PROFILE_DEST='/etc/apparmor.d/${executable}'

# Remove and unload apparmor profile.
if [ -f "$APPARMOR_PROFILE_DEST" ]; then
  # Unload the profile from the running kernel before deleting the file so the
  # policy is not left enforced until the next reboot.  Mirror the chroot guard
  # used in the after-install script — live AppArmor operations are not
  # meaningful inside a chroot.
  # https://wiki.debian.org/AppArmor/HowToUse
  if apparmor_status --enabled > /dev/null 2>&1; then
    if ! { [ -x '/usr/bin/ischroot' ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
      apparmor_parser --remove "$APPARMOR_PROFILE_DEST" || true
    fi
  fi
  rm -f "$APPARMOR_PROFILE_DEST"
fi
