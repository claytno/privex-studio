[CmdletBinding()]
param(
    [ValidateSet('stable','beta')][string]$Channel = 'stable',
    [switch]$AllowUnsignedBeta,
    [string]$CertificateThumbprint = '',
    [string]$IsccPath = '',
    [string]$SignToolPath = '',
    [string]$TimestampUrl = 'http://timestamp.digicert.com'
)
$ErrorActionPreference = 'Stop'
$studioRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$studioPayload = Join-Path $studioRoot 'build\app'
$studioOutput = Join-Path $studioRoot 'build\installers'
$studioPackage = Get-Content -LiteralPath (Join-Path $studioRoot 'package.json') -Raw | ConvertFrom-Json
$studioVersion = [string]$studioPackage.version
if ($studioVersion -notmatch '^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$') { throw 'Invalid package version.' }
if ($AllowUnsignedBeta -and $Channel -ne 'beta') { throw 'Unsigned installers are allowed only for explicit beta builds.' }
if (-not $AllowUnsignedBeta -and $CertificateThumbprint -notmatch '^[0-9A-Fa-f]{40}$') {
    throw 'Signed release blocked: provide a real code-signing certificate thumbprint. Explicit unsigned beta: -Channel beta -AllowUnsignedBeta.'
}
if ($Channel -eq 'stable' -and $studioVersion.Contains('-')) { throw 'Prerelease package versions cannot be published as stable.' }
if ($Channel -eq 'beta' -and -not $studioVersion.Contains('-')) { throw 'Beta installers require a prerelease version so the application uses its isolated beta profile.' }
if (-not $IsccPath) { $studioIscc = Get-Command ISCC.exe -ErrorAction SilentlyContinue; if ($studioIscc) { $IsccPath=$studioIscc.Source } }
if (-not $IsccPath -or -not (Test-Path -LiteralPath $IsccPath -PathType Leaf)) { throw 'Install the official Inno Setup compiler and provide -IsccPath.' }
$studioNode = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $studioNode) { $studioNode = 'C:\Program Files\nodejs\node.exe' }
& $studioNode (Join-Path $PSScriptRoot 'package-audit.mjs') $studioPayload
if ($LASTEXITCODE -ne 0) { throw 'Payload audit failed.' }
$studioReleaseChannel = $Channel
$studioSignCommand = $null
if ($AllowUnsignedBeta) {
    $studioReleaseChannel = 'beta-unsigned'
    Write-Warning 'UNSIGNED BETA: no publisher signature. Windows may warn or block installation. Never label this a signed or verified release.'
} else {
    $studioCertificate = Get-Item -LiteralPath "Cert:\CurrentUser\My\$CertificateThumbprint" -ErrorAction Stop
    if (-not $studioCertificate.HasPrivateKey -or $studioCertificate.NotAfter -le (Get-Date) -or $studioCertificate.NotBefore -gt (Get-Date)) { throw 'Code-signing certificate is unusable.' }
    if (-not ($studioCertificate.EnhancedKeyUsageList.ObjectId.Value -contains '1.3.6.1.5.5.7.3.3')) { throw 'Certificate must have the Code Signing EKU.' }
    if (-not $SignToolPath) {
        $studioTools = @(Get-ChildItem -LiteralPath 'C:\Program Files (x86)\Windows Kits\10\bin' -Filter signtool.exe -Recurse | Where-Object { $_.FullName -match '\\x64\\signtool.exe$' } | Sort-Object FullName -Descending)
        if ($studioTools.Count) { $SignToolPath = $studioTools[0].FullName }
    }
    if (-not (Test-Path -LiteralPath $SignToolPath -PathType Leaf)) { throw 'Windows SDK signtool.exe is required for a signed release.' }
    if ($TimestampUrl -notmatch '^https?://[a-zA-Z0-9./_-]+$') { throw 'Invalid timestamp service URL.' }
    # Sign only project-owned binaries. Preserve all upstream signatures.
    $studioBinaries = @((Get-Item -LiteralPath (Join-Path $studioPayload 'Privex Studio.exe')), (Get-Item -LiteralPath (Join-Path $studioPayload 'resources\engine\PrivexStudioEngine.exe')))
    foreach ($studioBinary in $studioBinaries) {
        $studioSignature = Get-AuthenticodeSignature -LiteralPath $studioBinary.FullName
        if ($studioSignature.Status -ne 'Valid') {
            & $SignToolPath sign /sha1 $CertificateThumbprint /fd SHA256 /tr $TimestampUrl /td SHA256 $studioBinary.FullName
            if ($LASTEXITCODE -ne 0) { throw "Signing failed: $($studioBinary.Name)" }
        }
        if ((Get-AuthenticodeSignature -LiteralPath $studioBinary.FullName).Status -ne 'Valid') { throw "Signature verification failed: $($studioBinary.Name)" }
    }
    # Inno invokes this for setup and its generated uninstaller. No private key is exported.
    $studioSignCommand = 'privex="' + $SignToolPath + '" sign /sha1 ' + $CertificateThumbprint + ' /fd SHA256 /tr ' + $TimestampUrl + ' /td SHA256 $f'
}
New-Item -ItemType Directory -Force -Path $studioOutput | Out-Null
$studioInstaller = Join-Path $studioOutput "Privex-Studio-$studioVersion-$studioReleaseChannel-Windows-x64-Setup.exe"
if (Test-Path -LiteralPath $studioInstaller) { throw 'Installer already exists. Use a new version or archive the previous local artifact.' }
$studioIsccArgs = @('/Q', "/DAppVersion=$studioVersion", "/DPayloadDir=$studioPayload", "/DOutputDirPath=$studioOutput", "/DReleaseChannel=$studioReleaseChannel")
if ($studioSignCommand) { $studioIsccArgs += '/DSignedBuild=1'; $studioIsccArgs += "/S$studioSignCommand" }
& $IsccPath @studioIsccArgs (Join-Path $studioRoot 'installer\PrivexStudio.iss')
if ($LASTEXITCODE -ne 0) { throw 'Installer compilation failed.' }
$studioInstallerSignature = Get-AuthenticodeSignature -LiteralPath $studioInstaller
if (-not $AllowUnsignedBeta -and ($studioInstallerSignature.Status -ne 'Valid' -or $studioInstallerSignature.SignerCertificate.Thumbprint -ne $CertificateThumbprint)) { throw 'Installer signature does not match the requested release certificate.' }
$studioRelease = [ordered]@{
    version = $studioVersion; channel = $studioReleaseChannel
    file = [IO.Path]::GetFileName($studioInstaller)
    bytes = (Get-Item -LiteralPath $studioInstaller).Length
    sha256 = (Get-FileHash -LiteralPath $studioInstaller -Algorithm SHA256).Hash.ToLowerInvariant()
    authenticodeStatus = [string]$studioInstallerSignature.Status
    automaticUpdateEligible = $true
    published = $false
}
$studioRelease | ConvertTo-Json | Set-Content -LiteralPath ($studioInstaller + '.json') -Encoding utf8
$studioRelease | ConvertTo-Json
