// Independent oracle for test/bt-box.mjs  (square/rect tube + angle back-test).
//
// Nothing in this file imports the app, its section tables or the CAD kernel.
// Every expected number is worked out here from the text a user types into the
// form and from plain geometry, so the back-test is not circular.
//
// Conventions the oracle assumes (each one is CONFIRMED against the exported
// solid by the runner, not taken from the app's code):
//   axes      X along the part, End A at low X.  Y up, Z to the right seen from End A.
//   tube      "tall x wide" = H (Y) x B (Z), centred on the X axis.  Faces: T +Y, B -Y, R +Z, L -Z.
//   angle     "up x across" = a (Y) x b (Z), heel (outside corner) on the X axis, legs toward +Y and +Z.
//   end cut   a flat plane.  "Angle seen from the side" tv tilts it about Z, "seen from above" tp about Y:
//               End A:  x = XA - y*tan(tv) - z*tan(tp)      End B:  x = XB + y*tan(tv) + z*tan(tp)
//             so a positive angle puts the long point on the +Y / +Z side at both ends.
//   work pt   XA, XB = where each plane crosses the X axis (tube centreline / angle heel line).
//   length    lenMode 'wp'  : typed length = XB - XA.
//             lenMode 'oal' : typed length = overall, long point to long point (the true tips of the solid).
//   holes     distance along from the reference end.  'oal': from that end's long point.  'wp': from its work point.
//             tube: offset from the face centreline, T/B + toward R (+Z), L/R + up (+Y).
//             angle: gauge from the heel.  Each hole goes through ONE wall / one leg.
// The oracle frame puts the long point of End A at x = 0.

export const PI = Math.PI;
export const STEEL = 490 / 1728;                 // lb / in^3 (490 lb/ft^3)

// ---------------------------------------------------------------- numbers as typed
function inches(r) {
  let m;
  if ((m = r.match(/^(\d+)\/(\d+)$/))) return +m[2] ? +m[1] / +m[2] : null;
  if ((m = r.match(/^(\d+)[ -]+(\d+)\/(\d+)$/))) return +m[3] ? +m[1] + +m[2] / +m[3] : null;
  if (/^(\d+\.?\d*|\.\d+)$/.test(r)) return parseFloat(r);
  return null;
}
/** A shop dimension as typed -> inches, or null when it cannot be read: 3/16, 1 1/2, 1-1/2, .375, 37.413, 12'-6 3/8, 40', 6". */
export function num(s) {
  if (s == null) return null;
  let t = String(s).replace(/[″"]/g, '').replace(/′/g, "'").trim();
  if (!t) return null;
  let sign = 1;
  if (t[0] === '-') { sign = -1; t = t.slice(1).trim(); }
  const q = t.indexOf("'");
  if (q < 0) { const v = inches(t); return v == null ? null : sign * v; }
  const f = t.slice(0, q).trim();
  if (!/^(\d+\.?\d*|\.\d+)$/.test(f)) return null;
  const rest = t.slice(q + 1).replace(/^[\s-]+/, '').trim();
  const v = rest ? inches(rest) : 0;
  return v == null ? null : sign * (parseFloat(f) * 12 + v);
}
/** Degrees as typed in a number box ('' = 0). */
export function deg(s) { const t = String(s == null ? '' : s).trim(); if (!t) return 0; return /^[-+]?(\d+\.?\d*|\.\d+)$/.test(t) ? parseFloat(t) : null; }
/** Whole count as typed in a number box. */
export function count(s) { const t = String(s == null ? '' : s).trim(); return /^\d+$/.test(t) ? parseInt(t, 10) : null; }
/** inches -> "2 7/16" (x must sit on the 1/den grid). */
export function fr(x, den = 16) {
  const neg = x < 0 ? '-' : ''; let n = Math.round(Math.abs(x) * den), d = den; const w = Math.floor(n / d); n -= w * d;
  if (!n) return neg + String(w);
  while (n % 2 === 0) { n /= 2; d /= 2; }
  return neg + (w ? w + ' ' : '') + n + '/' + d;
}
/** inches -> 12'-6 3/8 */
export function ftin(x, den = 16) { const n = Math.round(x * den), ft = Math.floor(n / (12 * den)); return ft + "'-" + fr((n - ft * 12 * den) / den, den); }

// ---------------------------------------------------------------- sections as labelled
export function hssNominal(p) { const [H, B] = String(p.hsize).split(/x/i).map(num); return { fam: 'hss', H, B: B == null ? H : B, t: num(p.hwallT) }; }
export function angNominal(p) { const [a, b] = String(p.asize).split(/x/i).map(num); return { fam: 'angl', a, b: b == null ? a : b, t: num(p.athkT) }; }
export const nominal = (fam, p) => fam === 'hss' ? hssNominal(p) : angNominal(p);
/** Tube area with outside corner radius rc and inside radius ri. */
export const hssArea = (S, rc, ri) => (S.H * S.B - (4 - PI) * rc * rc) - ((S.H - 2 * S.t) * (S.B - 2 * S.t) - (4 - PI) * ri * ri);
/** Book weight basis: ASTM A500 / AISC nominal wall, outside corner radius 2t, inside t. */
export const hssBookArea = (S) => hssArea(S, 2 * S.t, S.t);
export const angArea = (S, rr) => S.t * (S.a + S.b - S.t) + (1 - PI / 4) * (rr || 0) ** 2;

// AISC 360-16 Table J3.3 - nominal hole sizes: [standard, oversize, short-slot length, long-slot length]; slot width = standard.
export const J33 = { '1/2': [9 / 16, 5 / 8, 11 / 16, 1.25], '5/8': [11 / 16, 13 / 16, 7 / 8, 1.5625], '3/4': [13 / 16, 15 / 16, 1, 1.875], '7/8': [15 / 16, 17 / 16, 1.125, 2.1875], '1': [1.125, 1.25, 1.3125, 2.5], '1 1/8': [1.25, 1.4375, 1.5, 2.8125], '1 1/4': [1.375, 1.5625, 1.625, 3.125] };
// AISC Manual Table 1-7A - workable gage in an angle leg, by leg size.
export const ANGLE_GAGE = { 8: 4.5, 7: 4, 6: 3.5, 5: 3, 4: 2.5, 3.5: 2, 3: 1.75, 2.5: 1.375, 2: 1.125, 1.75: 1, 1.5: .875, 1.375: .875, 1.25: .75, 1: .625 };

// ---------------------------------------------------------------- end planes
/** Highest value of y*tv + z*tp anywhere on the section (how far the long point runs past the work point). */
export function sup(S, tv, tp, rc) {
  if (S.fam === 'hss') return (S.H / 2 - rc) * Math.abs(tv) + (S.B / 2 - rc) * Math.abs(tp) + rc * Math.hypot(tv, tp);
  let m = -1e18; for (const [y, z] of [[0, 0], [0, S.b], [S.t, S.b], [S.a, S.t], [S.a, 0]]) m = Math.max(m, y * tv + z * tp);
  return m;
}
export function endOf(e) {
  if (!e || e.mode !== 'ang') return { sq: true, dv: 0, dp: 0, tv: 0, tp: 0, ok: true };
  const dv = deg(e.tvT), dp = deg(e.tpT), ok = dv != null && dp != null && Math.abs(dv) < 90 && Math.abs(dp) < 90;
  return { sq: !dv && !dp, dv, dp, tv: ok ? Math.tan(dv * PI / 180) : 0, tp: ok ? Math.tan(dp * PI / 180) : 0, ok };
}
/** Everything about the length of the part.  rc = tube outside corner radius (ignored for angle). */
export function frame(S, p, rc) {
  const A = endOf(p.ends && p.ends.A), B = endOf(p.ends && p.ends.B);
  const supA = sup(S, A.tv, A.tp, rc), supB = sup(S, B.tv, B.tp, rc), Lt = num(p.lenT), oal = p.lenMode === 'oal';
  const Lwp = Lt == null ? null : oal ? Lt - supA - supB : Lt;
  const F = { A, B, supA, supB, Lt, oal, Lwp, readable: Lt != null && Lt > 0 && A.ok && B.ok };
  if (!F.readable) return F;
  F.OAL = Lwp + supA + supB; F.XA = supA; F.XB = supA + Lwp;
  F.minChord = Lwp - sup(S, -(A.tv + B.tv), -(A.tp + B.tp), rc);      // shortest fibre of the piece
  F.dA = oal ? 0 : F.XA; F.dB = oal ? F.OAL : F.XB;                    // where hole distances start at each end
  F.xA = (y, z) => F.XA - (y * A.tv + z * A.tp);
  F.xB = (y, z) => F.XB + (y * B.tv + z * B.tp);
  return F;
}

// ---------------------------------------------------------------- holes
/** Point on a face: c = across coordinate, depth = how far in from the outside surface. */
export function facePoint(S, face, x, c, depth) {
  if (face === 'T') return [x, S.H / 2 - depth, c];
  if (face === 'B') return [x, -S.H / 2 + depth, c];
  if (face === 'R') return [x, c, S.B / 2 - depth];
  if (face === 'L') return [x, c, -S.B / 2 + depth];
  if (face === 'vleg') return [x, c, depth];
  return [x, depth, c];                                  // hleg
}
/** Outline of a hole on its face as [dx, dc] offsets from the centre. */
export function footprint(h, n = 48) {
  const o = [], r = h.r, s = h.slotL ? (h.slotL - 2 * r) / 2 : 0;
  for (let i = 0; i < n; i++) { const a = i / n * 2 * PI, u = r * Math.cos(a) + (Math.cos(a) >= 0 ? s : -s), v = r * Math.sin(a); o.push(h.slotL && !h.along ? [v, u] : [u, v]); }
  return o;
}
/** The holes a user asked for.  Returns { holes, bad: [reasons a typed value could not be read] }. */
export function holesOf(S, F, p) {
  const out = { holes: [], bad: [] };
  if (!p.wantHoles) return out;
  const faces = S.fam === 'hss' ? ['T', 'B', 'L', 'R'] : ['vleg', 'hleg'];
  for (const g of p.groups || []) {
    const bad = (m) => out.bad.push('hole ' + g.id + ': ' + m);
    if (!faces.includes(g.face)) { bad('face "' + g.face + '"'); continue; }
    let d = null, slotL = 0;
    if (S.fam === 'hss') {
      d = num(g.diaT);
      if (g.type === 'slot') { slotL = num(g.sllT); if (!(slotL > 0)) { bad('slot length "' + g.sllT + '"'); continue; } }
      else if (g.type !== 'cust') { bad('type "' + g.type + '"'); continue; }
    } else if (g.type === 'cust') d = num(g.diaT);
    else { const b = J33[g.bolt]; if (!b) { bad('bolt "' + g.bolt + '"'); continue; } if (g.type === 'std') d = b[0]; else if (g.type === 'ovs') d = b[1]; else if (g.type === 'ssl') { d = b[0]; slotL = b[2]; } else if (g.type === 'lsl') { d = b[0]; slotL = b[3]; } else { bad('type "' + g.type + '"'); continue; } }
    if (!(d > 0)) { bad('hole size "' + g.diaT + '"'); continue; }
    if (slotL && slotL < d - 1e-9) { bad('slot length ' + slotL + ' is shorter than its width ' + d); continue; }
    if (slotL && slotL <= d + 1e-9) slotL = 0;             // as long as it is wide = a round hole
    const c = S.fam === 'hss' ? num(g.offT) : num(g.gT);
    if (c == null) { bad((S.fam === 'hss' ? 'offset "' + g.offT : 'gauge "' + g.gT) + '"'); continue; }
    // stations along the part, as distances from the reference end
    const ds = [], list = String(g.xsT || '').trim();
    let both = false;
    if (list) {
      let okList = true;
      for (const tok of list.split(/[,;]/).map(s => s.trim()).filter(Boolean)) { const v = num(tok); if (v == null) { bad('exact spot "' + tok + '"'); okList = false; } else ds.push(v); }
      if (!okList) continue;
    } else {
      const x0 = num(g.x0T), n = count(g.nT), sp = num(g.pT);
      if (x0 == null) { bad('first hole "' + g.x0T + '"'); continue; }
      if (!(n >= 1)) { bad('how many "' + g.nT + '"'); continue; }
      if (n > 1 && sp == null) { bad('spacing "' + g.pT + '"'); continue; }
      for (let i = 0; i < n; i++) ds.push(x0 + i * (sp || 0));
      both = !!g.both;
    }
    if (g.refEnd !== 'A' && g.refEnd !== 'B') { bad('reference end "' + g.refEnd + '"'); continue; }
    const xs = ds.map(v => ({ x: g.refEnd === 'A' ? F.dA + v : F.dB - v, ref: g.refEnd, dist: v }));
    // "both ends": the same distances again from the other end; a pair landing on one spot is one hole
    if (both) for (const q of xs.slice()) { const m = F.dA + F.dB - q.x; if (!xs.some(o => Math.abs(o.x - m) < 1 / 32)) xs.push({ x: m, ref: q.ref === 'A' ? 'B' : 'A', dist: q.dist }); }
    const along = g.ax !== 'y', r = d / 2;
    for (const q of xs) out.holes.push({ g: g.id, face: g.face, x: q.x, ref: q.ref, dist: q.dist, c, d, r, slotL, along, hx: slotL && along ? slotL / 2 : r, hc: slotL && !along ? slotL / 2 : r });
  }
  return out;
}
/** How much room a hole has (inches, negative = off the material): to the end cuts, to the edge of the flat, to the tube seam. */
export function clearance(S, F, h, M) {
  let end = 1e9;
  for (const [dx, dc] of footprint(h)) for (const depth of [0, S.t]) { const q = facePoint(S, h.face, h.x + dx, h.c + dc, depth); end = Math.min(end, q[0] - F.xA(q[1], q[2]), F.xB(q[1], q[2]) - q[0]); }
  // edge: room to the end of the flat (tube: start of the corner radius; angle: the toe).  fillet / inner (angle): room to the
  // root fillet / to the other leg's thickness.  seam (tube bottom face): room to the face centreline.
  let edge, fillet = 1e9, inner = 1e9, seam = 1e9;
  if (S.fam === 'hss') { const W = h.face === 'T' || h.face === 'B' ? S.B : S.H; edge = W / 2 - M.rc - (Math.abs(h.c) + h.hc); if (h.face === 'B') seam = Math.abs(h.c) - h.hc; }
  else { const leg = h.face === 'vleg' ? S.a : S.b; edge = leg - (h.c + h.hc); inner = (h.c - h.hc) - S.t; fillet = inner - M.rr; }
  return { end, edge, fillet, inner, seam };
}
/** Where a tube hole lands on the flat wrap drawing: arc length from the bottom-face centreline, going up the LEFT side first. */
export function wrapU(S, rc, face, c) {
  const fw = S.B - 2 * rc, fh = S.H - 2 * rc, qa = PI * rc / 2, Pm = 2 * fw + 2 * fh + 4 * qa;
  if (face === 'B') return c <= 0 ? -c : Pm - c;
  if (face === 'L') return fw / 2 + qa + fh / 2 + c;
  if (face === 'T') return Pm / 2 + c;
  return Pm / 2 + fw / 2 + qa + fh / 2 - c;
}
export const wrapLen = (S, rc) => 2 * (S.B - 2 * rc) + 2 * (S.H - 2 * rc) + 2 * PI * rc;

// ---------------------------------------------------------------- IGES header (own reader)
/** Global-section fields of an IGES file (Hollerith strings decoded). */
export function igesGlobal(text) {
  const g = text.split(/\r?\n/).filter(l => l[72] === 'G').map(l => l.slice(0, 72)).join('');
  const out = []; let i = 0, pd = ',', rd = ';';
  const field = () => {
    const m = g.slice(i).match(/^\s*(\d+)H/);
    if (m) { const st = i + m[0].length, v = g.substr(st, +m[1]); i = st + +m[1]; while (i < g.length && g[i] !== pd && g[i] !== rd) i++; return v; }
    let j = i; while (j < g.length && g[j] !== pd && g[j] !== rd) j++; const v = g.slice(i, j).trim(); i = j; return v;
  };
  for (let k = 0; k < 40 && i < g.length; k++) { const v = field(); out.push(v); if (k === 0 && v.length === 1) pd = v; if (k === 1 && v.length === 1) rd = v; if (g[i] === rd) break; i++; }
  return { fields: out, scale: parseFloat(out[12]), unitFlag: parseInt(out[13], 10), unitName: out[14], maxCoord: parseFloat(out[19]) };
}

// ---------------------------------------------------------------- seeded random numbers
export function rng(seed) { let a = seed >>> 0; const f = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; f.int = (n) => Math.floor(f() * n); f.pick = (arr) => arr[f.int(arr.length)]; f.range = (lo, hi) => lo + (hi - lo) * f(); f.chance = (p) => f() < p; return f; }
