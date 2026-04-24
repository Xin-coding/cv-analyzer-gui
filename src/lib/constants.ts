import type { CorrectionSettings, ReferencePreset } from "./types";

export const referencePresets: ReferencePreset[] = [
  { id: "sce", label: "SCE (+0.241 V vs SHE)", valueVsShe: 0.241 },
  { id: "agagcl_sat", label: "Ag/AgCl sat. KCl (+0.197 V)", valueVsShe: 0.197 },
  { id: "agagcl_3m", label: "Ag/AgCl 3 M KCl (+0.210 V)", valueVsShe: 0.21 },
  { id: "hghgo_1m", label: "Hg/HgO 1 M NaOH (+0.098 V)", valueVsShe: 0.098 },
  { id: "she", label: "SHE (0.000 V)", valueVsShe: 0 },
  { id: "fc", label: "Fc/Fc+ (+0.400 V, editable)", valueVsShe: 0.4 },
  { id: "custom", label: "Custom", valueVsShe: 0 }
];

export const defaultCorrection: CorrectionSettings = {
  referenceId: "sce",
  customReferenceVsShe: 0,
  ocpOffset: 0,
  pH: 14,
  resistanceOhm: 0,
  irPercent: 1,
  normalizeMode: "geo",
  geometricAreaCm2: 0.196,
  ecsaCm2: 1,
  loadingMgCm2: 0
};

export const palette = [
  "#0F766E",
  "#B45309",
  "#2563EB",
  "#B91C1C",
  "#6D28D9",
  "#15803D",
  "#C2410C",
  "#0F172A",
  "#BE123C",
  "#0369A1"
];
