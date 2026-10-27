import type { DesignMatrix } from "./features";
import type { Fit } from "./fit";
import { log2Factorial } from "./math";

export type RankingSummary = {
  matchups: number;
  species: number;
  /** log2(n!), the noiseless comparison-sort lower bound, in bits. */
  lowerBoundBits: number;
  /** 1 − (mean posterior variance / mean prior variance), in [0, 1]. */
  confidence: number;
  meanSd: number;
};

/**
 * Confidence is how much the Laplace posterior has shrunk versus the prior.
 * 0 means every species is still at its prior width. It climbs as answers
 * pin strengths down. It is not a fraction of the 8,800-bit sorting bound:
 * noisy preferences make each answer worth less than one bit, so a full
 * personal ranking takes more comparisons than log2(n!).
 */
export function rankingSummary(fit: Fit, design: DesignMatrix): RankingSummary {
  const n = fit.ids.length;
  let meanVar = 0;
  let meanPrior = 0;
  const sigmaW2 = fit.sigmaW * fit.sigmaW;
  const sigmaB2 = fit.sigmaB * fit.sigmaB;
  for (let i = 0; i < n; i++) {
    let norm = 0;
    const base = i * design.cols;
    for (let k = 0; k < design.cols; k++) {
      const x = design.values[base + k];
      norm += x * x;
    }
    meanVar += fit.sd[i] * fit.sd[i];
    meanPrior += sigmaB2 + sigmaW2 * norm;
  }
  meanVar = n === 0 ? 0 : meanVar / n;
  meanPrior = n === 0 ? 1 : meanPrior / n;
  const confidence = meanPrior <= 0 ? 0 : Math.min(1, Math.max(0, 1 - meanVar / meanPrior));
  let meanSd = 0;
  for (let i = 0; i < n; i++) meanSd += fit.sd[i];
  meanSd = n === 0 ? 0 : meanSd / n;
  return {
    matchups: fit.comparisons,
    species: n,
    lowerBoundBits: log2Factorial(n),
    confidence,
    meanSd,
  };
}
