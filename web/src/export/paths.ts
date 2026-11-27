/**
 * SVG path data to absolute segments (move, line, cubic, close). Quadratics and arcs become cubics,
 * so the PDF and canvas back ends only know four operations. Pure.
 */

/** Flat segment list: 'M' x y, 'L' x y, 'C' x1 y1 x2 y2 x y, 'Z'. Numbers follow the letter. */
export type Seg =
  | readonly ['M', number, number]
  | readonly ['L', number, number]
  | readonly ['C', number, number, number, number, number, number]
  | readonly ['Z'];

const TOKEN = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)/gi;
const ARGS: Record<string, number> = {
  m: 2,
  l: 2,
  h: 1,
  v: 1,
  c: 6,
  s: 4,
  q: 4,
  t: 2,
  a: 7,
  z: 0,
};

/** Parses path data. Returns the segments, or `undefined` when the data is malformed. */
export function parsePath(d: string): Seg[] | undefined {
  const tokens: (string | number)[] = [];
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  let consumed = 0;
  while ((m = TOKEN.exec(d))) {
    if (d.slice(consumed, m.index).trim().replace(/,/g, '') !== '') return undefined;
    consumed = TOKEN.lastIndex;
    tokens.push(m[1] ?? Number(m[2]));
  }
  if (d.slice(consumed).trim() !== '') return undefined;

  const out: Seg[] = [];
  let i = 0;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  // Last control point, for the smooth commands S and T.
  let lcx = 0;
  let lcy = 0;
  let prev = '';
  let cmd = '';
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (typeof t === 'string') {
      cmd = t;
      i++;
      if (cmd === 'z' || cmd === 'Z') {
        out.push(['Z']);
        cx = sx;
        cy = sy;
        prev = 'z';
        continue;
      }
    } else if (cmd === '' || cmd === 'z' || cmd === 'Z') {
      return undefined;
    }
    const n = ARGS[cmd.toLowerCase()]!;
    const a: number[] = [];
    for (let k = 0; k < n; k++) {
      const v = tokens[i++];
      if (typeof v !== 'number') return undefined;
      a.push(v);
    }
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? cx : 0;
    const oy = rel ? cy : 0;
    switch (cmd.toLowerCase()) {
      case 'm': {
        cx = a[0]! + ox;
        cy = a[1]! + oy;
        sx = cx;
        sy = cy;
        out.push(['M', cx, cy]);
        // Further pairs after a move are implicit line-tos.
        cmd = rel ? 'l' : 'L';
        prev = 'm';
        break;
      }
      case 'l':
        cx = a[0]! + ox;
        cy = a[1]! + oy;
        out.push(['L', cx, cy]);
        prev = 'l';
        break;
      case 'h':
        cx = a[0]! + ox;
        out.push(['L', cx, cy]);
        prev = 'l';
        break;
      case 'v':
        cy = a[0]! + oy;
        out.push(['L', cx, cy]);
        prev = 'l';
        break;
      case 'c': {
        const x1 = a[0]! + ox;
        const y1 = a[1]! + oy;
        const x2 = a[2]! + ox;
        const y2 = a[3]! + oy;
        out.push(['C', x1, y1, x2, y2, (cx = a[4]! + ox), (cy = a[5]! + oy)]);
        lcx = x2;
        lcy = y2;
        prev = 'c';
        break;
      }
      case 's': {
        const x1 = prev === 'c' ? 2 * cx - lcx : cx;
        const y1 = prev === 'c' ? 2 * cy - lcy : cy;
        const x2 = a[0]! + ox;
        const y2 = a[1]! + oy;
        out.push(['C', x1, y1, x2, y2, (cx = a[2]! + ox), (cy = a[3]! + oy)]);
        lcx = x2;
        lcy = y2;
        prev = 'c';
        break;
      }
      case 'q': {
        const qx = a[0]! + ox;
        const qy = a[1]! + oy;
        const x = a[2]! + ox;
        const y = a[3]! + oy;
        out.push(quad(cx, cy, qx, qy, x, y));
        cx = x;
        cy = y;
        lcx = qx;
        lcy = qy;
        prev = 'q';
        break;
      }
      case 't': {
        const qx = prev === 'q' ? 2 * cx - lcx : cx;
        const qy = prev === 'q' ? 2 * cy - lcy : cy;
        const x = a[0]! + ox;
        const y = a[1]! + oy;
        out.push(quad(cx, cy, qx, qy, x, y));
        cx = x;
        cy = y;
        lcx = qx;
        lcy = qy;
        prev = 'q';
        break;
      }
      case 'a': {
        const x = a[5]! + ox;
        const y = a[6]! + oy;
        arc(out, cx, cy, a[0]!, a[1]!, a[2]!, a[3]! !== 0, a[4]! !== 0, x, y);
        cx = x;
        cy = y;
        prev = 'a';
        break;
      }
    }
  }
  return out;
}

function quad(x0: number, y0: number, qx: number, qy: number, x: number, y: number): Seg {
  return [
    'C',
    x0 + (2 / 3) * (qx - x0),
    y0 + (2 / 3) * (qy - y0),
    x + (2 / 3) * (qx - x),
    y + (2 / 3) * (qy - y),
    x,
    y,
  ];
}

/** Elliptical arc to cubic béziers (SVG implementation notes, F.6.5 then one cubic per 90 degrees). */
function arc(
  out: Seg[],
  x0: number,
  y0: number,
  rxIn: number,
  ryIn: number,
  rotation: number,
  large: boolean,
  sweep: boolean,
  x: number,
  y: number,
): void {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) {
    out.push(['L', x, y]);
    return;
  }
  if (x0 === x && y0 === y) return;
  const phi = (rotation * Math.PI) / 180;
  const cosP = Math.cos(phi);
  const sinP = Math.sin(phi);
  const dx = (x0 - x) / 2;
  const dy = (y0 - y) / 2;
  const x1p = cosP * dx + sinP * dy;
  const y1p = -sinP * dx + cosP * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (k * rx * y1p) / ry;
  const cyp = (-k * ry * x1p) / rx;
  const ccx = cosP * cxp - sinP * cyp + (x0 + x) / 2;
  const ccy = sinP * cxp + cosP * cyp + (y0 + y) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) =>
    Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  const parts = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9));
  const step = delta / parts;
  const t = (4 / 3) * Math.tan(step / 4);
  const point = (a: number) => {
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    return [
      ccx + rx * ca * cosP - ry * sa * sinP,
      ccy + rx * ca * sinP + ry * sa * cosP,
      -rx * sa * cosP - ry * ca * sinP,
      -rx * sa * sinP + ry * ca * cosP,
    ] as const;
  };
  let a = theta1;
  for (let i = 0; i < parts; i++) {
    const [px, py, dpx, dpy] = point(a);
    const [qx, qy, dqx, dqy] = point(a + step);
    out.push([
      'C',
      px + t * dpx,
      py + t * dpy,
      qx - t * dqx,
      qy - t * dqy,
      i === parts - 1 ? x : qx,
      i === parts - 1 ? y : qy,
    ]);
    a += step;
  }
}

/** Applies an affine matrix `[a b c d e f]` (SVG order) to segments. */
export function transformSegs(segs: readonly Seg[], m: readonly number[]): Seg[] {
  const [a, b, c, d, e, f] = m as [number, number, number, number, number, number];
  const px = (x: number, y: number) => a * x + c * y + e;
  const py = (x: number, y: number) => b * x + d * y + f;
  return segs.map((s): Seg => {
    switch (s[0]) {
      case 'M':
      case 'L':
        return [s[0], px(s[1], s[2]), py(s[1], s[2])];
      case 'C':
        return [
          'C',
          px(s[1], s[2]),
          py(s[1], s[2]),
          px(s[3], s[4]),
          py(s[3], s[4]),
          px(s[5], s[6]),
          py(s[5], s[6]),
        ];
      case 'Z':
        return s;
    }
  });
}
