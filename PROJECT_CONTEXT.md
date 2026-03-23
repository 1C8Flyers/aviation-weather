# Aviation Weather Dashboard - Project Context

## Project Overview
Comprehensive aviation weather dashboard with live radar, ADS-B traffic tracking, METAR/TAF data, FAA NASR-powered runway insights, and LiveATC audio integration.

**Repository**: `/backup-8tb/Docker/aviation-weather` (remote server: nas@enterprise.local)  
**Local Dev**: Port 8085  
**Production**: Requires HTTPS for LiveATC functionality

## Architecture

### Backend (Node.js + Express)
- **File**: `backend/index.js` (529 lines)
- **Port**: 4000 (internal to Docker network)
- **APIs Used**:
  - Aviation Weather Center (METAR/TAF)
  - NWS (forecast + NEXRAD radar images)
  - OpenSky Network (ADS-B aircraft tracking)
  - LiveATC (audio streams via iframe)
  - FAA NASR (runway geometry for crosswind visualization)
- **Caching Strategy**:
  - Weather data: 60 seconds (`CACHE_MS = 60_000`)
  - Aircraft traffic: 10 seconds (`TRAFFIC_CACHE_MS = 10_000`)
  - Separate cache objects: `cache{}` and `trafficCache{}`

### Frontend (React + Vite)
- **Main Component**: `frontend/src/App.jsx`
- **Styling**: `frontend/src/App.css`
- **Port**: 8085 (exposed)
- **Key Libraries**:
  - React 18.2.0
  - Leaflet 1.9.4 + react-leaflet 4.2.1 (interactive maps)
  - Vite 5.0.8 (build tool)

### Containerization
- **Compose File**: `docker-compose.yml`
- **Containers**:
  - `wx-backend`: node:22-alpine
  - `wx-frontend`: nginx:alpine (multi-stage build)
- **Network**: Bridge network for inter-container communication

## Key Features

### 1. Comprehensive US Radar Coverage
- **120+ NEXRAD sites** covering entire United States
- Geographic regions:
  - Northeast: KBOX, KOKX, KENX, KDIX, KCCX, KBGM, KBUF, KTYX, KCXX, KGYX
  - Southeast: KAMX, KJAX, KTBW, KBYX, KMHX, KLTX, KMRX, KFFC, KGSP, KCLX, KJGX, KMOB, KEOX, KSHV
  - Midwest: KLOT, KMKX, KIND, KILN, KDVN, KDMX, KARX, KMPX, KDLH, KAPX, KGRR, KIWX, KVWX
  - South Central: KDFW, KFWS, KSJT, KMAF, KGRK, KEWX, KCRP, KBRO, KHOU, KLCH, KPOE, KLIX, KTLX, KVNX, KINX, KSRX
  - Northern Plains: KFSD, KUDX, KABR, KBIS, KMVX, KMBX
  - Rocky Mountains: KFTG, KGJX, KPUX, KRIW, KCYS, KSFX, KMTX, KGGW, KTFX, KMSX, KBLX, KCBX, Kicx
  - Southwest: KFSX, KEMX, KYUX, KIWA, KEPZ, KHDX, KABX
  - California: KMUX, KDAX, KHNX, KSOX, KVTX, KVBX, KNKX, KEYX, KBHX, KRGX
  - Pacific Northwest: KATX, KRTX, KOTX, KPDT, KMAX, KLGX
  - Alaska: PABC, PAPD, PAHG, PAKC
  - Hawaii: PHKI, PHKM, PHMO, PHWA
- **Function**: `getNearestRadarSite(lat, lon)` with accurate bounds checking

### 2. Live ADS-B Traffic Tracking
- **Data Source**: OpenSky Network API
- **Update Frequency**: 10 seconds (max allowed by API: 10 req/min)
- **Endpoints**:
  - `/api/dashboard/:station` - Full weather + traffic
  - `/api/traffic/:station` - Fast traffic-only updates
- **Function**: `getAircraftTraffic(lat, lon, radiusDegrees=0.5)`
- **Map Integration**: Leaflet.js with custom airplane emoji markers
- **Features**:
  - Interactive map with zoom/pan
  - Toggle between radar and traffic view
  - Airplane icons rotate based on heading
  - Different icons for airborne (✈️) vs on ground (🛬)
  - Popup shows: callsign, altitude, speed, heading

### 3. LiveATC Audio Integration
- **Implementation**: Iframe embed in station bar with mount point mapping
- **URL Pattern**: `https://www.liveatc.net/play/{mount_point}.pls`
- **Mount Points**: Mapped 50+ major airports (ICAO -> LiveATC feed ID)
- **Location**: Between airport selector and forecast section
- **Features**:
  - Automatic feed availability detection
  - "No feed available" fallback for unmapped airports
  - Auto-updates when switching airports
  - Dimensions: 280x40px
- **Requirements**: 
  - **HTTPS required** for iframe to function (browser security policy)
  - PLS file streaming support in browser
- **Current State**: Fully implemented with proper mount points, ready for HTTPS deployment

### 4. Weather Data
- **METAR**: Current conditions, temperature, wind, visibility
- **TAF**: Terminal Area Forecast (decoded)
- **NWS Forecast**: 7-day detailed forecast
- **Radar**: Animated NEXRAD imagery (BREF1 base reflectivity)

### 5. Visual Runway & Conditions Insights
- **Runway/Wind Compass**: Uses FAA NASR runway true headings to draw each centerline and overlays a dynamic wind arrow with speed and gust callouts
- **Atmosphere Diagram**: Full-width SVG sky scene with gradient day/night lighting, ground reference, altitude ticks every 2,500 ft, and up to four cloud layers scaled by coverage
- **Modal Expansion**: Both visuals share a tap-to-enlarge modal for higher fidelity on tablets/phones without duplicating components elsewhere in the layout

## Technical Implementation Details

### Backend Key Functions

```javascript
// Radar Site Selection (120+ sites)
function getNearestRadarSite(lat, lon) {
  // Returns NEXRAD site ID based on lat/lon with regional coverage
  // Falls back to KFTG (Denver) if no match
}

// Aircraft Traffic with Caching
async function getAircraftTraffic(lat, lon, radiusDegrees = 0.5) {
  const cacheKey = `${Math.round(lat*10)/10},${Math.round(lon*10)/10}`;
  const cached = trafficCache[cacheKey];
  if (cached && Date.now() - cached.timestamp < TRAFFIC_CACHE_MS) {
    return cached.data;
  }
  // Fetch from OpenSky with bounding box
  // Cache for 10 seconds
}

// Main Endpoints
GET /api/dashboard/:station  // Full dashboard data
GET /api/traffic/:station    // Traffic-only fast refresh
```

### Frontend Key Components

```javascript
// Airplane Icon with Rotation
function createAirplaneIcon(heading, isOnGround) {
  const rotation = heading !== null && heading !== undefined ? heading : 0;
  const symbol = isOnGround ? '🛬' : '✈️';
  return L.divIcon({
    html: `<div style="transform: rotate(${rotation}deg); font-size: 20px;">${symbol}</div>`,
    className: 'airplane-icon',
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });
}

// Traffic Loading (Fast Refresh)
async function loadTraffic(targetStation) {
  const response = await fetch(`/api/traffic/${targetStation}`);
  const data = await response.json();
  setAircraft(data.aircraft || []);
  setMapCenter([data.lat, data.lon]);
}

// Update Intervals
useEffect(() => {
  const dataInterval = setInterval(() => loadData(station), 60000);     // Full data
  const trafficInterval = showMap ? setInterval(() => loadTraffic(station), 10000) : null;  // Traffic only
  const clockInterval = setInterval(() => setCurrentTime(new Date()), 1000);  // Clock
  return () => { /* cleanup */ };
}, [station, showMap]);

// LiveATC Integration with Mount Point Mapping
const LIVEATC_FEEDS = {
  'KRFD': 'krfd', 'KORD': 'kord', 'KMDW': 'kmdw', 'KMSN': 'kmsn',
  'KMKE': 'kmke', 'KATL': 'katl', 'KJFK': 'kjfk', 'KEWR': 'kewr',
  // ... 50+ mapped airports
};

<div className="station-audio">
  <div className="audio-label">🎧 LiveATC:</div>
  {LIVEATC_FEEDS[station] ? (
    <div className="audio-player">
      <iframe 
        key={station}
        src={`https://www.liveatc.net/play/${LIVEATC_FEEDS[station]}.pls`}
        className="audio-iframe"
        allow="autoplay"
      />
    </div>
  ) : (
    <div className="audio-unavailable">No feed available</div>
  )}
</div>
```

### CSS Dark Theme

```css
/* Airplane Icon - Transparent Background */
.airplane-icon {
  background: transparent !important;
  border: none !important;
  display: flex;
  align-items: center;
  justify-content: center;
}

  // Runway/Wind Compass Visualization
  {data?.runways?.length && metar?.windDir !== null && (
    <div className="wind-compass" onClick={() => setShowVisualsModal(true)}>
      <svg viewBox="0 0 280 280">
        {data.runways.map((heading, idx) => {
          const radians = (heading * 10 * Math.PI) / 180;
          return (
            <line
              key={idx}
              x1={140 + 90 * Math.sin(radians)}
              y1={140 - 90 * Math.cos(radians)}
              x2={140 - 90 * Math.sin(radians)}
              y2={140 + 90 * Math.cos(radians)}
            />
          );
        })}
        <WindArrow heading={metar.windDir} speed={metar.windSpeedKt} />
      </svg>
    </div>
  )}

/* Traffic Map Container */
.traffic-map {
  width: 100%;
  height: 100%;
  border-radius: 4px;
  border: 1px solid #334155;
  z-index: 1;
}

/* Leaflet Dark Theme Overrides */
.leaflet-popup-content-wrapper {
  background: #1e293b;
  color: #e0e0e0;
  border: 1px solid #334155;
}

/* LiveATC Audio Player */
.station-audio {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-left: 2rem;
  margin-right: 1rem;
}

.audio-label {
  font-size: 0.85rem;
  font-weight: 600;
  color: #94a3b8;
  white-space: nowrap;
}

.audio-player {
  display: flex;
  align-items: center;
  background: #0f172a;
  padding: 0.4rem 0.8rem;
  border-radius: 4px;
  border: 1px solid #334155;
}

.audio-iframe {
  width: 280px;
  height: 40px;
  border: none;
  background: transparent;
}

.audio-unavailable {
  font-size: 0.8rem;
  color: #64748b;
  font-style: italic;
  padding: 0.4rem 0.8rem;
  background: #0f172a;
  border-radius: 4px;
  border: 1px solid #334155;
}
```

## Docker Deployment

### Build & Deploy
```bash
# Build all containers
docker compose build

# Start services
docker compose up -d

# Rebuild specific container
docker compose build wx-frontend
docker compose up -d wx-frontend

# View logs
docker compose logs -f wx-backend
docker compose logs -f wx-frontend

# Stop services
docker compose down
```

### Container Details
- **wx-backend**: Runs Express server on port 4000 (internal)
- **wx-frontend**: Multi-stage build (npm build → nginx serve) on port 8085

## Known Issues & Solutions

### 1. OpenSky API Rate Limiting
- **Limit**: 10 requests per minute (6 second minimum interval)
- **Solution**: Implemented 10-second cache with separate `trafficCache` object
- **Endpoint**: `/api/traffic/:station` for lightweight updates

### 2. LiveATC Requires HTTPS
- **Issue**: Iframe doesn't work on HTTP localhost
- **Cause**: Browser security policies + LiveATC's X-Frame-Options
- **Solution**: 
  - Deploy with HTTPS (reverse proxy with SSL certificate)
  - Implemented proper mount point mapping (ICAO -> LiveATC feed ID)
  - Added fallback UI for stations without feeds
- **Status**: Fully implemented with 50+ airport feeds, ready for HTTPS deployment

### 3. Geographic Coverage Validation
- **Tested**: KBOS, KOKX, KATL, KMIA, KORD, KDFW, KMSP, KDEN, KPHX, KSEA, KSFO
- **Fixed**: KRWL (Wyoming), KCVG (Cincinnati), KTUL (Tulsa), KCLT, KROC, KGRI, KXNA
- **Method**: Expanded radar site bounds, added missing sites

## Deployment Checklist for HTTPS

1. **Set up reverse proxy** (nginx/Caddy) with SSL certificate
2. **Configure domain** pointing to server
3. **Update docker-compose.yml** if needed for proxy integration
4. **Deploy containers** on remote server
5. **Test LiveATC** iframe functionality with HTTPS
6. **Verify** all features:
   - Weather data loading
   - Radar images displaying
   - Aircraft tracking updating every 10s
   - LiveATC audio streams playing

## Remote Server Details
- **Host**: enterprise.local
- **User**: nas
- **Project Path**: `/backup-8tb/Docker/aviation-weather`
- **Current State**: Project ready for deployment with HTTPS

## Next Steps
1. Transfer project files to remote server (if not already done)
2. Configure HTTPS reverse proxy
3. Build and deploy containers on remote server
4. Test full functionality with SSL
5. Monitor OpenSky API rate limits in production

## Useful Commands

### Development
```bash
# Local testing
npm run dev  # Frontend (from frontend/)
node index.js  # Backend (from backend/)

# Docker development
docker compose up --build  # Build and start fresh
docker compose restart wx-backend  # Quick restart after code change
```

### Debugging
```bash
# Check API endpoints
curl http://localhost:4000/api/dashboard/KORD
curl http://localhost:4000/api/traffic/KATL

# Check frontend
curl http://localhost:8085

# Container inspection
docker compose ps
docker compose logs -f
docker exec -it wx-backend sh
```

### File Structure
```
aviation-weather/
├── backend/
│   ├── index.js          # Main Express server (529 lines)
│   ├── package.json
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── App.jsx       # Main React component with map & LiveATC
│   │   └── App.css       # Dark theme styling
│   ├── package.json
│   ├── vite.config.js
│   ├── nginx.conf
│   └── Dockerfile
└── docker-compose.yml
```

## Testing Checklist
- [ ] Weather data loads for various airports (KORD, KATL, KSEA, etc.)
- [ ] Radar images display correctly for all US regions
- [ ] Aircraft appear on traffic map within 10 seconds
- [ ] Airplane icons rotate based on heading
- [ ] Map toggles between radar and traffic views
- [ ] LiveATC iframe appears (requires HTTPS to play)
- [ ] Station switching updates all data including audio
- [ ] No console errors in browser

## Performance Notes
- **Weather cache**: 60 seconds (balance freshness vs API load)
- **Traffic cache**: 10 seconds (max allowed by OpenSky)
- **Separate intervals**: Data (60s) vs Traffic (10s) for efficiency
- **Radar images**: Fetched as needed, cached by browser
- **Map rendering**: Leaflet optimized for 50+ markers

## API Rate Limits
- **OpenSky**: 10 requests/min (enforced with 10s cache)
- **NWS**: No strict limit (60s cache is respectful)
- **Aviation Weather Center**: No strict limit (60s cache)
- **LiveATC**: Embedded player handles rate limiting internally
