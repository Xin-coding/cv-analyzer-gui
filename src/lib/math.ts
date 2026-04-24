import { referencePresets } from "./constants";
import type {
  CorrectedPoint,
  CorrectionSettings,
  Dataset,
  NormalizeMode,
  TafelFit
} from "./types";

export function mergedCorrection(
  globalSettings: CorrectionSettings,
  override?: Partial<CorrectionSettings>
): CorrectionSettings {
  return { ...globalSettings, ...override };
}

export function referenceVsShe(settings: CorrectionSettings): number {
  if (settings.referenceId === "custom") return settings.customReferenceVsShe;
  return referencePresets.find((item) => item.id === settings.referenceId)?.valueVsShe ?? 0;
}

export function correctedPotential(
  potential: number,
  currentA: number,
  settings: CorrectionSettings
): number {
  return (
    potential +
    referenceVsShe(settings) +
    settings.ocpOffset +
    0.05916 * settings.pH -
    currentA * settings.resistanceOhm * settings.irPercent
  );
}

export function normalizeCurrent(currentA: number, settings: CorrectionSettings): number {
  const currentMa = currentA * 1000;
  switch (settings.normalizeMode) {
    case "raw":
      return currentMa;
    case "geo":
      return currentMa / positiveOrOne(settings.geometricAreaCm2);
    case "ecsa":
      return currentMa / positiveOrOne(settings.ecsaCm2);
    case "mass": {
      const massMg = positiveOrOne(settings.loadingMgCm2 * settings.geometricAreaCm2);
      return currentMa / massMg;
    }
  }
}

export function yAxisKey(mode: NormalizeMode): string {
  if (mode === "raw") return "currentAxisRaw";
  if (mode === "geo") return "currentAxisGeo";
  if (mode === "ecsa") return "currentAxisEcsa";
  return "currentAxisMass";
}

export function correctDataset(
  dataset: Dataset,
  globalSettings: CorrectionSettings
): CorrectedPoint[] {
  const settings = mergedCorrection(globalSettings, dataset.override);
  return dataset.points.map((point) => ({
    ...point,
    correctedPotential: correctedPotential(point.potential, point.current, settings),
    yValue: normalizeCurrent(point.current, settings),
    datasetId: dataset.id,
    displayName: dataset.displayName
  }));
}

export function selectCycles(points: CorrectedPoint[], mode: "last" | "last3" | "all") {
  if (mode === "all") return points;
  const cycles = Array.from(new Set(points.map((point) => point.cycle))).sort((a, b) => a - b);
  const keep = mode === "last" ? cycles.slice(-1) : cycles.slice(-3);
  return points.filter((point) => keep.includes(point.cycle));
}

export function selectBranch(points: CorrectedPoint[], branch: "forward" | "reverse" | "all") {
  if (branch === "all" || points.length < 3) return points;
  const first = points[0].correctedPotential;
  const last = points[points.length - 1].correctedPotential;
  const forwardIncreasing = last >= first;
  const midpoint = Math.floor(points.length / 2);
  const firstHalf = points.slice(0, midpoint);
  const secondHalf = points.slice(midpoint);
  return branch === "forward"
    ? forwardIncreasing
      ? firstHalf
      : secondHalf
    : forwardIncreasing
      ? secondHalf
      : firstHalf;
}

export function linearTafelFit(
  datasetId: string,
  displayName: string,
  points: CorrectedPoint[],
  startPotential: number,
  endPotential: number
): TafelFit | null {
  const minE = Math.min(startPotential, endPotential);
  const maxE = Math.max(startPotential, endPotential);
  const fitPoints = points
    .filter(
      (point) =>
        point.correctedPotential >= minE &&
        point.correctedPotential <= maxE &&
        Number.isFinite(point.yValue) &&
        Math.abs(point.yValue) > 0
    )
    .map((point) => ({
      x: Math.log10(Math.abs(point.yValue)),
      y: point.correctedPotential
    }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));

  if (fitPoints.length < 3) return null;
  const n = fitPoints.length;
  const sumX = fitPoints.reduce((sum, point) => sum + point.x, 0);
  const sumY = fitPoints.reduce((sum, point) => sum + point.y, 0);
  const meanX = sumX / n;
  const meanY = sumY / n;
  const ssXX = fitPoints.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0);
  if (ssXX === 0) return null;
  const ssXY = fitPoints.reduce((sum, point) => sum + (point.x - meanX) * (point.y - meanY), 0);
  const slope = ssXY / ssXX;
  const intercept = meanY - slope * meanX;
  const ssTot = fitPoints.reduce((sum, point) => sum + (point.y - meanY) ** 2, 0);
  const ssRes = fitPoints.reduce(
    (sum, point) => sum + (point.y - (slope * point.x + intercept)) ** 2,
    0
  );
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  return {
    datasetId,
    displayName,
    startPotential: minE,
    endPotential: maxE,
    slopeMvDec: slope * 1000,
    intercept,
    r2,
    n
  };
}

export function inferDefaultFitRange(points: CorrectedPoint[]) {
  if (points.length === 0) return { start: 0, end: 0 };
  const potentials = points.map((point) => point.correctedPotential).filter(Number.isFinite);
  const min = Math.min(...potentials);
  const max = Math.max(...potentials);
  const span = max - min;
  return { start: min + span * 0.35, end: min + span * 0.65 };
}

function positiveOrOne(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}
