[CmdletBinding()]
param(
    [string]$SourceDirectory = 'D:\NO_SUBIR\Idiomas\Inglés\Ingles sin Barreras',
    [string]$OutputDirectory = 'D:\PREPARADOS_MEDIA\Idiomas\Inglés\Ingles sin Barreras',
    [string]$LogDirectory = 'C:\Users\josep\Documents\ChatGPT\ProyectoStreamingDrive\outputs\media_inventory\conversion_logs\avi'
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
if (-not (Test-Path -LiteralPath $SourceDirectory -PathType Container)) { throw "No existe: $SourceDirectory" }
New-Item -ItemType Directory -Force -Path $OutputDirectory, $LogDirectory | Out-Null

$files = @(Get-ChildItem -LiteralPath $SourceDirectory -File -Filter '*.avi' | Where-Object { -not $_.Name.StartsWith('._') } | Sort-Object Name)
if ($files.Count -ne 13) { throw "Se esperaban 13 AVI reales y se encontraron $($files.Count)." }

$index = 0
$results = foreach ($file in $files) {
    $index += 1
    $output = Join-Path $OutputDirectory ($file.BaseName + '.mp4')
    $log = Join-Path $LogDirectory ('avi-{0:D2}.log' -f $index)
    $startedAt = Get-Date
    try {
        if (Test-Path -LiteralPath $output -PathType Leaf) {
            $existingProbe = & ffprobe -v error -show_entries stream=codec_type,codec_name -of json -- $output | ConvertFrom-Json
            $existingVideo = @($existingProbe.streams | Where-Object { $_.codec_type -eq 'video' } | Select-Object -First 1)
            $existingAudio = @($existingProbe.streams | Where-Object { $_.codec_type -eq 'audio' } | Select-Object -First 1)
            if ($existingVideo.Count -eq 1 -and $existingVideo[0].codec_name -eq 'h264' -and $existingAudio.Count -eq 1 -and $existingAudio[0].codec_name -eq 'aac') {
                [pscustomobject]@{ File=$file.Name; Output=$output; Status='SKIPPED_VALID'; Seconds=0; Error='' }
                continue
            }
        }
        & ffmpeg -hide_banner -y -i $file.FullName -map 0:v:0 -map 0:a:0? -c:v libx264 -preset medium -crf 20 -c:a aac -b:a 192k -movflags +faststart $output 2> $log
        if ($LASTEXITCODE -ne 0) { throw "ffmpeg terminó con código $LASTEXITCODE" }
        $probe = & ffprobe -v error -show_entries stream=codec_type,codec_name -of json -- $output | ConvertFrom-Json
        $video = @($probe.streams | Where-Object { $_.codec_type -eq 'video' } | Select-Object -First 1)
        $audio = @($probe.streams | Where-Object { $_.codec_type -eq 'audio' } | Select-Object -First 1)
        if ($video.Count -ne 1 -or $video[0].codec_name -ne 'h264' -or $audio.Count -ne 1 -or $audio[0].codec_name -ne 'aac') { throw 'El resultado no es H.264/AAC.' }
        [pscustomobject]@{ File=$file.Name; Output=$output; Status='OK'; Seconds=[math]::Round(((Get-Date)-$startedAt).TotalSeconds,1); Error='' }
    }
    catch {
        [pscustomobject]@{ File=$file.Name; Output=$output; Status='ERROR'; Seconds=[math]::Round(((Get-Date)-$startedAt).TotalSeconds,1); Error=$_.Exception.Message }
    }
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$resultPath = Join-Path (Split-Path -Parent $LogDirectory) "avi_direct_results-$stamp.csv"
$results | Export-Csv -LiteralPath $resultPath -NoTypeInformation -Encoding UTF8
Write-Host "AVI correctos: $(@($results | Where-Object Status -eq 'OK').Count). Errores: $(@($results | Where-Object Status -eq 'ERROR').Count). Resultado: $resultPath"
if (@($results | Where-Object Status -eq 'ERROR').Count -gt 0) { exit 2 }
