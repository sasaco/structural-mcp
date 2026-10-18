[CmdletBinding()]
param(
    [switch]$Preview,
    [switch]$SkipMsi,
    [string]$StagePath,
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9-]{0,31}$')]
    [string]$ArtifactSuffix
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$workRoot = Join-Path $repoRoot '.structural-mcp\installer-work'
$inputs = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'inputs.json') -Raw | ConvertFrom-Json
$version = (Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'MSI requires a three-component numeric package version.' }
$installVersion = if ($Preview) { "$version-preview" } else { $version }
$label = if ($Preview) { 'Preview (unsigned)' } else { '(unsigned)' }

function Invoke-Checked([string]$Command, [string[]]$Arguments, [string]$LogPath) {
    if ($LogPath) { & $Command @Arguments *> $LogPath } else { & $Command @Arguments }
    if ($LASTEXITCODE -ne 0) {
        if ($LogPath) { Get-Content -LiteralPath $LogPath -Tail 15 | Write-Host }
        throw "$Command failed with exit code $LASTEXITCODE. Log: $LogPath"
    }
}
function New-Directory([string]$Path) {
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
}
function Get-VerifiedArchive($Definition, [string]$Name) {
    $archive = Join-Path $workRoot "downloads\$Name.zip"
    New-Directory (Split-Path $archive)
    if (!(Test-Path -LiteralPath $archive)) {
        Write-Host "Downloading pinned $Name $($Definition.version)..."
        Invoke-WebRequest -UseBasicParsing -Uri $Definition.url -OutFile $archive -TimeoutSec 300
    }
    $actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $Definition.sha256) { throw "Checksum mismatch: $archive. Remove this cached archive and retry." }
    return $archive
}
function Copy-File([string]$Source, [string]$Destination) {
    New-Directory (Split-Path $Destination)
    Copy-Item -LiteralPath $Source -Destination $Destination
}
function Expand-PinnedArchive([string]$Archive, [string]$Destination) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $destinationRoot = [IO.Path]::GetFullPath($Destination) + '\'
    $zip = [IO.Compression.ZipFile]::OpenRead($Archive)
    try {
        foreach ($entry in $zip.Entries) {
            $target = [IO.Path]::GetFullPath((Join-Path $Destination $entry.FullName))
            if (!$target.StartsWith($destinationRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Archive entry escapes its destination.' }
        }
    } finally { $zip.Dispose() }
    [IO.Compression.ZipFile]::ExtractToDirectory($Archive, $Destination)
}
function Resolve-CanonicalDirectory([string]$Path) {
    $resolved = & node -e "console.log(require('fs').realpathSync(process.argv[1]))" $Path
    if ($LASTEXITCODE -ne 0) { throw "Cannot resolve directory: $Path" }
    return [string]$resolved
}

New-Directory $workRoot
if ($StagePath) {
    $payload = Resolve-CanonicalDirectory $StagePath
    $canonicalWorkRoot = Resolve-CanonicalDirectory $workRoot
    if (!$payload.StartsWith($canonicalWorkRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'StagePath must be an existing payload inside .structural-mcp/installer-work.'
    }
    if (!(Test-Path -LiteralPath (Join-Path $payload 'release-manifest.json'))) { throw 'Staged manifest is missing.' }
    $stagedManifest = Get-Content -LiteralPath (Join-Path $payload 'release-manifest.json') -Raw | ConvertFrom-Json
    if ($stagedManifest.version -ne $installVersion -or (($stagedManifest.channel -eq 'preview') -ne $Preview.IsPresent)) {
        throw 'Stage manifest version/channel does not match this invocation. Specify the matching -Preview switch and package version.'
    }
    $runRoot = Split-Path $payload
} else {
    # Unique output directories: never delete or overwrite an earlier build or user folder.
    $runRoot = Join-Path $workRoot ((Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    $payload = Join-Path $runRoot 'payload'
    New-Directory $payload
    Write-Host "Building $installVersion at $runRoot"
    Invoke-Checked 'node' @((Join-Path $PSScriptRoot 'payload.mjs'), 'sources', $repoRoot, $runRoot, $Preview.ToString())
    $nodeZip = Get-VerifiedArchive $inputs.node 'node'
    $uvZip = Get-VerifiedArchive $inputs.uv 'uv'
    Expand-PinnedArchive $nodeZip (Join-Path $runRoot 'node-download')
    Expand-PinnedArchive $uvZip (Join-Path $runRoot 'uv-download')
    $nodeSource = Join-Path $runRoot ('node-download\node-v' + $inputs.node.version + '-win-x64')
    Copy-File (Join-Path $nodeSource 'node.exe') (Join-Path $payload 'runtime\node\node.exe')
    Copy-File (Join-Path $nodeSource 'LICENSE') (Join-Path $payload 'licenses\node-LICENSE.txt')
    $uvExe = @(Get-ChildItem -LiteralPath (Join-Path $runRoot 'uv-download') -Recurse -File -Filter 'uv.exe')
    if ($uvExe.Count -ne 1) { throw 'Expected exactly one uv.exe in the archive.' }
    Copy-File $uvExe[0].FullName (Join-Path $payload 'runtime\uv\uv.exe')
    $nodeExe = Join-Path $payload 'runtime\node\node.exe'
    $npmCli = Join-Path $nodeSource 'node_modules\npm\bin\npm-cli.js'
    $serverBuild = Join-Path $runRoot 'server-build'
    New-Directory $serverBuild
    foreach ($name in @('package.json', 'package-lock.json', 'tsconfig.json')) {
        Copy-File (Join-Path $repoRoot $name) (Join-Path $serverBuild $name)
    }
    foreach ($name in @('src', 'tests')) { Copy-Item -LiteralPath (Join-Path $repoRoot $name) -Destination $serverBuild -Recurse }
    Invoke-Checked $nodeExe @($npmCli, 'ci', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', $serverBuild)
    Invoke-Checked $nodeExe @((Join-Path $serverBuild 'node_modules\typescript\bin\tsc'), '-p', (Join-Path $serverBuild 'tsconfig.json'))
    $serverRoot = Join-Path $payload 'server'
    New-Directory $serverRoot
    foreach ($name in @('package.json', 'package-lock.json')) { Copy-File (Join-Path $repoRoot $name) (Join-Path $serverRoot $name) }
    New-Directory (Join-Path $serverRoot 'dist')
    Copy-Item -LiteralPath (Join-Path $serverBuild 'dist\src') -Destination (Join-Path $serverRoot 'dist') -Recurse
    Invoke-Checked $nodeExe @($npmCli, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', $serverRoot)
    Invoke-Checked $nodeExe @((Join-Path $PSScriptRoot 'payload.mjs'), 'copy', $repoRoot, $payload)
    Invoke-Checked $nodeExe @($npmCli, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', $payload)
    $publishSpecs = @(
        @('Capacita\WebDanforCS\Headless\WebDanforCS.Headless.csproj', 'engines\Capacita', $inputs.dotnetRuntime8),
        @('SoilStructure\SoilStructure\Headless\SoilStructure.Headless.csproj', 'engines\SoilStructure', $inputs.dotnetRuntime10),
        @('FEMPython\FrameWebforCS\Headless\FrameWebforCS.Headless.csproj', 'engines\FEMPython\FrameWebforCS\Headless', $inputs.dotnetRuntime10)
    )
    foreach ($spec in $publishSpecs) {
        $project = Join-Path $repoRoot $spec[0]
        $output = Join-Path $payload $spec[1]
        $artifacts = Join-Path $runRoot ('dotnet-' + ($spec[1] -split '\\')[1])
        Write-Host "Publishing $($spec[0])..."
        # Restore outputs and any generated lockfiles live outside the user's source tree.
        Invoke-Checked 'dotnet' @('publish', $project, '-c', 'Release', '-r', 'win-x64', '--self-contained', 'true',
            '--artifacts-path', $artifacts, '-o', $output, '-p:PublishSingleFile=false', '-p:PublishTrimmed=false', '-p:DebugType=None', '-p:DebugSymbols=false',
            '-clp:ErrorsOnly', ('-flp:LogFile=' + $artifacts + '-build.log;Verbosity=normal'),
            '-p:RestorePackagesWithLockFile=false', ('-p:NuGetLockFilePath=' + $artifacts + '\unused-packages.lock.json'),
            ('-p:RuntimeFrameworkVersion=' + $spec[2]))
    }
    # Aggre-SE (Batch) is .NET Framework 4.8 with licensed vendor components (SPREAD, ComponentOne,
    # VB-Report8): it needs Visual Studio MSBuild and builds into the submodule's own bin folder.
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (!(Test-Path -LiteralPath $vswhere)) { throw 'Aggre-SE runner requires Visual Studio (vswhere.exe not found).' }
    $msbuild = @(& $vswhere -latest -products '*' -requires Microsoft.Component.MSBuild -find 'MSBuild\**\Bin\MSBuild.exe') | Select-Object -First 1
    if (!$msbuild) { throw 'Aggre-SE runner requires Visual Studio MSBuild.' }
    Write-Host 'Building Batch\Aggre-SE\Headless\AggreSE.Headless.csproj...'
    Invoke-Checked $msbuild @((Join-Path $repoRoot 'Batch\Aggre-SE\Headless\AggreSE.Headless.csproj'), '-restore', '/p:Configuration=Release', '/v:minimal', '/nologo') (Join-Path $runRoot 'msbuild-aggrese.log')
    $aggreSeOutput = Join-Path $repoRoot 'Batch\Aggre-SE\Headless\bin\Release'
    foreach ($file in Get-ChildItem -LiteralPath $aggreSeOutput -Recurse -File) {
        if ($file.Extension -in '.pdb', '.xml') { continue }
        Copy-File $file.FullName (Join-Path $payload ('engines\Aggre-SE\' + $file.FullName.Substring($aggreSeOutput.Length + 1)))
    }
    Invoke-Checked $nodeExe @((Join-Path $PSScriptRoot 'payload.mjs'), 'finalize', $repoRoot, $runRoot, $installVersion)
}

if (!$SkipMsi) {
    $nodeExe = Join-Path $payload 'runtime\node\node.exe'
    # The trusted build-host Node verifies staged executables before any staged code runs.
    Invoke-Checked 'node' @((Join-Path $PSScriptRoot 'payload.mjs'), 'verify', $payload)
    Invoke-Checked $nodeExe @((Join-Path $PSScriptRoot 'payload.mjs'), 'wix', $payload, $runRoot)
    $artifactTag = if ($ArtifactSuffix) { '-' + $ArtifactSuffix } else { '' }
    $msiRoot = Join-Path $runRoot ('msi' + $artifactTag)
    New-Directory $msiRoot
    $msiName = "structural-mcp-$installVersion$artifactTag-win-x64"
    $msiPath = Join-Path $msiRoot ($msiName + '.msi')
    if (Test-Path -LiteralPath $msiPath) { throw 'MSI output already exists. Preserve it and choose a new ArtifactSuffix.' }
    Invoke-Checked 'dotnet' @('build', (Join-Path $repoRoot 'installer\packaging\structural-mcp.wixproj'), '-c', 'Release',
        ('-p:PayloadRoot=' + $payload), ('-p:PayloadWxs=' + (Join-Path $runRoot 'Payload.wxs')),
        ('-p:ProductVersion=' + $version), ('-p:InstallVersion=' + $installVersion), ('-p:ProductLabel=' + $label),
        ('-p:BaseIntermediateOutputPath=' + (Join-Path $runRoot 'wix-obj\')),
        ('-p:OutputPath=' + $msiRoot + '\'), ('-p:OutputName=' + $msiName)) (Join-Path $runRoot ('wix-build' + $artifactTag + '.log'))
    if (!(Test-Path -LiteralPath $msiPath)) { throw 'WiX completed without the expected MSI.' }
    $hash = (Get-FileHash -LiteralPath $msiPath -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText($msiPath + '.sha256', "$hash  $msiName.msi`n", [Text.UTF8Encoding]::new($false))
    $packagingSources = @()
    foreach ($directory in @('installer\build', 'installer\packaging')) {
        foreach ($file in Get-ChildItem -LiteralPath (Join-Path $repoRoot $directory) -File) {
            $packagingSources += [ordered]@{ path = $directory + '\' + $file.Name; sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
        }
    }
    $buildRecord = [ordered]@{
        schemaVersion = 1; version = $installVersion; signed = $false; msiSha256 = $hash
        payloadManifestSha256 = (Get-FileHash -LiteralPath (Join-Path $payload 'release-manifest.json') -Algorithm SHA256).Hash.ToLowerInvariant()
        dotnetSdk = (& dotnet --version); wixSdk = $inputs.wix; packagingSources = $packagingSources
    }
    [IO.File]::WriteAllText((Join-Path $msiRoot 'msi-build-manifest.json'), ($buildRecord | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
    Write-Output "MSI=$msiPath"
}
Write-Output "PAYLOAD=$payload"
Write-Output "BUILD=$runRoot"
