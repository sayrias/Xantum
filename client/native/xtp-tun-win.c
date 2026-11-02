/*
 * xtp-tun-win.c — Xantum TUN Yardımcı Programı (Windows / WinTun)
 *
 * Derleme (MinGW-w64 ile Linux'ta cross-compile):
 *   x86_64-w64-mingw32-gcc -O2 -o xtp-tun-helper.exe xtp-tun-win.c \
 *       -lws2_32 -liphlpapi -lole32 -lfwpuclnt -static -static-libgcc
 *
 * Çalışma zamanında wintun.dll aynı dizinde olmalı.
 * Admin (Yönetici) yetkisi gerektirir.
 *
 * Kullanım:
 *   xtp-tun-helper.exe xtp0 10.8.0.2 255.255.255.0 1380
 *
 * Protokol (stdin/stdout — Linux sürümüyle aynı):
 *   [2B büyük-endian uzunluk][IP paketi]
 */

#define _WIN32_WINNT 0x0601
#include <winsock2.h>
#include <ws2tcpip.h>
#include <stdlib.h>
#include <windows.h>
#include <fcntl.h>
#include <io.h>
#include <stdio.h>
#include <stdint.h>
#include <string.h>
#include "network-protection-win.h"

/* ================================================================
 * WinTun tip tanımları (wintun.h'a gerek yok, dinamik yükleme)
 * ================================================================ */

typedef void *WINTUN_ADAPTER_HANDLE;
typedef void *WINTUN_SESSION_HANDLE;

/* Fonksiyon pointer tipleri — ad kalıbı: fn_t */
typedef WINTUN_ADAPTER_HANDLE (WINAPI *fn_CreateAdapter)(
    LPCWSTR Name, LPCWSTR TunnelType, const GUID *RequestedGUID);

typedef void (WINAPI *fn_CloseAdapter)(WINTUN_ADAPTER_HANDLE Adapter);

typedef WINTUN_SESSION_HANDLE (WINAPI *fn_StartSession)(
    WINTUN_ADAPTER_HANDLE Adapter, DWORD Capacity);

typedef void (WINAPI *fn_EndSession)(WINTUN_SESSION_HANDLE Session);

typedef BYTE *(WINAPI *fn_ReceivePacket)(
    WINTUN_SESSION_HANDLE Session, DWORD *PacketSize);

typedef void (WINAPI *fn_ReleaseReceivePacket)(
    WINTUN_SESSION_HANDLE Session, const BYTE *Packet);

typedef BYTE *(WINAPI *fn_AllocateSendPacket)(
    WINTUN_SESSION_HANDLE Session, DWORD PacketSize);

typedef void (WINAPI *fn_SendPacket)(
    WINTUN_SESSION_HANDLE Session, const BYTE *Packet);

typedef HANDLE (WINAPI *fn_GetReadWaitEvent)(WINTUN_SESSION_HANDLE Session);

/* Global fonksiyon pointerleri */
static fn_CreateAdapter          WT_CreateAdapter;
static fn_CloseAdapter           WT_CloseAdapter;
static fn_StartSession           WT_StartSession;
static fn_EndSession             WT_EndSession;
static fn_ReceivePacket          WT_ReceivePacket;
static fn_ReleaseReceivePacket   WT_ReleaseReceivePacket;
static fn_AllocateSendPacket     WT_AllocateSendPacket;
static fn_SendPacket             WT_SendPacket;
static fn_GetReadWaitEvent       WT_GetReadWaitEvent;

static HMODULE hWintun = NULL;

/* WinTun DLL'ini yükle, fonksiyon adreslerini al */
static int wintun_load(void) {
    hWintun = LoadLibraryExW(L"wintun.dll", NULL,
                             LOAD_LIBRARY_SEARCH_APPLICATION_DIR |
                             LOAD_LIBRARY_SEARCH_DEFAULT_DIRS);

    if (!hWintun) {
        fprintf(stderr, "[xtp-win] wintun.dll yuklenemedi (hata: %lu)\n", GetLastError());
        fprintf(stderr, "[xtp-win] wintun.dll'yi xtp-tun-helper.exe ile ayni klasore koyun.\n");
        return 0;
    }

#define LOAD_FN(ptr, name) \
    ptr = (void*)GetProcAddress(hWintun, name); \
    if (!(ptr)) { fprintf(stderr, "[xtp-win] " name " bulunamadi\n"); return 0; }

    LOAD_FN(WT_CreateAdapter,        "WintunCreateAdapter")
    LOAD_FN(WT_CloseAdapter,         "WintunCloseAdapter")
    LOAD_FN(WT_StartSession,         "WintunStartSession")
    LOAD_FN(WT_EndSession,           "WintunEndSession")
    LOAD_FN(WT_ReceivePacket,        "WintunReceivePacket")
    LOAD_FN(WT_ReleaseReceivePacket, "WintunReleaseReceivePacket")
    LOAD_FN(WT_AllocateSendPacket,   "WintunAllocateSendPacket")
    LOAD_FN(WT_SendPacket,           "WintunSendPacket")
    LOAD_FN(WT_GetReadWaitEvent,     "WintunGetReadWaitEvent")
#undef LOAD_FN

    return 1;
}

/* stdin'den tam n bayt oku */
static int read_all(HANDLE h, BYTE *buf, DWORD n) {
    DWORD got = 0, r = 0;
    while (got < n) {
        if (!ReadFile(h, buf + got, n - got, &r, NULL) || r == 0) return -1;
        got += r;
    }
    return 0;
}

/* stdout'a tam n bayt yaz */
static int write_all(HANDLE h, const BYTE *buf, DWORD n) {
    DWORD sent = 0, w = 0;
    while (sent < n) {
        if (!WriteFile(h, buf + sent, n - sent, &w, NULL) || w == 0) return -1;
        sent += w;
    }
    return 0;
}

/* IP adresi ve MTU ayarla (netsh) */
static int configure_adapter(const char *ip, const char *mask, DWORD mtu) {
    char cmd[512];
    snprintf(cmd, sizeof(cmd),
        "netsh interface ip set address name=\"Xantum\" "
        "source=static addr=%s mask=%s >nul", ip, mask);
    if (system(cmd) != 0) return -1;

    snprintf(cmd, sizeof(cmd),
        "netsh interface ipv4 set subinterface \"Xantum\" mtu=%lu store=active >nul",
        (unsigned long)mtu);
    if (system(cmd) != 0) return -1;

    snprintf(cmd, sizeof(cmd),
        "netsh interface ip set dns name=\"Xantum\" source=static addr=1.1.1.1 >nul");
    if (system(cmd) != 0) return -1;

    snprintf(cmd, sizeof(cmd),
        "netsh interface ip add dns name=\"Xantum\" addr=8.8.8.8 index=2 >nul");
    if (system(cmd) != 0) return -1;
    return 0;
}

/* Sabit GUID — her çalıştırmada aynı adaptörü bulur */
static const GUID XANTUM_GUID = {
    0x6B5CB3AEu, 0xD3B4u, 0x4E63u,
    {0xA8u, 0xBEu, 0x12u, 0xC3u, 0xD4u, 0xE5u, 0xF6u, 0x07u}
};

/* ================================================================
 * main
 * ================================================================ */
int main(int argc, char **argv) {
    if (argc >= 3 && !strcmp(argv[1], "--protect")) return xp_protection_main(argc, argv);
    const char *ip   = (argc > 2) ? argv[2] : "10.8.0.2";
    const char *mask = (argc > 3) ? argv[3] : "255.255.255.0";
    DWORD mtu        = (argc > 4) ? (DWORD)atoi(argv[4]) : 1380;

    struct in_addr parsed;
    if (InetPtonA(AF_INET, ip, &parsed) != 1 || InetPtonA(AF_INET, mask, &parsed) != 1 || mtu < 576 || mtu > 1500) {
        fprintf(stderr, "ERROR: gecersiz IP veya MTU\n"); return 1;
    }

    /* stdout/stdin'i binary mod yap — satır sonu dönüşümü olmasın */
    _setmode(_fileno(stdin),  _O_BINARY);
    _setmode(_fileno(stdout), _O_BINARY);

    WSADATA wsa;
    WSAStartup(MAKEWORD(2, 2), &wsa);

    if (!wintun_load()) return 1;

    /* Adaptör oluştur */
    WINTUN_ADAPTER_HANDLE adapter = WT_CreateAdapter(
        L"Xantum", L"Xantum", &XANTUM_GUID);

    if (!adapter) {
        fprintf(stderr, "[xtp-win] Adaptor olusturulamadi (hata: %lu)\n", GetLastError());
        fprintf(stderr, "[xtp-win] Yonetici olarak calistirdiginizdan emin olun.\n");
        return 1;
    }

    /* Oturum başlat (512 KiB ring buffer) */
    WINTUN_SESSION_HANDLE session = WT_StartSession(adapter, 0x80000);
    if (!session) {
        fprintf(stderr, "[xtp-win] Oturum baslatılamadı (hata: %lu)\n", GetLastError());
        WT_CloseAdapter(adapter);
        return 1;
    }

    /* IP + MTU + DNS ayarla */
    if (configure_adapter(ip, mask, mtu) != 0) {
        fprintf(stderr, "ERROR: Windows adaptor ayarlari uygulanamadi\n");
        WT_EndSession(session); WT_CloseAdapter(adapter); FreeLibrary(hWintun); WSACleanup(); return 1;
    }

    HANDLE readEvent = WT_GetReadWaitEvent(session);
    HANDLE stdinH    = GetStdHandle(STD_INPUT_HANDLE);
    HANDLE stdoutH   = GetStdHandle(STD_OUTPUT_HANDLE);

    /* Hazır sinyali gönder */
    fprintf(stderr, "TUN_READY:Xantum\n");
    fflush(stderr);

    static BYTE buf[0xFFFF];
    HANDLE waitHandles[2] = { readEvent, stdinH };

    while (1) {
        /* TUN → stdout */
        DWORD pktSize = 0;
        const BYTE *pkt = WT_ReceivePacket(session, &pktSize);
        if (pkt) {
            BYTE hdr[2] = { (BYTE)(pktSize >> 8), (BYTE)(pktSize & 0xFF) };
            int failed = write_all(stdoutH, hdr, 2) < 0 || write_all(stdoutH, pkt, pktSize) < 0;
            WT_ReleaseReceivePacket(session, pkt);
            if (failed) break;
        }

        /* Bekle */
        WaitForMultipleObjects(2, waitHandles, FALSE, pkt ? 0 : 100);

        /* stdin → TUN */
        DWORD avail = 0;
        if (!PeekNamedPipe(stdinH, NULL, 0, NULL, &avail, NULL)) break;
        if (avail < 2) continue;

        BYTE hdr[2];
        if (read_all(stdinH, hdr, 2) < 0) break;
        DWORD pktLen = ((DWORD)hdr[0] << 8) | hdr[1];
        if (pktLen == 0 || pktLen > 0xFFFF) continue;

        if (read_all(stdinH, buf, pktLen) < 0) break;

        BYTE *sendPkt = WT_AllocateSendPacket(session, pktLen);
        if (sendPkt) {
            memcpy(sendPkt, buf, pktLen);
            WT_SendPacket(session, sendPkt);
        }
    }

    fprintf(stderr, "[xtp-win] Cikiliyor...\n");
    WT_EndSession(session);
    WT_CloseAdapter(adapter);
    WSACleanup();
    FreeLibrary(hWintun);
    return 0;
}
