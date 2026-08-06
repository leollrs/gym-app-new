import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FILES, expectedCopy, outPath } from '../../../scripts/sync-email-engine.mjs';

/**
 * La reja que impide que el código del navegador y el del enviador se separen.
 *
 * Esto no es celo: ya pasó. Había dos renderizadores escritos por separado y
 * acabaron divergiendo en la maqueta entera, en el separador de sección, en
 * las viñetas, en la sustitución de tokens y en el pie. El editor enseñaba una
 * cosa y al miembro le llegaba otra, y nada lo delataba porque las dos suites
 * estaban en verde.
 *
 * Si este test falla: `node scripts/sync-email-engine.mjs`.
 */
// `fileURLToPath`, no `__dirname`: este archivo es ESM y ahí __dirname no
// existe. Funcionaba solo porque vitest lo inyecta.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('copias de Deno · navegador ↔ enviador', () => {
  it.each(FILES.map((f) => [f.out, f]))('%s is byte-identical to what the generator produces', (_name, file) => {
    expect(fs.readFileSync(outPath(file), 'utf8')).toBe(expectedCopy(file));
  });

  // Si alguien mete un import, deja de ser portable y la copia literal se rompe
  // en Deno sin avisar hasta el despliegue.
  it.each(FILES.map((f) => [f.src, f]))('%s stays dependency-free so the copy can stay literal', (_name, file) => {
    const src = fs.readFileSync(path.join(root, file.src), 'utf8');
    expect(src).not.toMatch(/^\s*import\s/m);
    expect(src).not.toMatch(/\brequire\(/);
    // Nada de DOM: corre en Deno y en Node.
    expect(src).not.toMatch(/\bdocument\.|window\.|localStorage\b/);
  });
});
