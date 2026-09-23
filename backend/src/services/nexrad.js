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
 *   s3://unidata-nexrad-level3  ->  https://unidata-nexrad-level3.s3.amazonaws.com
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

/** Build a 256-entry RGBA lookup so rasterising is a table read per pixel. */
function buildLookup(sweep, paletteName) {
  const stops = PALETTES[paletteName] ?? PALETTES.reflectivity;
  const table = new Uint8Array(256 * 4);

  for (let level = 0; level < 256; level += 1) {
    // Below threshold and range folded draw as nothing, which is what keeps a
    // clear day transparent instead of a blue wash.
    if (!hasReading(sweep, level)) continue;

    const value = levelToValue(sweep, level);
    if (value < stops[0][0]) continue;

    let colour = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i += 1) {
      const [v0, r0, g0, b0] = stops[i];
      const [v1, r1, g1, b1] = stops[i + 1];
      if (value >= v0 && value <= v1) {
        const t = v1 === v0 ? 0 : (value - v0) / (v1 - v0);
        colour = [value, r0 + (r1 - r0) * t, g0 + (g1 - g0) * t, b0 + (b1 - b0) * t];
        break;
      }
    }

    const at = level * 4;
    table[at] = colour[1];
    table[at + 1] = colour[2];
    table[at + 2] = colour[3];
    table[at + 3] = 255;
  }

  return table;
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
 * Each output pixel is inverse-projected, turned into a bearing and range from
 * the radar, and read straight out of the polar array.
 */
export function rasterise(sweep, { size = 1000, palette = 'reflectivity', rangeKm } = {}) {
  const gateKm = sweep.gateKm || (rangeKm ?? sweep.binCount * 0.25) / sweep.binCount;
  const reach = gateKm * sweep.binCount;

  const latSpan = (reach / R_EARTH_KM) * (180 / Math.PI);
  const north = Math.min(85, sweep.latitude + latSpan);
  const south = Math.max(-85, sweep.latitude - latSpan);
  const lonSpan = latSpan / Math.cos((sweep.latitude * Math.PI) / 180);
  const west = sweep.longitude - lonSpan;
  const east = sweep.longitude + lonSpan;

  const yTop = mercatorY(north);
  const yBottom = mercatorY(south);
  const lookup = buildLookup(sweep, palette);

  const rgba = Buffer.alloc(size * size * 4);
  const latRad = (sweep.latitude * Math.PI) / 180;
  const cosLat0 = Math.cos(latRad);
  const sinLat0 = Math.sin(latRad);

  // Azimuths are a regular half-degree grid, so the radial index is direct.
  const radialStep = 360 / sweep.radialCount;
  const azimuthStart = sweep.azimuths[0];

  for (let py = 0; py < size; py += 1) {
    const y = yTop + ((yBottom - yTop) * (py + 0.5)) / size;
    const lat = inverseMercatorY(y);
    const latR = (lat * Math.PI) / 180;
    const sinLat = Math.sin(latR);
    const cosLat = Math.cos(latR);

    for (let px = 0; px < size; px += 1) {
      const lon = west + ((east - west) * (px + 0.5)) / size;
      const dLon = ((lon - sweep.longitude) * Math.PI) / 180;

      // Great-circle distance and initial bearing from the radar.
      const cosD = sinLat0 * sinLat + cosLat0 * cosLat * Math.cos(dLon);
      const distKm = Math.acos(Math.min(1, Math.max(-1, cosD))) * R_EARTH_KM;
      if (distKm > reach) continue;

      const gate = Math.floor(distKm / gateKm) - sweep.firstBin;
      if (gate < 0 || gate >= sweep.binCount) continue;

      let bearing =
        (Math.atan2(
          Math.sin(dLon) * cosLat,
          cosLat0 * sinLat - sinLat0 * cosLat * Math.cos(dLon),
        ) *
          180) /
        Math.PI;
      if (bearing < 0) bearing += 360;

      let radial = Math.round((bearing - azimuthStart) / radialStep);
      radial = ((radial % sweep.radialCount) + sweep.radialCount) % sweep.radialCount;

      const level = sweep.gates[radial * sweep.binCount + gate];
      const at = level * 4;
      if (lookup[at + 3] === 0) continue;

      const out = (py * size + px) * 4;
      rgba[out] = lookup[at];
      rgba[out + 1] = lookup[at + 1];
      rgba[out + 2] = lookup[at + 2];
      rgba[out + 3] = lookup[at + 3];
    }
  }

  return { rgba, size, bounds: { north, south, east, west } };
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
 * The newest sweep for a site, decoded and painted. Cached for two minutes:
 * the radar itself only produces a new volume scan every four to six.
 */
export async function getSweepImage(site, productId = 'N0B', { size = 1000 } = {}) {
  const product = NEXRAD_PRODUCTS[productId] ?? NEXRAD_PRODUCTS.N0B;
  const cacheKey = `nexrad:${siteKey(site)}:${product.id}:${size}`;

  return withCache(cacheKey, 1000 * 120, async () => {
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
    const buffer = Buffer.from(await response.arrayBuffer());
    const sweep = parseLevel3(buffer);
    sweep.gates = despeckle(sweep);
    const raster = rasterise(sweep, { size, palette: product.palette, rangeKm: product.rangeKm });

    return {
      png: encodePng(raster.rgba, raster.size, raster.size),
      bounds: raster.bounds,
      key,
      site: String(site).toUpperCase(),
      product: product.id,
      productName: product.name,
      units: product.units,
      elevationAngle: sweep.elevationAngle,
      timestamp: sweep.timestamp,
      radarLat: sweep.latitude,
      radarLon: sweep.longitude,
      source: 'NOAA NEXRAD Level III via AWS Open Data',
    };
  });
}
