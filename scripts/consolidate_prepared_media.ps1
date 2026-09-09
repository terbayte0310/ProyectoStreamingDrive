[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$PreparedRoot = 'D:\PREPARADOS_MEDIA',
    [string]$SourceRoot = 'D:\NO_SUBIR',
    [string]$BackupRoot = 'D:\RESPALDOS_MEDIA_ORIGINALES',
    [string]$LogDirectory = 'C:\Users\josep\Documents\ChatGPT\ProyectoStreamingDrive\outputs\media_inventory\conversion_logs'
)

$ErrorActionPreference = 'Stop'

function Get-SourceMatch {
    param([string]$RelativePath)
    $withoutExtension = $RelativePath.Substring(0, $RelativePath.Length - [IO.Path]::GetExtension($RelativePath).Length)
    $candidates = @(
        [pscustomobject]@{ Path = (Join-Path $SourceRoot ($withoutExtension + '.ts')); Operation = 'REMUX_TS' },
        [pscustomobject]@{ Path = (Join-Path $SourceRoot ($withoutExtension + '.avi')); Operation = 'TRANSCODE_AVI' },
        [pscustomobject]@{ Path = (Join-Path $SourceRoot $RelativePath); Operation = 'NORMALIZE_MP4' }
    ) | Where-Object { Test-Path -LiteralPath $_.Path -PathType Leaf }
    if (@($candidates).Count -ne 1) { return $null }
    return @($candidates)[0]
}

if (-not (Test-Path -LiteralPath $PreparedRoot -PathType Container)) { throw "No existe: $PreparedRoot" }
if (-not (Test-Path -LiteralPath $SourceRoot -PathType Container)) { throw "No existe: $SourceRoot" }

$preparedFiles = @(Get-ChildItem -LiteralPath $PreparedRoot -Recurse -File -Filter '*.mp4' | Where-Object { $_.FullName -notmatch '\\_control\\' })
$plan = foreach ($prepared in $preparedFiles) {
    $relative = $prepared.FullName.Substring($PreparedRoot.Length).TrimStart('\')
    $source = Get-SourceMatch -RelativePath $relative
    $destination = Join-Path $SourceRoot $relative
    if ($null -eq $source) { throw "Origen ambiguo o faltante: $relative" }
    $backup = Join-Path $BackupRoot ($source.Path.Substring($SourceRoot.Length).TrimStart('\'))
    if (Test-Path -LiteralPath $backup) { throw "Ya existe un respaldo, no se sobrescribe: $backup" }
    if ($source.Path -ne $destination -and (Test-Path -LiteralPath $destination)) { throw "El destino ya existe: $destination" }
    [pscustomobject]@{ RelativePath=$relative; Operation=$source.Operation; SourcePath=$source.Path; PreparedPath=$prepared.FullName; DestinationPath=$destination; BackupPath=$backup; Bytes=$prepared.Length }
}

if ($plan.Count -eq 0) { throw 'No hay MP4 preparados para consolidar.' }
$drive = Get-PSDrive -Name D
$requiredFreeBytes = 2GB
if ($drive.Free -lt $requiredFreeBytes) { throw "Espacio libre insuficiente: $([math]::Round($drive.Free / 1GB,2)) GiB." }

$results = foreach ($item in $plan) {
    $started = Get-Date
    try {
        if ($PSCmdlet.ShouldProcess($item.RelativePath, 'mover original a respaldo y MP4 preparado a su destino final')) {
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $item.BackupPath), (Split-Path -Parent $item.DestinationPath) | Out-Null
            Move-Item -LiteralPath $item.SourcePath -Destination $item.BackupPath -ErrorAction Stop
            try {
                Move-Item -LiteralPath $item.PreparedPath -Destination $item.DestinationPath -ErrorAction Stop
            }
            catch {
                Move-Item -LiteralPath $item.BackupPath -Destination $item.SourcePath -ErrorAction SilentlyContinue
                throw
            }
        }
        [pscustomobject]@{ RelativePath=$item.RelativePath; Operation=$item.Operation; SourcePath=$item.SourcePath; DestinationPath=$item.DestinationPath; BackupPath=$item.BackupPath; Status='OK'; Seconds=[math]::Round(((Get-Date)-$started).TotalSeconds,2); Error='' }
    }
    catch {
        [pscustomobject]@{ RelativePath=$item.RelativePath; Operation=$item.Operation; SourcePath=$item.SourcePath; DestinationPath=$item.DestinationPath; BackupPath=$item.BackupPath; Status='ERROR'; Seconds=[math]::Round(((Get-Date)-$started).TotalSeconds,2); Error=$_.Exception.Message }
    }
}

New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$resultPath = Join-Path $LogDirectory "consolidation_results-$stamp.csv"
$results | Export-Csv -LiteralPath $resultPath -NoTypeInformation -Encoding UTF8
$ok = @($results | Where-Object Status -eq 'OK').Count
$errors = @($results | Where-Object Status -eq 'ERROR').Count
Write-Host "Consolidados: $ok. Errores: $errors. Resultado: $resultPath"
if ($errors -gt 0) { exit 2 }
