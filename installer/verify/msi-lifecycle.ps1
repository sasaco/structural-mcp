[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$MsiPath,
    [string]$ExpectedSha256
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$scratchBase = [IO.Path]::GetFullPath((Join-Path $repoRoot '.structural-mcp\installer-work\root-verification'))
$sourceMsi = (Resolve-Path -LiteralPath $MsiPath).Path
if ([IO.Path]::GetExtension($sourceMsi) -ne '.msi') { throw 'MsiPath must name an MSI file.' }
$sourceHash = (Get-FileHash -LiteralPath $sourceMsi -Algorithm SHA256).Hash.ToLowerInvariant()
if ($ExpectedSha256 -and $sourceHash -ne $ExpectedSha256.ToLowerInvariant()) { throw 'MSI hash differs from the final artifact supplied for testing.' }

function Hash-OrMissing([string]$Path) {
    if (![IO.File]::Exists($Path)) { return 'missing' }
    $stream = [IO.File]::OpenRead($Path)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose(); $stream.Dispose() }
}
function Assert-Child([string]$Path, [string]$Parent) {
    $absolute = [IO.Path]::GetFullPath($Path)
    $parentAbsolute = [IO.Path]::GetFullPath($Parent).TrimEnd('\')
    if (!$absolute.StartsWith($parentAbsolute + '\', [StringComparison]::OrdinalIgnoreCase)) { throw "Path is outside verification scratch root: $absolute" }
    return $absolute
}
function Get-MsiProperty($Database, [string]$Name, [string]$Table = 'Property', [string]$ValueColumn = 'Value', [string]$KeyColumn = 'Property') {
    $query = "SELECT ``$ValueColumn`` FROM ``$Table`` WHERE ``$KeyColumn``='$Name'"
    $view = $Database.GetType().InvokeMember('OpenView', 'InvokeMethod', $null, $Database, @($query))
    try {
        [void]$view.GetType().InvokeMember('Execute', 'InvokeMethod', $null, $view, $null)
        $record = $view.GetType().InvokeMember('Fetch', 'InvokeMethod', $null, $view, $null)
        if (!$record) { throw "MSI property missing: $Name" }
        try { return [string]$record.GetType().InvokeMember('StringData', 'GetProperty', $null, $record, @(1)) }
        finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($record) }
    } finally {
        [void]$view.GetType().InvokeMember('Close', 'InvokeMethod', $null, $view, $null)
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($view)
    }
}
function Get-RelatedProducts($Installer, [string]$UpgradeCode) {
    return @($Installer.GetType().InvokeMember('RelatedProducts', 'GetProperty', $null, $Installer, @($UpgradeCode)) | ForEach-Object { [string]$_ })
}
function Invoke-Msi([string]$Action, [string]$Arguments) {
    Write-Host "[MSI lifecycle] Starting $Action..."
    $log = Join-Path $work ($Action + '.log')
    $fullArguments = $Arguments + ' /qn /norestart /L*v "' + $log + '"'
    $process = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\msiexec.exe') -ArgumentList $fullArguments -WindowStyle Hidden -Wait -PassThru
    $result = [ordered]@{ action = $Action; exitCode = $process.ExitCode; log = $log }
    $evidence.operations.Add($result)
    Write-Host "[MSI lifecycle] $Action exited $($process.ExitCode)."
    if ($process.ExitCode -notin @(0, 3010)) { throw "MSI $Action failed with exit $($process.ExitCode). Log: $log" }
}
function Assert-Manifest([string]$InstalledRoot) {
    Write-Host '[MSI lifecycle] Verifying installed manifest hashes...'
    $manifestPath = Assert-Child (Join-Path $InstalledRoot 'release-manifest.json') $work
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($manifest.schemaVersion -ne 1 -or $manifest.files.Count -lt 1) { throw 'Installed manifest is invalid.' }
    $nodeEntry = @($manifest.files | Where-Object { $_.path -eq 'runtime/node/node.exe' })
    $bundledNode = Assert-Child (Join-Path $InstalledRoot 'runtime\node\node.exe') $InstalledRoot
    if ($nodeEntry.Count -ne 1 -or (Hash-OrMissing $bundledNode) -ne $nodeEntry[0].sha256) { throw 'Bundled verification runtime failed its SHA-256 check.' }
    $report = & $bundledNode (Join-Path $PSScriptRoot 'manifest-integrity.mjs') $InstalledRoot --allow-runtime-state
    if ($LASTEXITCODE -ne 0) { throw 'Installed manifest integrity verification failed.' }
    $result = $report | ConvertFrom-Json
    if (!$result.ok) { throw 'Installed manifest integrity verification did not report success.' }
    Write-Host "[MSI lifecycle] Verified $($result.verifiedManifestFiles) files."
    return $result.verifiedManifestFiles
}

$installer = New-Object -ComObject WindowsInstaller.Installer
$database = $installer.GetType().InvokeMember('OpenDatabase', 'InvokeMethod', $null, $installer, @($sourceMsi, 0))
try {
    $productCode = Get-MsiProperty $database 'ProductCode'
    $upgradeCode = Get-MsiProperty $database 'UpgradeCode'
    $productName = Get-MsiProperty $database 'ProductName'
    $installVersion = (Get-MsiProperty $database 'INSTALLFOLDER' 'Directory' 'DefaultDir' 'Directory').Split('|')[-1]
} finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($database) }
if ($upgradeCode -ne '{E617F890-6A7D-4BDD-A752-7AC3E7759B28}' -or $productName -notlike 'structural-mcp*') { throw 'MSI does not match the expected structural-mcp installer identity.' }
$relatedBefore = @(Get-RelatedProducts $installer $upgradeCode)
if ($relatedBefore.Count) { throw 'A related structural-mcp product is already installed; lifecycle verification refuses to upgrade or remove it.' }
$uninstallRoots = @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')
foreach ($registryRoot in $uninstallRoots) {
    $existing = @(Get-ChildItem -LiteralPath $registryRoot -ErrorAction SilentlyContinue | Get-ItemProperty -ErrorAction SilentlyContinue | Where-Object { $_.PSObject.Properties['DisplayName'] -and $_.DisplayName -like 'structural-mcp*' })
    if ($existing.Count) { throw 'An existing structural-mcp Apps entry was found; verification refused before installation.' }
}
$defaultInstallRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA ('Programs\structural-mcp\' + $installVersion)))
if (Test-Path -LiteralPath $defaultInstallRoot) { throw 'Default install directory already exists; verify or remove earlier test artifacts before testing a custom install path.' }

New-Item -ItemType Directory -Path $scratchBase -Force | Out-Null
$scratchBase = (Resolve-Path -LiteralPath $scratchBase).Path
$checkedParent = $scratchBase
while ($checkedParent.Length -ge $repoRoot.Length) {
    if ((Get-Item -LiteralPath $checkedParent -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Lifecycle scratch must not pass through a reparse point.' }
    if ($checkedParent -eq $repoRoot) { break }
    $checkedParent = Split-Path -Parent $checkedParent
}
$work = Assert-Child (Join-Path $scratchBase ('msi-lifecycle-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))) $scratchBase
New-Item -ItemType Directory -Path $work | Out-Null
$installRoot = Assert-Child (Join-Path $work 'installed') $work
$isolatedCodex = Assert-Child (Join-Path $work 'codex-home') $work
$testMsi = Assert-Child (Join-Path $work 'tested.msi') $work
Copy-Item -LiteralPath $sourceMsi -Destination $testMsi
if ((Hash-OrMissing $testMsi) -ne $sourceHash) { throw 'MSI changed while preparing a stable test copy.' }
$realConfig = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex\config.toml'
$realBefore = Hash-OrMissing $realConfig
$priorCodexHome = $env:CODEX_HOME
$env:CODEX_HOME = $isolatedCodex
$evidence = [ordered]@{ ok = $false; work = $work; msi = $sourceMsi; sha256 = $sourceHash; productCode = $productCode; upgradeCode = $upgradeCode;
    installRoot = $installRoot; defaultInstallRoot = $defaultInstallRoot; realConfigBeforeSha256 = $realBefore; operations = [Collections.Generic.List[object]]::new(); fixture = $null }
$attemptedInstall = $false
try {
    $attemptedInstall = $true
    Invoke-Msi 'install' ('/i "' + $testMsi + '" INSTALLFOLDER="' + $installRoot + '"')
    $evidence.installedFileCount = Assert-Manifest $installRoot
    $fixtureOutput = & (Join-Path $installRoot 'runtime\node\node.exe') (Join-Path $PSScriptRoot 'create-registration-fixture.mjs') $installRoot $work
    if ($LASTEXITCODE -ne 0) { throw 'Isolated Codex registration fixture could not be created.' }
    $evidence.fixture = $fixtureOutput | ConvertFrom-Json
    $repairTarget = Assert-Child (Join-Path $installRoot 'INSTALLER-README.md') $installRoot
    Remove-Item -LiteralPath $repairTarget
    Invoke-Msi 'repair' ('/fa ' + $productCode)
    $evidence.repairedFileCount = Assert-Manifest $installRoot
    $evidence.defaultRootCreatedByRepair = Test-Path -LiteralPath $defaultInstallRoot
    if ($evidence.defaultRootCreatedByRepair) { throw 'Repair unexpectedly created the default install directory.' }
    # Prove the successful registration receipt is used even when the current environment differs.
    $env:CODEX_HOME = Join-Path $work 'different-uninstall-codex-home'
    Invoke-Msi 'uninstall' ('/x ' + $productCode)
    $evidence.relatedAfter = @(Get-RelatedProducts $installer $upgradeCode)
    if ($evidence.relatedAfter.Count) { throw 'Test product remains registered after uninstall.' }
    $evidence.installedServerRemaining = Test-Path -LiteralPath (Join-Path $installRoot 'server\dist\src\index.js')
    if ($evidence.installedServerRemaining) { throw 'Installed server remained after uninstall.' }
    $evidence.fixtureAfterSha256 = Hash-OrMissing $evidence.fixture.configPath
    $evidence.uninstallHookReachedIsolatedCodex = $evidence.fixtureAfterSha256 -eq $evidence.fixture.originalSha256
    if (!$evidence.uninstallHookReachedIsolatedCodex) { throw 'MSI removal completed but the isolated owned registration was not removed; inspect custom action environment/log.' }
    $evidence.placedSkillsRemaining = @($evidence.fixture.placedSkills | Where-Object { Test-Path -LiteralPath $_ })
    if ($evidence.placedSkillsRemaining.Count) { throw 'MSI removal completed but skills placed by the installation remain.' }
    $evidence.foreignSkillKept = Test-Path -LiteralPath $evidence.fixture.foreignSkill
    if (!$evidence.foreignSkillKept) { throw 'MSI removal deleted a skill the installation did not place.' }
    $evidence.ok = $true
} catch {
    $evidence.error = $_.Exception.Message
} finally {
    if ($attemptedInstall) {
        try {
            $remaining = @(Get-RelatedProducts $installer $upgradeCode)
            if ($remaining -contains $productCode) { Invoke-Msi 'cleanup-uninstall' ('/x ' + $productCode + ' INSTALLFOLDER="' + $installRoot + '"') }
            $evidence.finalRelatedProducts = @(Get-RelatedProducts $installer $upgradeCode)
            if ($evidence.finalRelatedProducts.Count) { $evidence.ok = $false; $evidence.cleanupError = 'A product remains registered.' }
        } catch { $evidence.ok = $false; $evidence.cleanupError = $_.Exception.Message }
    }
    if ($null -eq $priorCodexHome) { Remove-Item Env:CODEX_HOME -ErrorAction SilentlyContinue } else { $env:CODEX_HOME = $priorCodexHome }
    $evidence.realConfigAfterSha256 = Hash-OrMissing $realConfig
    $evidence.realConfigUnchanged = $evidence.realConfigAfterSha256 -eq $realBefore
    $evidence.defaultRootExistsFinally = Test-Path -LiteralPath $defaultInstallRoot
    if ($null -ne $evidence.fixture) {
        $evidence.fixtureFinalSha256 = Hash-OrMissing $evidence.fixture.configPath
        $evidence.finalOwnedFixtureRemoved = $evidence.fixtureFinalSha256 -eq $evidence.fixture.originalSha256
    }
    if (!$evidence.realConfigUnchanged) { $evidence.ok = $false; $evidence.realConfigError = 'Real Codex config hash changed during verification; no restore was attempted.' }
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($installer)
    $report = $evidence | ConvertTo-Json -Depth 10
    [IO.File]::WriteAllText((Join-Path $work 'lifecycle.json'), $report + "`n", [Text.UTF8Encoding]::new($false))
    Write-Output $report
}
if (!$evidence.ok) { exit 1 }
