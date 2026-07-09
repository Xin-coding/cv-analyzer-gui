import assert from "node:assert/strict";
import { defaultCorrection } from "../src/lib/constants";
import { correctDataset, linearTafelFit } from "../src/lib/math";
import { parseSessionText, sessionJson } from "../src/lib/session";
import type { CorrectionSettings, Dataset, TafelFitWindow } from "../src/lib/types";

const settings: CorrectionSettings = {
  ...defaultCorrection,
  referenceId: "agagcl_3m",
  referenceOffset: 0.012,
  pH: 13,
  resistanceOhm: 4,
  irPercent: 50,
  normalizeMode: "geo",
  geometricAreaCm2: 0.5,
  ecsaCm2: 1.7,
  loadingMgCm2: 0.21
};

const datasets: Dataset[] = [
  {
    id: "dataset-a",
    originalFileName: "source-a.mpt",
    displayName: "Catalyst A",
    fileType: "mpt",
    points: [
      { potential: 0.1, current: 0.0002, cycle: 1, index: 0, time: 0 },
      { potential: 0.2, current: 0.0003, cycle: 1, index: 1, time: 1 },
      { potential: 0.3, current: 0.00045, cycle: 1, index: 2, time: 2 },
      { potential: 0.4, current: 0.0007, cycle: 2, index: 3, time: 3 }
    ],
    visible: true,
    color: "#0F766E",
    order: 0,
    stackOffset: 0,
    sourceMeta: { parser: "fixture" }
  },
  {
    id: "dataset-b",
    originalFileName: "source-b.csv",
    displayName: 'Catalyst B, "quoted"',
    fileType: "csv",
    points: [
      { potential: -0.05, current: 0.00012, cycle: 1, index: 0, time: 0 },
      { potential: 0.05, current: 0.0002, cycle: 1, index: 1, time: 2 },
      { potential: 0.15, current: 0.00032, cycle: 2, index: 2, time: 4 },
      { potential: 0.25, current: 0.0005, cycle: 2, index: 3, time: 6 }
    ],
    visible: false,
    color: "#B45309",
    order: 1,
    stackOffset: 0,
    override: {
      normalizeMode: "mass",
      loadingMgCm2: 0.33,
      geometricAreaCm2: 0.42
    }
  }
];

const fitWindows = Object.fromEntries(
  datasets.map((dataset) => {
    const corrected = correctDataset(dataset, settings);
    const potentials = corrected.map((point) => point.correctedPotential);
    return [
      dataset.id,
      {
        startPotential: Math.min(...potentials),
        endPotential: Math.max(...potentials)
      } satisfies TafelFitWindow
    ];
  })
);

const tafelFits = datasets
  .map((dataset) => {
    const corrected = correctDataset(dataset, settings);
    const window = fitWindows[dataset.id];
    return linearTafelFit(
      dataset.id,
      dataset.displayName,
      corrected,
      window.startPotential,
      window.endPotential
    );
  })
  .filter((fit) => fit !== null);

const exportedAt = new Date("2026-07-09T12:00:00.000Z");
const json = sessionJson(
  {
    datasets,
    settings,
    display: {
      language: "zh",
      activePanel: "tafel",
      cycleMode: "last3",
      branchMode: "reverse",
      stacked: true,
      stackStep: 7.5,
      showDirection: false
    },
    tafel: {
      fitRange: { start: 0.123, end: 0.456 },
      fitWindows,
      tafelFocus: false
    },
    derivedResults: {
      tafelFits
    }
  },
  exportedAt
);

const parsed = parseSessionText(json, "session.json");

assert.equal(parsed.app, "cv-analyzer-gui");
assert.equal(parsed.schemaVersion, 1);
assert.equal(parsed.exportedAt, exportedAt.toISOString());
assert.deepEqual(parsed.settings, settings);
assert.deepEqual(parsed.display, {
  language: "zh",
  activePanel: "tafel",
  cycleMode: "last3",
  branchMode: "reverse",
  stacked: true,
  stackStep: 7.5,
  showDirection: false
});
assert.deepEqual(parsed.tafel.fitRange, { start: 0.123, end: 0.456 });
assert.deepEqual(parsed.tafel.fitWindows, fitWindows);
assert.equal(parsed.tafel.tafelFocus, false);
assert.equal(parsed.datasets.length, 2);
assert.equal(parsed.datasets[1].displayName, 'Catalyst B, "quoted"');
assert.equal(parsed.datasets[1].visible, false);
assert.deepEqual(parsed.datasets[1].override, datasets[1].override);
assert.deepEqual(parsed.datasets.flatMap((dataset) => dataset.points), datasets.flatMap((dataset) => dataset.points));
assert.equal(parsed.derivedResults.tafelFits.length, tafelFits.length);
assert.deepEqual(parsed.derivedResults.tafelFits, tafelFits);

console.log("session round-trip ok");
