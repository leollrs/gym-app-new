import { describe, it, expect } from 'vitest';
import { suggestEmailCorrection } from '../validateEmail';

describe('suggestEmailCorrection', () => {
  it('catches common provider domain typos', () => {
    expect(suggestEmailCorrection('juan@gmial.com')).toBe('juan@gmail.com');
    expect(suggestEmailCorrection('juan@gmai.com')).toBe('juan@gmail.com');
    expect(suggestEmailCorrection('maria@hotnail.com')).toBe('maria@hotmail.com');
    expect(suggestEmailCorrection('ana@yaho.com')).toBe('ana@yahoo.com');
    expect(suggestEmailCorrection('pedro@outlok.com')).toBe('pedro@outlook.com');
  });

  it('catches TLD fat-fingers', () => {
    expect(suggestEmailCorrection('juan@gmail.con')).toBe('juan@gmail.com');
    expect(suggestEmailCorrection('juan@gmail.cmo')).toBe('juan@gmail.com');
    expect(suggestEmailCorrection('juan@hotmail.om')).toBe('juan@hotmail.com');
  });

  it('does NOT suggest for valid known providers', () => {
    expect(suggestEmailCorrection('juan@gmail.com')).toBeNull();
    expect(suggestEmailCorrection('juan@ymail.com')).toBeNull();   // real Yahoo domain
    expect(suggestEmailCorrection('juan@me.com')).toBeNull();      // real Apple domain
    expect(suggestEmailCorrection('juan@mail.com')).toBeNull();    // real provider
    expect(suggestEmailCorrection('juan@outlook.es')).toBeNull();
  });

  it('does NOT mangle legit custom / corporate domains', () => {
    expect(suggestEmailCorrection('juan@acme.dev')).toBeNull();
    expect(suggestEmailCorrection('juan@tugympr.com')).toBeNull();
    expect(suggestEmailCorrection('juan@mail.acme.co.uk')).toBeNull(); // subdomain — untouched
    expect(suggestEmailCorrection('juan@startup.io')).toBeNull();
  });

  it('handles junk input safely', () => {
    expect(suggestEmailCorrection('')).toBeNull();
    expect(suggestEmailCorrection(null)).toBeNull();
    expect(suggestEmailCorrection('not-an-email')).toBeNull();
    expect(suggestEmailCorrection('juan@')).toBeNull();
    expect(suggestEmailCorrection('@gmail.com')).toBeNull();
  });
});
