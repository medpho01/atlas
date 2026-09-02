const pptxgen = require('pptxgenjs');

// Atlas's own tokens, so the deck and the app look like one thing.
const INK9='0E1117', INK7='2D3340', INK6='454C5B', INK5='646B7A', INK4='8E96A3',
      INK3='C0C6CF', INK15='E8ECEF', INK1='F1F3F5', PAGE='FAFBFC', WHITE='FFFFFF',
      BRAND='1F4ED6', GREEN='16A34A', AMBER='D97706', RED='DC2626';
const ZONE = { South:'B45309', West:'0D9488', North:'7C3AED', East:'1F4ED6' };
const F = 'Calibri';

const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE';               // 13.3 x 7.5
pres.author = 'Atlas · LabStack';
pres.title  = 'Provider Network';

const M = 0.55, W = 13.3 - M * 2;

function head(s, title, sub) {
  s.background = { color: PAGE };
  s.addText(title, { x: M, y: 0.32, w: 9.5, h: 0.5, fontFace: F, fontSize: 30, bold: true, color: INK9, isTextBox: true, margin: 0 });
  s.addText(sub, { x: M, y: 0.82, w: 10.5, h: 0.3, fontFace: F, fontSize: 12, color: INK5, isTextBox: true, margin: 0 });
  s.addText('Atlas · 2 September 2026', { x: 13.3 - M - 3, y: 0.36, w: 3, h: 0.25, fontFace: F, fontSize: 10, color: INK4, align: 'right', isTextBox: true, margin: 0 });
}
function card(s, x, y, w, h) {
  s.addShape(pres.ShapeType.roundRect, { x, y, w, h, rectRadius: 0.06, fill: { color: WHITE }, line: { color: INK15, width: 0.75 } });
}
// Depth is one ordered quantity — one hue, five steps.
function band(d) {
  if (!d) return { fill: INK1, text: INK3 };
  if (d < 2)  return { fill: 'E4ECFC', text: '1D40AF' };
  if (d < 5)  return { fill: 'C2D5F7', text: '1D40AF' };
  if (d < 15) return { fill: '8FAFEF', text: '1D40AF' };
  if (d < 50) return { fill: '5581E4', text: WHITE };
  return { fill: BRAND, text: WHITE };
}

/* ─────────────────────────────── SLIDE 1 ─────────────────────────────── */
const s1 = pres.addSlide();
head(s1, 'The month in the network',
     'Serviceability by thread — where we can serve, not where we have served. Green is the last 30 days.');

const cards = [
  { n: 'Centre visit',           sub: 'Radiology and/or pathology', v: '2,131', d: '+78', p: '8,910', dep: '5.0' },
  { n: 'Home sample collection', sub: 'Pathology',                  v: '257',   d: '+40', p: '8,822', dep: '5.0' },
  { n: 'PPMC network',           sub: 'Active STAR-PPMC packages',  v: '42',    d: '+17', p: '1,330', dep: '1.0' },
];
const cw = (W - 0.4) / 3;
cards.forEach((c, i) => {
  const x = M + i * (cw + 0.2), y = 1.25, h = 1.5;
  card(s1, x, y, cw, h);
  s1.addText(c.n,   { x: x + 0.22, y: y + 0.13, w: cw - 0.44, h: 0.24, fontFace: F, fontSize: 13, bold: true, color: INK9, isTextBox: true, margin: 0 });
  s1.addText(c.sub, { x: x + 0.22, y: y + 0.36, w: cw - 0.44, h: 0.2,  fontFace: F, fontSize: 9.5, color: INK4, isTextBox: true, margin: 0 });
  s1.addText([{ text: c.v, options: { fontSize: 30, bold: true, color: INK9 } },
              { text: '  ' + c.d, options: { fontSize: 14, bold: true, color: GREEN } }],
             { x: x + 0.22, y: y + 0.62, w: cw - 0.44, h: 0.45, fontFace: F, isTextBox: true, margin: 0 });
  s1.addText([{ text: c.p + ' pincodes serviceable', options: { color: INK6 } },
              { text: '   ·   depth ' + c.dep, options: { color: INK4 } }],
             { x: x + 0.22, y: y + 1.12, w: cw - 0.44, h: 0.24, fontFace: F, fontSize: 10, isTextBox: true, margin: 0 });
});

// One native table — editable in Google Slides, and one object instead of eighty.
const G = (t, n) => [
  { text: t.toUpperCase(), options: { bold: true, color: INK6, fontSize: 8, charSpacing: 0.6, fill: { color: 'F7F9FA' } } },
  { text: n, options: { color: INK3, fontSize: 8, fill: { color: 'F7F9FA' }, colspan: 4 } },
];
const R = (name, prov, add, pins, depth) => {
  const man = prov === 'manual';
  const cell = (t, al, col, bold) => ({ text: t, options: { align: al, color: col, bold: !!bold, italic: man } });
  return [
    cell(name, 'left', man ? AMBER : INK7),
    cell(prov, 'right', man ? AMBER : INK9),
    cell(add, 'right', add.charAt(0) === '+' ? GREEN : INK3, add.charAt(0) === '+'),
    cell(pins, 'right', man ? AMBER : INK9),
    cell(depth, 'right', depth === '—' ? INK3 : INK6),
  ];
};
const hdrOpt = { bold: true, color: INK4, fontSize: 8, charSpacing: 0.6, fill: { color: WHITE } };
const tbl = [
  [{ text: 'THREAD', options: hdrOpt },
   { text: 'PROVIDERS', options: { ...hdrOpt, align: 'right' } },
   { text: 'ADDED (30D)', options: { ...hdrOpt, align: 'right' } },
   { text: 'PINCODES SERVICEABLE', options: { ...hdrOpt, align: 'right' } },
   { text: 'DEPTH', options: { ...hdrOpt, align: 'right' } }],
  G('Place-bound capacity', 'serviceable pincodes'),
  R('Centre visit', '2,131', '+78', '8,910', '5.0'),
  R('Home sample collection', '257', '+40', '8,822', '5.0'),
  R('PPMC network', '42', '+17', '1,330', '1.0'),
  R('Offline doctor consultation', '909', '+141', '53*', '—'),
  R('Dental network', '30', '+4', '11*', '—'),
  R('Specialised tests', 'manual', '—', 'manual', '—'),
  R('Processing labs', 'manual', '—', 'manual', '—'),
  R('Pharmacy', 'manual', '—', 'manual', '—'),
  G('People', 'headcount, and where they are'),
  R('Phlebotomists', '6,235', '—', '1,743*', '—'),
  R('Nurses', '951', '—', '31*', '—'),
  G('Virtual', 'no geography — see slide 3'),
  R('Online teleconsult', '1,076', '+202', '—', '—'),
];
s1.addTable(tbl, {
  x: M, y: 3.0, w: W, colW: [5.0, 1.85, 1.85, 2.35, 1.15], rowH: 0.24,
  fontFace: F, fontSize: 11, valign: 'middle', fill: { color: WHITE },
  border: [{ type: 'none' }, { type: 'none' }, { pt: 0.5, color: INK15 }, { type: 'none' }],
  margin: [2, 6, 2, 6],
});
s1.addText('Serviceable = pincodes entered against the lab, plus the 20 km catchment of each centre.   ' +
           '*  counted at the provider’s own location, without a travel radius — a floor, not a reach.   ' +
           'Specialised tests, Processing labs and Pharmacy are filled by hand.',
  { x: M, y: 6.95, w: W, h: 0.3, fontFace: F, fontSize: 8.5, color: INK4, isTextBox: true, margin: 0 });
s1.addNotes('Serviceability, not fulfilled orders. 8,910 and 8,822 sit under Atlas’s 9,207 active pincodes.');

/* ─────────────────────────────── SLIDE 2 ─────────────────────────────── */
const s2 = pres.addSlide();
head(s2, 'Where it reaches',
     'Serviceable depth by metro, and how each thread spreads across zones against where demand actually is.');

const METROS = ['Bengaluru', 'Hyderabad', 'Chennai', 'Mumbai', 'Pune', 'Delhi NCR'];
const HEAT = [
  ['Centre visit',           [137.7, 150.7, 82.6, 119.5, 40.4, 62.9]],
  ['Home sample collection', [31.6, 23.9, 38.9, 21.5, 10.4, 16.5]],
  ['PPMC network',           [2.6, 14.5, 4.9, 1.0, 1.0, 1.0]],
];
const hx = M, hy = 1.3, hw = W * 0.575, hh = 2.55;
card(s2, hx, hy, hw, hh);
s2.addText('Metro depth', { x: hx + 0.22, y: hy + 0.14, w: 3, h: 0.24, fontFace: F, fontSize: 13, bold: true, color: INK9, isTextBox: true, margin: 0 });
s2.addText('providers within reach of a pincode', { x: hx + hw - 3.2, y: hy + 0.17, w: 3, h: 0.2, fontFace: F, fontSize: 9, color: INK4, align: 'right', isTextBox: true, margin: 0 });

const heatRows = [[{ text: '', options: { fill: { color: WHITE } } },
  ...METROS.map((m) => ({ text: m, options: { align: 'center', fontSize: 8, color: INK5, fill: { color: WHITE } } }))]];
HEAT.forEach(([name, ds]) => {
  heatRows.push([{ text: name, options: { fontSize: 10, color: INK7, fill: { color: WHITE } } },
    ...ds.map((d) => {
      const b = band(d);
      return { text: d >= 10 ? String(Math.round(d)) : d.toFixed(1),
               options: { align: 'center', bold: true, fontSize: 10, color: b.text, fill: { color: b.fill } } };
    })]);
});
const mcw = (hw - 0.44 - 2.15) / 6;
s2.addTable(heatRows, { x: hx + 0.22, y: hy + 0.5, w: hw - 0.44, colW: [2.15, mcw, mcw, mcw, mcw, mcw, mcw],
  rowH: 0.34, fontFace: F, valign: 'middle', border: [{ pt: 1.5, color: WHITE }], margin: [1, 3, 1, 3] });
s2.addText('A 20 km catchment in Hyderabad contains ~151 centres. Wide reach, not walking distance.',
  { x: hx + 0.22, y: hy + hh - 0.42, w: hw - 0.44, h: 0.3, fontFace: F, fontSize: 8.5, color: INK4, isTextBox: true, margin: 0 });

const zx = M + hw + 0.25, zw = W - hw - 0.25, zy = hy, zh = hh;
card(s2, zx, zy, zw, zh);
s2.addText('Zonal balance', { x: zx + 0.22, y: zy + 0.14, w: 3, h: 0.24, fontFace: F, fontSize: 13, bold: true, color: INK9, isTextBox: true, margin: 0 });
let lx = zx + 0.22;
Object.entries(ZONE).forEach(([n, c]) => {
  s2.addShape(pres.ShapeType.roundRect, { x: lx, y: zy + 0.5, w: 0.11, h: 0.11, rectRadius: 0.02, fill: { color: c }, line: { color: c, width: 0 } });
  s2.addText(n, { x: lx + 0.16, y: zy + 0.44, w: 0.8, h: 0.22, fontFace: F, fontSize: 9, color: INK6, isTextBox: true, margin: 0 });
  lx += 0.95;
});
const BARS = [
  ['Where demand is',        [57, 18, 21, 3],  true],
  ['Centre visit',           [33, 21, 25, 21], false],
  ['Home sample collection', [32, 20, 25, 23], false],
  ['PPMC network',           [75, 11, 9, 5],   false],
];
const barW = zw - 0.44;
BARS.forEach((b, i) => {
  const y = zy + 0.78 + i * 0.44;
  s2.addText(b[0], { x: zx + 0.22, y, w: 3, h: 0.18, fontFace: F, fontSize: 9.5, bold: b[2], color: b[2] ? INK9 : INK7, isTextBox: true, margin: 0 });
  let bx = zx + 0.22;
  Object.values(ZONE).forEach((c, j) => {
    const seg = (b[1][j] / 100) * barW;
    s2.addShape(pres.ShapeType.roundRect, { x: bx, y: y + 0.2, w: Math.max(seg - 0.02, 0.02), h: 0.15, rectRadius: 0.02, fill: { color: c }, line: { color: c, width: 0 } });
    bx += seg;
  });
});
s2.addText('Serviceability is spread evenly across the country. Demand is not — 57% of orders come from the South, 3% from the East.',
  { x: zx + 0.22, y: zy + zh - 0.5, w: zw - 0.44, h: 0.4, fontFace: F, fontSize: 8.5, color: INK4, isTextBox: true, margin: 0 });

const mx = M, my = hy + hh + 0.25, mh = 1.35;
card(s2, mx, my, W, mh);
s2.addText('Service mix', { x: mx + 0.22, y: my + 0.13, w: 3, h: 0.24, fontFace: F, fontSize: 13, bold: true, color: INK9, isTextBox: true, margin: 0 });
s2.addText('radiology is visible only through the facilities record, pathology through the test catalogue',
  { x: mx + 1.6, y: my + 0.16, w: 6.5, h: 0.2, fontFace: F, fontSize: 9, color: INK4, isTextBox: true, margin: 0 });
const MIX = [
  ['Centre visit', [['Neither recorded', 1866, INK3], ['Pathology only', 127, '8FAFEF'], ['Radiology only', 127, '5581E4'], ['Radiology + pathology', 11, BRAND]]],
  ['PPMC network', [['Neither recorded', 15, INK3], ['Radiology only', 26, '5581E4'], ['Radiology + pathology', 1, BRAND]]],
];
MIX.forEach((m, i) => {
  const y = my + 0.5 + i * 0.4;
  const total = m[1].reduce((a, b) => a + b[1], 0);
  s2.addText(m[0], { x: mx + 0.22, y, w: 1.6, h: 0.2, fontFace: F, fontSize: 10, color: INK7, isTextBox: true, margin: 0 });
  let bx = mx + 1.9; const bw = W - 2.4;
  m[1].forEach(([lab, n, col]) => {
    const seg = (n / total) * bw;
    s2.addShape(pres.ShapeType.roundRect, { x: bx, y: y + 0.02, w: Math.max(seg - 0.02, 0.02), h: 0.17, rectRadius: 0.02, fill: { color: col }, line: { color: col, width: 0 } });
    if (seg > 1.1) s2.addText(lab + '  ' + n, { x: bx, y: y + 0.02, w: seg, h: 0.17, fontFace: F, fontSize: 8, bold: true, color: col === INK3 ? INK6 : WHITE, align: 'center', valign: 'middle', isTextBox: true, margin: 0 });
    bx += seg;
  });
});
s2.addText('88% of centres have no service record — the radiology / pathology split is knowable for about one lab in eight.',
  { x: mx + 0.22, y: my + mh - 0.32, w: W - 0.44, h: 0.24, fontFace: F, fontSize: 8.5, color: RED, isTextBox: true, margin: 0 });
s2.addNotes('Zonal bars are each thread’s share of its own reach, read against the demand bar at the top.');

/* ─────────────────────────────── SLIDE 3 ─────────────────────────────── */
const s3 = pres.addSlide();
head(s3, 'The doctor panel',
     'Serves both teleconsult and in-clinic. Covered by speciality and by hour, since it has no geography.');
const STATS = [
  ['Doctors', '1,076', '+202', 'on the panel · 909 with a pincode', GREEN],
  ['Specialities', '232', '+83', 'names carry spelling variants', GREEN],
  ['Languages', '16', '—', 'none added this month', INK3],
  ['Online consults', '129', '90d', 'the rest of the panel is in-clinic', INK4],
];
const sw = (W - 0.6) / 4;
STATS.forEach((st, i) => {
  const x = M + i * (sw + 0.2), y = 1.25, h = 1.05;
  card(s3, x, y, sw, h);
  s3.addText(st[0].toUpperCase(), { x: x + 0.2, y: y + 0.12, w: sw - 0.4, h: 0.2, fontFace: F, fontSize: 8, bold: true, color: INK5, charSpacing: 0.6, isTextBox: true, margin: 0 });
  s3.addText([{ text: st[1], options: { fontSize: 24, bold: true, color: INK9 } },
              { text: '  ' + st[2], options: { fontSize: 12, bold: true, color: st[4] } }],
    { x: x + 0.2, y: y + 0.33, w: sw - 0.4, h: 0.38, fontFace: F, isTextBox: true, margin: 0 });
  s3.addText(st[3], { x: x + 0.2, y: y + 0.75, w: sw - 0.4, h: 0.22, fontFace: F, fontSize: 8.5, color: INK4, isTextBox: true, margin: 0 });
});

const SPEC = [
  ['General physician', 108, 25, [4,5,6,6,7,7,9,11,18,32,42,48,44,37,36,35,31,40,47,44,35,21,13,1]],
  ['Internal medicine',  63, 21, [0,1,1,0,0,1,2,4,3,17,29,32,29,25,22,19,17,11,9,3,1,0,0,0]],
  ['ENT',                53, 12, [0,0,0,0,0,1,1,4,6,13,19,20,20,24,25,18,17,19,18,10,4,1,0,0]],
  ['Cardiology',         37,  7, [0,0,0,0,0,0,1,1,0,5,18,21,20,16,20,17,6,4,5,3,0,0,0,0]],
  ['Paediatrics',        33, 14, [0,0,0,0,0,1,2,2,8,16,13,13,11,10,8,11,13,10,8,2,2,1,0,0]],
  ['Dermatology',        30,  8, [0,0,0,0,0,0,0,0,2,6,15,16,12,10,9,9,8,6,3,1,0,0,0,1]],
  ['Obstetrics & gynae', 30,  0, [0,0,0,0,0,0,0,1,2,15,18,18,15,13,12,15,11,10,5,0,0,0,0,0]],
  ['Urology',            29,  6, [0,0,0,0,0,0,0,0,2,11,14,15,12,11,15,12,10,10,1,0,0,0,0,0]],
  ['Ophthalmology',      27, 13, [0,0,0,0,0,0,0,0,2,8,11,10,11,9,9,12,8,6,1,0,0,0,0,0]],
];
function hband(v) {
  if (!v) return { fill: INK1, text: INK1 };
  const f = v / 48;
  if (f < 0.12) return { fill: 'E4ECFC', text: '1D40AF' };
  if (f < 0.28) return { fill: 'C2D5F7', text: '1D40AF' };
  if (f < 0.5)  return { fill: '8FAFEF', text: '1D40AF' };
  if (f < 0.75) return { fill: '5581E4', text: WHITE };
  return { fill: BRAND, text: WHITE };
}
const gy = 2.55, gh = 4.0;
card(s3, M, gy, W, gh);
s3.addText('Doctors online by hour', { x: M + 0.22, y: gy + 0.13, w: 4, h: 0.24, fontFace: F, fontSize: 13, bold: true, color: INK9, isTextBox: true, margin: 0 });
s3.addText('top nine specialities by headcount · IST', { x: M + W - 3.6, y: gy + 0.16, w: 3.4, h: 0.2, fontFace: F, fontSize: 9, color: INK4, align: 'right', isTextBox: true, margin: 0 });

const specRows = [[
  { text: 'Speciality', options: { fontSize: 8, bold: true, color: INK4, fill: { color: WHITE } } },
  { text: 'Docs', options: { fontSize: 8, bold: true, color: INK4, align: 'right', fill: { color: WHITE } } },
  ...Array.from({ length: 24 }, (_, h) => ({
    text: String(h).padStart(2, '0'),
    options: { fontSize: 7, color: INK4, align: 'center', fill: { color: WHITE } } })),
]];
SPEC.forEach(([name, n, add, hrs]) => {
  specRows.push([
    { text: name, options: { fontSize: 9.5, color: INK7, fill: { color: WHITE } } },
    { text: String(n) + (add ? ' +' + add : ''), options: { fontSize: 8, color: add ? GREEN : INK4, align: 'right', fill: { color: WHITE } } },
    ...hrs.map((v) => {
      const b = hband(v);
      return { text: v ? String(v) : '', options: { fontSize: 7.5, bold: true, color: b.text, align: 'center', fill: { color: b.fill } } };
    }),
  ]);
});
const hcw = (W - 0.44 - 2.1) / 24;
s3.addTable(specRows, { x: M + 0.22, y: gy + 0.48, w: W - 0.44,
  colW: [1.55, 0.55, ...Array(24).fill(hcw)], rowH: 0.31,
  fontFace: F, valign: 'middle', border: [{ pt: 1.2, color: WHITE }], margin: [1, 1, 1, 1] });
s3.addText('Only general physicians cover the night; every other speciality starts at 07:00 or later.',
  { x: M + 0.22, y: gy + gh - 0.38, w: W - 0.44, h: 0.26, fontFace: F, fontSize: 9, color: INK6, isTextBox: true, margin: 0 });
s3.addNotes('232 specialities is inflated by spelling variants (Orthopaedics / Orthopedics) — worth a cleanup.');

pres.writeFile({ fileName: 'provider-network.pptx' }).then(() => console.log('written'));
