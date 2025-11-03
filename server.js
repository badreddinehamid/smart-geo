// server.js
// Minimal dependencies: express
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const NMEA_FILE = path.join(__dirname, 'nmea.txt');

app.use(express.static(path.join(__dirname, 'public')));

// Ensure NMEA file exists
if (!fs.existsSync(NMEA_FILE)) fs.writeFileSync(NMEA_FILE, '', 'utf8');

// SSE clients
const clients = new Set();

// Internal state
let fileSize = 0;
let latestPosition = null; // merged parsed fields (lat, lon, speedKmh, track, sats, alt, ...)
let lastParsedRaw = null;

// Broadcast settings (tunable)
const BROADCAST_HZ = parseFloat(process.env.BROADCAST_HZ) || 5; // default 5 Hz
const BROADCAST_INTERVAL_MS = Math.max(50, Math.round(1000 / BROADCAST_HZ)); // clamp min 50ms

/* ---------- NMEA parsing helpers ---------- */
function dmToDecimal(dmStr, hemi) {
  if (!dmStr) return null;
  const v = parseFloat(dmStr);
  if (isNaN(v)) return null;
  const degrees = Math.floor(v / 100);
  const minutes = v - degrees * 100;
  const dec = degrees + minutes / 60;
  if (hemi === 'S' || hemi === 'W') return -dec;
  return dec;
}

function parseGPRMC(parts) {
  // Example: $GPRMC,hhmmss.ss,A,lat,N,lon,E,sog,track,date,...
  try {
    const timeStr = parts[1];
    const status = parts[2];
    const lat = dmToDecimal(parts[3], parts[4]);
    const lon = dmToDecimal(parts[5], parts[6]);
    const speedKnots = parts[7] ? parseFloat(parts[7]) : 0;
    const speedKmh = +(speedKnots * 1.852).toFixed(2);
    const track = parts[8] ? parseFloat(parts[8]) : null;
    const dateStr = parts[9] || null;
    return { type: 'GPRMC', timeStr, status, lat, lon, speedKnots, speedKmh, track, dateStr };
  } catch (e) { return null; }
}

function parseGPGGA(parts) {
  // Example: $GPGGA,hhmmss.ss,lat,N,lon,E,fix,sats,hdop,alt,M,...
  try {
    const timeStr = parts[1];
    const lat = dmToDecimal(parts[2], parts[3]);
    const lon = dmToDecimal(parts[4], parts[5]);
    const fix = parts[6];
    const sats = parts[7] ? parseInt(parts[7], 10) : 0;
    const alt = parts[9] ? parseFloat(parts[9]) : null;
    return { type: 'GPGGA', timeStr, lat, lon, fix, sats, alt };
  } catch (e) { return null; }
}

function parseGPVTG(parts) {
  // Example: $GPVTG,trackT,T,trackM,M,speedKn,N,speedK,K
  try {
    const track = parts[1] ? parseFloat(parts[1]) : null;
    const speedKnots = parts[5] ? parseFloat(parts[5]) : 0;
    const speedKmh = parts[7] ? parseFloat(parts[7]) : +(speedKnots * 1.852).toFixed(2);
    return { type: 'GPVTG', track, speedKnots, speedKmh };
  } catch (e) { return null; }
}

function parseNMEALine(line) {
  if (!line || line[0] !== '$') return null;
  const body = line.split('*')[0];
  const parts = body.split(',');
  const tag = parts[0].replace(/^\$/, '');
  if (tag === 'GPRMC') return parseGPRMC(parts);
  if (tag === 'GPGGA') return parseGPGGA(parts);
  if (tag === 'GPVTG') return parseGPVTG(parts);
  // Unknown sentence -> return raw type for debug
  return { type: tag, raw: line };
}

/* ---------- SSE endpoint ---------- */
app.get('/events', (req, res) => {
  res.writeHead(200, {
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Content-Type': 'text/event-stream',
  });
  res.write('\n');

  // send immediate snapshot if available
  if (latestPosition) {
    try {
      res.write(`data: ${JSON.stringify({ snapshot: true, parsed: latestPosition })}\n\n`);
    } catch (e) { /* ignore */ }
  }

  clients.add(res);
  req.on('close', () => clients.delete(res));
});

function broadcast(obj) {
  const payload = `data: ${JSON.stringify(obj)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch (e) {
      clients.delete(res);
    }
  }
}

/* ---------- File tailing & processing ---------- */
function mergeParsed(parsed) {
  if (!parsed) return;
  // merge new parsed fields into latestPosition
  latestPosition = Object.assign({}, latestPosition || {}, parsed);
  latestPosition.receivedAt = new Date().toISOString();
  lastParsedRaw = parsed;
}

function processLines(lines) {
  for (const ln of lines) {
    const trimmed = ln.trim();
    if (!trimmed) continue;
    const parsed = parseNMEALine(trimmed);
    // For debugging you can broadcast raw events too; commented out for production:
    // broadcast({ raw: trimmed, parsed, receivedAt: new Date().toISOString() });
    if (parsed) mergeParsed(parsed);
  }
}

// Read existing file at startup (so server doesn't miss previously written lines)
try {
  const st = fs.statSync(NMEA_FILE);
  fileSize = st.size;
  if (fileSize > 0) {
    const content = fs.readFileSync(NMEA_FILE, 'utf8');
    const lines = content.split(/\r?\n/).filter(Boolean);
    processLines(lines);
  }
} catch (err) {
  console.warn('Startup read warning:', err.message);
}

// Watch file for appended data
fs.watchFile(NMEA_FILE, { interval: 200 }, (curr, prev) => {
  try {
    const newSize = curr.size;
    if (newSize < fileSize) {
      // file truncated/rotated -> reset pointer
      fileSize = 0;
    }
    if (newSize > fileSize) {
      const stream = fs.createReadStream(NMEA_FILE, { start: fileSize, end: newSize - 1, encoding: 'utf8' });
      let chunk = '';
      stream.on('data', c => chunk += c);
      stream.on('end', () => {
        const lines = chunk.split(/\r?\n/).filter(Boolean);
        processLines(lines);
        fileSize = newSize;
      });
      stream.on('error', err => console.error('Read stream error:', err));
    }
  } catch (e) {
    console.error('watchFile error', e);
  }
});

/* ---------- Rate-limited broadcaster ---------- */
let lastBroadcast = 0;
setInterval(() => {
  if (!latestPosition) return;
  const now = Date.now();
  // optional: only broadcast when new data exists since last broadcast
  if (now - lastBroadcast < BROADCAST_INTERVAL_MS) return;
  lastBroadcast = now;
  // send merged latestPosition
  broadcast({ parsed: latestPosition, serverTime: new Date().toISOString() });
}, BROADCAST_INTERVAL_MS);

/* ---------- Start server ---------- */
app.listen(PORT, () => {
  console.log(`Server listening: http://localhost:${PORT}  (tailing ${NMEA_FILE})`);
  console.log(`Broadcast rate: ${BROADCAST_HZ} Hz (${BROADCAST_INTERVAL_MS} ms interval). Set BROADCAST_HZ env to change.`);
});
