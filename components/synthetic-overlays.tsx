import type { ReactNode } from 'react';

/**
 * Static film-grain and scanline overlays.
 *
 * Server-rendered because they never change. The grain is a tiled background
 * image rather than a live SVG filter: rasterising fractal noise over the whole
 * viewport on every composite was the heaviest part of the page, and a fixed
 * tile looks the same while costing the compositor almost nothing.
 */
export function SyntheticOverlays(): ReactNode {
  return (
    <>
      <div className="synthetic-grain" aria-hidden="true" />
      <div className="synthetic-scanlines" aria-hidden="true" />
      <div className="synthetic-vignette" aria-hidden="true" />
    </>
  );
}
