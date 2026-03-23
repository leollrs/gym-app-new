// Pricing tiers based on plan type, member count, and founding status

const FOUNDING_STARTER = [
  { max: 100, price: 99 },
  { max: 200, price: 149 },
  { max: 300, price: 199 },
];

const FOUNDING_PRO = [
  { max: 100, price: 149 },
  { max: 200, price: 179 },
  { max: 300, price: 229 },
];

const STANDARD_STARTER = [
  { max: 100, price: 149 },
  { max: 200, price: 199 },
  { max: 300, price: 249 },
];

const STANDARD_PRO = [
  { max: 100, price: 229 },
  { max: 200, price: 279 },
  { max: 300, price: 349 },
];

const LIFETIME_MAINTENANCE = {
  founding: 99,
  standard: 149,
};

function lookupBracket(brackets, memberCount) {
  for (const b of brackets) {
    if (memberCount <= b.max) return b.price;
  }
  return null; // 300+ = custom quote
}

export function getMonthlyPrice({ planType, memberCount, isFounding, monthlyPriceOverride }) {
  // If there's a manual override (custom quote), use it
  if (monthlyPriceOverride && monthlyPriceOverride > 0) return monthlyPriceOverride;

  if (planType === 'lifetime') {
    return isFounding ? LIFETIME_MAINTENANCE.founding : LIFETIME_MAINTENANCE.standard;
  }

  let brackets;
  if (planType === 'pro') {
    brackets = isFounding ? FOUNDING_PRO : STANDARD_PRO;
  } else {
    brackets = isFounding ? FOUNDING_STARTER : STANDARD_STARTER;
  }

  return lookupBracket(brackets, memberCount) ?? 0;
}

export function getPricingLabel({ planType, isFounding }) {
  const prefix = isFounding ? 'Founding' : 'Standard';
  const plan = (planType ?? 'starter').charAt(0).toUpperCase() + (planType ?? 'starter').slice(1);
  return `${prefix} · ${plan}`;
}

export function getMemberBracketLabel(memberCount) {
  if (memberCount <= 100) return '≤100';
  if (memberCount <= 200) return '101–200';
  if (memberCount <= 300) return '201–300';
  return '300+';
}
