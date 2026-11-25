// Measurement kit for the beam / channel back-test (bt-plate.mjs).
// Nothing in here calls the app's geometry: it measures a kernel shape (the
// IGES read back from the file) with straight rays, sews the loose IGES faces
// back into a closed solid, counts through-holes topologically, and reads the
// IGES global section and the flat DXF with its own parsers.
import { kit } from '../occ-solid.js';

export const MM = 25.4;

/** Ray caster over a shape. scale = 25.4 for a shape read back from IGES (the kernel reads inches as mm). */
export function rayer(K, shape, scale) {
  const oc = K.oc, si = new oc.IntCurvesFace_ShapeIntersector();
  si.Load(shape, 1e-7 * scale);
  const cast = (p, d) => {
    const lin = K.mk('gp_Lin', K.pnt(p[0] * scale, p[1] * scale, p[2] * scale), K.dir(d[0], d[1], d[2]));
    K.call(si, 'Perform', lin, -1e7, 1e7);
    const n = si.NbPnt(), raw = [];
    for (let i = 1; i <= n; i++) raw.push(si.WParameter(i) / scale);
    raw.sort((a, b) => a - b);
    const out = [];
    for (const v of raw) if (!out.length || v - out[out.length - 1] > 2e-6) out.push(v);
    return out;
  };
  /** Hits along +axis (0 = X, 1 = Y, 2 = Z) through the point q (the coordinate on that axis is ignored).
   *  Returns absolute coordinates on that axis. A ray that grazes an edge can return an odd count: the
   *  caller gets { hits, odd } and decides. */
  const axis = (ax, q) => {
    const p = q.slice(); p[ax] = -5000; const d = [0, 0, 0]; d[ax] = 1;
    const h = cast(p, d).map(v => v - 5000);
    return h;
  };
  /** Inside test by parity along a skew ray (no face of these parts is parallel to it). */
  const inside = (q) => { const h = cast(q, [0.5377, 0.4691, 0.7006]); return h.filter(v => v > 1e-7).length % 2 === 1; };
  return { cast, axis, inside };
}

/** Sew the loose trimmed surfaces of an IGES read-back into a shell and make a solid of it. tolMm in mm. */
export function sewSolid(K, shape, tolMm) {
  const oc = K.oc, sw = K.mk('BRepBuilderAPI_Sewing', tolMm, true, true, true, false);
  K.call(sw, 'Add', shape);
  K.call(sw, 'Perform', new oc.Handle_Message_ProgressIndicator_1());
  const sh = sw.SewedShape();
  const out = { free: sw.NbFreeEdges(), multi: sw.NbMultipleEdges(), shells: K.count(sh, 'TopAbs_SHELL'), faces: K.count(sh, 'TopAbs_FACE'), solid: null, valid: false, sewn: sh };
  if (out.shells === 1 && out.free === 0) {
    const ex = K.mk('TopExp_Explorer', sh, oc.TopAbs_ShapeEnum.TopAbs_SHELL, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    const shell = K.stat('TopoDS', 'Shell', ex.Current());
    out.solid = K.mk('BRepBuilderAPI_MakeSolid', shell).Solid();
    out.valid = K.valid(out.solid);
    out.solids = K.count(out.solid, 'TopAbs_SOLID');
    out.volume = volumeExact(K, out.solid);
  }
  return out;
}

/** Volume by adaptive integration. The kernel's default (fixed-order) integration is off by a few parts in 10^4 on
 *  NURBS faces - enough to look like a missing hole - so the before / after comparison uses this one on both sides. */
export function volumeExact(K, shape) { const g = new K.oc.GProp_GProps_1(); K.oc.BRepGProp.VolumeProperties_2(shape, g, 1e-8, false, false); return g.Mass(); }

/** Count of distinct sub-shapes (the explorer alone counts a shared edge once per face). */
function uniq(K, shape, what) {
  const oc = K.oc, ex = K.mk('TopExp_Explorer', shape, oc.TopAbs_ShapeEnum[what], oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  const buckets = new Map(); let n = 0;
  for (; ex.More(); ex.Next()) { const s = ex.Current(), h = s.HashCode(1000000007); let b = buckets.get(h); if (!b) { b = []; buckets.set(h, b); } if (!b.some(q => q.IsSame(s))) { b.push(s); n++; } }
  return n;
}
/** Through-holes of a closed solid from the Euler-Poincare formula: V - E + F - (W - F) = 2 (S - G). */
export function genus(K, shape) {
  const V = uniq(K, shape, 'TopAbs_VERTEX'), E = uniq(K, shape, 'TopAbs_EDGE'), F = uniq(K, shape, 'TopAbs_FACE'), W = uniq(K, shape, 'TopAbs_WIRE'), S = uniq(K, shape, 'TopAbs_SHELL');
  return S - (V - E + F - (W - F)) / 2;
}

/** IGES global section -> array of parameters (1-based index = IGES field number). Hollerith strings decoded. */
export function igesGlobal(text) {
  const G = text.split(/\r?\n/).filter(l => l[72] === 'G').map(l => l.slice(0, 72)).join('');
  const out = [null]; let i = 0, pd = ',', rd = ';';
  // fields 1 and 2 define the delimiters themselves
  const holl = () => { const m = /^(\d+)H/.exec(G.slice(i)); if (!m) return null; const n = +m[1], s = G.substr(i + m[0].length, n); i += m[0].length + n; return s; };
  for (let f = 1; i < G.length; f++) {
    while (G[i] === ' ') i++;
    let v = holl();
    if (v === null) { let j = i; while (j < G.length && G[j] !== pd && G[j] !== rd) j++; v = G.slice(i, j).trim(); i = j; }
    else { while (G[i] === ' ') i++; }
    if (f === 1 && v) pd = v; if (f === 2 && v) rd = v;
    out.push(v);
    if (G[i] === rd) break;
    i++;
  }
  return out;
}

/** Material intervals of a closed polygon along the line across = v (pts are [along, across]). */
export function polyScan(pts, v) {
  const xs = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    if ((a[1] > v) !== (b[1] > v)) xs.push(a[0] + (b[0] - a[0]) * (v - a[1]) / (b[1] - a[1]));
  }
  xs.sort((p, q) => p - q);
  return xs;
}

/** a minus the union of cuts; both are flat sorted boundary lists [in, out, in, out ...]. */
export function subtractIntervals(a, cuts) {
  let iv = []; for (let i = 0; i + 1 < a.length; i += 2) iv.push([a[i], a[i + 1]]);
  for (const [c0, c1] of cuts) {
    const nx = [];
    for (const [p, q] of iv) {
      if (c1 <= p || c0 >= q) { nx.push([p, q]); continue; }
      if (c0 > p) nx.push([p, c0]);
      if (c1 < q) nx.push([c1, q]);
    }
    iv = nx;
  }
  return iv.flat();
}

/** Small deterministic generator (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  const f = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  f.int = (lo, hi) => lo + Math.floor(f() * (hi - lo + 1));
  f.pick = (arr) => arr[Math.floor(f() * arr.length)];
  f.chance = (p) => f() < p;
  f.range = (lo, hi) => lo + f() * (hi - lo);
  return f;
}

// ---- writing a number the way a fitter types it (the test knows the value; the app has to parse the text) ----
const gcd = (a, b) => b ? gcd(b, a % b) : a;
/** Inches as a mixed fraction to 1/16: 2.5 -> "2 1/2". v must be a multiple of 1/16. */
export function frac16(v) {
  const neg = v < 0 ? '-' : ''; v = Math.abs(v);
  const n = Math.round(v * 16), w = Math.floor(n / 16), f = n - w * 16;
  if (!f) return neg + String(w);
  const g = gcd(f, 16);
  return neg + (w ? w + ' ' : '') + (f / g) + '/' + (16 / g);
}
/** Feet and inches: 126.375 -> "10'-6 3/8". */
export function ftIn(v) { const ft = Math.floor(v / 12 + 1e-9), r = v - ft * 12; return ft + "'-" + frac16(Math.round(r * 16) / 16); }
/** Plain decimal text without float noise. */
export function dec(v, places) { return String(+v.toFixed(places == null ? 4 : places)); }

export { kit };
