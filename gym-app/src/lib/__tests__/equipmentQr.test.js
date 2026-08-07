// El ida y vuelta del QR de las máquinas: lo que se IMPRIME tiene que ser lo que
// se sabe LEER. Es la única pieza del producto que, cuando se rompe, se descubre
// con las pegatinas ya pegadas en la pared de un gimnasio.
import { describe, it, expect } from 'vitest';
import { equipmentQrUrl, PROD_WEB_URL } from '../appUrls';
import { equipmentDeepLink, parseEquipmentSlug, STATIONS } from '../../data/equipmentStations';

const SLUG = 'lat-pulldown';

describe('la URL que se imprime', () => {
  it('cuelga de /invite/, que es el prefijo que iOS y Android YA tienen declarado', () => {
    // Load-bearing: una ruta nueva (/e/…) exigiría AASA nueva, manifest nuevo,
    // release de tienda Y el re-crawl del CDN de Apple, y Android solo
    // re-verifica al instalar o actualizar. Ver equipmentQrUrl.
    expect(equipmentQrUrl(SLUG)).toBe(`${PROD_WEB_URL}/invite/e/${SLUG}`);
  });

  it('es https y no un esquema propio — un esquema propio en la cámara no cae en ningún sitio', () => {
    expect(equipmentQrUrl(SLUG).startsWith('https://')).toBe(true);
    expect(equipmentQrUrl(SLUG)).not.toMatch(/^tugympr:/);
  });

  it('lleva DOS segmentos tras /invite/, para no chocar con /invite/:code', () => {
    const path = equipmentQrUrl(SLUG).replace(PROD_WEB_URL, '');
    expect(path.split('/').filter(Boolean)).toEqual(['invite', 'e', SLUG]);
  });

  it('lo que genera el generador de pegatinas es exactamente eso', () => {
    expect(equipmentDeepLink(SLUG)).toBe(equipmentQrUrl(SLUG));
  });
});

describe('lo que el escáner sabe leer', () => {
  it('lee la pegatina nueva', () => {
    expect(parseEquipmentSlug(equipmentQrUrl(SLUG))).toBe(SLUG);
  });

  it('SIGUE leyendo las pegatinas ya impresas con el esquema viejo', () => {
    // No se reimprime un gimnasio entero porque cambiemos el formato.
    expect(parseEquipmentSlug(`tugympr://equipment/${SLUG}`)).toBe(SLUG);
  });

  it('lee el enlace interno /equipment/<slug>', () => {
    expect(parseEquipmentSlug(`${PROD_WEB_URL}/equipment/${SLUG}`)).toBe(SLUG);
  });

  it('lee un slug pelado', () => {
    expect(parseEquipmentSlug(SLUG)).toBe(SLUG);
  });

  it('devuelve null para lo que no es una estación real', () => {
    expect(parseEquipmentSlug(`${PROD_WEB_URL}/invite/e/no-existe`)).toBeNull();
    expect(parseEquipmentSlug('https://ejemplo.com/cualquier-cosa')).toBeNull();
    expect(parseEquipmentSlug('')).toBeNull();
    expect(parseEquipmentSlug(null)).toBeNull();
  });

  it('no confunde un código de invitación normal con una estación', () => {
    expect(parseEquipmentSlug(`${PROD_WEB_URL}/invite/ABC123`)).toBeNull();
  });

  it('todas las estaciones dan la vuelta completa', () => {
    for (const s of STATIONS) {
      expect(parseEquipmentSlug(equipmentQrUrl(s.slug))).toBe(s.slug);
    }
  });
});
