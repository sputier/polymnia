/**
 * PNG back end: draws a page (items in points) on a canvas with white paper and black ink, at 2x
 * the CSS pixel size of the page (96 dpi x 2 = 192 dpi). Music glyphs are already paths, so no font
 * has to be loaded and no SVG-as-image round trip (which the CSP forbids for blobs) is needed.
 */
import type { Page } from './pages';
import type { Seg } from './paths';

/** CSS pixels per point. */
const PX_PER_PT = 96 / 72;
export const PNG_SCALE = 2;

function toPath2D(segs: readonly Seg[]): Path2D {
  const path = new Path2D();
  for (const s of segs) {
    switch (s[0]) {
      case 'M':
        path.moveTo(s[1], s[2]);
        break;
      case 'L':
        path.lineTo(s[1], s[2]);
        break;
      case 'C':
        path.bezierCurveTo(s[1], s[2], s[3], s[4], s[5], s[6]);
        break;
      case 'Z':
        path.closePath();
        break;
    }
  }
  return path;
}

/** Draws `page` on an existing 2D context sized for it (scale applied here). */
export function drawPage(ctx: CanvasRenderingContext2D, page: Page, scale: number): void {
  const k = scale * PX_PER_PT;
  ctx.save();
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, page.width, page.height);
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const item of page.items) {
    if (item.kind === 'path') {
      const path = toPath2D(item.segs);
      if (item.fill) ctx.fill(path);
      if (item.stroke) {
        ctx.lineWidth = Math.max(item.lineWidth, 0.05);
        ctx.setLineDash([...item.dash]);
        ctx.stroke(path);
      }
    } else {
      ctx.font = `${item.size}px Helvetica, Arial, sans-serif`;
      ctx.textAlign = item.align === 'middle' ? 'center' : item.align === 'end' ? 'right' : 'left';
      ctx.fillText(item.text, item.x, item.y);
    }
  }
  ctx.restore();
}

/** Renders one page to PNG bytes. */
export async function renderPng(page: Page, scale = PNG_SCALE): Promise<Uint8Array<ArrayBuffer>> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(page.width * PX_PER_PT * scale);
  canvas.height = Math.round(page.height * PX_PER_PT * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas-unavailable');
  drawPage(ctx, page, scale);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  // Release the pixel buffer early: a long score would otherwise hold one canvas per page.
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) throw new Error('png-encode-failed');
  return new Uint8Array(await blob.arrayBuffer());
}
