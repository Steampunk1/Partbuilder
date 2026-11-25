// Independent oracle for ROUND parts (pipe / round tube).  Nothing in this file imports app code:
// every expected number is derived here from the typed inputs and public facts
//   - ASME B36.10M pipe OD / wall table (typed in below from the standard, NOT read from profile-db.js)
//   - plain trig for miters
//   - cylinder / cylinder intersection for saddles
// Conventions (the ones the app documents; the back-test verifies the solid follows them):
//   X along the part, work point of End A at x = 0, work point of End B at x = L.
//   phi = clock angle around the pipe, 0 deg = top (+Y), 90 deg = +Z (3:00 looking in from End A).
export const PI = Math.PI, RAD = PI / 180;
export const DENSITY = 0.2836;                       // lb / in^3 carbon steel (= 3.4032 lb/ft per in^2 / 12)

// ---------------------------------------------------------------- ASME B36.10M
// NPS in size order (an explicit list: object keys that look like integers would be re-ordered by JS)
export const NPS = ['1/2', '3/4', '1', '1 1/4', '1 1/2', '2', '2 1/2', '3', '4', '5', '6', '8', '10', '12', '14', '16', '18', '20', '24'];
const row = (...v) => { if (v.length !== NPS.length) throw new Error('B36.10 row length'); const o = {}; NPS.forEach((n, i) => { o[n] = v[i]; }); return o; };
//                         1/2    3/4    1      1 1/4  1 1/2  2      2 1/2  3      4      5      6      8      10      12      14      16      18      20      24
export const B36_OD = row(0.840, 1.050, 1.315, 1.660, 1.900, 2.375, 2.875, 3.500, 4.500, 5.563, 6.625, 8.625, 10.750, 12.750, 14.000, 16.000, 18.000, 20.000, 24.000);
export const B36_WALL = {
  '10':  row(.083, .083, .109, .109, .109, .109, .120, .120, .120, .134, .134, .148, .165, .180, .250, .250, .250, .250, .250),
  'STD': row(.109, .113, .133, .140, .145, .154, .203, .216, .237, .258, .280, .322, .365, .375, .375, .375, .375, .375, .375),
  '40':  row(.109, .113, .133, .140, .145, .154, .203, .216, .237, .258, .280, .322, .365, .406, .438, .500, .562, .594, .688),
  'XS':  row(.147, .154, .179, .191, .200, .218, .276, .300, .337, .375, .432, .500, .500, .500, .500, .500, .500, .500, .500),
  '80':  row(.147, .154, .179, .191, .200, .218, .276, .300, .337, .375, .432, .500, .594, .688, .750, .844, .938, 1.031, 1.219),
  '160': row(.188, .219, .250, .250, .281, .344, .375, .438, .531, .625, .719, .906, 1.125, 1.312, 1.406, 1.594, 1.781, 1.969, 2.344)
};
export const SCHEDS = ['10', 'STD', '40', 'XS', '80', '160'];

// ---------------------------------------------------------------- typing a number the way a fitter would
const gcd = (a, b) => b ? gcd(b, a % b) : a;
/** x (inches, must sit on a 1/den grid for the fraction styles) -> the string typed into the form. */
export function typed(x, style, den) {
  den = den || 16;
  const neg = x < 0 ? '-' : ''; const ax = Math.abs(x);
  const mixed = (v, sep) => { const n = Math.round(v * den), w = Math.floor(n / den), f = n - w * den; if (!f) return String(w); const g = gcd(f, den); return (w ? w + sep : '') + (f / g) + '/' + (den / g); };
  if (style === 'dec') return neg + String(+ax.toFixed(6));
  if (style === 'dec0') return neg + String(+ax.toFixed(6)).replace(/^0\./, '.');                 // ".120"
  if (style === 'frac') return neg + mixed(ax, ' ');                                              // "36 7/16"
  if (style === 'fracdash') return neg + mixed(ax, '-');                                          // "36-7/16"
  if (style === 'in') return neg + mixed(ax, ' ') + '"';                                          // 36 7/16"
  const ft = Math.floor(Math.round(ax * den) / den / 12 + 1e-9), rem = ax - ft * 12;
  if (style === 'ftin') return neg + ft + "'-" + mixed(rem, ' ');                                 // 3'-0 7/16
  if (style === 'ftinq') return neg + ft + "'-" + mixed(rem, ' ') + '"';                          // 3'-0 7/16"
  if (style === 'ftsp') return neg + ft + "' " + mixed(rem, ' ');                                 // 3' 0 7/16
  throw new Error('typed(): unknown style ' + style);
}

// ---------------------------------------------------------------- section
export function section(od, t) { const ro = od / 2, ri = ro - t; return { od, t, ro, ri, id: 2 * ri, area: PI * (ro * ro - ri * ri) }; }
export function pipeSection(nps, sch) { return section(B36_OD[nps], B36_WALL[sch][nps]); }

// ---------------------------------------------------------------- ends
// Each end is described by its "recess" rho(r, phi): how far INTO the part (measured from that end's
// work point, along the pipe axis) the material starts on the radial line at clock angle phi, radius r.
//   End A:  x_cut = rho_A(r, phi)          End B:  x_cut = L - rho_B(r, phi)
// A negative recess means the material runs past the work point (the long side of a miter).

/** Saddle (fish-mouth), cut SQUARE TO THE PIPE WALL by a rotary laser: one x per clock angle for the whole
 *  wall thickness.  Fit rule: the branch must seat on the header surface of radius Rs without any part of
 *  its wall thickness going inside that surface, so the cut sits where the DEEPEST radius of the wall meets
 *  the header:  S(theta) = max over rho in [ri, ro] of the distance s (along the branch axis, from the header
 *  centreline) at which the line (rho, theta) pierces the header cylinder:
 *      (s sin(al) - rho cos(theta) cos(al))^2 + (rho sin(theta))^2 = Rs^2
 *  Set-on: Rs = header OD / 2.   Set-thru: Rs = header ID / 2 (branch passes the header wall, trimmed to the bore). */
export function saddleFn(sec, sd) {
  const { ri, ro } = sec, al = sd.ang * RAD, sa = Math.sin(al), ca = Math.cos(al);
  const Rs = sd.seat === 'on' ? sd.hod / 2 : sd.hod / 2 - sd.hw;
  const g = (rho, th) => (Math.sqrt(Math.max(0, Rs * Rs - Math.pow(rho * Math.sin(th), 2))) + rho * Math.cos(th) * ca) / sa;
  const S = (phi) => {
    const th = phi - sd.roll * RAD, s = Math.abs(Math.sin(th)), c = Math.cos(th) * ca;
    let rho;
    if (c <= 0) rho = ri;                                   // decreasing in rho: the bore governs
    else if (s < 1e-12) rho = ro;                           // increasing in rho: the OD governs
    else rho = Math.min(ro, Math.max(ri, Rs * c / (s * Math.sqrt(s * s + c * c))));   // stationary point of a concave function
    return g(rho, th);
  };
  return { S, Rs, g, al };
}
/** Header-surface clearance of the radial cut line at (s from the header centreline, clock angle phi):
 *  min over the wall of (distance to header axis) - Rs.  0 = touching, < 0 = wall inside the header surface, > 0 = gap. */
export function saddleGap(sec, sd, s, phi) {
  const al = sd.ang * RAD, th = phi - sd.roll * RAD, Rs = sd.seat === 'on' ? sd.hod / 2 : sd.hod / 2 - sd.hw;
  const a = s * Math.sin(al), b = Math.cos(th) * Math.cos(al), e = Math.sin(th);
  const d = (rho) => Math.hypot(a - rho * b, rho * e);
  const rs = Math.min(sec.ro, Math.max(sec.ri, (b * b + e * e) > 1e-15 ? a * b / (b * b + e * e) : sec.ri));
  return Math.min(d(rs), d(sec.ri), d(sec.ro)) - Rs;
}
function minimise(f, n) {                                // global min of a periodic function on [0, 2pi)
  let best = 1e300, bi = 0; for (let i = 0; i < n; i++) { const v = f(i / n * 2 * PI); if (v < best) { best = v; bi = i; } }
  let lo = (bi - 1) / n * 2 * PI, hi = (bi + 1) / n * 2 * PI; const gr = (Math.sqrt(5) - 1) / 2;
  for (let k = 0; k < 80; k++) { const m1 = hi - gr * (hi - lo), m2 = lo + gr * (hi - lo); if (f(m1) < f(m2)) hi = m2; else lo = m1; }
  const at = (lo + hi) / 2; return { v: Math.min(best, f(at)), at };
}
function mean(f, n) { let s = 0; for (let i = 0; i < n; i++) { const a = i / n * 2 * PI, b = (i + 1) / n * 2 * PI; s += (f(a) + 4 * f((a + b) / 2) + f(b)) / 6; } return s / n; }

/** end = { mode:'sq' } | { mode:'miter', ang, rot } | { mode:'saddle', hod, hw, ang, roll, seat } (degrees, inches) */
const _endCache = new Map();
export function endModel(end, sec) {
  const key = JSON.stringify([end && end.mode, end && end.ang, end && end.rot, end && end.hod, end && end.hw, end && end.roll, end && end.seat, sec.od, sec.t]);
  if (!_endCache.has(key)) _endCache.set(key, endModel0(end, sec));
  return _endCache.get(key);
}
function endModel0(end, sec) {
  // ext  = how far the long point runs PAST the work point (negative: the end stops short of it)
  // full = recess of the deepest point of the cut (a complete ring of material starts there)
  // mid  = area-mean recess over the wall (for the volume)
  if (!end || end.mode === 'sq') return { mode: 'sq', rho: () => 0, ext: 0, mid: 0, full: 0 };
  if (end.mode === 'miter') {
    // flat plane through the work point on the pipe axis, tilted `ang` from square; for a positive angle the
    // LONG point is at clock position `rot`:  recess = -tan(ang) * r * cos(phi - rot)
    const tm = Math.tan(end.ang * RAD), rot = end.rot * RAD;
    return { mode: 'miter', tm, rot, rho: (r, phi) => -tm * r * Math.cos(phi - rot), ext: Math.abs(tm) * sec.ro, mid: 0, full: Math.abs(tm) * sec.ro, longAt: tm >= 0 ? end.rot : end.rot + 180 };
  }
  const sf = saddleFn(sec, end), mn = minimise(sf.S, 3600), mx = minimise((p) => -sf.S(p), 3600);
  return { mode: 'saddle', sd: end, sf, rho: (r, phi) => sf.S(phi), ext: -mn.v, mid: mean(sf.S, 3600), full: -mx.v, longAt: mn.at / RAD, Rs: sf.Rs,
    fits: end.seat === 'on' ? sec.od <= end.hod + 1e-12 : sec.od <= end.hod - 2 * end.hw + 1e-12 };
}

// ---------------------------------------------------------------- holes
/** Volume removed from the pipe wall by a tool of half-width rx along the pipe and ry across it, drilled
 *  along a radius from the pipe axis outward (one wall only). */
export function holeVolume(sec, rx, ry) {
  const { ro, ri } = sec, n = 1500; let v = 0;
  const f = (th) => { const w = ry * Math.sin(th); return 2 * rx * Math.cos(th) * (Math.sqrt(Math.max(0, ro * ro - w * w)) - Math.sqrt(Math.max(0, ri * ri - w * w))) * ry * Math.cos(th); };
  for (let i = 0; i < n; i++) { const a = -PI / 2 + i / n * PI, b = -PI / 2 + (i + 1) / n * PI; v += (f(a) + 4 * f((a + b) / 2) + f(b)) / 6 * (b - a); }
  return v;
}

/** The whole part.  spec = { od, t, lenMode:'oal'|'wp', len, A, B, holes:[group...], matF }
 *  group = { type:'cust'|'olet'|'stub', dia (cust) | bnps,bsch (olet/stub), ref:'A'|'B', both, x0, pitch, n, xs:[...]|null, az0, azn, azp } */
export function expectedPart(spec) {
  const sec = section(spec.od, spec.t), A = endModel(spec.A, sec), B = endModel(spec.B, sec);
  // overall (long point to long point) = work-point length + what each end adds past its work point
  const L = spec.lenMode === 'oal' ? spec.len - A.ext - B.ext : spec.len, OAL = L + A.ext + B.ext;
  const xA = (r, phi) => A.rho(r, phi), xB = (r, phi) => L - B.rho(r, phi);
  const xA0 = -A.ext, xB1 = L + B.ext;                                  // long points
  const xAfull = A.full, xBfull = L - B.full;                           // a full ring of material between these
  // shortest generator of the part (short point); <= 0 means the two cuts cross
  // SP = shortest line of material anywhere in the wall; SPod = the short point as measured on the outside
  let SP = 1e300, SPod = 1e300; for (let i = 0; i < 720; i++) { const p = i / 720 * 2 * PI, o = xB(sec.ro, p) - xA(sec.ro, p); SPod = Math.min(SPod, o); SP = Math.min(SP, o, xB(sec.ri, p) - xA(sec.ri, p)); }
  const out = { sec, A, B, L, OAL, xA, xB, xA0, xB1, xAfull, xBfull, SP, SPod, wrap: PI * sec.od, holes: [], reasons: [] };
  if (!(spec.len > 0)) out.reasons.push('length not positive');
  if (!(L > 0)) out.reasons.push('overall length shorter than the end cuts take');
  if (SP <= 0) out.reasons.push('end cuts cross');
  for (const [E, nm] of [[A, 'A'], [B, 'B']]) if (E.mode === 'saddle' && !E.fits) out.reasons.push('End ' + nm + ': branch does not fit its header');
  // ---- holes
  const d0 = spec.lenMode === 'oal' ? xA0 : 0, d1 = spec.lenMode === 'oal' ? xB1 : L;     // where "from End A / End B" starts
  for (const [gi, g] of (spec.holes || []).entries()) {
    const dia = g.type === 'cust' ? g.dia : g.type === 'stub' ? B36_OD[g.bnps] : B36_OD[g.bnps] - 2 * B36_WALL[g.bsch][g.bnps];
    let xs = [];
    if (g.xs && g.xs.length) xs = g.xs.map(d => g.ref === 'A' ? d0 + d : d1 - d);
    else { for (let i = 0; i < g.n; i++) xs.push(g.ref === 'A' ? d0 + g.x0 + i * g.pitch : d1 - g.x0 - i * g.pitch);
      if (g.both) for (const x of xs.slice()) { const m = d0 + d1 - x; if (!xs.some(v => Math.abs(v - m) < 1 / 32)) xs.push(m); } }
    for (const x of xs) for (let j = 0; j < g.azn; j++) {
      const az = (((g.az0 + j * g.azp) % 360) + 360) % 360, rad = dia / 2;
      const rho = g.type === 'stub' ? sec.ri : sec.ro;               // radius the diameter is held at
      const h = { grp: gi + 1, type: g.type, x, az, dia, rad, rx: rad, ry: g.type === 'stub' ? rad * sec.ro / sec.ri : rad, wide: g.type === 'stub' ? sec.ro / sec.ri : 1, ref: g.ref, why: [] };
      h.tooBig = rad >= rho - 1e-9;
      if (h.tooBig) { h.why.push('as wide as the pipe'); out.holes.push(h); continue; }
      h.half = Math.asin(rad / rho);                                 // angular half-width of the OUTER edge
      h.u = out.wrap * (((az + 180) % 360) / 360); h.uh = sec.ro * h.half;
      const fromSeam = Math.abs(((az - 180 + 540) % 360) - 180) * RAD;   // angular distance from 180 deg (bottom seam)
      h.seamClear = (fromSeam - h.half) * sec.ro;
      if (h.seamClear < -1e-9) h.why.push('crosses the 180 deg seam');
      // clearance to the end cuts: along the hole's outer AND inner edge (true), and at its centre line only
      let cmin = 1e300;
      for (const r of [sec.ro, sec.ri]) for (let k = 0; k < 240; k++) { const ps = k / 240 * 2 * PI, w = h.ry * Math.sin(ps); if (Math.abs(w) >= r) continue; const p = az * RAD + Math.asin(w / r), xe = x + h.rx * Math.cos(ps); cmin = Math.min(cmin, xe - xA(r, p), xB(r, p) - xe); }
      h.endClear = cmin; h.endClearCentre = Math.min(x - rad - xA(sec.ro, az * RAD), xB(sec.ro, az * RAD) - x - rad);
      if (cmin < -1e-9) h.why.push('runs off / breaks through an end cut');
      h.vol = holeVolume(sec, h.rx, h.ry);
      out.holes.push(h);
    }
  }
  for (let i = 0; i < out.holes.length; i++) for (let j = i + 1; j < out.holes.length; j++) { const a = out.holes[i], b = out.holes[j]; if (a.tooBig || b.tooBig) continue;
    const dphi = Math.abs(((a.az - b.az + 540) % 360) - 180) * RAD; if (Math.abs(a.x - b.x) < a.rx + b.rx + .02 && dphi < Math.asin(Math.min(1, a.ry / sec.ro)) + Math.asin(Math.min(1, b.ry / sec.ro)) + .02 / sec.ro) { a.overlap = b.overlap = true; } }
  out.holeMustBlock = out.holes.some(h => h.why.length > 0);
  out.mustBlock = out.reasons.length > 0 || out.holeMustBlock;
  // a block the app is entitled to by its own stated margin rule (0.1 in of land at the hole's centre line)
  out.mayBlock = out.mustBlock || out.holes.some(h => !h.tooBig && h.endClearCentre < 0.1 + 1e-6);
  // ---- volume / weight
  out.volBody = sec.area * (L - A.mid - B.mid);                         // miters cut through the axis: no net change
  out.volHoles = out.holes.reduce((s, h) => s + (h.vol || 0), 0);
  out.volExact = !out.holes.some(h => h.overlap || h.why.length || h.endClear < 0.005);
  out.vol = out.volBody - out.volHoles;
  out.wtRule = sec.area * L * DENSITY * (spec.matF || 1);               // what the app documents: area x work-point length
  return out;
}
/** Is the point (x, r, phi) solid material of the expected part? margin > 0 shrinks the material (safe zone). */
export function isMaterial(ex, x, r, phi, margin) {
  const m = margin || 0, { sec } = ex;
  if (r > sec.ro - m || r < sec.ri + m) return false;
  if (x < ex.xA(r, phi) + m || x > ex.xB(r, phi) - m) return false;
  for (const h of ex.holes) { if (h.tooBig) continue; const d = ((phi / RAD - h.az + 540) % 360) - 180; if (Math.abs(d) >= 90) continue; const w = r * Math.sin(d * RAD), dx = x - h.x; if ((dx * dx) / ((h.rx + m) ** 2) + (w * w) / ((h.ry + m) ** 2) < 1) return false; }
  return true;
}
/** Is the point clear of every hole by at least `margin` (used to keep probes away from openings)? */
export function clearOfHoles(ex, x, r, phi, margin) {
  for (const h of ex.holes) { if (h.tooBig) continue; const d = ((phi / RAD - h.az + 540) % 360) - 180; if (Math.abs(d) >= 90) continue; const w = r * Math.sin(d * RAD), dx = x - h.x; if ((dx * dx) / ((h.rx + margin) ** 2) + (w * w) / ((h.ry + margin) ** 2) < 1) return false; }
  return true;
}
export function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
