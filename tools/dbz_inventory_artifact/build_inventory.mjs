import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const seriesCode = "SER-00004";
const outputDir = path.resolve(process.cwd(), "../../outputs/dragon_ball_z");
const workbookPath = path.join(outputDir, "inventario_conversion_dragon_ball_z.xlsx");
const csvPath = path.join(outputDir, "inventario_subida_nebula_dragon_ball_z.csv");

function sagaFor(episode) {
  if (episode <= 35) return ["1 Saga Sayayin", "1 Saga Sayayin"];
  if (episode <= 107) return ["2 Saga Freezer", "2 Saga Freezer"];
  if (episode <= 117) return ["3 Saga Garlick Jr", "3 Saga Garlick Jr"];
  if (episode <= 199) return ["4 Saga Androides", "4 Saga Androides"];
  return ["5 Saga Majin Boo", "5 Saga Majin Boo"];
}

function audioSourceFor(episode) {
  if (episode <= 253) return "AAC · etiqueta spa";
  if (episode <= 263) return "AC3 · etiqueta ausente";
  return "AAC · etiqueta ausente";
}

function videoSourceFor(episode) {
  if (episode === 214 || episode >= 254) return "H.264 1080p · revisar FPS al validar";
  return "H.264 High 1080p";
}

function observationFor(episode) {
  if (episode >= 254 && episode <= 263) return "Audio AC3: convertir a AAC y declararlo Español Latino por decisión aprobada.";
  if (episode >= 264) return "Audio AAC sin etiqueta: declararlo Español Latino por decisión aprobada.";
  if (episode === 92) return "Título de pista con carácter adicional; idioma spa confirmado.";
  return "Copiar vídeo H.264 y audio AAC al paquete HLS.";
}

function csvValue(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const rows = Array.from({ length: 291 }, (_, index) => {
  const episode = index + 1;
  const number = String(episode).padStart(3, "0");
  const [sagaFolder, saga] = sagaFor(episode);
  const internalCode = `${seriesCode}-S01-E${number}`;
  return {
    internalCode,
    tipo: "SERIE",
    serie: "Dragon Ball Z",
    temporada: 1,
    episodio: episode,
    saga,
    titulo: `Dragon Ball Z - Episodio ${number}`,
    idioma: "Español Latino",
    audio: audioSourceFor(episode),
    video: videoSourceFor(episode),
    ruta: `I:\\DragonBallZ\\${sagaFolder}\\${number}.mkv`,
    carpetaHls: `${seriesCode}/${internalCode}`,
    estado: "Pendiente",
    validacion: "Pendiente",
    observaciones: observationFor(episode),
  };
});

await fs.mkdir(outputDir, { recursive: true });

const csvHeaders = ["CodigoInterno", "Tipo", "TituloProvisional", "Serie", "Temporada", "Episodio"];
const csvLines = [csvHeaders.join(","), ...rows.map((row) => [row.internalCode, row.tipo, row.titulo, row.serie, row.temporada, row.episodio].map(csvValue).join(","))];
await fs.writeFile(csvPath, `${csvLines.join("\r\n")}\r\n`, "utf8");

const workbook = Workbook.create();
const summary = workbook.worksheets.add("Resumen");
const inventory = workbook.worksheets.add("Inventario");

for (const sheet of [summary, inventory]) {
  sheet.showGridLines = false;
  sheet.getUsedRange().format.font = { name: "Arial", size: 10, color: "#1F2937" };
}

summary.getRange("A1:F1").merge();
summary.getRange("A1").values = [["Inventario de conversión HLS · Dragon Ball Z"]];
summary.getRange("A1").format = { font: { name: "Arial", size: 16, bold: true, color: "#172554" } };
summary.getRange("A3:B4").values = [
  ["Código de serie", seriesCode],
  ["Audio declarado", "Español Latino"],
];
summary.getRange("A3:A4").format = { font: { name: "Arial", bold: true }, fill: "#E0E7FF" };
summary.getRange("A6:B10").values = [
  ["Indicador", "Valor"],
  ["Episodios inventariados", null],
  ["Convertidos", null],
  ["Pendientes", null],
  ["Con error", null],
];
summary.getRange("B7:B10").formulas = [
  ["=COUNTA(Inventario!A2:A292)"],
  ["=COUNTIF(Inventario!M2:M292,\"Convertido\")"],
  ["=COUNTIF(Inventario!M2:M292,\"Pendiente\")"],
  ["=COUNTIF(Inventario!M2:M292,\"Error\")"],
];
summary.getRange("D6:E10").values = [
  ["Saga", "Episodios"],
  ["Sayayin", "1–35"],
  ["Freezer", "36–107"],
  ["Garlick Jr.", "108–117"],
  ["Androides", "118–199"],
];
summary.getRange("D12:E12").values = [["Majin Boo", "200–291"]];
summary.getRange("A6:B6").format = { fill: "#1E3A8A", font: { name: "Arial", bold: true, color: "#FFFFFF" }, horizontalAlignment: "center" };
summary.getRange("D6:E6").format = { fill: "#1E3A8A", font: { name: "Arial", bold: true, color: "#FFFFFF" }, horizontalAlignment: "center" };
summary.getRange("A6:B10").format.borders = { preset: "all", style: "thin", color: "#CBD5E1" };
summary.getRange("D6:E10").format.borders = { preset: "all", style: "thin", color: "#CBD5E1" };
summary.getRange("D12:E12").format.borders = { preset: "all", style: "thin", color: "#CBD5E1" };
summary.getRange("A14:F14").merge();
summary.getRange("A14").values = [["El CSV de importación contiene los campos requeridos por Nébula. La columna EstadoConversión se actualiza tras cada paquete validado."]];
summary.getRange("A14").format = { font: { name: "Arial", italic: true, color: "#475569" } };
summary.getRange("A1:F14").format.verticalAlignment = "center";
summary.getRange("A:A").format.columnWidth = 25;
summary.getRange("B:B").format.columnWidth = 16;
summary.getRange("D:D").format.columnWidth = 18;
summary.getRange("E:E").format.columnWidth = 14;
summary.getRange("F:F").format.columnWidth = 18;

const headers = ["CódigoInterno", "Tipo", "Serie", "Temporada", "Episodio", "Saga", "TítuloProvisional", "IdiomaAudio", "AudioOrigen", "VideoOrigen", "RutaOrigen", "CarpetaHLS", "EstadoConversión", "ValidaciónHLS", "Observaciones"];
inventory.getRange("A1:O1").values = [headers];
inventory.getRange("A2:O292").values = rows.map((row) => [
  row.internalCode, row.tipo, row.serie, row.temporada, row.episodio, row.saga, row.titulo,
  row.idioma, row.audio, row.video, row.ruta, row.carpetaHls, row.estado, row.validacion, row.observaciones,
]);
inventory.tables.add("A1:O292", true, "InventarioDragonBallZ");
inventory.getRange("A1:O1").format = { fill: "#1E3A8A", font: { name: "Arial", bold: true, color: "#FFFFFF" }, horizontalAlignment: "center", verticalAlignment: "center", wrapText: true };
inventory.getRange("D2:E292").format.numberFormat = "0";
inventory.getRange("A2:O292").format.verticalAlignment = "center";
inventory.getRange("M2:M292").dataValidation = { rule: { type: "list", values: ["Pendiente", "En conversión", "Convertido", "Error"] } };
inventory.getRange("N2:N292").dataValidation = { rule: { type: "list", values: ["Pendiente", "Validado", "Rechazado"] } };
inventory.getRange("M2:M292").conditionalFormats.add("containsText", { text: "Convertido", format: { fill: "#DCFCE7", font: { color: "#166534", bold: true } } });
inventory.getRange("M2:M292").conditionalFormats.add("containsText", { text: "Error", format: { fill: "#FEE2E2", font: { color: "#B91C1C", bold: true } } });
inventory.getRange("M2:M292").conditionalFormats.add("containsText", { text: "En conversión", format: { fill: "#FEF3C7", font: { color: "#92400E", bold: true } } });
inventory.freezePanes.freezeRows(1);
inventory.freezePanes.freezeColumns(2);
const widths = [30, 11, 20, 12, 11, 23, 34, 18, 27, 34, 53, 35, 18, 16, 56];
widths.forEach((width, index) => { inventory.getCell(0, index).format.columnWidth = width; });
inventory.getRange("A1:O292").format.wrapText = false;
inventory.getRange("O2:O292").format.wrapText = true;
inventory.getRange("O2:O292").format.rowHeight = 30;

workbook.recalculate();
const check = await workbook.inspect({ kind: "table", range: "Inventario!A1:O8", include: "values,formulas", tableMaxRows: 8, tableMaxCols: 15 });
console.log(check.ndjson);
const errors = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!", options: { useRegex: true, maxResults: 50 }, summary: "formula error scan" });
console.log(errors.ndjson);
const preview = await workbook.render({ sheetName: "Resumen", range: "A1:F14", scale: 2, format: "png" });
await fs.writeFile(path.join(outputDir, "inventario_preview.png"), new Uint8Array(await preview.arrayBuffer()));
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(workbookPath);
console.log(JSON.stringify({ workbookPath, csvPath, rows: rows.length }));
