# Build the desktop client

Use Node.js **22.12+**, npm and the lockfiles in this repository. Build output is written to `client/dist-electron/`.

## Build wizard

```bash
bash xantum.sh
```

Choose **2**, then Windows or Linux. Select:

- **Public package:** no server address or access key is included.
- **Preconfigured connection:** enter your own address and key for a private package. Anyone with that package can extract the key; do not upload it publicly.

The wizard prepares or checks native components, runs validation and packages the app. Windows packaging on Linux needs Wine or a working Docker setup.

## Install dependencies and check sources

```bash
npm ci --prefix client
npm ci --prefix server/xantum-server/backend
npm test --prefix client
npm run build:ui --prefix client
```

Tests open temporary localhost connections. Linux native checks require GCC and development headers. These checks do not replace connection tests on the target operating system.

## Linux x64

GCC is needed to compile the TUN helper:

```bash
mkdir -p client/bin
gcc -Wall -Wextra -Werror -O2 -D_FORTIFY_SOURCE=2 \
  -o client/bin/xtp-tun-helper server/xantum-server/xtp-tun.c
npm run build:linux --prefix client
```

The Debian installer installs the protected helpers and polkit policy. AppImage/source installations prepare missing helpers on the first connection with administrator approval. The manual alternative is:

```bash
sudo bash client/native/install-linux-helpers.sh
```

Runtime requirements include Python 3, nftables, iproute2 and pkexec/polkit. Helper installation does not start a VPN connection. Run the desktop app as your normal user.

## Windows x64

With MinGW-w64 on Linux:

```bash
x86_64-w64-mingw32-gcc -Wall -Wextra -Werror -O2 \
  -o client/bin/xtp-tun-helper.exe client/native/xtp-tun-win.c \
  -lws2_32 -liphlpapi -lole32 -lfwpuclnt -ladvapi32 -static -static-libgcc
```

Place the AMD64 `wintun.dll` and its distribution license from the [official Wintun package](https://www.wintun.net/) in `client/bin/`. Wintun provides the virtual adapter; it does not require the WireGuard protocol or application.

```bash
npm run build:win --prefix client
```

Windows is recommended for NSIS packaging; Linux cross-packaging needs Wine or Docker. Packaging stops if a required helper or DLL is missing.

## UI development

```bash
npm run dev --prefix client
```

For a browser-only preview, use `npm run dev:ui --prefix client`. A browser preview cannot create a VPN or save Electron server settings. A real connection requires the native helper, OS permission and a configured server.

Keep public artifacts free of keys, profiles, `.env` files and logs. Test installation, connection, disconnection and recovery on each supported OS before distributing a package.
