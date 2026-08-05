import { describe, it, expect } from 'vitest';
import { confirmWordFor, matchesConfirmWord } from '../admin/confirmWord';

describe('confirmWordFor', () => {
  it('asks in the admin language', () => {
    expect(confirmWordFor('es')).toBe('ELIMINAR');
    expect(confirmWordFor('es-PR')).toBe('ELIMINAR');
    expect(confirmWordFor('en')).toBe('DELETE');
    expect(confirmWordFor('en-US')).toBe('DELETE');
    expect(confirmWordFor(undefined)).toBe('DELETE');
  });
});

describe('matchesConfirmWord', () => {
  // THE REGRESSION. MemberDetail compared against the literal 'DELETE' while the
  // Spanish modal asked for ELIMINAR — so it refused the exact word it had just
  // requested and a Spanish admin could not delete a member at all.
  it('accepts the word the Spanish prompt actually asks for', () => {
    expect(matchesConfirmWord('ELIMINAR')).toBe(true);
    expect(matchesConfirmWord(confirmWordFor('es'))).toBe(true);
  });

  it('still accepts the English word in either locale', () => {
    expect(matchesConfirmWord('DELETE')).toBe(true);
    expect(matchesConfirmWord(confirmWordFor('en'))).toBe(true);
  });

  it('forgives case and stray whitespace, not content', () => {
    expect(matchesConfirmWord('  eliminar ')).toBe(true);
    expect(matchesConfirmWord('Delete')).toBe(true);
    expect(matchesConfirmWord('borrar')).toBe(false);
    expect(matchesConfirmWord('DELET')).toBe(false);
    expect(matchesConfirmWord('DELETE ME')).toBe(false);
  });

  it('never unlocks on empty input — the gate has to gate', () => {
    expect(matchesConfirmWord('')).toBe(false);
    expect(matchesConfirmWord('   ')).toBe(false);
    expect(matchesConfirmWord(null)).toBe(false);
    expect(matchesConfirmWord(undefined)).toBe(false);
  });
});
