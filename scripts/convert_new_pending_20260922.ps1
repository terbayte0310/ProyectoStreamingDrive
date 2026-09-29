[CmdletBinding()]
param([switch]$PilotOnly)

$ErrorActionPreference = 'Stop'
$sourceRoot = 'I:\Entretenimiento\Peliculas\Pendientes'
$outputRoot = 'I:\_HLS_VALIDATED\Pendientes_20260922'
$inventoryRoot = Join-Path (Split-Path $PSScriptRoot -Parent) 'outputs\media_inventory\pendientes_20260922'
$converter = Join-Path $PSScriptRoot 'convert_hls_package.ps1'

$items = @(
    [pscustomobject]@{ Code='MOV-00032'; Title='Animales fantásticos: Los crímenes de Grindelwald'; Folder='Animales.Fantásticos.2.Los.Crímenes.de.Grindelwald.2018.WEB-DL.1080p-Dual-Lat'; Episode=0 },
    [pscustomobject]@{ Code='MOV-00033'; Title='Batman: El caballero de la noche'; Folder='Batman.El.caballero.de.la.noche.2008.1080p-dual-lat'; Episode=0 },
    [pscustomobject]@{ Code='MOV-00034'; Title='Batman inicia'; Folder='Batman.inicia.2005.1080p-dual-lat'; Episode=0 },
    [pscustomobject]@{ Code='MOV-00035'; Title='Dos tipos peligrosos'; Folder='Dos.tipos.peligrosos.2016.1080p-dual-lat'; Episode=0 },
    [pscustomobject]@{ Code='MOV-00036'; Title='El aprendiz de brujo'; Folder='El.Aprendiz.de.Brujo.2010.WEB-DL.1080p-Dual-Lat'; Episode=0 },
    [pscustomobject]@{ Code='MOV-00037'; Title='Gigantes de acero'; Folder='Gigantes.de.acero.2011.1080p-dual-lat'; Episode=0 },
    [pscustomobject]@{ Code='MOV-00038'; Title='Loco y estúpido amor'; Folder='Loco.y.Estupido.Amor.2011.WEB-DL.1080p-Dual-Lat'; Episode=0 },
    [pscustomobject]@{ Code='MOV-00039'; Title='Piratas del Caribe: El cofre de la muerte'; Folder='Piratas.del.Caribe.El.cofre.de.la.Muerte.2006.1080p-dual-lat'; Episode=0 },
    [pscustomobject]@{ Code='MOV-00040'; Title='Piratas del Caribe: La maldición del Perla Negra'; Folder='Piratas.del.Caribe.La.Maldición.del.Perla.Negra.2003.1080p-dual-lat'; Episode=0 },
    [pscustomobject]@{ Code='MOV-00041'; Title='Son como niños 2'; Folder='Son.como.niños.2.2013.1080p-dual-lat'; Episode=0 },
    [pscustomobject]@{ Code='MOV-00042'; Title='Son como niños'; Folder='Son.Como.Niños.2010.1080p-dual-lat'; Episode=0 },
    [pscustomobject]@{ Code='SER-00005-S01-E01'; Title='El caballero de los siete reinos'; Folder='El.Caballero.de.los.Siete.Reinos.S01E01.2026.WEB-DL.1080p-Dual-Lat'; Episode=1 },
    [pscustomobject]@{ Code='SER-00005-S01-E02'; Title='El caballero de los siete reinos'; Folder='El.caballero.de.los.Siete.Reinos.S01E02.2026.WEB-DL.1080p-Dual-Lat'; Episode=2 },
    [pscustomobject]@{ Code='SER-00005-S01-E03'; Title='El caballero de los siete reinos'; Folder='El.caballero.de.los.Siete.Reinos.S01E03.2026.WEB-DL.1080p-Dual-Lat'; Episode=3 },
    [pscustomobject]@{ Code='SER-00005-S01-E04'; Title='El caballero de los siete reinos'; Folder='El.caballero.de.los.Siete.Reinos.S01E04.2026.WEB-DL.1080p-Dual-Lat'; Episode=4 },
    [pscustomobject]@{ Code='SER-00005-S01-E05'; Title='El caballero de los siete reinos'; Folder='El.caballero.de.los.Siete.Reinos.S01E05.2026.WEB-DL.1080p-Dual-Lat'; Episode=5 },
    [pscustomobject]@{ Code='SER-00005-S01-E06'; Title='El caballero de los siete reinos'; Folder='El.Caballero.de.los.Siete.Reinos.S01E06.2026.WEB-DL.1080p-Dual-Lat'; Episode=6 }
)

New-Item -ItemType Directory -Force -Path $outputRoot, $inventoryRoot | Out-Null
$inventory = foreach ($item in $items) {
    $parent = if ($item.Episode) { Join-Path (Join-Path $sourceRoot 'SERIES\El CAballero de los 7 reinos') $item.Folder } else { Join-Path $sourceRoot $item.Folder }
    $sources = @(Get-ChildItem -LiteralPath $parent -File -Filter '*.mkv')
    if ($sources.Count -ne 1) { throw "Se esperaba exactamente un MKV en $parent; encontrados: $($sources.Count)" }
    [pscustomobject]@{ CodigoInterno=$item.Code; Tipo=if($item.Episode){'SERIE'}else{'PELICULA'}; Titulo=$item.Title; Temporada=if($item.Episode){1}else{''}; Episodio=if($item.Episode){$item.Episode}else{''}; ArchivoOrigen=$sources[0].FullName; BytesOrigen=$sources[0].Length; Salida=if($item.Episode){Join-Path (Join-Path $outputRoot 'SER-00005') $item.Code}else{Join-Path $outputRoot $item.Code} }
}
$inventory | Export-Csv -LiteralPath (Join-Path $inventoryRoot 'inventario_privado.csv') -NoTypeInformation -Encoding UTF8
$publicInventory = $inventory | Select-Object CodigoInterno,Tipo,Titulo,Temporada,Episodio
$publicInventory | Export-Csv -LiteralPath (Join-Path $inventoryRoot 'catalogo_subida.csv') -NoTypeInformation -Encoding UTF8

function Test-Package([string]$packagePath) {
    $master = Join-Path $packagePath 'master.m3u8'
    if (-not (Test-Path -LiteralPath $master -PathType Leaf)) { throw "Falta master.m3u8: $packagePath" }
    $masterText = Get-Content -LiteralPath $master -Raw
    foreach ($path in @('video/index.m3u8','audio/es/index.m3u8','audio/en/index.m3u8')) {
        if ($masterText -notmatch [regex]::Escape($path)) { throw "Master no declara $path" }
        $playlist = Join-Path $packagePath $path
        if (-not (Test-Path -LiteralPath $playlist -PathType Leaf)) { throw "Falta $path" }
        $lines = @(Get-Content -LiteralPath $playlist)
        if ($lines[-1] -ne '#EXT-X-ENDLIST') { throw "Playlist sin cierre: $path" }
        $segmentNames = @($lines | Where-Object { $_ -and -not $_.StartsWith('#') })
        if (-not $segmentNames.Count) { throw "Playlist sin segmentos: $path" }
        foreach ($name in $segmentNames) {
            if (-not (Test-Path -LiteralPath (Join-Path (Split-Path $playlist -Parent) $name) -PathType Leaf)) { throw "Falta segmento $path/$name" }
        }
    }
    foreach ($match in [regex]::Matches($masterText, 'subtitles/[^"\r\n]+/index\.m3u8')) {
        $playlist = Join-Path $packagePath $match.Value
        if (-not (Test-Path -LiteralPath $playlist)) { throw "Falta subtítulo $($match.Value)" }
    }
}

$queue = if ($PilotOnly) { @($inventory | Select-Object -First 1) } else { @($inventory) }
$log = Join-Path $inventoryRoot 'conversion-log.jsonl'
foreach ($item in $queue) {
    $start = Get-Date
    try {
        if (Test-Path -LiteralPath $item.Salida) {
            Test-Package $item.Salida
            $status = 'ya_validado'
        } else {
            & $converter -SourceFile $item.ArchivoOrigen -InternalCode $item.CodigoInterno -OutputRoot $outputRoot -VideoEncoder nvenc -SubtitleDelaySeconds 1.5 *> (Join-Path $inventoryRoot "$($item.CodigoInterno).ffmpeg.log")
            if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw "Conversor salió con código $LASTEXITCODE" }
            Test-Package $item.Salida
            $status = 'convertido'
        }
        $record = [pscustomobject]@{ time=(Get-Date).ToString('o'); code=$item.CodigoInterno; status=$status; seconds=[math]::Round(((Get-Date)-$start).TotalSeconds,1) }
    } catch {
        $record = [pscustomobject]@{ time=(Get-Date).ToString('o'); code=$item.CodigoInterno; status='error'; error=$_.Exception.Message }
    }
    [System.IO.File]::AppendAllText($log, (($record | ConvertTo-Json -Compress) + "`n"), [System.Text.UTF8Encoding]::new($false))
    Write-Output ($record | ConvertTo-Json -Compress)
    if ($record.status -eq 'error') { break }
}
