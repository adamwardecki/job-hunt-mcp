// Pay floor check (spec §8.3): drop only if the band MAXIMUM is below the floor.
// Hourly, daily and monthly figures are annualised from the top of the band.

import type { PayFloor } from './config.ts';

const PER_YEAR: Readonly<Record<string, number>> = { year: 1, month: 12, week: 52, day: 220, hour: 1760 };

export interface PayInput {
  comp_min?: number | null;
  comp_max?: number | null;
  currency?: string | null;
  period?: string | null;
  fx_rate?: number | null;
  equity?: string | null;
}

export interface PayVerdict {
  verdict: 'unknown' | 'drop' | 'straddles' | 'keep';
  reason: string;
  max_year?: number;
  floor_year?: number;
}

export function checkPay({ comp_min, comp_max, currency, period = 'year', fx_rate, equity }: PayInput, floor: Partial<PayFloor> | null | undefined): PayVerdict {
  if (!floor?.amount) return { verdict: 'unknown', reason: 'No pay floor configured (filters.pay_floor).' };
  const max = comp_max ?? comp_min;
  if (max == null) return { verdict: 'unknown', reason: 'No salary stated. Score on everything else; ask in the form only if it asks.' };
  const k = period === null ? undefined : PER_YEAR[period];
  if (!k) return { verdict: 'unknown', reason: `Unknown period "${period}". Use year, month, week, day or hour.` };
  const floorCurrency = String(floor.currency || '').toUpperCase();
  const cur = String(currency || '').toUpperCase();
  let rate = 1;
  if (cur && floorCurrency && cur !== floorCurrency) {
    if (!fx_rate) {
      return {
        verdict: 'unknown',
        reason: `Band is in ${cur}, floor is in ${floorCurrency}. Look up today's rate and pass fx_rate (${floorCurrency} per 1 ${cur}); never guess.`,
      };
    }
    rate = fx_rate;
  }
  // An unknown floor period annualised to null before, which compared like 0; keep that.
  const floorYear = floor.amount * (PER_YEAR[floor.period || 'year'] ?? 0);
  const maxYear = max * k * rate;
  const minYear = comp_min != null ? comp_min * k * rate : null;
  const fmt = (n: number) => `${floorCurrency || cur} ${Math.round(n).toLocaleString('en-US')}`;
  const band = minYear != null ? `${fmt(minYear)}–${fmt(maxYear)}` : `up to ${fmt(maxYear)}`;
  if (maxYear < floorYear) {
    const eq = equity ? ' Equity does not lift a band that sits entirely below the floor.' : '';
    return { verdict: 'drop', reason: `Band max below floor: ${band}/yr vs floor ${fmt(floorYear)}.${eq}`, max_year: Math.round(maxYear), floor_year: floorYear };
  }
  if (minYear != null && minYear < floorYear) {
    return { verdict: 'straddles', reason: `Band straddles the floor: ${band}/yr vs floor ${fmt(floorYear)}. Keep and flag.`, max_year: Math.round(maxYear), floor_year: floorYear };
  }
  return { verdict: 'keep', reason: `Band at or above floor: ${band}/yr vs floor ${fmt(floorYear)}.`, max_year: Math.round(maxYear), floor_year: floorYear };
}
