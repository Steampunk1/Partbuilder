// Loads the vendored OpenCascade engine (vendor/occ) in Node for headless checks.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../vendor/occ');
let _oc = null;
/** fresh = true gives a brand-new engine instance (use after the engine has aborted). */
export async function loadOcc(fresh) {
  if (_oc && !fresh) return _oc;
  const src = readFileSync(path.join(dir, 'opencascade.wasm.js'), 'utf8').replace(/export default opencascade;\s*$/, 'return opencascade;');
  const factory = new Function('require', '__filename', '__dirname', 'process', src)(createRequire(import.meta.url), path.join(dir, 'opencascade.wasm.js'), dir, process);
  _oc = await factory({ wasmBinary: readFileSync(path.join(dir, 'opencascade.wasm.wasm')), locateFile: (p) => path.join(dir, p), print() {}, printErr() {} });
  return _oc;
}
