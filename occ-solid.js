// True-solid export for TubesT — builds each part as one closed B-rep solid
// with the OpenCascade kernel (vendor/occ) and writes IGES / STEP in inches.
//
// Why: TubesT imports IGS files of real solids and matches the tube's cross
// section; it follows the OUTER edge of every cut. The app's own 3D view is a
// triangle mesh, which TubesT does not recognise. Everything here is driven by
// the same calc() result that draws the flat DXF, so the two cannot drift.
//
// Axes: X = along the part (End A at low X). Pipe: +Y = 0 deg (top),
// +Z = 90 deg. Runs in the browser and in Node (test/).

import { edgeAgreement } from './iges-check.js';

export function kit(oc) {
  const cache = {};
  // embind exposes C++ overloads as Name_1, Name_2 ... ; find the one that takes these arguments.
  const mk = (name, ...args) => {
    const key = name + '/' + args.length + '/' + args.map(a => typeof a === 'object' && a ? (a.constructor && a.constructor.name) : typeof a).join(',');
    const tryOne = (k) => { try { return new oc[k](...args); } catch (e) { return null; } };
    if (cache[key]) { const v = tryOne(cache[key]); if (v) return v; }
    const names = Object.keys(oc).filter(k => k === name || (k.startsWith(name + '_') && /^\d+$/.test(k.slice(name.length + 1))));
    for (const k of names) { const v = tryOne(k); if (v) { cache[key] = k; return v; } }
    throw new Error('occ: no overload of ' + name + ' for (' + key + ')');
  };
  const call = (obj, name, ...args) => {
    const names = [name];
    for (let p = Object.getPrototypeOf(obj); p && p !== Object.prototype; p = Object.getPrototypeOf(p)) for (const k of Object.getOwnPropertyNames(p)) if (k.startsWith(name + '_') && /^\d+$/.test(k.slice(name.length + 1)) && !names.includes(k)) names.push(k);
    let err; for (const k of names) { if (typeof obj[k] !== 'function') continue; try { return obj[k](...args); } catch (e) { err = e; } }
    throw new Error('occ: no overload of .' + name + ' ' + (err || ''));
  };
  const stat = (cls, name, ...args) => {
    const names = Object.keys(oc[cls]).filter(k => k === name || k.startsWith(name + '_'));
    let err; for (const k of names) { try { return oc[cls][k](...args); } catch (e) { err = e; } }
    throw new Error('occ: no static ' + cls + '.' + name + ' ' + (err || ''));
  };
  const pnt = (x, y, z) => new oc.gp_Pnt_3(x, y, z);
  const dir = (x, y, z) => new oc.gp_Dir_4(x, y, z);
  const vec = (x, y, z) => new oc.gp_Vec_4(x, y, z);
  const ax2 = (p, n, xd) => xd ? new oc.gp_Ax2_2(pnt(...p), dir(...n), dir(...xd)) : new oc.gp_Ax2_3(pnt(...p), dir(...n));
  const done = (b) => { try { b.Build(); } catch (e) { } return b.Shape(); };
  const cut = (a, b) => done(new oc.BRepAlgoAPI_Cut_3(a, b));
  const common = (a, b) => done(new oc.BRepAlgoAPI_Common_3(a, b));
  const fuse = (a, b) => done(new oc.BRepAlgoAPI_Fuse_3(a, b));
  const polyWire = (pts) => { const p = mk('BRepBuilderAPI_MakePolygon'); for (const q of pts) call(p, 'Add', pnt(...q)); p.Close(); return p.Wire(); };
  const faceOfWire = (w) => mk('BRepBuilderAPI_MakeFace', w, true).Face();
  const polyFace = (pts) => faceOfWire(polyWire(pts));
  const prism = (shape, v) => done(mk('BRepPrimAPI_MakePrism', shape, vec(...v), false, true));
  const cyl = (p, n, r, h) => done(mk('BRepPrimAPI_MakeCylinder', ax2(p, n), r, h));
  /** Solid slab: everything on the +n side of the plane through p (bounded, size S). */
  const slab = (p, n, S) => {
    const l = Math.hypot(...n), N = n.map(v => v / l);
    const a = Math.abs(N[0]) < .9 ? [1, 0, 0] : [0, 1, 0];
    const u = [N[1] * a[2] - N[2] * a[1], N[2] * a[0] - N[0] * a[2], N[0] * a[1] - N[1] * a[0]]; const ul = Math.hypot(...u); const U = u.map(v => v / ul);
    const V = [N[1] * U[2] - N[2] * U[1], N[2] * U[0] - N[0] * U[2], N[0] * U[1] - N[1] * U[0]];
    const c = (s, t) => [p[0] + s * U[0] + t * V[0], p[1] + s * U[1] + t * V[1], p[2] + s * U[2] + t * V[2]];
    return prism(polyFace([c(-S, -S), c(S, -S), c(S, S), c(-S, S)]), N.map(v => v * S));
  };
  const bspline = (pts, opt) => {
    const o = Object.assign({ dmin: 3, dmax: 8, cont: 'GeomAbs_C2', tol: 1e-4 }, opt || {});
    const arr = mk('TColgp_Array1OfPnt', 1, pts.length);
    pts.forEach((q, i) => arr.SetValue(i + 1, pnt(...q)));
    const b = mk('GeomAPI_PointsToBSpline', arr, o.dmin, o.dmax, oc.GeomAbs_Shape[o.cont], o.tol);
    return b.Curve();
  };
  const edgeOfCurve = (h) => mk('BRepBuilderAPI_MakeEdge', new oc.Handle_Geom_Curve_2(h.get())).Edge();
  const ellipseFace = (p, n, xd, major, minor) => {
    const el = mk('gp_Elips', ax2(p, n, xd), major, minor);
    const e = mk('BRepBuilderAPI_MakeEdge', el).Edge();
    return faceOfWire(mk('BRepBuilderAPI_MakeWire', e).Wire());
  };
  const volume = (s) => { const g = new oc.GProp_GProps_1(); stat('BRepGProp', 'VolumeProperties', s, g, false, false, false); return g.Mass(); };
  const bbox = (s) => { const b = mk('Bnd_Box'); try { stat('BRepBndLib', 'AddOptimal', s, b, false, false); } catch (e) { stat('BRepBndLib', 'Add', s, b, false); } const lo = b.CornerMin(), hi = b.CornerMax(); return [[lo.X(), hi.X()], [lo.Y(), hi.Y()], [lo.Z(), hi.Z()]]; };
  const count = (s, what) => { let n = 0; const ex = mk('TopExp_Explorer', s, oc.TopAbs_ShapeEnum[what], oc.TopAbs_ShapeEnum.TopAbs_SHAPE); for (; ex.More(); ex.Next()) n++; return n; };
  const faceTypes = (s) => {
    const out = {}; const ex = mk('TopExp_Explorer', s, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    const names = Object.keys(oc.GeomAbs_SurfaceType).filter(k => k.startsWith('GeomAbs_'));
    for (; ex.More(); ex.Next()) { const a = mk('BRepAdaptor_Surface', stat('TopoDS', 'Face', ex.Current()), true); const t = a.GetType(); const nm = (names.find(k => oc.GeomAbs_SurfaceType[k] === t || (oc.GeomAbs_SurfaceType[k] && oc.GeomAbs_SurfaceType[k].value === (t && t.value))) || 'other').replace('GeomAbs_', ''); out[nm] = (out[nm] || 0) + 1; }
    return out;
  };
  /** Planar face in the plane x = x0 from (y, z) points, with true-arc fillets at the listed corners. */
  const sectionFace = (x0, yz, fillets) => {
    let f = polyFace(yz.map(q => [x0, q[0], q[1]]));
    const todo = (fillets || []).filter(q => q[2] > 1e-3);
    if (!todo.length) return f;
    const mf = mk('BRepFilletAPI_MakeFillet2d', f), seen = new Set();
    const ex = mk('TopExp_Explorer', f, oc.TopAbs_ShapeEnum.TopAbs_VERTEX, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    for (; ex.More(); ex.Next()) {
      const v = stat('TopoDS', 'Vertex', ex.Current()), p = stat('BRep_Tool', 'Pnt', v);
      const hit = todo.find(q => Math.abs(q[0] - p.Y()) < 1e-6 && Math.abs(q[1] - p.Z()) < 1e-6), key = p.Y().toFixed(5) + ',' + p.Z().toFixed(5);
      if (hit && !seen.has(key)) { seen.add(key); mf.AddFillet(v, hit[2]); }
    }
    if (seen.size !== todo.length) throw new Error('occ: section fillet corner not found');
    return stat('TopoDS', 'Face', done(mf));
  };
  const unify = (s) => { try { const u = mk('ShapeUpgrade_UnifySameDomain', s, true, true, false); u.Build(); return u.Shape(); } catch (e) { return s; } };
  /** Stadium (slot) or round tool through a plate: centre p, drilled along n, slot running along t. */
  const holeTool = (p, n, t, dia, slotL, depth) => {
    const r = dia / 2, c = cyl(p, n, r, depth);
    if (!slotL || slotL <= dia + 1e-6) return c;
    const h = (slotL - dia) / 2, at = (k) => [p[0] + t[0] * k, p[1] + t[1] * k, p[2] + t[2] * k];
    const w = [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]];
    const c4 = (k, m) => [p[0] + t[0] * k + w[0] * m, p[1] + t[1] * k + w[1] * m, p[2] + t[2] * k + w[2] * m];
    const box = prism(polyFace([c4(-h, -r), c4(h, -r), c4(h, r), c4(-h, r)]), n.map(v => v * depth));
    return fuse(fuse(box, cyl(at(-h), n, r, depth)), cyl(at(h), n, r, depth));
  };
  const valid = (s) => { const a = mk('BRepCheck_Analyzer', s, true); return call(a, 'IsValid'); };
  const inside = (s, p) => { const c = mk('BRepClass3d_SolidClassifier', s, pnt(...p), 1e-7); const st = c.State(); return st === oc.TopAbs_State.TopAbs_IN || (st && st.value === oc.TopAbs_State.TopAbs_IN.value); };
  /** Sample every edge curve of a shape: [[x, y, z], ...] (n points per edge). */
  const edgePoints = (s, n, grouped) => {
    const out = []; const ex = mk('TopExp_Explorer', s, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    for (; ex.More(); ex.Next()) { let a; try { a = mk('BRepAdaptor_Curve', stat('TopoDS', 'Edge', ex.Current())); } catch (e) { continue; } const u0 = a.FirstParameter(), u1 = a.LastParameter(); if (!isFinite(u0) || !isFinite(u1)) continue; const g = []; for (let i = 0; i <= n; i++) { const p = a.Value(u0 + (u1 - u0) * i / n); g.push([p.X(), p.Y(), p.Z()]); } if (grouped) out.push(g); else for (const q of g) out.push(q); }
    return out;
  };
  /** Distance-free test: is p on the surface of solid s within tol? (IN at p+tol side and OUT at the other is not needed - the classifier reports ON.) */
  const onSurface = (s, p, tol) => { const c = mk('BRepClass3d_SolidClassifier', s, pnt(...p), tol); const st = c.State(); return st === oc.TopAbs_State.TopAbs_ON || (st && st.value === oc.TopAbs_State.TopAbs_ON.value); };
  const scale = (s, f) => { const t = new oc.gp_Trsf_1(); t.SetScale(pnt(0, 0, 0), f); return done(mk('BRepBuilderAPI_Transform', s, t, true)); };
  return { edgePoints, onSurface, sectionFace, unify, holeTool, oc, mk, call, stat, pnt, dir, vec, ax2, done, cut, common, fuse, polyWire, faceOfWire, polyFace, prism, cyl, slab, bspline, edgeOfCurve, ellipseFace, volume, bbox, count, faceTypes, valid, inside, scale };
}

// ---------------------------------------------------------------- PIPE
function pipeSolid(K, comp, r) {
  const { ro, ri } = r.sec, L = r.L, PAD = 2 * ro + 4;
  const sq = (E) => !E || E.mode === 'sq' || (E.mode !== 'miter' && E.mode !== 'saddle');
  const x0 = sq(r.A) ? 0 : Math.min(...r.a) - PAD, x1 = sq(r.B) ? L : Math.max(...r.b) + PAD;
  let s = K.cut(K.cyl([x0, 0, 0], [1, 0, 0], ro, x1 - x0), K.cyl([x0 - 1, 0, 0], [1, 0, 0], ri, x1 - x0 + 2));
  const { fA, fB } = comp.roundCutFns(r.sec, L, r.A, r.B, []);
  const endCut = (E, isA) => {
    if (sq(E)) return;
    if (E.mode === 'miter') {
      // plane: x = xe + sgn * tan(m) * (y cos(mr) + z sin(mr)); remove the side beyond the end
      const sgn = isA ? -1 : 1, xe = isA ? 0 : L, cm = Math.cos(E.mr), sm = Math.sin(E.mr);
      const n = [1, -sgn * E.tanm * cm, -sgn * E.tanm * sm];           // gradient of (x - plane)
      s = K.cut(s, K.slab([xe, 0, 0], isA ? n.map(v => -v) : n, 4 * (ro + Math.abs(E.tanm) * ro) + 40));
      return;
    }
    // saddle: the cut is square to the pipe wall, one length per angle, so the end is a surface of
    // radial lines following x = f(angle). Build that surface wider than the wall and sweep it away.
    const M = 360, f = (phi) => isA ? fA(phi) : L - fB(phi);
    // One curve on the OD, then the SAME curve scaled toward / away from the pipe axis: both edges share
    // one parametrisation, so every ruling of the surface is a true radial line (x constant along it).
    const p = []; for (let i = 0; i <= M; i++) { const phi = i / M * 2 * Math.PI; p.push([f(phi), ro * Math.cos(phi), ro * Math.sin(phi)]); }
    const od = K.edgeOfCurve(K.bspline(p, Object.assign({ tol: 2e-5 }, comp._sdOpt || {})));
    const radial = (k) => { const g = new K.oc.gp_GTrsf_1(); K.call(g, 'SetAffinity', K.mk('gp_Ax1', K.pnt(0, 0, 0), K.dir(1, 0, 0)), k); return K.stat('TopoDS', 'Edge', K.done(K.mk('BRepBuilderAPI_GTransform', od, g, true))); };
    const face = K.stat('BRepFill', 'Face', radial(ri / ro * .6), radial(1.4));
    s = K.cut(s, K.prism(face, [isA ? -(PAD + 4 * ro + 60) : (PAD + 4 * ro + 60), 0, 0]));
  };
  endCut(r.A, true); endCut(r.B, false);
  for (const h of r.holes) {
    if (!h.ok) continue;
    const a = h.deg * Math.PI / 180, n = [0, Math.cos(a), Math.sin(a)], t = [0, -Math.sin(a), Math.cos(a)], rad = h.dia / 2;
    // the laser follows the OUTER edge. Plain / set-on openings: a true drilled cylinder gives that edge.
    // A branch that must pass through is held at the pipe ID, so its outer edge is wider across (x ro/ri).
    const wide = h.rho && h.ro ? h.ro / h.rho : 1;
    if (wide <= 1 + 1e-9) s = K.cut(s, K.cyl([h.x, 0, 0], n, rad, ro + 2));
    else s = K.cut(s, K.prism(K.ellipseFace([h.x, 0, 0], n, t, rad * wide, rad), n.map(v => v * (ro + 2))));
  }
  return s;
}

// ---------------------------------------------------------------- shared: planar end cuts
// All straight sections share the app's end planes:  End A: x = -y*tanv - z*tanp ;  End B: x = L + y*tanv + z*tanp
function planeEnds(K, s, r, S, both) {
  const A = r.A || {}, B = r.B || {}, L = r.L;
  // "both": the blank was made over-long at both ends, so a square end is trimmed by its plane too
  // a steep plane crosses the section over a longer run: the cutting block grows with the slope so it always swallows the whole over-long end
  const big = (E) => S * (1 + Math.abs(E.tanv || 0) + Math.abs(E.tanp || 0));
  if (both || A.tanv || A.tanp) s = K.cut(s, K.slab([0, 0, 0], [-1, -(A.tanv || 0), -(A.tanp || 0)], big(A)));
  if (both || B.tanv || B.tanp) s = K.cut(s, K.slab([L, 0, 0], [1, -(B.tanv || 0), -(B.tanp || 0)], big(B)));
  return s;
}
const reach = (r, half) => { const g = (E) => E ? (Math.abs(E.tanv || 0) + Math.abs(E.tanp || 0)) * half : 0; return { x0: -g(r.A) - 1, x1: r.L + g(r.B) + 1, sq: !g(r.A) && !g(r.B) }; };

// ---------------------------------------------------------------- SQUARE / RECT TUBE
function boxSolid(K, comp, r) {
  const { H, B, t, rc } = r.sec, R = reach(r, Math.max(H, B)), x0 = R.sq ? 0 : R.x0, len = (R.sq ? r.L : R.x1) - x0;
  const rect = (h, b) => [[-h / 2, -b / 2], [-h / 2, b / 2], [h / 2, b / 2], [h / 2, -b / 2]];
  const rounded = (h, b, rad, x) => K.sectionFace(x, rect(h, b), rect(h, b).map(q => [q[0], q[1], rad]));
  let s = K.cut(K.prism(rounded(H, B, rc, x0), [len, 0, 0]), K.prism(rounded(H - 2 * t, B - 2 * t, Math.max(0, rc - t), x0 - 1), [len + 2, 0, 0]));
  s = planeEnds(K, s, r, 4 * Math.max(H, B) + 40, !R.sq);
  const st = r.stns, Pm = (() => { const l = st[st.length - 1]; return l.s + Math.hypot(st[0].y - l.y, st[0].z - l.z); })();
  const at = (u) => { // point + outward normal on the outside perimeter at arc length u
    for (let i = 0; i < st.length; i++) { const a = st[i], b = st[(i + 1) % st.length], sb = i + 1 < st.length ? b.s : Pm; if (u >= a.s - 1e-9 && u <= sb + 1e-9) { const k = sb > a.s ? (u - a.s) / (sb - a.s) : 0; return { y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, ny: a.ny, nz: a.nz }; } }
    return st[0];
  };
  const bore = Math.min(H, B) / 2 - t;
  for (const h of r.holes) {
    if (!h.ok) continue;
    const q = at(h.u), n = [0, q.ny, q.nz], back = t + Math.min(bore * .8, 1);
    const p = [h.x, q.y - q.ny * back, q.z - q.nz * back];
    const tan = h.ax === 'x' ? [1, 0, 0] : [0, -q.nz, q.ny];
    s = K.cut(s, K.holeTool(p, n, tan, h.dia, h.slotL, back + 1));
  }
  return s;
}

// ---------------------------------------------------------------- BEAM / CHANNEL
const rootR = (sec) => Math.max(.15, Math.min(1.1 * sec.tw + .05, (sec.d / 2 - sec.tf) * .45, ((sec.chan ? sec.bf - sec.tw : (sec.bf - sec.tw) / 2)) * .45));
function plateSolid(K, comp, r) {
  const sec = r.sec, { d, bf, tf, tw } = sec, hw = d / 2 - tf, zL = r.zL, zR = r.zR, rr = comp && typeof comp.rootFillet === 'function' ? comp.rootFillet(sec) : rootR(sec), L = r.L;
  const A = r.A, B = r.B, coped = !!(A.ct || A.cb || B.ct || B.cb || (A.rat && A.rat !== 'NONE') || (B.rat && B.rat !== 'NONE'));
  const R = reach(r, Math.max(d, bf)), x0 = (R.sq && !coped) ? 0 : R.x0, len = ((R.sq && !coped) ? L : R.x1) - x0;
  const yz = sec.chan
    ? [[-d / 2, zL], [-d / 2, zR], [-hw, zR], [-hw, tw / 2], [hw, tw / 2], [hw, zR], [d / 2, zR], [d / 2, zL]]
    : [[-d / 2, -bf / 2], [-d / 2, bf / 2], [-hw, bf / 2], [-hw, tw / 2], [hw, tw / 2], [hw, bf / 2], [d / 2, bf / 2], [d / 2, -bf / 2], [hw, -bf / 2], [hw, -tw / 2], [-hw, -tw / 2], [-hw, -bf / 2]];
  const fil = yz.filter(q => Math.abs(Math.abs(q[0]) - hw) < 1e-9 && Math.abs(Math.abs(q[1]) - tw / 2) < 1e-9).map(q => [q[0], q[1], rr]);
  let s = K.prism(K.sectionFace(x0, yz, fil), [len, 0, 0]);
  // Every end is cut by its true plane, coped or not: a miter is the same cut whether or not the part
  // also has a cope somewhere. Copes and weld-access holes are then taken out of that blank.
  s = planeEnds(K, s, r, 4 * Math.max(d, bf) + 40, coped || !R.sq);
  if (coped) {
    const X0 = x0 - 2, X1 = x0 + len + 2, Z0 = zL - 1, DZ = zR - zL + 2, FIL = 48;
    const arc = (cx, cy, rad, a0, a1) => { const o = []; for (let i = 1; i <= FIL; i++) { const t = a0 + (a1 - a0) * i / FIL; o.push([cx + rad * Math.cos(t), cy + rad * Math.sin(t)]); } return o; };
    const cutXY = (pts) => { s = K.cut(s, K.prism(K.polyFace(pts.map(q => [q[0], q[1], Z0])), [0, 0, DZ])); };
    for (const [E, isA] of [[A, true], [B, false]]) {
      const xe = isA ? 0 : L, sg = isA ? 1 : -1, xo = isA ? X0 : X1;
      if (E.ct) {   // top cope: floor at yt, vertical cut at xc, corner radius between them
        const { c, dc, r: cr } = E.ct, yt = d / 2 - dc, xc = xe + sg * c;
        cutXY([[xo, yt], [xc - sg * cr, yt]].concat(cr > 1e-6 ? arc(xc - sg * cr, yt + cr, cr, -Math.PI / 2, isA ? 0 : -Math.PI) : [], [[xc, d / 2 + 1], [xo, d / 2 + 1]]));
      }
      if (E.cb) {
        const { c, dc, r: cr } = E.cb, yb = -d / 2 + dc, xc = xe + sg * c;
        cutXY([[xo, yb], [xc - sg * cr, yb]].concat(cr > 1e-6 ? arc(xc - sg * cr, yb - cr, cr, Math.PI / 2, isA ? 0 : Math.PI) : [], [[xc, -d / 2 - 1], [xo, -d / 2 - 1]]));
      }
      // weld-access holes: a round notch in the web, centred on the end cut, tight under the flange
      const tv = isA ? -(E.tanv || 0) : (E.tanv || 0);
      const rat = (yc) => { s = K.cut(s, K.cyl([xe + yc * tv, yc, -tw / 2 - .5], [0, 0, 1], E.rr, tw + 1)); };
      const gap = (comp && comp.constructor && comp.constructor.RAT_GAP) || 0.005;   // stops a hair under the flange (see Component.RAT_GAP)
      if ((E.rat === 'TOP' || E.rat === 'BOTH') && !E.ct) rat(hw - E.rr - gap);
      if ((E.rat === 'BOT' || E.rat === 'BOTH') && !E.cb) rat(-hw + E.rr + gap);
    }
    s = K.unify(s);
  }
  for (const h of r.holes) {
    if (!h.ok) continue;
    if (h.face === 'web') s = K.cut(s, K.holeTool([h.x, h.c, -tw / 2 - .5], [0, 0, 1], h.ax === 'x' ? [1, 0, 0] : [0, 1, 0], h.dia, h.slotL, tw + 1));
    else { const up = h.face === 'tf'; s = K.cut(s, K.holeTool([h.x, up ? hw - .5 : -hw + .5, h.c], [0, up ? 1 : -1, 0], h.ax === 'x' ? [1, 0, 0] : [0, 0, 1], h.dia, h.slotL, tf + 1)); }
  }
  return s;
}

// ---------------------------------------------------------------- ANGLE
function angleSolid(K, comp, r) {
  const { a, b, t } = r.sec, R = reach(r, Math.max(a, b)), x0 = R.sq ? 0 : R.x0, len = (R.sq ? r.L : R.x1) - x0;
  // root fillet by leg size, the same figure the form uses to keep holes off the heel
  const rr = comp && typeof comp.angleFillet === 'function' ? comp.angleFillet(r.sec) : Math.max(.12, Math.min(.75 * t + .125, Math.min(a, b) - t - .05));
  let s = K.prism(K.sectionFace(x0, [[0, 0], [0, b], [t, b], [t, t], [a, t], [a, 0]], [[t, t, rr]]), [len, 0, 0]);
  s = planeEnds(K, s, r, 4 * Math.max(a, b) + 40, !R.sq);
  for (const h of r.holes) {
    if (!h.ok) continue;
    if (h.face === 'vleg') s = K.cut(s, K.holeTool([h.x, h.c, -.5], [0, 0, 1], h.ax === 'x' ? [1, 0, 0] : [0, 1, 0], h.dia, h.slotL, t + 1));
    else s = K.cut(s, K.holeTool([h.x, -.5, h.c], [0, 1, 0], h.ax === 'x' ? [1, 0, 0] : [0, 0, 1], h.dia, h.slotL, t + 1));
  }
  return s;
}

export function buildSolid(oc, comp, r) {
  const K = kit(oc);
  if (r.invalid) throw new Error('part has errors - fix them first');
  const shape = r.kind === 'round' ? pipeSolid(K, comp, r) : r.kind === 'box' ? boxSolid(K, comp, r) : r.kind === 'plate' ? plateSolid(K, comp, r) : angleSolid(K, comp, r);
  return { K, shape };
}

/** Facts about a built solid, measured by the kernel. */
export function inspect(K, shape) {
  return { valid: K.valid(shape), solids: K.count(shape, 'TopAbs_SOLID'), shells: K.count(shape, 'TopAbs_SHELL'), faces: K.count(shape, 'TopAbs_FACE'), volume: K.volume(shape), bbox: K.bbox(shape), types: K.faceTypes(shape) };
}

const readFS = (oc, p) => { const t = oc.FS.readFile(p, { encoding: 'utf8' }); try { oc.FS.unlink(p); } catch (e) { } return t; };
const safe = (s) => String(s).replace(/[^A-Za-z0-9 ._+\-x]/g, '_').slice(0, 60);

export function writeStep(K, shape, name) {
  const oc = K.oc, nm = safe(name);
  const w = new oc.STEPControl_Writer_1();
  K.call(w, 'Transfer', shape, oc.STEPControl_StepModelType.STEPControl_AsIs, true);
  K.call(w, 'Write', '/pb.step');
  let t = readFS(oc, '/pb.step');
  // The kernel build cannot be told the unit, so it labels the file millimetres while the numbers are
  // inches. Declare the length unit as INCH (25.4 mm) the same way OpenCascade itself writes inch files.
  const m = t.match(/#(\d+)\s*=\s*\(\s*LENGTH_UNIT\(\)\s*NAMED_UNIT\(\*\)\s*SI_UNIT\(\.MILLI\.,\.METRE\.\)\s*\);/);
  if (!m) throw new Error('STEP unit entity not found');
  let maxId = 0; for (const q of t.matchAll(/#(\d+)\s*=/g)) maxId = Math.max(maxId, +q[1]);
  const mm = '#' + m[1], a = '#' + (maxId + 1), b = '#' + (maxId + 2), c = '#' + (maxId + 3);
  const refRe = new RegExp(mm + '(?!\\d)', 'g');
  t = t.replace(m[0], '@@UNIT@@').replace(refRe, c).replace('@@UNIT@@', m[0] + '\n' + a + ' = LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(25.4),' + mm + ');\n' + b + ' = DIMENSIONAL_EXPONENTS(1.,0.,0.,0.,0.,0.,0.);\n' + c + " = ( CONVERSION_BASED_UNIT('INCH'," + a + ') LENGTH_UNIT() NAMED_UNIT(' + b + ') );');
  t = t.replace(/PRODUCT\('[^']*',\s*'[^']*'/, "PRODUCT('" + nm + "','" + nm + "'");
  t = t.replace(/FILE_NAME\([\s\S]*?\);/, "FILE_NAME('" + nm + ".step','" + new Date().toISOString().slice(0, 19) + "',('Steampunk Fabrication'),('Steampunk Fabrication'),'Open CASCADE STEP processor','Part Builder','');");
  return t;
}

/** How far an edge's surface-coordinate curve is from its own 3D curve, measured by the kernel (-1: not measurable). */
function edgeGap(K, E, F) {
  try { const ch = new K.oc.BRepLib_CheckCurveOnSurface_2(E, F); ch.Perform(false); return ch.IsDone() ? ch.MaxDistance() : -1; } catch (e) { return -1; }
}
function eachEdgeOnFace(K, s, fn) {
  const oc = K.oc, T = oc.TopAbs_ShapeEnum;
  const fx = K.mk('TopExp_Explorer', s, T.TopAbs_FACE, T.TopAbs_SHAPE);
  for (; fx.More(); fx.Next()) {
    const F = K.stat('TopoDS', 'Face', fx.Current());
    const ex = K.mk('TopExp_Explorer', F, T.TopAbs_EDGE, T.TopAbs_SHAPE);
    for (; ex.More(); ex.Next()) {
      const E = K.stat('TopoDS', 'Edge', ex.Current());
      if (K.stat('BRep_Tool', 'Degenerated', E) || K.stat('BRep_Tool', 'IsClosed', E, F)) continue;   // seams carry two curves; they are straight and convert exactly
      fn(E, F);
    }
  }
}
/** An IGES trimmed surface carries every cut edge twice: as a 3D curve and as a curve in the surface's own
 *  coordinates, and a reader may use either one. The kernel's NURBS conversion leaves the second one wrong
 *  wherever a free-form edge (a hole or a saddle) crosses a cylinder - up to 1/8 in on 6 in pipe - so a reader
 *  that prefers it would cut the hole in the wrong place. Every such curve is thrown away and rebuilt by
 *  projecting the 3D curve onto the converted surface, then all of them are measured again.
 *  -> { shape, rebuilt, worst } (worst: largest remaining disagreement, inches) */
export function agreeEdges(K, nurbs) {
  const oc = K.oc, sbe = new oc.ShapeBuild_Edge();
  let rebuilt = 0;
  eachEdgeOnFace(K, nurbs, (E, F) => { if (edgeGap(K, E, F) > 1e-4) { K.call(sbe, 'RemovePCurve', E, F); rebuilt++; } });
  if (rebuilt) {
    const fix = K.mk('ShapeFix_Shape', nurbs);
    fix.SetPrecision(1e-7); fix.SetMaxTolerance(1e-5);
    fix.Perform(new oc.Handle_Message_ProgressIndicator_1());
    nurbs = fix.Shape();
    K.stat('BRepLib', 'SameParameter', nurbs, 1e-6, true);
  }
  let worst = 0;
  eachEdgeOnFace(K, nurbs, (E, F) => { worst = Math.max(worst, edgeGap(K, E, F)); });
  return { shape: nurbs, rebuilt, worst };
}

export function writeIges(K, shape, name) {
  const oc = K.oc;
  const w = K.mk('IGESControl_Writer', 'IN', 0);                 // 0 = faces mode: trimmed surfaces (type 144), TubesT's usual input
  // Every surface and edge is first converted to exact NURBS (what SolidWorks writes for TubesT). The IGES
  // writer mangles analytic ellipses (a miter on a round or radiused corner); as NURBS they go out exact.
  const conv = K.done(K.mk('BRepBuilderAPI_NurbsConvert', shape, true));
  const ag = agreeEdges(K, conv), nurbs = ag.shape;
  if (ag.worst > .02) throw new Error('IGES: a cut edge is described two ways that differ by ' + ag.worst.toFixed(4) + ' in.');
  if (ag.rebuilt && !(K.valid(nurbs) && K.count(nurbs, 'TopAbs_SOLID') === 1)) throw new Error('IGES: the solid did not survive the edge repair.');
  if (!K.call(w, 'AddShape', K.scale(nurbs, 25.4))) throw new Error('IGES: shape not accepted');   // the writer converts from millimetres to the unit asked for
  w.ComputeModel();
  K.call(w, 'Write', '/pb.igs', false);
  const text = readFS(oc, '/pb.igs');
  // Last gate, on the file itself and without the kernel: read the text back with an independent reader and
  // measure both descriptions of every cut edge. Nothing is handed over unless they are the same edge.
  const chk = edgeAgreement(text);
  if (chk.unreadable) throw new Error('IGES: ' + chk.unreadable + ' cut edge' + (chk.unreadable > 1 ? 's' : '') + ' in the file could not be verified.');
  if (chk.worst > 2e-3) throw new Error('IGES: a cut edge is described two ways that differ by ' + chk.worst.toFixed(4) + ' in.');
  return text;
}

export function readBack(K, text, kind) {
  const oc = K.oc, p = '/rb.' + (kind === 'iges' ? 'igs' : 'step');
  oc.FS.writeFile(p, text);
  const rd = kind === 'iges' ? new oc.IGESControl_Reader_1() : new oc.STEPControl_Reader_1();
  K.call(rd, 'ReadFile', p);
  K.call(rd, 'TransferRoots');
  const s = rd.OneShape();
  try { oc.FS.unlink(p); } catch (e) { }
  return s;
}
