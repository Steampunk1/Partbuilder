// Data for test/bt-inputs.mjs — the input / human-error audit.
//
//   PARSER   how fabricators write a length, and what they mean by it
//   FIELDS   every typed or selected input that reaches the cut geometry, with a good value, the bad
//            values a person really types, where the code reads it, and the rule that should apply
//   randomCfg  seeded generator of valid parts (all families) for the round-trip checks
//
// Nothing here changes the app; it only drives the form state the way the form does.
import { Component, DB } from './_load.mjs';

// ------------------------------------------------------------------ parser truth table
// [typed text, what a fabricator means in inches (null = it means nothing: must be refused), note]
export const PARSER = [
  // --- read correctly today
  ["10'-6", 126], ["10' 6\"", 126], ["10'6", 126], ["10' - 6", 126], ["126", 126], ["126\"", 126], ["10'6-1/2", 126.5], ["10'-6 1/2\"", 126.5],
  ["10.5'", 126, 'decimal feet'], ["1/2", .5], [".5", .5], ["0.5", .5], ["1-1/2", 1.5], ["1 1/2", 1.5], ["10' 6 3/8", 126.375], ["6 3/8\"", 6.375],
  ["12'-6 3/8", 150.375], ["12' 6-3/8\"", 150.375], ["12'", 144], ["12'-0\"", 144], ["0'-6", 6], ["6.375", 6.375], ["6-3/8", 6.375], ["11/16", .6875],
  ["13/16", .8125], ["1 1/16", 1.0625], ["10'-11 15/16", 131.9375], ["10'-6.5", 126.5], ["10′-6″", 126, 'true prime marks'], ["126 3/8", 126.375],
  ["2' 6 1/2", 30.5], ["01'-06", 18], ["22-1/2", 22.5],
  // --- WRONG NUMBER, NO ERROR (worst): every one of these is accepted today
  ["1 0'", 120, "slipped space in 10' - read as 1 ft"],
  ["10 1/2'", 126, 'feet with a fraction - the fraction is dropped'],
  ["5 1/2'", 66, 'feet with a fraction - the fraction is dropped'],
  ["3/4'", 9, 'fraction of a foot - read as 3 ft'],
  ["10-6'", null, "feet mark at the end - read as 10 ft, the 6 is dropped"],
  ["10 6'", null, "feet mark at the end - read as 10 ft, the 6 is dropped"],
  ["1e2'", null, 'exponent - read as 100 ft'],
  ["6\"1/2", 6.5, 'inch mark before the fraction - read as 61/2 = 30 1/2'],
  ["10'-6\"1/2", 126.5, 'inch mark before the fraction - read as 10 ft + 61/2'],
  ["5'6\"1/2", 66.5, 'inch mark before the fraction - read as 5 ft + 61/2'],
  ["10\"6", null, 'inch mark in the middle - read as 106'],
  ["63/8", 6.375, 'missing space in 6 3/8 - read as sixty-three eighths'],
  ["11/2", 1.5, 'missing space in 1 1/2 - read as eleven halves'],
  ["113/16", 1.8125, 'missing space in 1 13/16 - read as 113 sixteenths'],
  ["10'-13", null, 'inches past 12 after feet'],
  ["10'-6 16/16", null, 'fraction that is a whole inch'],
  ["10'-6 17/16", null, 'fraction bigger than an inch'],
  ["10'-6 3/7", null, 'not a tape fraction'],
  // --- refused today, and rightly (ambiguous or not a length)
  ["10-6", null, 'ambiguous: 10 ft 6 or 10 minus 6'], ["10 6", null, 'ambiguous'], ["1 6", null, 'ambiguous'], ["1.1/2", null], ["1,5", null], ["3/8-", null],
  ["10''", null, "ambiguous: two feet marks or an inch mark"], ["3m", null], ["300mm", null], ["abc", null], ["", null], ["1e3", null], ["6 3/0", null], ["1/0", null],
  ["10'-6'", null], ["--6", null], ["6-", null], ["1.2.3", null], ["1/2/3", null], ["10x12", null], ["=10*12", null], ["2 6 1/2", null, 'ambiguous'],
];
// Notations a fabricator commonly types that are refused today. Safe (the length box turns red) but
// annoying - and in every OTHER box a refused value silently becomes the default (see FIELDS).
export const PARSER_REJECTED_COMMON = [
  ["10ft 6in", 126], ["10 ft", 120], ["10 FT 6 IN", 126], ["120 in", 120], ["10'-6 3/8 in", 126.375],
  ["10’-6”", 126, 'curly quotes from a phone, tablet or pasted from Word'], ["10’ 6”", 126, 'curly quotes'], ["3/4”", .75, 'curly inch mark'],
  ["6  3/8", 6.375, 'two spaces'], ["6 3 / 8", 6.375, 'spaces round the slash'], ["3 / 4", .75], ["6.", 6, 'trailing dot'], ["120.", 120, 'trailing dot'],
  ["1½", 1.5, 'one-key fraction'], ["6 ½", 6.5, 'one-key fraction'], ["¾", .75, 'one-key fraction'], ["+6", 6],
  ["10'–6", 126, 'en dash (autocorrect)'], ["6–3/8", 6.375, 'en dash (autocorrect)'], ["10'-6 3/8", 126.375, 'non-breaking space (pasted)'], ["1,000", 1000],
  ["45°", 45, 'degree sign'], ["45 deg", 45],
];

// ------------------------------------------------------------------ field cases
const setEnd = (c, id, p) => c.setState((s) => ({ ends: { ...s.ends, [id]: { ...s.ends[id], ...p } } }));
const setG = (c, p) => c.setState((s) => ({ groups: s.groups.map((g, k) => (k === 0 ? { ...g, ...p } : g)) }));
const holesOn = (c, p) => { c.setState({ wantHoles: true }); setG(c, Object.assign({ both: false, xsT: '' }, p)); };
const xs = (r) => r.holes.map((h) => +h.x.toFixed(4)).join(',');
const num = (v) => (typeof v === 'number' ? +v.toFixed(6) : v);
const deg = (rad) => +(rad * 180 / Math.PI).toFixed(4);
export { setEnd, setG };

// Each case: prep(c) puts a fresh form of `fam` into a valid state, set(c, v) types v into the field,
// see(r, c) is the value the cut really uses. bad = [typed, why a person types it, (intended number)].
// A bad value passes when the export is blocked - or, where a number was clearly meant, when it is read as that number.
export const FIELDS = [
  // ---------------- length
  { id: 'len', key: 'lenT', label: 'Cut length', ui: 'text', fam: 'pipe', where: 'app.js:329-333 (parseIn 89-106)', risk: 'high',
    bites: "10'-6 typed without the foot mark (106) cuts a 8'-10 piece; a slipped zero cuts 100 ft of nothing - any positive number is accepted",
    rule: "Accept ft-in and inches (12'-6 3/8, 150 3/8, 150.375). Block empty, 0, negative, under 1 in, or longer than the longest stick (576 in). Message: \"Cut length 99999 in is longer than a 48 ft stick - check the length.\"",
    prep: () => {}, set: (c, v) => c.setState({ lenT: v }), good: "10'-0", see: (r) => num(r.L),
    bad: [['', 'box left empty'], ['abc', 'letters'], ['0', 'zero'], ['-5', 'negative'], ['99999', 'slipped digits - 8333 ft'], ['0.0001', 'stray decimal'], ['.01', 'stray decimal'], ["10'-13", 'inches past 12'], ["63/8", 'missing space', 6.375]] },

  // ---------------- section
  { id: 'tube-od', key: 'todT', label: 'Round tube OD (no control on the form in this build - arrives by recall code or old job)', ui: 'none', fam: 'tube', where: 'app.js:241', risk: 'medium',
    bites: 'an old job part whose OD will not read becomes 2 in tube and is cut as such',
    rule: 'Block unless 0.25 in to 24 in. Never substitute 2 in. Message: "Tube OD won\'t read - type 2 or 1 1/2."',
    prep: () => {}, set: (c, v) => c.setState({ todT: v }), good: '2', see: (r) => num(r.sec.od), bad: [['', 'empty'], ['abc', 'letters'], ['0', 'zero'], ['-1', 'negative'], ['6.', 'trailing dot', 6]] },
  { id: 'tube-wall', key: 'twallT', label: 'Round tube wall (no control on the form in this build)', ui: 'none', fam: 'tube', where: 'app.js:241', risk: 'medium',
    bites: 'unreadable wall becomes 0.120; a wall thicker than the radius is quietly thinned to fit',
    rule: 'Block unless 0 < wall < OD/2. Never clamp. Message: "Wall 1 1/2 is thicker than the tube - check it."',
    prep: () => {}, set: (c, v) => c.setState({ twallT: v }), good: '.120', see: (r) => num(r.sec.t), bad: [['', 'empty'], ['abc', 'letters'], ['0', 'zero'], ['-1', 'negative'], ['1.5', 'thicker than the radius of a 2 in tube']] },
  { id: 'hss-wall', key: 'hwallT', label: 'Sq/Rect - Wall (drop-down)', ui: 'select', fam: 'hss', where: 'app.js:247', risk: 'medium',
    bites: 'the drop-down offers 5/8 wall on a 1x1 tube; the part is built with 0.4 wall but named and listed as 5/8',
    rule: 'Offer only walls that exist for the size. Block wall > least side / 2.5 instead of thinning it. Message: "1x1 tube does not come in 5/8 wall."',
    prep: (c) => c.setState({ hsize: '1x1' }), set: (c, v) => c.setState({ hwallT: v }), good: '1/8', see: (r) => num(r.sec.t), bad: [['5/8', 'picked from the list - not a real 1x1 wall'], ['1/2', 'picked from the list'], ['', 'empty (code only)'], ['abc', 'unreadable (code only)']] },
  { id: 'hss-size', key: 'hsize', label: 'Sq/Rect - Size (drop-down)', ui: 'select', fam: 'hss', where: 'app.js:246', risk: 'low',
    bites: 'a size the list no longer has (old job, edited list) becomes 4x4 with the old name still on the file',
    rule: 'Block a size that is not in the list. Message: "Size 5x7 is not in the list - pick the size again."',
    prep: () => {}, set: (c, v) => c.setState({ hsize: v }), good: '4x4', see: (r) => r.sec.H + 'x' + r.sec.B, bad: [['', 'empty (code only)'], ['abc', 'unreadable (code only)'], ["4'x4", 'unreadable (code only)']] },
  { id: 'angle-thk', key: 'athkT', label: 'Angle - Thickness (drop-down)', ui: 'select', fam: 'angl', where: 'app.js:255', risk: 'medium',
    bites: 'the drop-down offers 1 in thick on a 1x1 angle; the part is built 1/2 thick but named L1X1x1',
    rule: 'Offer only thicknesses rolled for the leg size. Block thickness > least leg / 2 instead of thinning it.',
    prep: (c) => c.setState({ asize: '1x1' }), set: (c, v) => c.setState({ athkT: v }), good: '1/8', see: (r) => num(r.sec.t), bad: [['1', 'picked from the list - not a real 1x1 angle'], ['3/4', 'picked from the list'], ['', 'empty (code only)'], ['abc', 'unreadable (code only)']] },
  { id: 'angle-size', key: 'asize', label: 'Angle - Legs (drop-down)', ui: 'select', fam: 'angl', where: 'app.js:254', risk: 'low',
    bites: 'a size the list no longer has becomes 3x3 with the old name still on the file',
    rule: 'Block a size that is not in the list.',
    prep: () => {}, set: (c, v) => c.setState({ asize: v }), good: '3x3', see: (r) => r.sec.a + 'x' + r.sec.b, bad: [['', 'empty (code only)'], ['abc', 'unreadable (code only)']] },
  { id: 'beam-size', key: 'bsize', label: 'Beam - Size (drop-down)', ui: 'select', fam: 'beam', where: 'app.js:265-267', risk: 'medium',
    bites: 'a size missing from the table is built as the FIRST beam in the table (W4x13) while the file is still named for the size asked',
    rule: 'Block a size or series that is not in the table. Never fall back to the first row. Message: "W99x999 is not in the beam table - pick the size again."',
    prep: () => {}, set: (c, v) => c.setState({ bsize: v }), good: 'W12x26', see: (r) => 'd ' + r.sec.d + ' bf ' + r.sec.bf, bad: [['W99x999', 'size not in the table (code only)'], ['', 'empty (code only)']] },
  { id: 'chan-size', key: 'csize', label: 'Channel - Size (drop-down)', ui: 'select', fam: 'chan', where: 'app.js:265-267', risk: 'medium',
    bites: 'a size missing from the table is built as the first channel in the table under the old name',
    rule: 'Block a size or series that is not in the table.',
    prep: () => {}, set: (c, v) => c.setState({ csize: v }), good: 'C6x10.5', see: (r) => 'd ' + r.sec.d + ' bf ' + r.sec.bf, bad: [['C99x9', 'size not in the table (code only)']] },
  { id: 'pipe-size', key: 'pnps', label: 'Pipe size (drop-down)', ui: 'select', fam: 'pipe', where: 'app.js:236', risk: 'low',
    bites: 'a size missing from the table gives a part with no diameter that is still called valid; a missing schedule stops the page',
    rule: 'Block a size or schedule that is not in the table.',
    prep: () => {}, set: (c, v) => c.setState({ pnps: v }), good: '6', see: (r) => num(r.sec.od), bad: [['7', 'size not in the table (code only)']] },
  { id: 'cust-d', key: 'cdT', label: 'Custom beam - Depth', ui: 'text', fam: 'beam', where: 'app.js:262', risk: 'high',
    bites: 'clearing the box, or typing 10" with a curly inch mark, quietly builds a 12 in deep beam',
    rule: 'Block unless 2 in to 60 in and depth > 2 x flange thickness. Message: "Depth won\'t read - type 12 or 11 7/8."',
    prep: (c) => c.setState({ bser: 'CUST', bsize: '' }), set: (c, v) => c.setState({ cdT: v }), good: '12', see: (r) => num(r.sec.d), bad: [['', 'box cleared'], ['abc', 'letters'], ['0', 'zero'], ['10”', 'curly inch mark', 10], ['99999', 'slipped digits']] },
  { id: 'cust-bf', key: 'cbT', label: 'Custom beam - Flg W', ui: 'text', fam: 'beam', where: 'app.js:262', risk: 'high',
    bites: 'an unreadable flange width becomes 6 1/2; a negative one is only stopped later by the kernel with a meaningless number',
    rule: 'Block unless 1 in to 24 in and wider than the web. Message: "Flange width won\'t read."',
    prep: (c) => c.setState({ bser: 'CUST', bsize: '' }), set: (c, v) => c.setState({ cbT: v }), good: '6.5', see: (r) => num(r.sec.bf), bad: [['', 'box cleared'], ['abc', 'letters'], ['0', 'zero'], ['-1', 'negative'], ['8  1/4', 'two spaces', 8.25]] },
  { id: 'cust-tf', key: 'ctfT', label: 'Custom beam - Flg T', ui: 'text', fam: 'beam', where: 'app.js:262', risk: 'medium',
    bites: 'an unreadable flange thickness becomes 3/8',
    rule: 'Block unless 1/16 in to 4 in and less than half the depth.',
    prep: (c) => c.setState({ bser: 'CUST', bsize: '' }), set: (c, v) => c.setState({ ctfT: v }), good: '3/8', see: (r) => num(r.sec.tf), bad: [['', 'box cleared'], ['abc', 'letters'], ['0', 'zero'], ['-1', 'negative'], ['0.0001', 'stray decimal']] },
  { id: 'cust-tw', key: 'ctwT', label: 'Custom beam - Web T', ui: 'text', fam: 'beam', where: 'app.js:262', risk: 'medium',
    bites: 'an unreadable web becomes 1/4; a web typed thicker than the flange is wide (100) still exports a file',
    rule: 'Block unless 1/16 in to 3 in and less than the flange width.',
    prep: (c) => c.setState({ bser: 'CUST', bsize: '' }), set: (c, v) => c.setState({ ctwT: v }), good: '1/4', see: (r) => num(r.sec.tw), bad: [['', 'box cleared'], ['abc', 'letters'], ['0', 'zero'], ['-1', 'negative'], ['100', 'web thicker than the flange is wide']] },
  { id: 'cust-wt', key: 'cwT', label: 'Custom beam - lb/ft', ui: 'text', fam: 'beam', where: 'app.js:262', risk: 'low',
    bites: 'not geometry: an unreadable weight becomes 26 lb/ft on the cut list, ticket and material cost',
    rule: 'Block empty or unreadable; accept 1 to 800. Message: "lb/ft won\'t read - type 26."',
    prep: (c) => c.setState({ bser: 'CUST', bsize: '' }), set: (c, v) => c.setState({ cwT: v }), good: '31', see: (r) => num(r.sec.wtFt), bad: [['', 'box cleared'], ['abc', 'letters'], ['0', 'zero'], ['40 lb', 'unit typed', 40]] },

  // ---------------- ends: pipe
  { id: 'miter', key: 'ends.X.maT', label: 'End - Miter - Angle off square ° (number box)', ui: 'number', fam: 'pipe', where: 'app.js:277', risk: 'high',
    bites: 'typing 22-1/2 in a number box leaves "22-12" on screen while the app gets nothing and cuts the end SQUARE; 80 is cut at 75',
    rule: 'Block empty or unreadable. Read 22 1/2 and 22-1/2 as 22.5. Block outside -75..75 instead of clamping. Message: "Miter angle won\'t read - type 22.5."',
    prep: (c) => { c.setState({ lenT: '60' }); setEnd(c, 'A', { mode: 'miter' }); }, set: (c, v) => setEnd(c, 'A', { maT: v }), good: '30', see: (r) => r.A.ma,
    bad: [['', 'box cleared, or junk in a number box'], ['abc', 'letters'], ['80', 'past the 75 limit'], ['22-1/2', 'shop fraction', 22.5], ['22 1/2', 'shop fraction', 22.5], ['22,5', 'comma decimal', 22.5], ['1/2', 'half a degree', .5]] },
  { id: 'miter-turn', key: 'ends.X.mrT', label: 'End - Miter - Turned ° (number box)', ui: 'number', fam: 'pipe', where: 'app.js:278', risk: 'medium',
    bites: 'a turn that will not read becomes 0 - the long point lands on top instead of on the side',
    rule: 'Block unreadable. Read 22 1/2 as 22.5. Accept -360..360.',
    prep: (c) => { c.setState({ lenT: '60' }); setEnd(c, 'A', { mode: 'miter', maT: '30' }); }, set: (c, v) => setEnd(c, 'A', { mrT: v }), good: '90', see: (r) => deg(r.A.mr),
    bad: [['', 'junk in a number box arrives empty'], ['abc', 'letters'], ['22 1/2', 'shop fraction', 22.5]] },
  { id: 'saddle-angle', key: 'ends.X.sdAT', label: 'End - Saddle - Angle ° (90 = tee) (number box, min 20 max 90)', ui: 'number', fam: 'pipe', where: 'app.js:290', risk: 'high',
    bites: 'a lateral typed as 15 is cut at 20, 120 is cut as a 90 tee, an unreadable angle is cut as a 90 tee - none of them says so',
    rule: 'Block empty or unreadable. Block outside 20..90 instead of clamping (the box limits do not stop typing). Message: "Saddle angle must be 20 to 90 - you typed 15."',
    prep: (c) => { c.setState({ lenT: '60' }); setEnd(c, 'A', { mode: 'saddle', sdN: '6', sdS: '40' }); }, set: (c, v) => setEnd(c, 'A', { sdAT: v }), good: '60', see: (r) => deg(r.A.sd.alpha),
    bad: [['', 'box cleared, or junk in a number box'], ['abc', 'letters'], ['15', 'below the 20 limit'], ['120', 'above 90'], ['22-1/2', 'shop fraction', 22.5]] },
  { id: 'saddle-roll', key: 'ends.X.sdRT', label: 'End - Saddle - Roll ° around this pipe (number box, inside "Odd size or rolled")', ui: 'number', fam: 'pipe', where: 'app.js:291', risk: 'medium',
    bites: 'a roll that will not read becomes 0 - the fish-mouth is cut un-rolled',
    rule: 'Block unreadable. Read 22 1/2 as 22.5.',
    prep: (c) => { c.setState({ lenT: '60' }); setEnd(c, 'A', { mode: 'saddle', sdN: '6', sdS: '40' }); }, set: (c, v) => setEnd(c, 'A', { sdRT: v }), good: '30', see: (r) => deg(r.A.sd.roll),
    bad: [['', 'junk in a number box arrives empty'], ['abc', 'letters'], ['22 1/2', 'shop fraction', 22.5]] },
  { id: 'saddle-hod', key: 'ends.X.sdHodT', label: 'End - Saddle - Fits against OD (custom)', ui: 'text', fam: 'pipe', where: 'app.js:285-287, 377', risk: 'low',
    bites: '(already blocks: the only typed box with its own "won\'t parse" message)',
    rule: 'Keep. Also block an OD past 120 in.',
    prep: (c) => { c.setState({ lenT: '60' }); setEnd(c, 'A', { mode: 'saddle', sdHT: 'cust' }); }, set: (c, v) => setEnd(c, 'A', { sdHodT: v }), good: '10.75', see: (r) => num(r.A.sd.hod),
    bad: [['', 'box cleared'], ['abc', 'letters'], ['0', 'zero'], ['-1', 'negative'], ['10 3/4”', 'curly inch mark', 10.75]] },
  { id: 'saddle-hw', key: 'ends.X.sdHwT', label: 'End - Saddle - Its wall (custom, "Goes through it")', ui: 'text', fam: 'pipe', where: 'app.js:288', risk: 'high',
    bites: 'a set-through saddle seats on the header bore: an unreadable wall becomes 1/4 and the fish-mouth is cut for the wrong bore',
    rule: 'Block unless 0 < wall < OD/2. Never substitute 1/4. Message: "Header wall won\'t read - type .365 or 3/8."',
    prep: (c) => { c.setState({ lenT: '60', pnps: '2' }); setEnd(c, 'A', { mode: 'saddle', sdHT: 'cust', sdHodT: '10.75', sdSeat: 'thru' }); }, set: (c, v) => setEnd(c, 'A', { sdHwT: v }), good: '.365', see: (r) => num(r.A.sd.hw),
    bad: [['', 'box cleared'], ['abc', 'letters'], ['0', 'zero'], ['-1', 'negative'], ['3/8”', 'curly inch mark', .375]] },

  // ---------------- ends: flat sections
  { id: 'ang-side', key: 'ends.X.tvT', label: 'End - Miter - Angle ° seen from the side (number box)', ui: 'number', fam: 'hss', where: 'app.js:297', risk: 'high',
    bites: 'a frame corner typed 22-1/2 is cut SQUARE; 80 is cut at 75 with no note at all',
    rule: 'Block when Miter is on and both angles are empty/0. Read 22 1/2 as 22.5. Block outside -75..75 instead of clamping.',
    prep: (c) => { c.setState({ lenT: '60' }); setEnd(c, 'A', { mode: 'ang', tpT: '0' }); }, set: (c, v) => setEnd(c, 'A', { tvT: v }), good: '30', see: (r) => r.A.tv,
    bad: [['', 'box cleared, or junk in a number box'], ['abc', 'letters'], ['80', 'past the 75 limit'], ['22-1/2', 'shop fraction', 22.5], ['22 1/2', 'shop fraction', 22.5]] },
  { id: 'ang-plan', key: 'ends.X.tpT', label: 'End - Miter - Angle ° seen from above (number box)', ui: 'number', fam: 'beam', where: 'app.js:296', risk: 'high',
    bites: 'same as the side angle: junk cuts square, 80 cuts 75',
    rule: 'Same as the side angle.',
    prep: (c) => { c.setState({ lenT: '60' }); setEnd(c, 'A', { mode: 'ang', tvT: '0' }); }, set: (c, v) => setEnd(c, 'A', { tpT: v }), good: '30', see: (r) => r.A.tp,
    bad: [['', 'box cleared, or junk in a number box'], ['abc', 'letters'], ['80', 'past the 75 limit'], ['22 1/2', 'shop fraction', 22.5]] },
  { id: 'cope-len', key: 'ends.X.tcT / bcT', label: 'End - Cope - Top flange Length (Bottom flange Length reads the same way)', ui: 'text', fam: 'beam', where: 'app.js:301-302, 626', risk: 'high',
    bites: 'a cope length that will not read is cut 4 in long; one longer than the whole beam is only caught when both ends are coped',
    rule: 'Block empty, unreadable, 0 or negative; block length >= part length. Message: "Cope length won\'t read - type 4 or 3 1/2."',
    prep: (c) => { c.setState({ lenT: '60' }); setEnd(c, 'A', { wantCope: true, ct: true }); }, set: (c, v) => setEnd(c, 'A', { tcT: v }), good: '4', see: (r) => num(r.A.ct.c),
    bad: [['', 'box cleared'], ['abc', 'letters'], ['0', 'zero'], ['-1', 'negative'], ['6  3/8', 'two spaces', 6.375], ['100', 'longer than the 60 in beam']] },
  { id: 'cope-len-bot', key: 'ends.X.bcT', label: 'End - Cope - Bottom flange Length', ui: 'text', fam: 'beam', where: 'app.js:302', risk: 'high',
    bites: 'as the top flange', rule: 'As the top flange.',
    prep: (c) => { c.setState({ lenT: '60' }); setEnd(c, 'A', { wantCope: true, ct: false, cb: true }); }, set: (c, v) => setEnd(c, 'A', { bcT: v }), good: '4', see: (r) => num(r.A.cb.c), bad: [['', 'box cleared'], ['abc', 'letters']] },
  { id: 'cope-depth', key: 'ends.X.tdT / bdT', label: 'End - Cope - Depth', ui: 'text', fam: 'beam', where: 'app.js:301-302, 618-619', risk: 'high',
    bites: 'a depth that will not read is cut 1 1/2 deep; one thinner than the flange is raised to the flange thickness with only a yellow note',
    rule: 'Block empty, unreadable, 0; block depth < flange thickness and depth that leaves < 1/4 in of web (the second already blocks). Message: "Cope depth 1/4 is less than the 3/8 flange."',
    prep: (c) => { c.setState({ lenT: '60' }); setEnd(c, 'A', { wantCope: true, ct: true }); }, set: (c, v) => setEnd(c, 'A', { tdT: v }), good: '1 1/2', see: (r) => num(r.A.ct.dc),
    bad: [['', 'box cleared'], ['abc', 'letters'], ['0', 'zero'], ['1/4', 'thinner than the 3/8 flange (raised, yellow note only)'], ['22', 'deeper than the beam (blocks today)']] },
  { id: 'cope-rad', key: 'ends.X.trT / brT', label: 'End - Cope - Top/Bottom cope radius (inside "Corner radius & weld access holes")', ui: 'text', fam: 'beam', where: 'app.js:301-302, 620', risk: 'medium',
    bites: 'a radius that will not read is cut 1/2; one bigger than the cope is cut at 90 % of the cope, no note',
    rule: 'Block unreadable or negative; block radius > the smaller of cope length and depth. 0 = sharp corner is a real request: accept it.',
    prep: (c) => { c.setState({ lenT: '60' }); setEnd(c, 'A', { wantCope: true, ct: true }); }, set: (c, v) => setEnd(c, 'A', { trT: v }), good: '1/2', see: (r) => num(r.A.ct.r),
    bad: [['', 'box cleared'], ['abc', 'letters'], ['-1', 'negative'], ['3', 'bigger than the 1 1/2 deep cope']] },
  { id: 'rat-rad', key: 'ends.X.rrT', label: 'End - Cope - Access hole radius (inside "Corner radius & weld access holes")', ui: 'text', fam: 'beam', where: 'app.js:303, 624', risk: 'medium',
    bites: 'a radius that will not read is cut 3/4; one too big for the web is cut smaller, no note; a negative one exports a file with no access hole',
    rule: 'Block unreadable, 0 or negative; block radius > half the web depth instead of shrinking it.',
    prep: (c) => { c.setState({ lenT: '60' }); setEnd(c, 'A', { wantCope: true, ct: false, cb: false, rat: 'TOP' }); }, set: (c, v) => setEnd(c, 'A', { rrT: v }), good: '3/4', see: (r) => num(r.A.rr),
    bad: [['', 'box cleared'], ['abc', 'letters'], ['-1', 'negative'], ['12', 'bigger than the web']] },
  { id: 'bevel', key: 'ends.X.bvT', label: 'Weld bevel angle (no control on the form in this build - arrives by recall code or old job; a note on the ticket, not cut)', ui: 'none', fam: 'pipe', where: 'app.js:274', risk: 'low',
    bites: 'not geometry: a bevel of 75 is printed as 60 on the ticket; one that will not read drops the bevel note altogether',
    rule: 'Block outside 0..60 instead of clamping; block unreadable while the bevel is switched on.',
    prep: (c) => { c.setState({ lenT: '60' }); setEnd(c, 'A', { wantBevel: true }); }, set: (c, v) => setEnd(c, 'A', { bvT: v }), good: '37.5', see: (r) => r.A.bv, bad: [['75', 'past the 60 limit'], ['abc', 'unreadable - the note disappears'], ['37 1/2', 'shop fraction', 37.5]] },

  // ---------------- holes: pipe
  { id: 'p-dia', key: 'groups[].diaT', label: 'Hole (pipe) - Hole Ø', ui: 'text', fam: 'pipe', where: 'app.js:170', risk: 'high',
    bites: 'a 3/4 hole typed with a curly inch mark, or 1  1/2 with two spaces, is cut 1 in; a negative size is only stopped by the kernel with a number for a message',
    rule: 'Block empty, unreadable, 0 or negative; block >= pipe OD (already blocks). Never substitute 1 in. Message: "Hole size won\'t read - type 3/4 or .75."',
    prep: (c) => { c.setState({ lenT: '60' }); holesOn(c, { type: 'cust', x0T: '12' }); }, set: (c, v) => setG(c, { diaT: v }), good: '1', see: (r) => r.holes.map((h) => num(h.dia)).join(','),
    bad: [['', 'box cleared'], ['abc', 'letters'], ['0', 'zero'], ['-1', 'negative'], ['3/4”', 'curly inch mark', .75], ['1  1/2', 'two spaces', 1.5]] },
  { id: 'p-x0', key: 'groups[].x0T', label: 'Hole (pipe) - Distance', ui: 'text', fam: 'pipe', where: 'app.js:211', risk: 'high',
    bites: 'a distance that will not read puts the hole 3 in from the end - 6  3/8 (two spaces) drills at 3',
    rule: 'Block empty or unreadable. Never substitute 3 in. Message: "Distance to the hole won\'t read - type 6 3/8."',
    prep: (c) => { c.setState({ lenT: '60' }); holesOn(c, { type: 'cust', diaT: '1' }); }, set: (c, v) => setG(c, { x0T: v }), good: '12', see: xs,
    bad: [['', 'box cleared'], ['abc', 'letters'], ['6  3/8', 'two spaces', 6.375], ['12”', 'curly inch mark', 12], ['12.', 'trailing dot', 12]] },
  { id: 'p-pitch', key: 'groups[].pT', label: 'Hole (pipe) - Spacing along (inside "Repeat this hole / exact distances")', ui: 'text', fam: 'pipe', where: 'app.js:211', risk: 'high',
    bites: 'a spacing that will not read becomes 3 in; 0 stacks every hole on one spot; 1/2 for 1 1/2 chains the holes into one long slot',
    rule: 'Block empty or unreadable when there is more than one hole; block 0 or negative; block spacing < hole width + 1/8 (holes touch). Message: "Holes 1/2 apart overlap - they are 1 in wide."',
    prep: (c) => { c.setState({ lenT: '60' }); holesOn(c, { type: 'cust', diaT: '1', x0T: '12', nT: '3' }); }, set: (c, v) => setG(c, { pT: v }), good: '6', see: xs,
    bad: [['', 'box cleared'], ['abc', 'letters'], ['0', 'zero - holes stacked'], ['-1', 'negative'], ['1/2', 'meant 1 1/2 - holes overlap']] },
  { id: 'p-count', key: 'groups[].nT', label: 'Hole (pipe) - How many along the pipe (number box, max 60)', ui: 'number', fam: 'pipe', where: 'app.js:212, 218', risk: 'high',
    bites: 'an empty count cuts 1 hole, 2.5 cuts 3; more than 60 in a row is cut as 60 with no note - and with Both ends the far end loses holes first',
    rule: 'Block empty, unreadable, non-whole, < 1. Block more than the limit instead of dropping the rest. Message: "80 holes asked, the limit is 60 - split the row in two."',
    prep: (c) => { c.setState({ lenT: '240' }); holesOn(c, { type: 'cust', diaT: '1/2', x0T: '2', pT: '2' }); }, set: (c, v) => setG(c, { nT: v }), good: '3', see: (r) => r.holes.length + ' holes',
    bad: [['', 'box cleared, or junk in a number box'], ['abc', 'letters'], ['0', 'zero'], ['2.5', 'fraction'], ['100', 'more than the 60 limit']] },
  { id: 'p-count-both', key: 'groups[].nT + both', label: 'Hole (pipe) - How many, with "Both ends"', ui: 'number', fam: 'pipe', where: 'app.js:215-218', risk: 'high',
    bites: '40 holes from each end is 80: the first 60 are kept, so End A gets 40 and End B only 20',
    rule: 'Block when the mirrored pattern passes the limit.',
    prep: (c) => { c.setState({ lenT: '240' }); holesOn(c, { type: 'cust', diaT: '1/2', x0T: '2', pT: '2', both: true }); }, set: (c, v) => setG(c, { nT: v }), good: '3', see: (r) => r.holes.length + ' holes',
    bad: [['40', '80 holes asked, 60 kept - lopsided']] },
  { id: 'p-az', key: 'groups[].azT', label: 'Hole (pipe) - Degrees around (number box)', ui: 'number', fam: 'pipe', where: 'app.js:474', risk: 'high',
    bites: 'a clock position that will not read becomes 0 - the hole is cut on TOP instead of on the side',
    rule: 'Block empty or unreadable. Read 22 1/2 as 22.5. Block outside -360..360. Message: "Degrees around won\'t read - type 90."',
    prep: (c) => { c.setState({ lenT: '60' }); holesOn(c, { type: 'cust', diaT: '1', x0T: '12' }); }, set: (c, v) => setG(c, { azT: v }), good: '90', see: (r) => r.holes.map((h) => h.deg).join(','),
    bad: [['', 'box cleared, or junk in a number box'], ['abc', 'letters'], ['22 1/2', 'shop fraction', 22.5], ['1000', 'slipped digits']] },
  { id: 'p-azn', key: 'groups[].aznT', label: 'Hole (pipe) - How many around (number box, max 24)', ui: 'number', fam: 'pipe', where: 'app.js:474', risk: 'medium',
    bites: '5 around at 90 apart cuts the first position twice; 2.5 cuts 3',
    rule: 'Block empty, unreadable, non-whole, < 1, > 24; block when count x degrees apart goes past a full turn.',
    prep: (c) => { c.setState({ lenT: '60' }); holesOn(c, { type: 'cust', diaT: '1', x0T: '12', azT: '45', azpT: '90' }); }, set: (c, v) => setG(c, { aznT: v }), good: '2', see: (r) => r.holes.map((h) => h.deg).join(','),
    bad: [['', 'box cleared'], ['abc', 'letters'], ['2.5', 'fraction'], ['5', '5 x 90 = more than a full turn'], ['100', 'more than the 24 limit']] },
  { id: 'p-azp', key: 'groups[].azpT', label: 'Hole (pipe) - Degrees apart (number box)', ui: 'number', fam: 'pipe', where: 'app.js:474', risk: 'medium',
    bites: 'empty, junk and 0 all become 90 apart',
    rule: 'Block empty, unreadable or 0 when there is more than one hole around.',
    prep: (c) => { c.setState({ lenT: '60' }); holesOn(c, { type: 'cust', diaT: '1', x0T: '12', azT: '45', aznT: '2' }); }, set: (c, v) => setG(c, { azpT: v }), good: '180', see: (r) => r.holes.map((h) => h.deg).join(','),
    bad: [['', 'box cleared'], ['abc', 'letters'], ['0', 'zero'], ['22 1/2', 'shop fraction', 22.5]] },
  { id: 'p-list', key: 'groups[].xsT', label: 'Hole - Exact distances / Exact spots (inside the collapsed "More options")', ui: 'text', fam: 'pipe', where: 'app.js:204-209, 218', risk: 'high',
    bites: 'any spot that will not read is dropped: "12 24 36" (spaces for commas) cuts NO holes; "12, 24, 36  1/2" cuts two of three',
    rule: 'Block if any entry will not read, naming it. Accept commas, semicolons or single spaces between whole entries only if unambiguous. Message: "Exact spots: can\'t read \'36  1/2\'."',
    prep: (c) => { c.setState({ lenT: '60' }); holesOn(c, { type: 'cust', diaT: '1' }); }, set: (c, v) => setG(c, { xsT: v }), good: '12, 24', see: xs,
    bad: [['12, 24, 36  1/2', 'two spaces in the last one', '12,24,36.5'], ['12 24 36', 'spaces for commas - nothing is cut'], ['12, abc', 'letters - dropped'], ['12, 24”', 'curly inch mark', '12,24'], ['abc', 'nothing readable - no holes at all'], ['12. 24', 'dot for comma - nothing is cut']] },

  // ---------------- holes: square / rectangular tube
  { id: 'h-dia', key: 'groups[].diaT', label: 'Hole (sq/rect) - Hole Ø / Slot width', ui: 'text', fam: 'hss', where: 'app.js:177', risk: 'high',
    bites: 'a size that will not read is cut 9/16',
    rule: 'As the pipe hole size. Never substitute 9/16.',
    prep: (c) => { c.setState({ lenT: '60' }); holesOn(c, { type: 'cust', x0T: '12', nT: '1' }); }, set: (c, v) => setG(c, { diaT: v }), good: '9/16', see: (r) => r.holes.map((h) => num(h.dia)).join(','),
    bad: [['', 'box cleared'], ['abc', 'letters'], ['0', 'zero'], ['-1', 'negative'], ['13/16”', 'curly inch mark', .8125]] },
  { id: 'h-slot', key: 'groups[].sllT', label: 'Hole (sq/rect) - Slot length', ui: 'text', fam: 'hss', where: 'app.js:178', risk: 'medium',
    bites: 'a slot length that will not read is cut 1 1/2; one shorter than the width is cut as a round hole',
    rule: 'Block empty or unreadable; block slot length <= slot width.',
    prep: (c) => { c.setState({ lenT: '60' }); holesOn(c, { type: 'slot', diaT: '9/16', x0T: '12', nT: '1' }); }, set: (c, v) => setG(c, { sllT: v }), good: '1 1/2', see: (r) => r.holes.map((h) => num(h.slotL)).join(','),
    bad: [['', 'box cleared'], ['abc', 'letters'], ['1/4', 'shorter than the 9/16 width - becomes a round hole']] },
  { id: 'h-off', key: 'groups[].offT', label: 'Hole (sq/rect) - Offset from the center of that face (inside "More options")', ui: 'text', fam: 'hss', where: 'app.js:549', risk: 'medium',
    bites: 'an offset that will not read becomes 0 - the hole goes on the centerline',
    rule: 'Block unreadable (empty may mean 0 only if the box shows 0).',
    prep: (c) => { c.setState({ lenT: '60' }); holesOn(c, { type: 'cust', diaT: '9/16', x0T: '12', nT: '1' }); }, set: (c, v) => setG(c, { offT: v }), good: '1/2', see: (r) => r.holes.map((h) => num(h.off)).join(','),
    bad: [['abc', 'letters'], ['1/2”', 'curly inch mark', .5], ['3 /4', 'space before the slash', .75]] },
  { id: 'h-x0', key: 'groups[].x0T', label: 'Hole (sq/rect, angle) - First hole at', ui: 'text', fam: 'hss', where: 'app.js:211', risk: 'high',
    bites: 'as the pipe Distance: unreadable = 3 in', rule: 'As the pipe Distance.',
    prep: (c) => { c.setState({ lenT: '60' }); holesOn(c, { type: 'cust', diaT: '9/16', nT: '1' }); }, set: (c, v) => setG(c, { x0T: v }), good: '12', see: xs, bad: [['', 'box cleared'], ['abc', 'letters']] },

  // ---------------- holes: beam / channel
  { id: 'b-x0', key: 'groups[].x0T', label: 'Hole (beam/channel) - In from the end', ui: 'text', fam: 'beam', where: 'app.js:211', risk: 'high',
    bites: 'an end distance that will not read becomes 3 in - the connection holes miss the clip',
    rule: 'As the pipe Distance.',
    prep: (c) => { c.setState({ lenT: '60' }); holesOn(c, { face: 'web', autoY: true, nyT: '2', pyT: '3', nT: '1' }); }, set: (c, v) => setG(c, { x0T: v }), good: '2', see: xs, bad: [['', 'box cleared'], ['abc', 'letters'], ['1  1/2', 'two spaces', 1.5]] },
  { id: 'b-pitch', key: 'groups[].pT', label: 'Hole (beam/channel) - Along the beam: apart', ui: 'text', fam: 'beam', where: 'app.js:211', risk: 'high',
    bites: 'as the pipe spacing: unreadable = 3 in, 0 = stacked holes', rule: 'As the pipe spacing.',
    prep: (c) => { c.setState({ lenT: '60' }); holesOn(c, { face: 'web', autoY: true, nyT: '1', x0T: '2', nT: '2' }); }, set: (c, v) => setG(c, { pT: v }), good: '3', see: xs, bad: [['', 'box cleared'], ['abc', 'letters'], ['0', 'zero - holes stacked']] },
  { id: 'b-y0', key: 'groups[].y0T', label: 'Hole (beam/channel web) - First row, down from top', ui: 'text', fam: 'beam', where: 'app.js:712', risk: 'high',
    bites: 'a row height that will not read becomes 3 in down from the top',
    rule: 'Block empty or unreadable. Never substitute 3 in.',
    prep: (c) => { c.setState({ lenT: '60' }); holesOn(c, { face: 'web', autoY: false, wref: 'tos', nyT: '1', x0T: '6', nT: '1' }); }, set: (c, v) => setG(c, { y0T: v }), good: '4', see: (r) => r.holes.map((h) => num(r.sec.d / 2 - h.c)).join(','),
    bad: [['', 'box cleared'], ['abc', 'letters'], ['4  1/2', 'two spaces', 4.5]] },
  { id: 'b-py', key: 'groups[].pyT', label: 'Hole (beam/channel web) - Down the web: apart', ui: 'text', fam: 'beam', where: 'app.js:710', risk: 'high',
    bites: 'a row spacing that will not read becomes 3 in; 0 stacks both rows on one line',
    rule: 'Block empty or unreadable when there is more than one row; block 0, negative, or rows that touch.',
    prep: (c) => { c.setState({ lenT: '60' }); holesOn(c, { face: 'web', autoY: true, nyT: '2', x0T: '6', nT: '1' }); }, set: (c, v) => setG(c, { pyT: v }), good: '4', see: (r) => r.holes.map((h) => num(h.c)).join(','),
    bad: [['', 'box cleared'], ['abc', 'letters'], ['0', 'zero - rows stacked']] },
  { id: 'b-ny', key: 'groups[].nyT', label: 'Hole (beam/channel web) - Down the web: bolts (number box, max 30)', ui: 'number', fam: 'beam', where: 'app.js:711', risk: 'medium',
    bites: 'an empty count cuts 1 row; 2.5 cuts 3',
    rule: 'Block empty, unreadable, non-whole, < 1 or over the limit.',
    prep: (c) => { c.setState({ lenT: '60' }); holesOn(c, { face: 'web', autoY: true, pyT: '3', x0T: '6', nT: '1' }); }, set: (c, v) => setG(c, { nyT: v }), good: '2', see: (r) => r.holes.length + ' holes',
    bad: [['', 'box cleared'], ['abc', 'letters'], ['2.5', 'fraction']] },
  { id: 'b-gauge', key: 'groups[].gT', label: 'Hole (beam/channel flange) - Gauge between the two hole lines', ui: 'text', fam: 'beam', where: 'app.js:727-729', risk: 'high',
    bites: 'a gauge that will not read becomes 3 1/2; 0 or 1/2 puts the flange holes straight over the web',
    rule: 'Block empty or unreadable; block 0 or negative; block holes that land on the web or its fillet (gauge < web + 2 x fillet + hole).',
    prep: (c) => { c.setState({ lenT: '60' }); holesOn(c, { face: 'tf', autoG: false, amode: 'gauge', x0T: '6', nT: '1' }); }, set: (c, v) => setG(c, { gT: v }), good: '3 1/2', see: (r) => r.holes.map((h) => num(h.c)).join(','),
    bad: [['', 'box cleared'], ['abc', 'letters'], ['0', 'zero - both lines on the web'], ['-3', 'negative'], ['1/2', 'holes over the web']] },
  { id: 'b-dia', key: 'groups[].diaT', label: 'Hole (beam/channel/angle) - Hole Ø (Custom Ø)', ui: 'text', fam: 'beam', where: 'app.js:184', risk: 'high',
    bites: 'a custom size that will not read is cut at the standard hole for the bolt picked above it',
    rule: 'As the pipe hole size. Never substitute the bolt hole.',
    prep: (c) => { c.setState({ lenT: '60' }); holesOn(c, { face: 'web', type: 'cust', autoY: true, nyT: '1', x0T: '6', nT: '1' }); }, set: (c, v) => setG(c, { diaT: v }), good: '15/16', see: (r) => r.holes.map((h) => num(h.dia)).join(','),
    bad: [['', 'box cleared'], ['abc', 'letters'], ['0', 'zero'], ['-1', 'negative'], ['1  1/16', 'two spaces', 1.0625]] },

  // ---------------- holes: angle
  { id: 'a-gauge', key: 'groups[].gT', label: 'Hole (angle) - Gauge from heel', ui: 'text', fam: 'angl', where: 'app.js:826', risk: 'high',
    bites: 'a gauge that will not read becomes 1 3/4 from the heel',
    rule: 'Block empty or unreadable. Never substitute 1 3/4.',
    prep: (c) => { c.setState({ lenT: '60' }); holesOn(c, { face: 'vleg', x0T: '6', nT: '1' }); }, set: (c, v) => setG(c, { gT: v }), good: '1 1/2', see: (r) => r.holes.map((h) => num(h.c)).join(','),
    bad: [['', 'box cleared'], ['abc', 'letters'], ['1  1/4', 'two spaces', 1.25]] },
];

// ------------------------------------------------------------------ seeded random valid parts
export function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const NPS = Object.keys(DB.PIPE_OD);
const LENS = ['24', '36 1/2', '48', "5'-0", "7'-2 3/8", '60.25', "10'-6", '84', "12' 3 1/2\"", '30-1/4', '96', "4'6", '72 5/16'];
const MARKS = ['P-1', 'B-12', 'H 3', 'L-7A', 'C/4', 'T#9', 'brace 2', 'M1.5', 'Ø-1', 'x', 'A_1', 'P-1 (R)', 'Truss "A"', 'T&B', '', '12'];
/** One random part as a complete form config (every CFG key). May be blocked by the app - the caller keeps the valid ones. */
export function randomCfg(R) {
  const pick = (a) => a[Math.floor(R() * a.length)], chance = (p) => R() < p, int = (lo, hi) => lo + Math.floor(R() * (hi - lo + 1));
  const fam = pick(['pipe', 'pipe', 'tube', 'hss', 'hss', 'beam', 'beam', 'chan', 'angl']);
  const cfg = Object.assign(Component.freshPart(), { family: fam, lenMode: chance(.8) ? 'oal' : 'wp', lenT: pick(LENS), mark: pick(MARKS), qty: int(1, 40), heat: chance(.2) ? 'HT' + int(1000, 9999) : '', mat: pick(DB.MATERIALS).id });
  const end = () => {
    const e = Component.defEnd();
    if (fam === 'pipe' || fam === 'tube') {
      const m = pick(['sq', 'sq', 'miter', 'saddle']); e.mode = m;
      if (m === 'miter') { e.maT = String(pick([15, 22.5, 30, 45, 37.5, -30, 60])); e.mrT = String(pick([0, 0, 90, 180, 45, -90])); }
      if (m === 'saddle') {
        e.sdAT = String(pick([90, 90, 60, 45, 75])); e.sdRT = String(pick([0, 0, 15, 90])); e.sdSeat = chance(.7) ? 'on' : 'thru';
        if (chance(.2)) { e.sdHT = 'cust'; e.sdHodT = pick(['30', '36', '48 1/2']); e.sdHwT = pick(['.375', '1/2']); }
        else { e.sdN = pick(['14', '16', '18', '20', '24']); e.sdS = pick(DB.PIPE_SCHEDS); e.sdSet = true; }
      }
    } else {
      if (chance(.45)) { e.mode = 'ang'; e.tvT = String(pick([0, 15, 30, 45, -45, 22.5])); e.tpT = String(pick([0, 0, 10, 30, -20])); }
      if ((fam === 'beam' || fam === 'chan') && e.mode !== 'ang' && chance(.4)) { e.wantCope = true; e.ct = chance(.8); e.cb = chance(.3); e.tcT = pick(['3', '4', '2 1/2']); e.tdT = pick(['1 1/2', '1 1/4', '2']); e.trT = pick(['1/2', '3/8']); e.bcT = pick(['3', '4']); e.bdT = pick(['1 1/2', '2']); e.rat = pick(['NONE', 'NONE', 'TOP', 'BOTH']); e.rrT = pick(['3/4', '1/2']); }
    }
    if (chance(.1)) { e.wantBevel = true; e.bvT = pick(['30', '37.5']); }
    return e;
  };
  if (fam === 'pipe') { cfg.pnps = pick(NPS.slice(3, 12)); cfg.psch = pick(DB.PIPE_SCHEDS); }
  if (fam === 'tube') { cfg.todT = pick(['2', '1 1/2', '3', '2.5', '4']); cfg.twallT = pick(DB.TUBE_WALLS)[1]; }
  if (fam === 'hss') { cfg.hsize = pick(DB.HSS_SIZES.slice(4)); cfg.hwallT = pick(DB.HSS_WALLS.slice(0, 4)); }
  if (fam === 'beam') { if (chance(.15)) { cfg.bser = 'CUST'; cfg.bsize = ''; cfg.cdT = pick(['12', '10 1/2', '16']); cfg.cbT = pick(['6', '8']); cfg.ctfT = pick(['3/8', '1/2']); cfg.ctwT = pick(['1/4', '5/16']); cfg.cwT = pick(['26', '40']); } else { cfg.bser = pick(['W', 'S']); cfg.bsize = pick(Object.keys(DB[cfg.bser])); } }
  if (fam === 'chan') { cfg.cser = pick(['C', 'MC']); cfg.csize = pick(Object.keys(DB[cfg.cser])); }
  if (fam === 'angl') { cfg.asize = pick(DB.ANGLE_SIZES.slice(4)); cfg.athkT = pick(DB.ANGLE_THKS.slice(0, 5)); }
  cfg.ends = { A: end(), B: end() };
  cfg.wantHoles = chance(.6);
  const ng = cfg.wantHoles ? int(1, 3) : 1; cfg.groups = []; let gid = 1;
  for (let k = 0; k < ng; k++) {
    const g = chance(.5) ? Component.newGroup(gid++, fam) : Component.defGroup(gid++, fam);
    g.refEnd = pick(['A', 'A', 'B']); g.x0T = pick(['8', '9 1/2', '10', '12', "1'-0"]); g.nT = String(int(1, 3)); g.pT = pick(['3', '4', '2 1/2']);
    g.both = chance(.3); if (chance(.2)) g.xsT = pick(['9, 13', '10; 14 1/2', '11']);
    if (fam === 'pipe' || fam === 'tube') { g.type = pick(['cust', 'cust', 'olet', 'stub']); g.diaT = pick(['1/2', '3/4', '9/16', '1']); g.bnps = pick(['1/2', '3/4']); g.bsch = pick(['STD', '40', 'XS']); g.azT = String(pick([0, 90, 270, 45, 30, 315])); g.aznT = String(pick([1, 1, 2])); g.azpT = String(pick([90, 180])); }
    else if (fam === 'hss') { g.face = pick(['T', 'R', 'L', 'B']); g.type = pick(['cust', 'cust', 'slot']); g.diaT = pick(['9/16', '1/2', '13/16']); g.sllT = pick(['1 1/2', '1']); g.ax = pick(['x', 'y']); g.offT = g.face === 'B' ? pick(['1/2', '-1/2', '5/8']) : pick(['0', '0', '1/4', '-1/4']); }
    else if (fam === 'angl') { g.face = pick(['vleg', 'hleg']); g.bolt = pick(['1/2', '5/8', '3/4']); g.type = pick(['std', 'ovs', 'ssl', 'cust']); g.diaT = pick(['9/16', '11/16']); g.gT = pick(['1 1/4', '1 1/8', '1']); g.ax = pick(['x', 'y']); }
    else { g.face = pick(['web', 'web', 'tf', 'bf']); g.bolt = pick(['1/2', '5/8', '3/4']); g.type = pick(['std', 'std', 'ovs', 'ssl', 'lsl', 'cust']); g.diaT = pick(['9/16', '11/16']); g.ax = pick(['x', 'y']); g.autoY = chance(.6); g.autoG = chance(.6); g.bothF = g.face !== 'web' && chance(.3); g.wref = pick(['tos', 'cl', 'bos']); g.y0T = pick(['2', '2 1/2', '3']); g.nyT = String(int(1, 2)); g.pyT = pick(['2', '3']); g.amode = pick(['gauge', 'gauge', 'off']); g.gT = pick(['2', '2 1/4', '1 1/2', '2 1/2']); }
    cfg.groups.push(g);
  }
  cfg.gid = gid;
  return cfg;
}
