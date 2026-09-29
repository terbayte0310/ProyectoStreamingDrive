import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(scriptDir, "..");
const artifacts = path.join(workspace, "outputs", "media_inventory", "naruto_20260924");
const inventoryPath = path.join(artifacts, "inventario_privado.csv");
const eventPath = path.join(artifacts, "conversion-log.jsonl");
const outputPath = path.join(artifacts, "inventario_conversion_naruto.xlsx");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += char;
  }
  if (field.length || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  const headers = rows.shift() ?? [];
  return rows.filter((cells) => cells.some((cell) => cell !== "")).map((cells) =>
    Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])));
}

const inventory = parseCsv(await fs.readFile(inventoryPath, "utf8"));
let events = [];
try {
  const content = await fs.readFile(eventPath, "utf8");
  events = content.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (inventory.length !== 220) throw new Error(`El inventario tiene ${inventory.length} filas, se esperaban 220.`);

const latest = new Map();
for (const event of events) if (event.code) latest.set(event.code, event);
const rows = inventory.map((item) => {
  const event = latest.get(item.CodigoInterno);
  return [
    item.CodigoInterno,
    item.TituloProvisional,
    Number(item.Temporada),
    Number(item.Episodio),
    item.Archivo,
    Number(item.BytesOrigen),
    Number(item.DuracionSegundos),
    `${item.VideoCodec} ${item.VideoProfile}`.trim(),
    `${item.AudioCodec} ${item.AudioProfile}`.trim(),
    event?.status ?? "Pendiente",
    event?.seconds == null ? null : Number(event.seconds),
    event?.error ?? "",
    event?.time ?? "",
  ];
});

const workbook = Workbook.create();
const sheet = workbook.worksheets.add("Naruto");
sheet.showGridLines = false;
sheet.getRange("A1").values = [["Conversión HLS de Naruto"]];
sheet.getRange("A1").format.font = { name: "Arial", size: 14, bold: true, color: "#17365D" };
sheet.getRange("A2").values = [["220 episodios · audio clasificado como español Latino"]];
sheet.getRange("A2").format.font = { name: "Arial", size: 10, italic: true, color: "#666666" };
sheet.getRange("A4:H4").values = [["Fuentes", null, "Completados", null, "Pendientes", null, "Errores", null]];
sheet.getRange("A5").formulas = [["=COUNTA(A8:A227)"]];
sheet.getRange("C5").formulas = [['=COUNTIF(J8:J227,"convertido")+COUNTIF(J8:J227,"ya_validado")']];
sheet.getRange("E5").formulas = [['=COUNTIF(J8:J227,"Pendiente")']];
sheet.getRange("G5").formulas = [['=COUNTIF(J8:J227,"error")']];
sheet.getRange("A4:H4").format = {
  fill: "#E8EEF5",
  font: { name: "Arial", size: 10, bold: true, color: "#17365D" },
};
sheet.getRange("A5:H5").format.font = { name: "Arial", size: 12, bold: true, color: "#17365D" };
sheet.getRange("A7:M7").values = [[
  "CodigoInterno", "TituloProvisional", "Temporada", "Episodio", "Archivo fuente",
  "Bytes origen", "Duración (s)", "Vídeo origen", "Audio origen", "Estado",
  "Segundos conversión", "Error", "Actualizado",
]];
sheet.getRange(`A8:M${7 + rows.length}`).values = rows;
sheet.getRange(`A7:M${7 + rows.length}`).format.font = { name: "Arial", size: 10, color: "#222222" };
sheet.getRange("A7:M7").format = {
  fill: "#17365D",
  font: { name: "Arial", size: 10, bold: true, color: "#FFFFFF" },
  horizontalAlignment: "center",
  verticalAlignment: "center",
  wrapText: true,
};
sheet.getRange(`F8:G${7 + rows.length}`).format.numberFormat = "#,##0.0";
sheet.getRange(`K8:K${7 + rows.length}`).format.numberFormat = "#,##0.0";
sheet.getRange("A:A").format.columnWidth = 26;
sheet.getRange("B:B").format.columnWidth = 31;
sheet.getRange("C:D").format.columnWidth = 11;
sheet.getRange("E:E").format.columnWidth = 27;
sheet.getRange("F:F").format.columnWidth = 15;
sheet.getRange("G:G").format.columnWidth = 15;
sheet.getRange("H:I").format.columnWidth = 18;
sheet.getRange("J:J").format.columnWidth = 17;
sheet.getRange("K:K").format.columnWidth = 20;
sheet.getRange("L:L").format.columnWidth = 48;
sheet.getRange("M:M").format.columnWidth = 25;
sheet.getRange("A1:M1").format.rowHeight = 24;
sheet.getRange("A7:M7").format.rowHeight = 32;
sheet.freezePanes.freezeRows(7);
const table = sheet.tables.add(`A7:M${7 + rows.length}`, true, "NarutoEpisodesTable");
table.style = "TableStyleMedium2";
table.showFilterButton = true;
sheet.getRange(`J8:J${7 + rows.length}`).conditionalFormats.add("containsText", {
  text: "error",
  format: { fill: "#FCE8E6", font: { color: "#B3261E", bold: true } },
});

workbook.recalculate();
const summary = await workbook.inspect({
  kind: "table",
  range: "Naruto!A4:H5",
  include: "values,formulas",
  tableMaxRows: 3,
  tableMaxCols: 8,
  maxChars: 2000,
});
await fs.writeFile(path.join(artifacts, "inventario_resumen.inspect.ndjson"), summary.ndjson, "utf8");
const preview = await workbook.render({ sheetName: "Naruto", range: "A1:M14", scale: 1, format: "png" });
await fs.writeFile(path.join(artifacts, "inventario_preview.png"), new Uint8Array(await preview.arrayBuffer()));
const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(outputPath);
console.log(JSON.stringify({ outputPath, inventoryRows: inventory.length, events: events.length }));
