/**
 * Basemap tiles, in one place so the two maps can't drift apart.
 *
 * CARTO for both themes, deliberately. OpenStreetMap's standard raster layer
 * labels places in the local script — Devanagari, Chinese, Arabic, Korean,
 * Bengali — which made the same map read differently depending on where you
 * panned. CARTO's Positron and Dark Matter use Latin labels throughout, so a
 * network map of India stays legible to everyone looking at it.
 *
 * `{r}` resolves to "@2x" on retina displays; leaflet fills it in.
 */

export const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> ' +
  '&copy; <a href="https://carto.com/attributions">CARTO</a>';

export const TILE_URL_LIGHT = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
export const TILE_URL_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

export const tileUrlFor = (isDark: boolean) => (isDark ? TILE_URL_DARK : TILE_URL_LIGHT);
