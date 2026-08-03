import { describe, it, expect } from 'vitest';
import { titleCaseName } from '../nameCase';

describe('titleCaseName', () => {
  it('does the obvious thing', () => {
    expect(titleCaseName('test')).toBe('Test');
    expect(titleCaseName('leonel llorens')).toBe('Leonel Llorens');
  });

  it('fixes an all-caps paste', () => {
    expect(titleCaseName('JOSÉ RIVERA')).toBe('José Rivera');
  });

  it('keeps Spanish connectives lowercase inside the name', () => {
    // The whole reason this isn't a one-line .replace(): "De Los Angeles" is
    // wrong, and this market is full of these.
    expect(titleCaseName('maria de los angeles rivera')).toBe('Maria de los Angeles Rivera');
    expect(titleCaseName('juan del valle')).toBe('Juan del Valle');
    expect(titleCaseName('ana de la cruz')).toBe('Ana de la Cruz');
  });

  it('still capitalises a connective that STARTS the name', () => {
    expect(titleCaseName('del valle')).toBe('Del Valle');
  });

  it('handles apostrophes and hyphens', () => {
    expect(titleCaseName("o'brien")).toBe("O'Brien");
    expect(titleCaseName('jean-luc')).toBe('Jean-Luc');
    expect(titleCaseName('rivera-santos')).toBe('Rivera-Santos');
  });

  it('handles Mc — but deliberately leaves Mac alone', () => {
    expect(titleCaseName('mcdonald')).toBe('McDonald');
    // A Mac rule would wreck the far commoner Spanish surnames in this market.
    // MacKay is one name; Machado and Macario are everywhere here.
    expect(titleCaseName('machado')).toBe('Machado');
    expect(titleCaseName('macario')).toBe('Macario');
    expect(titleCaseName('mackay')).toBe('Mackay');
    // Someone who wants MacKay types the K, and self-cased words are untouched.
    expect(titleCaseName('MacKay')).toBe('MacKay');
  });

  it('leaves a word the member cased themselves alone', () => {
    // DeLeon, MacKay, van der Berg typed as Van — if they capitalised it, they
    // meant it. We only ever touch a word that is entirely one case.
    expect(titleCaseName('Carlos DeLeon')).toBe('Carlos DeLeon');
    expect(titleCaseName('Ana McDonald-Rivera')).toBe('Ana McDonald-Rivera');
  });

  it('collapses whitespace and survives empties', () => {
    expect(titleCaseName('  juan   rivera  ')).toBe('Juan Rivera');
    expect(titleCaseName('')).toBe('');
    expect(titleCaseName(null)).toBe('');
    expect(titleCaseName(undefined)).toBe('');
    expect(titleCaseName('   ')).toBe('');
  });
});
