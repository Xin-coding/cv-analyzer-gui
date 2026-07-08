import assert from "node:assert/strict";
import { defaultCorrection } from "../src/lib/constants";
import { reimportCsv } from "../src/lib/export";
import { correctDataset } from "../src/lib/math";
import { parseFiles } from "../src/lib/parser";
import type { CorrectionSettings, Dataset } from "../src/lib/types";

const settings: CorrectionSettings = {
  ...defaultCorrection,
  referenceId: "agagcl_3m",
  pH: 13,
  resistanceOhm: 4,
  irPercent: 50,
  normalizeMode: "geo",
  geometricAreaCm2: 0.5
};

const datasets: Dataset[] = [
  {
    id: "dataset-a",
    originalFileName: "source-a.mpt",
    displayName: "Catalyst A",
    fileType: "mpt",
    points: [
      { potential: 0.1, current: 0.0002, cycle: 1, index: 0, time: 0 },
      { potential: 0.2, current: 0.0003, cycle: 1, index: 1, time: 1 }
    ],
    visible: true,
    color: "#0F766E",
    order: 0,
    stackOffset: 0
  },
  {
    id: "dataset-b",
    originalFileName: "source-b.csv",
    displayName: 'Catalyst B, "quoted"',
    fileType: "csv",
    points: [
      { potential: -0.05, current: -0.0001, cycle: 1, index: 0, time: 0 },
      { potential: 0.05, current: -0.00015, cycle: 2, index: 1, time: 2 },
      { potential: 0.15, current: -0.0002, cycle: 2, index: 2, time: 4 }
    ],
    visible: false,
    color: "#B45309",
    order: 1,
    stackOffset: 0
  }
];

const exportedSeries = datasets.map((dataset) => ({
  dataset,
  points: correctDataset(dataset, settings)
}));
const csv = reimportCsv(exportedSeries, "j_geo / mA cm^-2");
const parsed = await parseFiles([new File([csv], "roundtrip.csv", { type: "text/csv" })]);

assert.equal(parsed.length, 2);
assert.deepEqual(
  parsed.map((dataset) => dataset.displayName),
  datasets.map((dataset) => dataset.displayName)
);
assert.deepEqual(
  parsed.map((dataset) => dataset.originalFileName),
  datasets.map((dataset) => dataset.originalFileName)
);
assert.deepEqual(
  parsed.map((dataset) => dataset.order),
  [0, 1]
);

for (const [datasetIndex, parsedDataset] of parsed.entries()) {
  assert.equal(parsedDataset.sourceMeta?.parser, "cv-analyzer-reimport");
  assert.equal(parsedDataset.sourceMeta?.processedYLabel, "j_geo / mA cm^-2");
  const parsedPoints = correctDataset(parsedDataset, defaultCorrection);
  const expectedPoints = exportedSeries[datasetIndex].points;
  assert.equal(parsedPoints.length, expectedPoints.length);
  for (const [pointIndex, parsedPoint] of parsedPoints.entries()) {
    const expectedPoint = expectedPoints[pointIndex];
    close(parsedPoint.correctedPotential, expectedPoint.correctedPotential, "potential");
    close(parsedPoint.yValue, expectedPoint.yValue, "y value");
    assert.equal(parsedPoint.cycle, expectedPoint.cycle);
    assert.equal(parsedPoint.index, expectedPoint.index);
    assert.equal(parsedPoint.time, expectedPoint.time);
  }
}

console.log("reimport round-trip ok");

function close(actual: number, expected: number, label: string) {
  assert.ok(
    Math.abs(actual - expected) < 1e-10,
    `${label}: expected ${expected}, received ${actual}`
  );
}
