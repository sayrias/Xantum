# Native Windows OpenSSH + tar. No password/host-key verification bypass.
$ErrorActionPreference = 'Stop'
function Read-Default([string]$Prompt, [string]$Default) {
    $value = Read-Host "$Prompt [$Default]"
    if ([string]::IsNullOrWhiteSpace($value)) { return $Default }
    return $value
}
function Test-ServerHost([string]$Value) {
    if ($Value.Length -gt 253 -or $Value -notmatch '^[a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9]$' -or $Value.Contains('..')) { return $false }
    if ($Value -match '^[0-9.]+$') {
        if ($Value -notmatch '^[0-9]{1,3}(\.[0-9]{1,3}){3}$') { return $false }
        foreach ($octet in $Value.Split('.')) { if ([int]$octet -gt 255) { return $false } }
    } else {
        foreach ($label in $Value.Split('.')) { if ($label.Length -gt 63 -or $label.StartsWith('-') -or $label.EndsWith('-')) { return $false } }
    }
    return $true
}
$archive = $null
$remoteDir = $null
try {
    Write-Host "`nXantum - IP + SSH ile guvenli kurulum`n"
    $serverHost = Read-Host 'VDS alan adi / IPv4'
    $serverUser = Read-Default 'SSH kullanici adi' 'root'
    $serverPort = Read-Default 'SSH portu' '22'
    if (!(Test-ServerHost $serverHost) -or $serverUser -notmatch '^[a-zA-Z_][a-zA-Z0-9_-]*$' -or $serverPort -notmatch '^[0-9]{1,5}$' -or [int]$serverPort -lt 1 -or [int]$serverPort -gt 65535) { throw 'SSH bilgileri gecersiz.' }
    $acmeWebroot = $env:XANTUM_ACME_WEBROOT
    if ($acmeWebroot -and $acmeWebroot -notmatch '^/[a-zA-Z0-9_./-]+$') { throw 'XANTUM_ACME_WEBROOT VDS uzerinde mutlak, bosluksuz bir yol olmali.' }
    Write-Host '1) Otomatik guvenli sertifika (onerilen)'
    Write-Host '2) Mevcut sertifikam (gelismis)'
    $mode = Read-Default 'Sertifika yontemi' '1'
    if ($mode -notin @('1', '2')) { throw 'Gecersiz sertifika yontemi.' }
    $publicHost = (Read-Default 'Uygulamada kullanilacak IP / alan adi' $serverHost).ToLowerInvariant()
    if (!(Test-ServerHost $publicHost)) { throw 'Uygulama adresi gecersiz.' }
    $cert = ''; $key = ''
    if ($mode -eq '2') {
        $tlsMode = 'existing'
        $cert = Read-Host 'VDS uzerindeki fullchain.pem tam yolu'
        $key = Read-Host 'VDS uzerindeki privkey.pem tam yolu'
        if ($cert -notmatch '^/[a-zA-Z0-9_./-]+$' -or $key -notmatch '^/[a-zA-Z0-9_./-]+$') { throw 'Yollar / ile baslamali ve bosluk icermemeli.' }
    } else {
        $tlsMode = 'auto'
        Write-Host 'Let''s Encrypt kosullari: https://letsencrypt.org/repository/'
        Write-Host 'VDS ve saglayici panelinde TCP 80 acik kalmali. Nginx varsa web dizini uzerinden dogrulama denenir; servis durdurulmaz.'
        $consent = Read-Default 'Kosullari kabul edip baslat? E/h' 'E'
        if ($consent -notmatch '^[EeYy]$') { throw 'Kurulum iptal edildi.' }
    }
    foreach ($tool in @('ssh', 'scp', 'tar')) { if (!(Get-Command $tool -ErrorAction SilentlyContinue)) { throw "Eksik arac: $tool" } }
    $archive = Join-Path ([IO.Path]::GetTempPath()) ('xantum-deploy-' + [Guid]::NewGuid().ToString('N') + '.tar.gz')
    $files = @('setup.sh', 'tls-setup.sh', 'acme-webroot.py', 'xtp-tun.c', 'backend/server.js', 'backend/chat.js', 'backend/xtp-server.js', 'backend/tls-reload.js', 'backend/package.json', 'backend/package-lock.json')
    & tar -czf $archive -C $PSScriptRoot @files
    if ($LASTEXITCODE -ne 0) { throw 'Kaynak paketlenemedi.' }
    $remote = "$serverUser@$serverHost"
    $remoteDir = (& ssh -p $serverPort $remote 'mktemp -d /tmp/xantum-deploy.XXXXXX' | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $remoteDir -notmatch '^/tmp/xantum-deploy\.[a-zA-Z0-9]+$') { $remoteDir = $null; throw 'Uzak gecici dizin olusturulamadi.' }
    & scp -P $serverPort $archive "${remote}:$remoteDir/source.tar.gz"
    if ($LASTEXITCODE -ne 0) { throw 'Kaynak yuklenemedi.' }
    $command = "set -eu; trap 'rm -rf -- $remoteDir' EXIT; tar -xzf '$remoteDir/source.tar.gz' -C '$remoteDir'; cd '$remoteDir'; if [ `"`$(id -u)`" -eq 0 ]; then set --; else command -v sudo >/dev/null || { echo 'sudo gerekli.' >&2; exit 1; }; set -- sudo; fi; `"`$@`" env PUBLIC_HOST='$publicHost' TLS_MODE='$tlsMode' TLS_CERT='$cert' TLS_KEY='$key' SSH_PORT='$serverPort' XANTUM_ACME_WEBROOT='$acmeWebroot' LE_AGREE_TOS=1 bash setup.sh --auto"
    & ssh -t -p $serverPort $remote $command
    if ($LASTEXITCODE -ne 0) { throw 'Sunucu kurulumu tamamlanmadi. Yukaridaki aciklamayi duzeltip yeniden deneyin.' }
    $remoteDir = $null
    Write-Host 'Kurulum tamamlandi. Sunucu ciktisindaki katilim anahtarini ozel saklayin.'
} catch {
    if ($remoteDir -and $remoteDir -match '^/tmp/xantum-deploy\.[a-zA-Z0-9]+$') { & ssh -p $serverPort $remote "rm -rf -- '$remoteDir'" }
    Write-Error $_
    exit 1
} finally {
    if ($archive -and (Test-Path -LiteralPath $archive)) { Remove-Item -LiteralPath $archive -Force }
}
