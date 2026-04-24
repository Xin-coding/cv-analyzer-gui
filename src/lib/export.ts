import type { CorrectedPoint, Dataset, TafelFit } from "./types";

export function downloadText(fileName: string, content: string, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function correctedCsv(datasets: Dataset[], corrected: Map<string, CorrectedPoint[]>) {
  const rows = [
    [
      "dataset_id",
      "original_file_name",
      "display_name",
      "cycle",
      "index",
      "potential_raw_v",
      "current_raw_a",
      "potential_rhe_v",
      "y_value"
    ].join(",")
  ];
  for (const dataset of datasets) {
    const points = corrected.get(dataset.id) ?? [];
    for (const point of points) {
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

export function fitCsv(fits: TafelFit[]) {
  const rows = [
    [
      "dataset_id",
      "display_name",
      "start_potential_v",
      "end_potential_v",
      "slope_mv_dec",
      "intercept_v",
      "r2",
      "n"
    ].join(",")
  ];
  for (const fit of fits) {
    rows.push(
      [
        fit.datasetId,
        csv(fit.displayName),
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
