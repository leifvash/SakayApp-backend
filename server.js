require('dotenv').config({ path: './backend.env' });
const express = require('express');
const cors = require('cors');
const os = require('os');

// -------------------- Load Data --------------------
let routes = require('./sakayapp.Routes.json'); // mutable array

// -------------------- App Setup --------------------
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// -------------------- Utility --------------------
function getWirelessIP() {
  const nets = os.networkInterfaces();
  const wirelessNames = ['Wi-Fi', 'WiFi', 'WLAN', 'wlan0', 'en0'];

  for (const name of wirelessNames) {
    const iface = nets[name];
    if (!iface) continue;

    for (const net of iface) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost'; // fallback
}

const localIP = getWirelessIP();

// -------------------- Distance Helpers --------------------
function haversineDistance([lng1, lat1], [lng2, lat2]) {
  const toRad = deg => (deg * Math.PI) / 180;
  const R = 6371000; // meters
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function pointToSegmentDistance(p, a, b) {
  const [px, py] = p;
  const [ax, ay] = a;
  const [bx, by] = b;

  const dx = bx - ax;
  const dy = by - ay;

  if (dx === 0 && dy === 0) {
    return haversineDistance(p, a);
  }

  const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  const proj =
    t <= 0 ? [ax, ay] :
    t >= 1 ? [bx, by] :
    [ax + t * dx, ay + t * dy];

  return haversineDistance(p, proj);
}

function minDistanceToRoute(point, routeCoords) {
  let minDist = Infinity;
  for (let i = 0; i < routeCoords.length - 1; i++) {
    const d = pointToSegmentDistance(point, routeCoords[i], routeCoords[i + 1]);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

// -------------------- Ride Logic --------------------
function findSingleRide(origin, destination, routes, thresholdMeters = 300) {
  for (const r of routes) {
    const originDist = minDistanceToRoute([origin.lng, origin.lat], r.route.coordinates);
    const destDist   = minDistanceToRoute([destination.lng, destination.lat], r.route.coordinates);

    if (originDist <= thresholdMeters && destDist <= thresholdMeters) {
      return { type: 'single', plan: [r] };
    }
  }
  return null;
}

function findDoubleRide(origin, destination, routes, thresholdMeters = 300) {
  for (const r of routes) {
    const originDist = minDistanceToRoute([origin.lng, origin.lat], r.route.coordinates);
    if (originDist > thresholdMeters) continue;

    const sampleCoords = [
      r.route.coordinates[0],
      r.route.coordinates[Math.floor(r.route.coordinates.length / 2)],
      r.route.coordinates.at(-1)
    ];

    for (const coord of sampleCoords) {
      for (const t of routes) {
        if (t._id === r._id) continue;

        const transferDist = minDistanceToRoute(coord, t.route.coordinates);
        const destDist     = minDistanceToRoute([destination.lng, destination.lat], t.route.coordinates);

        if (transferDist <= thresholdMeters && destDist <= thresholdMeters) {
          return { type: 'double', plan: [r, t] };
        }
      }
    }
  }
  return null;
}

// -------------------- Endpoints --------------------

// Config endpoint
app.get('/config', (req, res) => {
  res.json({ apiUrl: `http://${localIP}:${PORT}` });
});

// Dummy admin login
app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === 'admin' && password === 'admin123') {
    return res.json({ success: true });
  }
  res.status(401).json({ success: false, message: 'Invalid credentials' });
});

// Get all routes
app.get('/routes', (req, res) => {
  res.json(routes);
});

// Get route by ID
app.get('/routes/:id', (req, res) => {
  const route = routes.find(r => r._id === req.params.id);
  if (!route) return res.status(404).json({ message: 'Route not found' });
  res.json(route);
});

// Create new route
app.post('/routes', (req, res) => {
  const { name, direction, district, route } = req.body;
  if (!name || !direction || !route?.coordinates) {
    return res.status(400).json({ message: 'Invalid route data' });
  }
  const newRoute = {
    _id: Date.now().toString(),
    name,
    direction,
    district,
    route,
  };
  routes.push(newRoute);
  res.status(201).json(newRoute);
});

// Update route
app.patch('/routes/:id', (req, res) => {
  const route = routes.find(r => r._id === req.params.id);
  if (!route) return res.status(404).json({ message: 'Route not found' });

  Object.assign(route, req.body);
  res.json(route);
});

// Delete route
app.delete('/routes/:id', (req, res) => {
  const index = routes.findIndex(r => r._id === req.params.id);
  if (index === -1) return res.status(404).json({ message: 'Route not found' });

  routes.splice(index, 1);
  res.json({ success: true });
});

// Recommend route (single or transfer)
app.post('/routes/recommend', (req, res) => {
  const { origin, destination } = req.body; // { lng, lat }
  if (!origin || !destination) {
    return res.status(400).json({ error: 'Origin and destination required' });
  }

  const single = findSingleRide(origin, destination, routes);
  if (single) return res.json(single);

  const double = findDoubleRide(origin, destination, routes);
  if (double) return res.json(double);

  res.status(404).json({ error: 'No route found (single or double)' });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ database: 'not used', timestamp: new Date().toISOString() });
});

// -------------------- Start Server --------------------
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://${localIP}:${PORT}`);
});