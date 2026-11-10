// Headless STEP: build the same meshes the 3D view hands to the STEP writer.
import * as THREE from '../vendor/three/three.module.js';
export function stepOf(c) {
  const r = c.calc(); c._T = THREE;
  if (r.kind === 'round' || r.kind === 'box') { const s = c.shellSolid(r); c._export = { type: 'shell', pos: s.pos, idx: s.idx, name: 'BODY', c: r }; }
  else { const plates = []; for (const df of c.plateDefs(r, 28)) { const m = c.slabMesh(df.out, df.hl, df.th, df.map); if (m) plates.push({ name: df.name, pos: m.pos, idx: m.idx }); } c._export = { type: 'plates', plates, c: r }; }
  return c._stepText();
}
