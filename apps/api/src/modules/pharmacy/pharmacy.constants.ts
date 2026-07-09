export const DEFAULT_SUBSCRIPTION = {
  planName: "Free",
  status: "ACTIVE",
  billingCycle: "MONTHLY",
  amount: 0,
  autoRenew: true,
} as const;

export const PLAN_PRICING: Record<string, { monthly: number; yearly: number; quarterly: number }> = {
  Free:         { monthly: 0,    yearly: 0,     quarterly: 0 },
  Standard:     { monthly: 999,  yearly: 9590,  quarterly: 2697 },
  Professional: { monthly: 2499, yearly: 23990, quarterly: 6747 },
  Enterprise:   { monthly: 4999, yearly: 47990, quarterly: 13497 },
};
