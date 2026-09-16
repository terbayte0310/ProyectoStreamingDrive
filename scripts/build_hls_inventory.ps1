[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$SourceRoot,

    [Parameter(Mandatory)]
    [string]$OutputDirectory
)

# Crea un inventario privado de solo lectura. Nunca modifica los medios fuente.
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $SourceRoot -PathType Container)) {
    throw "No existe la raíz de medios: $SourceRoot"
}

$ffprobe = Get-Command ffprobe -ErrorAction Stop
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

$files = Get-ChildItem -LiteralPath $SourceRoot -Recurse -File -Filter '*.mkv' |
    Where-Object { $_.FullName -notlike "$OutputDirectory\\*" } |
    Sort-Object FullName

$rows = foreach ($file in $files) {
    $relativePath = $file.FullName.Substring($SourceRoot.TrimEnd('\\').Length).TrimStart('\\')
    $probeText = & $ffprobe.Source -v error -show_entries `
        stream=index,codec_type,codec_name,profile,level:stream_tags=language,title `
        -of json -- $file.FullName

    $probe = $null
    $probeError = ''
    try {
        if ($LASTEXITCODE -eq 0 -and $probeText) { $probe = $probeText | ConvertFrom-Json }
        else { $probeError = "ffprobe terminó con código $LASTEXITCODE" }
    } catch {
        $probeError = $_.Exception.Message
    }

    $streams = @($probe.streams)
    $video = @($streams | Where-Object codec_type -eq 'video' | Select-Object -First 1)
    $audio = @($streams | Where-Object codec_type -eq 'audio')
    $subtitles = @($streams | Where-Object codec_type -eq 'subtitle')
    $audioSummary = ($audio | ForEach-Object {
        $language = if ($_.tags.language) { $_.tags.language } else { 'und' }
        $title = if ($_.tags.title) { " ($($_.tags.title))" } else { '' }
        "$($_.index):$($_.codec_name):$language$title"
    }) -join ' | '
    $subtitleSummary = ($subtitles | ForEach-Object {
        $language = if ($_.tags.language) { $_.tags.language } else { 'und' }
        "$($_.index):$($_.codec_name):$language"
    }) -join ' | '
    $languages = @($audio | ForEach-Object {
        if ($_.tags -and $_.tags.language) { $_.tags.language.ToLowerInvariant() }
        else { 'und' }
    })
    # `lat` no es una confirmación de español: requiere revisión humana.
    $hasSpanish = $languages | Where-Object { $_ -in @('es', 'spa') }
    $hasEnglish = $languages | Where-Object { $_ -in @('en', 'eng') }
    $requiresLanguageReview = $languages -contains 'lat'
    $videoCodec = if ($video) { $video[0].codec_name } else { '' }
    $subtitleCodecs = @($subtitles | ForEach-Object codec_name)
    $isSeries = $relativePath -match '^(?i:SERIES)\\'

    [pscustomobject]@{
        ArchivoOrigen = $file.FullName
        RutaRelativa = $relativePath
        CodigoInterno = ''
        CodigoAdministrativo = ''
        Tipo = if ($isSeries) { 'SERIE' } else { 'PELICULA' }
        Video = $videoCodec
        PerfilVideo = if ($video) { $video[0].profile } else { '' }
        NivelVideo = if ($video) { $video[0].level } else { '' }
        Audios = $audioSummary
        Subtitulos = $subtitleSummary
        CandidatoESEN = [bool]($hasSpanish -and $hasEnglish)
        CandidatoASS = [bool]($subtitleCodecs -contains 'ass')
        CandidatoPGS = [bool]($subtitleCodecs -contains 'hdmv_pgs_subtitle')
        CandidatoHEVC = $videoCodec -in @('hevc', 'h265')
        CandidatoSerie = $isSeries
        RequiereRevisionIdioma = $requiresLanguageReview
        Estado = if ($probeError) { 'REVISAR_CABECERA' } else { 'PENDIENTE_CODIGO' }
        ErrorProbe = $probeError
    }
}

$inventoryPath = Join-Path $OutputDirectory 'inventario-hls.csv'
$pilotPath = Join-Path $OutputDirectory 'piloto-hls-sugerido.csv'
$rows | Export-Csv -LiteralPath $inventoryPath -NoTypeInformation -Encoding utf8BOM

$pilot = @()
foreach ($property in 'CandidatoESEN', 'CandidatoASS', 'CandidatoPGS', 'CandidatoSerie', 'CandidatoHEVC') {
    $candidate = $rows | Where-Object { $_.$property -and $_.Estado -eq 'PENDIENTE_CODIGO' } | Select-Object -First 1
    if ($candidate -and $candidate.ArchivoOrigen -notin $pilot.ArchivoOrigen) { $pilot += $candidate }
}

# Completa el piloto con casos H.264 para disponer de una línea base de 5
# paquetes aunque un mismo archivo cubra varias características.
foreach ($candidate in $rows | Where-Object {
    $_.Estado -eq 'PENDIENTE_CODIGO' -and $_.Video -eq 'h264'
}) {
    if ($pilot.Count -ge 5) { break }
    if ($candidate.ArchivoOrigen -notin $pilot.ArchivoOrigen) { $pilot += $candidate }
}

$pilot | Select-Object ArchivoOrigen, RutaRelativa, CodigoInterno, Tipo, Video, Audios, Subtitulos, `
    CandidatoESEN, CandidatoASS, CandidatoPGS, CandidatoSerie, CandidatoHEVC, RequiereRevisionIdioma, Estado |
    Export-Csv -LiteralPath $pilotPath -NoTypeInformation -Encoding utf8BOM

Write-Host "Inventario: $inventoryPath"
Write-Host "Piloto sugerido: $pilotPath"
Write-Host "Archivos auditados: $($rows.Count); candidatos de piloto: $($pilot.Count)."
