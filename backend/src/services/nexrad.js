import zlib from 'node:zlib';
import Bzip from 'seek-bzip';
import { withCache } from '../lib/cache.js';
import { request } from '../lib/http.js';

/**
 * NEXRAD LEVEL III, STRAIGHT FROM NOAA'S OPEN DATA BUCKET
 *
 * The station's own radar rather than a third-party mosaic. Unidata publishes
 * every WSR-88D Level III product to a public S3 bucket within seconds of the
 * volume scan completing, with no credentials and no API key.
 *
 *   arn:aws:s3:::unidata-nexrad-level3   (us-east-1, no credentials)
 *   s3://unidata-nexrad-level3  ->  https://unidata-nexrad-level3.s3.amazonaws.com
 *
 * The HTTPS form is the same anonymous read as `aws s3 --no-sign-request`:
 * the bucket is public, so nothing here signs a request or holds a key.
 *
 * Keys are flat and sorted: SITE_PRODUCT_YYYY_MM_DD_HH_MM_SS, where SITE is
 * the three-letter id (KOHX is filed as OHX). Because the list is
 * lexicographic, the newest scan is simply the last key under today's prefix.
 *
 * The pipeline here is: list -> fetch -> decode -> rasterise to PNG. The
 * browser gets a finished image positioned by its geographic bounds, so no
 * radar decoding ever has to happen on a phone.
 */

const BUCKET = 'https://unidata-nexrad-level3.s3.amazonaws.com';

/** Level III products worth putting on air, with how each one reads. */
export const NEXRAD_PRODUCTS = {
  N0B: {
    id: 'N0B',
    name: 'Base Reflectivity',
    short: 'REF',
    units: 'dBZ',
    rangeKm: 460,
    description: 'Super-resolution 0.5° base reflectivity, straight off the WSR-88D.',
    palette: 'reflectivity',
  },
  // Storm-relative velocity rather than base velocity. KOHX has not published
  // N0U or N0V in years, so the old entry offered viewers a product that could
  // only ever 404; N0S arrives with every scan. It is a 16-level legacy
  // product, which is why the parser learned the older symbology packet.
  N0S: {
    id: 'N0S',
    name: 'Storm Relative Velocity',
    short: 'SRV',
    units: 'kt',
    rangeKm: 230,
    description: 'Storm-relative 0.5° velocity. Green is inbound, red outbound; rotation shows as a tight green-red couplet.',
    palette: 'velocity',
  },
  N0C: {
    id: 'N0C',
    name: 'Correlation Coefficient',
    short: 'CC',
    units: '',
    rangeKm: 300,
    description: 'Dual-pol correlation. Low values inside a storm can mean debris.',
    palette: 'cc',
  },
  N0X: {
    id: 'N0X',
    name: 'Differential Reflectivity',
    short: 'ZDR',
    units: 'dB',
    rangeKm: 300,
    description: 'Dual-pol ZDR: drop shape, useful for hail and debris signatures.',
    palette: 'zdr',
  },
};

/** KOHX is filed in the bucket as OHX. */
const siteKey = (site) => String(site || '').toUpperCase().replace(/^K/, '').slice(0, 3);

const pad = (n) => String(n).padStart(2, '0');
const datePrefix = (d) => `${d.getUTCFullYear()}_${pad(d.getUTCMonth() + 1)}_${pad(d.getUTCDate())}`;

/* --------------------------------------------------------------- listing */

async function listKeys(prefix) {
  const url = `${BUCKET}/?list-type=2&prefix=${encodeURIComponent(prefix)}&max-keys=1000`;
  const xml = await request(url, { timeout: 12000, retries: 1, accept: 'application/xml' }).then((r) => r.text());
  const keys = [];
  const re = /<Key>([^<]+)<\/Key>/g;
  let match = re.exec(xml);
  while (match) {
    keys.push(match[1]);
    match = re.exec(xml);
  }
  return keys;
}

/**
 * The newest scan for a site. Just after midnight UTC today's prefix is empty,
 * so yesterday is checked as well rather than the radar going blank for a few
 * minutes every night.
 */
export async function latestKey(site, product = 'N0B') {
  const base = `${siteKey(site)}_${product}_`;
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86400000);

  for (const day of [now, yesterday]) {
    const keys = await listKeys(`${base}${datePrefix(day)}`);
    if (keys.length) return keys[keys.length - 1];
  }
  return null;
}

/* ----------------------------------------------------------------- parse */

/**
 * Read one Level III product.
 *
 * Layout: a WMO text header, an 18-byte message header, a 102-byte product
 * description block, then a bzip2-compressed product symbology block.
 *
 * Two symbology packets appear in the products worth putting on air. The
 * dual-pol and super-resolution products carry packet 16, a "digital radial
 * data array" of one byte per gate. The older 16-level products - storm
 * relative velocity among them - carry packet AF1F, where each radial is
 * run-length coded into nibble pairs and the sixteen levels mean whatever the
 * product's own threshold table says they mean.
 */
/**
 * The sixteen data levels of a legacy product, in the product's own units.
 *
 * Each threshold halfword carries a magnitude in its low byte and flags in its
 * high byte: 0x80 marks a coded level with no number behind it (below
 * threshold, range folded), and the low bits carry the sign, so a velocity
 * product reads as -64 kt through 0 to +64 kt. A coded level comes back NaN,
 * which is how the rest of the pipeline knows to draw nothing there.
 */
function thresholdLevels(buffer, pdb) {
  const levels = new Float32Array(16);
  for (let i = 0; i < 16; i += 1) {
    const raw = buffer.readUInt16BE(pdb + (31 + i - 10) * 2);
    const flags = raw >> 8;
    const magnitude = raw & 0xff;
    levels[i] = flags & 0x80 ? NaN : (flags & 0x01 ? -magnitude : magnitude);
  }
  return levels;
}

export function parseLevel3(buffer) {
  // The text header ends at the second CR CR LF.
  const marker = Buffer.from([0x0d, 0x0d, 0x0a]);
  let msg = 0;
  for (let i = 0; i < 2; i += 1) {
    const at = buffer.indexOf(marker, msg);
    if (at === -1) throw new Error('Not a Level III product: no WMO header');
    msg = at + marker.length;
  }

  const pdb = msg + 18;
  if (buffer.readInt16BE(pdb) !== -1) throw new Error('Bad product description block');

  // Halfword N of the message lives at pdb + (N - 10) * 2.
  const hw = (n) => buffer.readInt16BE(pdb + (n - 10) * 2);
  const hw32 = (n) => buffer.readInt32BE(pdb + (n - 10) * 2);

  const latitude = buffer.readInt32BE(pdb + 2) / 1000;
  const longitude = buffer.readInt32BE(pdb + 6) / 1000;
  const productCode = hw(16);
  const elevationAngle = hw(30) / 10;

  // Calibration is carried in the product itself rather than assumed:
  // minimum value, the step between levels, and how many levels there are.
  const minimum = hw(31) / 10;
  const increment = hw(32) / 10;
  const levelCount = hw(33);

  // Volume scan date is days since 1970-01-01; time is seconds into that day.
  const scanDate = hw(21);
  const scanSeconds = hw32(22);
  const timestamp = new Date((scanDate - 1) * 86400000 + scanSeconds * 1000).toISOString();

  // Everything past the description block is bzip2-compressed for these
  // products; the offset is fixed because the two headers are fixed width.
  const payload = buffer.subarray(pdb + 102);
  const symbology = payload.subarray(0, 3).toString('latin1') === 'BZh' ? Bzip.decode(payload) : payload;

  if (symbology.readInt16BE(0) !== -1 || symbology.readInt16BE(2) !== 1) {
    throw new Error('Bad product symbology block');
  }

  let p = 16;
  const packetCode = symbology.readUInt16BE(p);
  if (packetCode !== 16 && packetCode !== 0xaf1f) {
    throw new Error(`Unsupported symbology packet 0x${packetCode.toString(16)}`);
  }

  const firstBin = symbology.readInt16BE(p + 2);
  const binCount = symbology.readInt16BE(p + 4);
  // Packet AF1F states its own gate size, in thousandths of a kilometre.
  const gateKm = packetCode === 0xaf1f ? symbology.readInt16BE(p + 10) / 1000 : null;
  const radialCount = symbology.readInt16BE(p + 12);
  p += 14;

  const azimuths = new Float32Array(radialCount);
  const widths = new Float32Array(radialCount);
  const gates = new Uint8Array(radialCount * binCount);

  for (let r = 0; r < radialCount; r += 1) {
    const size = symbology.readInt16BE(p);
    azimuths[r] = symbology.readInt16BE(p + 2) / 10;
    widths[r] = symbology.readInt16BE(p + 4) / 10;
    p += 6;

    if (packetCode === 16) {
      gates.set(symbology.subarray(p, p + Math.min(size, binCount)), r * binCount);
      p += size;
    } else {
      // Run length coded: the size is in halfwords, and each byte is a run
      // length in its high nibble and a data level in its low nibble.
      const end = p + size * 2;
      let bin = 0;
      for (let at = p; at < end && bin < binCount; at += 1) {
        const byte = symbology[at];
        const level = byte & 0x0f;
        const run = Math.min(byte >> 4, binCount - bin);
        gates.fill(level, r * binCount + bin, r * binCount + bin + run);
        bin += run;
      }
      p = end;
    }
  }

  return {
    productCode,
    latitude,
    longitude,
    elevationAngle,
    timestamp,
    minimum,
    increment,
    levelCount,
    // A legacy product's levels are a lookup rather than a straight line.
    levels: packetCode === 0xaf1f ? thresholdLevels(buffer, pdb) : null,
    gateKm,
    firstBin,
    binCount,
    radialCount,
    azimuths,
    widths,
    gates,
  };
}

/**
 * Drop isolated gates.
 *
 * A WSR-88D in clear air returns a haze of single-gate specks - insects,
 * birds, ground clutter - that are real echoes but not weather. Requiring a
 * gate to have neighbours is the standard speckle filter: precipitation is
 * spatially coherent, noise is not.
 */
function despeckle(sweep, minNeighbours = 3) {
  const { gates, binCount, radialCount } = sweep;
  const cleaned = new Uint8Array(gates.length);

  for (let r = 0; r < radialCount; r += 1) {
    // Azimuth wraps, so the radial before 0 is the last one.
    const rPrev = (r - 1 + radialCount) % radialCount;
    const rNext = (r + 1) % radialCount;

    for (let g = 0; g < binCount; g += 1) {
      const at = r * binCount + g;
      if (!hasReading(sweep, gates[at])) continue;

      let neighbours = 0;
      for (const rr of [rPrev, r, rNext]) {
        for (let dg = -1; dg <= 1; dg += 1) {
          const gg = g + dg;
          if (gg < 0 || gg >= binCount) continue;
          if (rr === r && dg === 0) continue;
          if (hasReading(sweep, gates[rr * binCount + gg])) neighbours += 1;
        }
      }

      if (neighbours >= minNeighbours) cleaned[at] = gates[at];
    }
  }

  return cleaned;
}

/** Turn a stored level into the product's real units. */
export const levelToValue = (sweep, level) =>
  sweep.levels ? sweep.levels[level] : sweep.minimum + (level - 2) * sweep.increment;

/**
 * Is there a reading at this level, or is it one of the codes?
 *
 * A digital product reserves 0 and 1 for below-threshold and range-folded. A
 * legacy product says so in its threshold table instead, and it matters: level
 * 1 of a velocity product is 64 knots inbound, not empty sky.
 */
const hasReading = (sweep, level) =>
  sweep.levels ? level < 16 && Number.isFinite(sweep.levels[level]) : level >= 2;

/* --------------------------------------------------------------- palettes */

/** Stops are [value, r, g, b]; colours interpolate between them. */
const PALETTES = {
  // Floor at 10 dBZ. Below that a WSR-88D is mostly seeing insects, birds and
  // ground clutter - real returns, but not weather, and showing them paints a
  // clear evening blue.
  reflectivity: [
    [10, 4, 233, 231], [15, 1, 159, 244], [20, 3, 0, 244], [25, 2, 253, 2],
    [30, 1, 197, 1], [35, 0, 142, 0], [40, 253, 248, 2], [45, 229, 188, 0],
    [50, 253, 149, 0], [55, 253, 0, 0], [60, 212, 0, 0], [65, 188, 0, 0],
    [70, 248, 0, 253], [75, 152, 84, 198], [85, 253, 253, 253],
  ],
  velocity: [
    [-64, 0, 224, 224], [-40, 0, 160, 160], [-20, 0, 112, 0], [-10, 0, 200, 0],
    [-1, 190, 255, 190], [1, 255, 190, 190], [10, 220, 0, 0], [20, 160, 0, 0],
    [40, 224, 120, 0], [64, 255, 200, 0],
  ],
  cc: [
    [0.2, 40, 40, 120], [0.6, 0, 140, 200], [0.8, 0, 200, 120], [0.9, 220, 220, 0],
    [0.95, 250, 150, 0], [1.0, 250, 40, 40],
  ],
  zdr: [
    [-4, 90, 90, 180], [-1, 0, 150, 200], [0, 120, 200, 120], [1, 240, 240, 80],
    [3, 250, 150, 0], [6, 240, 40, 40], [8, 250, 250, 250],
  ],
};

/** The colour for a value in the product's units, or null below the floor. */
function paletteColour(stops, value) {
  if (value < stops[0][0]) return null;

  let colour = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i += 1) {
    const [v0, r0, g0, b0] = stops[i];
    const [v1, r1, g1, b1] = stops[i + 1];
    if (value >= v0 && value <= v1) {
      const t = v1 === v0 ? 0 : (value - v0) / (v1 - v0);
      return [r0 + (r1 - r0) * t, g0 + (g1 - g0) * t, b0 + (b1 - b0) * t];
    }
  }
  return [colour[1], colour[2], colour[3]];
}

/**
 * A fine ramp through the palette, indexed by value rather than by data level.
 *
 * Painting straight from the sixteen or so data levels is what makes a sweep
 * look like a mosaic of coloured tiles. Interpolating the value first and then
 * reading a ramp gives the continuous wash a viewer expects, and it costs one
 * table read per pixel either way.
 */
function buildRamp(paletteName, steps = 1024) {
  const stops = PALETTES[paletteName] ?? PALETTES.reflectivity;
  const min = stops[0][0];
  const max = stops[stops.length - 1][0];
  const table = new Uint8Array(steps * 4);

  for (let i = 0; i < steps; i += 1) {
    const colour = paletteColour(stops, min + ((max - min) * i) / (steps - 1));
    if (!colour) continue;
    const at = i * 4;
    table[at] = colour[0];
    table[at + 1] = colour[1];
    table[at + 2] = colour[2];
    table[at + 3] = 255;
  }

  return { table, min, max, steps };
}

/* -------------------------------------------------------------- rasterise */

const R_EARTH_KM = 6371.0088;
const mercatorY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 180 / 2));
const inverseMercatorY = (y) => ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI;

/**
 * Paint the sweep into a Web Mercator image.
 *
 * Rendering in Mercator (rather than plain lat/lon) is what lets Leaflet place
 * the result with a simple image overlay: the map stretches the picture
 * linearly in projected space, which is exactly the space it was drawn in.
 * Each output pixel is inverse-projected and turned into a bearing and range
 * from the radar, which lands between four polar samples rather than on one.
 *
 * Those four are blended, in the product's own units rather than in colour, so
 * a boundary between two data levels comes out as a gradient instead of a
 * staircase. Only samples that carry a reading contribute, and the nearest one
 * has to carry a reading at all - otherwise echoes would bleed outward into
 * clear sky by half a gate everywhere along their edge.
 */
export function sweepExtent(sweep, rangeKm) {
  const gateKm = sweep.gateKm || (rangeKm ?? sweep.binCount * 0.25) / sweep.binCount;
  const reach = gateKm * sweep.binCount;
  const latSpan = (reach / R_EARTH_KM) * (180 / Math.PI);
  const lonSpan = latSpan / Math.cos((sweep.latitude * Math.PI) / 180);

  return {
    gateKm,
    reach,
    north: Math.min(85, sweep.latitude + latSpan),
    south: Math.max(-85, sweep.latitude - latSpan),
    west: sweep.longitude - lonSpan,
    east: sweep.longitude + lonSpan,
  };
}

/**
 * Paint one projected box. The box is given in Mercator y and plain longitude
 * because that is what both callers already have: the whole sweep works from
 * its own extent, a map tile from its z/x/y.
 */
function paint(sweep, { palette, gateKm, reach, west, east, yTop, yBottom, width, height }) {
  const ramp = buildRamp(palette);
  const rampScale = (ramp.steps - 1) / (ramp.max - ramp.min);

  // Levels resolved once, so the inner loop never calls through a closure.
  const levelValue = new Float32Array(256);
  const levelValid = new Uint8Array(256);
  for (let level = 0; level < 256; level += 1) {
    if (!hasReading(sweep, level)) continue;
    levelValid[level] = 1;
    levelValue[level] = levelToValue(sweep, level);
  }

  const rgba = Buffer.alloc(width * height * 4);
  const latRad = (sweep.latitude * Math.PI) / 180;
  const cosLat0 = Math.cos(latRad);
  const sinLat0 = Math.sin(latRad);

  const { gates, binCount, radialCount } = sweep;
  // Azimuths are a regular grid, so the radial index is direct. Both indices
  // are measured to the centre of a cell, which is where its value belongs.
  const radialStep = 360 / radialCount;
  const azimuthStart = sweep.azimuths[0];

  for (let py = 0; py < height; py += 1) {
    const y = yTop + ((yBottom - yTop) * (py + 0.5)) / height;
    const lat = inverseMercatorY(y);
    const latR = (lat * Math.PI) / 180;
    const sinLat = Math.sin(latR);
    const cosLat = Math.cos(latR);

    for (let px = 0; px < width; px += 1) {
      const lon = west + ((east - west) * (px + 0.5)) / width;
      const dLon = ((lon - sweep.longitude) * Math.PI) / 180;

      // Great-circle distance and initial bearing from the radar.
      const cosD = sinLat0 * sinLat + cosLat0 * cosLat * Math.cos(dLon);
      const distKm = Math.acos(Math.min(1, Math.max(-1, cosD))) * R_EARTH_KM;
      if (distKm > reach) continue;

      const gf = distKm / gateKm - sweep.firstBin - 0.5;
      const g0 = Math.floor(gf);
      const g1 = g0 + 1;
      if (g1 < 0 || g0 >= binCount) continue;
      const tg = gf - g0;

      let bearing =
        (Math.atan2(
          Math.sin(dLon) * cosLat,
          cosLat0 * sinLat - sinLat0 * cosLat * Math.cos(dLon),
        ) *
          180) /
        Math.PI;
      if (bearing < 0) bearing += 360;

      const rfIndex = (bearing - azimuthStart) / radialStep - 0.5;
      let r0 = Math.floor(rfIndex);
      const tr = rfIndex - r0;
      r0 = ((r0 % radialCount) + radialCount) % radialCount;
      const r1 = (r0 + 1) % radialCount;

      // The echo keeps the footprint the data gives it: the sample this pixel
      // actually falls in decides whether anything is drawn here.
      const gNear = tg < 0.5 ? g0 : g1;
      const rNear = tr < 0.5 ? r0 : r1;
      if (gNear < 0 || gNear >= binCount) continue;
      if (!levelValid[gates[rNear * binCount + gNear]]) continue;

      let sum = 0;
      let weight = 0;
      if (g0 >= 0) {
        const w = 1 - tg;
        const a = gates[r0 * binCount + g0];
        const b = gates[r1 * binCount + g0];
        if (levelValid[a]) {
          const ww = w * (1 - tr);
          sum += levelValue[a] * ww;
          weight += ww;
        }
        if (levelValid[b]) {
          const ww = w * tr;
          sum += levelValue[b] * ww;
          weight += ww;
        }
      }
      if (g1 < binCount) {
        const a = gates[r0 * binCount + g1];
        const b = gates[r1 * binCount + g1];
        if (levelValid[a]) {
          const ww = tg * (1 - tr);
          sum += levelValue[a] * ww;
          weight += ww;
        }
        if (levelValid[b]) {
          const ww = tg * tr;
          sum += levelValue[b] * ww;
          weight += ww;
        }
      }
      if (weight <= 0) continue;

      const value = sum / weight;
      if (value < ramp.min) continue;
      let index = Math.round((value - ramp.min) * rampScale);
      if (index > ramp.steps - 1) index = ramp.steps - 1;

      const at = index * 4;
      if (ramp.table[at + 3] === 0) continue;

      const out = (py * width + px) * 4;
      rgba[out] = ramp.table[at];
      rgba[out + 1] = ramp.table[at + 1];
      rgba[out + 2] = ramp.table[at + 2];
      rgba[out + 3] = ramp.table[at + 3];
    }
  }

  return rgba;
}

/** The whole sweep as one square image, the way an image overlay wants it. */
export function rasterise(sweep, { size = 2048, palette = 'reflectivity', rangeKm } = {}) {
  const extent = sweepExtent(sweep, rangeKm);
  const rgba = paint(sweep, {
    palette,
    gateKm: extent.gateKm,
    reach: extent.reach,
    west: extent.west,
    east: extent.east,
    yTop: mercatorY(extent.north),
    yBottom: mercatorY(extent.south),
    width: size,
    height: size,
  });

  return {
    rgba,
    size,
    bounds: { north: extent.north, south: extent.south, east: extent.east, west: extent.west },
  };
}

export const TILE_SIZE = 256;

/**
 * One slippy-map tile of the sweep, painted at the zoom it will be seen at.
 *
 * A single image of the whole sweep has one resolution for every zoom level,
 * so it is wasteful when the map is pulled back and soft once it is pushed in.
 * A tile is always painted for the box being looked at, so 256 pixels land
 * wherever the viewer is: the same cost per tile at every zoom.
 *
 * Returns null for a tile the sweep does not reach, which the caller answers
 * with a blank rather than painting nothing slowly.
 */
export function rasteriseTile(sweep, { z, x, y, palette = 'reflectivity', rangeKm, size = TILE_SIZE }) {
  const extent = sweepExtent(sweep, rangeKm);
  const n = 2 ** z;
  const west = (x / n) * 360 - 180;
  const east = ((x + 1) / n) * 360 - 180;
  const yTop = Math.PI * (1 - (2 * y) / n);
  const yBottom = Math.PI * (1 - (2 * (y + 1)) / n);

  // The sweep covers one square of the world; a tile clear of it is blank.
  if (east < extent.west || west > extent.east) return null;
  if (inverseMercatorY(yBottom) > extent.north || inverseMercatorY(yTop) < extent.south) return null;

  return paint(sweep, {
    palette,
    gateKm: extent.gateKm,
    reach: extent.reach,
    west,
    east,
    yTop,
    yBottom,
    width: size,
    height: size,
  });
}

/* ------------------------------------------------------------- PNG writer */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * Encode RGBA to PNG with Node's own zlib - no native image dependency, which
 * keeps this deployable anywhere Node runs.
 */
export function encodePng(rgba, width, height) {
  const stride = width * 4;
  // One filter byte per scanline; filter 0 (None) keeps the encoder simple and
  // costs little, because the alpha-heavy radar image compresses well anyway.
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ public */

/**
 * The newest sweep for a site, fetched and decoded. Cached for two minutes:
 * the radar only turns out a new volume scan every four to six, and every
 * tile of that scan reads this one decoded array rather than decoding again.
 * Concurrent callers share the work, so a screenful of tiles arriving at once
 * is one download and one decode, not thirty.
 */
export async function loadSweep(site, productId = 'N0B') {
  const product = NEXRAD_PRODUCTS[productId] ?? NEXRAD_PRODUCTS.N0B;

  return withCache(`nexrad:sweep:${siteKey(site)}:${product.id}`, 1000 * 120, async () => {
    const key = await latestKey(site, product.id);
    if (!key) {
      const error = new Error(`No recent ${product.id} scan for ${site}`);
      error.status = 404;
      throw error;
    }

    const response = await request(`${BUCKET}/${key}`, {
      timeout: 20000,
      retries: 1,
      accept: 'application/octet-stream',
    });
    const sweep = parseLevel3(Buffer.from(await response.arrayBuffer()));
    sweep.gates = despeckle(sweep);
    const extent = sweepExtent(sweep, product.rangeKm);

    return {
      sweep,
      product,
      key,
      site: String(site).toUpperCase(),
      bounds: { north: extent.north, south: extent.south, east: extent.east, west: extent.west },
      elevationAngle: sweep.elevationAngle,
      timestamp: sweep.timestamp,
      radarLat: sweep.latitude,
      radarLon: sweep.longitude,
      source: 'NOAA NEXRAD Level III via AWS Open Data',
    };
  });
}

/**
 * The whole sweep as one PNG. The map reads tiles now; this stays because it
 * is the one URL that hands somebody the entire scan as a picture.
 */
// 2048 across the sweep puts roughly two output pixels on every super-res gate.
export async function getSweepImage(site, productId = 'N0B', { size = 2048 } = {}) {
  const loaded = await loadSweep(site, productId);
  const cacheKey = `nexrad:image:${loaded.site}:${loaded.product.id}:${loaded.key}:${size}`;

  const png = await withCache(cacheKey, 1000 * 120, async () => {
    const raster = rasterise(loaded.sweep, {
      size,
      palette: loaded.product.palette,
      rangeKm: loaded.product.rangeKm,
    });
    return encodePng(raster.rgba, raster.size, raster.size);
  });

  return { ...loaded, png, productName: loaded.product.name, units: loaded.product.units };
}

/** A tile the sweep does not reach. Built once and handed out unchanged. */
let blankTile = null;

/**
 * One map tile of the newest sweep.
 *
 * Tiles are not cached: painting 256 by 256 pixels costs a few milliseconds,
 * while keeping every tile a panning viewer asks for would grow without bound
 * in an isolate that lives for hours. The decode above is the expensive part
 * and that is cached; the browser and the edge keep the pictures.
 */
export async function getSweepTile(site, productId, z, x, y) {
  const loaded = await loadSweep(site, productId);
  const rgba = rasteriseTile(loaded.sweep, {
    z,
    x,
    y,
    palette: loaded.product.palette,
    rangeKm: loaded.product.rangeKm,
  });

  if (!rgba) {
    blankTile = blankTile ?? encodePng(Buffer.alloc(TILE_SIZE * TILE_SIZE * 4), TILE_SIZE, TILE_SIZE);
    return { png: blankTile, key: loaded.key, timestamp: loaded.timestamp, blank: true };
  }

  return { png: encodePng(rgba, TILE_SIZE, TILE_SIZE), key: loaded.key, timestamp: loaded.timestamp, blank: false };
}
