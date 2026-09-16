import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = new URL(".", import.meta.url).pathname.replace(/^\//, "");
const csvPath = `${outputDir}/conversion-night-queue.csv`;
const outputPath = `${outputDir}/Inventario_conversion_nocturna_HLS.xlsx`;
const csvText = await fs.readFile(csvPath, "utf8");
const workbook = await Workbook.fromCSV(csvText, { sheetName: "Cola HLS" });
const sheet = workbook.worksheets.getItem("Cola HLS");
const used = sheet.getUsedRange();
const values = used.values;
const headers = values[0].map(String);
const statusIndex = headers.indexOf("Estado");
const typeIndex = headers.indexOf("Tipo");
const diskIndex = headers.indexOf("DiscoOrigen");
const total = values.length - 1;
const countBy = (index, expected) => values.slice(1).filter((row) => String(row[index] ?? "") === expected).length;
const queued = countBy(statusIndex, "EN_COLA");
const review = total - queued;
const movies = countBy(typeIndex, "PELICULA");
const series = countBy(typeIndex, "SERIE");
const diskE = countBy(diskIndex, "E:");
const diskF = countBy(diskIndex, "F:");

sheet.showGridLines = false;
sheet.freezePanes.freezeRows(1);
sheet.getRange(`A1:O${values.length}`).format.font = { name: "Arial", size: 10, color: "#1F2937" };
sheet.getRange("A1:O1").format = {
  fill: "#395F1B",
  font: { name: "Arial", size: 10, bold: true, color: "#FFFFFF" },
  horizontalAlignment: "center",
  verticalAlignment: "center",
  wrapText: true,
};
sheet.getRange(`A1:O${values.length}`).format.verticalAlignment = "center";
sheet.getRange(`A2:O${values.length}`).format.borders = { preset: "insideHorizontal", style: "thin", color: "#E5E7EB" };
sheet.getRange(`K2:K${values.length}`).conditionalFormats.add("containsText", {
  text: "EN_COLA",
  format: { fill: "#DCFCE7", font: { bold: true, color: "#166534" } },
});
sheet.getRange(`K2:K${values.length}`).conditionalFormats.add("containsText", {
  text: "REVISAR",
  format: { fill: "#FEF3C7", font: { bold: true, color: "#92400E" } },
});
sheet.getRange(`K2:K${values.length}`).conditionalFormats.add("containsText", {
  text: "ILEGIBLE",
  format: { fill: "#FEE2E2", font: { bold: true, color: "#991B1B" } },
});
const widths = [8, 23, 12, 23, 10, 10, 42, 70, 12, 36, 20, 58, 12, 14, 34];
widths.forEach((width, index) => { sheet.getCell(0, index).format.columnWidth = width; });
sheet.getRange(`A1:O${values.length}`).format.rowHeight = 20;
sheet.getRange(`A2:A${values.length}`).format.horizontalAlignment = "center";
sheet.getRange(`D2:F${values.length}`).format.horizontalAlignment = "center";

const summary = workbook.worksheets.add("Resumen");
summary.showGridLines = false;
summary.getRange("A2:D2").merge();
summary.getRange("A2").values = [["Inventario de conversión HLS nocturna"]];
summary.getRange("A2").format = { font: { name: "Arial", size: 16, bold: true, color: "#24331A" } };
summary.getRange("A4:B10").values = [
  ["Paquetes inventariados", total],
  ["Listos para convertir", queued],
  ["Requieren revisión", review],
  ["Películas", movies],
  ["Episodios", series],
  ["Origen E:", diskE],
  ["Origen F:", diskF],
];
summary.getRange("A4:A10").format = { fill: "#EEF3E7", font: { name: "Arial", bold: true, color: "#24331A" } };
summary.getRange("B4:B10").format = { font: { name: "Arial", bold: true, color: "#24331A" }, horizontalAlignment: "right" };
summary.getRange("A4:B10").format.borders = { preset: "outside", style: "thin", color: "#B7C5A5" };
summary.getRange("A12:D14").merge();
summary.getRange("A12").values = [["La columna Código interno es la asignación explícita archivo-origen → paquete HLS. Las filas que requieren revisión permanecen fuera de la conversión para proteger los originales y el contenido."]];
summary.getRange("A12").format = { font: { name: "Arial", size: 10, italic: true, color: "#4B5563" }, wrapText: true, verticalAlignment: "top" };
summary.getRange("A:A").format.columnWidth = 30;
summary.getRange("B:B").format.columnWidth = 14;
summary.getRange("C:D").format.columnWidth = 18;
summary.getRange("12:14").format.rowHeight = 25;
summary.tabColor = "#395F1B";

workbook.recalculate();
const inspection = await workbook.inspect({
  kind: "table",
  range: "Resumen!A2:B10",
  include: "values,formulas",
  tableMaxRows: 12,
  tableMaxCols: 4,
});
await fs.writeFile(`${outputDir}/inventory-inspection.ndjson`, inspection.ndjson);
const preview = await workbook.render({ sheetName: "Resumen", range: "A1:D14", scale: 2, format: "png" });
await fs.writeFile(`${outputDir}/inventory-preview.png`, new Uint8Array(await preview.arrayBuffer()));
const exported = await SpreadsheetFile.exportXlsx(workbook);
await exported.save(outputPath);
