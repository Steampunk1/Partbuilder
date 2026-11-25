// The two-descriptions check lives in ../iges-check.js (the app runs it on every laser file); this is the file-reading wrapper for tests.
import { readFileSync } from 'node:fs';
import { bVsCText } from '../iges-check.js';
export { bVsCText };
export function bVsC(file, n = 200) { return bVsCText(readFileSync(file, 'utf8'), n); }
