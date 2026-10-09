// Part Builder — application logic. Ported unchanged from the Claude Design
// prototype (Part Builder.dc.html, <script type="text/x-dc"> body); the only
// edits are _ticketFonts() (local fonts for the print popup) and the return
// in _ticketCss(). DCLogic and React are globals set up by pb-runtime.js,
// which must load before this file. Geometry/export methods are validated by
// the Node harness in test/ — keep them in sync with any edit.
class Component extends DCLogic {
  state = Object.assign(Component.freshPart(), {
    job: '',
    spin: true, ghost: true, jobOpen: true, help: false,
    parts: [], gripT: '6', stickSel: {}, rateCT: '0.85', rateST: '3.50', rateAT: '2.60',
    recallT: '', recallMsg: '',
    hovL: '', hovGx: 0, hovGy: 0,
    archive: [], archQ: '', archMsg: '',
    fsName: '', fsPerm: '',
    lenMode: 'wp', dxfRef: false,
    hdrB: { nps: '10', sch: '40', seat: 'on', hid: 1, list: [] }
  });
  /** Factory defaults for the part form — what NEW JOB resets to. */
  static freshPart() {
    return {
      step: 1, family: 'pipe',
      pnps: '6', psch: '40', todT: '2', twallT: '.120',
      hsize: '4x4', hwallT: '1/4',
      bser: 'W', bsize: 'W12x26', cser: 'C', csize: 'C6x10.5',
      asize: '3x3', athkT: '1/4',
      cdT: '12', cbT: '6.5', ctfT: '3/8', ctwT: '1/4', cwT: '26',
      lenT: "10'-0", mat: 'A106B', mark: 'P-1', heat: '', qty: 1,
      wantHoles: false, gid: 2,
      groups: [Component.defGroup(1, 'pipe')],
      ends: { A: Component.defEnd(), B: Component.defEnd() }
    };
  }
  static defEnd() {
    return { mode: 'sq', tpT: '0', tvT: '0', maT: '45', mrT: '0', sdN: '10', sdS: '40', sdAT: '90', sdSeat: 'on', sdRT: '0', sdHT: 'nps', sdHodT: '10.75', sdHwT: '.365',
      roST: '24', roRT: '12', roAT: '60',
      wantBevel: false, bvT: '37.5', landT: '1/16', open: 'TOP', app: 'BOTH',
      wantCope: false, ct: true, tcT: '4', tdT: '1 1/2', trT: '1/2', cb: false, bcT: '4', bdT: '1 1/2', brT: '1/2', rat: 'NONE', rrT: '3/4' };
  }
  static defGroup(id, fam) {
    const face = { pipe: 'wall', tube: 'wall', hss: 'T', beam: 'web', chan: 'web', angl: 'vleg' }[fam] || 'wall';
    // Hole meaning follows the material: round stock gets olet/branch openings,
    // HSS gets plain round/slot cutouts, only beam/channel/angle get bolt holes.
    const isRound = fam === 'pipe' || fam === 'tube';
    return { id, face, bolt: '3/4', type: isRound ? 'olet' : fam === 'hss' ? 'cust' : 'std', ax: 'x', refEnd: 'A', x0T: '3', pT: '3', nT: '2', xsT: '',
      bnps: '1', bsch: 'STD', sllT: '1 1/2',
      azT: '0', aznT: '1', azpT: '90', offT: '0',
      wref: 'tos', y0T: '3', nyT: '2', pyT: '3', amode: 'gauge', gT: '3 1/2', diaT: fam === 'hss' ? '9/16' : '13/16' };
  }
  constructor(props) {
    super(props);
    this.stageRef = React.createRef();
    this.D = null;
    import('./profile-db.js').then(m => { this.D = m; this.forceUpdate(); }).catch(() => {});
    try {
      const raw = localStorage.getItem('spf_pb_job_v1');
      if (raw) {
        const j = JSON.parse(raw);
        if (j && Array.isArray(j.parts)) Object.assign(this.state, { parts: j.parts, job: j.job || '', gripT: j.gripT || '6', stickSel: j.stickSel || {}, rateCT: j.rateCT || '0.85', rateST: j.rateST || '3.50', rateAT: j.rateAT || '2.60', hdrB: (j.hdrB && Array.isArray(j.hdrB.list)) ? j.hdrB : this.state.hdrB, dxfRef: !!j.dxfRef });
      }
    } catch (e) {}
    this._fsInit();
    try { const ar = localStorage.getItem('spf_pb_archive_v1'); if (ar) { const j = JSON.parse(ar); if (Array.isArray(j)) this.state.archive = j; } } catch (e) {}
    try { if (!localStorage.getItem('spf_pb_help_seen')) this.state.help = true; } catch (e) {}
    fetch('assets/logo-chrome.jpg').then(r => r.blob()).then(b => { const fr = new FileReader(); fr.onload = () => { this._logo = fr.result; }; fr.readAsDataURL(b); }).catch(() => {});
  }

  // ---------- parsing / formatting ----------
  frIn(s) {
    s = String(s).trim(); if (!s) return null;
    // Pure fraction first — "11/16" is 11/16, never "1 + 1/16". Mixed numbers
    // need an explicit space or dash: "1 1/8" or "1-1/8".
    let m = s.match(/^(\d+)\/(\d+)$/);
    if (m) { const den = parseFloat(m[2]); return den ? parseFloat(m[1]) / den : null; }
    m = s.match(/^(\d+(?:\.\d+)?)(?:[ -](\d+)\/(\d+))?$/);
    if (!m) { m = s.match(/^\.(\d+)$/); return m ? parseFloat('0.' + m[1]) : null; }
    let v = parseFloat(m[1]);
    if (m[2]) { const den = parseFloat(m[3]); if (!den) return null; v += parseFloat(m[2]) / den; }
    return v;
  }
  parseIn(s) {
    if (s == null) return null;
    s = String(s).replace(/[\u2033\u2032]/g, m => m === '\u2032' ? "'" : '').replace(/"/g, '').trim();
    if (!s) return null;
    const neg = /^-/.test(s) ? (s = s.replace(/^-/, '').trim(), true) : false;
    let v;
    if (s.includes("'")) {
      const i = s.indexOf("'");
      const f = parseFloat(s.slice(0, i));
      if (isNaN(f)) return null;
      let rest = s.slice(i + 1).replace(/^[\s-]+/, '').trim();
      const inches = rest ? this.frIn(rest) : 0;
      if (inches == null) return null;
      v = f * 12 + inches;
    } else v = this.frIn(s);
    if (v == null) return null;
    return neg ? -v : v;
  }
  fr16(x) {
    const n0 = Math.round(x * 16);
    if (!n0) return '0';
    const w = Math.trunc(n0 / 16);
    let n = Math.abs(n0 - w * 16), d = 16;
    if (!n) return String(w);
    while (n % 2 === 0) { n /= 2; d /= 2; }
    return (w ? w + ' ' : '') + n + '/' + d;
  }
  fmtIn(x) {
    const neg = x < 0 ? '-' : ''; x = Math.abs(x);
    let w = Math.floor(x + 1e-9), f = Math.round((x - w) * 16);
    if (f === 16) { w++; f = 0; }
    const fs = f ? this.fr16(f / 16) : '';
    return neg + (w || !f ? w : '') + (w && f ? ' ' : '') + fs + '\u2033';
  }
  fmtFtIn(x) {
    if (x == null || isNaN(x)) return '\u2014';
    const ft = Math.floor(x / 12 + 1e-9);
    const rem = x - ft * 12;
    let w = Math.floor(rem + 1e-9), s = Math.round((rem - w) * 16);
    if (s === 16) { w++; s = 0; }
    if (w === 12) return (ft + 1) + '\u2032-0\u2033';
    return ft + '\u2032-' + w + (s ? ' ' + this.fr16(s / 16) : '') + '\u2033';
  }

  // ---------- 2D helpers ----------
  arcPts(cx, cy, r, a0, a1, n) {
    const p = [];
    for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; p.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    return p;
  }
  circPts(cx, cy, r, n, cw) {
    const p = [];
    for (let i = 0; i < n; i++) { const a = (cw ? -1 : 1) * i / n * 2 * Math.PI; p.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    return p;
  }
  slotPts(cx, cy, len, wid, alongX, n, cw) {
    const r = wid / 2, h = Math.max(0, len / 2 - r);
    const seg = Math.max(4, Math.floor(n / 2));
    const a1 = this.arcPts(h, 0, r, -Math.PI / 2, Math.PI / 2, seg);
    const a2 = this.arcPts(-h, 0, r, Math.PI / 2, 3 * Math.PI / 2, seg);
    let loc = a1.concat(a2);
    if (cw) loc = loc.slice().reverse();
    return loc.map(q => alongX ? [cx + q[0], cy + q[1]] : [cx + q[1], cy + q[0]]);
  }
  area(pts) { let a = 0; for (let i = 0; i < pts.length; i++) { const j = (i + 1) % pts.length; a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1]; } return a / 2; }
  pip(pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  /** Hole size by material. Round stock: olet/branch openings (bore of the
   *  branch pipe, its OD for a set-thru stub, or custom) — cut square, weld
   *  prep in CAM or ground at fit-up. HSS: plain round/slot cutouts.
   *  Beam/channel/angle: AISC J3.3 bolt holes. */
  holeSize(g) {
    const fam = this.state.family, D = this.D;
    if (fam === 'pipe' || fam === 'tube') {
      if (g.type === 'cust') return { dia: this.parseIn(g.diaT) || 1, slotL: 0 };
      const od = (D && D.PIPE_OD[g.bnps]) || 1.315;
      if (g.type === 'stub') return { dia: od, slotL: 0 };
      const w = (D && (D.PIPE_WALL[g.bsch] || D.PIPE_WALL.STD)[g.bnps]) || .133;
      return { dia: Math.max(.1, od - 2 * w), slotL: 0 };
    }
    if (fam === 'hss') {
      const dia = this.parseIn(g.diaT) || .5625;
      return g.type === 'slot' ? { dia, slotL: Math.max(dia, this.parseIn(g.sllT) || 1.5) } : { dia, slotL: 0 };
    }
    const bolt = (D && D.BOLT[g.bolt]) || [.8125, .9375, 1, 1.875];
    if (g.type === 'ovs') return { dia: bolt[1], slotL: 0 };
    if (g.type === 'ssl') return { dia: bolt[0], slotL: bolt[2] };
    if (g.type === 'lsl') return { dia: bolt[0], slotL: bolt[3] };
    if (g.type === 'cust') return { dia: this.parseIn(g.diaT) || bolt[0], slotL: 0 };
    return { dia: bolt[0], slotL: 0 };
  }
  /** What sized this hole — bolt Ø for bolt families, branch pipe for olets. */
  holeBasis(g) {
    const fam = this.state.family;
    if (fam === 'pipe' || fam === 'tube') return g.type === 'cust' ? '-' : 'BR ' + g.bnps + ' ' + this.schedLabel(g.bsch);
    if (fam === 'hss') return '-';
    return g.bolt;
  }
  /** Hole X positions for a group: the exact-spots list wins over first+spacing+qty.
   *  Tokens are measured from the group's reference end. */
  holeXs(g, L) {
    const xs = [];
    const list = String(g.xsT || '').trim();
    if (list) {
      for (const tok of list.split(/[,;]+/)) {
        const v = this.parseIn(tok);
        if (v != null) xs.push(g.refEnd === 'A' ? v : L - v);
      }
    } else {
      const x0 = this.parseIn(g.x0T) ?? 3, p = this.parseIn(g.pT) ?? 3;
      const n = Math.max(1, Math.min(60, Math.round(parseFloat(g.nT) || 1)));
      for (let i = 0; i < n; i++) xs.push(g.refEnd === 'A' ? x0 + i * p : L - x0 - i * p);
    }
    return xs.slice(0, 60);
  }
  /** Inches → parseable shop token snapped to 1/16 ("15 1/2", "3", "-1 3/4"). */
  fmtTok(x) {
    x = Math.round(x * 16) / 16;
    const neg = x < 0 ? '-' : ''; x = Math.abs(x);
    let w = Math.floor(x + 1e-9), f = Math.round((x - w) * 16);
    if (f === 16) { w++; f = 0; }
    return neg + (f ? (w ? w + ' ' : '') + this.fr16(f / 16) : String(w));
  }
  matRec() { const M = this.D ? this.D.MATERIALS : [{ id: 'A106B', label: 'A106-B PIPE', f: 1, cat: 'carbon' }]; return M.find(m => m.id === this.state.mat) || M[0]; }
  famKind() { const f = this.state.family; return (f === 'pipe' || f === 'tube') ? 'round' : f === 'hss' ? 'box' : f === 'angl' ? 'angl' : 'plate'; }
  famLabel() { return { pipe: 'PIPE', tube: 'ROUND TUBE', hss: 'SQ/RECT TUBE', beam: 'BEAM', chan: 'CHANNEL', angl: 'ANGLE' }[this.state.family]; }

  sec() {
    const st = this.state, D = this.D;
    if (!D) return { kind: 'round', label: 'LOADING\u2026', od: 6.625, ro: 3.3125, ri: 3.0325, t: .28, wtFt: 18.97, loading: true };
    if (st.family === 'pipe') {
      const od = D.PIPE_OD[st.pnps], t = D.PIPE_WALL[st.psch][st.pnps];
      const A = Math.PI * (od * od - (od - 2 * t) * (od - 2 * t)) / 4;
      return { kind: 'round', label: st.pnps + '\u2033 ' + this.schedLabel(st.psch), od, ro: od / 2, ri: od / 2 - t, t, wtFt: A * 3.4032 };
    }
    if (st.family === 'tube') {
      const od = this.parseIn(st.todT) || 2, t0 = this.parseIn(st.twallT) || .12, t = Math.min(t0, od / 2 - .01);
      const A = Math.PI * (od * od - (od - 2 * t) * (od - 2 * t)) / 4;
      return { kind: 'round', label: od + '\u2033 OD \u00D7 ' + this.fr16(t) + ' WALL', od, ro: od / 2, ri: od / 2 - t, t, wtFt: A * 3.4032 };
    }
    if (st.family === 'hss') {
      const p = st.hsize.split('x'), H = this.frIn(p[0]) || 4, B = this.frIn(p[1]) || H;
      let t = this.parseIn(st.hwallT) || .25; t = Math.min(t, Math.min(B, H) / 2.5);
      const rc = Math.min(2 * t, Math.min(B, H) / 3);
      const ri2 = Math.max(rc - t, .02);
      const A = (B * H - (4 - Math.PI) * rc * rc) - ((B - 2 * t) * (H - 2 * t) - (4 - Math.PI) * ri2 * ri2);
      return { kind: 'box', label: 'HSS ' + st.hsize.toUpperCase() + '\u00D7' + st.hwallT, B, H, t, rc, wtFt: A * 3.4032 };
    }
    if (st.family === 'angl') {
      const p = st.asize.split('x'), a = this.frIn(p[0]) || 3, b = this.frIn(p[1]) || a;
      let t = this.parseIn(st.athkT) || .25; t = Math.min(t, Math.min(a, b) / 2);
      const A = t * (a + b - t);
      return { kind: 'angl', label: 'L' + st.asize.toUpperCase() + '\u00D7' + st.athkT, a, b, t, wtFt: A * 3.4032 };
    }
    const isBeam = st.family === 'beam';
    const ser = isBeam ? st.bser : st.cser;
    if (isBeam && ser === 'CUST') {
      const d = this.parseIn(st.cdT) || 12, bf = this.parseIn(st.cbT) || 6.5, tf = this.parseIn(st.ctfT) || .375, tw = this.parseIn(st.ctwT) || .25, wtFt = this.frIn(st.cwT) || 26;
      return { kind: 'plate', label: 'CUSTOM ' + d + '\u2033', d, bf, tf, tw, wtFt, chan: false };
    }
    const tbl = D[ser] || D.W;
    const key = isBeam ? st.bsize : st.csize;
    const rec = tbl[key] || Object.values(tbl)[0];
    return { kind: 'plate', label: key, d: rec[0], bf: rec[1], tf: rec[2], tw: rec[3], wtFt: rec[4], chan: !isBeam };
  }
  schedLabel(s) { return (s === 'STD' || s === 'XS') ? s : 'SCH ' + s; }

  endParsed(e, sec) {
    const kind = sec.kind;
    const E = { mode: e.mode, bv: e.wantBevel ? Math.max(0, Math.min(60, parseFloat(e.bvT) || 0)) : 0, land: this.parseIn(e.landT) || 0, open: e.open, app: e.app };
    if (kind === 'round') {
      if (e.mode === 'miter') {
        E.ma = Math.max(-75, Math.min(75, parseFloat(e.maT) || 0));
        E.mr = (parseFloat(e.mrT) || 0) * Math.PI / 180;
        E.tanm = Math.tan(E.ma * Math.PI / 180);
      } else if (e.mode === 'saddle') {
        const D = this.D;
        const custom = e.sdHT === 'cust';
        let hod, hw, badOd = false;
        if (custom) {
          hod = this.parseIn(e.sdHodT);
          hw = this.parseIn(e.sdHwT);
          if (!(hod > 0)) { badOd = true; hod = 10.75; }
          hw = Math.max(.02, Math.min(hw > 0 ? hw : .25, hod / 2 - .01));
        } else { hod = D ? D.PIPE_OD[e.sdN] : 10.75; hw = D ? D.PIPE_WALL[e.sdS][e.sdN] : .365; }
        const alpha = Math.max(20, Math.min(90, parseFloat(e.sdAT) || 90)) * Math.PI / 180;
        E.sd = { hod, hw, hid: hod - 2 * hw, alpha, roll: (parseFloat(e.sdRT) || 0) * Math.PI / 180, seat: e.sdSeat, Rs: e.sdSeat === 'on' ? hod / 2 : (hod - 2 * hw) / 2, N: e.sdN, S: e.sdS, custom, badOd };
      }
      return E;
    }
    const ang = e.mode === 'ang';
    E.tp = ang ? Math.max(-75, Math.min(75, parseFloat(e.tpT) || 0)) : 0;
    E.tv = ang ? Math.max(-75, Math.min(75, parseFloat(e.tvT) || 0)) : 0;
    E.tanp = Math.tan(E.tp * Math.PI / 180); E.tanv = Math.tan(E.tv * Math.PI / 180);
    if (kind === 'plate') {
      const cope = !!e.wantCope;
      E.ct = cope && e.ct ? { c: this.parseIn(e.tcT) || 4, dc: this.parseIn(e.tdT) || 1.5, r: this.parseIn(e.trT) || .5 } : null;
      E.cb = cope && e.cb ? { c: this.parseIn(e.bcT) || 4, dc: this.parseIn(e.bdT) || 1.5, r: this.parseIn(e.brT) || .5 } : null;
      E.rat = cope ? e.rat : 'NONE'; E.rr = this.parseIn(e.rrT) || .75;
    }
    return E;
  }

  endSpecText(E, sec) {
    const s = [];
    if (sec.kind === 'round') {
      if (E.mode === 'miter') { s.push('MITER ' + E.ma + '\u00B0' + (E.mr ? ' ROT ' + Math.round(E.mr * 180 / Math.PI) + '\u00B0' : '')); }
      else if (E.mode === 'saddle' && E.sd) { s.push('SADDLE ' + (E.sd.custom ? '\u00D8' + E.sd.hod.toFixed(3) + '\u00D7' + E.sd.hw.toFixed(3) + 'W' : E.sd.N + '\u2033 ' + this.schedLabel(E.sd.S)) + ' @' + Math.round(E.sd.alpha * 180 / Math.PI) + '\u00B0 SET-' + (E.sd.seat === 'on' ? 'ON' : 'THRU') + (E.sd.roll ? ' ROLL ' + Math.round(E.sd.roll * 180 / Math.PI) + '\u00B0' : '')); }
      else s.push('SQUARE');
    } else {
      if (!E.tp && !E.tv) s.push('SQUARE'); else { if (E.tp) s.push('PLAN ' + E.tp + '\u00B0'); if (E.tv) s.push('VERT ' + E.tv + '\u00B0'); }
      if (E.ct) s.push('COPE T ' + this.fmtIn(E.ct.c) + '\u00D7' + this.fmtIn(E.ct.dc) + ' R' + this.fr16(E.ct.r));
      if (E.cb) s.push('COPE B ' + this.fmtIn(E.cb.c) + '\u00D7' + this.fmtIn(E.cb.dc) + ' R' + this.fr16(E.cb.r));
      if (E.rat && E.rat !== 'NONE') s.push('RAT ' + E.rat + ' R' + this.fr16(E.rr));
    }
    if (E.bv) s.push('BVL ' + E.bv + '\u00B0\u00D7' + this.fr16(E.land) + ' LAND' + (sec.kind === 'plate' ? ', OPEN ' + E.open + ' (' + E.app + ')' : ' \u2014 NOTE'));
    return s.join(' \u00B7 ');
  }

  calc() {
    const st = this.state;
    const key = JSON.stringify([st.family, st.pnps, st.psch, st.todT, st.twallT, st.hsize, st.hwallT, st.bser, st.bsize, st.cser, st.csize, st.asize, st.athkT, st.cdT, st.cbT, st.ctfT, st.ctwT, st.cwT, st.lenT, st.lenMode, st.ends, st.groups, st.wantHoles, st.mat, this.props.stations, this.props.holeSegs, !!this.D]);
    if (this._c && this._c.key === key) return this._c;
    const sec = this.sec();
    const L = this.parseIn(st.lenT);
    const warns = [];
    let c;
    if (!this.D) { c = { invalid: true, warns: [{ lvl: 'warn', t: 'Loading section database\u2026' }], sec, L: L || 120, holes: [], LP: 0, SP: 0, OAL: 0, wt: 0 }; }
    else if (L == null || L <= 0) { c = { invalid: true, warns: [{ lvl: 'err', t: 'Length won\u2019t parse \u2014 try 12\u2032-6 3/8.' }], sec, L: 120, holes: [], LP: 0, SP: 0, OAL: 0, wt: 0 }; }
    else {
      const run = (Lv, wArr) => sec.kind === 'round' ? this.calcRound(sec, Lv, wArr) : sec.kind === 'box' ? this.calcBox(sec, Lv, wArr) : sec.kind === 'angl' ? this.calcAngl(sec, Lv, wArr) : this.calcPlate(sec, Lv, wArr);
      let Lw = L;
      if (st.lenMode === 'oal') {
        // Field-tape entry: the typed length is the LONG POINT. End extensions
        // are independent of L, so one probe gives the WP-to-WP length.
        const probe = run(L, []);
        const ext = (probe.LP || L) - L;
        Lw = L - ext;
        if (Lw <= 0) { warns.push({ lvl: 'err', t: 'Long point ' + this.fmtFtIn(L) + ' is shorter than the end cuts eat \u2014 lengthen it.' }); Lw = L; }
      }
      c = run(Lw, warns);
    }
    c.key = key; c.sec = sec;
    const dup = {};
    c.warns = (c.warns || []).filter(w => { const k = w.lvl + w.t; if (dup[k]) return false; dup[k] = 1; return true; }).slice(0, 8);
    if (!c.paths) c.paths = { vb: '0 0 100 10', gridP: '', refP: '', wpP: '', outAP: '', outBP: '', outCP: '', holesP: '', lbls: [], sw: .2, swThin: .1, fs: 2, dash: '1 1' };
    this._c = c;
    return c;
  }

  roundCutFns(sec, L, A, B, warns) {
    const { ro, ri } = sec;
    const mk = (E, isA) => {
      if (E.mode === 'miter') {
        const s = isA ? -1 : 1;
        return (phi) => s * E.tanm * ro * Math.cos(phi - E.mr);
      }
      if (E.mode === 'saddle' && E.sd) {
        const { Rs, alpha, roll } = E.sd;
        const sAt = (rho, th) => (Math.sqrt(Math.max(0, Rs * Rs - Math.pow(rho * Math.sin(th), 2))) + rho * Math.cos(th) * Math.cos(alpha)) / Math.sin(alpha);
        return (phi) => {
          const th = phi - roll;
          let m = -1e9;
          for (let k = 0; k <= 16; k++) m = Math.max(m, sAt(ri + (ro - ri) * k / 16, th));
          return m;
        };
      }
      return () => 0;
    };
    for (const [E, nm] of [[A, 'A'], [B, 'B']]) {
      if (E.mode === 'saddle' && E.sd) {
        if (E.sd.badOd) warns.push({ lvl: 'err', t: 'End ' + nm + ': custom header OD won\u2019t parse \u2014 type 10.75 or 10 3/4.' });
        if (E.sd.seat === 'on' && sec.od > E.sd.hod) warns.push({ lvl: 'err', t: 'End ' + nm + ': branch OD ' + sec.od.toFixed(3) + '\u2033 is larger than its header OD ' + E.sd.hod.toFixed(3) + '\u2033.' });
        if (E.sd.seat === 'thru' && sec.od > E.sd.hid) warns.push({ lvl: 'err', t: 'End ' + nm + ': branch won\u2019t pass the header bore (ID ' + E.sd.hid.toFixed(3) + '\u2033). Use set-on.' });
      }
      if (E.mode === 'miter' && Math.abs(E.ma) > 65) warns.push({ lvl: 'warn', t: 'Miter at ' + nm + ' over 65\u00B0 \u2014 long feather edge, verify chuck clearance.' });
    }
    return { fA: mk(A, true), fB: mk(B, false) };
  }

  calcRound(sec, L, warns) {
    const st = this.state;
    const A = this.endParsed(st.ends.A, sec), B = this.endParsed(st.ends.B, sec);
    const N = parseInt(this.props.stations || '192', 10);
    const wrap = Math.PI * sec.od;
    const { fA, fB } = this.roundCutFns(sec, L, A, B, warns);
    let invalid = warns.some(w => w.lvl === 'err');
    const a = [], b = [];
    let aMin = 1e9, aMax = -1e9, bMin = 1e9, bMax = -1e9, spMin = 1e9;
    for (let i = 0; i < N; i++) {
      const phi = i / N * 2 * Math.PI;
      const xa = fA(phi);
      const xb = B.mode === 'saddle' ? L - fB(phi) : L + fB(phi);
      a.push(xa); b.push(xb);
      aMin = Math.min(aMin, xa); aMax = Math.max(aMax, xa);
      bMin = Math.min(bMin, xb); bMax = Math.max(bMax, xb);
      spMin = Math.min(spMin, xb - xa);
    }
    if (!invalid && spMin <= 0) { invalid = true; warns.push({ lvl: 'err', t: 'End cuts cross \u2014 short point \u2264 0. Lengthen the piece or ease the angles.' }); }
    const holes = this.roundHoles(sec, L, a, b, N, wrap, warns, invalid);
    const wt = sec.wtFt * (L / 12) * this.matRec().f;
    const c = { kind: 'round', invalid, warns, L, A, B, a, b, N, wrap, holes, LP: bMax - aMin, SP: spMin, OAL: bMax - aMin, aMin, bMax, wt, sec };
    c.paths = this.wrapPaths(c, [[0, '180\u00B0 BOTTOM \u00B7 SEAM'], [.25, '270\u00B0'], [.5, '0\u00B0 TOP'], [.75, '90\u00B0'], [1, '180\u00B0 BOTTOM']]);
    return c;
  }

  /** Recenter a group: pattern mode recalcs the first-hole dim; an exact-spots
   *  list shifts as a set (hole-to-hole dims preserved). Beam/channel web rows
   *  also recenter across the depth (TOS reference, symmetric about CL). */
  /** axis 'x' = along the part length; axis 'y' = across the depth (web rows). */
  centerGroup(id, axis) {
    const c = this.calc(); if (c.invalid || !(c.L > 0)) return;
    const L = c.L, d = c.sec && c.sec.d;
    this.setState(s => ({ groups: s.groups.map(g => {
      if (g.id !== id) return g;
      const patch = {};
      if (axis === 'y') {
        if (d) { const ny = Math.max(1, Math.round(parseFloat(g.nyT) || 1)), py = this.parseIn(g.pyT) ?? 0; patch.wref = 'tos'; patch.y0T = this.fmtTok((d - (ny - 1) * py) / 2); }
      } else {
        const toks = String(g.xsT || '').split(/[,;]+/).map(t => t.trim()).filter(Boolean).map(t => this.parseIn(t)).filter(v => v != null);
        if (toks.length) { const sh = (L - Math.min(...toks) - Math.max(...toks)) / 2; patch.xsT = toks.map(v => this.fmtTok(v + sh)).join(', '); }
        else { const n = Math.max(1, Math.round(parseFloat(g.nT) || 1)), p = this.parseIn(g.pT) ?? 0; patch.x0T = this.fmtTok((L - (n - 1) * p) / 2); }
      }
      return Object.assign({}, g, patch);
    }) }));
  }
  groupCenteredAx(g, c) {
    const out = { x: false, y: false };
    if (!c || c.invalid || !(c.L > 0)) return out;
    const L = c.L, eps = 1 / 32;
    const toks = String(g.xsT || '').split(/[,;]+/).map(t => t.trim()).filter(Boolean).map(t => this.parseIn(t)).filter(v => v != null);
    if (toks.length) out.x = Math.abs((Math.min(...toks) + Math.max(...toks)) / 2 - L / 2) < eps;
    else { const n = Math.max(1, Math.round(parseFloat(g.nT) || 1)), p = this.parseIn(g.pT) ?? 0, x0 = this.parseIn(g.x0T); out.x = x0 != null && Math.abs(x0 - (L - (n - 1) * p) / 2) < eps; }
    if (c.sec && c.sec.d) {
      const ny = Math.max(1, Math.round(parseFloat(g.nyT) || 1)), py = this.parseIn(g.pyT) ?? 0, y0 = this.parseIn(g.y0T), span = (ny - 1) * py;
      if (y0 != null) out.y = g.wref === 'cl' ? Math.abs(y0 + span / 2) < eps : Math.abs(y0 - (c.sec.d - span) / 2) < eps;
    }
    return out;
  }
  /** Standard/workable gauge for the current section. Beam flanges: AISC
   *  workable gauge by flange width. Channel: workable line ≈ half the flange
   *  from the back. Angle: AISC gauge-from-heel table by leg size. */
  stdGauge(g) {
    const c = this._c || this.calc(), sec = c && c.sec, fam = this.state.family;
    if (!sec) return null;
    if (fam === 'angl') {
      const leg = g.face === 'hleg' ? sec.b : sec.a;
      const T = [[7.5, 4.5], [6.5, 4], [5.5, 3.5], [4.5, 3], [3.75, 2.5], [3.25, 2], [2.75, 1.75], [2.25, 1.375], [1.75, 1.125]];
      for (const [mn, gg] of T) if (leg >= mn) return gg;
      return null;
    }
    if ((fam === 'beam' || fam === 'chan') && (g.face === 'tf' || g.face === 'bf')) {
      const bf = sec.bf; if (!bf) return null;
      if (sec.chan) return Math.max(.75, Math.round((bf / 2) * 4) / 4);
      return bf >= 7.4 ? 5.5 : bf >= 5.9 ? 3.5 : bf >= 3.9 ? 2.25 : null;
    }
    return null;
  }

  roundHoles(sec, L, a, b, N, wrap, warns, invalid) {
    const st = this.state, holes = [];
    if (!st.wantHoles || invalid || !this.D) return holes;
    for (const g of st.groups) {
      const { dia, slotL } = this.holeSize(g);
      const az0 = parseFloat(g.azT) || 0, azn = Math.max(1, Math.min(24, Math.round(parseFloat(g.aznT) || 1))), azp = parseFloat(g.azpT) || 90;
      for (const x of this.holeXs(g, L)) for (let j = 0; j < azn; j++) {
        let deg = ((az0 + j * azp) % 360 + 360) % 360;
        const u = wrap * (((deg + 180) % 360) / 360);
        const rx = slotL && g.ax === 'x' ? slotL / 2 : dia / 2;
        const ru = slotL && g.ax === 'y' ? slotL / 2 : dia / 2;
        const h = { face: 'wall', x, u, deg, dia, slotL, ax: g.ax, grp: g.id, type: g.type, bolt: this.holeBasis(g), refEnd: g.refEnd, ok: true };
        if (u - ru < 0 || u + ru > wrap) { h.ok = false; warns.push({ lvl: 'err', t: 'Hole at ' + deg + '\u00B0 crosses the program seam (180\u00B0 BOTTOM) \u2014 rotate the pattern.' }); }
        else {
          const idx = Math.round(deg / 360 * N) % N;
          if (x - rx < a[idx] + .1 || x + rx > b[idx] - .1) { h.ok = false; warns.push({ lvl: 'err', t: '\u00D8' + this.fr16(dia) + ' hole at x=' + this.fmtIn(x) + ', ' + deg + '\u00B0 runs off the end cut \u2014 skipped.' }); }
        }
        holes.push(h);
      }
    }
    if (holes.length) warns.push({ lvl: 'warn', t: 'Wall holes cut ONE wall (laser fires from outside) \u2014 near-side only.' });
    return holes;
  }

  calcBox(sec, L, warns) {
    const st = this.state;
    const A = this.endParsed(st.ends.A, sec), B = this.endParsed(st.ends.B, sec);
    const { B: W, H, t, rc } = sec;
    const stns = [];
    const seg = (n, f) => { for (let i = 0; i < n; i++) stns.push(f(i / n)); };
    const fw = W - 2 * rc, fh = H - 2 * rc, qa = Math.PI * rc / 2;
    const nf = (len) => Math.max(3, Math.min(48, Math.ceil(len / .35)));
    const nc = 9;
    seg(nf(fw / 2), (u) => ({ y: -H / 2, z: -u * fw / 2, ny: -1, nz: 0 }));
    seg(nc, (u) => { const th = u * Math.PI / 2; return { y: -(H / 2 - rc) - rc * Math.cos(th), z: -fw / 2 - rc * Math.sin(th), ny: -Math.cos(th), nz: -Math.sin(th) }; });
    seg(nf(fh), (u) => ({ y: -(H / 2 - rc) + u * fh, z: -W / 2, ny: 0, nz: -1 }));
    seg(nc, (u) => { const th = u * Math.PI / 2; return { y: H / 2 - rc + rc * Math.sin(th), z: -fw / 2 - rc * Math.cos(th), ny: Math.sin(th), nz: -Math.cos(th) }; });
    seg(nf(fw), (u) => ({ y: H / 2, z: -fw / 2 + u * fw, ny: 1, nz: 0 }));
    seg(nc, (u) => { const th = u * Math.PI / 2; return { y: H / 2 - rc + rc * Math.cos(th), z: fw / 2 + rc * Math.sin(th), ny: Math.cos(th), nz: Math.sin(th) }; });
    seg(nf(fh), (u) => ({ y: H / 2 - rc - u * fh, z: W / 2, ny: 0, nz: 1 }));
    seg(nc, (u) => { const th = u * Math.PI / 2; return { y: -(H / 2 - rc) - rc * Math.sin(th), z: fw / 2 + rc * Math.cos(th), ny: -Math.sin(th), nz: Math.cos(th) }; });
    seg(nf(fw / 2), (u) => ({ y: -H / 2, z: fw / 2 - u * fw / 2, ny: -1, nz: 0 }));
    let s = 0;
    for (let i = 0; i < stns.length; i++) {
      if (i) { const p = stns[i - 1]; s += Math.hypot(stns[i].y - p.y, stns[i].z - p.z); }
      stns[i].s = s;
    }
    const last = stns[stns.length - 1], Pm = s + Math.hypot(stns[0].y - last.y, stns[0].z - last.z);
    const a = [], b = [];
    let aMin = 1e9, bMax = -1e9, spMin = 1e9;
    for (const q of stns) {
      const xa = -q.y * A.tanv - q.z * A.tanp;
      const xb = L + q.y * B.tanv + q.z * B.tanp;
      a.push(xa); b.push(xb);
      aMin = Math.min(aMin, xa); bMax = Math.max(bMax, xb); spMin = Math.min(spMin, xb - xa);
    }
    let invalid = false;
    if (spMin <= 0) { invalid = true; warns.push({ lvl: 'err', t: 'End cuts cross \u2014 short point \u2264 0.' }); }
    const holes = this.boxHoles(sec, L, Pm, warns, invalid, a, b, stns);
    const wt = sec.wtFt * (L / 12) * this.matRec().f;
    const c = { kind: 'box', invalid, warns, L, A, B, stns, a, b, N: stns.length, wrap: Pm, holes, LP: bMax - aMin, SP: spMin, OAL: bMax - aMin, aMin, bMax, wt, sec,
      faceS: { B: 0, L: fw / 2 + qa + fh / 2, T: Pm / 2, R: Pm / 2 + fw / 2 + qa + fh / 2 }, fw, fh };
    c.paths = this.wrapPaths(c, [[0, 'BOTTOM CL \u00B7 SEAM'], [c.faceS.L / Pm, 'LEFT'], [.5, 'TOP CL'], [c.faceS.R / Pm, 'RIGHT'], [1, 'BOTTOM CL']]);
    return c;
  }

  boxHoles(sec, L, Pm, warns, invalid, a, b, stns) {
    const st = this.state, holes = [];
    if (!st.wantHoles || invalid || !this.D) return holes;
    const fw = sec.B - 2 * sec.rc, fh = sec.H - 2 * sec.rc, qa = Math.PI * sec.rc / 2;
    const faceS = { B: 0, L: fw / 2 + qa + fh / 2, T: Pm / 2, R: Pm / 2 + fw / 2 + qa + fh / 2 };
    const half = { T: fw / 2, B: fw / 2, R: fh / 2, L: fh / 2 };
    for (const g of st.groups) {
      const { dia, slotL } = this.holeSize(g);
      const off = this.parseIn(g.offT) || 0;
      const face = ['T', 'R', 'B', 'L'].includes(g.face) ? g.face : 'T';
      const dir = face === 'T' ? 1 : face === 'R' ? -1 : face === 'B' ? -1 : 1;
      for (const x of this.holeXs(g, L)) {
        let u = faceS[face] + dir * off;
        u = ((u % Pm) + Pm) % Pm;
        const rx = slotL && g.ax === 'x' ? slotL / 2 : dia / 2;
        const ru = slotL && g.ax === 'y' ? slotL / 2 : dia / 2;
        const h = { face, x, u, off, dia, slotL, ax: g.ax, grp: g.id, type: g.type, bolt: this.holeBasis(g), refEnd: g.refEnd, ok: true };
        if (u - ru < 0 || u + ru > Pm) { h.ok = false; warns.push({ lvl: 'err', t: 'Hole on ' + face + ' face crosses the program seam (bottom face CL) \u2014 nudge the offset off center.' }); }
        else if (Math.abs(off) + ru > half[face] - .05) { h.ok = false; warns.push({ lvl: 'err', t: 'Hole on ' + face + ' face at offset ' + this.fmtIn(off) + ' runs into the corner radius \u2014 skipped.' }); }
        else {
          let bi = 0, bd = 1e9;
          for (let k = 0; k < stns.length; k++) { const d = Math.abs(stns[k].s - u); if (d < bd) { bd = d; bi = k; } }
          if (x - rx < a[bi] + .1 || x + rx > b[bi] - .1) { h.ok = false; warns.push({ lvl: 'err', t: '\u00D8' + this.fr16(dia) + ' hole at x=' + this.fmtIn(x) + ' (' + face + ') runs off the end cut \u2014 skipped.' }); }
        }
        holes.push(h);
      }
    }
    if (holes.length) warns.push({ lvl: 'warn', t: 'Holes cut ONE wall (laser fires from outside) \u2014 near-side only.' });
    return holes;
  }

  wrapPaths(c, marks) {
    if (c.invalid) return { vb: '0 0 100 10', gridP: '', refP: '', wpP: '', outAP: '', outBP: '', outCP: '', holesP: '', lbls: [], sw: .2, swThin: .1, fs: 2, dash: '1 1' };
    const { a, b, N, wrap, L, holes } = c;
    const x0 = Math.min(c.aMin, 0) - 1.5, x1 = Math.max(c.bMax, L) + 1.5;
    const span = x1 - x0, fs = Math.max(span, wrap * 1.4) / 95;
    const sh = c.stns ? 0 : N / 2;
    const av = (i) => a[(i + sh) % N], bv = (i) => b[(i + sh) % N];
    const ys = (i) => i >= N ? wrap : (c.stns ? c.stns[i].s : wrap * i / N);
    let d = '';
    for (let i = 0; i <= N; i++) d += (i ? 'L' : 'M') + av(i).toFixed(3) + ' ' + ys(i).toFixed(3);
    for (let i = N; i >= 0; i--) d += 'L' + bv(i).toFixed(3) + ' ' + ys(i).toFixed(3);
    d += 'Z';
    let gridP = '';
    for (let x = 12; x < L; x += 12) gridP += 'M' + x + ' 0V' + wrap.toFixed(2);
    let refP = '';
    const lbls = [];
    for (const [f, t] of marks) {
      const y = wrap * f;
      refP += 'M' + (x0 + .3).toFixed(2) + ' ' + y.toFixed(3) + 'H' + (x1 - .3).toFixed(2);
      lbls.push({ x: x0 + fs * .4, y: y - fs * .35, t, s: { font: '500 ' + (fs * .85) + 'px JetBrains Mono, monospace', fill: '#5C6670' } });
    }
    const wpP = 'M0 -' + (fs * .8).toFixed(2) + 'V' + (wrap + fs * .8).toFixed(2) + 'M' + L + ' -' + (fs * .8).toFixed(2) + 'V' + (wrap + fs * .8).toFixed(2);
    let holesP = '';
    for (const h of holes) {
      if (!h.ok) continue;
      const pts = h.slotL ? this.slotPts(h.x, h.u, h.slotL, h.dia, h.ax === 'x', 20, false) : this.circPts(h.x, h.u, h.dia / 2, 20, false);
      holesP += 'M' + pts.map(p => p[0].toFixed(3) + ' ' + p[1].toFixed(3)).join('L') + 'Z';
    }
    return { vb: x0.toFixed(2) + ' ' + (-fs * 2.2).toFixed(2) + ' ' + span.toFixed(2) + ' ' + (wrap + fs * 4).toFixed(2), gridP, refP, wpP, outAP: d, outBP: '', outCP: '', holesP, lbls, sw: span / 900 * 1.6, swThin: span / 900, fs, dash: (fs * .5).toFixed(2) + ' ' + (fs * .35).toFixed(2) };
  }

  calcPlate(sec, L, warns) {
    const st = this.state;
    const { d, bf, tf, tw } = sec;
    const hw = d / 2 - tf;
    const zL = sec.chan ? -tw / 2 : -bf / 2, zR = sec.chan ? bf - tw / 2 : bf / 2;
    const A = this.endParsed(st.ends.A, sec), B = this.endParsed(st.ends.B, sec);
    let invalid = false;
    if (tf >= d / 2) { invalid = true; warns.push({ lvl: 'err', t: 'Flange thickness \u2265 half depth \u2014 no web left.' }); }
    const Ln = L;
    const xA = (y, z) => -y * A.tanv - z * A.tanp;
    const xB = (y, z) => Ln + y * B.tanv + z * B.tanp;
    for (const [E, nm] of [[A, 'A'], [B, 'B']]) {
      for (const cc of [E.ct, E.cb]) {
        if (!cc) continue;
        if (cc.dc < tf) { cc.dc = tf; warns.push({ lvl: 'warn', t: 'Cope depth at ' + nm + ' raised to flange thickness (' + this.fmtIn(tf) + ').' }); }
        if (cc.dc > d - tf - 0.25) { cc.dc = d - tf - 0.25; warns.push({ lvl: 'err', t: 'Cope at ' + nm + ' nearly severs the web \u2014 depth clamped.' }); }
        if (cc.r > Math.min(cc.c, cc.dc)) cc.r = Math.min(cc.c, cc.dc) * 0.9;
      }
      if (E.rat !== 'NONE' && ((E.ct && (E.rat === 'TOP' || E.rat === 'BOTH')) || (E.cb && (E.rat === 'BOT' || E.rat === 'BOTH'))))
        warns.push({ lvl: 'warn', t: 'Rat hole at ' + nm + ' skipped where a cope owns that corner.' });
      if (E.rr * 2 > hw) E.rr = hw / 2.2;
    }
    if ((A.ct && B.ct && A.ct.c + B.ct.c > Ln) || (A.cb && B.cb && A.cb.c + B.cb.c > Ln)) { invalid = true; warns.push({ lvl: 'err', t: 'Copes overlap \u2014 longer than the piece.' }); }
    const corners = [[d / 2, zL], [d / 2, zR], [-d / 2, zL], [-d / 2, zR]];
    let aMin = 1e9, aMax = -1e9, bMin = 1e9, bMax = -1e9;
    for (const [y, z] of corners) { const a = xA(y, z), b = xB(y, z); aMin = Math.min(aMin, a); aMax = Math.max(aMax, a); bMin = Math.min(bMin, b); bMax = Math.max(bMax, b); }
    const LP = bMax - aMin, SP = bMin - aMax;
    if (!invalid && SP <= 0) { invalid = true; warns.push({ lvl: 'err', t: 'End cuts cross \u2014 short point \u2264 0. Shorten angles or lengthen the piece.' }); }
    const FIL = 10, RAT = 14;
    const webPts = [];
    const push = (p) => { const l = webPts[webPts.length - 1]; if (!l || Math.abs(l[0] - p[0]) > 1e-6 || Math.abs(l[1] - p[1]) > 1e-6) webPts.push(p); };
    const endEdge = (end, y1, y2) => {
      const xf = end === 'A' ? xA : xB;
      const P = end === 'A' ? A : B;
      const p1 = [xf(y1, 0), y1], p2 = [xf(y2, 0), y2];
      const dx = p2[0] - p1[0], dy = p2[1] - p1[1], len = Math.hypot(dx, dy) || 1;
      const ex = dx / len, ey = dy / len;
      let nx = -ey, ny = ex;
      if ((end === 'A' && nx < 0) || (end === 'B' && nx > 0)) { nx = -nx; ny = -ny; }
      const rats = [];
      if ((P.rat === 'TOP' || P.rat === 'BOTH') && !P.ct) rats.push(hw - P.rr);
      if ((P.rat === 'BOT' || P.rat === 'BOTH') && !P.cb) rats.push(-hw + P.rr);
      rats.sort((a, b) => (y2 > y1 ? a - b : b - a));
      push(p1);
      for (const yc of rats) {
        if ((yc - y1) * (yc - y2) > 0) continue;
        const t = (yc - y1) / (y2 - y1 || 1);
        const C = [p1[0] + dx * t, p1[1] + dy * t];
        const r = P.rr;
        for (let i = 0; i <= RAT; i++) {
          const ph = -Math.PI / 2 + Math.PI * i / RAT;
          push([C[0] + r * (Math.sin(ph) * ex + Math.cos(ph) * nx), C[1] + r * (Math.sin(ph) * ey + Math.cos(ph) * ny)]);
        }
      }
      push(p2);
    };
    const ybA = A.cb ? -d / 2 + A.cb.dc : -hw, ytA = A.ct ? d / 2 - A.ct.dc : hw;
    const ybB = B.cb ? -d / 2 + B.cb.dc : -hw, ytB = B.ct ? d / 2 - B.ct.dc : hw;
    if (!invalid) {
      if (A.cb) {
        const { c, r } = A.cb;
        push([xA(ybA, 0), ybA]); push([c - r, ybA]);
        this.arcPts(c - r, ybA - r, r, Math.PI / 2, 0, FIL).forEach(push);
        push([c, -hw]);
      } else push([xA(-hw, 0), -hw]);
      if (B.cb) {
        const { c, r } = B.cb; const cx = Ln - c;
        push([cx, -hw]); push([cx, ybB - r]);
        this.arcPts(cx + r, ybB - r, r, Math.PI, Math.PI / 2, FIL).forEach(push);
        push([xB(ybB, 0), ybB]);
      } else push([xB(-hw, 0), -hw]);
      endEdge('B', ybB, ytB);
      if (B.ct) {
        const { c, r } = B.ct; const cx = Ln - c;
        push([cx + r, ytB]);
        this.arcPts(cx + r, ytB + r, r, 3 * Math.PI / 2, Math.PI, FIL).forEach(push);
        push([cx, hw]);
      } else push([xB(hw, 0), hw]);
      if (A.ct) {
        const { c, r } = A.ct;
        push([c, hw]); push([c, ytA + r]);
        this.arcPts(c - r, ytA + r, r, 0, -Math.PI / 2, FIL).forEach(push);
        push([xA(ytA, 0), ytA]);
      } else push([xA(hw, 0), hw]);
      endEdge('A', ytA, ybA);
    }
    // endEdge('A') closes back onto the first web point; drop that duplicate so the
    // DXF has no zero-length segment and slabMesh indexes cleanly.
    if (webPts.length > 3) { const f = webPts[0], l = webPts[webPts.length - 1]; if (Math.abs(f[0] - l[0]) < 1e-6 && Math.abs(f[1] - l[1]) < 1e-6) webPts.pop(); }
    let web = webPts;
    if (web.length > 2 && this.area(web) < 0) web = web.slice().reverse();
    const flgOut = (which) => {
      const yface = which === 'tf' ? d / 2 : -d / 2;
      const ca = which === 'tf' ? A.ct : A.cb, cb2 = which === 'tf' ? B.ct : B.cb;
      const xa = (z) => ca ? ca.c : xA(yface, z);
      const xb = (z) => cb2 ? Ln - cb2.c : xB(yface, z);
      const pts = [[xa(zL), zL], [xb(zL), zL], [xb(zR), zR], [xa(zR), zR]];
      return this.area(pts) < 0 ? pts.reverse() : pts;
    };
    const tfO = invalid ? [] : flgOut('tf'), bfO = invalid ? [] : flgOut('bf');
    const holes = [];
    if (st.wantHoles && this.D) for (const g of st.groups) {
      const { dia, slotL } = this.holeSize(g);
      const gxs = this.holeXs(g, Ln);
      if (g.face === 'web') {
        const y0 = this.parseIn(g.y0T) ?? 3, py = this.parseIn(g.pyT) ?? 3;
        const ny = Math.max(1, Math.min(30, Math.round(parseFloat(g.nyT) || 1)));
        const list = [];
        for (let j = 0; j < ny; j++) {
          let y;
          if (g.wref === 'tos') y = d / 2 - y0 - j * py;
          else if (g.wref === 'bos') y = -d / 2 + y0 + j * py;
          else y = -(y0 + j * py);
          list.push(y);
        }
        for (const x of gxs) for (const y of list) {
          holes.push({ face: 'web', x, c: y, dia, slotL, ax: g.ax, grp: g.id, type: g.type, bolt: this.holeBasis(g), refEnd: g.refEnd });
        }
      } else {
        const zs = [];
        const gv = this.parseIn(g.gT) ?? 3.5;
        if (g.amode === 'gauge') { if (sec.chan) zs.push(zL + gv); else { zs.push(-gv / 2, gv / 2); } }
        else zs.push(sec.chan ? zL + gv : gv);
        for (const x of gxs) for (const z of zs) {
          holes.push({ face: g.face, x, c: z, dia, slotL, ax: g.ax, grp: g.id, type: g.type, bolt: this.holeBasis(g), refEnd: g.refEnd });
        }
      }
    }
    const outlFor = { web, tf: tfO, bf: bfO };
    for (const h of holes) {
      const rx = h.slotL && h.ax === 'x' ? h.slotL / 2 : h.dia / 2;
      const ry = h.slotL && h.ax === 'y' ? h.slotL / 2 : h.dia / 2;
      const O = outlFor[h.face] || [];
      h.ok = !invalid && O.length > 2;
      if (h.ok) {
        const tests = [[h.x - rx, h.c], [h.x + rx, h.c], [h.x, h.c - ry], [h.x, h.c + ry], [h.x, h.c]];
        for (const t of tests) if (!this.pip(t, O)) { h.ok = false; break; }
      }
      if (!h.ok && !invalid) warns.push({ lvl: 'err', t: '\u00D8' + this.fr16(h.dia) + ' hole at x=' + this.fmtIn(h.x) + ' (' + h.face.toUpperCase() + ') falls off the material / in a cope \u2014 skipped.' });
      else if (h.ok && h.face === 'web' && Math.abs(h.c) > hw - 0.35 - ry) warns.push({ lvl: 'warn', t: 'Web hole at x=' + this.fmtIn(h.x) + ' is tight to the flange fillet (k-zone) \u2014 verify.' });
      const bolt = this.frIn(h.bolt) || h.dia;
      if (h.ok) {
        const edgeA = h.x - xA(h.face === 'web' ? h.c : (h.face === 'tf' ? d / 2 : -d / 2), h.face === 'web' ? 0 : h.c);
        const edgeB = xB(h.face === 'web' ? h.c : (h.face === 'tf' ? d / 2 : -d / 2), h.face === 'web' ? 0 : h.c) - h.x;
        if (Math.min(edgeA, edgeB) - rx < 1.25 * bolt && Math.min(edgeA, edgeB) - rx > 0) warns.push({ lvl: 'warn', t: 'Edge distance ' + this.fmtIn(Math.min(edgeA, edgeB)) + ' at x=' + this.fmtIn(h.x) + ' < 1.25\u00D7bolt \u2014 check J3.4.' });
      }
    }
    const wt = sec.wtFt * (Ln / 12) * this.matRec().f;
    const c = { kind: 'plate', invalid, warns, L: Ln, A, B, hw, zL, zR, web, tfO, bfO, holes, LP, SP, OAL: LP, wt, sec, aMin, bMax, xAf: xA, xBf: xB };
    c.paths = this.platePaths(c);
    return c;
  }

  platePaths(c) {
    if (c.invalid) return null;
    const { sec, zL, zR, L, web, tfO, bfO, holes, aMin, bMax } = c;
    const Wb = zR - zL, gap = Math.max(1.2, sec.d * .12);
    const oTf = 0, oWeb = Wb + gap, oBf = Wb + gap + sec.d + gap;
    const H = oBf + Wb;
    const mTf = (p) => [p[0], oTf + (p[1] - zL)];
    const mWeb = (p) => [p[0], oWeb + (sec.d / 2 - p[1])];
    const mBf = (p) => [p[0], oBf + (zR - p[1])];
    const path = (pts, map) => pts.length ? 'M' + pts.map(p => { const q = map(p); return q[0].toFixed(3) + ' ' + q[1].toFixed(3); }).join('L') + 'Z' : '';
    let holesP = '';
    for (const h of holes) {
      if (!h.ok) continue;
      const map = h.face === 'tf' ? mTf : h.face === 'bf' ? mBf : mWeb;
      const pts = h.slotL ? this.slotPts(h.x, h.c, h.slotL, h.dia, h.ax === 'x', 20, false) : this.circPts(h.x, h.c, h.dia / 2, 20, false);
      holesP += path(pts, map);
    }
    const x0 = Math.min(aMin, 0) - 1.5, x1 = Math.max(bMax, L) + 1.5;
    let gridP = '';
    for (let x = 12; x < L; x += 12) gridP += 'M' + x + ' ' + (oTf - .4) + 'V' + (H + .4);
    let wpP = 'M0 ' + (oTf - .6) + 'V' + (H + .6) + 'M' + L + ' ' + (oTf - .6) + 'V' + (H + .6);
    const span = x1 - x0;
    const fs = span / 95;
    const lS = { font: '500 ' + fs + 'px JetBrains Mono, monospace', fill: '#7E8893' };
    return {
      vb: x0.toFixed(2) + ' ' + (-fs * 1.6).toFixed(2) + ' ' + span.toFixed(2) + ' ' + (H + fs * 3.4).toFixed(2),
      gridP, refP: '', wpP,
      outAP: path(tfO, mTf), outBP: path(web, mWeb), outCP: path(bfO, mBf),
      holesP, fs, sw: span / 900 * 1.6, swThin: span / 900, dash: (fs * .5).toFixed(2) + ' ' + (fs * .35).toFixed(2),
      lbls: [
        { x: x0 + fs * .6, y: oTf - fs * .45, t: 'TOP FLG — FROM ABOVE', s: lS },
        { x: x0 + fs * .6, y: oWeb - gap * .18, t: 'WEB — ELEVATION', s: lS },
        { x: x0 + fs * .6, y: oBf - gap * .18, t: 'BOT FLG — FROM BELOW (MIRRORED)', s: lS }
      ]
    };
  }

  calcAngl(sec, L, warns) {
    const st = this.state;
    const { a, b, t } = sec;
    const A = this.endParsed(st.ends.A, sec), B = this.endParsed(st.ends.B, sec);
    const Ln = L;
    const xA = (y, z) => -y * A.tanv - z * A.tanp;
    const xB = (y, z) => Ln + y * B.tanv + z * B.tanp;
    const xaV = (y) => xA(y, t / 2), xbV = (y) => xB(y, t / 2);
    const xaH = (z) => xA(t / 2, z), xbH = (z) => xB(t / 2, z);
    let vleg = [[xaV(0), 0], [xbV(0), 0], [xbV(a), a], [xaV(a), a]];
    let hleg = [[xaH(t), t], [xbH(t), t], [xbH(b), b], [xaH(b), b]];
    if (this.area(vleg) < 0) vleg = vleg.reverse();
    if (this.area(hleg) < 0) hleg = hleg.reverse();
    let aMin = 1e9, aMax = -1e9, bMin = 1e9, bMax = -1e9;
    for (const [y, z] of [[0, t / 2], [a, t / 2], [t / 2, t], [t / 2, b]]) {
      const xa = xA(y, z), xb = xB(y, z);
      aMin = Math.min(aMin, xa); aMax = Math.max(aMax, xa); bMin = Math.min(bMin, xb); bMax = Math.max(bMax, xb);
    }
    const LP = bMax - aMin, SP = bMin - aMax;
    let invalid = false;
    if (SP <= 0) { invalid = true; warns.push({ lvl: 'err', t: 'End cuts cross \u2014 short point \u2264 0.' }); }
    const holes = [];
    if (st.wantHoles && this.D && !invalid) for (const g of st.groups) {
      const { dia, slotL } = this.holeSize(g);
      const gv = this.parseIn(g.gT) ?? 1.75;
      const face = g.face === 'hleg' ? 'hleg' : 'vleg';
      for (const x of this.holeXs(g, Ln)) {
        const h = { face, x, c: gv, dia, slotL, ax: g.ax, grp: g.id, type: g.type, bolt: this.holeBasis(g), refEnd: g.refEnd, ok: true };
        const O = face === 'vleg' ? vleg : hleg;
        const rx = slotL && g.ax === 'x' ? slotL / 2 : dia / 2;
        const ry = slotL && g.ax === 'y' ? slotL / 2 : dia / 2;
        const tests = [[x - rx, gv], [x + rx, gv], [x, gv - ry], [x, gv + ry]];
        for (const q of tests) if (!this.pip(q, O)) { h.ok = false; break; }
        if (!h.ok) warns.push({ lvl: 'err', t: '\u00D8' + this.fr16(dia) + ' hole at x=' + this.fmtIn(x) + ' (' + (face === 'vleg' ? 'VERT' : 'HORIZ') + ' LEG, g=' + this.fmtIn(gv) + ') falls off the leg \u2014 skipped.' });
        holes.push(h);
      }
    }
    const wt = sec.wtFt * (Ln / 12) * this.matRec().f;
    const c = { kind: 'angl', invalid, warns, L: Ln, A, B, vleg, hleg, holes, LP, SP, OAL: LP, wt, sec, aMin, bMax };
    c.paths = this.anglPaths(c);
    return c;
  }

  anglPaths(c) {
    if (c.invalid) return null;
    const { sec, L, vleg, hleg, holes, aMin, bMax } = c;
    const { a, b, t } = sec;
    const gap = Math.max(1.2, Math.max(a, b) * .18);
    const oV = 0, oH = a + gap;
    const H = oH + (b - t);
    const mV = (p) => [p[0], oV + (a - p[1])];
    const mH = (p) => [p[0], oH + (p[1] - t)];
    const path = (pts, map) => pts.length ? 'M' + pts.map(p => { const q = map(p); return q[0].toFixed(3) + ' ' + q[1].toFixed(3); }).join('L') + 'Z' : '';
    let holesP = '';
    for (const h of holes) {
      if (!h.ok) continue;
      const map = h.face === 'vleg' ? mV : mH;
      const pts = h.slotL ? this.slotPts(h.x, h.c, h.slotL, h.dia, h.ax === 'x', 20, false) : this.circPts(h.x, h.c, h.dia / 2, 20, false);
      holesP += path(pts, map);
    }
    const x0 = Math.min(aMin, 0) - 1.5, x1 = Math.max(bMax, L) + 1.5;
    let gridP = '';
    for (let x = 12; x < L; x += 12) gridP += 'M' + x + ' ' + (oV - .4) + 'V' + (H + .4);
    const wpP = 'M0 ' + (oV - .6) + 'V' + (H + .6) + 'M' + L + ' ' + (oV - .6) + 'V' + (H + .6);
    const span = x1 - x0, fs = span / 95;
    const lS = { font: '500 ' + fs + 'px JetBrains Mono, monospace', fill: '#7E8893' };
    return {
      vb: x0.toFixed(2) + ' ' + (-fs * 1.6).toFixed(2) + ' ' + span.toFixed(2) + ' ' + (H + fs * 3.4).toFixed(2),
      gridP, refP: '', wpP,
      outAP: path(vleg, mV), outBP: path(hleg, mH), outCP: '',
      holesP, fs, sw: span / 900 * 1.6, swThin: span / 900, dash: (fs * .5).toFixed(2) + ' ' + (fs * .35).toFixed(2),
      lbls: [
        { x: x0 + fs * .6, y: oV - fs * .45, t: 'VERT LEG — ELEVATION (HEEL DOWN)', s: lS },
        { x: x0 + fs * .6, y: oH - gap * .18, t: 'HORIZ LEG — FROM ABOVE (HEEL AT TOP)', s: lS }
      ]
    };
  }

  /** Mouse event on the band SVG → viewBox coordinates (accounts for the
   *  xMidYMid meet letterboxing). Null when the part is invalid. */
  bandXY(e) {
    const c = this.calc();
    if (c.invalid || !this.D || !c.paths || !c.paths.vb) return null;
    const r = e.currentTarget.getBoundingClientRect();
    const vb = c.paths.vb.split(' ').map(Number);
    const sc = Math.min(r.width / vb[2], r.height / vb[3]);
    if (!(sc > 0)) return null;
    return {
      c,
      px: vb[0] + (e.clientX - r.left - (r.width - vb[2] * sc) / 2) / sc,
      py: vb[1] + (e.clientY - r.top - (r.height - vb[3] * sc) / 2) / sc
    };
  }

  /** Invert a click/hover on the flat band into part coordinates: which face,
   *  the group spec that puts a hole there (snap 1/16\u2033 / 5\u00B0), a live dimension
   *  readout, and the band position for the ghost marker. */
  bandSpot(c, px, py) {
    const L = c.L;
    const x = Math.round(Math.max(0, Math.min(L, px)) * 16) / 16;
    const posTxt = this.fmtIn(x) + ' FROM A \u00B7 ' + this.fmtIn(L - x) + ' FROM B';
    if (c.kind === 'round') {
      if (py < -0.001 || py > c.wrap + 0.001) return null;
      const deg = Math.round((((py / c.wrap) * 360 - 180 + 360) % 360) / 5) * 5 % 360;
      const u = c.wrap * (((deg + 180) % 360) / 360);
      return { x, spec: { face: 'wall', azT: String(deg), aznT: '1', azpT: '90' }, bandY: (h) => h.u,
        label: posTxt + ' \u00B7 ' + deg + '\u00B0 FROM TOP', gx: x, gy: u };
    }
    if (c.kind === 'box') {
      const Pm = c.wrap;
      if (py < -0.001 || py > Pm + 0.001) return null;
      const half = { T: c.fw / 2, B: c.fw / 2, R: c.fh / 2, L: c.fh / 2 };
      const dirF = { T: 1, R: -1, B: -1, L: 1 };
      let best = null;
      for (const f of ['T', 'R', 'B', 'L']) {
        let dd = py - c.faceS[f];
        dd = ((dd + Pm / 2) % Pm + Pm) % Pm - Pm / 2;
        if (best == null || Math.abs(dd) < Math.abs(best.dd)) best = { f, dd };
      }
      const off = Math.round(Math.max(-half[best.f], Math.min(half[best.f], dirF[best.f] * best.dd)) * 16) / 16;
      const gy = ((c.faceS[best.f] + dirF[best.f] * off) % Pm + Pm) % Pm;
      return { x, spec: { face: best.f, offT: this.fmtTok(off) }, bandY: (h) => h.u,
        label: posTxt + ' \u00B7 ' + best.f + ' FACE, ' + this.fmtTok(off) + '\u2033 OFF CL', gx: x, gy };
    }
    if (c.kind === 'plate') {
      const { sec, zL, zR } = c;
      const Wb = zR - zL, gap = Math.max(1.2, sec.d * .12);
      const oWeb = Wb + gap, oBf = Wb + gap + sec.d + gap;
      if (py <= Wb + gap / 2) {
        const z = Math.round((zL + Math.max(0, Math.min(Wb, py))) * 16) / 16;
        const gv = sec.chan ? z - zL : z;
        return { x, spec: { face: 'tf', amode: 'off', gT: this.fmtTok(gv) }, bandY: (h) => h.c - zL,
          label: posTxt + ' \u00B7 TOP FLG, ' + this.fmtTok(gv) + '\u2033 ' + (sec.chan ? 'FROM BACK' : 'OFF WEB CL'), gx: x, gy: z - zL };
      }
      if (py <= oWeb + sec.d + gap / 2) {
        const yo = Math.round((Math.max(0, Math.min(sec.d, py - oWeb))) * 16) / 16;
        return { x, spec: { face: 'web', wref: 'tos', y0T: this.fmtTok(yo), nyT: '1' }, bandY: (h) => oWeb + (sec.d / 2 - h.c),
          label: posTxt + ' \u00B7 WEB, ' + this.fmtTok(yo) + '\u2033 DOWN FROM TOS', gx: x, gy: oWeb + yo };
      }
      const z = Math.round((zR - Math.max(0, Math.min(Wb, py - oBf))) * 16) / 16;
      const gv = sec.chan ? z - zL : z;
      return { x, spec: { face: 'bf', amode: 'off', gT: this.fmtTok(gv) }, bandY: (h) => oBf + (zR - h.c),
        label: posTxt + ' \u00B7 BOT FLG, ' + this.fmtTok(gv) + '\u2033 ' + (sec.chan ? 'FROM BACK' : 'OFF WEB CL'), gx: x, gy: oBf + (zR - z) };
    }
    const { sec } = c;
    const gap = Math.max(1.2, Math.max(sec.a, sec.b) * .18);
    const oH = sec.a + gap;
    if (py <= sec.a + gap / 2) {
      const gv = Math.round(Math.max(0, Math.min(sec.a, sec.a - py)) * 16) / 16;
      return { x, spec: { face: 'vleg', gT: this.fmtTok(gv) }, bandY: (h) => sec.a - h.c,
        label: posTxt + ' \u00B7 VERT LEG, g=' + this.fmtTok(gv) + '\u2033 FROM HEEL', gx: x, gy: sec.a - gv };
    }
    const gv = Math.round(Math.max(sec.t, Math.min(sec.b, sec.t + (py - oH))) * 16) / 16;
    return { x, spec: { face: 'hleg', gT: this.fmtTok(gv) }, bandY: (h) => oH + (h.c - sec.t),
      label: posTxt + ' \u00B7 HORIZ LEG, g=' + this.fmtTok(gv) + '\u2033 FROM HEEL', gx: x, gy: oH + (gv - sec.t) };
  }

  /** Hole under the cursor, if any. */
  bandHit(c, sp, px, py) {
    for (const h of c.holes) {
      if (h.face !== sp.spec.face) continue;
      const rx = Math.max(h.slotL && h.ax === 'x' ? h.slotL / 2 : h.dia / 2, .4);
      const ry = Math.max(h.slotL && h.ax === 'y' ? h.slotL / 2 : h.dia / 2, .4);
      if (Math.abs(h.x - px) <= rx && Math.abs(sp.bandY(h) - py) <= ry) return h;
    }
    return null;
  }

  /** Click on the flat band: add a hole where clicked, or remove a click-placed
   *  hole. Clicks land in an exact-spots group per face. */
  bandPlace(c, px, py) {
    const st = this.state, L = c.L;
    const sp = this.bandSpot(c, px, py);
    if (!sp) return;
    const x = sp.x, spec = sp.spec;
    const hit = this.bandHit(c, sp, px, py);
    if (hit) {
      const g = st.groups.find(q => q.id === hit.grp);
      if (!g || !String(g.xsT || '').trim()) return; // pattern hole \u2014 drag it, or edit its group in the sidebar
      const toks = String(g.xsT).split(/[,;]+/).map(t => t.trim()).filter(Boolean);
      const target = g.refEnd === 'A' ? hit.x : L - hit.x;
      let bi = -1, bd = 1e9;
      toks.forEach((t, i) => { const v = this.parseIn(t); if (v != null && Math.abs(v - target) < bd) { bd = Math.abs(v - target); bi = i; } });
      if (bi >= 0) toks.splice(bi, 1);
      this.setState(s => ({ step: 4, groups: toks.length ? s.groups.map(q => q.id === g.id ? Object.assign({}, q, { xsT: toks.join(', ') }) : q) : s.groups.filter(q => q.id !== g.id) }));
      return;
    }
    // Add: append to the matching exact-spots group for this face/line, else start one.
    const sig = (q) => JSON.stringify(c.kind === 'round' ? ['wall', q.azT, q.aznT] : c.kind === 'box' ? [q.face, q.offT] : q.face === 'web' ? [q.face, q.wref, q.y0T, q.nyT] : [q.face, q.amode || '', q.gT]);
    const want = sig(Object.assign({}, Component.defGroup(0, st.family), spec));
    let tg = null;
    if (st.wantHoles) for (const q of st.groups) if (String(q.xsT || '').trim() && sig(q) === want) tg = q;
    if (tg) {
      const tok = this.fmtTok(tg.refEnd === 'A' ? x : L - x);
      this.setState(s => ({ step: 4, wantHoles: true, groups: s.groups.map(q => q.id === tg.id ? Object.assign({}, q, { xsT: String(q.xsT).trim() + ', ' + tok }) : q) }));
    } else {
      this.setState(s => ({
        step: 4, wantHoles: true, gid: s.gid + 1,
        groups: (s.wantHoles ? s.groups : []).concat([Object.assign(Component.defGroup(s.gid, st.family), spec, { refEnd: 'A', xsT: this.fmtTok(x) })])
      }));
    }
  }

  /** Mouse-down on the band: if it lands on a hole, arm a drag. Exact-spot
   *  holes slide one at a time; pattern holes slide their whole group. */
  bandDown(c, px, py) {
    this._dragMoved = false;
    this._drag = null;
    const sp = this.bandSpot(c, px, py);
    if (!sp) return;
    const hit = this.bandHit(c, sp, px, py);
    if (!hit) return;
    const g = this.state.groups.find(q => q.id === hit.grp);
    if (!g) return;
    if (String(g.xsT || '').trim()) {
      const toks = String(g.xsT).split(/[,;]+/).map(t => t.trim()).filter(Boolean);
      const target = g.refEnd === 'A' ? hit.x : c.L - hit.x;
      let bi = -1, bd = 1e9;
      toks.forEach((t, i) => { const v = this.parseIn(t); if (v != null && Math.abs(v - target) < bd) { bd = Math.abs(v - target); bi = i; } });
      if (bi >= 0) this._drag = { mode: 'list', gid: g.id, tokIdx: bi, startX: hit.x };
    } else {
      this._drag = { mode: 'pitch', gid: g.id, startX: sp.x, origX0: this.parseIn(g.x0T) ?? 3 };
    }
  }

  /** Mouse-move on the band: refresh the dimension readout, and apply an armed
   *  drag \u2014 slide the grabbed hole (or whole pattern) along the piece. */
  bandMove(c, px, py, buttons) {
    const sp = this.bandSpot(c, px, py);
    if (!sp) { if (this.state.hovL) this.setState({ hovL: '', hovGx: 0, hovGy: 0 }); return; }
    const d = this._drag;
    if (d && buttons) {
      const g = this.state.groups.find(q => q.id === d.gid);
      if (g) {
        if (Math.abs(sp.x - d.startX) >= 1 / 16) this._dragMoved = true;
        if (d.mode === 'list') {
          const toks = String(g.xsT).split(/[,;]+/).map(t => t.trim()).filter(Boolean);
          const tok = this.fmtTok(g.refEnd === 'A' ? sp.x : c.L - sp.x);
          if (toks[d.tokIdx] !== tok) { toks[d.tokIdx] = tok; this.setState(s => ({ groups: s.groups.map(q => q.id === g.id ? Object.assign({}, q, { xsT: toks.join(', ') }) : q) })); }
        } else {
          const delta = sp.x - d.startX;
          const nx0 = this.fmtTok(Math.max(0, d.origX0 + (g.refEnd === 'A' ? delta : -delta)));
          if (g.x0T !== nx0) this.setState(s => ({ groups: s.groups.map(q => q.id === g.id ? Object.assign({}, q, { x0T: nx0 }) : q) }));
        }
      }
    }
    const label = (d && buttons ? 'MOVING \u2014 ' : '') + sp.label;
    if (this.state.hovL !== label || Math.abs(this.state.hovGx - sp.gx) > 1e-9 || Math.abs(this.state.hovGy - sp.gy) > 1e-9)
      this.setState({ hovL: label, hovGx: sp.gx, hovGy: sp.gy });
  }


  fileBase() {
    const st = this.state, c = this.calc();
    return ((st.mark || 'part') + '_' + c.sec.label + '_' + (c.L ? Math.round(c.L * 16) / 16 : 0) + 'in').replace(/[^\w.-]+/g, '-');
  }

  componentDidMount() { this._syncSel(); this._start(); }
  componentDidUpdate() { this._syncSel(); this._queue(); this._persist(); }
  _syncSel() { document.querySelectorAll('select[data-sv]').forEach(el => { const v = el.getAttribute('data-sv'); if (v != null && el.value !== v) el.value = v; }); }
  async _start() {
    if (this._starting) return;
    this._starting = true;
    try {
      await customElements.whenDefined('three-d-stage');
      const stage = this.stageRef.current;
      if (!stage) { this._starting = false; return; }
      const { THREE } = await stage.ready;
      this._T = THREE; this._stage = stage;
      stage.style.setProperty('--stage-bg', '#101317');
      stage.shadowRoot.querySelectorAll('.toolbar,.note').forEach(el => { el.style.display = 'none'; });
      this._build3D();
    } catch (e) { this._starting = false; }
  }
  _queue() { if (!this._T) { this._start(); return; } clearTimeout(this._bt); this._bt = setTimeout(() => this._build3D(), 130); }
  /** Flat bodies for beam/channel (web + 2 flanges) and angle (2 legs): outline,
   *  hole loops, thickness and the local->3D map. Feeds the 3D stage and the
   *  STEP/OBJ exports (via slabMesh) and the harness. */
  plateDefs(c, SEG) {
    const loopsFor = (face) => c.holes.filter(h => h.ok && h.face === face).map(h => h.slotL ? this.slotPts(h.x, h.c, h.slotL, h.dia, h.ax === 'x', SEG, true) : this.circPts(h.x, h.c, h.dia / 2, SEG, true));
    let defs;
    if (c.kind === 'plate') {
      const { sec } = c;
      defs = [
        { name: 'WEB', out: c.web, hl: loopsFor('web'), th: sec.tw, map: (x, y, w) => [x, y, w - sec.tw / 2] },
        { name: 'TOP_FLANGE', out: c.tfO, hl: loopsFor('tf'), th: sec.tf, map: (x, z, w) => [x, sec.d / 2 - w, z] },
        { name: 'BOTTOM_FLANGE', out: c.bfO, hl: loopsFor('bf'), th: sec.tf, map: (x, z, w) => [x, -sec.d / 2 + sec.tf - w, z] }
      ];
    } else {
      const t = c.sec.t;
      defs = [
        { name: 'VERT_LEG', out: c.vleg, hl: loopsFor('vleg'), th: t, map: (x, y, w) => [x, y, w] },
        { name: 'HORIZ_LEG', out: c.hleg, hl: loopsFor('hleg'), th: t, map: (x, z, w) => [x, w, z] }
      ];
    }
    return defs.filter(df => df.out && df.out.length >= 3);
  }

  /** Watertight slab: outline + hole loops extruded th along the map's w axis.
   *  Loops are cleaned first — three's triangulateShape silently drops a repeated
   *  closing point, and indexing the uncleaned loop shifted every hole vertex by
   *  one (torn caps, open edges). The winding is flipped when the map mirrors
   *  (e.g. an angle's horizontal leg), so every body has a positive volume. */
  slabMesh(outline, holeLoops, th, map) {
    const T = this._T;
    const clean = (pts) => {
      const o = [];
      for (const p of pts) { const l = o[o.length - 1]; if (!l || Math.abs(l[0] - p[0]) > 1e-9 || Math.abs(l[1] - p[1]) > 1e-9) o.push(p); }
      while (o.length > 3 && Math.abs(o[0][0] - o[o.length - 1][0]) < 1e-9 && Math.abs(o[0][1] - o[o.length - 1][1]) < 1e-9) o.pop();
      return o;
    };
    outline = clean(outline);
    holeLoops = holeLoops.map(clean);
    const cont = outline.map(p => new T.Vector2(p[0], p[1]));
    const hls = holeLoops.map(l => l.map(p => new T.Vector2(p[0], p[1])));
    let tris;
    try { tris = T.ShapeUtils.triangulateShape(cont, hls); } catch (e) { return null; }
    const all = outline.concat(...holeLoops);
    const V = all.length;
    const pos = [];
    for (const p of all) { const q = map(p[0], p[1], 0); pos.push(q[0], q[1], q[2]); }
    for (const p of all) { const q = map(p[0], p[1], th); pos.push(q[0], q[1], q[2]); }
    const idx = [];
    for (const t of tris) { idx.push(t[0], t[2], t[1]); idx.push(t[0] + V, t[1] + V, t[2] + V); }
    let off = 0;
    const loops = [outline].concat(holeLoops);
    for (const l of loops) {
      const n = l.length;
      for (let i = 0; i < n; i++) {
        const a = off + i, b = off + (i + 1) % n;
        idx.push(a, b, b + V, a, b + V, a + V);
      }
      off += n;
    }
    let vol = 0;
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i] * 3, b = idx[i + 1] * 3, d = idx[i + 2] * 3;
      vol += pos[a] * (pos[b + 1] * pos[d + 2] - pos[b + 2] * pos[d + 1]) - pos[a + 1] * (pos[b] * pos[d + 2] - pos[b + 2] * pos[d]) + pos[a + 2] * (pos[b] * pos[d + 1] - pos[b + 1] * pos[d]);
    }
    if (vol < 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    return { pos, idx, loops, map, th };
  }

  shellStations(c) {
    const st3 = [];
    if (c.kind === 'round') {
      const { ro, ri } = c.sec;
      for (let i = 0; i < c.N; i++) {
        const phi = i / c.N * 2 * Math.PI, cs = Math.cos(phi), sn = Math.sin(phi);
        st3.push({ oy: ro * cs, oz: ro * sn, iy: ri * cs, iz: ri * sn });
      }
    } else {
      const t = c.sec.t;
      for (const q of c.stns) st3.push({ oy: q.y, oz: q.z, iy: q.y - t * q.ny, iz: q.z - t * q.nz });
    }
    return st3;
  }

  /** Half-width in x of hole h at wrap-offset du from its center, or null
   *  outside the hole's u-span. Handles round holes and both slot axes. */
  holeHalfX(h, du) {
    const r = h.dia / 2, ad = Math.abs(du);
    if (!h.slotL) return ad > r + 1e-9 ? null : Math.sqrt(Math.max(0, r * r - du * du));
    if (h.ax === 'x') return ad > r + 1e-9 ? null : (h.slotL - h.dia) / 2 + Math.sqrt(Math.max(0, r * r - du * du));
    const half = h.slotL / 2;
    if (ad > half + 1e-9) return null;
    const dd = Math.max(0, ad - (half - r));
    return Math.sqrt(Math.max(0, r * r - dd * dd));
  }
  /** Half of a hole's extent along the wrap direction. */
  holeUSpan(h) { return h.slotL && h.ax === 'y' ? h.slotL / 2 : h.dia / 2; }

  /** Faceted closed solid for round/box stock with every OK wall hole cut
   *  through the near wall as a square radial cut — same angular extent on
   *  the OD and ID, exactly what the rotary laser leaves. Pure math (no
   *  three.js): feeds the 3D stage, the OBJ export and the STEP export, and
   *  runs headless in the test harness. Returns { pos: [], idx: [] } with
   *  vertices deduplicated, so the mesh is edge-manifold. */
  shellSolid(c) {
    const holes = c.holes.filter((hh) => hh.ok);
    const wrap = c.wrap, N = c.N, EPS = 1e-7;
    const stns = c.stns;
    // surface sample at wrap coordinate u: outer/inner point + end-cut x's.
    // Round: band row u maps to station (u/wrap)*N + N/2 (seam at the bottom),
    // phi = u/ro - PI — identical to wrapPaths/_build3D conventions.
    const at = (u) => {
      if (c.kind === 'round') {
        const { ro, ri } = c.sec;
        const phi = u / ro - Math.PI;
        const cs = Math.cos(phi), sn = Math.sin(phi);
        const fi = (((u / wrap) * N + N / 2) % N + N) % N;
        const i0 = Math.floor(fi) % N, i1 = (i0 + 1) % N, f = fi - Math.floor(fi);
        return { oy: ro * cs, oz: ro * sn, iy: ri * cs, iz: ri * sn,
          a: c.a[i0] * (1 - f) + c.a[i1] * f, b: c.b[i0] * (1 - f) + c.b[i1] * f };
      }
      const t = c.sec.t;
      let i0 = 0;
      for (let i = stns.length - 1; i >= 0; i--) if (stns[i].s <= u + 1e-9) { i0 = i; break; }
      const q0 = stns[i0], last = i0 + 1 >= stns.length;
      const q1 = last ? stns[0] : stns[i0 + 1];
      const s1 = last ? wrap : stns[i0 + 1].s;
      const f = s1 > q0.s ? Math.max(0, Math.min(1, (u - q0.s) / (s1 - q0.s))) : 0;
      const y = q0.y + (q1.y - q0.y) * f, z = q0.z + (q1.z - q0.z) * f;
      let ny = q0.ny + (q1.ny - q0.ny) * f, nz = q0.nz + (q1.nz - q0.nz) * f;
      const nl = Math.hypot(ny, nz) || 1; ny /= nl; nz /= nl;
      const j1 = last ? 0 : i0 + 1;
      return { oy: y, oz: z, iy: y - t * ny, iz: z - t * nz,
        a: c.a[i0] * (1 - f) + c.a[j1] * f, b: c.b[i0] * (1 - f) + c.b[j1] * f };
    };
    // wrap rows: every station row plus refinement inside each hole span so
    // the opening keeps its curvature.
    const rowSet = new Set([0, wrap]);
    if (c.kind === 'round') { for (let j = 1; j < N; j++) rowSet.add(wrap * j / N); }
    else { for (const q of stns) if (q.s > EPS) rowSet.add(q.s); }
    for (const hh of holes) {
      const s = this.holeUSpan(hh);
      for (let k = 0; k <= 14; k++) rowSet.add(hh.u - s + 2 * s * k / 14);
      if (hh.slotL && hh.ax === 'y') { rowSet.add(hh.u - (hh.slotL - hh.dia) / 2); rowSet.add(hh.u + (hh.slotL - hh.dia) / 2); }
    }
    const rowsU = [];
    for (const u of [...rowSet].sort((x, y) => x - y)) {
      if (u < -EPS || u > wrap + EPS) continue;
      if (!rowsU.length || u - rowsU[rowsU.length - 1] > EPS) rowsU.push(u);
    }
    if (rowsU[rowsU.length - 1] < wrap - EPS) rowsU.push(wrap); else rowsU[rowsU.length - 1] = wrap;
    const rowAt = rowsU.map((u) => at(u));
    // row-intrinsic hole boundary pairs — every band sharing a row sees the
    // same subdivision, so surfaces stay crack-free (edge-manifold).
    const rowPairs = rowsU.map((u) => {
      const out = [];
      for (const hh of holes) {
        const s = this.holeUSpan(hh);
        if (u < hh.u - s - EPS || u > hh.u + s + EPS) continue;
        const du = Math.max(-s, Math.min(s, u - hh.u));
        const hw = this.holeHalfX(hh, du) ?? 0;
        out.push({ h: hh, x0: hh.x - hw, x1: hh.x + hw });
      }
      return out;
    });
    const pos = [], idx = [], key2id = new Map();
    const vid = (x, y, z) => {
      const f = (v) => (Math.abs(v) < 5e-7 ? 0 : v).toFixed(6);
      const k = f(x) + ',' + f(y) + ',' + f(z);
      let id = key2id.get(k);
      if (id === undefined) { id = pos.length / 3; pos.push(x, y, z); key2id.set(k, id); }
      return id;
    };
    const tri = (i, j, k, flip) => {
      if (i === j || j === k || i === k) return;
      if (flip) idx.push(i, k, j); else idx.push(i, j, k);
    };
    // wall surfaces. flip: CCW in (x,u) maps to an inward-facing normal, so
    // the outer surface flips and the inner (bore) surface keeps CCW.
    // Every row splits at every hole's center-x (a degenerate point outside
    // the hole's span, snapped onto a containing opening's edge) — the
    // subdivision is a property of the ROW alone, so adjacent bands always
    // tile shared rows identically and the surface stays crack-free.
    const hs = holes.slice().sort((p, q) => (p.x - q.x) || (p.u - q.u));
    const bnd = (ri, A) => {
      const pairs = hs.map((hh) => {
        const p = rowPairs[ri].find((q) => q.h === hh);
        return p && p.x1 - p.x0 > 1e-9 ? { x0: p.x0, x1: p.x1, real: true } : { x0: hh.x, x1: hh.x, real: false };
      });
      for (let i = 0; i < pairs.length; i++) {
        if (pairs[i].real) continue;
        for (let j = 0; j < pairs.length; j++) {
          if (i === j || !pairs[j].real) continue;
          if (pairs[i].x0 > pairs[j].x0 + 1e-9 && pairs[i].x0 < pairs[j].x1 - 1e-9) {
            const v = i < j ? pairs[j].x0 : pairs[j].x1;
            pairs[i].x0 = pairs[i].x1 = v;
            break;
          }
        }
      }
      const xs = [A.a];
      for (const p of pairs) xs.push(p.x0, p.x1);
      xs.push(A.b);
      return xs;
    };
    const surf = (mapY, mapZ, flip) => {
      for (let r = 0; r + 1 < rowsU.length; r++) {
        const u0 = rowsU[r], u1 = rowsU[r + 1];
        const A0 = rowAt[r], A1 = rowAt[r + 1];
        const B0 = bnd(r, A0), B1 = bnd(r + 1, A1);
        for (let m = 0; m + 1 < B0.length; m++) {
          if (m & 1) { // a hole's own span: skip when the hole pierces this band
            const hh = hs[(m - 1) / 2];
            const s = this.holeUSpan(hh);
            if (hh.u - s < u1 - EPS && hh.u + s > u0 + EPS) continue;
          }
          const p00 = vid(B0[m], mapY(A0), mapZ(A0));
          const p01 = vid(B0[m + 1], mapY(A0), mapZ(A0));
          const p10 = vid(B1[m], mapY(A1), mapZ(A1));
          const p11 = vid(B1[m + 1], mapY(A1), mapZ(A1));
          tri(p00, p01, p11, flip); tri(p00, p11, p10, flip);
        }
      }
    };
    surf((A) => A.oy, (A) => A.oz, true);
    surf((A) => A.iy, (A) => A.iz, false);
    // end-cut faces: square radial cut, inner and outer end at the same x.
    for (let r = 0; r + 1 < rowsU.length; r++) {
      const A0 = rowAt[r], A1 = rowAt[r + 1];
      for (const [end, flip] of [['a', true], ['b', false]]) {
        const o0 = vid(A0[end], A0.oy, A0.oz), o1 = vid(A1[end], A1.oy, A1.oz);
        const i1 = vid(A1[end], A1.iy, A1.iz), i0 = vid(A0[end], A0.iy, A0.iz);
        tri(o0, o1, i1, flip); tri(o0, i1, i0, flip);
      }
    }
    // hole barrels: the radial cut wall of each opening.
    for (const hh of holes) {
      const rows = [];
      for (let r = 0; r < rowsU.length; r++) {
        const p = rowPairs[r].find((q) => q.h === hh);
        if (p) rows.push({ r, x0: p.x0, x1: p.x1 });
      }
      for (let j = 0; j + 1 < rows.length; j++) {
        const lo = rows[j], hi = rows[j + 1];
        const Al = rowAt[lo.r], Ah = rowAt[hi.r];
        for (const [x0v, x1v, flip] of [[lo.x0, hi.x0, false], [lo.x1, hi.x1, true]]) {
          const o0 = vid(x0v, Al.oy, Al.oz), o1 = vid(x1v, Ah.oy, Ah.oz);
          const i1 = vid(x1v, Ah.iy, Ah.iz), i0 = vid(x0v, Al.iy, Al.iz);
          tri(o0, o1, i1, flip); tri(o0, i1, i0, flip);
        }
      }
      // flat floor/ceiling edges (slots running along the length)
      for (const [row, flip] of [[rows[0], true], [rows[rows.length - 1], false]]) {
        if (!row || row.x1 - row.x0 < EPS) continue;
        const A = rowAt[row.r];
        const o0 = vid(row.x0, A.oy, A.oz), o1 = vid(row.x1, A.oy, A.oz);
        const i1 = vid(row.x1, A.iy, A.iz), i0 = vid(row.x0, A.iy, A.iz);
        tri(o0, o1, i1, flip); tri(o0, i1, i0, flip);
      }
    }
    return { pos, idx };
  }

  _build3D() {
    const T = this._T, stage = this._stage;
    if (!T || !stage) return;
    const c = this.calc(), st = this.state;
    const bKey = c.key + JSON.stringify([this.props.edgeGlow, st.spin, st.ghost]);
    if (bKey === this._bk) return;
    try { if (stage._controls) stage._controls.autoRotate = st.spin; } catch (e) {}
    if (c.invalid) return;
    if (this._g) {
      this._g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      this._g.clear();
    } else this._g = new T.Group();
    const g = this._g;
    g.name = 'part_' + this.fileBase();
    const mat = new T.MeshStandardMaterial({ color: 0xA6AEB7, metalness: .35, roughness: .42, side: T.DoubleSide });
    mat.name = 'carbon_steel';
    const glow = this.props.edgeGlow ?? true;
    const SEG = parseInt(this.props.holeSegs || '28', 10);
    let edgeVerts = [];
    const addLoop = (pts) => { const n = pts.length; for (let i = 0; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; edgeVerts.push(p[0], p[1], p[2], q[0], q[1], q[2]); } };

    if (c.kind === 'round' || c.kind === 'box') {
      const solid = this.shellSolid(c);
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(new Float32Array(solid.pos), 3));
      geo.setIndex(solid.idx);
      geo.computeVertexNormals();
      const mesh = new T.Mesh(geo, mat);
      mesh.name = 'BODY_' + this.fileBase().toUpperCase();
      g.add(mesh);
      this._export = { type: 'shell', pos: solid.pos, idx: solid.idx, name: mesh.name, c };
      const st3 = this.shellStations(c);
      const a = c.a, b = c.b;
      if (glow) {
        addLoop(st3.map((s3, i) => [a[i], s3.oy, s3.oz]));
        addLoop(st3.map((s3, i) => [a[i], s3.iy, s3.iz]));
        addLoop(st3.map((s3, i) => [b[i], s3.oy, s3.oz]));
        addLoop(st3.map((s3, i) => [b[i], s3.iy, s3.iz]));
      }
      for (const h of c.holes) {
        if (!h.ok) continue;
        const pts2 = h.slotL ? this.slotPts(h.x, h.u, h.slotL, h.dia, h.ax === 'x', SEG, false) : this.circPts(h.x, h.u, h.dia / 2, SEG, false);
        const p3 = pts2.map(p => {
          if (c.kind === 'round') { const phi = p[1] / c.sec.ro - Math.PI; const r = c.sec.ro + .015; return [p[0], r * Math.cos(phi), r * Math.sin(phi)]; }
          let u = ((p[1] % c.wrap) + c.wrap) % c.wrap;
          let bi = 0, bd = 1e9;
          for (let k = 0; k < c.stns.length; k++) { const d2 = Math.abs(c.stns[k].s - u); if (d2 < bd) { bd = d2; bi = k; } }
          const q = c.stns[bi];
          return [p[0], q.y + .015 * q.ny, q.z + .015 * q.nz];
        });
        addLoop(p3);
      }
      for (const [E, x0] of [[c.A, 0], [c.B, c.L]]) {
        if (st.ghost && E.mode === 'saddle' && E.sd) {
          const { hod, alpha, roll } = E.sd;
          const hl = Math.max(2.6 * c.sec.od * 2, 1.6 * hod);
          const hgeo = new T.CylinderGeometry(hod / 2, hod / 2, hl, 96, 1, true);
          const hmat = new T.MeshStandardMaterial({ color: 0x5C6670, metalness: .2, roughness: .6, transparent: true, opacity: .22, side: T.DoubleSide, depthWrite: false });
          hmat.name = 'header_ghost';
          const hm = new T.Mesh(hgeo, hmat);
          // Header axis: the cut fn s=(√(Rs²−(ρsinθ)²)+ρcosθ·cosα)/sinα wraps the
          // cylinder whose axis tilts +cosα along the branch at end A (−cosα at B).
          const dir = new T.Vector3(Math.cos(alpha) * (x0 === 0 ? 1 : -1), Math.sin(alpha) * Math.cos(roll), Math.sin(alpha) * Math.sin(roll)).normalize();
          hm.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir);
          hm.position.set(x0, 0, 0);
          hm.name = 'HEADER_REFERENCE';
          g.add(hm);
          const hh = this.headerHole(E, c.sec);
          if (hh) {
            const ax = new T.Vector3(x0 === 0 ? 1 : -1, 0, 0);
            const zs = dir.clone().multiplyScalar(ax.dot(dir) >= 0 ? 1 : -1);
            const xs = ax.clone().addScaledVector(zs, -ax.dot(zs));
            if (xs.lengthSq() > 1e-8) {
              xs.normalize();
              const ys = zs.clone().cross(xs);
              addLoop(hh.p3.map(p => {
                const q = new T.Vector3(x0, 0, 0).addScaledVector(xs, p[0] * 1.004).addScaledVector(ys, p[1] * 1.004).addScaledVector(zs, p[2]);
                return [q.x, q.y, q.z];
              }));
            }
          }
        }
      }
    } else {
      const plates = [];
      for (const df of this.plateDefs(c, SEG)) {
        const m = this.slabMesh(df.out, df.hl, df.th, df.map);
        if (!m) continue;
        const geo = new T.BufferGeometry();
        geo.setAttribute('position', new T.BufferAttribute(new Float32Array(m.pos), 3));
        geo.setIndex(m.idx);
        geo.computeVertexNormals();
        const mesh = new T.Mesh(geo, mat.clone());
        mesh.material.name = 'carbon_steel';
        mesh.name = df.name;
        g.add(mesh);
        plates.push({ name: df.name, pos: m.pos, idx: m.idx });
        if (glow) for (const l of m.loops) for (const w of [0, df.th]) addLoop(l.map(p => df.map(p[0], p[1], w)));
      }
      this._export = { type: 'plates', plates, c };
    }
    if (edgeVerts.length) {
      const eg = new T.BufferGeometry();
      eg.setAttribute('position', new T.BufferAttribute(new Float32Array(edgeVerts), 3));
      const lines = new T.LineSegments(eg, new T.LineBasicMaterial({ color: 0xA6CE39, transparent: true, opacity: .6 }));
      lines.name = 'cut_edges';
      g.add(lines);
    }
    if (this._framed) {
      const cp = stage._camera.position.clone(), ct = stage._controls.target.clone();
      stage.setObject(g);
      stage._camera.position.copy(cp); stage._controls.target.copy(ct); stage._controls.update();
    } else { stage.setObject(g); this._framed = true; }
    this._bk = bKey;
  }

  _persist() {
    clearTimeout(this._pt);
    this._pt = setTimeout(() => {
      const st = this.state;
      try { localStorage.setItem('spf_pb_job_v1', JSON.stringify({ parts: st.parts, job: st.job, gripT: st.gripT, stickSel: st.stickSel, rateCT: st.rateCT, rateST: st.rateST, rateAT: st.rateAT, hdrB: st.hdrB, dxfRef: st.dxfRef })); } catch (e) {}
      this._fsBackup();
    }, 400);
  }

  // ---------- linked export folder (File System Access API, Chrome/Edge) ----------
  /** When a folder (external drive, USB, iCloud/Drive folder) is linked, every
   *  export also writes a copy there under JOB_<n>/, plus a rolling
   *  partbuilder_jobs_backup.json — the shop's permanent record. */
  _fsSupported() { return typeof window !== 'undefined' && 'showDirectoryPicker' in window; }
  _fsDb() {
    return new Promise((res, rej) => {
      const rq = indexedDB.open('spf_pb_fs', 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
  }
  async _fsSaveHandle(h) {
    try { const db = await this._fsDb(); await new Promise((res, rej) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(h, 'dir'); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); } catch (e) {}
  }
  async _fsInit() {
    if (!this._fsSupported()) return;
    try {
      const db = await this._fsDb();
      const h = await new Promise((res, rej) => { const tx = db.transaction('kv', 'readonly'); const rq = tx.objectStore('kv').get('dir'); rq.onsuccess = () => res(rq.result || null); rq.onerror = () => rej(rq.error); });
      if (!h) return;
      this._fsDir = h;
      let p = 'prompt';
      try { p = await h.queryPermission({ mode: 'readwrite' }); } catch (e) {}
      this.setState({ fsName: h.name, fsPerm: p });
    } catch (e) {}
  }
  async _fsLink() {
    try {
      const h = await window.showDirectoryPicker({ mode: 'readwrite' });
      this._fsDir = h;
      await this._fsSaveHandle(h);
      this.setState({ fsName: h.name, fsPerm: 'granted', archMsg: 'Linked "' + h.name + '" — every export now copies there ✓' });
      this._fsBackup();
    } catch (e) {}
  }
  async _fsReconnect() {
    const h = this._fsDir;
    if (!h) return;
    try { const p = await h.requestPermission({ mode: 'readwrite' }); this.setState({ fsPerm: p, archMsg: p === 'granted' ? '"' + h.name + '" reconnected ✓' : 'Folder access declined' }); if (p === 'granted') this._fsBackup(); } catch (e) {}
  }
  _fsUnlink() { this._fsDir = null; this._fsSaveHandle(null); this.setState({ fsName: '', fsPerm: '', archMsg: 'Folder unlinked' }); }
  async _fsWrite(name, text, atRoot) {
    const h = this._fsDir;
    if (!h || this.state.fsPerm !== 'granted') return false;
    try {
      let dir = h;
      if (!atRoot) {
        const job = (this.state.job || 'NO-JOB').replace(/[^\w.-]+/g, '_');
        dir = await h.getDirectoryHandle('JOB_' + job, { create: true });
      }
      const fh = await dir.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(text);
      await w.close();
      return true;
    } catch (e) { return false; }
  }
  _fsBackup() {
    clearTimeout(this._fsbt);
    this._fsbt = setTimeout(() => {
      const s2 = this.state;
      const data = { app: 'SPF-PartBuilder', v: 1, saved: new Date().toISOString(), current: { job: s2.job, parts: s2.parts, gripT: s2.gripT, stickSel: s2.stickSel, rateCT: s2.rateCT, rateST: s2.rateST, rateAT: s2.rateAT }, archive: s2.archive };
      this._fsWrite('partbuilder_jobs_backup.json', JSON.stringify(data, null, 1), true);
    }, 1200);
  }

  /** PAST JOBS archive — persisted separately from the live job so a browser
   *  crash or NEW JOB never loses a filed job. Capped at 200 jobs. */
  _saveArchive(list) { try { localStorage.setItem('spf_pb_archive_v1', JSON.stringify(list)); } catch (e) {} }
  _mkArch(st) {
    return { id: Date.now() + Math.random(), job: st.job || '', savedAt: Date.now(), parts: JSON.parse(JSON.stringify(st.parts)), gripT: st.gripT, stickSel: st.stickSel, hdrB: JSON.parse(JSON.stringify(st.hdrB || { nps: '10', sch: '40', seat: 'on', hid: 1, list: [] })) };
  }

  static CFG_KEYS = ['family', 'pnps', 'psch', 'todT', 'twallT', 'hsize', 'hwallT', 'bser', 'bsize', 'cser', 'csize', 'asize', 'athkT', 'cdT', 'cbT', 'ctfT', 'ctwT', 'cwT', 'lenT', 'lenMode', 'mat', 'mark', 'heat', 'qty', 'wantHoles', 'ends', 'groups', 'gid'];
  snapshot() { const o = {}; for (const k of Component.CFG_KEYS) o[k] = this.state[k]; return JSON.parse(JSON.stringify(o)); }
  /** Recall codes. SPFPB2 keeps only what differs from a fresh part, so the
   *  ticket QR stays small and scannable even with many hole groups (full
   *  codes passed the QR limit at ~4 groups). SPFPB1 (full JSON) still decodes;
   *  encodeCfgV1 writes it for files that must load in older app builds. */
  encodeCfgV1(cfg) { return 'SPFPB1:' + btoa(unescape(encodeURIComponent(JSON.stringify(cfg)))); }
  encodeCfg(cfg) {
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const base = Object.assign(Component.freshPart(), { lenMode: 'wp' });
    const diff = (o, def) => { const r = {}; for (const k of Object.keys(o || {})) if (!same(o[k], def[k])) r[k] = o[k]; return r; };
    const d = {};
    for (const k of Component.CFG_KEYS) if (k !== 'ends' && k !== 'groups' && !same(cfg[k], base[k])) d[k] = cfg[k];
    const fam = cfg.family || base.family;
    d.ends = { A: diff(cfg.ends && cfg.ends.A, Component.defEnd()), B: diff(cfg.ends && cfg.ends.B, Component.defEnd()) };
    d.groups = (cfg.groups || []).map(g => Object.assign({ id: g.id }, diff(g, Component.defGroup(g.id, fam))));
    return 'SPFPB2:' + btoa(unescape(encodeURIComponent(JSON.stringify(d))));
  }
  /** Raw decode of either code version -> { cfg, hadLenMode } or null. */
  _decodeRaw(s) {
    try {
      s = String(s == null ? '' : s).trim();
      let v2 = false;
      if (s.startsWith('SPFPB2:')) { s = s.slice(7); v2 = true; }
      else if (s.startsWith('SPFPB1:')) s = s.slice(7);
      const j = JSON.parse(decodeURIComponent(escape(atob(s))));
      if (!j || typeof j !== 'object') return null;
      if (!v2) return j.family ? { cfg: j, hadLenMode: Object.prototype.hasOwnProperty.call(j, 'lenMode') } : null;
      const base = Object.assign(Component.freshPart(), { lenMode: 'wp' });
      const cfg = {};
      for (const k of Component.CFG_KEYS) if (k !== 'ends' && k !== 'groups') cfg[k] = Object.prototype.hasOwnProperty.call(j, k) ? j[k] : JSON.parse(JSON.stringify(base[k]));
      const ends = j.ends || {};
      cfg.ends = { A: Object.assign(Component.defEnd(), ends.A), B: Object.assign(Component.defEnd(), ends.B) };
      cfg.groups = Array.isArray(j.groups) ? j.groups.map(g => Object.assign(Component.defGroup(g.id, cfg.family), g)) : base.groups;
      return { cfg, hadLenMode: true };
    } catch (e) { return null; }
  }
  decodeCfg(s) {
    const r = this._decodeRaw(s);
    if (!r) return null;
    // Codes made before lenMode was saved are work-point lengths; set it
    // explicitly so a recall never inherits the form's current mode.
    if (r.cfg.lenMode !== 'oal') r.cfg.lenMode = 'wp';
    return r.cfg;
  }
  /** Job-list part -> form cfg. Codes saved before lenMode existed don't say
   *  whether the typed length was CL or long point; the part record kept its
   *  long point (pt.oal), so use the mode that reproduces it. */
  cfgFromPart(pt) {
    const r = this._decodeRaw(pt && pt.payload);
    if (!r) return null;
    const cfg = r.cfg;
    if (!r.hadLenMode && pt.oal > 0) {
      const lpFor = (mode) => {
        const saved = this.state, savedC = this._c;
        this.state = Object.assign({}, saved, cfg, { lenMode: mode });
        this._c = null;
        try { const c = this.calc(); return c.invalid ? null : (c.OAL || c.L); } catch (e) { return null; } finally { this.state = saved; this._c = savedC; }
      };
      const tol = 1 / 64, wp = lpFor('wp'), oal = lpFor('oal');
      cfg.lenMode = (wp != null && Math.abs(wp - pt.oal) <= tol) ? 'wp' : (oal != null && Math.abs(oal - pt.oal) <= tol) ? 'oal' : 'wp';
    }
    if (cfg.lenMode !== 'oal') cfg.lenMode = 'wp';
    return cfg;
  }

  nestGroups(partsArg) {
    const st = this.state, D = this.D;
    const groups = {};
    for (const p of (partsArg || st.parts)) {
      const k = p.groupKey;
      if (!groups[k]) groups[k] = { key: k, label: p.groupLabel, cat: p.cat, lens: [], wt: 0 };
      for (let i = 0; i < p.qty; i++) groups[k].lens.push(p.oal);
      groups[k].wt += p.wt * p.qty;
    }
    const grip = this.parseIn(st.gripT) || 6, gap = .125;
    const out = [];
    for (const k of Object.keys(groups)) {
      const g = groups[k];
      const stickIn = parseFloat(st.stickSel[k] || '288');
      const cap = stickIn - grip;
      const lens = g.lens.slice().sort((x, y) => y - x);
      const sticks = [];
      for (const ln of lens) {
        let placed = false;
        for (const stk of sticks) { if (stk.used + ln + (stk.n ? gap : 0) <= cap) { stk.used += ln + (stk.n ? gap : 0); stk.n++; placed = true; break; } }
        if (!placed) sticks.push({ used: ln, n: 1 });
        if (lens.some(l => l > cap)) g.tooLong = true;
      }
      const totUsed = sticks.reduce((s2, x) => s2 + x.used, 0);
      const drop = sticks.length ? cap - sticks[sticks.length - 1].used : 0;
      out.push({ key: k, label: g.label, cat: g.cat, pieces: g.lens.length, wt: g.wt, sticks: sticks.length, stickIn, util: sticks.length ? totUsed / (sticks.length * cap) : 0, drop, tooLong: !!g.tooLong });
    }
    return out;
  }

  _download(text, name, mime) {
    const url = URL.createObjectURL(new Blob([text], { type: mime || 'text/plain' }));
    const el = document.createElement('a');
    el.href = url; el.download = name; document.body.appendChild(el); el.click(); el.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    this._fsWrite(name, text).then(okW => { if (okW) this.setState({ archMsg: name + ' → copied to "' + this.state.fsName + '" ✓' }); });
  }
  // DXF/CSV text must stay plain ASCII — legacy CAM readers (no $DWGCODEPAGE) garble unicode.
  ascii(s) {
    return String(s)
      .replace(/″/g, '"').replace(/′/g, "'")
      .replace(/°/g, ' DEG').replace(/Ø/g, 'DIA ')
      .replace(/·/g, '-').replace(/×/g, 'x')
      .replace(/—/g, '-').replace(/≤/g, '<=')
      .replace(/[^\x20-\x7E\n]/g, '?');
  }
  headerNote() {
    const st = this.state, c = this.calc();
    return 'Steampunk Fabrication | ' + (st.job ? 'JOB ' + st.job + ' | ' : '') + 'MARK ' + (st.mark || '-') + ' | ' + c.sec.label + ' x ' + this.fmtFtIn(c.L) + (c.LP > 0 && Math.abs(c.LP - c.L) > 1 / 64 ? ' CL (LONG POINT ' + this.fmtFtIn(c.LP) + ')' : '') + ' | A: ' + this.endSpecText(c.A || {}, c.sec) + ' | B: ' + this.endSpecText(c.B || {}, c.sec) + ' | TRUE SIZE, KERF IN CAM';
  }
  _objText() {
    const e = this._export;
    if (!e) return null;
    let s = '# ' + this.headerNote() + '\n# 1 unit = 1 INCH. Fusion 360: INSERT > INSERT MESH > Unit Type = Inch\n';
    if (e.type === 'shell') {
      s += '# Shell body. Rotary-cut edges square to the surface (radial). Wall openings modeled as square radial through-wall cuts.\no ' + e.name + '\n';
      for (let i = 0; i < e.pos.length; i += 3) s += 'v ' + e.pos[i].toFixed(5) + ' ' + e.pos[i + 1].toFixed(5) + ' ' + e.pos[i + 2].toFixed(5) + '\n';
      for (let i = 0; i < e.idx.length; i += 3) s += 'f ' + (e.idx[i] + 1) + ' ' + (e.idx[i + 1] + 1) + ' ' + (e.idx[i + 2] + 1) + '\n';
      return s;
    }
    s += '# Plate bodies - combine in CAD. Fillets (k-zone) omitted.\n';
    let voff = 0;
    for (const p of e.plates) {
      s += 'o ' + p.name + '\n';
      for (let i = 0; i < p.pos.length; i += 3) s += 'v ' + p.pos[i].toFixed(5) + ' ' + p.pos[i + 1].toFixed(5) + ' ' + p.pos[i + 2].toFixed(5) + '\n';
      for (let i = 0; i < p.idx.length; i += 3) s += 'f ' + (p.idx[i] + 1 + voff) + ' ' + (p.idx[i + 1] + 1 + voff) + ' ' + (p.idx[i + 2] + 1 + voff) + '\n';
      voff += p.pos.length / 3;
    }
    return s;
  }

  _stepText() {
    const e = this._export;
    if (!e) return null;
    // Round/box shells export as one faceted solid; plate families as one solid per plate.
    const bodies = e.type === 'plates' ? e.plates : [{ name: e.name, pos: e.pos, idx: e.idx }];
    const L = [];
    let id = 100;
    const w = (s) => { L.push(s); };
    const nid = () => ++id;
    w('ISO-10303-21;'); w('HEADER;');
    w("FILE_DESCRIPTION((''),'2;1');");
    w("FILE_NAME('" + this.fileBase() + ".step','" + new Date().toISOString() + "',('Steampunk Fabrication'),(''),'','','');");
    w("FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));");
    w('ENDSEC;'); w('DATA;');
    w("#1=APPLICATION_CONTEXT('automotive design');");
    w("#2=APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2010,#1);");
    w("#3=PRODUCT_CONTEXT('',#1,'mechanical');");
    w("#4=PRODUCT('" + this.fileBase() + "','" + this.fileBase() + "','',(#3));");
    w("#5=PRODUCT_DEFINITION_FORMATION('','',#4);");
    w("#6=PRODUCT_DEFINITION_CONTEXT('part definition',#1,'design');");
    w("#7=PRODUCT_DEFINITION('design','',#5,#6);");
    w("#8=PRODUCT_DEFINITION_SHAPE('','',#7);");
    w('#10=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));');
    w('#13=DIMENSIONAL_EXPONENTS(1.,0.,0.,0.,0.,0.,0.);');
    w('#12=LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(25.4),#10);');
    w("#11=(CONVERSION_BASED_UNIT('INCH',#12)LENGTH_UNIT()NAMED_UNIT(#13));");
    w('#14=(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.));');
    w('#15=(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT());');
    w("#16=UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-4),#11,'','');");
    w("#17=(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#16))GLOBAL_UNIT_ASSIGNED_CONTEXT((#11,#14,#15))REPRESENTATION_CONTEXT('',''));");
    w("#20=CARTESIAN_POINT('',(0.,0.,0.));");
    w("#21=DIRECTION('',(0.,0.,1.));");
    w("#22=DIRECTION('',(1.,0.,0.));");
    w("#23=AXIS2_PLACEMENT_3D('',#20,#21,#22);");
    const brepIds = [];
    for (const p of bodies) {
      const ptId = {};
      const P = p.pos;
      const pt = (i) => {
        const k = P[i * 3].toFixed(5) + ',' + P[i * 3 + 1].toFixed(5) + ',' + P[i * 3 + 2].toFixed(5);
        if (ptId[k]) return ptId[k];
        const n = nid();
        w('#' + n + "=CARTESIAN_POINT('',(" + k + '));');
        ptId[k] = n; return n;
      };
      const faces = [];
      for (let i = 0; i < p.idx.length; i += 3) {
        const a = p.idx[i], b = p.idx[i + 1], cc = p.idx[i + 2];
        const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
        const ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az;
        const vx = P[cc * 3] - ax, vy = P[cc * 3 + 1] - ay, vz = P[cc * 3 + 2] - az;
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const nl = Math.hypot(nx, ny, nz);
        if (nl < 1e-9) continue;
        nx /= nl; ny /= nl; nz /= nl;
        const ul = Math.hypot(ux, uy, uz);
        const loop = nid();
        w('#' + loop + "=POLY_LOOP('',(#" + pt(a) + ',#' + pt(b) + ',#' + pt(cc) + '));');
        const fb = nid();
        w('#' + fb + "=FACE_OUTER_BOUND('',#" + loop + ',.T.);');
        const org = nid();
        w('#' + org + "=CARTESIAN_POINT('',(" + ax.toFixed(5) + ',' + ay.toFixed(5) + ',' + az.toFixed(5) + '));');
        const nd = nid();
        w('#' + nd + "=DIRECTION('',(" + nx.toFixed(7) + ',' + ny.toFixed(7) + ',' + nz.toFixed(7) + '));');
        const rd = nid();
        w('#' + rd + "=DIRECTION('',(" + (ux / ul).toFixed(7) + ',' + (uy / ul).toFixed(7) + ',' + (uz / ul).toFixed(7) + '));');
        const ax3 = nid();
        w('#' + ax3 + "=AXIS2_PLACEMENT_3D('',#" + org + ',#' + nd + ',#' + rd + ');');
        const pl = nid();
        w('#' + pl + "=PLANE('',#" + ax3 + ');');
        const fs = nid();
        w('#' + fs + "=FACE_SURFACE('',(#" + fb + '),#' + pl + ',.T.);');
        faces.push('#' + fs);
      }
      const shell = nid();
      w('#' + shell + "=CLOSED_SHELL('',(" + faces.join(',') + '));');
      const brep = nid();
      w('#' + brep + "=FACETED_BREP('" + p.name + "',#" + shell + ');');
      brepIds.push('#' + brep);
    }
    const rep = nid();
    w('#' + rep + "=FACETED_BREP_SHAPE_REPRESENTATION('',(#23," + brepIds.join(',') + '),#17);');
    const sdr = nid();
    w('#' + sdr + '=SHAPE_DEFINITION_REPRESENTATION(#8,#' + rep + ');');
    w('ENDSEC;'); w('END-ISO-10303-21;');
    return L.join('\n') + '\n';
  }

  _dxfText() {
    const c = this.calc(), st = this.state;
    if (c.invalid) return null;
    // Program files default to CUT geometry only — many tube-laser CAM imports
    // ignore layers and cut every vector in the file. st.dxfRef adds the
    // reference lines + labels back for checking in CAD.
    const anno = !!st.dxfRef;
    const Ls = [];
    const w = (code, val) => { Ls.push(String(code), String(val)); };
    w(0, 'SECTION'); w(2, 'HEADER'); w(9, '$INSUNITS'); w(70, 1); w(9, '$MEASUREMENT'); w(70, 0); w(0, 'ENDSEC');
    w(0, 'SECTION'); w(2, 'TABLES'); w(0, 'TABLE'); w(2, 'LAYER'); w(70, 3);
    for (const [nm, col] of [['CUT', 1], ['REF', 8], ['MARK', 3]]) { w(0, 'LAYER'); w(2, nm); w(70, 0); w(62, col); w(6, 'CONTINUOUS'); }
    w(0, 'ENDTAB'); w(0, 'ENDSEC');
    w(0, 'SECTION'); w(2, 'ENTITIES');
    const poly = (pts, layer, closed) => {
      w(0, 'POLYLINE'); w(8, layer); w(66, 1); w(70, closed ? 1 : 0);
      for (const p of pts) { w(0, 'VERTEX'); w(8, layer); w(10, p[0].toFixed(6)); w(20, p[1].toFixed(6)); w(30, 0); }
      w(0, 'SEQEND');
    };
    const line = (x1, y1, x2, y2, layer) => { if (layer !== 'CUT' && !anno) return; w(0, 'LINE'); w(8, layer); w(10, x1.toFixed(6)); w(20, y1.toFixed(6)); w(11, x2.toFixed(6)); w(21, y2.toFixed(6)); };
    const text = (x, y, h, s, layer) => { if (!anno) return; w(0, 'TEXT'); w(8, layer || 'MARK'); w(10, x.toFixed(6)); w(20, y.toFixed(6)); w(40, h); w(1, this.ascii(s)); };
    if (c.kind === 'round' || c.kind === 'box') {
      const { a, b, N, wrap, L } = c;
      const sh = c.stns ? 0 : N / 2;
      const av = (i) => a[(i + sh) % N], bv = (i) => b[(i + sh) % N];
      const ys = (i) => i >= N ? wrap : (c.stns ? c.stns[i].s : wrap * i / N);
      const outline = [];
      for (let i = 0; i <= N; i++) outline.push([av(i), ys(i)]);
      for (let i = N; i >= 0; i--) outline.push([bv(i), ys(i)]);
      poly(outline, 'CUT', true);
      for (const h of c.holes) {
        if (!h.ok) continue;
        if (h.slotL) poly(this.slotPts(h.x, h.u, h.slotL, h.dia, h.ax === 'x', 40, false), 'CUT', true);
        else { w(0, 'CIRCLE'); w(8, 'CUT'); w(10, h.x.toFixed(6)); w(20, h.u.toFixed(6)); w(40, (h.dia / 2).toFixed(6)); }
      }
      if (c.kind === 'round') { for (const [nm, f] of [['180DEG BOTTOM (SEAM)', 0], ['270DEG', .25], ['0DEG TOP', .5], ['90DEG', .75], ['180DEG BOTTOM', 1]]) { line(c.aMin - .5, wrap * f, c.bMax + .5, wrap * f, 'REF'); text(c.aMin - .4, wrap * f + .12, .2, nm, 'REF'); } }
      else { const fS = c.faceS; for (const [nm, sv] of [['BOTTOM CL (SEAM)', 0], ['LEFT', fS.L], ['TOP CL', fS.T], ['RIGHT', fS.R], ['BOTTOM CL', wrap]]) { line(c.aMin - .5, sv, c.bMax + .5, sv, 'REF'); text(c.aMin - .4, sv + .12, .2, nm, 'REF'); } }
      line(0, -0.4, 0, wrap + 0.4, 'REF'); line(L, -0.4, L, wrap + 0.4, 'REF');
      text((c.aMin + c.bMax) / 2 - 1.5, wrap / 2, .5, st.mark || '-', 'MARK');
      text(c.aMin, wrap + .7, .25, this.headerNote() + ' | WRAP=' + wrap.toFixed(3) + ' | X=ALONG PIPE, Y=WRAP FROM ' + (c.kind === 'round' ? '180 DEG BOTTOM SEAM (0 DEG TOP AT MID-BAND)' : 'BOTTOM FACE CL SEAM (TOP CL AT MID-BAND)'), 'MARK');
      w(0, 'ENDSEC'); w(0, 'EOF');
      return Ls.join('\n') + '\n';
    }
    if (c.kind === 'plate') {
      const { sec, zL, zR, L } = c;
      const Wb = zR - zL, gap = Math.max(2, sec.d * .2);
      const oBf = 0, oWeb = Wb + gap, oTf = Wb + gap + sec.d + gap;
      const mTf = (p) => [p[0], oTf + (p[1] - zL)];
      const mWeb = (p) => [p[0], oWeb + (p[1] + sec.d / 2)];
      const mBf = (p) => [p[0], oBf + (zR - p[1])];
      poly(c.tfO.map(mTf), 'CUT', true);
      poly(c.web.map(mWeb), 'CUT', true);
      poly(c.bfO.map(mBf), 'CUT', true);
      for (const h of c.holes) {
        if (!h.ok) continue;
        const map = h.face === 'tf' ? mTf : h.face === 'bf' ? mBf : mWeb;
        if (h.slotL) poly(this.slotPts(h.x, h.c, h.slotL, h.dia, h.ax === 'x', 40, false).map(map), 'CUT', true);
        else { const q = map([h.x, h.c]); w(0, 'CIRCLE'); w(8, 'CUT'); w(10, q[0].toFixed(6)); w(20, q[1].toFixed(6)); w(40, (h.dia / 2).toFixed(6)); }
      }
      for (const [o, hgt] of [[oBf, Wb], [oWeb, sec.d], [oTf, Wb]]) { line(0, o - .5, 0, o + hgt + .5, 'REF'); line(L, o - .5, L, o + hgt + .5, 'REF'); }
      line(-1, oWeb + sec.d / 2, L + 1, oWeb + sec.d / 2, 'REF');
      const zline = sec.chan ? zL + sec.tw / 2 : 0;
      line(-1, oTf + (zline - zL), L + 1, oTf + (zline - zL), 'REF');
      line(-1, oBf + (zR - zline), L + 1, oBf + (zR - zline), 'REF');
      text(0, oTf + Wb + .6, .32, 'TOP FLANGE - FROM ABOVE');
      text(0, oWeb + sec.d + .6, .32, 'WEB - ELEVATION (A LEFT)');
      text(0, oBf + Wb + .6, .32, 'BOTTOM FLANGE - FROM BELOW (MIRRORED)');
      text(L / 2 - 1.5, oWeb + sec.d / 2 + .3, .5, st.mark || '-', 'MARK');
      text(0, oTf + Wb + 1.3, .25, this.headerNote());
      text(0, -1.0, .25, 'A: ' + this.endSpecText(c.A, sec) + '   //   B: ' + this.endSpecText(c.B, sec));
      w(0, 'ENDSEC'); w(0, 'EOF');
      return Ls.join('\n') + '\n';
    }
    const { sec, L } = c;
    const gap = Math.max(2, Math.max(sec.a, sec.b) * .2);
    const oV = 0, oH = sec.a + gap;
    const mV = (p) => [p[0], oV + p[1]];
    const mH = (p) => [p[0], oH + (p[1] - sec.t)];
    poly(c.vleg.map(mV), 'CUT', true);
    poly(c.hleg.map(mH), 'CUT', true);
    for (const h of c.holes) {
      if (!h.ok) continue;
      const map = h.face === 'vleg' ? mV : mH;
      if (h.slotL) poly(this.slotPts(h.x, h.c, h.slotL, h.dia, h.ax === 'x', 40, false).map(map), 'CUT', true);
      else { const q = map([h.x, h.c]); w(0, 'CIRCLE'); w(8, 'CUT'); w(10, q[0].toFixed(6)); w(20, q[1].toFixed(6)); w(40, (h.dia / 2).toFixed(6)); }
    }
    line(0, -.5, 0, oH + (sec.b - sec.t) + .5, 'REF'); line(L, -.5, L, oH + (sec.b - sec.t) + .5, 'REF');
    text(0, oV + sec.a + .4, .32, 'VERT LEG - ELEVATION (HEEL AT Y0)');
    text(0, oH + (sec.b - sec.t) + .4, .32, 'HORIZ LEG - FROM ABOVE (HEEL SIDE AT Y0)');
    text(L / 2 - 1.5, oV + sec.a / 2, .5, st.mark || '-', 'MARK');
    text(0, -1.0, .25, this.headerNote());
    w(0, 'ENDSEC'); w(0, 'EOF');
    return Ls.join('\n') + '\n';
  }

  _csvText() {
    const c = this.calc();
    if (c.invalid) return null;
    let s = '# ' + this.ascii(this.headerNote()) + '\n';
    s += 'grp,face,type,bolt_or_branch,hole_dia_in,slot_len_in,slot_axis,x_from_WPA_in,across,across_ref,status\n';
    for (const h of c.holes) {
      let across, ref;
      if (c.kind === 'round') { across = h.deg; ref = 'deg_from_top_cw'; }
      else if (c.kind === 'box') { across = h.off.toFixed(4); ref = 'offset_from_' + h.face + '_face_CL'; }
      else if (c.kind === 'angl') { across = h.c.toFixed(4); ref = 'gauge_from_heel'; }
      else { across = h.c.toFixed(4); ref = h.face === 'web' ? 'from_CL(+up)' : (c.sec.chan ? 'from_back' : 'from_web_CL'); }
      s += [h.grp, h.face, h.type, h.bolt.replace(',', ''), h.dia.toFixed(4), h.slotL ? h.slotL.toFixed(4) : 0, h.slotL ? h.ax : '-', h.x.toFixed(4), across, ref, h.ok ? 'OK' : 'OFF-MATERIAL'].join(',') + '\n';
    }
    return s;
  }

  headerHole(E, sec) {
    if (!E || E.mode !== 'saddle' || !E.sd || sec.kind !== 'round') return null;
    const sd = E.sd, Rh = sd.hod / 2;
    const rb = sd.seat === 'on' ? sec.ri : sec.ro;
    if (!(Rh > 0) || !(rb > 0) || rb >= Rh - 1e-6 || sd.badOd) return null;
    if (sd.seat === 'on' && sec.od > sd.hod + 1e-9) return null;
    if (sd.seat === 'thru' && sec.od > sd.hid + 1e-9) return null;
    const sa = Math.sin(sd.alpha), ca = Math.cos(sd.alpha);
    if (sa < .02) return null;
    const N = 160, pts = [], p3 = [];
    let zMin = 1e9, zMax = -1e9, uMin = 1e9, uMax = -1e9;
    for (let i = 0; i < N; i++) {
      const t = i / N * 2 * Math.PI;
      const y = rb * Math.sin(t);
      const x = Math.sqrt(Math.max(0, Rh * Rh - y * y));
      const s = (x - rb * Math.cos(t) * ca) / sa;
      const z = s * ca - rb * Math.cos(t) * sa;
      const u = Rh * Math.atan2(y, x);
      pts.push([z, u]); p3.push([x, y, z]);
      zMin = Math.min(zMin, z); zMax = Math.max(zMax, z);
      uMin = Math.min(uMin, u); uMax = Math.max(uMax, u);
    }
    return { pts, p3, Rh, rb, zMin, zMax, uMin, uMax, along: zMax - zMin, around: uMax - uMin };
  }
  _headerHoleDxf(id) {
    const c = this.calc(), st = this.state;
    if (c.invalid || c.kind !== 'round') return null;
    const E = id === 'A' ? c.A : c.B;
    if (!E || E.mode !== 'saddle' || !E.sd) return null;
    const hh = this.headerHole(E, c.sec);
    if (!hh) return null;
    const sd = E.sd;
    const anno = !!st.dxfRef;
    const Ls = [];
    const w = (code, val) => { Ls.push(String(code), String(val)); };
    w(0, 'SECTION'); w(2, 'HEADER'); w(9, '$INSUNITS'); w(70, 1); w(9, '$MEASUREMENT'); w(70, 0); w(0, 'ENDSEC');
    w(0, 'SECTION'); w(2, 'TABLES'); w(0, 'TABLE'); w(2, 'LAYER'); w(70, 3);
    for (const [nm, col] of [['CUT', 1], ['REF', 8], ['MARK', 3]]) { w(0, 'LAYER'); w(2, nm); w(70, 0); w(62, col); w(6, 'CONTINUOUS'); }
    w(0, 'ENDTAB'); w(0, 'ENDSEC');
    w(0, 'SECTION'); w(2, 'ENTITIES');
    const poly = (pts, layer, closed) => {
      w(0, 'POLYLINE'); w(8, layer); w(66, 1); w(70, closed ? 1 : 0);
      for (const p of pts) { w(0, 'VERTEX'); w(8, layer); w(10, p[0].toFixed(6)); w(20, p[1].toFixed(6)); w(30, 0); }
      w(0, 'SEQEND');
    };
    const line = (x1, y1, x2, y2, layer) => { if (layer !== 'CUT' && !anno) return; w(0, 'LINE'); w(8, layer); w(10, x1.toFixed(6)); w(20, y1.toFixed(6)); w(11, x2.toFixed(6)); w(21, y2.toFixed(6)); };
    const text = (x, y, h, s, layer) => { if (!anno) return; w(0, 'TEXT'); w(8, layer || 'MARK'); w(10, x.toFixed(6)); w(20, y.toFixed(6)); w(40, h); w(1, this.ascii(s)); };
    poly(hh.pts, 'CUT', true);
    line(hh.zMin - .75, 0, hh.zMax + .75, 0, 'REF');
    line(0, hh.uMin - .75, 0, hh.uMax + .75, 'REF');
    text(hh.zMax + .9, .1, .2, 'Y0 = BRANCH CL LINE ON HEADER', 'REF');
    text(.1, hh.uMax + .9, .2, 'X0 = WP (BRANCH CL x HEADER CL)', 'REF');
    const hdrLbl = sd.custom ? 'OD ' + sd.hod.toFixed(3) + ' x ' + sd.hw.toFixed(3) + ' WALL' : sd.N + ' ' + this.schedLabel(sd.S);
    text(hh.zMin, hh.uMax + 1.6, .25, 'HEADER HOLE - END ' + id + ' | ' + (st.job ? 'JOB ' + st.job + ' | ' : '') + 'MARK ' + (st.mark || '-') + ' | HEADER ' + hdrLbl + ' | BRANCH ' + c.sec.label + ' @ ' + Math.round(sd.alpha * 180 / Math.PI) + ' DEG SET-' + (sd.seat === 'on' ? 'ON (HOLE = BRANCH ID)' : 'THRU (HOLE = BRANCH OD)'), 'MARK');
    text(hh.zMin, hh.uMin - 1.2, .22, 'HOLE ' + hh.along.toFixed(3) + ' ALONG x ' + hh.around.toFixed(3) + ' AROUND | WRAP ON HEADER OD ' + sd.hod.toFixed(3) + ' | X = ALONG HEADER, + TOWARD BRANCH LEAN | Y = WRAP FROM BRANCH CL | SEPARATE PROGRAM - CUT IN THE HEADER STICK | TRUE SIZE, KERF IN CAM | BRANCH ROLL DOES NOT CHANGE THIS HOLE', 'MARK');
    w(0, 'ENDSEC'); w(0, 'EOF');
    return Ls.join('\n') + '\n';
  }
  /** Multi-branch header: every branch opening on one true-size header wrap
   *  program. Reuses the single-saddle headerHole math per branch, offset by
   *  distance along the header and azimuth around it (0 = top, seam at 180). */
  hdrBranchCurves() {
    const st = this.state, D = this.D, hb = st.hdrB;
    if (!D || !hb || !hb.list.length) return null;
    const hod = D.PIPE_OD[hb.nps] || 10.75;
    const hw = (D.PIPE_WALL[hb.sch] || D.PIPE_WALL.STD)[hb.nps] || .365;
    const W = Math.PI * hod;
    const out = { hod, hw, hid: hod - 2 * hw, W, curves: [], warns: [] };
    for (const b of hb.list) {
      const bod = D.PIPE_OD[b.nps] || 2.375;
      const bw = (D.PIPE_WALL[b.sch] || D.PIPE_WALL.STD)[b.nps] || .154;
      const alpha = Math.max(20, Math.min(90, parseFloat(b.alphaT) || 90)) * Math.PI / 180;
      const dist = this.parseIn(b.distT);
      const az = ((parseFloat(b.azT) || 0) % 360 + 360) % 360;
      const sec = { kind: 'round', ro: bod / 2, ri: bod / 2 - bw, od: bod };
      const E = { mode: 'saddle', sd: { hod, hw, hid: out.hid, alpha, roll: 0, seat: hb.seat, Rs: hb.seat === 'on' ? hod / 2 : out.hid / 2, badOd: false } };
      const lbl = 'B' + b.id + ' \u2014 ' + b.nps + ' ' + this.schedLabel(b.sch) + ' @' + Math.round(alpha * 180 / Math.PI) + ' DEG AZ ' + Math.round(az);
      if (hb.seat === 'on' && bod > hod) { out.warns.push(lbl + ': branch OD is larger than the header \u2014 skipped.'); continue; }
      if (hb.seat === 'thru' && bod > out.hid) { out.warns.push(lbl + ': branch will not pass the header bore \u2014 skipped.'); continue; }
      if (dist == null) { out.warns.push(lbl + ': distance will not parse \u2014 skipped.'); continue; }
      const hh = this.headerHole(E, sec);
      if (!hh) { out.warns.push(lbl + ': no valid opening \u2014 skipped.'); continue; }
      const y0 = W * (((az + 180) % 360) / 360);
      const pts = hh.pts.map(p => [dist + p[0], y0 + p[1]]);
      let yMin = 1e9, yMax = -1e9;
      for (const p of pts) { yMin = Math.min(yMin, p[1]); yMax = Math.max(yMax, p[1]); }
      if (yMin < 0 || yMax > W) out.warns.push(lbl + ': opening crosses the program seam (180 DEG bottom) \u2014 spin the azimuth.');
      out.curves.push({ b, lbl, pts, x0: dist + hh.zMin, x1: dist + hh.zMax, yMin, yMax, dist, az });
    }
    // crude clash check between neighboring openings
    for (let i = 0; i < out.curves.length; i++) for (let j = i + 1; j < out.curves.length; j++) {
      const a = out.curves[i], b2 = out.curves[j];
      if (a.x1 > b2.x0 - .25 && b2.x1 > a.x0 - .25 && a.yMax > b2.yMin - .25 && b2.yMax > a.yMin - .25)
        out.warns.push(a.lbl + ' and ' + b2.lbl + ' overlap or nearly touch \u2014 check spacing.');
    }
    return out.curves.length ? out : null;
  }
  _hdrProgramDxf() {
    const st = this.state, hb = st.hdrB;
    const hc = this.hdrBranchCurves();
    if (!hc) return null;
    const anno = !!st.dxfRef;
    const Ls = [];
    const w = (code, val) => { Ls.push(String(code), String(val)); };
    w(0, 'SECTION'); w(2, 'HEADER'); w(9, '$INSUNITS'); w(70, 1); w(9, '$MEASUREMENT'); w(70, 0); w(0, 'ENDSEC');
    w(0, 'SECTION'); w(2, 'TABLES'); w(0, 'TABLE'); w(2, 'LAYER'); w(70, 3);
    for (const [nm, col] of [['CUT', 1], ['REF', 8], ['MARK', 3]]) { w(0, 'LAYER'); w(2, nm); w(70, 0); w(62, col); w(6, 'CONTINUOUS'); }
    w(0, 'ENDTAB'); w(0, 'ENDSEC');
    w(0, 'SECTION'); w(2, 'ENTITIES');
    const poly = (pts, layer) => {
      w(0, 'POLYLINE'); w(8, layer); w(66, 1); w(70, 1);
      for (const p of pts) { w(0, 'VERTEX'); w(8, layer); w(10, p[0].toFixed(6)); w(20, p[1].toFixed(6)); w(30, 0); }
      w(0, 'SEQEND');
    };
    const line = (x1, y1, x2, y2, layer) => { if (layer !== 'CUT' && !anno) return; w(0, 'LINE'); w(8, layer); w(10, x1.toFixed(6)); w(20, y1.toFixed(6)); w(11, x2.toFixed(6)); w(21, y2.toFixed(6)); };
    const text = (x, y, h, s2, layer) => { if (!anno) return; w(0, 'TEXT'); w(8, layer || 'MARK'); w(10, x.toFixed(6)); w(20, y.toFixed(6)); w(40, h); w(1, this.ascii(s2)); };
    let x0 = 0, x1 = 0;
    for (const cv of hc.curves) { x0 = Math.min(x0, cv.x0); x1 = Math.max(x1, cv.x1); }
    x0 -= 6; x1 += 6;
    for (const [nm, f] of [['180DEG BOTTOM (SEAM)', 0], ['270DEG', .25], ['0DEG TOP', .5], ['90DEG', .75], ['180DEG BOTTOM', 1]]) {
      line(x0, hc.W * f, x1, hc.W * f, 'REF'); text(x0 + .1, hc.W * f + .12, .2, nm, 'REF');
    }
    line(0, -.4, 0, hc.W + .4, 'REF'); text(.1, hc.W + .6, .25, 'X0 = WP', 'REF');
    for (const cv of hc.curves) {
      poly(cv.pts, 'CUT');
      line(cv.dist, -.4, cv.dist, hc.W + .4, 'REF');
      text(cv.dist + .1, hc.W + .3, .2, 'B' + cv.b.id + ' @ ' + this.fmtIn(cv.dist), 'REF');
      text(cv.x0, cv.yMin - .5, .22, cv.lbl + ' | HOLE = BRANCH ' + (hb.seat === 'on' ? 'ID' : 'OD'), 'MARK');
    }
    text(x0, -1.2, .25, 'HEADER PROGRAM - ' + hb.nps + ' ' + this.schedLabel(hb.sch) + ' | ' + (st.job ? 'JOB ' + st.job + ' | ' : '') + hc.curves.length + ' BRANCH OPENINGS | WRAP ' + hc.W.toFixed(3) + ' ON OD ' + hc.hod.toFixed(3) + ' | X = ALONG HEADER FROM WP, Y = WRAP FROM 180 DEG BOTTOM SEAM | CLOCK 0 DEG = TOP OF HEADER, + SAME HAND AS THE BRANCH WRAP (90 DEG AT THE 3/4 BAND) | SET-' + (hb.seat === 'on' ? 'ON (HOLES = BRANCH ID)' : 'THRU (HOLES = BRANCH OD)') + ' | TRUE SIZE, KERF IN CAM', 'MARK');
    w(0, 'ENDSEC'); w(0, 'EOF');
    return Ls.join('\n') + '\n';
  }

  _qrImg(payload, cells) {
    try {
      if (typeof qrcode === 'undefined') return '';
      const qr = qrcode(0, 'L');
      qr.addData(payload); qr.make();
      return '<img src="' + qr.createDataURL(cells || 3, 2) + '" style="image-rendering:pixelated">';
    } catch (e) { return '<div style="font:700 8px/1.3 monospace;color:#B3261E;max-width:90px">CODE TOO LONG FOR QR \u2014 RELOAD FROM THE JOB FILE</div>'; }
  }
  _logoImg(h) { return this._logo ? '<img src="' + this._logo + '" style="height:' + (h || 40) + 'px;background:#000;padding:3px 8px;border-radius:3px">' : ''; }

  /** Shared print stylesheet — the Steampunk Fab design system adapted for
   *  paper: white page, ink + steel + hi-vis (darkened for print contrast),
   *  Saira Condensed italic display, Saira table heads, JetBrains Mono data.
   *  Falls back to Arial/monospace when the shop PC is offline. */
  /** Local @font-face set for print tickets. The ticket opens in a separate
   *  about:blank popup, so font URLs must be absolute against the app origin.
   *  Replaces the old Google Fonts @import — same faces, works offline.
   *  (Saira Condensed has no true italic; the browser synthesizes it from
   *  the 800 upright, exactly as the on-screen UI always has.) */
  _ticketFonts() {
    const u = (f) => { try { return new URL('fonts/' + f, location.href).href; } catch (e) { return 'fonts/' + f; } };
    const face = (fam, w, file) => '@font-face{font-family:"' + fam + '";font-style:normal;font-weight:' + w + ';src:url("' + u(file) + '") format("woff2")}';
    return face('Saira Condensed', 800, 'saira-condensed-800.woff2') +
      face('Saira', 500, 'saira-500.woff2') + face('Saira', 700, 'saira-700.woff2') +
      face('Barlow', 400, 'barlow-400.woff2') + face('Barlow', 500, 'barlow-500.woff2') + face('Barlow', 700, 'barlow-700.woff2') +
      face('JetBrains Mono', 400, 'jetbrains-mono-400.woff2') + face('JetBrains Mono', 500, 'jetbrains-mono-500.woff2') + face('JetBrains Mono', 700, 'jetbrains-mono-700.woff2');
  }
  _ticketCss() {
    return this._ticketFonts() +
      ':root{color-scheme:light only}' +
      '*{box-sizing:border-box}' +
      'html{background:#fff}' +
      'body{font:12px/1.5 Barlow,Arial,sans-serif;color:#14171B;background:#fff;margin:30px 36px;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
      '.top{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;border-bottom:2px solid #0A0B0D;padding-bottom:12px}' +
      '.brand{display:flex;align-items:center;gap:14px}' +
      '.eyebrow{font:700 8.5px/1 Saira,Arial,sans-serif;letter-spacing:.26em;color:#5C6670;text-transform:uppercase}' +
      'h1{font:800 28px/.95 "Saira Condensed","Arial Narrow",sans-serif;font-style:italic;text-transform:uppercase;letter-spacing:.01em;color:#0A0B0D;margin:4px 0 0}' +
      '.meta{text-align:right;font:500 9px/1.8 "JetBrains Mono",monospace;color:#5C6670;letter-spacing:.05em;text-transform:uppercase}' +
      '.rule{height:2px;background:#A6CE39;margin:0 0 18px}' +
      'h2{font:800 13px/1 "Saira Condensed","Arial Narrow",sans-serif;font-style:italic;text-transform:uppercase;letter-spacing:.04em;color:#0A0B0D;margin:20px 0 4px;display:flex;align-items:baseline;gap:10px}' +
      'h2 .sub{font:500 8px/1.5 "JetBrains Mono",monospace;font-style:normal;letter-spacing:.05em;color:#7E8893}' +
      'table{border-collapse:collapse;width:100%;margin:2px 0 4px}' +
      'th{font:700 8.5px/1.3 Saira,Arial,sans-serif;letter-spacing:.15em;text-transform:uppercase;color:#5C6670;border-bottom:2px solid #0A0B0D;padding:6px 10px 5px 0;text-align:left}' +
      'td{font:500 11px/1.5 "JetBrains Mono",monospace;color:#14171B;border-bottom:1px solid #E4E8EB;padding:6px 10px 6px 0;text-align:left;vertical-align:top}' +
      '.hv{color:#7A9A24;font-weight:700}' +
      '.big{font-size:12.5px;font-weight:700}' +
      '.k{font:400 10px/1.55 Barlow,Arial,sans-serif;color:#5C6670}' +
      '.flags{border-left:3px solid #D2402F;padding:6px 0 6px 12px;margin:14px 0}' +
      '.flags b{font:700 9px/1 Saira,Arial,sans-serif;letter-spacing:.2em;color:#D2402F;text-transform:uppercase;display:block;margin-bottom:4px}' +
      '.flags div{font:400 10.5px/1.6 Barlow,Arial,sans-serif;color:#2F363F}' +
      '.drawing{border:1px solid #C9CFD5;background:#fff;padding:8px;margin-top:4px}' +
      '.qrrow{display:flex;gap:16px;align-items:center;border-top:1px solid #E4E8EB;padding-top:12px;margin-top:16px}' +
      '.sign{display:flex;gap:28px;margin-top:34px}' +
      '.sig{flex:1;border-top:1px solid #14171B;padding-top:5px;font:700 8.5px/1 Saira,Arial,sans-serif;letter-spacing:.18em;color:#5C6670;text-transform:uppercase}' +
      '@media print{body{margin:10mm 12mm}}';
  }
  _ticketTop(title, rightHtml) {
    return '<div class="top"><div class="brand">' + this._logoImg(38) +
      '<div><div class="eyebrow">Steampunk Fabrication · Shop Tools · 12KW Fiber Laser</div><h1>' + title + '</h1></div></div>' +
      '<div class="meta">' + rightHtml + '</div></div><div class="rule"></div>';
  }

  _ticketHtml() {
    const c = this.calc(), st = this.state, p = c.paths;
    if (c.invalid) return null;
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const faceLbl = (h) => c.kind === 'round' ? h.deg + '°' : c.kind === 'box' ? h.face + ' ' + this.fmtIn(h.off) : c.kind === 'angl' ? (h.face === 'vleg' ? 'V-LEG g' : 'H-LEG g') + this.fmtIn(h.c) : h.face.toUpperCase() + ' ' + this.fmtIn(h.c);
    const hdrTxt = (E) => { const hh = c.kind === 'round' && E && E.mode === 'saddle' ? this.headerHole(E, c.sec) : null; return hh ? ' — HEADER HOLE ' + this.fmtIn(hh.along) + ' ALONG × ' + this.fmtIn(hh.around) + ' AROUND (SEPARATE HDR-HOLE DXF)' : ''; };
    const rows = c.holes.map(h => '<tr><td>' + h.grp + '</td><td>' + faceLbl(h) + '</td><td>' + h.type.toUpperCase() + '</td><td>Ø' + this.fr16(h.dia) + (h.slotL ? ' × ' + this.fmtIn(h.slotL) + ' (' + (h.ax === 'x' ? 'ALONG' : 'ACROSS') + ')' : '') + '</td><td>' + this.fmtIn(h.x) + '</td><td>' + (h.ok ? 'OK' : '<span style="color:#D2402F;font-weight:700">CHECK</span>') + '</td></tr>').join('');
    const svg = '<svg viewBox="' + p.vb + '" style="width:100%;display:block">' +
      '<path d="' + p.gridP + '" stroke="#ddd" stroke-width="' + p.swThin + '" fill="none"/>' +
      '<path d="' + p.refP + '" stroke="#bbb" stroke-width="' + p.swThin + '" fill="none"/>' +
      '<path d="' + p.wpP + '" stroke="#888" stroke-width="' + p.swThin + '" stroke-dasharray="' + p.dash + '" fill="none"/>' +
      '<path d="' + p.outAP + '" fill="#f2f2f2" stroke="#111" stroke-width="' + p.sw + '"/>' +
      '<path d="' + p.outBP + '" fill="#f2f2f2" stroke="#111" stroke-width="' + p.sw + '"/>' +
      '<path d="' + p.outCP + '" fill="#f2f2f2" stroke="#111" stroke-width="' + p.sw + '"/>' +
      '<path d="' + p.holesP + '" fill="none" stroke="#7A9A24" stroke-width="' + p.sw + '"/>' +
      p.lbls.map(b => '<text x="' + b.x + '" y="' + b.y + '" font-size="' + p.fs + '" fill="#555" font-family="monospace">' + esc(b.t) + '</text>').join('') + '</svg>';
    const payload = this.encodeCfg(this.snapshot());
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>CUT TICKET ' + esc(st.mark) + '</title><style>' + this._ticketCss() + '</style></head><body>' +
      this._ticketTop('Cut Ticket', (st.job ? 'JOB <b>' + esc(st.job) + '</b><br>' : '') + new Date().toLocaleDateString() + '<br>TRUE SIZE — KERF STAYS IN CAM') +
      '<table><tr><th>Mark</th><th>Qty</th><th>Heat</th><th>Grade</th><th>Section</th><th>Cut len</th><th>Long point</th><th>Short point</th><th>Wt ea</th></tr>' +
      '<tr><td class="big">' + esc(st.mark || '—') + '</td><td class="big">' + st.qty + '</td><td>' + esc(st.heat || '—') + '</td><td>' + this.matRec().label + '</td><td>' + this.famLabel() + ' ' + c.sec.label + '</td><td class="big">' + this.fmtFtIn(c.L) + '</td><td class="hv big">' + this.fmtFtIn(c.LP) + '</td><td>' + this.fmtFtIn(c.SP) + '</td><td>' + c.wt.toFixed(0) + ' LB</td></tr></table>' +
      '<h2>End prep</h2>' +
      '<table><tr><th style="width:72px">End</th><th>Prep</th></tr>' +
      '<tr><td class="big">A · LEFT</td><td>' + this.endSpecText(c.A, c.sec) + hdrTxt(c.A) + '</td></tr>' +
      '<tr><td class="big">B · RIGHT</td><td>' + this.endSpecText(c.B, c.sec) + hdrTxt(c.B) + '</td></tr></table>' +
      (c.warns.length ? '<div class="flags"><b>Check before cutting</b>' + c.warns.map(x => '<div>■ ' + esc(x.t) + '</div>').join('') + '</div>' : '') +
      '<h2>What the laser cuts <span class="sub">' + (c.kind === 'round' || c.kind === 'box' ? 'TRUE SIZE · X ALONG THE STICK · Y WRAPS FROM THE BOTTOM SEAM (' + (c.kind === 'round' ? '180°' : 'BOTTOM FACE CL') + ') · TOP OF PART AT MID-BAND' : 'TRUE SIZE · EACH FACE ITS OWN BAND') + '</span></h2>' +
      '<div class="drawing">' + svg + '</div>' +
      (rows ? '<h2>Holes</h2><table><tr><th>Grp</th><th>Where</th><th>Type</th><th>Hole</th><th>X from WP A</th><th>Status</th></tr>' + rows + '</table>' : '<p class="k">NO HOLES.</p>') +
      '<div class="qrrow">' + this._qrImg(payload, 3) + '<div class="k"><b style="font:700 9px/1.8 Saira,Arial,sans-serif;letter-spacing:.18em;color:#2F363F;text-transform:uppercase;display:block">Recall this part</b>Scan the QR or paste its code into PART BUILDER ▸ RECALL to reload this exact part and pull its DXF / 3D / ticket. True size — kerf + bevel comp stay in CAM. ' + (c.kind === 'round' || c.kind === 'box' ? 'Rotary program measured OD.' : 'Nominal dims — verify odd sizes. Fillets (k-zone) not modeled.') + '</div></div>' +
      '<div class="sign"><div class="sig">Fit by</div><div class="sig">QC</div><div class="sig">Date</div></div>' +
      '<p class="k" style="margin-top:8px">Print: Ctrl/Cmd+P</p>' +
      '</body></html>';
  }

  _jobTicketHtml() {
    const st = this.state;
    if (!st.parts.length) { alert('No parts in the job yet — ADD TO JOB LIST on step 5 first.'); return null; }
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const nests = this.nestGroups();
    const rates = { carbon: parseFloat(st.rateCT) || 0, stainless: parseFloat(st.rateST) || 0, aluminum: parseFloat(st.rateAT) || 0 };
    const totWt = st.parts.reduce((s, x) => s + x.wt * x.qty, 0);
    const totCost = st.parts.reduce((s, x) => s + x.wt * x.qty * (rates[x.cat] || 0), 0);
    const totPieces = st.parts.reduce((s, x) => s + x.qty, 0);
    const rows = st.parts.map(p => '<tr><td style="width:74px">' + this._qrImg(p.payload, 2) + '<div style="font-size:8.5px;color:#5C6670">' + p.code + '</div></td><td class="big">' + esc(p.mark) + '</td><td>' + p.qty + '</td><td>' + esc(p.desc) + '</td><td>' + p.lenT2 + '</td><td>' + this.fmtFtIn(p.oal) + '</td><td>' + p.wt.toFixed(0) + '</td><td>' + (p.wt * p.qty).toFixed(0) + '</td></tr>').join('');
    const nrows = nests.map(n => '<tr><td>' + esc(n.label) + '</td><td>' + n.pieces + '</td><td>' + (n.stickIn / 12) + '′</td><td class="big">' + n.sticks + '</td><td>' + Math.round(n.util * 100) + '%</td><td>' + this.fmtFtIn(n.drop) + (n.tooLong ? ' <span style="color:#D2402F;font-weight:700">⚠ PART LONGER THAN STICK</span>' : '') + '</td><td>' + n.wt.toFixed(0) + '</td></tr>').join('');
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>JOB TICKET ' + esc(st.job || '') + '</title><style>' + this._ticketCss() + '</style></head><body>' +
      this._ticketTop('Job Cut List', 'JOB <b>' + esc(st.job || '—') + '</b><br>' + new Date().toLocaleDateString() + '<br>TRUE SIZE — KERF STAYS IN CAM') +
      '<table><tr><th>Marks</th><th>Pieces</th><th>Total weight</th><th>Sticks to pull</th><th>Material ≈</th></tr>' +
      '<tr><td class="big">' + st.parts.length + '</td><td class="big">' + totPieces + '</td><td>' + Math.round(totWt) + ' LB</td><td class="hv big">' + nests.reduce((s, x) => s + x.sticks, 0) + '</td><td>$' + totCost.toFixed(0) + '</td></tr></table>' +
      '<h2>Pull list — stick nesting <span class="sub">EACH STICK KEEPS ' + esc(st.gripT) + '″ FOR THE CHUCK · ⅛″ KERF LOST BETWEEN PARTS</span></h2>' +
      '<table><tr><th>Profile · grade</th><th>Pcs</th><th>Stick</th><th>Sticks</th><th>Util</th><th>Drop (last stick)</th><th>Wt lb</th></tr>' + nrows + '</table>' +
      '<h2>Parts <span class="sub">SCAN ANY QR → PART BUILDER ▸ RECALL RELOADS THAT PART FOR ITS DXF / 3D / TICKET</span></h2>' +
      '<table><tr><th>Recall</th><th>Mark</th><th>Qty</th><th>Description</th><th>Cut len</th><th>OAL</th><th>Wt ea</th><th>Wt tot</th></tr>' + rows + '</table>' +
      '<div class="sign"><div class="sig">Pulled by</div><div class="sig">Programmed</div><div class="sig">QC</div><div class="sig">Date</div></div>' +
      '<p class="k" style="margin-top:8px">True size — kerf stays in CAM. Print: Ctrl/Cmd+P</p>' +
      '</body></html>';
  }

  pickFam(f) {
    return () => this.setState(s => {
      const mat = { pipe: 'A106B', tube: 'A500B', hss: 'A500B', beam: 'A992', chan: 'A36', angl: 'A36' }[f];
      const mk = { pipe: 'P', tube: 'T', hss: 'H', beam: 'B', chan: 'C', angl: 'L' }[f];
      const mark = /^[PTHBCL]-\d+$/.test(s.mark) ? mk + '-' + s.mark.split('-')[1] : s.mark;
      const fix = (e) => {
        const ne = Object.assign({}, e);
        if (f === 'pipe' || f === 'tube') { if (ne.mode !== 'miter' && ne.mode !== 'saddle') ne.mode = 'sq'; if (ne.mode === 'ang') ne.mode = 'sq'; }
        else { if (ne.mode === 'miter' || ne.mode === 'saddle') ne.mode = 'sq'; if (f !== 'beam' && f !== 'chan') ne.wantCope = false; }
        return ne;
      };
      const faces = { pipe: ['wall'], tube: ['wall'], hss: ['T', 'R', 'B', 'L'], beam: ['web', 'tf', 'bf'], chan: ['web', 'tf', 'bf'], angl: ['vleg', 'hleg'] }[f];
      const types = (f === 'pipe' || f === 'tube') ? ['olet', 'stub', 'cust'] : f === 'hss' ? ['cust', 'slot'] : ['std', 'ovs', 'ssl', 'lsl', 'cust'];
      const fixG = (g) => {
        const ng = faces.includes(g.face) && types.includes(g.type) ? g : Object.assign({}, g);
        if (!faces.includes(ng.face)) ng.face = faces[0];
        if (!types.includes(ng.type)) ng.type = types[0];
        return ng;
      };
      return { family: f, mat, mark, ends: { A: fix(s.ends.A), B: fix(s.ends.B) }, groups: s.groups.map(fixG) };
    });
  }

  renderVals() {
    const st = this.state, c = this.calc(), p = c.paths, D = this.D;
    const setS = (k) => (e) => this.setState({ [k]: e.target.value });
    const setEnd = (id, k) => (e) => this.setState(s => ({ ends: Object.assign({}, s.ends, { [id]: Object.assign({}, s.ends[id], { [k]: e.target.value }) }) }));
    const setEndV = (id, k, v) => () => this.setState(s => ({ ends: Object.assign({}, s.ends, { [id]: Object.assign({}, s.ends[id], { [k]: v }) }) }));
    const tgEnd = (id, k) => () => this.setState(s => ({ ends: Object.assign({}, s.ends, { [id]: Object.assign({}, s.ends[id], { [k]: !s.ends[id][k] }) }) }));
    const setG = (id, k) => (e) => this.setState(s => ({ groups: s.groups.map(g => g.id === id ? Object.assign({}, g, { [k]: e.target.value }) : g) }));
    const goto = (n) => () => this.setState({ step: n });
    const pill = (sel) => ({ padding: '7px 12px', cursor: 'pointer', borderRadius: 4, border: '1px solid ' + (sel ? '#A6CE39' : '#434C57'), background: sel ? 'rgba(166,206,57,.15)' : 'transparent', color: sel ? '#C6E06F' : '#7E8893', font: '700 10.5px/1 Saira, sans-serif', letterSpacing: '.08em' });
    const copeBtn = (on) => ({ padding: '6px 8px', cursor: 'pointer', borderRadius: 4, whiteSpace: 'nowrap', border: '1px solid ' + (on ? '#A6CE39' : '#434C57'), background: on ? 'rgba(166,206,57,.12)' : 'transparent', color: on ? '#C6E06F' : '#7E8893', font: '700 9.5px/1.2 Saira, sans-serif', letterSpacing: '.06em' });
    const numS = (n) => { const done = st.step > n, act = st.step === n; return { flex: 'none', width: 22, height: 22, borderRadius: 11, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: done ? '#A6CE39' : 'transparent', border: '1px solid ' + (done || act ? '#A6CE39' : '#434C57'), color: done ? '#10130A' : act ? '#C6E06F' : '#7E8893', font: '700 11px/1 JetBrains Mono, monospace' }; };
    const famBtn = (f) => ({ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '10px 4px 8px', cursor: 'pointer', borderRadius: 4, border: '1px solid ' + (st.family === f ? '#A6CE39' : '#323A43'), background: st.family === f ? 'rgba(166,206,57,.10)' : 'var(--gunmetal-800)', color: st.family === f ? '#C6E06F' : '#AEB6BD' });
    const kind = c.kind || this.famKind();
    const isRoundFam = kind === 'round';
    const npsOpts = D ? Object.keys(D.PIPE_OD) : [], schedOpts = D ? D.PIPE_SCHEDS : [];
    const fmtDeg = (x) => (Math.round(x * 10) / 10) + '\u00B0';

    const endSteps = ['A', 'B'].map((id, i) => {
      const e = st.ends[id];
      const E = id === 'A' ? c.A : c.B;
      const hh = (E && E.mode === 'saddle' && c.kind === 'round') ? this.headerHole(E, c.sec) : null;
      const n = 2 + i;
      const roS = this.parseIn(e.roST) || 0, roR = this.parseIn(e.roRT) || 0, roA = this.parseIn(e.roAT) || 0;
      const travel = Math.sqrt(roS * roS + roR * roR + roA * roA);
      const theta = roA > 0 ? Math.atan2(Math.hypot(roS, roR), roA) * 180 / Math.PI : 0;
      const twist = Math.atan2(roR, roS) * 180 / Math.PI;
      return {
        id, side: id === 'A' ? '· left' : '· right', nT: st.step > n ? '\u2713' : String(n), nS: numS(n),
        sum: E ? this.endSpecText(E, c.sec) : '\u2014', side2: id === 'A' ? 'LEFT' : 'RIGHT', car: st.step === n ? '\u25BE' : '\u25B8',
        open: st.step === n, goto: goto(n), back: goto(n - 1), next: goto(n + 1),
        nextLbl: id === 'A' ? 'Next — End B' : 'Next — Holes',
        otherId: id === 'A' ? 'B' : 'A',
        mirror: () => this.setState(s => { const o = id === 'A' ? 'B' : 'A'; return { ends: Object.assign({}, s.ends, { [id]: JSON.parse(JSON.stringify(s.ends[o])) }) }; }),
        isRound: isRoundFam, notRound: !isRoundFam, isBeamFam: st.family === 'beam' || st.family === 'chan', isPlateFam: st.family === 'beam' || st.family === 'chan',
        mSq: setEndV(id, 'mode', 'sq'), mMiter: setEndV(id, 'mode', 'miter'), mSaddle: setEndV(id, 'mode', 'saddle'),
        mSqS: pill(e.mode === 'sq'), mMiterS: pill(e.mode === 'miter'), mSaddleS: pill(e.mode === 'saddle'),
        isMiter: e.mode === 'miter', isSaddle: e.mode === 'saddle',
        maT: e.maT, mrT: e.mrT, sMa: setEnd(id, 'maT'), sMr: setEnd(id, 'mrT'),
        sdN: e.sdN, sdS: e.sdS, sdAT: e.sdAT, sdRT: e.sdRT,
        sSdN: setEnd(id, 'sdN'), sSdS: setEnd(id, 'sdS'), sSdA: setEnd(id, 'sdAT'), sSdR: setEnd(id, 'sdRT'),
        npsOpts, schedOpts,
        seatOn: setEndV(id, 'sdSeat', 'on'), seatThru: setEndV(id, 'sdSeat', 'thru'),
        seatOnS: pill(e.sdSeat === 'on'), seatThruS: pill(e.sdSeat !== 'on'),
        hdrNps: e.sdHT !== 'cust', hdrCust: e.sdHT === 'cust',
        hdrPipe: setEndV(id, 'sdHT', 'nps'), hdrCustGo: setEndV(id, 'sdHT', 'cust'),
        hdrPipeS: pill(e.sdHT !== 'cust'), hdrCustS: pill(e.sdHT === 'cust'),
        sdHodT: e.sdHodT, sdHwT: e.sdHwT, sSdHod: setEnd(id, 'sdHodT'), sSdHw: setEnd(id, 'sdHwT'),
        hasHole: !!hh,
        holeDims: hh ? 'HDR HOLE ' + this.fmtIn(hh.along) + ' ALONG \u00D7 ' + this.fmtIn(hh.around) + ' AROUND \u00B7 ' + (e.sdSeat === 'on' ? 'HOLE = BRANCH ID' : 'HOLE = BRANCH OD') : '',
        dlHdrHole: () => { const t = this._headerHoleDxf(id); if (t) this._download(t, this.fileBase() + '_HDR-HOLE-' + id + '.dxf', 'application/dxf'); },
        sdChip: (E && E.sd) ? 'SEAT R ' + E.sd.Rs.toFixed(4) + '\u2033 (' + (E.sd.seat === 'on' ? 'HEADER OD/2' : 'HEADER ID/2') + ') \u00B7 HDR OD ' + E.sd.hod.toFixed(3) + ' / ID ' + E.sd.hid.toFixed(3) + ' \u00B7 SQUARE RADIAL CUT' : '',
        angNo: setEndV(id, 'mode', 'sq'), angYes: setEndV(id, 'mode', 'ang'),
        angNoS: pill(e.mode !== 'ang'), angYesS: pill(e.mode === 'ang'),
        angled: e.mode === 'ang',
        tpT: e.tpT, tvT: e.tvT, sTp: setEnd(id, 'tpT'), sTv: setEnd(id, 'tvT'),
        wantBevel: e.wantBevel, bevYes: setEndV(id, 'wantBevel', true), bevNo: setEndV(id, 'wantBevel', false),
        bevYesS: pill(e.wantBevel), bevNoS: pill(!e.wantBevel),
        bvT: e.bvT, landT: e.landT, open2: e.open, app: e.app,
        sBv: setEnd(id, 'bvT'), sLand: setEnd(id, 'landT'), sOpen: setEnd(id, 'open'), sApp: setEnd(id, 'app'),
        wantCope: e.wantCope, copYes: setEndV(id, 'wantCope', true), copNo: setEndV(id, 'wantCope', false),
        copYesS: pill(e.wantCope), copNoS: pill(!e.wantCope),
        tgTop: tgEnd(id, 'ct'), tgBot: tgEnd(id, 'cb'), topBtn: copeBtn(e.ct), botBtn: copeBtn(e.cb),
        tcT: e.tcT, tdT: e.tdT, trT: e.trT, bcT: e.bcT, bdT: e.bdT, brT: e.brT,
        sTc: setEnd(id, 'tcT'), sTd: setEnd(id, 'tdT'), sTr: setEnd(id, 'trT'), sBc: setEnd(id, 'bcT'), sBd: setEnd(id, 'bdT'), sBr: setEnd(id, 'brT'),
        rat: e.rat, sRat: setEnd(id, 'rat'), rrT: e.rrT, sRr: setEnd(id, 'rrT'),
        showRO: isRoundFam && id === 'B' && e.mode === 'miter',
        roST: e.roST, roRT: e.roRT, roAT: e.roAT,
        sRoS: setEnd(id, 'roST'), sRoR: setEnd(id, 'roRT'), sRoA: setEnd(id, 'roAT'),
        roChip: roA > 0 ? 'TRAVEL ' + this.fmtFtIn(travel) + ' \u00B7 CUT ' + fmtDeg(theta / 2) + ' BOTH ENDS \u00B7 TWIST ' + fmtDeg(twist) : 'enter set / roll / advance',
        roApply: () => {
          if (roA <= 0) return;
          this.setState(s => ({
            lenT: this.fmtFtIn(travel).replace(/[\u2032]/g, "'").replace(/[\u2033]/g, ''),
            ends: {
              A: Object.assign({}, s.ends.A, { mode: 'miter', maT: String(Math.round(theta / 2 * 10) / 10), mrT: String(Math.round(twist)) }),
              B: Object.assign({}, s.ends.B, { mode: 'miter', maT: String(Math.round(theta / 2 * 10) / 10), mrT: String(Math.round(twist + 180)) })
            }
          }));
        }
      };
    });

    const faceOptsFor = { pipe: [{ v: 'wall', l: 'THRU WALL' }], tube: [{ v: 'wall', l: 'THRU WALL' }], hss: [{ v: 'T', l: 'TOP FACE' }, { v: 'R', l: 'RIGHT FACE' }, { v: 'B', l: 'BOTTOM FACE' }, { v: 'L', l: 'LEFT FACE' }], beam: [{ v: 'web', l: 'WEB' }, { v: 'tf', l: 'TOP FLG' }, { v: 'bf', l: 'BOT FLG' }], chan: [{ v: 'web', l: 'WEB' }, { v: 'tf', l: 'TOP FLG' }, { v: 'bf', l: 'BOT FLG' }], angl: [{ v: 'vleg', l: 'VERT LEG' }, { v: 'hleg', l: 'HORIZ LEG' }] }[st.family];
    const isBoltMat = st.family === 'beam' || st.family === 'chan' || st.family === 'angl';
    const patchG = (id2, patch) => () => this.setState(s => ({ groups: s.groups.map(x => x.id === id2 ? Object.assign({}, x, patch) : x) }));
    const groups = st.groups.map(g => {
      const nOKg = c.holes.filter(h => h.grp === g.id && h.ok).length;
      const nAll = c.holes.filter(h => h.grp === g.id).length;
      const dia = this.holeSize(g).dia;
      return {
        id: g.id, face: g.face, bolt: g.bolt, type: g.type, refEnd: g.refEnd, ax: g.ax,
        bnps: g.bnps || '1', bsch: g.bsch || 'STD', sllT: g.sllT || '1 1/2',
        sBnps: setG(g.id, 'bnps'), sBsch: setG(g.id, 'bsch'), sSll: setG(g.id, 'sllT'),
        bnpsOpts: npsOpts, bschOpts: schedOpts,
        isBoltMat, isRoundMat: isRoundFam, isHssMat: st.family === 'hss',
        isOlet: isRoundFam && g.type === 'olet',
        showDia: g.type === 'cust' || (st.family === 'hss' && (g.type === 'cust' || g.type === 'slot')),
        diaLbl: st.family === 'hss' && g.type === 'slot' ? 'SLOT WIDTH' : 'HOLE Ø',
        isHssSlot: st.family === 'hss' && g.type === 'slot',
        diaEcho: 'HOLE Ø ' + this.fr16(dia) + '″ (' + dia.toFixed(3) + '″) · SQUARE CUT — BEVEL IN CAM / GRIND AT FIT-UP',
        x0T: g.x0T, pT: g.pT, nT: g.nT, azT: g.azT, aznT: g.aznT, azpT: g.azpT, offT: g.offT,
        wref: g.wref, y0T: g.y0T, nyT: g.nyT, pyT: g.pyT, amode: g.amode, gT: g.gT, diaT: g.diaT,
        xsT: g.xsT || '', sXs: setG(g.id, 'xsT'),
        explain: isRoundFam ? 'Branch opening for an olet / sockolet / stub — not a bolt hole. Along the pipe from end ' + g.refEnd + ' · pick a clock position below. 6:00 dead-bottom is the program seam — use 5:00 / 7:00 and roll at fit-up.'
          : st.family === 'hss' ? 'Along the tube from end ' + g.refEnd + ' · offset from that face’s centerline — T/B faces: + toward the R face · L/R faces: + up.'
          : g.face === 'web' ? 'Along the beam from end ' + g.refEnd + ' · rows down from TOS (top of steel), up from BOS, or down from the centerline.'
          : st.family === 'angl' ? 'Along the angle from end ' + g.refEnd + ' · gauge measured out from the HEEL (the corner).'
          : c.sec.chan ? 'Along the channel from end ' + g.refEnd + ' · gauge measured from the BACK of the channel.'
          : 'Along the beam from end ' + g.refEnd + ' · gauge = two hole lines that far apart, centered on the web (or one line at an offset).',
        faceOpts: faceOptsFor,
        isRound: isRoundFam, isBoxFace: st.family === 'hss', isWeb: (st.family === 'beam' || st.family === 'chan') && g.face === 'web', isFlg: (st.family === 'beam' || st.family === 'chan') && g.face !== 'web', isLeg: st.family === 'angl',
        isSlot: g.type === 'ssl' || g.type === 'lsl' || g.type === 'slot', isCust: g.type === 'cust',
        gaugeLabel: c.sec.chan ? 'ONE LINE — GAUGE FROM BACK' : 'TWO LINES, CENTERED (GAUGE)',
        gLbl: st.family === 'angl' ? 'GAUGE FROM HEEL' : g.amode === 'gauge' ? (c.sec.chan ? 'GAUGE FROM BACK' : 'GAUGE — LINE TO LINE') : 'OFFSET FROM CENTER',
        chip: '\u2192 ' + nOKg + (nAll !== nOKg ? '/' + nAll : '') + ' \u00D7 \u00D8' + this.fr16(dia),
        sFace: setG(g.id, 'face'), sBolt: setG(g.id, 'bolt'), sType: setG(g.id, 'type'), sRef: setG(g.id, 'refEnd'), sAx: setG(g.id, 'ax'),
        sX0: setG(g.id, 'x0T'), sP: setG(g.id, 'pT'), sN: setG(g.id, 'nT'),
        sAz: setG(g.id, 'azT'), sAzn: setG(g.id, 'aznT'), sAzp: setG(g.id, 'azpT'), sOff: setG(g.id, 'offT'),
        sWref: setG(g.id, 'wref'), sY0: setG(g.id, 'y0T'), sNy: setG(g.id, 'nyT'), sPy: setG(g.id, 'pyT'), sAmode: setG(g.id, 'amode'), sG: setG(g.id, 'gT'), sDia: setG(g.id, 'diaT'),
        hasFaces: faceOptsFor.length > 1,
        clocks: !isRoundFam ? [] : (() => {
          const azv = ((parseFloat(g.azT) || 0) % 360 + 360) % 360, aznV = Math.round(parseFloat(g.aznT) || 1), azpV = parseFloat(g.azpT) || 0;
          const bs = (on) => 'flex:none;padding:6px 8px;cursor:pointer;border-radius:4px;font:700 9.5px/1 var(--font-mono);' + (on ? 'border:1px solid var(--hivis);background:rgba(166,206,57,.14);color:var(--hivis)' : 'border:1px solid var(--steel-600);background:transparent;color:var(--fg-2)');
          const one = (l, d2, tip) => ({ l, tip, s: bs(aznV === 1 && Math.abs(azv - d2) < .01), go: patchG(g.id, { azT: String(d2), aznT: '1' }) });
          return [one('12:00 TOP', 0, 'Straight up'), one('3:00', 90, 'Right side, looking in from end A'), one('9:00', 270, 'Left side, looking in from end A'), one('5:00', 150, 'Low — just off the 6:00 program seam. Roll at fit-up if it must be dead-bottom.'), one('7:00', 210, 'Low — other side of the seam'),
            { l: '3+9 BOTH SIDES', tip: 'Same hole both sides — gauge / instrument ports', s: bs(aznV === 2 && Math.abs(azv - 90) < .01 && Math.abs(azpV - 180) < .01), go: patchG(g.id, { azT: '90', aznT: '2', azpT: '180' }) }];
        })(),
        center: () => this.centerGroup(g.id, 'x'),
        centerY: () => this.centerGroup(g.id, 'y'),
        hasCtrY: (st.family === 'beam' || st.family === 'chan') && g.face === 'web' && !!(c.sec && c.sec.d),
        cenS: (() => { const on = this.groupCenteredAx(g, c).x; return (on ? 'border:1px solid var(--hivis);background:rgba(166,206,57,.14);color:var(--hivis);' : 'border:1px solid var(--steel-600);background:transparent;color:var(--fg-2);') + 'flex:none;padding:6px 8px;cursor:pointer;border-radius:4px;font:700 8.5px/1 var(--font-head);letter-spacing:.06em;text-transform:uppercase'; })(),
        cenSY: (() => { const on = this.groupCenteredAx(g, c).y; return (on ? 'border:1px solid var(--hivis);background:rgba(166,206,57,.14);color:var(--hivis);' : 'border:1px solid var(--steel-600);background:transparent;color:var(--fg-2);') + 'flex:none;padding:6px 8px;cursor:pointer;border-radius:4px;font:700 8.5px/1 var(--font-head);letter-spacing:.06em;text-transform:uppercase'; })(),
        stdG: (() => { const v = this.stdGauge(g); return v != null ? this.fr16(v) : ''; })(),
        hasStdG: this.stdGauge(g) != null && (st.family === 'angl' || ((st.family === 'beam' || st.family === 'chan') && g.face !== 'web' && g.amode === 'gauge')),
        stdTip: st.family === 'angl' ? 'AISC standard gauge from the heel for this leg size' : c.sec.chan ? 'Workable line — half the flange from the back, snapped to 1/4″. Verify vs your detail.' : 'AISC workable flange gauge for this beam. Verify vs your detail.',
        setStdG: () => { const v = this.stdGauge(g); if (v != null) this.setState(s => ({ groups: s.groups.map(x => x.id === g.id ? Object.assign({}, x, { gT: this.fmtTok(v), amode: 'gauge' }) : x) })); },
        canCopyOpp: ['tf', 'bf', 'T', 'B', 'L', 'R'].includes(g.face),
        copyOpp: () => this.setState(s => ({ gid: s.gid + 1, groups: s.groups.concat([Object.assign({}, g, { id: s.gid, face: { tf: 'bf', bf: 'tf', T: 'B', B: 'T', L: 'R', R: 'L' }[g.face] })]) })),
        del: () => this.setState(s => ({ groups: s.groups.filter(x => x.id !== g.id) }))
      };
    });

    const quicksFor = {
      round: [
        { l: 'Straight cut', f: () => this.setState(s => ({ step: 5, ends: { A: Object.assign({}, s.ends.A, { mode: 'sq' }), B: Object.assign({}, s.ends.B, { mode: 'sq' }) } })) },
        { l: '45° miter @ B', f: () => this.setState(s => ({ step: 3, ends: { A: Object.assign({}, s.ends.A, { mode: 'sq' }), B: Object.assign({}, s.ends.B, { mode: 'miter', maT: '45', mrT: '0' }) } })) },
        { l: 'Tee saddle @ A', f: () => this.setState(s => ({ step: 2, ends: { A: Object.assign({}, s.ends.A, { mode: 'saddle', sdAT: '90' }), B: Object.assign({}, s.ends.B, { mode: 'sq' }) } })) },
        { l: 'Lateral 45 @ A', f: () => this.setState(s => ({ step: 2, ends: { A: Object.assign({}, s.ends.A, { mode: 'saddle', sdAT: '45' }), B: Object.assign({}, s.ends.B, { mode: 'sq' }) } })) }
      ],
      box: [
        { l: 'Straight cut', f: () => this.setState(s => ({ step: 5, ends: { A: Object.assign({}, s.ends.A, { mode: 'sq' }), B: Object.assign({}, s.ends.B, { mode: 'sq' }) } })) },
        { l: '45° miter @ B', f: () => this.setState(s => ({ step: 3, ends: { A: Object.assign({}, s.ends.A, { mode: 'sq' }), B: Object.assign({}, s.ends.B, { mode: 'ang', tpT: '0', tvT: '45' }) } })) },
        { l: 'Picture frame', f: () => this.setState(s => ({ step: 2, ends: { A: Object.assign({}, s.ends.A, { mode: 'ang', tpT: '0', tvT: '45' }), B: Object.assign({}, s.ends.B, { mode: 'ang', tpT: '0', tvT: '45' }) } })) }
      ],
      plate: [
        { l: 'Straight drop', f: () => this.setState(s => ({ step: 5, wantHoles: s.wantHoles, ends: { A: Object.assign({}, s.ends.A, { mode: 'sq', wantBevel: false, wantCope: false, rat: 'NONE' }), B: Object.assign({}, s.ends.B, { mode: 'sq', wantBevel: false, wantCope: false, rat: 'NONE' }) } })) },
        { l: 'Clip angle @ A', f: () => this.setState(s => ({ step: 4, wantHoles: true, gid: s.gid + 1,
          ends: { A: Object.assign({}, s.ends.A, { mode: 'sq', wantCope: true, ct: true, cb: false, tcT: '4', tdT: '1 1/2', trT: '1/2', rat: 'BOT', rrT: '3/4' }), B: Object.assign({}, s.ends.B, { mode: 'sq' }) },
          groups: [Object.assign(Component.defGroup(s.gid, s.family), { face: 'web', bolt: '3/4', type: 'std', x0T: '3', pT: '3', nT: '3', wref: 'tos', y0T: '3', nyT: '2', pyT: '3' })] })) },
        { l: 'Std cope @ A', f: () => this.setState(s => ({ step: 2, ends: { A: Object.assign({}, s.ends.A, { mode: 'sq', wantCope: true, ct: true, cb: false, tcT: '4', tdT: '1 1/2', trT: '1/2', rat: 'BOT', rrT: '3/4' }), B: Object.assign({}, s.ends.B, { mode: 'sq' }) } })) },
        { l: '45° miter @ B', f: () => this.setState(s => ({ step: 3, ends: { A: Object.assign({}, s.ends.A, { mode: 'sq' }), B: Object.assign({}, s.ends.B, { mode: 'ang', tpT: '45', tvT: '0' }) } })) },
        { l: 'Coped both ends', f: () => this.setState(s => ({ step: 2, ends: { A: Object.assign({}, s.ends.A, { mode: 'sq', wantCope: true, ct: true, cb: false }), B: Object.assign({}, s.ends.B, { mode: 'sq', wantCope: true, ct: true, cb: false }) } })) }
      ],
      angl: [
        { l: 'Straight cut', f: () => this.setState(s => ({ step: 5, ends: { A: Object.assign({}, s.ends.A, { mode: 'sq' }), B: Object.assign({}, s.ends.B, { mode: 'sq' }) } })) },
        { l: '45° miter @ B', f: () => this.setState(s => ({ step: 3, ends: { A: Object.assign({}, s.ends.A, { mode: 'sq' }), B: Object.assign({}, s.ends.B, { mode: 'ang', tpT: '45', tvT: '0' }) } })) }
      ]
    };
    const quicks = (quicksFor[kind] || quicksFor.plate).map(q => ({ l: q.l, go: q.f }));

    const Lok = this.parseIn(st.lenT) != null && this.parseIn(st.lenT) > 0;
    const nOK = c.holes.filter(h => h.ok).length;
    const byDia = {};
    for (const h of c.holes) if (h.ok) { const k = (h.slotL ? 'SLOT ' + this.fr16(h.dia) + '\u00D7' + this.fmtIn(h.slotL) : '\u00D8' + this.fr16(h.dia)); byDia[k] = (byDia[k] || 0) + 1; }
    const nests = this.nestGroups();
    const rates = { carbon: parseFloat(st.rateCT) || 0, stainless: parseFloat(st.rateST) || 0, aluminum: parseFloat(st.rateAT) || 0 };
    const totWt = st.parts.reduce((s2, x) => s2 + x.wt * x.qty, 0);
    const totCost = st.parts.reduce((s2, x) => s2 + x.wt * x.qty * (rates[x.cat] || 0), 0);
    const totPieces = st.parts.reduce((s2, x) => s2 + x.qty, 0);
    const totSticks = nests.reduce((s2, x) => s2 + x.sticks, 0);
    const errN = c.warns.filter(w => w.lvl === 'err').length;
    const hhA = c.kind === 'round' && c.A && c.A.mode === 'saddle' ? this.headerHole(c.A, c.sec) : null;
    const hhB = c.kind === 'round' && c.B && c.B.mode === 'saddle' ? this.headerHole(c.B, c.sec) : null;

    const jobParts = st.parts.map(pt => ({
      id: pt.id, mark: pt.mark, desc: pt.desc, len: pt.lenT2, qtyT: '\u00D7' + pt.qty, wt: Math.round(pt.wt * pt.qty) + ' LB', code: pt.code,
      load: () => { const cfg = this.cfgFromPart(pt); if (cfg) this.setState(Object.assign({ step: 5 }, cfg)); },
      dup: () => this.setState(s => ({ parts: s.parts.concat([Object.assign({}, pt, { id: Date.now() + Math.random(), code: this.newCode() })]) })),
      del: () => this.setState(s => ({ parts: s.parts.filter(x => x.id !== pt.id) }))
    }));

    return {
      stepN: st.step,
      stepName: ['THE STOCK', 'END A \u00B7 LEFT', 'END B \u00B7 RIGHT', 'HOLES', 'REVIEW & CUT'][st.step - 1] || '',
      progS: { height: 3, width: (st.step / 5 * 100) + '%', background: '#A6CE39', borderRadius: 2, transition: 'width .18s cubic-bezier(.2,.7,.3,1)' },
      chip: (st.mark ? st.mark + ' \u00B7 ' : '') + c.sec.label + ' \u00D7 ' + (Lok ? this.fmtFtIn(c.L) : '?'),
      topChip: this.famLabel() + ' \u00B7 ' + c.sec.label + ' \u00B7 ' + this.matRec().label + ' \u00B7 ' + (Lok ? this.fmtFtIn(c.L) : '?'),
      tgJob: () => this.setState(s => ({ jobOpen: !s.jobOpen })),
      jobCount: String(totPieces),
      jobBtnS: { flex: 'none', cursor: 'pointer', borderRadius: 4, border: '1px solid ' + (st.jobOpen ? '#A6CE39' : '#434C57'), background: st.jobOpen ? 'rgba(166,206,57,.12)' : 'transparent', color: st.jobOpen ? '#C6E06F' : '#AEB6BD', font: '700 11px/1 Saira, sans-serif', letterSpacing: '.08em', padding: '9px 12px' },
      goto1: goto(1), goto2: goto(2), goto3b: goto(3), goto4: goto(4), goto5: goto(5),
      car1: st.step === 1 ? '\u25BE' : '\u25B8', car4: st.step === 4 ? '\u25BE' : '\u25B8', car5: st.step === 5 ? '\u25BE' : '\u25B8',
      helpOpen: st.help,
      tgHelp: () => { if (st.help) { try { localStorage.setItem('spf_pb_help_seen', '1'); } catch (e) {} } this.setState(s => ({ help: !s.help })); },
      closeHelp: () => { try { localStorage.setItem('spf_pb_help_seen', '1'); } catch (e) {} this.setState({ help: false }); },
      helpBtnS: { flex: 'none', cursor: 'pointer', borderRadius: 4, border: '1px solid ' + (st.help ? '#A6CE39' : '#434C57'), background: st.help ? 'rgba(166,206,57,.12)' : 'transparent', color: st.help ? '#C6E06F' : '#AEB6BD', font: '700 11px/1 Saira, sans-serif', letterSpacing: '.08em', padding: '9px 12px' },
      showEndTags: !st.spin,
      n1T: st.step > 1 ? '\u2713' : '1', n1S: numS(1), n4T: st.step > 4 ? '\u2713' : '4', n4S: numS(4), n5T: '5', n5S: numS(5),
      open1: st.step === 1, open4: st.step === 4, open5: st.step === 5,
      sum1: this.famLabel() + ' \u00B7 ' + c.sec.label + ' \u00D7 ' + (Lok ? this.fmtFtIn(c.L) : '?'),
      sum4: st.wantHoles ? nOK + ' holes' : 'none',
      sum5: c.invalid ? 'fix issues first' : (c.warns.length ? c.warns.length + ' flag(s) \u00B7 ' : '') + c.wt.toFixed(0) + ' lb \u00B7 add to job',
      ctaSub: (st.mark ? st.mark + ' \u00B7 ' : '') + c.sec.label + (c.invalid ? ' \u00B7 fix issues first' : ' \u00B7 job \u00B7 DXF \u00B7 3D \u00B7 ticket'),
      pickPipe: this.pickFam('pipe'), pickTube: this.pickFam('tube'), pickHss: this.pickFam('hss'), pickBeam: this.pickFam('beam'), pickChan: this.pickFam('chan'), pickAngl: this.pickFam('angl'),
      fbPipe: famBtn('pipe'), fbTube: famBtn('tube'), fbHss: famBtn('hss'), fbBeam: famBtn('beam'), fbChan: famBtn('chan'), fbAngl: famBtn('angl'),
      isPipe: st.family === 'pipe', isTube: st.family === 'tube', isHss: st.family === 'hss', isBeam: st.family === 'beam', isChan: st.family === 'chan', isAngl: st.family === 'angl',
      pnps: st.pnps, psch: st.psch, onPnps: setS('pnps'), onPsch: setS('psch'), pipeNpsOpts: npsOpts, pipeSchedOpts: schedOpts,
      todT: st.todT, twallT: st.twallT, onTod: setS('todT'), onTwall: setS('twallT'),
      tubeWallOpts: (D ? D.TUBE_WALLS : []).map(w2 => ({ l: w2[0], v: w2[1] })),
      onTwallPick: (e) => { if (e.target.value) this.setState({ twallT: e.target.value }); },
      hsize: st.hsize, hwallT: st.hwallT, onHsize: setS('hsize'), onHwall: setS('hwallT'),
      hssSizeOpts: D ? D.HSS_SIZES : [], hssWallOpts: D ? D.HSS_WALLS : [],
      bser: st.bser, onBser: (e) => { const v = e.target.value; this.setState({ bser: v, bsize: v === 'CUST' ? '' : Object.keys(D ? D[v] : { a: 1 })[0] }); },
      bsize: st.bsize, onBsize: setS('bsize'), beamSizeOpts: D && st.bser !== 'CUST' ? Object.keys(D[st.bser]) : [],
      isCustom: st.family === 'beam' && st.bser === 'CUST', notCustomBeam: st.family === 'beam' && st.bser !== 'CUST',
      cser: st.cser, onCser: (e) => { const v = e.target.value; this.setState({ cser: v, csize: Object.keys(D ? D[v] : { a: 1 })[0] }); },
      csize: st.csize, onCsize: setS('csize'), chanSizeOpts: D ? Object.keys(D[st.cser]) : [],
      asize: st.asize, athkT: st.athkT, onAsize: setS('asize'), onAthk: setS('athkT'),
      anglSizeOpts: D ? D.ANGLE_SIZES : [], anglThkOpts: D ? D.ANGLE_THKS : [],
      cdT: st.cdT, cbT: st.cbT, ctfT: st.ctfT, ctwT: st.ctwT, cwT: st.cwT,
      onCd: setS('cdT'), onCb: setS('cbT'), onCtf: setS('ctfT'), onCtw: setS('ctwT'), onCw: setS('cwT'),
      stockEcho: c.sec.label + ' \u00B7 ' + (c.sec.kind === 'round' ? 'OD ' + c.sec.od.toFixed(3) + '\u2033 \u00D7 WALL ' + c.sec.t.toFixed(3) + '\u2033 \u00B7 ID ' + (2 * c.sec.ri).toFixed(3) + '\u2033' : c.sec.kind === 'box' ? c.sec.H + '\u2033 TALL \u00D7 ' + c.sec.B + '\u2033 WIDE \u00D7 ' + c.sec.t.toFixed(3) + '\u2033 \u00B7 CR ' + c.sec.rc.toFixed(2) + '\u2033' : c.sec.kind === 'angl' ? c.sec.a + '\u2033 VERT \u00D7 ' + c.sec.b + '\u2033 HORIZ \u00D7 ' + c.sec.t.toFixed(3) + '\u2033' : 'd ' + c.sec.d + '\u2033 \u00D7 bf ' + c.sec.bf + '\u2033 \u00B7 tf ' + c.sec.tf + '\u2033 / tw ' + c.sec.tw + '\u2033') + ' \u00B7 ' + (Math.round(c.sec.wtFt * 100) / 100) + ' LB/FT',
      quicks,
      lenT: st.lenT, onLen: setS('lenT'),
      lenEcho: Lok ? (st.lenMode === 'oal' ? 'CL ' + this.fmtFtIn(c.L) + ' \u00B7 LP ' + this.fmtFtIn(c.LP) : this.fmtFtIn(c.L) + '  (' + c.L.toFixed(3) + '\u2033)') : 'CAN\u2019T READ',
      lenEchoStyle: { color: Lok ? '#C6E06F' : '#D2402F', font: '700 10.5px/1.5 JetBrains Mono, monospace' },
      lenHint: st.lenMode === 'oal' ? 'LONG POINT off the tape \u2014 CL solves itself' : (c.kind === 'round' && ((c.A && c.A.mode === 'saddle') || (c.B && c.B.mode === 'saddle')) ? 'saddle end WP = header centerline' : 'work point to work point'),
      mat: st.mat, onMat: setS('mat'), matOpts: D ? D.MATERIALS : [],
      mark: st.mark, onMark: setS('mark'),
      endSteps, groups,
      wantHoles: st.wantHoles,
      holesYes: () => this.setState({ wantHoles: true }), holesNo: () => this.setState({ wantHoles: false }),
      holesYesS: pill(st.wantHoles), holesNoS: pill(!st.wantHoles),
      addGroup: () => this.setState(s => ({ gid: s.gid + 1, groups: s.groups.concat([Component.defGroup(s.gid, s.family)]) })),
      onBand: (e) => {
        if (this._dragMoved) { this._dragMoved = false; this._drag = null; return; } // a drag just ended — not a click
        this._drag = null;
        const bp = this.bandXY(e);
        if (bp) this.bandPlace(bp.c, bp.px, bp.py);
      },
      onBandDown: (e) => { const bp = this.bandXY(e); if (bp) this.bandDown(bp.c, bp.px, bp.py); },
      onBandMove: (e) => { const bp = this.bandXY(e); if (bp) this.bandMove(bp.c, bp.px, bp.py, e.buttons); },
      onBandLeave: () => { this._drag = null; if (st.hovL) this.setState({ hovL: '', hovGx: 0, hovGy: 0 }); },
      hovOn: !!st.hovL,
      hovP: st.hovL ? (() => {
        const r0 = .41;
        let dd = 'M' + this.circPts(st.hovGx, st.hovGy, r0, 24, false).map(q => q[0].toFixed(3) + ' ' + q[1].toFixed(3)).join('L') + 'Z';
        dd += 'M' + (st.hovGx - r0 * 2) + ' ' + st.hovGy + 'H' + (st.hovGx + r0 * 2);
        dd += 'M' + st.hovGx + ' ' + (st.hovGy - r0 * 2) + 'V' + (st.hovGy + r0 * 2);
        return dd;
      })() : '',
      recipes: (() => {
        const Lr = (!c.invalid && c.L > 0) ? c.L : 120;
        const addR = (ps) => () => this.setState(s => {
          let gi = s.gid;
          const gs = ps.map(p => Object.assign(Component.defGroup(gi++, s.family), p));
          return { wantHoles: true, step: 4, gid: gi, groups: (s.wantHoles ? s.groups : []).concat(gs) };
        });
        const spreadR = (p, m) => { const n = Math.max(1, Math.floor((Lr - 2 * m) / p) + 1); return { nT: String(n), pT: this.fmtTok(p), x0T: this.fmtTok((Lr - p * (n - 1)) / 2), xsT: '' }; };
        const midR = { nT: '1', x0T: this.fmtTok(Lr / 2), xsT: '' };
        const brFor = (want) => { if (st.family !== 'pipe') return want; const hi = npsOpts.indexOf(st.pnps); let i2 = npsOpts.indexOf(want); if (hi > 0 && (i2 < 0 || i2 >= hi)) i2 = hi - 1; return i2 >= 0 ? npsOpts[i2] : npsOpts[0]; };
        const dSec = (c.sec && c.sec.d) || 12;
        const gStd = (face) => { const v = this.stdGauge({ face }); return v != null ? this.fmtTok(v) : null; };
        if (isRoundFam) return [
          { l: 'Outlets @ 12:00 — every 12″', tip: 'Manifold header: branch bores spread down the top, centered on the cut length. Change size, spacing or count on the group after.', go: addR([Object.assign({ type: 'olet', bnps: brFor('2'), azT: '0', aznT: '1' }, spreadR(12, 6))]) },
          { l: 'Drain @ 5:00', tip: 'One bore low, 3″ off end B, for a drain coupling. 6:00 dead-bottom is the program seam so it sits at 5:00 — roll at fit-up.', go: addR([{ type: 'olet', bnps: brFor('1'), refEnd: 'B', x0T: '3', nT: '1', xsT: '', azT: '150', aznT: '1' }]) },
          { l: 'Vent @ 12:00', tip: 'One bore on top, 3″ off end A, for a vent coupling.', go: addR([{ type: 'olet', bnps: brFor('1'), refEnd: 'A', x0T: '3', nT: '1', xsT: '', azT: '0', aznT: '1' }]) },
          { l: 'Gauge ports @ 3:00 + 9:00', tip: 'Instrument taps both sides at mid-length.', go: addR([Object.assign({ type: 'olet', bnps: brFor('1'), azT: '90', aznT: '2', azpT: '180' }, midR)]) },
          { l: 'Sparger — Ø3/8 down both sides', tip: 'Distribution holes every 4″ at 4:30 + 7:30 (clear of the 6:00 seam), centered on length.', go: addR([Object.assign({ type: 'cust', diaT: '3/8', azT: '135', aznT: '2', azpT: '90' }, spreadR(4, 3))]) },
          { l: 'Ring of 4', tip: '4 holes around the pipe at mid-length, clocked 45° off top so none land on the seam.', go: addR([Object.assign({ azT: '45', aznT: '4', azpT: '90' }, midR)]) }];
        if (st.family === 'hss') return [
          { l: 'Thru-bolts @ each end', tip: 'Ø9/16 (1/2″ bolt) through the TOP face, 1 1/2″ off each end. Tap COPY → OPP FACE on a group to bolt clean through.', go: addR([{ face: 'T', type: 'cust', diaT: '9/16', refEnd: 'A', x0T: '1 1/2', nT: '1', xsT: '' }, { face: 'T', type: 'cust', diaT: '9/16', refEnd: 'B', x0T: '1 1/2', nT: '1', xsT: '' }]) },
          { l: 'Weeps @ ends — bottom', tip: 'Ø3/8 drain weeps on the BOTTOM face, 1″ off each end — galvanized or outdoor posts.', go: addR([{ face: 'B', type: 'cust', diaT: '3/8', refEnd: 'A', x0T: '1', nT: '1', xsT: '' }, { face: 'B', type: 'cust', diaT: '3/8', refEnd: 'B', x0T: '1', nT: '1', xsT: '' }]) },
          { l: 'Tab slots @ each end', tip: '9/16 × 1 1/2″ slots along the length, 2″ off each end — connection tabs slide in.', go: addR([{ face: 'T', type: 'slot', diaT: '9/16', sllT: '1 1/2', ax: 'x', refEnd: 'A', x0T: '2', nT: '1', xsT: '' }, { face: 'T', type: 'slot', diaT: '9/16', sllT: '1 1/2', ax: 'x', refEnd: 'B', x0T: '2', nT: '1', xsT: '' }]) },
          { l: 'Every 12″ centered', tip: 'Ø9/16 down the top face every 12″, centered on length.', go: addR([Object.assign({ face: 'T', type: 'cust', diaT: '9/16' }, spreadR(12, 6))]) }];
        if (st.family === 'beam') { const y0c = this.fmtTok((dSec - 3) / 2); return [
          { l: '4-bolt — web (2×2)', tip: '2×2 bolt group through the web, auto-centered across the depth. Slide it along the beam with FIRST HOLE; PITCH = bolt-to-bolt along, ROW SPACING = bolt-to-bolt across. 3/4″ bolts.', go: addR([{ face: 'web', bolt: '3/4', type: 'std', refEnd: 'A', x0T: '3', pT: '3', nT: '2', xsT: '', wref: 'tos', nyT: '2', pyT: '3', y0T: y0c }]) },
          { l: '4-bolt — flange (2×2)', tip: '2×2 on the top flange: two lines at the gauge (centered across the flange), two bolts along at PITCH. Slide with FIRST HOLE; change GAUGE for across-spacing. 3/4″ bolts.', go: addR([{ face: 'tf', bolt: '3/4', type: 'std', amode: 'gauge', gT: gStd('tf') || '5 1/2', refEnd: 'A', x0T: '3', pT: '3', nT: '2', xsT: '' }]) },
          { l: 'End clips — web', tip: 'Double-angle connection: one bolt line 2 1/4″ in from each end, 2 rows @ 3″ centered on the web. 3/4″ bolts, STD holes.', go: addR([{ face: 'web', bolt: '3/4', type: 'std', refEnd: 'A', x0T: '2 1/4', nT: '1', xsT: '', wref: 'tos', nyT: '2', pyT: '3', y0T: y0c }, { face: 'web', bolt: '3/4', type: 'std', refEnd: 'B', x0T: '2 1/4', nT: '1', xsT: '', wref: 'tos', nyT: '2', pyT: '3', y0T: y0c }]) },
          { l: 'Top flange @ std gauge — every 12″', tip: 'Two hole lines at the AISC workable gauge, holes every 12″ centered — grating, decking, cap plates.', go: addR([Object.assign({ face: 'tf', bolt: '3/4', type: 'std', amode: 'gauge', gT: gStd('tf') || '5 1/2' }, spreadR(12, 6))]) },
          { l: 'Web CL — 1 @ each end', tip: 'Single hole on the web centerline 3″ off each end — hanging / erection holes.', go: addR([{ face: 'web', refEnd: 'A', x0T: '3', nT: '1', xsT: '', wref: 'tos', nyT: '1', y0T: this.fmtTok(dSec / 2) }, { face: 'web', refEnd: 'B', x0T: '3', nT: '1', xsT: '', wref: 'tos', nyT: '1', y0T: this.fmtTok(dSec / 2) }]) }]; }
        if (st.family === 'chan') { const ny2 = dSec >= 8 ? 2 : 1, y02 = this.fmtTok((dSec - (ny2 - 1) * 3) / 2); return [
          { l: 'End clips — web', tip: 'Connection bolts through the web: one line 2 1/4″ in from each end, ' + (ny2 === 2 ? '2 rows @ 3″ centered on depth' : '1 row on the centerline') + '. 3/4″ bolts.', go: addR([{ face: 'web', bolt: '3/4', type: 'std', refEnd: 'A', x0T: '2 1/4', nT: '1', xsT: '', wref: 'tos', nyT: String(ny2), pyT: '3', y0T: y02 }, { face: 'web', bolt: '3/4', type: 'std', refEnd: 'B', x0T: '2 1/4', nT: '1', xsT: '', wref: 'tos', nyT: String(ny2), pyT: '3', y0T: y02 }]) },
          { l: 'Web CL — every 12″', tip: 'Strut-style: one row on the web centerline every 12″, centered — unistrut, rails, curbs. 1/2″ bolts.', go: addR([Object.assign({ face: 'web', bolt: '1/2', type: 'std', wref: 'tos', nyT: '1', y0T: this.fmtTok(dSec / 2) }, spreadR(12, 6))]) },
          { l: 'Flange @ std gauge — every 12″', tip: 'Hole line on the top flange at the workable gauge from the back, every 12″ centered.', go: addR([Object.assign({ face: 'tf', bolt: '1/2', type: 'std', amode: 'gauge', gT: gStd('tf') || '1 1/2' }, spreadR(12, 6))]) }]; }
        const ga = gStd('vleg') || '1 3/4';
        return [
          { l: 'Gauge line — every 12″', tip: 'Holes on the standard gauge from the heel, every 12″ centered — ledger / shelf angles.', go: addR([Object.assign({ face: 'vleg', bolt: '3/4', type: 'std', gT: ga }, spreadR(12, 6))]) },
          { l: 'Clip — 2 bolts @ 3″', tip: 'Standard clip: 2 bolts at 3″ pitch, first 1 3/4″ from end A, on the heel gauge.', go: addR([{ face: 'vleg', bolt: '3/4', type: 'std', x0T: '1 3/4', pT: '3', nT: '2', xsT: '', gT: ga }]) },
          { l: '1 @ each end', tip: 'Single hole on the gauge line 1 1/2″ off each end.', go: addR([{ face: 'vleg', bolt: '3/4', type: 'std', refEnd: 'A', x0T: '1 1/2', nT: '1', xsT: '', gT: ga }, { face: 'vleg', bolt: '3/4', type: 'std', refEnd: 'B', x0T: '1 1/2', nT: '1', xsT: '', gT: ga }]) }];
      })(),
      hasIssues: c.warns.length > 0,
      issues: c.warns.map(w => ({ t: w.t, dot: { color: w.lvl === 'err' ? '#D2402F' : '#E8631A', font: '700 10px/1 monospace' } })),
      invalid: c.invalid,
      job: st.job, heat: st.heat, qty: st.qty, onJob: setS('job'), onHeat: setS('heat'),
      onQty: (e) => this.setState({ qty: Math.max(1, Math.round(+e.target.value || 1)) }),
      specShape: this.famLabel() + ' \u00B7 ' + c.sec.label,
      specCL: Lok ? this.fmtFtIn(c.L) : '\u2014',
      specLP: c.invalid ? '\u2014' : this.fmtFtIn(c.LP),
      specSP: c.invalid ? '\u2014' : this.fmtFtIn(c.SP),
      specHoles: Object.entries(byDia).map(([k, v]) => v + '\u00D7 ' + k).join(' \u00B7 ') || 'NONE',
      specWt: c.invalid ? '\u2014' : c.wt.toFixed(0) + ' LB \u00D7 ' + st.qty,
      addToJob: () => this.addToJob(),
      addSub: c.invalid ? 'fix issues first' : (() => {
        let prev = '';
        if (Lok) {
          const gk = this.famLabel() + '|' + c.sec.label + '|' + this.matRec().id;
          const nowG = nests.find(n2 => n2.key === gk);
          const afterG = this.nestGroups(st.parts.concat([{ groupKey: gk, groupLabel: '', cat: this.matRec().cat, qty: st.qty, oal: c.OAL || c.L, wt: c.wt }])).find(n2 => n2.key === gk);
          if (afterG) prev = ' \u00B7 STICKS ' + (nowG ? nowG.sticks : 0) + '\u2192' + afterG.sticks;
        }
        return '\u00D7' + st.qty + ' \u00B7 ' + Math.round(c.wt * st.qty) + ' LB \u00B7 gets a recall code' + prev;
      })(),
      canStep: true,
      stepSub: c.kind === 'plate' || c.kind === 'angl' ? 'inches embedded · plate solids — COMBINE in CAD · faceted' : 'inches embedded · one faceted solid · wall openings modeled — square radial cut',
      dxfSub: (st.dxfRef ? 'CUT + REF + LABELS \u2014 for checking in CAD' : 'CUT GEOMETRY ONLY \u2014 safe for CAM that cuts every line') + (c.kind === 'round' || c.kind === 'box' ? ' \u00B7 seam along the bottom' : ' \u00B7 face bands'),
      dxfRefOn: () => this.setState({ dxfRef: true }),
      dxfRefOff: () => this.setState({ dxfRef: false }),
      dxfRefOnS: { padding: '4px 7px', cursor: 'pointer', borderRadius: 3, border: '1px solid ' + (st.dxfRef ? '#A6CE39' : '#434C57'), background: st.dxfRef ? 'rgba(166,206,57,.15)' : 'transparent', color: st.dxfRef ? '#C6E06F' : '#7E8893', font: '700 8.5px/1 Saira, sans-serif', letterSpacing: '.06em' },
      dxfRefOffS: { padding: '4px 7px', cursor: 'pointer', borderRadius: 3, border: '1px solid ' + (!st.dxfRef ? '#A6CE39' : '#434C57'), background: !st.dxfRef ? 'rgba(166,206,57,.15)' : 'transparent', color: !st.dxfRef ? '#C6E06F' : '#7E8893', font: '700 8.5px/1 Saira, sans-serif', letterSpacing: '.06em' },
      dlStep: () => { const t = this._stepText(); if (t) this._download(t, this.fileBase() + '.step', 'application/step'); },
      dlObj: () => { const t = this._objText(); if (t) this._download(t, this.fileBase() + '.obj', 'model/obj'); },
      dlDxf: () => { const t = this._dxfText(); if (t) this._download(t, this.fileBase() + '.dxf', 'application/dxf'); },
      dlCsv: () => { const t = this._csvText(); if (t) this._download(t, this.fileBase() + '_holes.csv', 'text/csv'); },
      dlTicket: () => this._openTicket(this._ticketHtml(), this.fileBase() + '_ticket.html'),
      hdrA: !!hhA, hdrB: !!hhB,
      dlHdrA: () => { const t = this._headerHoleDxf('A'); if (t) this._download(t, this.fileBase() + '_HDR-HOLE-A.dxf', 'application/dxf'); },
      dlHdrB: () => { const t = this._headerHoleDxf('B'); if (t) this._download(t, this.fileBase() + '_HDR-HOLE-B.dxf', 'application/dxf'); },
      fileBase: this.fileBase(), stageRef: this.stageRef,
      hasSaddle: c.kind === 'round' && ((c.A && c.A.mode === 'saddle') || (c.B && c.B.mode === 'saddle')),
      onGhost: () => this.setState(s => ({ ghost: !s.ghost })),
      ghostLbl: 'HEADER GHOST: ' + (st.ghost ? 'ON' : 'OFF'),
      ghostBtnS: this.hudBtn(st.ghost),
      onFit: () => { this._framed = false; this._bk = null; this._build3D(); },
      fitBtnS: this.hudBtn(false),
      onSpin: () => this.setState(s => ({ spin: !s.spin })),
      spinLbl: 'SPIN: ' + (st.spin ? 'ON' : 'OFF'),
      spinBtnS: this.hudBtn(st.spin),
      bandTitle: c.kind === 'round' || c.kind === 'box' ? 'What the laser cuts — the tube unrolled flat' : 'What the laser cuts — each plate face, true scale',
      bandLegend: st.hovL ? st.hovL : (c.kind === 'round' || c.kind === 'box' ? 'WRAP ' + (c.wrap ? c.wrap.toFixed(3) + '\u2033' : '\u2014') + ' \u00B7 SEAM = BOTTOM OF PART \u00B7 GRID 12\u2033' : 'GRID 12\u2033 \u00B7 \u2014 CUT \u00B7 - - WP') + ' \u00B7 CLICK = HOLE \u00B7 DRAG A HOLE = SLIDE \u00B7 CLICK A HOLE = REMOVE',
      bandLegendS: { font: st.hovL ? '700 10px/1 JetBrains Mono, monospace' : '500 10px/1 JetBrains Mono, monospace', color: st.hovL ? '#C6E06F' : '#79828B', whiteSpace: 'nowrap' },
      vb: p.vb, gridP: p.gridP, refP: p.refP, wpP: p.wpP, outAP: p.outAP, outBP: p.outBP, outCP: p.outCP, holesP: p.holesP,
      bandLbls: p.lbls, sw: p.sw, swThin: p.swThin, dash: p.dash,
      endASpec: c.invalid || !c.A ? '\u2014' : this.endSpecText(c.A, c.sec),
      endBSpec: c.invalid || !c.B ? '\u2014' : this.endSpecText(c.B, c.sec),
      holeChip: nOK ? Object.entries(byDia).map(([k, v]) => v + '\u00D7 ' + k).join('  ') : 'NO HOLES',
      stReady: errN ? errN + ' ISSUE' + (errN > 1 ? 'S' : '') : 'READY',
      stReadyS: { color: errN ? '#D2402F' : '#A6CE39', font: '700 9.5px/1 JetBrains Mono, monospace', letterSpacing: '.08em' },
      stDims: c.invalid ? '\u2014' : 'CL ' + this.fmtFtIn(c.L) + ' \u00B7 LP ' + this.fmtFtIn(c.LP) + ' \u00B7 SP ' + this.fmtFtIn(c.SP),
      stWt: c.invalid ? '' : Math.round(c.wt) + ' LB EA',
      jobOpen: st.jobOpen, jobEmpty: st.parts.length === 0, jobParts, nests: nests.map(n2 => ({
        key: n2.key, label: n2.label,
        chip: n2.sticks + ' STICK' + (n2.sticks > 1 ? 'S' : '') + ' \u00B7 ' + Math.round(n2.util * 100) + '% \u00B7 DROP ' + this.fmtFtIn(n2.drop) + (n2.tooLong ? ' \u00B7 PART > STICK!' : ''),
        chipS: { font: '500 9px/1.4 JetBrains Mono, monospace', color: n2.tooLong ? '#D2402F' : '#7E8893' },
        stick: String(st.stickSel[n2.key] || '288'),
        sStick: (e) => this.setState(s => ({ stickSel: Object.assign({}, s.stickSel, { [n2.key]: e.target.value }) })),
        del: () => { if (!confirm('Erase all ' + n2.pieces + ' pc of ' + n2.label + ' from this job?')) return; this.setState(s => ({ parts: s.parts.filter(p => p.groupKey !== n2.key) })); },
        barS: { height: 4, width: Math.round(n2.util * 100) + '%', background: n2.tooLong ? '#D2402F' : '#A6CE39', borderRadius: 2 }
      })),
      gripT: st.gripT, onGrip: setS('gripT'),
      rateCT: st.rateCT, rateST: st.rateST, rateAT: st.rateAT,
      onRateC: setS('rateCT'), onRateS: setS('rateST'), onRateA: setS('rateAT'),
      roPieces: totPieces + ' PC \u00B7 ' + st.parts.length + ' MARKS', roWt: Math.round(totWt) + ' LB', roSticks: totSticks + ' STICKS',
      roCost: '$' + totCost.toFixed(0),
      dlJobTicket: () => this._openTicket(this._jobTicketHtml(), 'job_ticket.html'),
      dlJobCsv: () => { const t = this._jobCsv(); if (t) this._download(t, 'job_cutlist.csv', 'text/csv'); },
      clearJob: () => { if (confirm('Clear all parts from this job?')) this.setState({ parts: [] }); },
      recallT: st.recallT, onRecall: setS('recallT'),
      recallMsg: st.recallMsg,
      doRecall: () => {
        const cfg = this.decodeCfg(st.recallT);
        if (cfg) this.setState(Object.assign({ step: 5, recallMsg: 'Loaded \u2713', recallT: '' }, cfg));
        else this.setState({ recallMsg: 'Bad code \u2014 paste the whole part code (starts SPFPB)' });
      },
      lenModeWp: () => this.setState({ lenMode: 'wp' }),
      lenModeOal: () => this.setState({ lenMode: 'oal' }),
      lenWpS: { padding: '4px 7px', cursor: 'pointer', borderRadius: 3, border: '1px solid ' + (st.lenMode !== 'oal' ? '#A6CE39' : '#434C57'), background: st.lenMode !== 'oal' ? 'rgba(166,206,57,.15)' : 'transparent', color: st.lenMode !== 'oal' ? '#C6E06F' : '#7E8893', font: '700 8.5px/1 Saira, sans-serif', letterSpacing: '.06em' },
      lenOalS: { padding: '4px 7px', cursor: 'pointer', borderRadius: 3, border: '1px solid ' + (st.lenMode === 'oal' ? '#A6CE39' : '#434C57'), background: st.lenMode === 'oal' ? 'rgba(166,206,57,.15)' : 'transparent', color: st.lenMode === 'oal' ? '#C6E06F' : '#7E8893', font: '700 8.5px/1 Saira, sans-serif', letterSpacing: '.06em' },
      hasParts: st.parts.length > 0,
      sameLast: () => {
        const last = this.state.parts[this.state.parts.length - 1];
        if (!last) return;
        const cfg = this.cfgFromPart(last);
        if (cfg) this.setState(Object.assign({}, cfg, { mark: this.state.mark, step: 1 }));
      },
      hbNps: st.hdrB.nps, hbSch: st.hdrB.sch,
      hbNpsOpts: npsOpts, hbSchedOpts: schedOpts,
      sHbNps: (e) => this.setState(s2 => ({ hdrB: Object.assign({}, s2.hdrB, { nps: e.target.value }) })),
      sHbSch: (e) => this.setState(s2 => ({ hdrB: Object.assign({}, s2.hdrB, { sch: e.target.value }) })),
      hbSeatOn: () => this.setState(s2 => ({ hdrB: Object.assign({}, s2.hdrB, { seat: 'on' }) })),
      hbSeatThru: () => this.setState(s2 => ({ hdrB: Object.assign({}, s2.hdrB, { seat: 'thru' }) })),
      hbSeatOnS: pill(st.hdrB.seat === 'on'), hbSeatThruS: pill(st.hdrB.seat !== 'on'),
      hbHasList: st.hdrB.list.length > 0,
      hbCount: st.hdrB.list.length ? st.hdrB.list.length + ' BRANCH' + (st.hdrB.list.length > 1 ? 'ES' : '') : '',
      hbAdd: () => this.setState(s2 => ({ hdrB: Object.assign({}, s2.hdrB, { hid: s2.hdrB.hid + 1, list: s2.hdrB.list.concat([{ id: s2.hdrB.hid, nps: '2', sch: '40', alphaT: '90', azT: '0', distT: s2.hdrB.list.length ? '' : '12' }]) }) })),
      hbClear: () => { if (confirm('Clear all branches from the header program?')) this.setState(s2 => ({ hdrB: Object.assign({}, s2.hdrB, { list: [] }) })); },
      hbList: st.hdrB.list.map(b => {
        const setHb = (k) => (e) => this.setState(s2 => ({ hdrB: Object.assign({}, s2.hdrB, { list: s2.hdrB.list.map(x => x.id === b.id ? Object.assign({}, x, { [k]: e.target.value }) : x) }) }));
        return { id: b.id, nps: b.nps, sch: b.sch, alphaT: b.alphaT, azT: b.azT, distT: b.distT,
          npsOpts, schedOpts,
          sNps: setHb('nps'), sSch: setHb('sch'), sAlpha: setHb('alphaT'), sAz: setHb('azT'), sDist: setHb('distT'),
          del: () => this.setState(s2 => ({ hdrB: Object.assign({}, s2.hdrB, { list: s2.hdrB.list.filter(x => x.id !== b.id) }) })) };
      }),
      hbWarns: (() => { const hcv = st.hdrB.list.length && D ? this.hdrBranchCurves() : null; return hcv ? hcv.warns : []; })(),
      hbPrevOn: (() => { const hcv = st.hdrB.list.length && D ? this.hdrBranchCurves() : null; return !!(hcv && hcv.curves.length); })(),
      hbPrev: (() => {
        const empty = { vb: '0 0 10 10', holesP: '', refP: '', wpP: '', sw: .05, lbls: [] };
        const hcv = st.hdrB.list.length && D ? this.hdrBranchCurves() : null;
        if (!hcv || !hcv.curves.length) return empty;
        let px0 = 0, px1 = 0;
        for (const cv of hcv.curves) { px0 = Math.min(px0, cv.x0); px1 = Math.max(px1, cv.x1); }
        px0 -= 3; px1 += 3;
        const span = px1 - px0;
        let holesP = '';
        for (const cv of hcv.curves) holesP += 'M' + cv.pts.map(p => p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join('L') + 'Z';
        let refP = '';
        for (const fr of [0, .25, .5, .75, 1]) refP += 'M' + px0.toFixed(1) + ' ' + (hcv.W * fr).toFixed(2) + 'H' + px1.toFixed(1);
        const fs = Math.max(span, hcv.W * 2) / 60;
        return {
          vb: px0.toFixed(1) + ' ' + (-fs * 1.6).toFixed(1) + ' ' + span.toFixed(1) + ' ' + (hcv.W + fs * 3).toFixed(1),
          holesP, refP,
          wpP: 'M0 ' + (-fs * .8).toFixed(1) + 'V' + (hcv.W + fs * .8).toFixed(1),
          sw: span / 400,
          lbls: hcv.curves.map(cv => ({ x: (cv.x0 + cv.x1) / 2 - fs * .6, y: -fs * .4, t: 'B' + cv.b.id, s: { font: '500 ' + fs.toFixed(2) + 'px JetBrains Mono, monospace', fill: '#A6CE39' } }))
        };
      })(),
      hbDxf: () => {
        const hcv = this.hdrBranchCurves();
        if (!hcv) return;
        const seam = hcv.warns.filter(w2 => w2.includes('seam'));
        if (seam.length) { alert('FIX BEFORE CUTTING \u2014 no program written:\n\n' + seam.join('\n') + '\n\nSpin those branch clock positions off 180\u00B0.'); return; }
        if (hcv.warns.length && !confirm('CHECK BEFORE CUTTING:\n\n' + hcv.warns.join('\n') + '\n\nGenerate the header DXF anyway?')) return;
        const t = this._hdrProgramDxf();
        if (t) this._download(t, ('HEADER_' + st.hdrB.nps + 'in_' + this.schedLabel(st.hdrB.sch) + (st.job ? '_' + st.job : '')).replace(/[^\w.-]+/g, '-') + '.dxf', 'application/dxf');
      },
      newJob: () => {
        const sN = this.state;
        const msg = sN.parts.length
          ? 'Start a NEW JOB?\n\nCurrent job (' + (sN.job || 'no job #') + ' \u00B7 ' + sN.parts.length + ' mark' + (sN.parts.length > 1 ? 's' : '') + ') files under PAST JOBS first, then everything resets.'
          : 'Start a NEW JOB? The form resets to a fresh part.';
        if (!confirm(msg)) return;
        this.setState(s2 => {
          const archive = s2.parts.length ? [this._mkArch(s2)].concat(s2.archive).slice(0, 200) : s2.archive;
          this._saveArchive(archive);
          return Object.assign(Component.freshPart(), { archive, parts: [], job: '', stickSel: {}, jobOpen: true, recallT: '', recallMsg: '', archQ: '', hdrB: { nps: '10', sch: '40', seat: 'on', hid: 1, list: [] }, archMsg: s2.parts.length ? 'Filed ' + (s2.job || 'job') + ' to PAST JOBS \u2713' : 'Fresh job \u2713' });
        });
      },
      archCount: st.archive.length ? st.archive.length + ' SAVED' : 'NONE YET',
      hasArch: st.archive.length > 0,
      archQ: st.archQ, onArchQ: setS('archQ'),
      archMsg: st.archMsg,
      archList: st.archive.filter(a => {
        const q = st.archQ.trim().toLowerCase();
        if (!q) return true;
        return ((a.job || '') + ' ' + a.parts.map(p => p.mark + ' ' + p.desc).join(' ')).toLowerCase().includes(q);
      }).slice(0, 20).map(a => ({
        id: a.id,
        job: a.job || '(NO JOB #)',
        date: new Date(a.savedAt).toLocaleDateString(),
        sum: a.parts.reduce((s2, p) => s2 + p.qty, 0) + ' PC \u00B7 ' + a.parts.map(p => p.mark).slice(0, 4).join(' ') + (a.parts.length > 4 ? '\u2026' : '') + ' \u00B7 ' + Math.round(a.parts.reduce((s2, p) => s2 + p.wt * p.qty, 0)) + ' LB',
        open: () => {
          if (!confirm('Open saved job ' + (a.job || '(no #)') + '?' + (this.state.parts.length ? '\nThe current job files to PAST JOBS first.' : ''))) return;
          this.setState(s2 => {
            let archive = s2.archive.filter(x => x.id !== a.id);
            if (s2.parts.length) archive = [this._mkArch(s2)].concat(archive);
            this._saveArchive(archive);
            return { archive, parts: JSON.parse(JSON.stringify(a.parts)), job: a.job || '', gripT: a.gripT || s2.gripT, stickSel: a.stickSel || {}, hdrB: (a.hdrB && Array.isArray(a.hdrB.list)) ? a.hdrB : s2.hdrB, jobOpen: true, archMsg: 'Reopened ' + (a.job || 'job') + ' \u2713' };
          });
        },
        del: () => {
          if (!confirm('Delete saved job ' + (a.job || '(no #)') + ' permanently? Its printed QR codes will still work.')) return;
          this.setState(s2 => { const archive = s2.archive.filter(x => x.id !== a.id); this._saveArchive(archive); return { archive }; });
        }
      })),
      dlBackup: () => {
        const s2 = this.state;
        const data = { app: 'SPF-PartBuilder', v: 1, saved: new Date().toISOString(), current: { job: s2.job, parts: s2.parts, gripT: s2.gripT, stickSel: s2.stickSel, rateCT: s2.rateCT, rateST: s2.rateST, rateAT: s2.rateAT }, archive: s2.archive };
        this._download(JSON.stringify(data, null, 1), 'steampunk_partbuilder_backup_' + new Date().toISOString().slice(0, 10) + '.json', 'application/json');
        this.setState({ archMsg: 'Backup saved \u2014 keep it in iCloud / Drive \u2713' });
      },
      doRestore: () => {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = '.json,application/json';
        inp.onchange = () => {
          const fl = inp.files && inp.files[0];
          if (!fl) return;
          const fr = new FileReader();
          fr.onload = () => {
            try {
              const j = JSON.parse(fr.result);
              if (!j || j.app !== 'SPF-PartBuilder' || !Array.isArray(j.archive)) throw new Error('bad');
              this.setState(s2 => {
                const have = new Set(s2.archive.map(x => x.id));
                const incoming = j.archive.filter(x => x && Array.isArray(x.parts) && !have.has(x.id));
                const cur = (j.current && Array.isArray(j.current.parts) && j.current.parts.length) ? [{ id: 'bk-' + (Date.parse(j.saved) || 0), job: j.current.job || '', savedAt: Date.parse(j.saved) || Date.now(), parts: j.current.parts, gripT: j.current.gripT, stickSel: j.current.stickSel }].filter(x => !have.has(x.id)) : [];
                const archive = cur.concat(incoming, s2.archive).slice(0, 200);
                this._saveArchive(archive);
                return { archive, archMsg: 'Restored ' + (incoming.length + cur.length) + ' job(s) from backup \u2713' };
              });
            } catch (e2) { alert('That file isn\u2019t a Part Builder backup.'); }
          };
          fr.readAsText(fl);
        };
        inp.click();
      },
      fsSupported: this._fsSupported(),
      fsNo: !this._fsSupported(),
      fsIdle: this._fsSupported() && !st.fsName,
      fsOk: !!st.fsName && st.fsPerm === 'granted',
      fsAsk: !!st.fsName && st.fsPerm !== 'granted',
      fsName: st.fsName,
      linkFolder: () => this._fsLink(),
      reconnectFolder: () => this._fsReconnect(),
      unlinkFolder: () => { if (confirm('Unlink "' + st.fsName + '"? Files already copied there stay put.')) this._fsUnlink(); }
    };
  }

  hudBtn(on) { return { cursor: 'pointer', borderRadius: 4, border: '1px solid ' + (on ? '#A6CE39' : '#434C57'), background: 'rgba(10,11,13,.72)', color: on ? '#C6E06F' : '#7E8893', font: '700 10.5px/1 JetBrains Mono, monospace', letterSpacing: '.08em', padding: '8px 10px' }; }
  newCode() { return 'SPF-' + Math.random().toString(36).slice(2, 6).toUpperCase(); }
  addToJob() {
    const c = this.calc(), st = this.state;
    if (c.invalid) return;
    const cfg = this.snapshot();
    const part = {
      id: Date.now() + Math.random(), code: this.newCode(), mark: st.mark || '-',
      desc: this.famLabel() + ' \u00B7 ' + c.sec.label + ' \u00B7 ' + this.matRec().label,
      lenT2: this.fmtFtIn(c.L) + (c.LP > 0 && Math.abs(c.LP - c.L) > 1 / 64 ? ' \u00B7 LP ' + this.fmtFtIn(c.LP) : ''), oal: c.OAL || c.L, wt: c.wt, qty: st.qty, cat: this.matRec().cat,
      groupKey: this.famLabel() + '|' + c.sec.label + '|' + this.matRec().id,
      groupLabel: c.sec.label + ' \u00B7 ' + this.matRec().id,
      payload: this.encodeCfg(cfg)
    };
    const bump = /^(.*?)(\d+)$/.exec(st.mark || '');
    const nextMark = bump ? bump[1] + (parseInt(bump[2], 10) + 1) : st.mark;
    this.setState(s => ({ parts: s.parts.concat([part]), jobOpen: true, mark: nextMark }));
  }
  _jobCsv() {
    const st = this.state;
    if (!st.parts.length) return null;
    // ASCII only (same rule as DXF/CSV); inch marks inside quoted fields are doubled.
    const q = (v) => '"' + this.ascii(String(v)).replace(/"/g, '""') + '"';
    let s = 'code,mark,qty,description,cut_len,oal_in,wt_ea_lb,wt_total_lb\n';
    for (const p of st.parts) s += [q(p.code), q(p.mark), p.qty, q(p.desc), q(p.lenT2), p.oal.toFixed(3), p.wt.toFixed(1), (p.wt * p.qty).toFixed(1)].join(',') + '\n';
    return s;
  }
  _openTicket(html, fallbackName) {
    if (!html) return;
    this._fsWrite(fallbackName, html).then(okW => { if (okW) this.setState({ archMsg: fallbackName + ' → copied to "' + this.state.fsName + '" ✓' }); });
    let win = null;
    try { win = window.open('', '_blank'); } catch (e) {}
    if (win && win.document) { win.document.write(html); win.document.close(); try { win.focus(); } catch (e) {} }
    else this._download(html, fallbackName, 'text/html');
  }
}
