[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SourceDirectory,

    [Parameter(Mandatory = $true)]
    [string]$OutputRoot,

    [ValidateSet('nvenc', 'cpu')]
    [string]$VideoEncoder = 'nvenc'
)

$ErrorActionPreference = 'Stop'

$converter = Join-Path $PSScriptRoot 'convert_hls_package.ps1'
$ffmpeg = 'C:\Users\josep\scoop\shims\ffmpeg.exe'

if (-not (Test-Path -LiteralPath $converter)) { throw "No se encontró el conversor: $converter" }
if (-not (Test-Path -LiteralPath $ffmpeg)) { throw "No se encontró FFmpeg: $ffmpeg" }

function Add-SpainAudioTrack {
    param(
        [Parameter(Mandatory = $true)] [string]$SourceFile,
        [Parameter(Mandatory = $true)] [string]$PackageDirectory
    )

    $audioRoot = Join-Path $PackageDirectory 'audio'
    $legacyLatin = Join-Path $audioRoot 'es'
    $latin = Join-Path $audioRoot 'es-419'
    $spain = Join-Path $audioRoot 'es-ES'

    if (-not (Test-Path -LiteralPath $legacyLatin)) { throw "No se encontró el audio latino generado: $legacyLatin" }
    if (Test-Path -LiteralPath $latin) { throw "La carpeta latino ya existe: $latin" }
    if (Test-Path -LiteralPath $spain) { throw "La carpeta España ya existe: $spain" }

    Move-Item -LiteralPath $legacyLatin -Destination $latin
    New-Item -ItemType Directory -Path $spain -ErrorAction Stop | Out-Null

    & $ffmpeg -hide_banner -y -i $SourceFile -map '0:2' -vn -sn -c:a copy -f hls -hls_playlist_type vod -hls_time 6 -hls_flags independent_segments+temp_file -hls_segment_filename (Join-Path $spain 'segment_%05d.ts') (Join-Path $spain 'index.m3u8')
    if ($LASTEXITCODE -ne 0) { throw "FFmpeg no pudo crear el audio de España (código $LASTEXITCODE)." }

    $master = Join-Path $PackageDirectory 'master.m3u8'
    $oldAudio = '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Español",DEFAULT=YES,AUTOSELECT=YES,LANGUAGE="es",URI="audio/es/index.m3u8"'
    $newAudio = @(
        '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Español Latino",DEFAULT=YES,AUTOSELECT=YES,LANGUAGE="es-419",URI="audio/es-419/index.m3u8"',
        '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Español España",DEFAULT=NO,AUTOSELECT=YES,LANGUAGE="es-ES",URI="audio/es-ES/index.m3u8"'
    ) -join [Environment]::NewLine
    $masterText = [System.IO.File]::ReadAllText($master)
    if (-not $masterText.Contains($oldAudio)) { throw "El manifest no tiene la declaración de audio esperada: $master" }
    [System.IO.File]::WriteAllText($master, $masterText.Replace($oldAudio, $newAudio), [System.Text.UTF8Encoding]::new($false))

    foreach ($playlist in @((Join-Path $latin 'index.m3u8'), (Join-Path $spain 'index.m3u8'))) {
        if (-not (Test-Path -LiteralPath $playlist)) { throw "Falta una lista de audio: $playlist" }
        if (-not ([System.IO.File]::ReadAllText($playlist).Contains('#EXT-X-ENDLIST'))) { throw "La lista de audio no quedó finalizada: $playlist" }
    }
}

$episodes = 2..4
foreach ($episode in $episodes) {
    $episodeNumber = '{0:D2}' -f $episode
    $internalCode = "SER-00002-S01-E$episodeNumber"
    $source = Join-Path $SourceDirectory "[Daemon Anime] Pokémon Origins - $episodeNumber [Akira].mkv"
    $package = Join-Path $OutputRoot (Join-Path 'SER-00002' $internalCode)

    if (-not (Test-Path -LiteralPath $source)) { throw "No se encontró el original: $source" }
    if (Test-Path -LiteralPath $package) { throw "Ya existe una salida parcial o final para $($internalCode): $package" }

    Write-Host "[$(Get-Date -Format s)] Iniciando $internalCode"
    & $converter -SourceFile $source -InternalCode $internalCode -OutputRoot $OutputRoot -VideoEncoder $VideoEncoder -AudioStreamIndex 1 -AudioLanguage es
    if ($LASTEXITCODE -ne 0) { throw "El conversor principal falló para $internalCode (código $LASTEXITCODE)." }

    Add-SpainAudioTrack -SourceFile $source -PackageDirectory $package
    Write-Host "[$(Get-Date -Format s)] LISTO $internalCode — Latino + España"
}
