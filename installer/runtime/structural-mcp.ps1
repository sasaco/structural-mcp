param(
    [ValidateSet('initialize', 'register-codex', 'health', 'unregister-codex')]
    [string]$Action = 'register-codex',
    [string]$CodexHome,
    [string]$DataRoot,
    [string]$AllowedRoot,
    [switch]$ReplaceExisting,
    [switch]$NoPause
)
$ErrorActionPreference = 'Stop'
$resultCode = 1
try {
    $node = Join-Path $PSScriptRoot 'runtime\node\node.exe'
    $launcher = Join-Path $PSScriptRoot 'launcher.mjs'
    $launcherArgs = @($launcher, $Action)
    if ($CodexHome) { $launcherArgs += @('--codex-home', $CodexHome) }
    if ($DataRoot) { $launcherArgs += @('--data-root', $DataRoot) }
    if ($AllowedRoot) { $launcherArgs += @('--allowed-root', $AllowedRoot) }
    if ($ReplaceExisting) { $launcherArgs += '--replace-existing' }
    & $node @launcherArgs
    $resultCode = $LASTEXITCODE
} catch {
    Write-Host ('ERROR: ' + $_.Exception.Message) -ForegroundColor Red
}
if (-not $NoPause) { [void](Read-Host 'Press Enter to close') }
exit $resultCode
