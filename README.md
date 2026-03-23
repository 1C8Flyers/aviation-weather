# Aviation Weather Dashboard

A comprehensive, real-time aviation weather dashboard featuring live METAR, TAF, weather radar, ADS-B aircraft tracking, and LiveATC audio integration. Built for pilots, aviation enthusiasts, and anyone who needs quick access to aviation weather data.

![Flight Category](https://img.shields.io/badge/Flight%20Category-VFR%2FMVFR%2FIFR%2FLIFR-blue)
![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker)
![Mobile](https://img.shields.io/badge/Mobile-Responsive-green)

## Features

### 🌦️ Comprehensive Weather Data
- **METAR**: Current conditions including wind, visibility, temperature, dewpoint, altimeter, and clouds
- **Runway-Aware Winds**: FAA NASR runway headings are overlaid on a wind compass to visualize headwind/crosswind components
- **TAF**: Decoded Terminal Area Forecast with time periods and weather changes
- **NWS Forecast**: 3-period National Weather Service forecast with temperatures and conditions
- **Weather Radar**: Live NEXRAD radar imagery with 120+ sites covering the entire United States

### ✈️ Live Aircraft Tracking
- **ADS-B Traffic**: Real-time aircraft positions from OpenSky Network
- **Interactive Map**: Leaflet-based map showing all aircraft within ~30nm radius
- **Aircraft Details**: Callsign, altitude, speed, heading, and ground status
- **Auto-Refresh**: Updates every 10 seconds for near real-time tracking
- **Rotating Icons**: Aircraft icons rotate based on actual heading

### 🎧 LiveATC Integration
- Direct links to LiveATC feeds for 50+ major airports
- One-click access to live tower, ground, and approach frequencies
- Automatic feed availability detection

### 🌬️ Winds Aloft
- **Upper-Level Winds**: Forecast winds and temperatures at 3,000 to FL390
- **9 Altitude Levels**: Complete wind/temp profile for flight planning
- **Station Source Display**: Shows which reporting station provides the data
- **Auto-Matched Stations**: Automatically finds nearest winds aloft station

### ⚠️ Safety Advisories & Reports
- **PIREPs**: Real-time pilot reports of turbulence, icing, and weather conditions
  - Location-filtered within 100nm radius of airport
  - Color-coded severity indicators (turbulence/icing)
  - Visual badge alerts when active reports exist
- **AIRMETs & SIGMETs**: Weather hazard advisories for flight operations
  - Location-filtered to ~200nm radius of airport
  - Includes convective SIGMETs for thunderstorm hazards
  - One-click popup with detailed advisory information

### 📱 Mobile Responsive
- Fully optimized for mobile devices
- Touch-friendly controls
- Stacked layout for easy scrolling
- Readable text sizes on all screen sizes

### 🔄 Smart Features
- **Recent Airports**: Automatically tracks your last 3 viewed airports
- **Auto-Refresh**: Weather data updates every 60 seconds
- **Flight Category Display**: Color-coded header (VFR/MVFR/IFR/LIFR)
- **Radar/Traffic Toggle**: Switch between weather radar and aircraft tracking
- **Local & Zulu Time**: Real-time clock display in both formats

### 🧭 Visual Insights
- **Runway/Wind Compass**: Click-to-enlarge SVG showing each runway centerline with live wind arrow and speed
- **Atmospheric Conditions Diagram**: Full-width gradient sky with cloud layers, bases, and day/night shading
- **Modal View**: Tap either visual to pop a larger, detail-rich version with zoom-friendly layout

## Quick Start

### Prerequisites
- Docker & Docker Compose
- Port 8085 available

### Installation

1. **Clone or download the repository**
```bash
cd /backup-8tb/Docker/aviation-weather
```

2. **Build and start the containers**
```bash
docker compose up -d
```

3. **Access the dashboard**
```
http://localhost:8085
```

That's it! The dashboard will start showing weather for KRFD (Rockford, IL) by default.

### Rebuilding After Changes
```bash
docker compose build
docker compose up -d
```

### View Logs
```bash
docker compose logs -f wx-backend
docker compose logs -f wx-frontend
```

### Stop Services
```bash
docker compose down
```

## Usage

### Viewing Different Airports
1. Type the ICAO code (e.g., KORD, KATL, KSEA) in the input field
2. Click "Go" or press Enter
3. The dashboard will load all weather data for that airport

### Using Recent Airports
Click any of the three buttons under "Recent:" to quickly switch to previously viewed airports. The list automatically updates as you view different airports.

### Viewing Aircraft Traffic
1. Click the "✈️ Show Traffic" button in the radar panel
2. See all aircraft within ~30 nautical miles
3. Click any aircraft marker for details
4. Click "📡 Show Radar" to switch back to weather radar

### Listening to LiveATC
Click the "▶️ Listen Live" button to open the LiveATC page for the current airport (if available).

## Architecture

### Backend (Node.js)
- **Port**: 4000 (internal)
- **Framework**: Express
- **APIs**:
  - Aviation Weather Center (METAR/TAF)
  - National Weather Service (Forecast & Radar)
  - OpenSky Network (ADS-B Traffic)
  - FAA NASR (runway geometry for wind visualization)
- **Caching**: 60s for weather, 10s for aircraft traffic

### Frontend (React + Vite)
- **Port**: 8085 (exposed)
- **Framework**: React 18.2.0
- **Build Tool**: Vite 5.0.8
- **Mapping**: Leaflet 1.9.4 + react-leaflet 4.2.1
- **Server**: Nginx (production)

### Docker Setup
- **Backend Container**: `wx-backend` (Node.js)
- **Frontend Container**: `wx-frontend` (Nginx + React build)
- **Network**: Bridge network for inter-container communication

## Data Sources

| Data Type | Source | Update Frequency |
|-----------|--------|------------------|
| METAR | Aviation Weather Center | 60 seconds |
| TAF | Aviation Weather Center | 60 seconds |
| Forecast | National Weather Service | 60 seconds |
| Radar | NWS NEXRAD | On demand |
| Aircraft | OpenSky Network | 10 seconds |
| Runway Geometry | FAA NASR | 28 days |
| Audio | LiveATC.net | Real-time stream |

## Radar Coverage

The dashboard includes 120+ NEXRAD radar sites covering:
- Continental United States (all 48 states)
- Alaska (4 sites)
- Hawaii (4 sites)
- All major metropolitan areas
- Automatic site selection based on airport location

## Configuration

### Default Airports
To change the default recent airports, modify `frontend/src/App.jsx`:
```javascript
return ['KRFD', 'KORD', 'KMSN'];  // Change these codes
```

### Cache Timing
To adjust cache durations, modify `backend/index.js`:
```javascript
const CACHE_MS = 60_000;          // Weather data (milliseconds)
const TRAFFIC_CACHE_MS = 10_000;  // Aircraft traffic (milliseconds)
```

### Port Configuration
To change the exposed port, edit `docker-compose.yml`:
```yaml
ports:
  - "8085:80"  # Change 8085 to your desired port
```

## API Endpoints

The backend exposes the following REST endpoints:

- `GET /api/dashboard/:station` - Full dashboard data (METAR, TAF, forecast, radar, traffic)
- `GET /api/traffic/:station` - Fast aircraft traffic updates only
- `GET /health` - Health check endpoint

Example:
```bash
curl http://localhost:4000/api/dashboard/KORD
curl http://localhost:4000/api/traffic/KATL
```

## Supported Airports

The dashboard works with any ICAO airport code that has METAR data. LiveATC integration is available for 50+ major airports including:

**Major Hubs**: KATL, KORD, KDFW, KDEN, KLAX, KSFO, KSEA, KJFK, KEWR, KBOS, KMIA, KLAS, KPHX, KIAH, KCLT, KMSP

**Regional**: KRFD, KMSN, KMKE, KMDW, KGRR, KBUF, KROC, KSYR, KALB, and many more

## Browser Compatibility

- Chrome/Edge (recommended)
- Firefox
- Safari
- Mobile browsers (iOS Safari, Chrome Mobile)

## Performance Notes

- Weather data cached for 60 seconds to reduce API load
- Aircraft traffic cached for 10 seconds (OpenSky API limit: 10 req/min)
- Radar images served directly from NWS with browser caching
- Optimized for 50+ aircraft markers on the map

## Troubleshooting

### Weather data not loading
- Check backend logs: `docker compose logs wx-backend`
- Verify the ICAO code is valid
- Ensure internet connectivity for API access

### Aircraft not showing
- OpenSky API has a rate limit of 10 requests/minute
- Some areas may have limited ADS-B coverage
- Check if "Show Traffic" toggle is enabled

### Radar image not displaying
- Some radar sites may be temporarily offline
- Image URLs are direct from NWS and subject to their availability
- Try a different nearby airport

### Mobile display issues
- Clear browser cache
- Ensure viewport meta tag is present
- Try landscape orientation for more space

## Development

### Local Development (without Docker)

**Backend:**
```bash
cd backend
npm install
node index.js
# Runs on http://localhost:4000
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
# Runs on http://localhost:5173
```

### Project Structure
```
aviation-weather/
├── backend/
│   ├── index.js          # Express server with all API logic
│   ├── package.json
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── App.jsx       # Main React component
│   │   ├── App.css       # Styling including mobile responsive
│   │   └── main.jsx      # React entry point
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   ├── nginx.conf        # Production web server config
│   └── Dockerfile
├── docker-compose.yml
└── README.md
```

## Credits

### Data Sources
- **Aviation Weather Center** - METAR and TAF data
- **National Weather Service** - Forecasts and NEXRAD radar
- **OpenSky Network** - ADS-B aircraft tracking data
- **LiveATC.net** - Live ATC audio feeds

### Technologies
- React, Vite, Leaflet, Express, Node.js, Docker, Nginx

## License

This project is provided as-is for educational and personal use. Please respect the terms of service of all data providers (AWC, NWS, OpenSky, LiveATC).

## Support

For issues or questions, check the logs:
```bash
docker compose logs -f
```

## Roadmap

Potential future enhancements:
- [ ] Historical weather data viewing
- [ ] Multiple airport comparison
- [ ] Weather alerts and notifications
- [ ] Favorite airports list
- [ ] NOTAM integration
- [ ] Flight planning tools
- [ ] PWA support for offline access

---

**Built for pilots, by pilots.** 🛩️

Last Updated: November 2025
