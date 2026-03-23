import { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import logo from './assets/logo.png';

// Fix for default marker icons in Leaflet with Vite
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// LiveATC mount point mapping (ICAO -> mount point)
const LIVEATC_FEEDS = {
  'KRFD': 'krfd',
  'KORD': 'kord',
  'KMDW': 'kmdw',
  'KMSN': 'kmsn',
  'KMKE': 'kmke',
  'KATL': 'katl',
  'KJFK': 'kjfk',
  'KEWR': 'kewr',
  'KLGA': 'klga',
  'KLAX': 'klax',
  'KSFO': 'ksfo',
  'KDEN': 'kden',
  'KDFW': 'kdfw',
  'KIAH': 'kiah',
  'KPHX': 'kphx',
  'KSEA': 'ksea',
  'KBOS': 'kbos',
  'KMIA': 'kmia',
  'KCLT': 'kclt',
  'KLAS': 'klas',
  'KMSP': 'kmsp',
  'KDTW': 'kdtw',
  'KPHL': 'kphl',
  'KBWI': 'kbwi',
  'KSLC': 'kslc',
  'KDCA': 'kdca',
  'KIAD': 'kiad',
  'KSAN': 'ksan',
  'KTPA': 'ktpa',
  'KPDX': 'kpdx',
  'KSTL': 'kstl',
  'KCVG': 'kcvg',
  'KCLE': 'kcle',
  'KPIT': 'kpit',
  'KAUS': 'kaus',
  'KSAT': 'ksat',
  'KMCI': 'kmci',
  'KOAK': 'koak',
  'KSJC': 'ksjc',
  'KRDU': 'krdu',
  'KMEM': 'kmem',
  'KBNA': 'kbna',
  'KIND': 'kind',
  'KCMH': 'kcmh',
  'KBDL': 'kbdl',
  'KPVD': 'kpvd',
  'KRIC': 'kric',
  'KROC': 'kroc',
  'KBUF': 'kbuf',
  'KSYR': 'ksyr',
  'KALB': 'kalb',
  'KGRR': 'kgrr',
};

// Custom airplane icon
const createAirplaneIcon = (heading, isOnGround) => {
  const color = isOnGround ? '#666666' : '#0066ff';
  const rotation = heading || 0;
  
  return L.divIcon({
    html: `<div style="transform: rotate(${rotation}deg); font-size: 20px; line-height: 1; filter: drop-shadow(0 0 2px rgba(0,0,0,0.8));">${isOnGround ? '🛬' : '✈️'}</div>`,
    className: 'airplane-icon',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
};

function App() {
  // Load saved station from localStorage, default to KRFD
  const savedStation = localStorage.getItem('selectedStation') || 'KRFD';
  const [station, setStation] = useState(savedStation);
  const [inputStation, setInputStation] = useState(savedStation);
  const [recentStations, setRecentStations] = useState([]);
  const [data, setData] = useState(null);
  const [metar, setMetar] = useState(null);
  const [taf, setTaf] = useState(null);
  const [local, setLocal] = useState('—');
  const [zulu, setZulu] = useState('—');
  const [showGairmets, setShowGairmets] = useState(false);
  const [showCwas, setShowCwas] = useState(false);
  const [showStationInfo, setShowStationInfo] = useState(false);
  const [showPireps, setShowPireps] = useState(false);
  const [showSigmets, setShowSigmets] = useState(false);
  const [showMap, setShowMap] = useState(true);
  const [radar, setRadar] = useState(null);
  const [location, setLocation] = useState(null);
  const [aircraft, setAircraft] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  
  // Load recent stations from localStorage
  const loadRecentStations = () => {
    const saved = localStorage.getItem('recentStations');
    try {
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed.slice(0, 10) : [];
    } catch {
      return [];
    }
  };

  // Basic clock updates
  useEffect(() => {
    const updateClocks = () => {
      const now = new Date();
      setLocal(now.toLocaleString());
      setZulu(now.toUTCString());
    };
    updateClocks();
    const clockInterval = setInterval(updateClocks, 1000);
    return () => clearInterval(clockInterval);
  }, []);

  // Data loaders (stubs if backend route unknown in this context)
  const loadData = async (icao) => {
    try {
      setIsLoading(true);
      const resp = await fetch(`/api/dashboard/${icao}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      setData(json);
      setLocation(json?.location || null);
      setRadar(json?.radar || null);
      setAircraft(Array.isArray(json?.aircraft) ? json.aircraft : []);
      setMetar(json?.metar || null);
      if (json?.taf) {
        setTaf(json.taf);
      } else {
        setTaf(null);
      }
      // maintain recent stations
      const rec = loadRecentStations();
      const next = [icao, ...rec.filter((s) => s !== icao)].slice(0, 10);
      setRecentStations(next);
      localStorage.setItem('recentStations', JSON.stringify(next));
      localStorage.setItem('selectedStation', icao);
      setStation(icao);
      setInputStation(icao);
    } catch (e) {
      console.error('loadData error', e);
    } finally {
      setIsLoading(false);
    }
  };

  const loadTraffic = async (icao) => {
    try {
      const resp = await fetch(`/api/traffic/${icao}`);
      if (!resp.ok) return;
      const json = await resp.json();
      if (Array.isArray(json?.aircraft)) {
        setAircraft(json.aircraft);
      }
    } catch (err) {
      console.error('loadTraffic error', err);
    }
  };

  const handleStationSubmit = (e) => {
    e.preventDefault();
    const next = (inputStation || '').toUpperCase();
    if (next && next.length === 4) {
      loadData(next);
    }
  };

  const handleQuickSelect = (s) => {
    if (s) loadData(s);
  };

  useEffect(() => {
    // Load the saved station on mount
    loadData(savedStation);
    
    const dataInterval = setInterval(() => {
      loadData(station);
    }, 60000);
    
    // Separate faster interval for traffic updates (10 seconds)
    const trafficInterval = setInterval(() => {
      // If there's a traffic fetch function, call it; otherwise noop
      if (typeof loadTraffic === 'function') {
        loadTraffic(station);
      }
    }, 10000);

    return () => {
      clearInterval(dataInterval);
      clearInterval(trafficInterval);
    };
  }, [savedStation, station]);

  const advisoryColor = (t) => {
    if (t === 'sigmet') return '#dc2626';
    return '#a855f7';
  };
  const flightCat = (metar?.flightCategory || 'VFR').toLowerCase();
  
  // Helper component to recenter map when location changes
  function RecenterMap({ center }) {
    const map = useMap();
    useEffect(() => {
      if (center) {
        map.setView(center, 9);
      }
    }, [center, map]);
    return null;
  }

  const formatDateTime = (isoString) => {
    if (!isoString) return '—';
    try {
      return new Date(isoString).toLocaleString();
    } catch {
      return isoString;
    }
  };

  const formatTafTime = (timeStr) => {
    if (!timeStr) return '';
    // TAF times are in format like "2025-11-26T18:00:00Z"
    try {
      const date = new Date(timeStr);
      const day = date.getUTCDate().toString().padStart(2, '0');
      const hours = date.getUTCHours().toString().padStart(2, '0');
      const mins = date.getUTCMinutes().toString().padStart(2, '0');
      return `${day}/${hours}${mins}Z`;
    } catch {
      return timeStr;
    }
  };

  const getWeatherIcon = (shortForecast) => {
    if (!shortForecast) return '☀️';
    const forecast = shortForecast.toLowerCase();
    
    // Precipitation
    if (forecast.includes('thunder') || forecast.includes('t-storm')) return '⛈️';
    if (forecast.includes('snow') && forecast.includes('rain')) return '🌨️';
    if (forecast.includes('snow') || forecast.includes('flurries')) return '❄️';
    if (forecast.includes('rain') || forecast.includes('shower')) return '🌧️';
    if (forecast.includes('drizzle')) return '🌦️';
    if (forecast.includes('sleet') || forecast.includes('ice')) return '🌨️';
    if (forecast.includes('fog') || forecast.includes('mist')) return '🌫️';
    
    // Cloud coverage
    if (forecast.includes('partly') || forecast.includes('mostly sunny')) return '⛅';
    if (forecast.includes('cloudy') || forecast.includes('overcast')) return '☁️';
    if (forecast.includes('clear') || forecast.includes('sunny')) return '☀️';
    
    // Wind
    if (forecast.includes('windy') || forecast.includes('breezy')) return '💨';
    
    // Default based on time (day vs night)
    return '☀️';
  };

  return (
    <div className="app">
      {/* Top Bar */}
      <div className={`topbar topbar--${flightCat}`}>
        <div className="topbar__left">
          <img src={logo} alt="Chapter Logo" className="topbar__logo" />
          <div className="topbar__title">
            {data?.station || station} Flight Weather
            {data?.stationInfo && (
              <button 
                className="station-info-btn"
                onClick={() => setShowStationInfo(true)}
                title="View station details"
              >
                ℹ️
              </button>
            )}
          </div>
          <div className="topbar__subtitle">
            Last update: {data ? formatDateTime(data.lastUpdated) : '—'}
          </div>
        </div>
        
        <div className="topbar__center">
          <div className="topbar__clock">
            <div className="topbar__clock-row">Local: {local}</div>
            <div className="topbar__clock-row">Z: {zulu}</div>
          </div>
        </div>
        
        <div className="topbar__right">
          <div className="topbar__fltcat-label">Flight Category</div>
          <div className="topbar__fltcat-value">
            {metar?.flightCategory || 'N/A'}
          </div>
        </div>
      </div>

      

      {/* Station Selector Bar */}
      <div className="station-bar">
        <div className="station-form">
          <form onSubmit={handleStationSubmit}>
            <label htmlFor="station-input" className="station-label">
              Airport (ICAO):
            </label>
            <input
              id="station-input"
              type="text"
              className="station-input"
              value={inputStation}
              onChange={(e) => setInputStation(e.target.value.toUpperCase())}
              maxLength={4}
              placeholder="KRFD"
            />
            <button type="submit" className="station-button">
              Go
            </button>
          </form>
        </div>
        
        <div className="station-quick">
          <span className="station-quick-label">Recent:</span>
          {recentStations.map((s, idx) => (
            <button
              key={`${s}-${idx}`}
              className="station-button station-button--quick"
              onClick={() => handleQuickSelect(s)}
            >
              {s}
            </button>
          ))}
        </div>
        
        {/* LiveATC Audio Player */}
        <div className="station-audio">
          <div className="audio-label">🎧 LiveATC:</div>
          {LIVEATC_FEEDS[station] ? (
            <a 
              href={`https://www.liveatc.net/search/?icao=${station}`}
              target="_blank"
              rel="noopener noreferrer"
              className="audio-link"
              title={`Listen to ${station} on LiveATC`}
            >
              <span className="audio-link-icon">▶️</span>
              <span className="audio-link-text">Listen Live</span>
            </a>
          ) : (
            <div className="audio-unavailable">
              No feed available
            </div>
          )}
      
              {/* G-AIRMETs Modal */}
              {showGairmets && data?.gairmets && (
                <div className="modal-overlay" onClick={() => setShowGairmets(false)}>
                  <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                    <div className="modal-header">
                      <h2>Graphical AIRMETs (G-AIRMETs)</h2>
                      <button className="modal-close" onClick={() => setShowGairmets(false)}>×</button>
                    </div>
                    <div className="modal-body">
                      {data.gairmets.map((gairmet, idx) => (
                        <div key={idx} className="advisory-item">
                          <div className="advisory-header">
                            <span className={`advisory-type advisory-type--gairmet`}>
                              {gairmet.product || 'G-AIRMET'}
                            </span>
                            <span className="advisory-hazard">{gairmet.hazard}</span>
                          </div>
                          <div className="advisory-details">
                            <span>Forecast Hour: +{gairmet.forecastHour}h</span>
                            {gairmet.validTime && (
                              <span>Valid: {new Date(gairmet.validTime).toLocaleString()}</span>
                            )}
                          </div>
                          {gairmet.dueToConditions && (
                            <div className="advisory-raw">Conditions: {gairmet.dueToConditions}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
      
              {/* CWAs Modal */}
              {showCwas && data?.cwas && (
                <div className="modal-overlay" onClick={() => setShowCwas(false)}>
                  <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                    <div className="modal-header">
                      <h2>Center Weather Advisories (CWAs)</h2>
                      <button className="modal-close" onClick={() => setShowCwas(false)}>×</button>
                    </div>
                    <div className="modal-body">
                      {data.cwas.map((cwa, idx) => (
                        <div key={idx} className="advisory-item">
                          <div className="advisory-header">
                            <span className={`advisory-type advisory-type--cwa`}>
                              {cwa.cwsu} - {cwa.name}
                            </span>
                            <span className="advisory-hazard">{cwa.hazard}</span>
                          </div>
                          <div className="advisory-details">
                            <span>Series: {cwa.seriesId}</span>
                            {cwa.altitudeLow && cwa.altitudeHigh && (
                              <span>Alt: {cwa.altitudeLow}-{cwa.altitudeHigh} ft</span>
                            )}
                            {cwa.validFrom && cwa.validTo && (
                              <span>
                                Valid: {new Date(cwa.validFrom * 1000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}Z - 
                                {new Date(cwa.validTo * 1000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}Z
                              </span>
                            )}
                          </div>
                          <div className="advisory-raw">{cwa.rawText}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
      
              {/* Station Info Modal */}
              {showStationInfo && data?.stationInfo && (
                <div className="modal-overlay" onClick={() => setShowStationInfo(false)}>
                  <div className="modal-content modal-content--narrow" onClick={(e) => e.stopPropagation()}>
                    <div className="modal-header">
                      <h2>Station Information</h2>
                      <button className="modal-close" onClick={() => setShowStationInfo(false)}>×</button>
                    </div>
                    <div className="modal-body">
                      <div className="station-info">
                        <div className="station-info-row">
                          <span className="station-info-label">ICAO ID:</span>
                          <span className="station-info-value">{data.stationInfo.icaoId}</span>
                        </div>
                        {data.stationInfo.iataId && (
                          <div className="station-info-row">
                            <span className="station-info-label">IATA ID:</span>
                            <span className="station-info-value">{data.stationInfo.iataId}</span>
                          </div>
                        )}
                        <div className="station-info-row">
                          <span className="station-info-label">Name:</span>
                          <span className="station-info-value">{data.stationInfo.name}</span>
                        </div>
                        <div className="station-info-row">
                          <span className="station-info-label">Location:</span>
                          <span className="station-info-value">
                            {data.stationInfo.state && `${data.stationInfo.state}, `}
                            {data.stationInfo.country}
                          </span>
                        </div>
                        <div className="station-info-row">
                          <span className="station-info-label">Coordinates:</span>
                          <span className="station-info-value">
                            {data.stationInfo.lat.toFixed(4)}°, {data.stationInfo.lon.toFixed(4)}°
                          </span>
                        </div>
                        <div className="station-info-row">
                          <span className="station-info-label">Elevation:</span>
                          <span className="station-info-value">{data.stationInfo.elevation} m ({Math.round(data.stationInfo.elevation * 3.28084)} ft)</span>
                        </div>
                        {data.stationInfo.siteType && data.stationInfo.siteType.length > 0 && (
                          <div className="station-info-row">
                            <span className="station-info-label">Services:</span>
                            <span className="station-info-value">{data.stationInfo.siteType.join(', ')}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
        </div>
        
        {/* PIREPs, SIGMET, and TFR Badges */}
        {data && (
          <div className="station-alerts">
            {data.pireps && data.pireps.length > 0 && (
              <button 
                className="alert-badge alert-badge--pirep"
                onClick={() => setShowPireps(true)}
                title={`${data.pireps.length} Pilot Report(s)`}
              >
                📋 PIREPs ({data.pireps.length})
              </button>
            )}
            {data.airmetsAndSigmets && data.airmetsAndSigmets.length > 0 && (
              <button 
                className="alert-badge alert-badge--sigmet"
                onClick={() => setShowSigmets(true)}
                title={`${data.airmetsAndSigmets.length} AIRMET/SIGMET(s)`}
              >
                ⚠️ Advisories ({data.airmetsAndSigmets.length})
                          {data.gairmets && data.gairmets.length > 0 && (
                            <button 
                              className="alert-badge alert-badge--gairmet"
                              onClick={() => setShowGairmets(true)}
                              title={`${data.gairmets.length} Graphical AIRMET(s)`}
                            >
                              🌤️ G-AIRMETs ({data.gairmets.length})
                            </button>
                          )}
                          {data.cwas && data.cwas.length > 0 && (
                            <button 
                              className="alert-badge alert-badge--cwa"
                              onClick={() => setShowCwas(true)}
                              title={`${data.cwas.length} Center Weather Advisor(ies)`}
                            >
                              📡 CWAs ({data.cwas.length})
                            </button>
                          )}
              </button>
            )}
            <a 
              href="https://tfr.faa.gov/tfr2/list.html"
              target="_blank"
              rel="noopener noreferrer"
              className="alert-badge alert-badge--tfr"
              title="View active TFRs (Temporary Flight Restrictions)"
            >
              🚫 TFRs
            </a>
          </div>
        )}
        
        {/* Compact Forecast */}
        {data?.nwsForecast && data.nwsForecast.periods && (
          <div className="station-forecast">
            {data.nwsForecast.periods.map((p, i) => (
              <div key={i} className="forecast-compact" title={p.shortForecast}>
                <div className="forecast-compact__name">{p.name}</div>
                <div className="forecast-compact__icon">{getWeatherIcon(p.shortForecast)}</div>
                <div className="forecast-compact__temp">{p.temp}°{p.tempUnit}</div>
              </div>
            ))}
          </div>
        )}
        
        <div className="station-status">
          {isLoading && <span className="station-loading">Loading…</span>}
          {/* Optional error rendering if you track one */}
        </div>
      </div>

      {/* Main Layout */}
      <div className="layout">
        {/* Left Panel: METAR */}
        <div className="panel panel--metar">
          <h2 className="panel__title">Current METAR</h2>
          {!metar && <p className="panel__empty">No METAR data</p>}
          {metar && (
            <>
              <div className="metar-raw">{metar.raw}</div>
              <div className="metar-grid">
                <div className="metar-grid__item">
                  <div className="metar-grid__label">Wind</div>
                  <div className="metar-grid__value">
                    {metar.windDir !== null && metar.windSpeedKt !== null
                      ? `${metar.windDir}° @ ${metar.windSpeedKt} kt`
                      : 'Calm'}
                    {metar.windGustKt && ` G${metar.windGustKt} kt`}
                  </div>
                </div>
                
                <div className="metar-grid__item">
                  <div className="metar-grid__label">Visibility</div>
                  <div className="metar-grid__value">
                    {metar.visibilitySm !== null
                      ? `${metar.visibilitySm} sm`
                      : '—'}
                  </div>
                </div>
                
                <div className="metar-grid__item">
                  <div className="metar-grid__label">Temp / Dewpoint</div>
                  <div className="metar-grid__value">
                    {metar.tempC !== null && metar.dewpointC !== null
                      ? `${metar.tempC}°C / ${metar.dewpointC}°C`
                      : '—'}
                  </div>
                </div>
                
                <div className="metar-grid__item">
                  <div className="metar-grid__label">Altimeter</div>
                  <div className="metar-grid__value">
                    {metar.altimHg !== null ? `${metar.altimHg}"` : '—'}
                  </div>
                </div>
                
                <div className="metar-grid__item">
                  <div className="metar-grid__label">Clouds</div>
                  <div className="metar-grid__value">
                    {metar.clouds && metar.clouds.length > 0
                      ? metar.clouds
                          .map((c) => `${c.cover} ${c.base || ''}`.trim())
                          .join(', ')
                      : 'CLR'}
                  </div>
                </div>
              </div>
              
            </>
          )}
        </div>

        {/* Center Panel: TAF */}
        <div className="panel panel--taf">
          <h2 className="panel__title">TAF</h2>
          {!taf && <p className="panel__empty">No TAF data</p>}
          {taf && (
            <>
              <div className="taf-raw">{taf.raw}</div>
              <div className="taf-periods">
                {taf.periods && taf.periods.slice(0, 5).map((p, i) => (
                  <div key={i} className="taf-period">
                    <div className="taf-period__time">
                      <strong>{p.type || 'Period'}</strong>
                      {p.probability && ` (${p.probability}%)`}
                      {p.timeFrom && p.timeTo && (
                        <span className="taf-period__timerange">
                          {' '}{formatTafTime(p.timeFrom)} - {formatTafTime(p.timeTo)}
                        </span>
                      )}
                    </div>
                    <div className="taf-period__decoded">
                      {p.windDir !== null && p.windSpeedKt !== null && (
                        <div className="taf-decode-item">
                          <span className="taf-decode-label">Wind:</span>
                          <span className="taf-decode-value">
                            {p.windDir}° @ {p.windSpeedKt} kt
                            {p.windGustKt && ` gusting ${p.windGustKt} kt`}
                          </span>
                        </div>
                      )}
                      {p.visibility !== null && p.visibility !== undefined && (
                        <div className="taf-decode-item">
                          <span className="taf-decode-label">Visibility:</span>
                          <span className="taf-decode-value">{p.visibility} sm</span>
                        </div>
                      )}
                      {p.clouds && p.clouds.length > 0 && (
                        <div className="taf-decode-item">
                          <span className="taf-decode-label">Clouds:</span>
                          <span className="taf-decode-value">
                            {p.clouds.map((c) => `${c.cover} ${c.base || ''}`.trim()).join(', ')}
                          </span>
                        </div>
                      )}
                      {p.wxString && (
                        <div className="taf-decode-item">
                          <span className="taf-decode-label">Weather:</span>
                          <span className="taf-decode-value">{p.wxString}</span>
                        </div>
                      )}
                      {p.altimMin && (
                        <div className="taf-decode-item">
                          <span className="taf-decode-label">Altimeter:</span>
                          <span className="taf-decode-value">{p.altimMin}"</span>
                        </div>
                      )}
                    </div>

                    {/* Visuals Modal removed from TAF section (duplicate) */}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Third Panel: Winds Aloft */}
        <div className="panel panel--winds">
          <h2 className="panel__title">
            Winds Aloft
            {data?.windsAloft?.station && <span className="panel__subtitle"> ({data.windsAloft.station})</span>}
          </h2>
          {!data?.windsAloft && <p className="panel__empty">No winds aloft data</p>}
          {data?.windsAloft && data.windsAloft.levels && (
            <div className="winds-container">
              <table className="winds-table">
                <thead>
                  <tr>
                    <th>Altitude</th>
                    <th>Wind</th>
                    <th>Temp</th>
                  </tr>
                </thead>
                <tbody>
                  {data.windsAloft.levels.map((level, i) => (
                    <tr key={i}>
                      <td className="winds-altitude">{level.altitude.toLocaleString()} ft</td>
                      <td className="winds-wind">
                        {level.direction === 'Variable' ? 'VRB' : `${level.direction}°`} @ {level.speed} kt
                      </td>
                      <td className="winds-temp">
                        {level.temperature !== null ? (
                          <>{level.temperature > 0 ? '+' : ''}{level.temperature}°C</>
                        ) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Fourth Panel: Radar / Traffic Map */}
        <div className="panel panel--radar">
          <div className="panel__header">
            <h2 className="panel__title">
              {showMap ? 'Live Traffic' : 'Regional Radar'}
            </h2>
            <button 
              className="panel__toggle"
              onClick={() => setShowMap(!showMap)}
            >
              {showMap ? '📡 Show Radar' : '✈️ Show Traffic'}
            </button>
          </div>
          
          {!showMap && (
            <>
              {!radar && <p className="panel__empty">Radar not available</p>}
              {radar && (
                <div className="radar-container">
                  <div className="radar-info">
                    Site: {radar.site.toUpperCase()}
                  </div>
                  <img 
                    key={radar.site}
                    src={`${radar.url}?t=${Date.now()}`}
                    alt="Weather Radar" 
                    className="radar-image"
                    onError={(e) => {
                      e.target.style.display = 'none';
                      e.target.nextSibling.style.display = 'block';
                    }}
                  />
                  <div className="radar-error" style={{display: 'none'}}>
                    Radar image unavailable
                  </div>
                </div>
              )}
            </>
          )}
          
          {showMap && location && (
            <div className="map-container">
              <div className="map-info">
                Aircraft: {aircraft.length} • Radius: ~30nm
              </div>
              <MapContainer 
                center={[location.lat, location.lon]} 
                zoom={9} 
                className="traffic-map"
                key={`${location.lat}-${location.lon}`}
              >
                <TileLayer
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                />
                <RecenterMap center={[location.lat, location.lon]} />
                
                {/* Airport marker */}
                <Marker position={[location.lat, location.lon]}>
                  <Popup>
                    <strong>{data.station}</strong><br />
                    {metar?.raw?.substring(0, 30)}...
                  </Popup>
                </Marker>
                
                {/* Aircraft markers */}
                {aircraft.map((ac, idx) => {
                  if (!ac.lat || !ac.lon) return null;
                  
                  const altFt = ac.baro_altitude ? Math.round(ac.baro_altitude * 3.28084) : 0;
                  const speedKt = ac.velocity ? Math.round(ac.velocity * 1.94384) : 0;
                  const heading = ac.true_track || 0;
                  
                  return (
                    <Marker
                      key={ac.icao24 + idx}
                      position={[ac.lat, ac.lon]}
                      icon={createAirplaneIcon(heading, ac.on_ground)}
                    >
                      <Popup>
                        <strong>{ac.callsign || ac.icao24}</strong><br />
                        ICAO24: {ac.icao24}<br />
                        {!ac.on_ground && (
                          <>
                            Altitude: {altFt.toLocaleString()} ft<br />
                            Speed: {speedKt} kt<br />
                            Heading: {ac.true_track ? Math.round(ac.true_track) : '—'}°<br />
                          </>
                        )}
                        {ac.on_ground && <span>On Ground</span>}
                        <br />
                        Origin: {ac.origin_country}
                      </Popup>
                    </Marker>
                  );
                })}
              </MapContainer>
            </div>
          )}
        </div>
      </div>
      
      {/* PIREPs Modal */}
      {showPireps && data?.pireps && (
        <div className="modal-overlay" onClick={() => setShowPireps(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Pilot Reports (PIREPs)</h2>
              <button className="modal-close" onClick={() => setShowPireps(false)}>×</button>
            </div>
            <div className="modal-body">
              {data.pireps.map((pirep, idx) => (
                <div key={idx} className="pirep-item">
                  <div className="pirep-header">
                    <span className="pirep-location">{pirep.location || 'Unknown'}</span>
                    <span className="pirep-time">{new Date(pirep.time * 1000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}Z</span>
                    {pirep.altitude && <span className="pirep-altitude">FL{pirep.altitude}</span>}
                  </div>
                  {(pirep.turbulence || pirep.icing) && (
                    <div className="pirep-conditions">
                      {pirep.turbulence && (
                        <span className={`pirep-badge pirep-badge--turb-${pirep.turbulence.toLowerCase()}`}>
                          💨 TURB: {pirep.turbulence}
                        </span>
                      )}
                      {pirep.icing && (
                        <span className={`pirep-badge pirep-badge--ice-${pirep.icing.toLowerCase()}`}>
                          ❄️ ICE: {pirep.icing}
                        </span>
                      )}
                    </div>
                  )}
                  <div className="pirep-raw">{pirep.raw}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      
      {/* AIRMETs/SIGMETs Modal */}
      {showSigmets && data?.airmetsAndSigmets && (
        <div className="modal-overlay" onClick={() => setShowSigmets(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Weather Advisories</h2>
              <button className="modal-close" onClick={() => setShowSigmets(false)}>×</button>
            </div>
            <div className="modal-body">
              {data.airmetsAndSigmets.map((advisory, idx) => (
                <div key={idx} className="advisory-item">
                  <div className="advisory-header">
                    <span className={`advisory-type advisory-type--${advisory.type.toLowerCase()}`}>
                      {advisory.type}
                    </span>
                    <span className="advisory-hazard">{advisory.hazard}</span>
                  </div>
                  <div className="advisory-details">
                    {advisory.altitudeLow && advisory.altitudeHigh && (
                      <span>Alt: {advisory.altitudeLow}-{advisory.altitudeHigh} ft</span>
                    )}
                    {advisory.validFrom && advisory.validTo && (
                      <span>
                        Valid: {new Date(advisory.validFrom * 1000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}Z - 
                        {new Date(advisory.validTo * 1000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}Z
                      </span>
                    )}
                  </div>
                  <div className="advisory-raw">{advisory.raw}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
/* cache bust 1764479590 */
