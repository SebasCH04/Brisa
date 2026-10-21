param(
    [Parameter(Mandatory = $true)]
    [string]$Folder
)

$ErrorActionPreference = 'Stop'
try {
    $resolvedFolder = Get-Item -LiteralPath $Folder -ErrorAction Stop
    if (-not $resolvedFolder.PSIsContainer) {
        throw 'La ruta solicitada no es una carpeta.'
    }
    $openInfo = New-Object System.Diagnostics.ProcessStartInfo
    $openInfo.FileName = $resolvedFolder.FullName
    $openInfo.UseShellExecute = $true
    $openInfo.Verb = 'open'
    $openInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Normal
    [void][System.Diagnostics.Process]::Start($openInfo)
    exit 0
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
