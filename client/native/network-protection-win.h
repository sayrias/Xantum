/* Xantum WFP broker; included only by xtp-tun-win.c.
 * Link fwpuclnt + ole32 + iphlpapi + advapi32. Filters are persistent, not dynamic:
 * an app/helper crash keeps them. Only an explicit release deletes this provider.
 * WFP permits are soft (no CLEAR_ACTION_RIGHT), so other firewalls can still veto.
 * API contracts: https://learn.microsoft.com/windows/win32/fwp/filter-arbitration
 * GUID values: microsoft/win32metadata, WinSDK/RecompiledIdlHeaders/um/fwpmu.h
 */
#include <fwpmu.h>
#include <iphlpapi.h>
#include <netioapi.h>
#include <sddl.h>
#include <objbase.h>

/* Private names avoid duplicate GUID declarations in newer Windows SDKs. */
static const GUID XP_PROVIDER = {0x8491603b,0x6604,0x4fd6,{0x9c,0x0e,0x0f,0x67,0x94,0x63,0x85,0x21}};
static const GUID XP_SUBLAYER = {0x479634f1,0x6b70,0x4d75,{0x88,0x06,0x2c,0x19,0x26,0xc2,0x1a,0xe0}};
static const GUID XP_PACKET4 = {0x1e5c9fae,0x8a84,0x4135,{0xa3,0x31,0x95,0x0b,0x54,0x22,0x9e,0xcd}};
static const GUID XP_PACKET6 = {0xa3b3ab6b,0x3564,0x488c,{0x91,0x17,0xf3,0x4e,0x82,0x14,0x27,0x63}};
static const GUID XP_TRANSPORT4 = {0x09e61aea,0xd214,0x46e2,{0x9b,0x21,0xb2,0x6b,0x0b,0x2f,0x28,0xc8}};
static const GUID XP_TRANSPORT6 = {0xe1735bde,0x013f,0x4655,{0xb3,0x51,0xa4,0x9e,0x15,0x76,0x2d,0xf0}};
static const GUID XP_LOCAL_INTERFACE = {0x4cd62a49,0x59c3,0x4969,{0xb7,0xf3,0xbd,0xa5,0xd3,0x28,0x90,0xa4}};
static const GUID XP_REMOTE_ADDRESS = {0xb235ae9a,0x1d64,0x49b8,{0xa4,0x4c,0x5f,0xf3,0xd9,0x09,0x50,0x45}};
static const GUID XP_PROTOCOL = {0x3971ef2b,0x623e,0x4f9a,{0x8c,0xb1,0x6e,0x79,0xb8,0x06,0xb9,0xa7}};
static const GUID XP_REMOTE_PORT = {0xc35a604d,0xd22b,0x4e1a,{0x91,0xb4,0x68,0xf6,0x74,0xee,0x67,0x4b}};
static const GUID XP_LOCAL_PORT = {0x0c1ba1af,0x5765,0x453f,{0xaf,0x22,0xa8,0xf7,0x91,0xac,0x77,0x5b}};
static const GUID XP_FLAGS = {0x632ce23b,0x5167,0x435c,{0x86,0xd7,0xe9,0x03,0x68,0x4a,0xa8,0x0c}};

#define XP_PERSISTENT 0x00000001u
#define XP_MAGIC 0x58545031u
#define XP_NOT_FOUND ((DWORD)FWP_E_PROVIDER_NOT_FOUND)

typedef struct {
    UINT32 magic, version, endpoint, port_count;
    UINT16 ports[4];
    UINT64 tunnel_luid;
    UINT32 assigned_ip;
    WCHAR owner_sid[184];
    WCHAR dns_token[40];
    UINT32 dhcp_count, dhcp_servers[32];
    UINT32 route_count;
    MIB_IPFORWARD_ROW2 routes[3];
} XP_STATE;

static DWORD xp_owner(WCHAR *destination, size_t capacity) {
    HANDLE token = NULL;
    DWORD size = 0, result = ERROR_SUCCESS;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) return GetLastError();
    GetTokenInformation(token, TokenUser, NULL, 0, &size);
    TOKEN_USER *user = (TOKEN_USER *)malloc(size);
    if (!user) { CloseHandle(token); return ERROR_OUTOFMEMORY; }
    if (!GetTokenInformation(token, TokenUser, user, size, &size)) result = GetLastError();
    LPWSTR sid = NULL;
    if (!result && !ConvertSidToStringSidW(user->User.Sid, &sid)) result = GetLastError();
    if (!result) {
        if (wcslen(sid) >= capacity) result = ERROR_INSUFFICIENT_BUFFER;
        else wcscpy(destination, sid);
    }
    if (sid) LocalFree(sid);
    free(user); CloseHandle(token); return result;
}

static DWORD xp_load(HANDLE engine, XP_STATE *state, int *exists) {
    FWPM_PROVIDER0 *provider = NULL;
    DWORD result = FwpmProviderGetByKey0(engine, &XP_PROVIDER, &provider);
    *exists = 0;
    if (result == XP_NOT_FOUND) return ERROR_SUCCESS;
    if (result) return result;
    if (provider->providerData.size != sizeof(*state)) result = ERROR_INVALID_DATA;
    else {
        memcpy(state, provider->providerData.data, sizeof(*state));
        WCHAR sid[184];
        result = xp_owner(sid, 184);
        if (!result && (state->magic != XP_MAGIC || state->version != 1 || state->port_count < 1 ||
            state->port_count > 4 || state->dhcp_count < 1 || state->dhcp_count > 32 || state->route_count > 3 || state->owner_sid[183] || state->dns_token[39] || wcscmp(sid, state->owner_sid))) result = ERROR_ACCESS_DENIED;
        if (!result) *exists = 1;
    }
    FwpmFreeMemory0((void **)&provider); return result;
}

static DWORD xp_filters(HANDLE engine, int remove, UINT32 *total) {
    FWPM_FILTER_ENUM_TEMPLATE0 query;
    memset(&query, 0, sizeof(query));
    query.providerKey = (GUID *)&XP_PROVIDER;
    query.enumType = FWP_FILTER_ENUM_FULLY_CONTAINED;
    query.actionMask = 0xffffffffu;
    HANDLE enumeration = NULL;
    DWORD result = FwpmFilterCreateEnumHandle0(engine, &query, &enumeration);
    if (result) return result;
    *total = 0;
    for (;;) {
        FWPM_FILTER0 **entries = NULL;
        UINT32 count = 0;
        result = FwpmFilterEnum0(engine, enumeration, 128, &entries, &count);
        if (result || !count) { if (entries) FwpmFreeMemory0((void **)&entries); break; }
        for (UINT32 i = 0; i < count; i++) {
            if (!IsEqualGUID(&entries[i]->subLayerKey, &XP_SUBLAYER)) { result = ERROR_INVALID_DATA; break; }
            (*total)++;
            if (remove && (result = FwpmFilterDeleteById0(engine, entries[i]->filterId))) break;
        }
        FwpmFreeMemory0((void **)&entries);
        if (result) break;
    }
    FwpmFilterDestroyEnumHandle0(engine, enumeration); return result;
}

static DWORD xp_add(HANDLE engine, const GUID *layer, UINT32 action, UINT64 weight,
                    FWPM_FILTER_CONDITION0 *conditions, UINT32 count) {
    FWPM_FILTER0 filter;
    memset(&filter, 0, sizeof(filter));
    filter.displayData.name = L"Xantum v1 network protection";
    filter.providerKey = (GUID *)&XP_PROVIDER;
    filter.layerKey = *layer; filter.subLayerKey = XP_SUBLAYER;
    filter.flags = XP_PERSISTENT; /* Soft permits; never clear action rights. */
    filter.action.type = action;
    filter.weight.type = FWP_UINT64; filter.weight.uint64 = &weight;
    filter.numFilterConditions = count; filter.filterCondition = conditions;
    return FwpmFilterAdd0(engine, &filter, NULL, NULL);
}

static DWORD xp_dhcp_servers(XP_STATE *state) {
    // IPPACKET has no protocol/port conditions. Limit that layer to broadcast
    // and the DHCP servers reported by the OS; OUTBOUND_TRANSPORT additionally
    // permits only UDP local 68 -> remote 67 for this exception.
    state->dhcp_count = 1; state->dhcp_servers[0] = 0xffffffffu;
    ULONG bytes = 16384;
    IP_ADAPTER_ADDRESSES *adapters = NULL;
    ULONG result = ERROR_BUFFER_OVERFLOW;
    for (int attempt = 0; attempt < 3 && result == ERROR_BUFFER_OVERFLOW; attempt++) {
        free(adapters); adapters = (IP_ADAPTER_ADDRESSES *)malloc(bytes);
        if (!adapters) return ERROR_OUTOFMEMORY;
        result = GetAdaptersAddresses(AF_INET, GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST |
            GAA_FLAG_SKIP_DNS_SERVER, NULL, adapters, &bytes);
    }
    if (result == ERROR_NO_DATA) { free(adapters); return ERROR_SUCCESS; }
    if (result) { free(adapters); return result; }
    for (IP_ADAPTER_ADDRESSES *adapter = adapters; adapter; adapter = adapter->Next) {
        SOCKET_ADDRESS server = adapter->Dhcpv4Server;
        if (!server.lpSockaddr || server.iSockaddrLength < (int)sizeof(SOCKADDR_IN) || server.lpSockaddr->sa_family != AF_INET) continue;
        UINT32 address = ntohl(((SOCKADDR_IN *)server.lpSockaddr)->sin_addr.s_addr);
        if (!address) continue;
        UINT32 i;
        for (i = 0; i < state->dhcp_count; i++) if (state->dhcp_servers[i] == address) break;
        if (i == state->dhcp_count) {
            if (state->dhcp_count == 32) { free(adapters); return ERROR_INSUFFICIENT_BUFFER; }
            state->dhcp_servers[state->dhcp_count++] = address;
        }
    }
    free(adapters); return ERROR_SUCCESS;
}

static DWORD xp_build(HANDLE engine, XP_STATE *state, int exists) {
    DWORD result = FwpmTransactionBegin0(engine, 0);
    if (result) return result;
    UINT32 total;
    if (exists) {
        if ((result = xp_filters(engine, 1, &total)) ||
            (result = FwpmSubLayerDeleteByKey0(engine, &XP_SUBLAYER)) ||
            (result = FwpmProviderDeleteByKey0(engine, &XP_PROVIDER))) goto failed;
    }
    FWPM_PROVIDER0 provider;
    memset(&provider, 0, sizeof(provider));
    provider.providerKey = XP_PROVIDER; provider.flags = XP_PERSISTENT;
    provider.displayData.name = L"Xantum v1 network protection";
    provider.providerData.size = sizeof(*state); provider.providerData.data = (UINT8 *)state;
    if ((result = FwpmProviderAdd0(engine, &provider, NULL))) goto failed;
    FWPM_SUBLAYER0 sublayer;
    memset(&sublayer, 0, sizeof(sublayer));
    sublayer.subLayerKey = XP_SUBLAYER; sublayer.providerKey = (GUID *)&XP_PROVIDER;
    sublayer.displayData.name = L"Xantum v1 network protection";
    sublayer.flags = XP_PERSISTENT; sublayer.weight = 0x7000;
    if ((result = FwpmSubLayerAdd0(engine, &sublayer, NULL))) goto failed;

    const GUID *layers[4] = {&XP_PACKET4, &XP_PACKET6, &XP_TRANSPORT4, &XP_TRANSPORT6};
    for (int i = 0; i < 4; i++) {
        FWPM_FILTER_CONDITION0 conditions[3];
        memset(conditions, 0, sizeof(conditions));
        conditions[0].fieldKey = XP_FLAGS;
        conditions[0].matchType = FWP_MATCH_FLAGS_ALL_SET;
        conditions[0].conditionValue.type = FWP_UINT32;
        conditions[0].conditionValue.uint32 = FWP_CONDITION_FLAG_IS_LOOPBACK;
        if ((result = xp_add(engine, layers[i], FWP_ACTION_PERMIT, 1000, conditions, 1))) goto failed;
        if (!(i & 1)) {
            memset(conditions, 0, sizeof(conditions));
            if (i == 0) {
                conditions[0].fieldKey = XP_REMOTE_ADDRESS;
                conditions[0].conditionValue.type = FWP_UINT32;
                for (UINT32 server = 0; server < state->dhcp_count; server++) {
                    conditions[0].conditionValue.uint32 = state->dhcp_servers[server];
                    if ((result = xp_add(engine, layers[i], FWP_ACTION_PERMIT, 850, conditions, 1))) goto failed;
                }
            } else {
                conditions[0].fieldKey = XP_PROTOCOL;
                conditions[0].conditionValue.type = FWP_UINT8;
                conditions[0].conditionValue.uint8 = IPPROTO_UDP;
                conditions[1].fieldKey = XP_LOCAL_PORT;
                conditions[1].conditionValue.type = FWP_UINT16;
                conditions[1].conditionValue.uint16 = 68;
                conditions[2].fieldKey = XP_REMOTE_PORT;
                conditions[2].conditionValue.type = FWP_UINT16;
                conditions[2].conditionValue.uint16 = 67;
                if ((result = xp_add(engine, layers[i], FWP_ACTION_PERMIT, 850, conditions, 3))) goto failed;
            }
            memset(conditions, 0, sizeof(conditions));
            conditions[0].fieldKey = XP_REMOTE_ADDRESS;
            conditions[0].conditionValue.type = FWP_UINT32;
            conditions[0].conditionValue.uint32 = state->endpoint;
            if (i == 0) {
                // Packet layer enforces every packet, including already established flows.
                // Transport layer narrows this endpoint exception to the configured TCP ports.
                if ((result = xp_add(engine, layers[i], FWP_ACTION_PERMIT, 900, conditions, 1))) goto failed;
            } else {
                conditions[1].fieldKey = XP_PROTOCOL;
                conditions[1].conditionValue.type = FWP_UINT8;
                conditions[1].conditionValue.uint8 = IPPROTO_TCP;
                conditions[2].fieldKey = XP_REMOTE_PORT;
                conditions[2].conditionValue.type = FWP_UINT16;
                for (UINT32 port = 0; port < state->port_count; port++) {
                    conditions[2].conditionValue.uint16 = state->ports[port];
                    if ((result = xp_add(engine, layers[i], FWP_ACTION_PERMIT, 900, conditions, 3))) goto failed;
                }
            }
            if (state->tunnel_luid) {
                memset(conditions, 0, sizeof(conditions));
                conditions[0].fieldKey = XP_LOCAL_INTERFACE;
                conditions[0].conditionValue.type = FWP_UINT64;
                conditions[0].conditionValue.uint64 = &state->tunnel_luid;
                if ((result = xp_add(engine, layers[i], FWP_ACTION_PERMIT, 800, conditions, 1))) goto failed;
            }
        }
        if ((result = xp_add(engine, layers[i], FWP_ACTION_BLOCK, 1, NULL, 0))) goto failed;
    }
    result = FwpmTransactionCommit0(engine);
    if (!result) return result;
failed:
    FwpmTransactionAbort0(engine); return result;
}

static DWORD xp_dns(const XP_STATE *state, int remove) {
    // Each connection owns one NRPT rule by random token. No adapter/global DNS
    // snapshots are overwritten; removing the owned rule restores prior policy.
    WCHAR executable[MAX_PATH], command[4096];
    UINT length = GetSystemDirectoryW(executable, MAX_PATH);
    if (!length || length > MAX_PATH - 60) return ERROR_INSUFFICIENT_BUFFER;
    wcscat(executable, L"\\WindowsPowerShell\\v1.0\\powershell.exe");
    const WCHAR *action = remove
        ? L"$r | Remove-DnsClientNrptRule -Force -ErrorAction Stop;"
        : L"if ($r.Count -eq 0) { Add-DnsClientNrptRule -Namespace '.' -NameServers '1.1.1.1' -Comment $m -DisplayName 'Xantum v1 DNS' -ErrorAction Stop | Out-Null };";
    int written = swprintf(command, 4096,
        L"\"%ls\" -NoLogo -NoProfile -NonInteractive -Command \"& { $ErrorActionPreference='Stop'; "
        L"$m='Xantum-v1-%ls'; $r=@(Get-DnsClientNrptRule -ErrorAction Stop | Where-Object { $_.Comment -ceq $m }); "
        L"%ls Clear-DnsClientCache -ErrorAction Stop }\"", executable, state->dns_token, action);
    if (written < 0 || written >= 4096) return ERROR_INSUFFICIENT_BUFFER;
    SECURITY_ATTRIBUTES attributes = {sizeof(attributes), NULL, TRUE};
    HANDLE sink = CreateFileW(L"NUL", GENERIC_WRITE, FILE_SHARE_WRITE, &attributes, OPEN_EXISTING, 0, NULL);
    if (sink == INVALID_HANDLE_VALUE) return GetLastError();
    STARTUPINFOW startup; PROCESS_INFORMATION process;
    memset(&startup, 0, sizeof(startup)); memset(&process, 0, sizeof(process));
    startup.cb = sizeof(startup); startup.dwFlags = STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW;
    startup.wShowWindow = SW_HIDE; startup.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
    startup.hStdOutput = sink; startup.hStdError = GetStdHandle(STD_ERROR_HANDLE);
    BOOL created = CreateProcessW(executable, command, NULL, NULL, TRUE, CREATE_NO_WINDOW, NULL, NULL, &startup, &process);
    DWORD result = created ? ERROR_SUCCESS : GetLastError();
    if (created) {
        if (WaitForSingleObject(process.hProcess, 20000) != WAIT_OBJECT_0) {
            TerminateProcess(process.hProcess, 1); result = ERROR_TIMEOUT;
        } else { DWORD code = 0; GetExitCodeProcess(process.hProcess, &code); if (code) result = ERROR_GEN_FAILURE; }
        CloseHandle(process.hThread); CloseHandle(process.hProcess);
    }
    CloseHandle(sink); return result;
}

static DWORD xp_remove_routes(XP_STATE *state) {
    for (UINT32 i = 0; i < state->route_count; i++) {
        MIB_IPFORWARD_ROW2 row = state->routes[i];
        DWORD result = GetIpForwardEntry2(&row);
        if (result == ERROR_NOT_FOUND) continue;
        if (result) return result;
        // GetIpForwardEntry2 keys include destination, interface and next hop.
        // A replaced record with another metric/protocol is no longer ours.
        if (row.Metric != 27771 || row.Protocol != MIB_IPPROTO_NETMGMT) return ERROR_INVALID_DATA;
        if ((result = DeleteIpForwardEntry2(&row))) return result;
    }
    return ERROR_SUCCESS;
}

static DWORD xp_prepare_routes(HANDLE engine, XP_STATE *state, NET_LUID tunnel) {
    SOCKADDR_INET destination, source;
    MIB_IPFORWARD_ROW2 original;
    memset(&destination, 0, sizeof(destination));
    destination.Ipv4.sin_family = AF_INET;
    destination.Ipv4.sin_addr.s_addr = htonl(state->endpoint);
    DWORD result = GetBestRoute2(NULL, 0, NULL, &destination, 0, &original, &source);
    if (result) return result;
    if (original.InterfaceLuid.Value == tunnel.Value) return ERROR_INVALID_DATA;
    XP_STATE next = *state;
    next.route_count = 0;
    for (UINT32 i = 0; i < 3; i++) {
        MIB_IPFORWARD_ROW2 row;
        InitializeIpForwardEntry(&row);
        row.InterfaceLuid = i ? tunnel : original.InterfaceLuid;
        row.DestinationPrefix.Prefix.Ipv4.sin_family = AF_INET;
        row.DestinationPrefix.Prefix.Ipv4.sin_addr.s_addr = htonl(i == 0 ? state->endpoint : (i == 1 ? 0u : 0x80000000u));
        row.DestinationPrefix.PrefixLength = i ? 1 : 32;
        row.NextHop = original.NextHop;
        if (i) { memset(&row.NextHop, 0, sizeof(row.NextHop)); row.NextHop.Ipv4.sin_family = AF_INET; }
        row.Metric = 27771; row.Protocol = MIB_IPPROTO_NETMGMT;
        MIB_IPFORWARD_ROW2 existing = row;
        result = GetIpForwardEntry2(&existing);
        if (!result) {
            // Existing routes belong to their creator. Reuse a physical host
            // route, but refuse an existing split route on our tunnel.
            if (i) return ERROR_ALREADY_EXISTS;
            continue;
        }
        if (result != ERROR_NOT_FOUND) return result;
        next.routes[next.route_count++] = row;
    }
    // Persist intended records before route creation, so forced termination is
    // recoverable. A failed route operation keeps the WFP deny policy in force.
    if ((result = xp_build(engine, &next, 1))) return result;
    *state = next;
    for (UINT32 i = 0; i < state->route_count; i++) {
        if ((result = CreateIpForwardEntry2(&state->routes[i]))) return result;
    }
    return ERROR_SUCCESS;
}

static DWORD xp_release(HANDLE engine, XP_STATE *state, int exists) {
    if (!exists) return ERROR_SUCCESS;
    DWORD result = xp_dns(state, 1);
    if (result) return result; /* Keep firewall locked until DNS restoration succeeds. */
    if ((result = xp_remove_routes(state))) return result;
    if ((result = FwpmTransactionBegin0(engine, 0))) return result;
    UINT32 total;
    if ((result = xp_filters(engine, 1, &total)) ||
        (result = FwpmSubLayerDeleteByKey0(engine, &XP_SUBLAYER)) ||
        (result = FwpmProviderDeleteByKey0(engine, &XP_PROVIDER)) ||
        (result = FwpmTransactionCommit0(engine))) { FwpmTransactionAbort0(engine); return result; }
    return ERROR_SUCCESS;
}

static int xp_protection_main(int argc, char **argv) {
    HANDLE engine = NULL;
    DWORD result = FwpmEngineOpen0(NULL, RPC_C_AUTHN_WINNT, NULL, NULL, &engine);
    if (result) goto failed;
    XP_STATE state; memset(&state, 0, sizeof(state));
    int exists = 0;
    if ((result = xp_load(engine, &state, &exists))) goto failed;
    const char *operation = argv[2];
    if (!strcmp(operation, "arm") && argc == 5) {
        XP_STATE next = state;
        IN_ADDR address;
        if (InetPtonA(AF_INET, argv[3], &address) != 1) { result = ERROR_INVALID_PARAMETER; goto failed; }
        next.endpoint = ntohl(address.s_addr); next.port_count = 0;
        const char *cursor = argv[4];
        while (*cursor) {
            char *end = NULL; long port = strtol(cursor, &end, 10);
            if (end == cursor || port < 1 || port > 65535 || next.port_count == 4 || (*end && *end != ',')) { result = ERROR_INVALID_PARAMETER; goto failed; }
            next.ports[next.port_count++] = (UINT16)port;
            cursor = *end ? end + 1 : end;
        }
        if (!next.port_count || (exists && (next.endpoint != state.endpoint || next.port_count != state.port_count || memcmp(next.ports, state.ports, next.port_count * sizeof(UINT16))))) { result = ERROR_INVALID_PARAMETER; goto failed; }
        if (!exists) {
            next.magic = XP_MAGIC; next.version = 1;
            if ((result = xp_owner(next.owner_sid, 184))) goto failed;
            GUID token;
            if (CoCreateGuid(&token) != S_OK || !StringFromGUID2(&token, next.dns_token, 40)) { result = ERROR_GEN_FAILURE; goto failed; }
        }
        if (exists && (result = xp_remove_routes(&state))) goto failed;
        if ((result = xp_dhcp_servers(&next))) goto failed;
        next.route_count = 0; memset(next.routes, 0, sizeof(next.routes));
        next.tunnel_luid = 0; next.assigned_ip = 0;
        if ((result = xp_build(engine, &next, exists))) goto failed;
        state = next; exists = 1;
    } else if (!strcmp(operation, "bind") && argc == 4 && exists) {
        IN_ADDR address;
        if (InetPtonA(AF_INET, argv[3], &address) != 1 || (ntohl(address.s_addr) & 0xffffff00u) != 0x0a080000u || (ntohl(address.s_addr) & 255u) < 2 || (ntohl(address.s_addr) & 255u) > 254) { result = ERROR_INVALID_PARAMETER; goto failed; }
        NET_LUID luid;
        if ((result = ConvertInterfaceAliasToLuid(L"Xantum", &luid))) goto failed;
        MIB_UNICASTIPADDRESS_ROW row; InitializeUnicastIpAddressEntry(&row);
        row.InterfaceLuid = luid; row.Address.Ipv4.sin_family = AF_INET; row.Address.Ipv4.sin_addr = address;
        if ((result = GetUnicastIpAddressEntry(&row))) goto failed;
        if ((result = xp_prepare_routes(engine, &state, luid))) goto failed;
        if ((result = xp_dns(&state, 0))) goto failed;
        XP_STATE next = state; next.tunnel_luid = luid.Value; next.assigned_ip = ntohl(address.s_addr);
        if ((result = xp_build(engine, &next, 1))) goto failed;
        state = next;
    } else if (!strcmp(operation, "block") && argc == 3 && exists) {
        state.tunnel_luid = 0; state.assigned_ip = 0;
        if ((result = xp_build(engine, &state, 1))) goto failed;
    } else if (!strcmp(operation, "release") && argc == 3) {
        if ((result = xp_release(engine, &state, exists))) goto failed;
        exists = 0;
    } else if (strcmp(operation, "status") || argc != 3) { result = ERROR_INVALID_PARAMETER; goto failed; }

    if (exists) {
        UINT32 count = 0;
        if ((result = xp_filters(engine, 0, &count))) goto failed;
        UINT32 expected = 10u + state.port_count + state.dhcp_count + (state.tunnel_luid ? 2u : 0u);
        if (count != expected) { result = ERROR_INVALID_DATA; goto failed; }
        IN_ADDR address; address.s_addr = htonl(state.endpoint);
        char endpoint[INET_ADDRSTRLEN]; InetNtopA(AF_INET, &address, endpoint, sizeof(endpoint));
        int tunnel_present = 0;
        if (state.tunnel_luid && state.assigned_ip) {
            MIB_UNICASTIPADDRESS_ROW row; InitializeUnicastIpAddressEntry(&row);
            row.InterfaceLuid.Value = state.tunnel_luid;
            row.Address.Ipv4.sin_family = AF_INET;
            row.Address.Ipv4.sin_addr.s_addr = htonl(state.assigned_ip);
            tunnel_present = GetUnicastIpAddressEntry(&row) == ERROR_SUCCESS;
        }
        printf("{\"active\":true,\"blocked\":%s,\"verified\":true,\"endpoint\":\"%s\",\"ports\":[", tunnel_present ? "false" : "true", endpoint);
        for (UINT32 i = 0; i < state.port_count; i++) printf("%s%u", i ? "," : "", (unsigned)state.ports[i]);
        printf("]}\n");
    } else printf("{\"active\":false,\"blocked\":false,\"verified\":true}\n");
    FwpmEngineClose0(engine); return 0;
failed:
    fprintf(stderr, "ERROR: Windows ag korumasi basarisiz (kod: %lu); yonetici yetkisini, BFE ve DNS Client servislerini kontrol edin.\n", (unsigned long)result);
    if (engine) FwpmEngineClose0(engine);
    return 1;
}
