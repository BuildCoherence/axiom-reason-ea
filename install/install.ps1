$ErrorActionPreference = 'Stop'

[Net.ServicePointManager]::SecurityProtocol = `
    [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

function Update-AxmPath($installDir) {
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if (-not $userPath) { $userPath = '' }
    if (($userPath -split ';') -notcontains $installDir) {
        $newPath = if ($userPath) { "$userPath;$installDir" } else { $installDir }
        [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
    }

    if (-not ('AxmInstaller.Environment' -as [type])) {
        Add-Type -Namespace AxmInstaller -Name Environment -MemberDefinition @'
        [System.Runtime.InteropServices.DllImport("user32.dll", SetLastError=true, CharSet=System.Runtime.InteropServices.CharSet.Auto)]
        public static extern System.IntPtr SendMessageTimeout(
            System.IntPtr hWnd, uint Msg, System.UIntPtr wParam, string lParam,
            uint fuFlags, uint uTimeout, out System.UIntPtr lpdwResult);
'@
    }
    $result = [System.UIntPtr]::Zero
    [AxmInstaller.Environment]::SendMessageTimeout(
        [System.IntPtr]0xffff, 0x1A, [System.UIntPtr]::Zero, 'Environment',
        2, 5000, [ref]$result) | Out-Null
}

function Install-Axm {
    $releaseBaseUrl = 'https://github.com/BuildCoherence/axiom-reason-ea/releases/latest/download'
    $archRaw = $env:PROCESSOR_ARCHITEW6432
    if (-not $archRaw) { $archRaw = $env:PROCESSOR_ARCHITECTURE }
    switch ($archRaw) {
        'AMD64' { $arch = 'amd64' }
        'ARM64' { $arch = 'arm64' }
        default { throw "axm-install: unsupported architecture: '$archRaw'" }
    }

    $archive = "axm_windows_${arch}.zip"
    $tmp = Join-Path $env:TEMP "axm-install-$([Guid]::NewGuid())"
    $staged = $null
    New-Item -ItemType Directory -Path $tmp | Out-Null
    try {
        Invoke-WebRequest -UseBasicParsing -Uri "$releaseBaseUrl/$archive" -OutFile "$tmp/$archive"
        Invoke-WebRequest -UseBasicParsing -Uri "$releaseBaseUrl/checksums.txt" -OutFile "$tmp/checksums.txt"

        $lines = @(Get-Content "$tmp/checksums.txt" | Where-Object {
            $_ -cmatch "^\S+\s+$([regex]::Escape($archive))$"
        })
        if ($lines.Count -ne 1 -or $lines[0] -notmatch '^([0-9a-fA-F]{64})\s+') {
            throw "axm-install: missing, duplicate, or invalid checksum for $archive"
        }
        $expected = $Matches[1]
        $actual = (Get-FileHash -Algorithm SHA256 "$tmp/$archive").Hash
        if ($actual -ne $expected) {
            throw "axm-install: checksum mismatch for $archive"
        }

        Expand-Archive -Path "$tmp/$archive" -DestinationPath "$tmp/extract"
        $installDir = "$env:LOCALAPPDATA/Programs/axm"
        New-Item -ItemType Directory -Path $installDir -Force | Out-Null
        $staged = Join-Path $installDir ".axm-$([Guid]::NewGuid()).exe"
        Copy-Item -LiteralPath "$tmp/extract/axm.exe" -Destination $staged
        $destination = Join-Path $installDir 'axm.exe'
        try {
            if (Test-Path -LiteralPath $destination) {
                [IO.File]::Replace($staged, $destination, [System.Management.Automation.Language.NullString]::Value)
            } else {
                [IO.File]::Move($staged, $destination)
            }
        } catch {
            throw "axm-install: cannot replace ${destination}. Close running axm processes and check directory permissions. $($_.Exception.Message)"
        }

        Update-AxmPath $installDir
        Write-Host "axm installed to $destination. Open a new terminal window to pick up the updated PATH."
    } finally {
        if ($staged -and (Test-Path -LiteralPath $staged)) {
            Remove-Item -LiteralPath $staged -Force
        }
        Remove-Item -LiteralPath $tmp -Recurse -Force
    }
}

Install-Axm
