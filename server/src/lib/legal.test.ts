import { describe, it, expect } from 'vitest';
import { outstandingBalance, trackForAmount, formatMoney } from './legal';

describe('outstandingBalance', () => {
  it('subtracts paid from owed', () => {
    expect(outstandingBalance(5000, 1000)).toBe(4000);
  });
  it('accepts string inputs (Prisma Decimal serialization)', () => {
    expect(outstandingBalance('5000.50', '500.50')).toBe(4500);
  });
  it('never goes negative when overpaid', () => {
    expect(outstandingBalance(1000, 2000)).toBe(0);
  });
  it('treats null/undefined as zero', () => {
    expect(outstandingBalance(null, undefined)).toBe(0);
    expect(outstandingBalance(750, null)).toBe(750);
  });
});

describe('trackForAmount', () => {
  it('routes ≤$10k to commercial claims', () => {
    expect(trackForAmount(0)).toBe('commercial');
    expect(trackForAmount(10000)).toBe('commercial');
  });
  it('routes $10k–$50k to civil court', () => {
    expect(trackForAmount(10000.01)).toBe('civil');
    expect(trackForAmount(50000)).toBe('civil');
  });
  it('routes >$50k to supreme court', () => {
    expect(trackForAmount(50000.01)).toBe('supreme');
    expect(trackForAmount(250000)).toBe('supreme');
  });
});

describe('formatMoney', () => {
  it('formats with thousands separators and two decimals', () => {
    expect(formatMoney(4500)).toBe('4,500.00');
    expect(formatMoney(1234567.5)).toBe('1,234,567.50');
  });
});
