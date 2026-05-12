import type { CorrectedPoint, Dataset, TafelFit } from "./types";

type CellValue = string | number | null | undefined;
type WorkbookSheet = { name: string; rows: CellValue[][] };

export function downloadText(fileName: string, content: string, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function downloadWorkbook(fileName: string, sheets: WorkbookSheet[]) {
  downloadText(fileName, workbookXml(sheets), "application/vnd.ms-excel;charset=utf-8");
}

export function pointsWorkbook(
  datasets: Dataset[],
  series: Array<{ dataset: Dataset; points: CorrectedPoint[] }>,
  yHeader: string
) {
  const datasetById = new Map(datasets.map((dataset) => [dataset.id, dataset]));
  const headers = [
    "dataset_id",
    "original_file_name",
    "display_name",
    "cycle",
    "index",
    "potential_raw_v",
    "current_raw_a",
    "potential_display_v",
    yHeader
  ];
  return series.map((item) => {
    const dataset = datasetById.get(item.dataset.id) ?? item.dataset;
    return {
      name: dataset.displayName,
      rows: [
        headers,
        ...item.points.map((point) => [
          dataset.id,
          dataset.originalFileName,
          dataset.displayName,
          point.cycle,
          point.index,
          point.potential,
          point.current,
          point.correctedPotential,
          point.yValue
        ])
      ]
    };
  });
}

export function tafelWorkbook(
  series: Array<{ dataset: Dataset; points: CorrectedPoint[] }>,
  fits: TafelFit[]
) {
  const fitById = new Map(fits.map((fit) => [fit.datasetId, fit]));
  const summary: WorkbookSheet = {
    name: "Fit Summary",
    rows: [
      [
        "dataset_id",
        "display_name",
        "fit_start_v",
        "fit_end_v",
        "slope_mv_dec",
        "intercept_v",
        "r2",
        "n"
      ],
      ...series.map((item) => {
        const fit = fitById.get(item.dataset.id);
        return [
          item.dataset.id,
          item.dataset.displayName,
          fit?.startPotential,
          fit?.endPotential,
          fit?.slopeMvDec,
          fit?.intercept,
          fit?.r2,
          fit?.n
        ];
      })
    ]
  };
  const pointSheets = series.map((item) => ({
    name: item.dataset.displayName,
    rows: [
      [
        "dataset_id",
        "display_name",
        "cycle",
        "index",
        "log10_abs_y",
        "potential_display_v",
        "y_value"
      ],
      ...item.points
        .filter((point) => Number.isFinite(point.yValue) && Math.abs(point.yValue) > 0)
        .map((point) => [
          item.dataset.id,
          item.dataset.displayName,
          point.cycle,
          point.index,
          Math.log10(Math.abs(point.yValue)),
          point.correctedPotential,
          point.yValue
        ])
    ]
  }));
  return [summary, ...pointSheets];
}

export function pointsCsv(
  datasets: Dataset[],
  series: Array<{ dataset: Dataset; points: CorrectedPoint[] }>,
  yHeader: string
) {
  const datasetById = new Map(datasets.map((dataset) => [dataset.id, dataset]));
  const rows = [
    [
      "dataset_id",
      "original_file_name",
      "display_name",
      "cycle",
      "index",
      "potential_raw_v",
      "current_raw_a",
      "potential_display_v",
      yHeader
    ].join(",")
  ];
  for (const item of series) {
    const dataset = datasetById.get(item.dataset.id) ?? item.dataset;
    for (const point of item.points) {
      rows.push(
        [
          dataset.id,
          csv(dataset.originalFileName),
          csv(dataset.displayName),
          point.cycle,
          point.index,
          point.potential,
          point.current,
          point.correctedPotential,
          point.yValue
        ].join(",")
      );
    }
  }
  return rows.join("\n");
}

export function tafelCsv(
  series: Array<{ dataset: Dataset; points: CorrectedPoint[] }>,
  fits: TafelFit[]
) {
  const rows = [
    [
      "type",
      "dataset_id",
      "display_name",
      "log10_abs_y",
      "potential_display_v",
      "fit_start_v",
      "fit_end_v",
      "slope_mv_dec",
      "intercept_v",
      "r2",
      "n"
    ].join(",")
  ];
  for (const item of series) {
    for (const point of item.points) {
      if (!Number.isFinite(point.yValue) || Math.abs(point.yValue) <= 0) continue;
      rows.push(
        [
          "point",
          item.dataset.id,
          csv(item.dataset.displayName),
          Math.log10(Math.abs(point.yValue)),
          point.correctedPotential,
          "",
          "",
          "",
          "",
          "",
          ""
        ].join(",")
      );
    }
  }
  for (const fit of fits) {
    rows.push(
      [
        "fit",
        fit.datasetId,
        csv(fit.displayName),
        "",
        "",
        fit.startPotential,
        fit.endPotential,
        fit.slopeMvDec,
        fit.intercept,
        fit.r2,
        fit.n
      ].join(",")
    );
  }
  return rows.join("\n");
}

function csv(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function workbookXml(sheets: WorkbookSheet[]) {
  const usedNames = new Map<string, number>();
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
${sheets
  .map((sheet) => {
    const name = uniqueSheetName(sheet.name, usedNames);
    return `<Worksheet ss:Name="${xml(name)}"><Table>
${sheet.rows
  .map(
    (row) =>
      `<Row>${row
        .map((value) => {
          const type = typeof value === "number" && Number.isFinite(value) ? "Number" : "String";
          const text = value === null || value === undefined || Number.isNaN(value) ? "" : String(value);
          return `<Cell><Data ss:Type="${type}">${xml(text)}</Data></Cell>`;
        })
        .join("")}</Row>`
  )
  .join("\n")}
</Table></Worksheet>`;
  })
  .join("\n")}
</Workbook>`;
}

function uniqueSheetName(name: string, usedNames: Map<string, number>) {
  const base = sanitizeSheetName(name) || "Sheet";
  const count = usedNames.get(base) ?? 0;
  usedNames.set(base, count + 1);
  if (count === 0) return base;
  const suffix = `_${count + 1}`;
  return `${base.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`;
}

function sanitizeSheetName(name: string) {
  return name.replace(/[\[\]:*?/\\]/g, "_").slice(0, 31);
}

function xml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
