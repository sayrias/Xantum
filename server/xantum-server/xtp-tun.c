/*
 * xtp-tun.c — Xantum TUN Yardımcı Programı (Linux)
 *
 * Derleme:
 *   gcc -Wall -Wextra -Werror -O2 -D_FORTIFY_SOURCE=2 -o xtp-tun-helper xtp-tun.c
 *
 * Kullanım:
 *   sudo ./xtp-tun-helper <iface> <ip> <mask> <mtu> <server_ip> <gateway> <egress_dev> <full_tunnel>
 *
 *   Örnek (split tunnel):
 *     sudo ./xtp-tun-helper xtp0 10.8.0.2 255.255.255.0 1380 185.93.70.20 192.168.1.1 eth0 0
 *
 *   Örnek (full tunnel):
 *     sudo ./xtp-tun-helper xtp0 10.8.0.2 255.255.255.0 1380 185.93.70.20 192.168.1.1 eth0 1
 *
 * Protokol (stdin/stdout):
 *   Giriş  (Node.js → TUN): [2B büyük-endian uzunluk][IP paketi]
 *   Çıkış  (TUN → Node.js): [2B büyük-endian uzunluk][IP paketi]
 *
 * stderr: "TUN_READY:<iface>" satırı hazır olunca basılır.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#include <stdint.h>
#include <signal.h>
#include <ctype.h>
#include <arpa/inet.h>
#include <poll.h>
#include <sys/ioctl.h>
#include <sys/socket.h>
#include <sys/wait.h>
#include <netinet/in.h>
#include <linux/if.h>
#include <linux/if_tun.h>

#define MAX_PKT 65535
static volatile sig_atomic_t running = 1;
static int host_route_added = 0, lower_route_added = 0, upper_route_added = 0;
static int split_route_added = 0;
static void stop_signal(int signal_number) { (void)signal_number; running = 0; }
static int valid_iface(const char *name) {
    if (!*name || strlen(name) >= IFNAMSIZ) return 0;
    for (const char *p = name; *p; p++) if (!isalnum((unsigned char)*p) && *p != '_' && *p != '-' && *p != '.') return 0;
    return 1;
}

/* ================================================================
 * TUN arayüzü: aç ve yapılandır
 * ================================================================ */
static int tun_alloc(const char *devname, int exclusive) {
    int fd = open("/dev/net/tun", O_RDWR);
    if (fd < 0) {
        perror("[xtp-tun] /dev/net/tun açılamadı");
        return -1;
    }

    struct ifreq ifr;
    memset(&ifr, 0, sizeof(ifr));
    ifr.ifr_flags = IFF_TUN | IFF_NO_PI | (exclusive ? IFF_TUN_EXCL : 0);
    strncpy(ifr.ifr_name, devname, IFNAMSIZ - 1);

    if (ioctl(fd, TUNSETIFF, &ifr) < 0) {
        perror("[xtp-tun] TUNSETIFF başarısız");
        close(fd);
        return -1;
    }
    return fd;
}

/* TUN arayüzüne IP ata, MTU ayarla, arayüzü ayağa kaldır */
static int setup_iface(const char *iface, const char *ip, const char *mask, int mtu) {
    int s = socket(AF_INET, SOCK_DGRAM, 0);
    if (s < 0) { perror("[xtp-tun] socket"); return -1; }

    struct ifreq ifr;
    struct sockaddr_in *addr = (struct sockaddr_in *)&ifr.ifr_addr;

    /* IP adresi */
    memset(&ifr, 0, sizeof(ifr));
    strncpy(ifr.ifr_name, iface, IFNAMSIZ - 1);
    addr->sin_family = AF_INET;
    inet_pton(AF_INET, ip, &addr->sin_addr);
    if (ioctl(s, SIOCSIFADDR, &ifr) < 0) { close(s); return -1; }

    /* Ağ maskesi */
    memset(&ifr, 0, sizeof(ifr));
    strncpy(ifr.ifr_name, iface, IFNAMSIZ - 1);
    addr->sin_family = AF_INET;
    inet_pton(AF_INET, mask, &addr->sin_addr);
    if (ioctl(s, SIOCSIFNETMASK, &ifr) < 0) { close(s); return -1; }

    /* MTU */
    memset(&ifr, 0, sizeof(ifr));
    strncpy(ifr.ifr_name, iface, IFNAMSIZ - 1);
    ifr.ifr_mtu = mtu;
    if (ioctl(s, SIOCSIFMTU, &ifr) < 0) { close(s); return -1; }

    /* Arayüzü ayağa kaldır */
    memset(&ifr, 0, sizeof(ifr));
    strncpy(ifr.ifr_name, iface, IFNAMSIZ - 1);
    if (ioctl(s, SIOCGIFFLAGS, &ifr) < 0) { close(s); return -1; }
    ifr.ifr_flags |= (IFF_UP | IFF_RUNNING);
    if (ioctl(s, SIOCSIFFLAGS, &ifr) < 0) { close(s); return -1; }

    close(s);
    return 0;
}

/* The command arguments below are validated before reaching this helper. */
static int run_route_command(const char *cmd, const char *operation) {
    int status = system(cmd);
    if (status == 0) return 0;
    if (status == -1) {
        fprintf(stderr, "[xtp-tun] %s: %s\n", operation, strerror(errno));
    } else if (WIFEXITED(status)) {
        fprintf(stderr, "[xtp-tun] %s: ip komutu basarisiz (kod %d)\n",
                operation, WEXITSTATUS(status));
    } else if (WIFSIGNALED(status)) {
        fprintf(stderr, "[xtp-tun] %s: komut sinyalle durdu (%d)\n",
                operation, WTERMSIG(status));
    } else {
        fprintf(stderr, "[xtp-tun] %s: ip komutu tamamlanamadi\n", operation);
    }
    return -1;
}

/* ip komutlarıyla rotaları ekle */
static int add_routes(const char *iface,
                       const char *server_ip,
                       const char *gateway,
                       const char *egress_dev,
                       int full_tunnel)
{
    char cmd[256];

    /* Sunucu için özel host rotası — VPN tünelinden GEÇMESİN */
    if (server_ip && gateway && egress_dev &&
        strlen(server_ip) > 0 && strlen(egress_dev) > 0)
    {
        if (*gateway) snprintf(cmd, sizeof(cmd),
            "ip route add %s/32 via %s dev %s metric 1 proto 186 2>/dev/null",
            server_ip, gateway, egress_dev);
        else snprintf(cmd, sizeof(cmd), "ip route add %s/32 dev %s metric 1 proto 186 2>/dev/null", server_ip, egress_dev);
        if (run_route_command(cmd, "Sunucu rotasi eklenemedi") < 0) return -1;
        host_route_added = 1;
        fprintf(stderr, "[xtp-tun] Sunucu rotası: %s via %s\n", server_ip, gateway);
    }

    if (full_tunnel) {
        /* Tüm internet trafiğini VPN üzerinden yönlendir */
        snprintf(cmd, sizeof(cmd),
            "ip route add 0.0.0.0/1 dev %s metric 10 proto 186 2>/dev/null", iface);
        if (run_route_command(cmd, "Alt tam tunel rotasi eklenemedi") < 0) return -1;
        lower_route_added = 1;

        snprintf(cmd, sizeof(cmd),
            "ip route add 128.0.0.0/1 dev %s metric 10 proto 186 2>/dev/null", iface);
        if (run_route_command(cmd, "Ust tam tunel rotasi eklenemedi") < 0) return -1;
        upper_route_added = 1;

        fprintf(stderr, "[xtp-tun] Full tunnel modu aktif (tüm trafik VPN)\n");
    } else {
        /* Split tunnel: sadece VPN alt ağı */
        snprintf(cmd, sizeof(cmd),
            "ip route add 10.8.0.0/24 dev %s metric 10 proto 186 2>/dev/null", iface);
        if (run_route_command(cmd, "Bolunmus tunel rotasi eklenemedi") < 0) return -1;
        split_route_added = 1;
        fprintf(stderr, "[xtp-tun] Split tunnel modu aktif (sadece 10.8.0.0/24)\n");
    }
    return 0;
}

/* Delete only routes this process successfully added, preserving other routes. */
static int remove_routes(const char *iface,
                         const char *server_ip,
                         const char *gateway,
                         const char *egress_dev,
                         int full_tunnel)
{
    char cmd[256];
    int result = 0;

    if (host_route_added && server_ip && gateway && egress_dev &&
        strlen(server_ip) > 0 && strlen(egress_dev) > 0)
    {
        if (*gateway) snprintf(cmd, sizeof(cmd),
            "ip route del %s/32 via %s dev %s metric 1 proto 186 2>/dev/null",
            server_ip, gateway, egress_dev);
        else snprintf(cmd, sizeof(cmd), "ip route del %s/32 dev %s metric 1 proto 186 2>/dev/null", server_ip, egress_dev);
        if (run_route_command(cmd, "Sunucu rotasi temizlenemedi") < 0) result = -1;
        else host_route_added = 0;
    }

    if (full_tunnel) {
        if (lower_route_added) {
            snprintf(cmd, sizeof(cmd), "ip route del 0.0.0.0/1 dev %s metric 10 proto 186 2>/dev/null", iface);
            if (run_route_command(cmd, "Alt tam tunel rotasi temizlenemedi") < 0) result = -1;
            else lower_route_added = 0;
        }
        if (upper_route_added) {
            snprintf(cmd, sizeof(cmd), "ip route del 128.0.0.0/1 dev %s metric 10 proto 186 2>/dev/null", iface);
            if (run_route_command(cmd, "Ust tam tunel rotasi temizlenemedi") < 0) result = -1;
            else upper_route_added = 0;
        }
    } else if (split_route_added) {
        snprintf(cmd, sizeof(cmd), "ip route del 10.8.0.0/24 dev %s metric 10 proto 186 2>/dev/null", iface);
        if (run_route_command(cmd, "Bolunmus tunel rotasi temizlenemedi") < 0) result = -1;
        else split_route_added = 0;
    }
    return result;
}

/* ================================================================
 * Yardımcı I/O
 * ================================================================ */
/* 0: complete; 1: EOF before any byte; -1: error or truncated input. */
static int read_exactly(int fd, uint8_t *buf, int n) {
    int got = 0;
    while (got < n) {
        ssize_t r = read(fd, buf + got, (size_t)(n - got));
        if (r < 0 && errno == EINTR && running) continue;
        if (r < 0) return -1;
        if (r == 0) {
            if (got == 0) return 1;
            errno = EPROTO;
            return -1;
        }
        got += (int)r;
    }
    return 0;
}

static int write_exactly(int fd, const uint8_t *buf, int n) {
    int sent = 0;
    while (sent < n) {
        ssize_t w = write(fd, buf + sent, (size_t)(n - sent));
        if (w < 0 && errno == EINTR && running) continue;
        if (w < 0) return -1;
        if (w == 0) { errno = EPIPE; return -1; }
        sent += (int)w;
    }
    return 0;
}

/* A TUN write is one packet; a short write must never become two packets. */
static int write_packet(int fd, const uint8_t *buf, size_t n) {
    ssize_t written;
    do {
        written = write(fd, buf, n);
    } while (written < 0 && errno == EINTR && running);
    if (written < 0) return -1;
    if ((size_t)written != n) { errno = EIO; return -1; }
    return 0;
}

/* ================================================================
 * main
 * ================================================================ */
int main(int argc, char **argv) {
    /* All root commands below use only fixed system utilities. */
    if (setenv("PATH", "/usr/sbin:/usr/bin:/sbin:/bin", 1) < 0) {
        perror("[xtp-tun] PATH ayarlanamadi"); return 1;
    }
    /* Argümanlar */
    const char *iface       = (argc > 1) ? argv[1] : "xtp0";
    const char *ip          = (argc > 2) ? argv[2] : "10.8.0.2";
    const char *mask        = (argc > 3) ? argv[3] : "255.255.255.0";
    int         mtu         = (argc > 4) ? atoi(argv[4]) : 1380;
    const char *server_ip   = (argc > 5) ? argv[5] : "";
    const char *gateway     = (argc > 6) ? argv[6] : "";
    const char *egress_dev  = (argc > 7) ? argv[7] : "";
    int         full_tunnel = (argc > 8) ? atoi(argv[8]) : 0;

    struct in_addr parsed;
    if (!valid_iface(iface) || (*egress_dev && !valid_iface(egress_dev)) ||
        inet_pton(AF_INET, ip, &parsed) != 1 || inet_pton(AF_INET, mask, &parsed) != 1 ||
        (*server_ip && inet_pton(AF_INET, server_ip, &parsed) != 1) ||
        (*gateway && inet_pton(AF_INET, gateway, &parsed) != 1) || mtu < 576 || mtu > 1500 ||
        (full_tunnel && (!*server_ip || !*egress_dev))) {
        fprintf(stderr, "ERROR: gecersiz ag argumanlari\n"); return 1;
    }
    /* A desktop polkit action may create only our non-persistent client TUN.
     * The separately installed server root service can still attach its own TUN. */
    if (getenv("PKEXEC_UID") && (argc != 9 || strcmp(iface, "xtp0") ||
        strcmp(mask, "255.255.255.0") || strncmp(ip, "10.8.0.", 7) ||
        atoi(ip + 7) < 2 || atoi(ip + 7) > 254 || full_tunnel != 1)) {
        fprintf(stderr, "ERROR: istemci yardimcisi yalniz Xantum tam tunel olusturabilir\n"); return 1;
    }
    struct sigaction action;
    memset(&action, 0, sizeof(action)); action.sa_handler = stop_signal;
    if (sigaction(SIGTERM, &action, NULL) < 0 ||
        sigaction(SIGINT, &action, NULL) < 0 || signal(SIGPIPE, SIG_IGN) == SIG_ERR) {
        perror("[xtp-tun] Sinyal yonetimi ayarlanamadi"); return 1;
    }

    /* TUN oluştur */
    int tun = tun_alloc(iface, argc > 2);
    if (tun < 0) return 1;

    /* Server owns its preconfigured .1 interface; never overwrite it with .2. */
    if (argc > 2) {
        if (setup_iface(iface, ip, mask, mtu) < 0 ||
            add_routes(iface, server_ip, gateway, egress_dev, full_tunnel) < 0) {
            fprintf(stderr, "ERROR: arayuz veya rota kurulumu basarisiz\n");
            remove_routes(iface, server_ip, gateway, egress_dev, full_tunnel);
            close(tun); return 1;
        }
    }

    /* Hazır sinyali */
    fprintf(stderr, "TUN_READY:%s\n", iface);
    fflush(stderr);

    /* ---- Ana döngü ---- */
    static uint8_t buf[MAX_PKT];
    struct pollfd fds[2] = {
        { .fd = STDIN_FILENO, .events = POLLIN },
        { .fd = tun,           .events = POLLIN },
    };

    int exit_code = 0;
    while (running) {
        int ret = poll(fds, 2, 5000);
        if (ret < 0) {
            if (errno == EINTR) continue;
            perror("[xtp-tun] poll basarisiz"); exit_code = 1; break;
        }

        /* stdin → TUN */
        if (fds[0].revents & POLLIN) {
            uint8_t hdr[2];
            int header_result = read_exactly(STDIN_FILENO, hdr, 2);
            if (header_result == 1) break; /* Parent closed the stream cleanly. */
            if (header_result < 0) {
                if (running || errno != EINTR) {
                    perror("[xtp-tun] Paket basligi okunamadi"); exit_code = 1;
                }
                break;
            }
            uint16_t pktlen = (uint16_t)((hdr[0] << 8) | hdr[1]);
            if (pktlen == 0) {
                fprintf(stderr, "[xtp-tun] Gecersiz sifir uzunluklu paket\n"); exit_code = 1; break;
            }
            int payload_result = read_exactly(STDIN_FILENO, buf, pktlen);
            if (payload_result != 0) {
                if (payload_result == 1) errno = EPROTO;
                if (running || errno != EINTR) {
                    perror("[xtp-tun] Paket govdesi okunamadi"); exit_code = 1;
                }
                break;
            }
            if (write_packet(tun, buf, pktlen) < 0) {
                if (running || errno != EINTR) {
                    perror("[xtp-tun] Paket TUN arayuzune yazilamadi"); exit_code = 1;
                }
                break;
            }
        }

        if (fds[0].revents & (POLLERR | POLLNVAL)) {
            fprintf(stderr, "[xtp-tun] Girdi akisinda poll hatasi\n"); exit_code = 1; break;
        }
        if (fds[0].revents & POLLHUP) break;
        if (fds[1].revents & (POLLERR | POLLHUP | POLLNVAL)) {
            fprintf(stderr, "[xtp-tun] TUN arayuzunde poll hatasi\n"); exit_code = 1; break;
        }

        /* TUN → stdout */
        if (fds[1].revents & POLLIN) {
            ssize_t n;
            do {
                n = read(tun, buf, MAX_PKT);
            } while (n < 0 && errno == EINTR && running);
            if (n < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) continue;
            if (n <= 0) {
                if (n == 0) errno = EIO;
                if (running || errno != EINTR) {
                    perror("[xtp-tun] TUN paketi okunamadi"); exit_code = 1;
                }
                break;
            }
            uint8_t hdr[2];
            hdr[0] = (uint8_t)(n >> 8);
            hdr[1] = (uint8_t)(n & 0xFF);
            if (write_exactly(STDOUT_FILENO, hdr, 2) < 0 ||
                write_exactly(STDOUT_FILENO, buf, (int)n) < 0) {
                if (running || errno != EINTR) {
                    perror("[xtp-tun] Paket cikisa yazilamadi"); exit_code = 1;
                }
                break;
            }
        }
    }

    fprintf(stderr, "[xtp-tun] Çıkılıyor — rotalar temizleniyor...\n");
    if (argc > 2 && remove_routes(iface, server_ip, gateway, egress_dev, full_tunnel) < 0) exit_code = 1;
    if (close(tun) < 0) { perror("[xtp-tun] TUN kapatilamadi"); exit_code = 1; }
    return exit_code;
}
