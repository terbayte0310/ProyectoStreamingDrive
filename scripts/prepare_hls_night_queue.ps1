[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$QueuePath,

    [Parameter(Mandatory)]
    [string]$CopyPath
)

$ErrorActionPreference = 'Stop'
$rows = Import-Csv -LiteralPath $QueuePath
$officialAudioIndexes = @{
    'SER-00003-S01-E68' = 2; 'SER-00003-S01-E69' = 2; 'SER-00003-S01-E70' = 2; 'SER-00003-S01-E71' = 1
    'SER-00003-S01-E72' = 2; 'SER-00003-S01-E73' = 1; 'SER-00003-S01-E74' = 1; 'SER-00003-S01-E75' = 2
    'SER-00003-S01-E77' = 2; 'SER-00003-S01-E78' = 2; 'SER-00003-S01-E79' = 1; 'SER-00003-S01-E81' = 1
    'SER-00003-S01-E82' = 2; 'SER-00003-S01-E83' = 2; 'SER-00003-S01-E84' = 1; 'SER-00003-S01-E85' = 2
    'SER-00003-S01-E86' = 2; 'SER-00003-S01-E87' = 2; 'SER-00003-S01-E89' = 1; 'SER-00003-S01-E90' = 1
    'SER-00003-S01-E91' = 2; 'SER-00003-S01-E92' = 2; 'SER-00003-S01-E93' = 2
}
$unreadableCodes = @('SER-00003-S01-E49', 'SER-00003-S01-E50', 'SER-00003-S01-E51', 'SER-00003-S01-E52')

$updated = foreach ($row in $rows) {
    $status = $row.Estado
    $notes = $row.Notas
    $audioStreamIndex = ''
    $audioLanguage = ''
    $audioSelection = 'AUTOMATICA'

    if ($unreadableCodes -contains $row.CodigoInterno) {
        $status = 'FUENTE_ILEGIBLE'
        $notes = 'ffprobe no pudo leer la cabecera. No se convierte hasta reparar o reemplazar el MKV.'
    } elseif ($row.CodigoInterno -eq 'SER-00003-S01-E88') {
        $status = 'REVISAR_AUDIO'
        $notes = 'Dos pistas latino sin una etiqueta Oficial. Se excluye para no elegir un doblaje al azar.'
        $audioSelection = 'PENDIENTE: dos pistas latino sin título diferenciador'
    } elseif ($officialAudioIndexes.ContainsKey($row.CodigoInterno)) {
        $audioStreamIndex = [string]$officialAudioIndexes[$row.CodigoInterno]
        $audioLanguage = 'es'
        $audioSelection = 'EXPLICITA: pista Latino Oficial'
        $notes = 'Dos doblajes latino detectados. Se eligió explícitamente la pista titulada Oficial; audio AAC-LC se copia sin pérdida.'
    }

    [pscustomobject]@{
        Orden = $row.Orden
        CodigoInterno = $row.CodigoInterno
        Tipo = $row.Tipo
        Serie = $row.Serie
        Temporada = $row.Temporada
        Episodio = $row.Episodio
        TituloProvisional = $row.TituloProvisional
        ArchivoOrigen = $row.ArchivoOrigen
        DiscoOrigen = $row.DiscoOrigen
        DirectorioSalida = $row.DirectorioSalida
        Estado = $status
        Notas = $notes
        AudioStreamIndex = $audioStreamIndex
        AudioLanguage = $audioLanguage
        SeleccionAudio = $audioSelection
    }
}

$updated | Export-Csv -LiteralPath $QueuePath -NoTypeInformation -Encoding utf8
$updated | Export-Csv -LiteralPath $CopyPath -NoTypeInformation -Encoding utf8
$updated
