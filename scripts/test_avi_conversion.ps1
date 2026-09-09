$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$source = 'D:\NO_SUBIR\Idiomas\Inglés\Ingles sin Barreras\ISB_D01_[MP3RLZ].avi'
$output = 'D:\PREPARADOS_MEDIA\_control\avi-route-control.mp4'
$log = 'C:\Users\josep\Documents\ChatGPT\ProyectoStreamingDrive\outputs\media_inventory\conversion_logs\avi-route-control.log'
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $output) | Out-Null
& ffmpeg -hide_banner -y -t 5 -i $source -map 0:v:0 -map 0:a:0? -c:v libx264 -preset medium -crf 20 -c:a aac -b:a 192k -movflags +faststart $output 2> $log
if ($LASTEXITCODE -ne 0) { throw "ffmpeg terminó con código $LASTEXITCODE" }
$probe = & ffprobe -v error -show_entries stream=codec_type,codec_name -of json -- $output | ConvertFrom-Json
($probe.streams | ForEach-Object { "$($_.codec_type):$($_.codec_name)" }) -join ', '
