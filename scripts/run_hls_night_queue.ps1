[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$QueuePath,

    [Parameter(Mandatory)]
    [string]$ConverterPath,

    [Parameter(Mandatory)]
    [string]$LogDirectory
)

$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null
$summaryLog = Join-Path $LogDirectory 'conversion-night.log'
$queue = @(Import-Csv -LiteralPath $QueuePath)
$pending = @($queue | Where-Object Estado -eq 'EN_COLA')
$total = $pending.Count

Add-Type -AssemblyName System.Windows.Forms
$notification = [System.Windows.Forms.NotifyIcon]::new()
$notification.Icon = [System.Drawing.SystemIcons]::Information
$notification.Visible = $true

function Write-QueueLog {
    param([string]$Message)
    $line = "$(Get-Date -Format s)  $Message"
    $line | Tee-Object -FilePath $summaryLog -Append
}

function Save-Queue {
    $queue | Export-Csv -LiteralPath $QueuePath -NoTypeInformation -Encoding utf8
}

function Get-PackageDirectory {
    param($Item)
    if ($Item.CodigoInterno -match '^(SER-[0-9]{5,})-S[0-9]{2}-E[0-9]{2,3}$') {
        return Join-Path (Join-Path $Item.DirectorioSalida $Matches[1]) $Item.CodigoInterno
    }
    return Join-Path $Item.DirectorioSalida $Item.CodigoInterno
}

try {
    Write-QueueLog "Inicio: $total paquetes pendientes. GPU NVENC se usará solo si el vídeo requiere H.264 compatible."
    $completed = 0
    $failed = 0
    $index = 0

    foreach ($item in $pending) {
        $index++
        $packageDirectory = Get-PackageDirectory $item
        $masterPlaylist = Join-Path $packageDirectory 'master.m3u8'
        $packageLog = Join-Path $LogDirectory "$($item.CodigoInterno).log"

        if (Test-Path -LiteralPath $masterPlaylist -PathType Leaf) {
            $item.Estado = 'LISTO_EXISTENTE'
            Save-Queue
            $completed++
            Write-QueueLog "[$index/$total] $($item.CodigoInterno) ya estaba listo; se conserva."
            continue
        }
        if (Test-Path -LiteralPath $packageDirectory) {
            $item.Estado = 'SALIDA_INCOMPLETA'
            $item.Notas = 'Existe una carpeta sin master.m3u8. Se conserva para revisión; la cola no sobrescribe paquetes parciales.'
            Save-Queue
            $failed++
            Write-QueueLog "[$index/$total] $($item.CodigoInterno) omitido: salida incompleta existente."
            continue
        }
        if (-not (Test-Path -LiteralPath $item.ArchivoOrigen -PathType Leaf)) {
            $item.Estado = 'FUENTE_NO_ENCONTRADA'
            $item.Notas = 'No se encontró el MKV de origen al iniciar la cola.'
            Save-Queue
            $failed++
            Write-QueueLog "[$index/$total] $($item.CodigoInterno) omitido: no se encontró el origen."
            continue
        }

        $item.Estado = 'CONVIRTIENDO'
        Save-Queue
        Write-QueueLog "[$index/$total] Inicia $($item.CodigoInterno): $($item.TituloProvisional)"
        try {
            $convertArgs = @{
                SourceFile = $item.ArchivoOrigen
                InternalCode = $item.CodigoInterno
                OutputRoot = $item.DirectorioSalida
                VideoEncoder = 'nvenc'
            }
            if ($item.AudioStreamIndex) {
                $convertArgs.AudioStreamIndex = [int]$item.AudioStreamIndex
                $convertArgs.AudioLanguage = $item.AudioLanguage
            }
            & $ConverterPath @convertArgs *> $packageLog
            if ($LASTEXITCODE -ne 0) { throw "El conversor terminó con código $LASTEXITCODE." }
            if (-not (Test-Path -LiteralPath $masterPlaylist -PathType Leaf)) { throw 'No se creó master.m3u8.' }

            $item.Estado = 'LISTO'
            $completed++
            Save-Queue
            Write-QueueLog "[$index/$total] Listo $($item.CodigoInterno). Completados: $completed; incidencias: $failed."
        } catch {
            $item.Estado = 'ERROR_CONVERSION'
            $item.Notas = $_.Exception.Message
            $failed++
            Save-Queue
            Write-QueueLog "[$index/$total] Error $($item.CodigoInterno): $($_.Exception.Message)"
        }

        if ($index -eq 1 -or $index % 5 -eq 0) {
            $notification.ShowBalloonTip(10000, 'Nébula · conversión HLS', "$index de $total revisados. Listos: $completed; incidencias: $failed.", [System.Windows.Forms.ToolTipIcon]::Info)
        }
    }

    Write-QueueLog "Fin: listos $completed; incidencias $failed; excluidos previamente $(@($queue | Where-Object { $_.Estado -in @('FUENTE_ILEGIBLE', 'REVISAR_AUDIO') }).Count)."
    $notification.ShowBalloonTip(15000, 'Nébula · conversión HLS', "Cola terminada. Listos: $completed; incidencias: $failed.", [System.Windows.Forms.ToolTipIcon]::Info)
} finally {
    $notification.Dispose()
}
