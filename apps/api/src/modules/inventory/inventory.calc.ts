// Pure computation functions for inventory AI features.
// No DB imports — all inputs are plain numbers/booleans so the logic can be
// unit-tested without any mocking.

export type WasteRiskTier = "HIGH" | "MEDIUM" | "LOW" | "SAFE" | "NO_DATA";

export type WasteRisk = {
  avgDailySales: number;
  willSellUnits: number;
  atRiskUnits:   number;
  potentialLoss: number;
  riskTier:      WasteRiskTier;
};

export type ReorderInsight = {
  avgDailySales: number;
  suggestedQty:  number;
  coverDays:     number;
  leadTimeDays:  number;
  hasData:       boolean;
};

export function computeWasteRisk(
  quantity:      number,
  daysToExpiry:  number,
  isExpired:     boolean,
  avgDailySales: number,
  hasData:       boolean,
  purchaseRate:  number,
): WasteRisk {
  if (isExpired) {
    return {
      avgDailySales: Math.round(avgDailySales * 10) / 10,
      willSellUnits: 0,
      atRiskUnits:   quantity,
      potentialLoss: Math.round(quantity * purchaseRate),
      riskTier:      "HIGH",
    };
  }

  if (!hasData || avgDailySales === 0) {
    return { avgDailySales: 0, willSellUnits: 0, atRiskUnits: 0, potentialLoss: 0, riskTier: "NO_DATA" };
  }

  const daysLeft  = Math.max(0, daysToExpiry);
  const willSell  = Math.min(quantity, Math.floor(avgDailySales * daysLeft));
  const atRisk    = quantity - willSell;
  const atRiskPct = quantity > 0 ? atRisk / quantity : 0;

  return {
    avgDailySales: Math.round(avgDailySales * 10) / 10,
    willSellUnits: willSell,
    atRiskUnits:   atRisk,
    potentialLoss: Math.round(atRisk * purchaseRate),
    riskTier: atRisk === 0     ? "SAFE"
            : atRiskPct < 0.2  ? "LOW"
            : atRiskPct < 0.5  ? "MEDIUM"
                               : "HIGH",
  };
}

export function computeReorderInsight(
  avgDailySales: number,
  hasData:       boolean,
  coverDays      = 30,
  leadTimeDays   = 7,
): ReorderInsight {
  return {
    avgDailySales:  Math.round(avgDailySales * 10) / 10,
    suggestedQty:   hasData ? Math.ceil(avgDailySales * (coverDays + leadTimeDays)) : 0,
    coverDays,
    leadTimeDays,
    hasData,
  };
}

// Returns the calibrated minimumStock value for one medicine.
// Caller skips medicines with avgDailySales === 0 (no data to calibrate from).
export function computeCalibratedMin(
  avgDailySales: number,
  leadTimeDays   = 7,
  safetyFactor   = 1.5,
  minFloor       = 5,
): number {
  return Math.max(minFloor, Math.ceil(avgDailySales * leadTimeDays * safetyFactor));
}
