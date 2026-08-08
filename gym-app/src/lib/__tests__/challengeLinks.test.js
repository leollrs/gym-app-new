import { describe, it, expect } from 'vitest';
import { teamShareUrl, teamFromSearch } from '../challengeLinks';

describe('enlace de equipo', () => {
  it('cuelga de /challenge/:id para reusar el App Link que ya existe', () => {
    const url = teamShareUrl('ch-1', 'team-9');
    expect(url).toMatch(/\/challenge\/ch-1\?team=team-9$/);
  });

  it('se lee de vuelta con los dos ids', () => {
    expect(teamFromSearch('?challenge=ch-1&team=team-9')).toEqual({ challenge: 'ch-1', team: 'team-9' });
  });

  it('sin equipo no hay enlace de equipo, solo de reto', () => {
    expect(teamFromSearch('?challenge=ch-1')).toBeNull();
  });

  it('una query rota no revienta la página', () => {
    expect(teamFromSearch('')).toBeNull();
    expect(teamFromSearch(undefined)).toBeNull();
  });
});
