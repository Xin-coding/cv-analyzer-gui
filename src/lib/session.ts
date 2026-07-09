import { defaultCorrection, palette } from "./constants";
import type {
  BranchMode,
  CorrectionSettings,
  CycleDisplayMode,
  Dataset,
  Language,
  NormalizeMode,
  RawPoint,
  ReferencePresetId,
  TafelFit,
  TafelFitWindow
} from "./types";

export const sessionSchemaVersion = 1;

export type SessionActivePanel = "cv" | "tafel";

export interface SessionDisplayState {
  language: Language;
  activePanel: SessionActivePanel;
  cycleMode: CycleDisplayMode;
  branchMode: BranchMode;
  stacked: boolean;
  stackStep: number;
  showDirection: boolean;
}

export interface SessionTafelState {
  fitRange: { start: number; end: number };
  fitWindows: Record<string, TafelFitWindow>;
  tafelFocus: boolean;
}

export interface SessionDerivedResults {
  tafelFits: TafelFit[];
}

export interface SessionSnapshot {
  app: "cv-analyzer-gui";
  schemaVersion: typeof sessionSchemaVersion;
  exportedAt: string;
  datasets: Dataset[];
  settings: CorrectionSettings;
  display: SessionDisplayState;
  tafel: SessionTafelState;
  derivedResults: SessionDerivedResults;
}

export interface SessionSnapshotInput {
  datasets: Dataset[];
  settings: CorrectionSettings;
  display: SessionDisplayState;
  tafel: SessionTafelState;
  derivedResults: SessionDerivedResults;
}

export function sessionFileName(date = new Date()) {
  const stamp = [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate()),
    "-",
    pad2(date.getHours()),
    pad2(date.getMinutes()),
    pad2(date.getSeconds())
  ].join("");
  return `cv-analyzer-session-${stamp}.json`;
}

export function sessionJson(input: SessionSnapshotInput, date = new Date()) {
  return JSON.stringify(createSessionSnapshot(input, date), null, 2);
}

export function createSessionSnapshot(
  input: SessionSnapshotInput,
  date = new Date()
): SessionSnapshot {
  return {
    app: "cv-analyzer-gui",
    schemaVersion: sessionSchemaVersion,
    exportedAt: date.toISOString(),
    datasets: input.datasets.map(cloneDataset),
    settings: normalizeCorrection(input.settings),
    display: normalizeDisplay(input.display),
    tafel: normalizeTafel(input.tafel),
    derivedResults: {
      tafelFits: input.derivedResults.tafelFits.map(cloneFit)
    }
  };
}

export async function parseSessionFile(file: File): Promise<SessionSnapshot | null> {
  if (!/\.json$/i.test(file.name)) return null;
  return parseSessionText(await file.text(), file.name);
}

export function parseSessionText(text: string, fileName = "session.json"): SessionSnapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Could not parse ${fileName} as a CV Analyzer session: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  const objectRaw = asObject(raw);
  if (objectRaw.app !== "cv-analyzer-gui" || objectRaw.schemaVersion !== sessionSchemaVersion) {
    throw new Error(`Unsupported CV Analyzer session file: ${fileName}.`);
  }
  const datasets = arrayOf(objectRaw.datasets).map((dataset, index) =>
    normalizeDataset(dataset, index)
  );
  if (!datasets.length) throw new Error(`Session ${fileName} does not contain datasets.`);
  return {
    app: "cv-analyzer-gui",
    schemaVersion: sessionSchemaVersion,
    exportedAt: stringOr(objectRaw.exportedAt, new Date(0).toISOString()),
    datasets,
    settings: normalizeCorrection(objectRaw.settings),
    display: normalizeDisplay(objectRaw.display),
    tafel: normalizeTafel(objectRaw.tafel),
    derivedResults: normalizeDerivedResults(objectRaw.derivedResults)
  };
}

function normalizeDataset(raw: unknown, index: number): Dataset {
  const objectRaw = asObject(raw);
  const points = arrayOf(objectRaw.points).map(normalizePoint).filter(Boolean) as RawPoint[];
  if (!points.length) throw new Error(`Session dataset ${index + 1} has no valid points.`);
  const override = isObject(objectRaw.override)
    ? normalizePartialCorrection(objectRaw.override)
    : undefined;
  return {
    id: stringOr(objectRaw.id, randomId()),
    originalFileName: stringOr(objectRaw.originalFileName, `dataset-${index + 1}.json`),
    displayName: stringOr(objectRaw.displayName, `Dataset ${index + 1}`),
    fileType: stringOr(objectRaw.fileType, "json"),
    points,
    visible: booleanOr(objectRaw.visible, true),
    color: stringOr(objectRaw.color, palette[index % palette.length]),
    order: finiteOr(objectRaw.order, index),
    stackOffset: finiteOr(objectRaw.stackOffset, 0),
    override,
    sourceMeta: isObject(objectRaw.sourceMeta) ? cloneJsonObject(objectRaw.sourceMeta) : undefined
  };
}

function normalizePoint(raw: unknown): RawPoint | null {
  const objectRaw = asObject(raw);
  const potential = finiteOr(objectRaw.potential, Number.NaN);
  const current = finiteOr(objectRaw.current, Number.NaN);
  if (!Number.isFinite(potential) || !Number.isFinite(current)) return null;
  const time = finiteOr(objectRaw.time, Number.NaN);
  return {
    potential,
    current,
    cycle: Math.max(1, Math.round(finiteOr(objectRaw.cycle, 1))),
    index: Math.round(finiteOr(objectRaw.index, 0)),
    time: Number.isFinite(time) ? time : undefined
  };
}

function cloneDataset(dataset: Dataset): Dataset {
  return {
    id: dataset.id,
    originalFileName: dataset.originalFileName,
    displayName: dataset.displayName,
    fileType: dataset.fileType,
    points: dataset.points.map((point) => ({ ...point })),
    visible: dataset.visible,
    color: dataset.color,
    order: dataset.order,
    stackOffset: dataset.stackOffset,
    override: dataset.override ? normalizePartialCorrection(dataset.override) : undefined,
    sourceMeta: dataset.sourceMeta ? cloneJsonObject(dataset.sourceMeta) : undefined
  };
}

function normalizeCorrection(raw: unknown): CorrectionSettings {
  const objectRaw = asObject(raw);
  return {
    referenceId: referenceIdOr(objectRaw.referenceId, defaultCorrection.referenceId),
    customReferenceVsShe: finiteOr(
      objectRaw.customReferenceVsShe,
      defaultCorrection.customReferenceVsShe
    ),
    referenceOffset: finiteOr(objectRaw.referenceOffset, defaultCorrection.referenceOffset),
    pH: nonNegativeOr(objectRaw.pH, defaultCorrection.pH),
    resistanceOhm: nonNegativeOr(objectRaw.resistanceOhm, defaultCorrection.resistanceOhm),
    irPercent: nonNegativeOr(objectRaw.irPercent, defaultCorrection.irPercent),
    normalizeMode: normalizeModeOr(objectRaw.normalizeMode, defaultCorrection.normalizeMode),
    geometricAreaCm2: finiteOr(objectRaw.geometricAreaCm2, defaultCorrection.geometricAreaCm2),
    ecsaCm2: finiteOr(objectRaw.ecsaCm2, defaultCorrection.ecsaCm2),
    loadingMgCm2: finiteOr(objectRaw.loadingMgCm2, defaultCorrection.loadingMgCm2)
  };
}

function normalizePartialCorrection(raw: Record<string, unknown>): Partial<CorrectionSettings> {
  const normalized = normalizeCorrection({ ...defaultCorrection, ...raw });
  const result: Partial<CorrectionSettings> = {};
  for (const key of Object.keys(raw) as Array<keyof CorrectionSettings>) {
    if (key in normalized) result[key] = normalized[key] as never;
  }
  return result;
}

function normalizeDisplay(raw: unknown): SessionDisplayState {
  const objectRaw = asObject(raw);
  return {
    language: languageOr(objectRaw.language, "zh"),
    activePanel: objectRaw.activePanel === "tafel" ? "tafel" : "cv",
    cycleMode: cycleModeOr(objectRaw.cycleMode, "last"),
    branchMode: branchModeOr(objectRaw.branchMode, "forward"),
    stacked: booleanOr(objectRaw.stacked, false),
    stackStep: finiteOr(objectRaw.stackStep, 10),
    showDirection: booleanOr(objectRaw.showDirection, true)
  };
}

function normalizeTafel(raw: unknown): SessionTafelState {
  const objectRaw = asObject(raw);
  const fitRangeRaw = asObject(objectRaw.fitRange);
  const windowsRaw = isObject(objectRaw.fitWindows) ? objectRaw.fitWindows : {};
  const fitWindows: Record<string, TafelFitWindow> = {};
  for (const [datasetId, windowRaw] of Object.entries(windowsRaw)) {
    fitWindows[datasetId] = normalizeFitWindow(windowRaw);
  }
  return {
    fitRange: {
      start: finiteOr(fitRangeRaw.start, 0),
      end: finiteOr(fitRangeRaw.end, 1)
    },
    fitWindows,
    tafelFocus: booleanOr(objectRaw.tafelFocus, true)
  };
}

function normalizeFitWindow(raw: unknown): TafelFitWindow {
  const objectRaw = asObject(raw);
  return {
    startPotential: finiteOr(objectRaw.startPotential, 0),
    endPotential: finiteOr(objectRaw.endPotential, 1)
  };
}

function normalizeDerivedResults(raw: unknown): SessionDerivedResults {
  const objectRaw = asObject(raw);
  return {
    tafelFits: arrayOf(objectRaw.tafelFits).map(normalizeFit).filter(Boolean) as TafelFit[]
  };
}

function normalizeFit(raw: unknown): TafelFit | null {
  const objectRaw = asObject(raw);
  const startPotential = finiteOr(objectRaw.startPotential, Number.NaN);
  const endPotential = finiteOr(objectRaw.endPotential, Number.NaN);
  const slopeMvDec = finiteOr(objectRaw.slopeMvDec, Number.NaN);
  const intercept = finiteOr(objectRaw.intercept, Number.NaN);
  const r2 = finiteOr(objectRaw.r2, Number.NaN);
  const n = finiteOr(objectRaw.n, Number.NaN);
  if (
    !Number.isFinite(startPotential) ||
    !Number.isFinite(endPotential) ||
    !Number.isFinite(slopeMvDec) ||
    !Number.isFinite(intercept) ||
    !Number.isFinite(r2) ||
    !Number.isFinite(n)
  ) {
    return null;
  }
  return {
    datasetId: stringOr(objectRaw.datasetId, ""),
    displayName: stringOr(objectRaw.displayName, ""),
    startPotential,
    endPotential,
    slopeMvDec,
    intercept,
    r2,
    n: Math.round(n)
  };
}

function cloneFit(fit: TafelFit): TafelFit {
  return { ...fit };
}

function asObject(value: unknown): Record<string, unknown> {
  return isObject(value) ? value : {};
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringOr(value: unknown, fallback: string) {
  return typeof value === "string" && value.length ? value : fallback;
}

function booleanOr(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function finiteOr(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nonNegativeOr(value: unknown, fallback: number) {
  const numberValue = finiteOr(value, fallback);
  return numberValue >= 0 ? numberValue : fallback;
}

function referenceIdOr(value: unknown, fallback: ReferencePresetId): ReferencePresetId {
  return [
    "raw",
    "sce",
    "agagcl_sat",
    "agagcl_3m",
    "hghgo_1m",
    "she",
    "fc",
    "custom"
  ].includes(String(value))
    ? (value as ReferencePresetId)
    : fallback;
}

function normalizeModeOr(value: unknown, fallback: NormalizeMode): NormalizeMode {
  return ["raw", "geo", "ecsa", "mass"].includes(String(value))
    ? (value as NormalizeMode)
    : fallback;
}

function cycleModeOr(value: unknown, fallback: CycleDisplayMode): CycleDisplayMode {
  return ["last", "last3", "all"].includes(String(value))
    ? (value as CycleDisplayMode)
    : fallback;
}

function branchModeOr(value: unknown, fallback: BranchMode): BranchMode {
  return ["forward", "reverse", "all"].includes(String(value))
    ? (value as BranchMode)
    : fallback;
}

function languageOr(value: unknown, fallback: Language): Language {
  return value === "en" || value === "zh" ? value : fallback;
}

function cloneJsonObject(value: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function randomId() {
  return globalThis.crypto?.randomUUID?.() ?? `dataset-${Math.random().toString(36).slice(2)}`;
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}
