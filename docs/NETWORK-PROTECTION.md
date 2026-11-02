# Traffic protection and recovery

Xantum routes system IPv4 traffic through its tunnel. External IPv6 traffic is blocked rather than tunneled. The desktop client does not offer per-application or per-site routing.

## What happens when you connect

The app resolves the server address, installs the protection rules, then opens the verified TLS connection and tunnel. Physical network access is limited to the configured server's API/XTP TCP ports and narrowly scoped DHCP renewal. API and XTP must use the same hostname.

DNS uses **1.1.1.1** through the tunnel. This protects the client-to-VPN-server path; it does not add a separate encrypted DNS connection between the server and resolver. IPv4 DoH/DoT traffic follows the normal tunnel route. Direct LAN and multicast traffic are blocked; loopback remains available.

Existing application connections may need to reconnect after changing networks. Corporate DNS policies or restrictive firewalls can prevent name resolution or connectivity.

## If the connection drops

An unexpected tunnel, helper or application failure leaves the traffic lock in place. Xantum does not silently fall back to your physical internet connection.

- Reopen the app and use **Check protection status** if the previous session is shown as unverified.
- Reconnect to the same server, or choose **Restore internet access** to remove Xantum's protection rules.
- Disconnecting intentionally or quitting the app normally removes the rules owned by that session.
- If cleanup fails, the app reports an error. Do not disable the system firewall as a workaround.

Remove the current protection before changing to another server. If the server IP or your network changes, you may need to restore internet access and connect again.

## Manual recovery

Prefer the app's recovery action. If it cannot open, run these on Linux as the same desktop user:

```bash
pkexec /usr/local/libexec/xantum/network-protection-linux.py status
pkexec /usr/local/libexec/xantum/network-protection-linux.py release
```

On Windows, open an administrator terminal with the same account and run the installed helper:

```text
resources\bin\xtp-tun-helper.exe --protect status
resources\bin\xtp-tun-helper.exe --protect release
```

These commands remove only Xantum-owned state. A different account's records are not automatically removed.

## Limits

Linux protection is not retained across an OS reboot. Windows filter and DNS records are persistent and may require recovery after reboot. Xantum does not provide a separate service that protects traffic from system startup.

Linux packet behavior has been checked in an isolated network namespace. Windows native sources compile, but real Windows WFP/DNS behavior and different desktop network configurations still require device testing. A connected indicator is not a guarantee that every network scenario has been verified.

TLS protects transport to your server; the destination's HTTPS or other protocol determines protection beyond it. XTP has not received an independent security audit.
