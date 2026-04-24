export type Language = "zh" | "en";

export type ReferencePresetId =
  | "sce"
  | "agagcl_sat"
  | "agagcl_3m"
  | "hghgo_1m"
  | "she"
  | "fc"
  | "custom";

export type NormalizeMode = "raw" | "geo" | "ecsa" | "mass";
export type CycleDisplayMode = "last" | "last3" | "all";
export type BranchMode = "forward" | "reverse" | "all";

export interface RawPoint {
  potential: number;
  current: number;
  cycle: number;
  index: number;
  time?: number;
}

export interface Dataset {
  id: string;
  originalFileName: string;
  displayName: string;
  fileType: string;
  points: RawPoint[];
  visible: boolean;
  color: string;
  order: number;
  stackOffset: number;
  override?: Partial<CorrectionSettings>;
  sourceMeta?: Record<string, unknown>;
}

export interface ReferencePreset {
  id: ReferencePresetId;
  label: string;
  valueVsShe: number;
}

export interface CorrectionSettings {
  referenceId: ReferencePresetId;
  customReferenceVsShe: number;
  ocpOffset: number;
  pH: number;
  resistanceOhm: number;
  irPercent: number;
  normalizeMode: NormalizeMode;
  geometricAreaCm2: number;
  ecsaCm2: number;
  loadingMgCm2: number;
}

export interface CorrectedPoint extends RawPoint {
  correctedPotential: number;
  yValue: number;
  datasetId: string;
  displayName: string;
}

export interface TafelFit {
  datasetId: string;
  displayName: string;
  startPotential: number;
  endPotential: number;
  slopeMvDec: number;
  intercept: number;
  r2: number;
  n: number;
}
