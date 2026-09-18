import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const outputDir = path.resolve(process.cwd(), "../../outputs/dragon_ball_z");
const workbookPath = path.join(outputDir, "inventario_conversion_dragon_ball_z.xlsx");
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(workbookPath));
const inventory = workbook.worksheets.getItem("Inventario");
inventory.getRange("M2:N2").values = [["Convertido", "Validado"]];
workbook.recalculate();

const summaryCheck = await workbook.inspect({ kind: "table", range: "Resumen!A6:B10", include: "values,formulas", tableMaxRows: 5, tableMaxCols: 2 });
const rowCheck = await workbook.inspect({ kind: "table", range: "Inventario!A1:O2", include: "values,formulas", tableMaxRows: 2, tableMaxCols: 15 });
console.log(summaryCheck.ndjson);
console.log(rowCheck.ndjson);
const errors = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!", options: { useRegex: true, maxResults: 50 }, summary: "formula error scan" });
console.log(errors.ndjson);
const preview = await workbook.render({ sheetName: "Resumen", range: "A1:F14", scale: 2, format: "png" });
await fs.writeFile(path.join(outputDir, "inventario_preview.png"), new Uint8Array(await preview.arrayBuffer()));
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(workbookPath);
