const express = require('express');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 4000;
const CACHE_MS = 60_000; // 60 seconds for weather data
const TRAFFIC_CACHE_MS = 10_000; // 10 seconds for aircraft traffic (OpenSky limit: 10 req/min = 6s min)

// Runway database - magnetic headings for major airports
// Prefer loading from FAA NASR-derived JSON if available, else fallback to static list
let RUNWAY_DATA = {
  'KRFD': [1, 19, 7, 25],
  'KORD': [10, 28, 4, 22, 9, 27, 15, 33],
  'KMDW': [4, 22, 13, 31],
  'KMSN': [3, 21, 14, 32, 18, 36],
  'KMKE': [1, 19, 7, 25],
  'KATL': [8, 26, 9, 27, 10, 28],
  'KJFK': [4, 22, 13, 31],
  'KEWR': [4, 22, 11, 29],
  'KLGA': [4, 22, 13, 31],
  'KLAX': [6, 24, 7, 25],
  'KSFO': [1, 19, 10, 28],
  'KDEN': [7, 25, 8, 26, 16, 34, 17, 35],
  'KDFW': [13, 31, 17, 35, 18, 36],
  'KIAH': [8, 26, 9, 27, 15, 33],
  'KPHX': [7, 25, 8, 26],
  'KSEA': [16, 34],
  'KBOS': [4, 22, 9, 27, 15, 33],
  'KMIA': [8, 26, 9, 27, 12, 30],
  'KCLT': [5, 23, 18, 36],
  'KLAS': [1, 19, 7, 25],
  'KMSP': [4, 22, 12, 30, 17, 35],
  'KDTW': [3, 21, 4, 22],
  'KPHL': [8, 26, 9, 27, 17, 35],
  'KBWI': [10, 28, 15, 33],
  'KSLC': [14, 32, 16, 34, 17, 35],
  'KDCA': [1, 19, 15, 33],
  'KIAD': [1, 19, 12, 30],
  'KSAN': [9, 27],
  'KTPA': [1, 19, 10, 28],
  'KPDX': [3, 21, 10, 28],
  'KSTL': [6, 24, 11, 29, 12, 30],
  'KCVG': [9, 27, 18, 36],
  'KCLE': [6, 24, 10, 28],
  'KPIT': [10, 28, 14, 32],
  'KAUS': [17, 35, 18, 36],
  'KSAT': [4, 22, 13, 31],
  'KMCI': [1, 19, 9, 27],
  'KOAK': [11, 29, 12, 30],
  'KSJC': [12, 30],
  'KRDU': [5, 23, 14, 32],
  'KMEM': [9, 27, 18, 36, 36],
  'KBNA': [2, 20, 13, 31],
  'KIND': [5, 23, 14, 32],
  'KCMH': [10, 28],
  'KBDL': [6, 24, 15, 33],
  'KPVD': [5, 23, 16, 34],
  'KRIC': [2, 20, 7, 25, 16, 34],
  'KROC': [4, 22, 7, 25, 10, 28],
  'KBUF': [5, 23, 14, 32],
  'KSYR': [10, 28, 15, 33],
  'KALB': [1, 19, 10, 28],
  'KGRR': [8, 26, 17, 35]
};

try {
  const fs = require('fs');
  const path = require('path');
  const runwaysPath = path.join(__dirname, 'runways.json');
  if (fs.existsSync(runwaysPath)) {
    const raw = fs.readFileSync(runwaysPath, 'utf-8');
    const parsed = JSON.parse(raw);
    // Only merge if parsed looks valid; fallback entries remain
    if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
      RUNWAY_DATA = { ...RUNWAY_DATA, ...parsed };
      console.log(`Loaded runway data from FAA NASR JSON: ${Object.keys(parsed).length} airports`);
    }
  }
} catch (e) {
  console.error('Failed to load runway JSON; using fallback:', e.message);
}

// Headers
const NWS_HEADERS = {
  'User-Agent': 'Aviation-TV-Dashboard (your-email@example.com)',
  'Accept': 'application/geo+json'
};

const AWC_HEADERS = {
  'User-Agent': 'Aviation-TV-Dashboard (your-email@example.com)'
};

// Simple in-memory cache
const cache = {}; // { [station]: { data, lastFetch } }
const trafficCache = {}; // { [lat,lon]: { data, lastFetch } } - separate cache for traffic

// Throttled error logging to avoid log spam
const lastErrorLogTimes = {};
function logThrottled(key, message, intervalMs = 60_000) {
  const now = Date.now();
  if (!lastErrorLogTimes[key] || now - lastErrorLogTimes[key] > intervalMs) {
    console.error(message);
    lastErrorLogTimes[key] = now;
  }
}

// Radar site mapping - maps lat/lon regions to nearest NWS radar site
function getNearestRadarSite(lat, lon) {
  // NWS NEXRAD radar site identifiers - comprehensive US coverage (155+ sites)
  const radarSites = [
    // Northeast
    { name: 'KBOX', minLat: 41.5, maxLat: 43.0, minLon: -72.0, maxLon: -70.0 },  // Boston
    { name: 'KOKX', minLat: 40.0, maxLat: 41.5, minLon: -74.5, maxLon: -72.0 },  // NYC
    { name: 'KENX', minLat: 42.0, maxLat: 43.5, minLon: -75.0, maxLon: -73.0 },  // Albany
    { name: 'KBGM', minLat: 41.5, maxLat: 42.8, minLon: -77.0, maxLon: -75.0 },  // Binghamton
    { name: 'KBUF', minLat: 42.5, maxLat: 43.5, minLon: -79.5, maxLon: -78.0 },  // Buffalo
    { name: 'KTYX', minLat: 42.5, maxLat: 44.0, minLon: -78.5, maxLon: -76.5 },  // Rochester NY (expanded)
    { name: 'KDIX', minLat: 39.0, maxLat: 40.5, minLon: -75.5, maxLon: -73.5 },  // Philadelphia
    { name: 'KDOX', minLat: 38.0, maxLat: 39.5, minLon: -76.5, maxLon: -74.5 },  // Dover
    { name: 'KCCX', minLat: 40.0, maxLat: 41.5, minLon: -79.0, maxLon: -77.0 },  // State College PA
    { name: 'KPBZ', minLat: 39.5, maxLat: 41.0, minLon: -81.0, maxLon: -79.0 },  // Pittsburgh
    
    // Southeast
    { name: 'KAKQ', minLat: 36.0, maxLat: 37.5, minLon: -78.0, maxLon: -76.0 },  // Norfolk
    { name: 'KFCX', minLat: 36.5, maxLat: 38.0, minLon: -81.0, maxLon: -79.5 },  // Roanoke
    { name: 'KMHX', minLat: 34.0, maxLat: 36.0, minLon: -78.0, maxLon: -76.0 },  // Morehead City NC
    { name: 'KRAX', minLat: 35.0, maxLat: 36.5, minLon: -79.5, maxLon: -77.5 },  // Raleigh NC
    { name: 'KLTX', minLat: 33.5, maxLat: 35.0, minLon: -79.5, maxLon: -77.5 },  // Wilmington NC
    { name: 'KGSP', minLat: 34.0, maxLat: 36.5, minLon: -83.0, maxLon: -79.5 },  // Greenville SC/Charlotte (expanded)
    { name: 'KCAE', minLat: 33.0, maxLat: 34.5, minLon: -82.0, maxLon: -80.0 },  // Columbia SC
    { name: 'KCLX', minLat: 32.0, maxLat: 33.5, minLon: -82.0, maxLon: -80.0 },  // Charleston
    { name: 'KBMX', minLat: 32.5, maxLat: 34.5, minLon: -87.5, maxLon: -85.5 },  // Birmingham
    { name: 'KJGX', minLat: 32.0, maxLat: 33.5, minLon: -84.5, maxLon: -82.5 },  // Atlanta
    { name: 'KFFC', minLat: 32.5, maxLat: 34.5, minLon: -85.5, maxLon: -83.5 },  // Peachtree GA
    { name: 'KTLH', minLat: 29.5, maxLat: 31.0, minLon: -85.5, maxLon: -83.5 },  // Tallahassee
    { name: 'KJAX', minLat: 29.5, maxLat: 31.0, minLon: -82.5, maxLon: -80.5 },  // Jacksonville
    { name: 'KMLB', minLat: 27.5, maxLat: 29.0, minLon: -81.5, maxLon: -79.5 },  // Melbourne
    { name: 'KAMX', minLat: 24.5, maxLat: 26.5, minLon: -81.5, maxLon: -79.5 },  // Miami
    { name: 'KBYX', minLat: 23.5, maxLat: 25.5, minLon: -82.5, maxLon: -80.5 },  // Key West
    { name: 'KTBW', minLat: 27.0, maxLat: 28.5, minLon: -83.0, maxLon: -81.5 },  // Tampa
    { name: 'KEVX', minLat: 29.5, maxLat: 31.0, minLon: -87.0, maxLon: -85.0 },  // Eglin AFB
    { name: 'KMOB', minLat: 30.0, maxLat: 31.5, minLon: -89.0, maxLon: -87.5 },  // Mobile
    
    // Midwest
    { name: 'KLOT', minLat: 41.0, maxLat: 42.5, minLon: -89.0, maxLon: -87.0 },  // Chicago
    { name: 'KMKX', minLat: 42.5, maxLat: 44.0, minLon: -89.5, maxLon: -87.5 },  // Milwaukee
    { name: 'KARX', minLat: 43.0, maxLat: 44.5, minLon: -92.0, maxLon: -90.5 },  // La Crosse
    { name: 'KDVN', minLat: 41.0, maxLat: 42.5, minLon: -91.5, maxLon: -89.5 },  // Davenport
    { name: 'KDMX', minLat: 41.0, maxLat: 42.5, minLon: -94.5, maxLon: -92.5 },  // Des Moines
    { name: 'KMPX', minLat: 44.0, maxLat: 46.0, minLon: -95.0, maxLon: -92.5 },  // Minneapolis
    { name: 'KDLH', minLat: 46.0, maxLat: 48.0, minLon: -93.0, maxLon: -91.0 },  // Duluth
    { name: 'KBYX', minLat: 43.0, maxLat: 44.5, minLon: -73.5, maxLon: -71.5 },  // Burlington VT
    { name: 'KGRR', minLat: 42.0, maxLat: 43.5, minLon: -86.5, maxLon: -84.5 },  // Grand Rapids
    { name: 'KIWX', minLat: 40.5, maxLat: 42.0, minLon: -86.5, maxLon: -84.5 },  // Fort Wayne
    { name: 'KIND', minLat: 38.5, maxLat: 40.5, minLon: -87.5, maxLon: -85.5 },  // Indianapolis
    { name: 'KILX', minLat: 39.5, maxLat: 41.0, minLon: -90.0, maxLon: -88.5 },  // Lincoln IL
    { name: 'KLSX', minLat: 37.5, maxLat: 39.5, minLon: -91.5, maxLon: -89.5 },  // St Louis
    { name: 'KEAX', minLat: 38.0, maxLat: 39.5, minLon: -95.5, maxLon: -93.5 },  // Kansas City
    { name: 'KSGF', minLat: 36.5, maxLat: 38.0, minLon: -94.5, maxLon: -92.5 },  // Springfield MO
    { name: 'KDTX', minLat: 42.0, maxLat: 43.5, minLon: -84.5, maxLon: -82.5 },  // Detroit
    { name: 'KCLE', minLat: 40.5, maxLat: 42.0, minLon: -82.5, maxLon: -80.5 },  // Cleveland
    { name: 'KILN', minLat: 38.5, maxLat: 40.0, minLon: -85.5, maxLon: -83.0 },  // Cincinnati (expanded)
    { name: 'KLVX', minLat: 37.0, maxLat: 38.5, minLon: -86.5, maxLon: -85.0 },  // Louisville
    
    // South Central
    { name: 'KPAH', minLat: 36.5, maxLat: 38.0, minLon: -89.5, maxLon: -87.5 },  // Paducah
    { name: 'KNQA', minLat: 34.5, maxLat: 36.0, minLon: -90.5, maxLon: -88.5 },  // Memphis
    { name: 'KLZK', minLat: 34.0, maxLat: 35.5, minLon: -93.0, maxLon: -91.0 },  // Little Rock
    { name: 'KSRX', minLat: 35.5, maxLat: 37.0, minLon: -95.5, maxLon: -93.5 },  // Fort Smith/NW Arkansas (expanded)
    { name: 'KUEX', minLat: 40.0, maxLat: 41.5, minLon: -101.0, maxLon: -99.0 }, // Hastings NE
    { name: 'KGLD', minLat: 40.0, maxLat: 41.5, minLon: -99.5, maxLon: -97.5 }, // Goodland KS/Grand Island NE
    { name: 'KLNX', minLat: 41.0, maxLat: 42.5, minLon: -101.0, maxLon: -99.0 }, // North Platte NE
    { name: 'KOAX', minLat: 40.5, maxLat: 42.0, minLon: -97.0, maxLon: -95.0 },  // Omaha
    { name: 'KTLX', minLat: 35.5, maxLat: 37.0, minLon: -98.5, maxLon: -95.0 },  // Oklahoma City/Tulsa (expanded)
    { name: 'KFDR', minLat: 33.5, maxLat: 35.0, minLon: -100.0, maxLon: -98.0 }, // Altus
    { name: 'KFWS', minLat: 32.0, maxLat: 33.5, minLon: -98.5, maxLon: -96.0 },  // Dallas-Fort Worth
    { name: 'KEWX', minLat: 28.5, maxLat: 30.5, minLon: -99.5, maxLon: -97.0 },  // San Antonio
    { name: 'KGRK', minLat: 30.0, maxLat: 31.5, minLon: -98.5, maxLon: -96.5 },  // Central Texas
    { name: 'KDFX', minLat: 28.5, maxLat: 30.0, minLon: -101.5, maxLon: -99.0 }, // Laughlin AFB
    { name: 'KSJT', minLat: 30.5, maxLat: 32.0, minLon: -101.5, maxLon: -99.5 }, // San Angelo
    { name: 'KMAF', minLat: 31.0, maxLat: 32.5, minLon: -103.5, maxLon: -101.0 }, // Midland
    { name: 'KLBB', minLat: 32.5, maxLat: 34.5, minLon: -103.0, maxLon: -100.5 }, // Lubbock
    { name: 'KAMA', minLat: 34.5, maxLat: 36.5, minLon: -102.5, maxLon: -100.0 }, // Amarillo
    { name: 'KHGX', minLat: 29.0, maxLat: 30.5, minLon: -96.5, maxLon: -94.5 },  // Houston
    { name: 'KSHV', minLat: 31.5, maxLat: 33.0, minLon: -94.5, maxLon: -92.5 },  // Shreveport
    { name: 'KPOE', minLat: 30.5, maxLat: 32.0, minLon: -93.5, maxLon: -92.0 },  // Fort Polk
    { name: 'KLCH', minLat: 29.5, maxLat: 31.0, minLon: -94.0, maxLon: -92.5 },  // Lake Charles
    { name: 'KLIX', minLat: 29.5, maxLat: 31.0, minLon: -90.5, maxLon: -88.5 },  // New Orleans
    { name: 'KOHX', minLat: 35.0, maxLat: 37.0, minLon: -88.0, maxLon: -85.5 },  // Nashville
    
    // Northern Plains
    { name: 'KFSD', minLat: 43.0, maxLat: 44.5, minLon: -97.5, maxLon: -95.5 },  // Sioux Falls
    { name: 'KABR', minLat: 44.5, maxLat: 46.5, minLon: -99.5, maxLon: -97.0 },  // Aberdeen
    { name: 'KUDX', minLat: 43.5, maxLat: 45.0, minLon: -104.0, maxLon: -101.5 }, // Rapid City
    { name: 'KBIS', minLat: 46.0, maxLat: 47.5, minLon: -101.5, maxLon: -99.5 }, // Bismarck
    { name: 'KMVX', minLat: 46.5, maxLat: 48.5, minLon: -98.5, maxLon: -96.0 },  // Grand Forks
    { name: 'KMBX', minLat: 47.5, maxLat: 49.0, minLon: -102.0, maxLon: -99.5 }, // Minot
    { name: 'KGGW', minLat: 47.5, maxLat: 49.0, minLon: -108.0, maxLon: -105.0 }, // Glasgow MT
    { name: 'KTFX', minLat: 46.5, maxLat: 48.5, minLon: -113.0, maxLon: -110.0 }, // Great Falls
    { name: 'KMSX', minLat: 46.0, maxLat: 48.0, minLon: -115.0, maxLon: -112.5 }, // Missoula
    { name: 'KBLX', minLat: 45.5, maxLat: 47.0, minLon: -109.5, maxLon: -107.0 }, // Billings
    
    // Rocky Mountains
    { name: 'KFTG', minLat: 39.0, maxLat: 40.5, minLon: -105.5, maxLon: -103.5 }, // Denver
    { name: 'KGJX', minLat: 38.5, maxLat: 40.0, minLon: -109.5, maxLon: -107.0 }, // Grand Junction
    { name: 'KPUX', minLat: 37.5, maxLat: 39.0, minLon: -105.5, maxLon: -103.5 }, // Pueblo
    { name: 'KCYS', minLat: 40.5, maxLat: 42.0, minLon: -105.5, maxLon: -104.0 }, // Cheyenne
    { name: 'KRIW', minLat: 41.0, maxLat: 44.5, minLon: -110.0, maxLon: -106.0 }, // Riverton WY (expanded)
    { name: 'KCBX', minLat: 43.0, maxLat: 44.5, minLon: -117.5, maxLon: -115.0 }, // Boise
    { name: 'KSFX', minLat: 42.5, maxLat: 44.0, minLon: -113.5, maxLon: -111.5 }, // Pocatello
    { name: 'KMTX', minLat: 40.5, maxLat: 42.0, minLon: -113.5, maxLon: -111.5 }, // Salt Lake City
    { name: 'KICX', minLat: 37.0, maxLat: 38.5, minLon: -113.5, maxLon: -112.0 }, // Cedar City
    
    // Southwest
    { name: 'KABX', minLat: 34.5, maxLat: 36.0, minLon: -107.5, maxLon: -105.5 }, // Albuquerque
    { name: 'KFDX', minLat: 34.0, maxLat: 35.5, minLon: -104.5, maxLon: -102.5 }, // Cannon AFB
    { name: 'KEPZ', minLat: 31.0, maxLat: 32.5, minLon: -107.5, maxLon: -105.5 }, // El Paso
    { name: 'KEMX', minLat: 31.0, maxLat: 32.5, minLon: -111.5, maxLon: -109.5 }, // Tucson
    { name: 'KIWA', minLat: 32.5, maxLat: 34.5, minLon: -113.0, maxLon: -110.5 }, // Phoenix
    { name: 'KFSX', minLat: 34.0, maxLat: 35.5, minLon: -112.5, maxLon: -110.5 }, // Flagstaff
    { name: 'KESX', minLat: 35.0, maxLat: 36.5, minLon: -115.5, maxLon: -114.0 }, // Las Vegas
    { name: 'KLRX', minLat: 40.0, maxLat: 41.5, minLon: -117.5, maxLon: -115.5 }, // Elko
    { name: 'KRGX', minLat: 39.0, maxLat: 40.5, minLon: -120.5, maxLon: -118.5 }, // Reno
    
    // California
    { name: 'KBHX', minLat: 40.0, maxLat: 41.5, minLon: -125.0, maxLon: -123.5 }, // Eureka
    { name: 'KDAX', minLat: 38.0, maxLat: 39.5, minLon: -122.5, maxLon: -120.5 }, // Sacramento
    { name: 'KMUX', minLat: 36.5, maxLat: 38.0, minLon: -122.5, maxLon: -121.0 }, // San Francisco
    { name: 'KHNX', minLat: 35.5, maxLat: 37.0, minLon: -120.5, maxLon: -118.5 }, // San Joaquin
    { name: 'KVTX', minLat: 33.5, maxLat: 35.0, minLon: -120.5, maxLon: -118.5 }, // Los Angeles
    { name: 'KSOX', minLat: 33.0, maxLat: 34.5, minLon: -118.5, maxLon: -116.5 }, // Santa Ana
    { name: 'KNKX', minLat: 32.0, maxLat: 33.5, minLon: -118.0, maxLon: -116.0 }, // San Diego
    { name: 'KYUX', minLat: 32.0, maxLat: 33.5, minLon: -115.5, maxLon: -113.5 }, // Yuma
    
    // Pacific Northwest
    { name: 'KMAX', minLat: 41.5, maxLat: 43.0, minLon: -123.5, maxLon: -121.5 }, // Medford
    { name: 'KPDT', minLat: 45.0, maxLat: 46.5, minLon: -119.5, maxLon: -117.5 }, // Pendleton
    { name: 'KRTX', minLat: 45.0, maxLat: 46.5, minLon: -123.5, maxLon: -122.0 }, // Portland
    { name: 'KATX', minLat: 47.5, maxLat: 49.0, minLon: -123.5, maxLon: -121.5 }, // Seattle
    { name: 'KOTX', minLat: 46.5, maxLat: 48.5, minLon: -118.5, maxLon: -116.5 }, // Spokane
    
    // Alaska (major coverage)
    { name: 'PABC', minLat: 60.0, maxLat: 61.5, minLon: -163.0, maxLon: -160.0 }, // Bethel
    { name: 'PAHG', minLat: 60.0, maxLat: 61.5, minLon: -152.5, maxLon: -150.0 }, // Kenai
    { name: 'PAIH', minLat: 58.5, maxLat: 60.5, minLon: -147.5, maxLon: -145.0 }, // Middleton Island
    { name: 'PAPD', minLat: 64.0, maxLat: 66.0, minLon: -148.5, maxLon: -146.0 }, // Fairbanks
    
    // Hawaii
    { name: 'PHKI', minLat: 21.0, maxLat: 22.5, minLon: -160.5, maxLon: -158.5 }, // Kauai
    { name: 'PHKM', minLat: 19.5, maxLat: 21.0, minLon: -156.5, maxLon: -155.0 }, // Kohala
    { name: 'PHMO', minLat: 20.5, maxLat: 21.5, minLon: -158.0, maxLon: -156.5 }, // Molokai
    { name: 'PHWA', minLat: 18.5, maxLat: 20.0, minLon: -156.5, maxLon: -154.5 }  // South Shore
  ];
  
  // Find matching radar site
  for (const site of radarSites) {
    if (lat >= site.minLat && lat <= site.maxLat && 
        lon >= site.minLon && lon <= site.maxLon) {
      return site.name;
    }
  }
  
  // Regional fallbacks for unmapped areas
  if (lat >= 24 && lat <= 32 && lon >= -88 && lon <= -79) return 'KAMX';  // Florida
  if (lat >= 40 && lat <= 45 && lon >= -90 && lon <= -82) return 'KLOT';  // Great Lakes
  if (lat >= 29 && lat <= 36 && lon >= -103 && lon <= -93) return 'KFWS'; // Texas
  if (lat >= 39 && lat <= 43 && lon >= -75 && lon <= -70) return 'KOKX';  // Northeast
  if (lat >= 38 && lat <= 42 && lon >= -113 && lon <= -104) return 'KFTG'; // Rockies
  if (lat >= 45 && lat <= 49 && lon >= -125 && lon <= -116) return 'KATX'; // Pacific NW
  if (lat >= 32 && lat <= 37 && lon >= -122 && lon <= -114) return 'KMUX'; // California
  
  return 'KFTG';
}

/**
 * Fetch METAR data from Aviation Weather Center
 */
async function getMetar(station) {
  const url = `https://aviationweather.gov/api/data/metar?ids=${station}&format=json`;
  const response = await fetch(url, { headers: AWC_HEADERS });
  
  if (!response.ok) {
    throw new Error(`AWC METAR API error: ${response.status}`);
  }
  
  const data = await response.json();
  
  if (!data || !Array.isArray(data) || data.length === 0) {
    return null;
  }
  
  const feature = data[0];
  
  // Extract coordinates
  let lat, lon;
  if (feature.lat && feature.lon) {
    lat = feature.lat;
    lon = feature.lon;
  } else if (feature.geometry && feature.geometry.coordinates) {
    [lon, lat] = feature.geometry.coordinates;
  }
  
  // Extract properties
  const raw = feature.rawOb || '';
  const time = feature.obsTime || '';
  const windDir = feature.wdir || null;
  const windSpeedKt = feature.wspd || null;
  const windGustKt = feature.wgst || null;
  const visibilitySm = feature.visib || null;
  // Convert altimeter from millibars to inches of mercury (1 mb = 0.02953 inHg)
  const altimHg = feature.altim ? (feature.altim * 0.02953).toFixed(2) : null;
  const tempC = feature.temp || null;
  const dewpointC = feature.dewp || null;
  const flightCategory = feature.fltCat || 'VFR';
  const clouds = feature.clouds || [];
  
  return {
    station: feature.icaoId || station.toUpperCase(),
    lat,
    lon,
    raw,
    time,
    windDir,
    windSpeedKt,
    windGustKt,
    visibilitySm,
    altimHg,
    tempC,
    dewpointC,
    flightCategory,
    clouds
  };
}

/**
 * Fetch TAF data from Aviation Weather Center
 */
async function getTaf(station) {
  const url = `https://aviationweather.gov/api/data/taf?ids=${station}&format=json`;
  const response = await fetch(url, { headers: AWC_HEADERS });
  
  if (!response.ok) {
    throw new Error(`AWC TAF API error: ${response.status}`);
  }
  
  const data = await response.json();
  
  if (!data || !Array.isArray(data) || data.length === 0) {
    return null;
  }
  
  const feature = data[0];
  
  const raw = feature.rawTAF || '';
  const issueTime = feature.issueTime || '';
  const validTimeFrom = feature.validTimeFrom || '';
  const validTimeTo = feature.validTimeTo || '';
  
  // Map fcsts array to periods with proper field names
  const periods = (feature.fcsts || []).map(f => ({
    type: f.fcstChange || 'FM',
    probability: f.probability || null,
    timeFrom: f.timeFrom ? new Date(f.timeFrom * 1000).toISOString() : null,
    timeTo: f.timeTo ? new Date(f.timeTo * 1000).toISOString() : null,
    windDir: f.wdir,
    windSpeedKt: f.wspd,
    windGustKt: f.wgst,
    visibility: f.visib,
    altimMin: f.altim,
    wxString: f.wxString,
    clouds: f.clouds || []
  }));
  
  return {
    raw,
    issueTime,
    validTimeFrom,
    validTimeTo,
    periods
  };
}

// Map ICAO codes to winds aloft 3-letter station codes
// These are actual VOR/NAVAID reporting points, not airports
const WINDS_ALOFT_STATIONS = {
  // Direct matches (airports that are also reporting points)
  'KATL': 'ATL', 'KDEN': 'DEN', 'KLAS': 'LAS', 'KSEA': 'SEA',
  'KMIA': 'MIA', 'KJFK': 'JFK', 'KSFO': 'SFO', 'KBOS': 'BOS',
  'KMSP': 'MSP', 'KSAN': 'SAN', 'KPDX': 'PDX', 'KSTL': 'STL',
  'KCVG': 'CVG', 'KCLE': 'CLE', 'KBNA': 'BNA', 'KIND': 'IND',
  'KCMH': 'CMH', 'KRIC': 'RIC', 'KRDU': 'RDU', 'KMEM': 'MEM',
  'KBDL': 'BDL', 'KBUF': 'BUF', 'KSYR': 'SYR', 'KALB': 'ALB',
  'KSAT': 'SAT', 'KOMA': 'OMA', 'KSLC': 'SLC', 'KPHX': 'PHX',
  'KHOU': 'HOU', 'KLIT': 'LIT', 'KICT': 'ICT', 'KTUL': 'TUL',
  'KOKC': 'OKC', 'KGRB': 'GRB', 'KFAT': 'FAT', 'KRNO': 'RNO',
  'KBOI': 'BOI', 'KELP': 'ELP', 'KABI': 'ABI', 'KABQ': 'ABQ',
  'KTUS': 'TUS', 'KSAV': 'SAV', 'KCHS': 'CHS', 'KBRO': 'BRO',
  'KILM': 'ILM', 'KMOB': 'MOB', 'KJAN': 'JAN', 'KJAX': 'JAX',
  // Regional mappings to nearest reporting point
  'KORD': 'JOT', // Chicago O'Hare -> Joliet
  'KMDW': 'JOT', // Chicago Midway -> Joliet
  'KRFD': 'JOT', // Rockford -> Joliet
  'KPWK': 'JOT', // Chicago Exec -> Joliet
  'KDFW': 'DAL', // DFW -> Dallas
  'KLAX': 'ONT', // LAX -> Ontario
  'KEWR': 'JFK', // Newark -> JFK
  'KLGA': 'JFK', // LaGuardia -> JFK
  'KDCA': 'RIC', // DC -> Richmond
  'KBWI': 'RIC', // Baltimore -> Richmond
  'KIAH': 'HOU', // Houston IAH -> HOU
  'KMCO': 'MLB', // Orlando -> Melbourne
  'KTPA': 'PIE', // Tampa -> St Petersburg
  'KCLT': 'GSP', // Charlotte -> Greenville-Spartanburg
  'KMKE': 'MKG', // Milwaukee -> Muskegon
  'KMSN': 'JOT', // Madison -> Joliet
  'KDTW': 'CLE', // Detroit -> Cleveland
  'KPHL': 'JFK', // Philadelphia -> JFK
  'KPIT': 'CLE', // Pittsburgh -> Cleveland
  'KAUS': 'SAT', // Austin -> San Antonio
  'KMCI': 'MKC', // Kansas City Intl -> Kansas City Downtown
  'KOAK': 'SFO', // Oakland -> San Francisco
  'KSJC': 'SFO', // San Jose -> San Francisco
  'KSMF': 'SAC', // Sacramento Metro -> Sacramento
  'KSNA': 'ONT', // Santa Ana -> Ontario
  'KONT': 'ONT', // Ontario already mapped
  'KBUR': 'ONT'  // Burbank -> Ontario
};

/**
 * Fetch Winds Aloft data from Aviation Weather Center
 * Uses 3-letter station codes, not ICAO
 */
async function getWindsAloft(station) {
  if (!station) {
    return null;
  }
  
  // Convert ICAO to 3-letter code
  const windsStation = WINDS_ALOFT_STATIONS[station];
  if (!windsStation) {
    // Station not mapped - return null silently
    return null;
  }
  
  try {
    // Fetch the winds aloft text data (must include region parameter)
    // Default to 'all' region, 6-hour forecast, low level (3000-24000 ft)
    const url = `https://aviationweather.gov/api/data/windtemp?region=all&fcst=06&level=low`;
    const response = await fetch(url, { headers: AWC_HEADERS });
    
    if (!response.ok) {
      console.error(`AWC Winds Aloft API error: ${response.status}`);
      return null;
    }
    
    const text = await response.text();
    
    if (!text || text.trim().length === 0) {
      return null;
    }
    
    // Parse the text format
    const lines = text.split('\n');
    const altitudes = [3000, 6000, 9000, 12000, 18000, 24000, 30000, 34000, 39000];
    const levels = [];
    
    console.log(`Searching for winds aloft station: ${windsStation} (from ${station})`);
    
    // Find the station's data line
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith(windsStation + ' ')) {
        console.log(`Found winds aloft data for ${windsStation}: ${trimmed.substring(0, 100)}`);
        // Found the station
        const parts = trimmed.split(/\s+/);
        const windData = parts.slice(1); // Skip station identifier
        
        for (let j = 0; j < Math.min(windData.length, altitudes.length); j++) {
          const data = windData[j];
          if (!data || data.length < 4) continue;
          
          let direction, speed, temperature = null;
          
          if (data.includes('+') || data.includes('-')) {
            // Format: 2522+07 or 3042-12
            const match = data.match(/^(\d{2})(\d{2})([+-]\d{2})$/);
            if (match) {
              direction = parseInt(match[1]) * 10;
              speed = parseInt(match[2]);
              temperature = parseInt(match[3]);
            }
          } else if (data.length === 6 && !isNaN(data)) {
            // Format: 325943 (high altitude, temp is negative)
            direction = parseInt(data.substring(0, 2)) * 10;
            speed = parseInt(data.substring(2, 4));
            temperature = -parseInt(data.substring(4, 6));
          } else if (data.length === 4 && !isNaN(data)) {
            // Format: 3213 (just wind, no temp)
            direction = parseInt(data.substring(0, 2)) * 10;
            speed = parseInt(data.substring(2, 4));
          }
          
          if (direction !== undefined && speed !== undefined && !isNaN(direction) && !isNaN(speed)) {
            // Handle light and variable winds
            if (direction >= 990) {
              direction = 'Variable';
            }
            
            levels.push({
              altitude: altitudes[j],
              direction: direction,
              speed: speed,
              temperature: temperature
            });
          }
        }
        break;
      }
    }
    
    if (levels.length === 0) {
      return null;
    }
    
    return {
      station: windsStation,
      levels,
      issueTime: new Date().toISOString()
    };
  } catch (err) {
    console.error('Winds Aloft fetch error:', err.message);
    return null;
  }
}

/**
 * Fetch PIREPs (Pilot Reports) within radius of station
 */
async function getPireps(station, radiusMiles = 100) {
  if (!station) {
    return [];
  }
  
  try {
    // Get PIREPs within radius and last 6 hours
    const url = `https://aviationweather.gov/api/data/pirep?id=${station}&distance=${radiusMiles}&age=6&format=json`;
    const response = await fetch(url, { headers: AWC_HEADERS });
    
    if (!response.ok) {
      console.error(`AWC PIREP API error: ${response.status}`);
      return [];
    }
    
    const data = await response.json();
    
    if (!Array.isArray(data) || data.length === 0) {
      return [];
    }
    
    // Map to simplified format
    return data.map(pirep => ({
      raw: pirep.rawOb || '',
      time: pirep.obsTime || 0,
      location: pirep.icaoId || '',
      lat: pirep.lat,
      lon: pirep.lon,
      altitude: pirep.fltLvl || '',
      aircraft: pirep.acType || '',
      turbulence: pirep.tbInt1 || null,
      turbulenceType: pirep.tbType1 || null,
      icing: pirep.icgInt1 || null,
      icingType: pirep.icgType1 || null,
      temp: pirep.temp || null,
      clouds: pirep.clouds || [],
      weather: pirep.wxString || null
    }));
  } catch (err) {
    console.error('PIREP fetch error:', err.message);
    return [];
  }
}

/**
 * Fetch AIRMETs and SIGMETs within bounding box around lat/lon
 */
async function getAirmetsAndSigmets(lat, lon, radiusDegrees = 3) {
  if (!lat || !lon) {
    return [];
  }
  
  try {
    // Create bounding box (lat-radius, lon-radius, lat+radius, lon+radius)
    const bbox = `${lat - radiusDegrees},${lon - radiusDegrees},${lat + radiusDegrees},${lon + radiusDegrees}`;
    const url = `https://aviationweather.gov/api/data/airsigmet?bbox=${bbox}&format=json`;
    const response = await fetch(url, { headers: AWC_HEADERS });
    
    if (!response.ok) {
      console.error(`AWC AIRMET/SIGMET API error: ${response.status}`);
      return [];
    }
    
    const data = await response.json();
    
    if (!Array.isArray(data) || data.length === 0) {
      return [];
    }
    
    // Map to simplified format
    return data.map(item => ({
      type: item.airSigmetType || 'SIGMET',
      hazard: item.hazard || '',
      severity: item.severity || null,
      validFrom: item.validTimeFrom || 0,
      validTo: item.validTimeTo || 0,
      altitudeLow: item.altitudeLo1 || null,
      altitudeHigh: item.altitudeHi1 || null,
      movementDir: item.movementDir || null,
      movementSpeed: item.movementSpd || null,
      raw: item.rawAirSigmet || '',
      coords: item.coords || []
    }));
  } catch (err) {
    console.error('AIRMET/SIGMET fetch error:', err.message);
    return [];
  }
}

/**
 * Fetch detailed station information
 */
async function getStationInfo(station) {
  if (!station) {
    return null;
  }
  
  try {
    const url = `https://aviationweather.gov/api/data/stationinfo?ids=${station}&format=json`;
    const response = await fetch(url, { headers: AWC_HEADERS });
    
    if (!response.ok) {
      console.error(`AWC Station Info API error: ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    
    if (!Array.isArray(data) || data.length === 0) {
      return null;
    }
    
    const info = data[0];
    return {
      icaoId: info.icaoId || station,
      iataId: info.iataId || '',
      name: info.site || '',
      lat: info.lat || 0,
      lon: info.lon || 0,
      elevation: info.elev || 0,
      state: info.state || '',
      country: info.country || '',
      siteType: info.siteType || []
    };
  } catch (err) {
    console.error('Station Info fetch error:', err.message);
    return null;
  }
}

/**
 * Fetch Graphical AIRMETs (G-AIRMETs)
 */
async function getGairmets(lat, lon) {
  if (!lat || !lon) {
    return [];
  }
  
  try {
    // Try JSON first; on error or bad body, fall back to GeoJSON
    const base = `https://aviationweather.gov/api/data/gairmet?hazard=turb-hi,turb-lo,ice,ifr,mtn_obs,llws,sfc_wind,fzlvl`;
    let jsonData = [];
    try {
      const resp = await fetch(`${base}&format=json`, { headers: AWC_HEADERS });
      if (resp.ok) {
        jsonData = await resp.json();
      } else {
        logThrottled('gairmet-json', `AWC G-AIRMET API error: ${resp.status}`);
      }
    } catch (e) {
      // fall back below
    }

    if (Array.isArray(jsonData) && jsonData.length > 0) {
      const filtered = jsonData.filter(item => {
        if (!item.coords || item.coords.length === 0) return false;
        return item.coords.some(coord => Math.abs(coord.lat - lat) < 3 && Math.abs(coord.lon - lon) < 3);
      });
      return filtered.map(item => ({
        hazard: item.hazard || '',
        product: item.product || '',
        forecastHour: item.forecastHour || 0,
        validTime: item.validTime || '',
        dueToConditions: item.due_to || '',
        coords: item.coords || []
      }));
    }

    // GeoJSON fallback
    const geoResp = await fetch(`${base}&format=geojson`, { headers: { ...AWC_HEADERS, Accept: 'application/geo+json' } });
    if (!geoResp.ok) {
      logThrottled('gairmet-geojson', `AWC G-AIRMET GeoJSON API error: ${geoResp.status}`);
      return [];
    }
    const geo = await geoResp.json();
    const features = Array.isArray(geo?.features) ? geo.features : [];

    const near = features.filter(f => {
      const coords = f?.geometry?.coordinates;
      if (!coords) return false;
      // Polygon -> coords[0] is outer ring [ [lon,lat], ... ]
      const ring = Array.isArray(coords) ? (Array.isArray(coords[0]) ? coords[0] : []) : [];
      return ring.some(pt => Array.isArray(pt) && Math.abs((pt[1] ?? 999) - lat) < 3 && Math.abs((pt[0] ?? 999) - lon) < 3);
    });

    return near.map(f => ({
      hazard: f?.properties?.hazard || '',
      product: f?.properties?.product || '',
      forecastHour: f?.properties?.forecastHour || 0,
      validTime: f?.properties?.validTime || '',
      dueToConditions: f?.properties?.due_to || '',
      coords: (Array.isArray(f?.geometry?.coordinates) ? (f.geometry.coordinates[0] || []) : []).map(pt => ({ lon: pt[0], lat: pt[1] }))
    }));
  } catch (err) {
    console.error('G-AIRMET fetch error:', err.message);
    return [];
  }
}

/**
 * Fetch Center Weather Advisories (CWAs)
 */
async function getCwas(lat, lon) {
  if (!lat || !lon) {
    return [];
  }
  
  try {
    const base = `https://aviationweather.gov/api/data/cwa`;
    let jsonData = [];
    try {
      const resp = await fetch(`${base}?format=json`, { headers: AWC_HEADERS });
      if (resp.ok) {
        jsonData = await resp.json();
      } else {
        logThrottled('cwa-json', `AWC CWA API error: ${resp.status}`);
      }
    } catch (e) {
      // fall back below
    }

    if (Array.isArray(jsonData) && jsonData.length > 0) {
      const filtered = jsonData.filter(item => {
        if (!item.coords || item.coords.length === 0) return false;
        return item.coords.some(coord => Math.abs(coord.lat - lat) < 3 && Math.abs(coord.lon - lon) < 3);
      });
      return filtered.map(item => ({
        cwsu: item.cwsu || '',
        name: item.name || '',
        hazard: item.hazard || '',
        seriesId: item.seriesId || 0,
        validFrom: item.validTimeFrom || 0,
        validTo: item.validTimeTo || 0,
        altitudeLow: item.base || null,
        altitudeHigh: item.top || null,
        rawText: item.rawText || '',
        coords: item.coords || []
      }));
    }

    // GeoJSON fallback
    const geoResp = await fetch(`${base}?format=geojson`, { headers: { ...AWC_HEADERS, Accept: 'application/geo+json' } });
    if (!geoResp.ok) {
      logThrottled('cwa-geojson', `AWC CWA GeoJSON API error: ${geoResp.status}`);
      return [];
    }
    const geo = await geoResp.json();
    const features = Array.isArray(geo?.features) ? geo.features : [];

    const near = features.filter(f => {
      const coords = f?.geometry?.coordinates;
      if (!coords) return false;
      const ring = Array.isArray(coords) ? (Array.isArray(coords[0]) ? coords[0] : []) : [];
      return ring.some(pt => Array.isArray(pt) && Math.abs((pt[1] ?? 999) - lat) < 3 && Math.abs((pt[0] ?? 999) - lon) < 3);
    });

    return near.map(f => ({
      cwsu: f?.properties?.cwsu || '',
      name: f?.properties?.name || '',
      hazard: f?.properties?.hazard || '',
      seriesId: f?.properties?.seriesId || 0,
      validFrom: Date.parse(f?.properties?.validTimeFrom) / 1000 || 0,
      validTo: Date.parse(f?.properties?.validTimeTo) / 1000 || 0,
      altitudeLow: f?.properties?.base || null,
      altitudeHigh: f?.properties?.top || null,
      rawText: f?.properties?.cwaText || '',
      coords: (Array.isArray(f?.geometry?.coordinates) ? (f.geometry.coordinates[0] || []) : []).map(pt => ({ lon: pt[0], lat: pt[1] }))
    }));
  } catch (err) {
    console.error('CWA fetch error:', err.message);
    return [];
  }
}

/**
 * Fetch NWS forecast from lat/lon
 */
async function getNwsForecastFromLatLon(lat, lon) {
  if (!lat || !lon) {
    return null;
  }
  
  try {
    // Step 1: Get the points metadata
    const pointsUrl = `https://api.weather.gov/points/${lat},${lon}`;
    const pointsResponse = await fetch(pointsUrl, { headers: NWS_HEADERS });
    
    if (!pointsResponse.ok) {
      console.error(`NWS points API error: ${pointsResponse.status}`);
      return null;
    }
    
    const pointsData = await pointsResponse.json();
    const forecastUrl = pointsData.properties?.forecast;
    
    if (!forecastUrl) {
      return null;
    }
    
    // Step 2: Get the forecast
    const forecastResponse = await fetch(forecastUrl, { headers: NWS_HEADERS });
    
    if (!forecastResponse.ok) {
      console.error(`NWS forecast API error: ${forecastResponse.status}`);
      return null;
    }
    
    const forecastData = await forecastResponse.json();
    const allPeriods = forecastData.properties?.periods || [];
    
    // Take first 3 periods
    const periods = allPeriods.slice(0, 3).map(p => ({
      name: p.name,
      startTime: p.startTime,
      endTime: p.endTime,
      detailedForecast: p.detailedForecast,
      temp: p.temperature,
      tempUnit: p.temperatureUnit,
      wind: `${p.windSpeed} ${p.windDirection}`,
      shortForecast: p.shortForecast
    }));
    
    return {
      updated: forecastData.properties?.updated || new Date().toISOString(),
      periods
    };
  } catch (err) {
    console.error('NWS forecast error:', err.message);
    return null;
  }
}

/**
 * Fetch ADS-B traffic from OpenSky Network with separate caching
 */
async function getAircraftTraffic(lat, lon, radiusDegrees = 0.5) {
  if (!lat || !lon) {
    return [];
  }
  
  // Create cache key based on rounded coordinates
  const cacheKey = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  
  // Check traffic cache (10 second TTL)
  const cached = trafficCache[cacheKey];
  if (cached && (Date.now() - cached.lastFetch) < TRAFFIC_CACHE_MS) {
    return cached.data;
  }
  
  const lamin = lat - radiusDegrees;
  const lamax = lat + radiusDegrees;
  const lomin = lon - radiusDegrees;
  const lomax = lon + radiusDegrees;
  
  const url = `https://opensky-network.org/api/states/all?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`;
  
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Aviation-TV-Dashboard (your-email@example.com)'
      }
    });
    
    if (!response.ok) {
      logThrottled('opensky', `OpenSky API error: ${response.status}`);
      return cached?.data || []; // Return cached data if available
    }
    
    const data = await response.json();
    const states = data.states || [];
    
    // Map OpenSky format to simpler structure
    const aircraft = states.map(s => ({
      icao24: s[0],
      callsign: (s[1] || '').trim(),
      origin_country: s[2],
      lon: s[5],
      lat: s[6],
      baro_altitude: s[7],
      on_ground: s[8],
      velocity: s[9],
      true_track: s[10],
      vertical_rate: s[11],
      geo_altitude: s[13]
    })).filter(a => a.lat && a.lon); // Only include aircraft with valid position
    
    // Cache the result
    trafficCache[cacheKey] = {
      data: aircraft,
      lastFetch: Date.now()
    };
    
    return aircraft;
    
  } catch (err) {
    console.error('OpenSky fetch error:', err.message);
    return cached?.data || [];
  }
}

/**
 * Get complete dashboard data for a station
 */
async function getDashboardDataForStation(stationRaw) {
  const station = (stationRaw || '').trim().toUpperCase();
  
  // Validate station code
  if (!station || !/^[A-Z0-9]{3,4}$/.test(station)) {
    const error = new Error('Invalid station code. Must be 3-4 alphanumeric characters.');
    error.statusCode = 400;
    throw error;
  }
  
  // Check cache
  const cached = cache[station];
  if (cached && (Date.now() - cached.lastFetch) < CACHE_MS) {
    return cached.data;
  }
  
  // Fetch METAR (required)
  const metar = await getMetar(station);
  
  if (!metar) {
    const error = new Error(`No METAR data found for station ${station}`);
    error.statusCode = 404;
    throw error;
  }
  
  // Fetch all data sources in parallel
  const [taf, nwsForecast, windsAloft, aircraft, pireps, airmetsAndSigmets, stationInfo, gairmets, cwas] = await Promise.all([
    getTaf(station).catch(err => {
      console.error(`TAF fetch error for ${station}:`, err.message);
      return null;
    }),
    getNwsForecastFromLatLon(metar.lat, metar.lon).catch(err => {
      console.error(`NWS forecast error for ${station}:`, err.message);
      return null;
    }),
    getWindsAloft(station).catch(err => {
      console.error(`Winds Aloft fetch error for ${station}:`, err.message);
      return null;
    }),
    getAircraftTraffic(metar.lat, metar.lon).catch(err => {
      console.error(`Aircraft traffic error for ${station}:`, err.message);
      return [];
    }),
    getPireps(station, 100).catch(err => {
      console.error(`PIREPs fetch error for ${station}:`, err.message);
      return [];
    }),
    getAirmetsAndSigmets(metar.lat, metar.lon, 3).catch(err => {
      console.error(`AIRMETs/SIGMETs fetch error for ${station}:`, err.message);
      return [];
    }),
    getStationInfo(station).catch(err => {
      console.error(`Station Info fetch error for ${station}:`, err.message);
      return null;
    }),
    getGairmets(metar.lat, metar.lon).catch(err => {
      console.error(`G-AIRMET fetch error for ${station}:`, err.message);
      return [];
    }),
    getCwas(metar.lat, metar.lon).catch(err => {
      console.error(`CWA fetch error for ${station}:`, err.message);
      return [];
    })
  ]);
  
  // Get radar site for this location
  const radarSite = getNearestRadarSite(metar.lat, metar.lon);
  const radarUrl = `https://radar.weather.gov/ridge/standard/${radarSite}_loop.gif`;
  
  // Get runways for this station
  const runways = RUNWAY_DATA[station] || [];
  
  // Construct payload
  const payload = {
    station: metar.station,
    location: {
      lat: metar.lat,
      lon: metar.lon
    },
    metar,
    taf,
    nwsForecast,
    windsAloft,
    radar: {
      site: radarSite,
      url: radarUrl
    },
    aircraft,
    pireps,
    airmetsAndSigmets,
      stationInfo,
      gairmets,
      cwas,
    runways,
    lastUpdated: new Date().toISOString()
  };
  
  // Cache it
  cache[station] = {
    data: payload,
    lastFetch: Date.now()
  };
  
  return payload;
}

// Routes
app.get('/api/dashboard/krfd', async (req, res) => {
  try {
    const data = await getDashboardDataForStation('KRFD');
    res.json(data);
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: err.message });
  }
});

app.get('/api/dashboard/:station', async (req, res) => {
  try {
    const station = req.params.station || 'KRFD';
    const data = await getDashboardDataForStation(station);
    res.json(data);
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: err.message });
  }
});

// Separate endpoint for traffic updates (faster refresh)
app.get('/api/traffic/:station', async (req, res) => {
  try {
    const station = (req.params.station || 'KRFD').trim().toUpperCase();
    
    // Get METAR for coordinates (use cache if available)
    const cached = cache[station];
    if (!cached || !cached.data?.metar) {
      return res.status(404).json({ error: 'Station not found. Request full dashboard first.' });
    }
    
    const { lat, lon } = cached.data.metar;
    const aircraft = await getAircraftTraffic(lat, lon);
    
    res.json({ 
      aircraft,
      lastUpdated: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Aviation weather backend listening on port ${PORT}`);
});
