// Shared loader for headless checks: builds the Component class from app.js
// with the same browser stubs the main harness uses.
import { readFileSync } from 'node:fs';
import * as PROFILE_DB from '../profile-db.js';
const src0 = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const src = src0.replace("import('./profile-db.js')", 'Promise.resolve(globalThis.__PB_PROFILE_DB)');
globalThis.__PB_PROFILE_DB = PROFILE_DB;
class DCLogic {
  constructor(props) { this.props = props || {}; this.state = {}; }
  setState(u, cb) { const p = typeof u === 'function' ? u(this.state) : u; this.state = { ...this.state, ...p }; if (cb) cb(); }
  forceUpdate() {} componentDidMount() {} componentDidUpdate() {} componentWillUnmount() {} renderVals() { return {}; }
}
const make = new Function('DCLogic', 'React', 'localStorage', 'fetch', 'location', 'alert', 'confirm', 'document', 'window', 'qrcode', 'indexedDB', '"use strict";\n' + src + '\n;return Component;');
export const Component = make(DCLogic, { createRef: () => ({ current: null }) }, { getItem: () => null, setItem() {}, removeItem() {} }, () => Promise.reject(new Error('offline')), { href: 'http://localhost/' }, () => {}, () => true, undefined, undefined, undefined, undefined);
export const DB = PROFILE_DB;
export async function fresh(patch) {
  const c = new Component({ stations: '192', holeSegs: '28', edgeGlow: true });
  await new Promise(r => setTimeout(r, 0));
  c.setState({ lenMode: 'wp' });   // these suites give work-point lengths; freshApp() is the form as the app opens it
  if (patch) c.setState(patch);
  return c;
}
/** The part form exactly as the app opens it: overall (end-to-end) lengths. */
export async function freshApp(patch) {
  const c = new Component({ stations: '192', holeSegs: '28', edgeGlow: true });
  await new Promise(r => setTimeout(r, 0));
  if (patch) c.setState(patch);
  return c;
}
export const endOf = (c, id, p) => Object.assign({}, c.state.ends[id], p);
