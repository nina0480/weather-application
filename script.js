/* =========================================================
   Nimbus Weather Dashboard — script.js
   Uses OpenWeatherMap API (free tier):
     - Current weather: /data/2.5/weather
     - 5-day / 3-hour forecast: /data/2.5/forecast
   ========================================================= */

// ──────────────────────────────────────────────────────────
// 🔑  CONFIGURATION
//  1. Sign up at https://openweathermap.org/api
//  2. Copy your free API key
//  3. Replace the string below with your key
// ──────────────────────────────────────────────────────────
const API_KEY = 'YOUR_API_KEY_HERE';   // ← paste your key here
const BASE    = 'https://api.openweathermap.org/data/2.5';

// ──────────────────────────────────────────────────────────
// 🗄️  STATE
// ──────────────────────────────────────────────────────────
const state = {
  unit:        'C',          // 'C' or 'F'
  theme:       'dark',       // 'dark' or 'light'
  recentMax:   5,
  // Raw Celsius data saved so unit switching doesn't re-fetch
  rawCurrent:  null,
  rawForecast: null,
};

// ──────────────────────────────────────────────────────────
// 🔎  DOM REFERENCES
// ──────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const cityInput    = $('cityInput');
const searchBtn    = $('searchBtn');
const locateBtn    = $('locateBtn');
const unitToggle   = $('unitToggle');
const unitThumb    = $('unitThumb');
const themeToggle  = $('themeToggle');
const errorBanner  = $('errorBanner');
const errorText    = $('errorText');
const loaderWrap   = $('loaderWrap');
const dashboard    = $('dashboard');
const emptyState   = $('emptyState');
const recentWrap   = $('recentWrap');
const recentChips  = $('recentChips');
const clearRecent  = $('clearRecent');
const forecastRow  = $('forecastRow');

// ──────────────────────────────────────────────────────────
// 🌡️  UNIT HELPERS
// ──────────────────────────────────────────────────────────
/** Convert Celsius to the active unit string, e.g. "22°C" or "72°F" */
const fmtTemp = c => {
  if (state.unit === 'F') return `${Math.round(c * 9/5 + 32)}°F`;
  return `${Math.round(c)}°C`;
};

// ──────────────────────────────────────────────────────────
// 📅  DATE / TIME
// ──────────────────────────────────────────────────────────
const fmtDate = (unixTs, tzOffset) => {
  // Build a local date for the city's timezone
  const localMs = (unixTs + tzOffset) * 1000;
  const d = new Date(localMs);
  const days   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  // Note: getUTC* used because we've manually shifted to local tz
  return `${days[d.getUTCDay()]}, ${d.getUTCDate()} ${months[d.getUTCMonth()]} · ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};
const pad = n => String(n).padStart(2, '0');

const shortDay = unixTs => {
  const d = new Date(unixTs * 1000);
  return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
};

// ──────────────────────────────────────────────────────────
// 🌤️  WEATHER CONDITION → CSS CLASS + EMOJI
// ──────────────────────────────────────────────────────────
const conditionClass = id => {
  if (id >= 200 && id < 300) return 'weather-stormy';
  if (id >= 300 && id < 600) return 'weather-rainy';
  if (id >= 600 && id < 700) return 'weather-snowy';
  if (id >= 700 && id < 800) return 'weather-foggy';
  if (id === 800)             return 'weather-sunny';
  if (id > 800)               return 'weather-cloudy';
  return 'weather-default';
};

// ──────────────────────────────────────────────────────────
// 🌐  API CALLS
// ──────────────────────────────────────────────────────────
/**
 * Generic fetch wrapper with error handling.
 * Throws a user-friendly Error on non-OK responses.
 */
const apiFetch = async url => {
  let res;
  try {
    res = await fetch(url);
  } catch (networkErr) {
    throw new Error('Failed to fetch. Check your internet connection.');
  }
  if (!res.ok) {
    // OpenWeatherMap returns { cod, message } on error
    const errBody = await res.json().catch(() => ({}));
    const msg = errBody.message || `HTTP ${res.status}`;
    const error = new Error(msg.charAt(0).toUpperCase() + msg.slice(1));
    error.status = res.status;
    throw error;
  }
  return res.json();
};

/** Fetch current weather by city name */
const fetchCurrentByCity = city =>
  apiFetch(`${BASE}/weather?q=${encodeURIComponent(city)}&appid=${API_KEY}&units=metric`);

/** Fetch current weather by lat/lon */
const fetchCurrentByCoords = (lat, lon) =>
  apiFetch(`${BASE}/weather?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric`);

/** Fetch 5-day 3-hour forecast by city name */
const fetchForecastByCity = city =>
  apiFetch(`${BASE}/forecast?q=${encodeURIComponent(city)}&appid=${API_KEY}&units=metric`);

/** Fetch 5-day forecast by lat/lon */
const fetchForecastByCoords = (lat, lon) =>
  apiFetch(`${BASE}/forecast?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric`);

// ──────────────────────────────────────────────────────────
// 🖥️  UI STATE HELPERS
// ──────────────────────────────────────────────────────────
const showLoader  = () => { loaderWrap.hidden = false; dashboard.hidden = true; emptyState.hidden = true; hideError(); };
const hideLoader  = () => { loaderWrap.hidden = true; };
const showDash    = () => { dashboard.hidden = false; emptyState.hidden = true; loaderWrap.hidden = true; };
const showEmpty   = () => { emptyState.hidden = false; dashboard.hidden = true; loaderWrap.hidden = true; };
const showError   = msg => { errorText.textContent = msg; errorBanner.hidden = false; };
const hideError   = ()  => { errorBanner.hidden = true; };

// ──────────────────────────────────────────────────────────
// 🗃️  RECENT SEARCHES (localStorage)
// ──────────────────────────────────────────────────────────
const getRecent  = ()  => JSON.parse(localStorage.getItem('nimbus_recent') || '[]');
const saveRecent = arr => localStorage.setItem('nimbus_recent', JSON.stringify(arr));

/** Add city to top of recent list (deduped, max 5) */
const pushRecent = city => {
  let list = getRecent().filter(c => c.toLowerCase() !== city.toLowerCase());
  list.unshift(city);
  if (list.length > state.recentMax) list = list.slice(0, state.recentMax);
  saveRecent(list);
  renderRecent();
};

/** Render recent-searches chips */
const renderRecent = () => {
  const list = getRecent();
  if (!list.length) { recentWrap.hidden = true; return; }
  recentWrap.hidden = false;
  recentChips.innerHTML = list
    .map(c => `<button class="chip" data-city="${c}" aria-label="Search ${c}">${c}</button>`)
    .join('');
  // Chip click → search
  recentChips.querySelectorAll('.chip').forEach(chip =>
    chip.addEventListener('click', () => handleSearch(chip.dataset.city))
  );
};

// ──────────────────────────────────────────────────────────
// 🎨  RENDER FUNCTIONS
// ──────────────────────────────────────────────────────────
/** Populate the hero card and stat cards from raw API data */
const renderCurrent = data => {
  const { name, sys, timezone, weather, main, wind, visibility } = data;
  const condition = weather[0];

  $('heroLocation').textContent = `${name}, ${sys.country}`;
  $('heroDate').textContent     = fmtDate(Math.floor(Date.now() / 1000), timezone);
  $('heroTemp').textContent     = fmtTemp(main.temp);
  $('heroCondition').textContent = condition.description;
  $('heroFeels').textContent    = `Feels like ${fmtTemp(main.feels_like)}`;

  // Weather icon (2× version for crispness)
  const icon = $('heroIcon');
  icon.src = `https://openweathermap.org/img/wn/${condition.icon}@2x.png`;
  icon.alt = condition.description;

  // Stats
  $('statHumidity').textContent   = `${main.humidity}%`;
  $('statWind').textContent       = `${Math.round(wind.speed * 3.6)} km/h`;
  $('statPressure').textContent   = `${main.pressure} hPa`;
  $('statVisibility').textContent = `${(visibility / 1000).toFixed(1)} km`;

  // Dynamic background — replace only the weather-* class
  document.body.className = document.body.className
    .split(' ')
    .filter(c => !c.startsWith('weather-'))
    .concat(conditionClass(condition.id))
    .join(' ')
    .trim();
};

/** Re-render only the temperature values when unit changes */
const rerenderTemps = () => {
  if (!state.rawCurrent) return;
  const { main } = state.rawCurrent;
  $('heroTemp').textContent  = fmtTemp(main.temp);
  $('heroFeels').textContent = `Feels like ${fmtTemp(main.feels_like)}`;
  if (state.rawForecast) renderForecast(state.rawForecast);
};

/**
 * Build 5-day forecast from 3-hourly data.
 * Strategy: group entries by date, pick the midday slot (or first).
 */
const renderForecast = forecastData => {
  // forecastData.list = array of 3-hour entries
  const byDay = {};
  forecastData.list.forEach(entry => {
    // entry.dt_txt = "2024-01-01 12:00:00"
    const day = entry.dt_txt.split(' ')[0];
    if (!byDay[day]) byDay[day] = [];
    byDay[day].push(entry);
  });

  // Take the first 5 days (today may be partial, so start from first full key)
  const days = Object.keys(byDay).slice(0, 5);

  forecastRow.innerHTML = days.map(day => {
    const entries = byDay[day];
    // Pick midday entry if available, otherwise first
    const mid = entries.find(e => e.dt_txt.includes('12:00:00')) || entries[0];
    const high = Math.max(...entries.map(e => e.main.temp_max));
    const low  = Math.min(...entries.map(e => e.main.temp_min));
    const icon = mid.weather[0].icon;

    return `
      <div class="forecast-day">
        <span class="forecast-day-name">${shortDay(mid.dt)}</span>
        <img class="forecast-icon"
             src="https://openweathermap.org/img/wn/${icon}.png"
             alt="${mid.weather[0].description}" />
        <span class="forecast-high">${fmtTemp(high)}</span>
        <span class="forecast-low">${fmtTemp(low)}</span>
      </div>`;
  }).join('');
};

// ──────────────────────────────────────────────────────────
// 🔍  MAIN SEARCH ORCHESTRATOR
// ──────────────────────────────────────────────────────────
/** Validate API key before making a call */
const checkApiKey = () => {
  if (!API_KEY || API_KEY === 'YOUR_API_KEY_HERE' || API_KEY.trim() === '') {
    throw new Error('No API key set. Open script.js and paste your OpenWeatherMap key into API_KEY.');
  }
};

/**
 * Main handler: fetch current + forecast for a city string.
 * Both requests are fired in parallel with Promise.all.
 */
const handleSearch = async city => {
  city = city.trim();
  if (!city) { showError('Please enter a city name.'); return; }

  hideError();
  showLoader();

  try {
    checkApiKey();

    // Fire both API calls simultaneously
    const [current, forecast] = await Promise.all([
      fetchCurrentByCity(city),
      fetchForecastByCity(city),
    ]);

    // Save raw Celsius data for unit-switching without re-fetching
    state.rawCurrent  = current;
    state.rawForecast = forecast;

    renderCurrent(current);
    renderForecast(forecast);
    pushRecent(current.name); // use normalised name from API

    hideLoader();
    showDash();
    cityInput.value = '';

  } catch (err) {
    hideLoader();
    // Show empty state if nothing was previously displayed
    if (dashboard.hidden) showEmpty();
    showError(friendlyError(err));
  }
};

/**
 * Geolocation handler: use browser GPS → fetch by coords.
 */
const handleLocate = () => {
  if (!navigator.geolocation) {
    showError('Geolocation is not supported by your browser.');
    return;
  }

  hideError();
  showLoader();

  navigator.geolocation.getCurrentPosition(
    async pos => {
      const { latitude: lat, longitude: lon } = pos.coords;
      try {
        checkApiKey();
        const [current, forecast] = await Promise.all([
          fetchCurrentByCoords(lat, lon),
          fetchForecastByCoords(lat, lon),
        ]);
        state.rawCurrent  = current;
        state.rawForecast = forecast;
        renderCurrent(current);
        renderForecast(forecast);
        pushRecent(current.name);
        hideLoader();
        showDash();
      } catch (err) {
        hideLoader();
        if (dashboard.hidden) showEmpty();
        showError(friendlyError(err));
      }
    },
    err => {
      hideLoader();
      if (dashboard.hidden) showEmpty();
      showError(geoError(err));
    }
  );
};

// ──────────────────────────────────────────────────────────
// 💬  ERROR MESSAGE HELPERS
// ──────────────────────────────────────────────────────────
const friendlyError = err => {
  const msg = err.message || '';
  const msgL = msg.toLowerCase();
  if (!navigator.onLine)                        return 'No internet connection. Check your network and try again.';
  if (msgL.includes('no api key') || msg.includes('script.js'))
                                                return msg; // show our own message as-is
  if (msgL.includes('city not found'))          return 'City not found. Check the spelling and try again.';
  if (msgL.includes('invalid api key') || msgL.includes('unauthorized') || err.status === 401)
                                                return 'Invalid API key. Double-check your key in script.js.';
  if (msgL.includes('429') || msgL.includes('too many requests'))
                                                return 'API rate limit reached. Please wait a minute and try again.';
  if (msgL.includes('failed to fetch') || msgL.includes('networkerror'))
                                                return 'Network error. Check your internet connection and try again.';
  return `Something went wrong: ${msg}`;
};

const geoError = err => {
  switch (err.code) {
    case 1: return 'Location access denied. Allow location permissions and try again.';
    case 2: return 'Location unavailable. Try searching by city name instead.';
    case 3: return 'Location request timed out. Try again or search by city name.';
    default: return 'Could not detect your location.';
  }
};

// ──────────────────────────────────────────────────────────
// 🔘  UNIT TOGGLE
// ──────────────────────────────────────────────────────────
const syncUnitUI = () => {
  const opts = unitToggle.querySelectorAll('.pill-opt');
  opts.forEach(o => o.classList.toggle('active', o.dataset.unit === state.unit));
  unitThumb.classList.toggle('right', state.unit === 'F');
};

unitToggle.addEventListener('click', () => {
  state.unit = state.unit === 'C' ? 'F' : 'C';
  syncUnitUI();
  rerenderTemps();
});

// ──────────────────────────────────────────────────────────
// 🌙  THEME TOGGLE
// ──────────────────────────────────────────────────────────
const syncTheme = () => {
  document.documentElement.setAttribute('data-theme', state.theme);
  localStorage.setItem('nimbus_theme', state.theme);
};

themeToggle.addEventListener('click', () => {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  syncTheme();
});

// ──────────────────────────────────────────────────────────
// 🔗  EVENT LISTENERS
// ──────────────────────────────────────────────────────────
searchBtn.addEventListener('click', () => handleSearch(cityInput.value));

cityInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') handleSearch(cityInput.value);
});

locateBtn.addEventListener('click', handleLocate);

clearRecent.addEventListener('click', () => {
  localStorage.removeItem('nimbus_recent');
  renderRecent();
});

// ──────────────────────────────────────────────────────────
// 🎨  BACKGROUND PARTICLES (canvas-free, pure CSS+JS DOM)
// ──────────────────────────────────────────────────────────
const initParticles = () => {
  const container = $('bgParticles');
  const count = 28;
  for (let i = 0; i < count; i++) {
    const dot = document.createElement('div');
    const size = Math.random() * 3 + 1;
    Object.assign(dot.style, {
      position:        'absolute',
      width:           `${size}px`,
      height:          `${size}px`,
      borderRadius:    '50%',
      background:      'var(--accent)',
      opacity:         Math.random() * 0.25 + 0.05,
      left:            `${Math.random() * 100}%`,
      top:             `${Math.random() * 100}%`,
      animation:       `particle-drift ${10 + Math.random() * 20}s ease-in-out ${Math.random() * 10}s infinite alternate`,
    });
    container.appendChild(dot);
  }

  // Inject keyframes once
  const style = document.createElement('style');
  style.textContent = `
    @keyframes particle-drift {
      0%   { transform: translate(0, 0)    scale(1); }
      50%  { transform: translate(${rnd()}px, ${rnd()}px) scale(1.4); }
      100% { transform: translate(${rnd()}px, ${rnd()}px) scale(0.8); }
    }`;
  document.head.appendChild(style);
};
const rnd = () => (Math.random() - 0.5) * 80;

// ──────────────────────────────────────────────────────────
// 🚀  INIT
// ──────────────────────────────────────────────────────────
const init = () => {
  // Restore theme preference
  const savedTheme = localStorage.getItem('nimbus_theme');
  if (savedTheme) state.theme = savedTheme;
  syncTheme();

  // Sync unit UI
  syncUnitUI();

  // Render any saved recent searches
  renderRecent();

  // Background particles
  initParticles();

  // Show empty state by default
  showEmpty();

  // If API key is already set and user hasn't searched, optionally auto-locate
  // (comment out the next two lines to disable auto-locate on load)
  // if (API_KEY !== 'YOUR_API_KEY_HERE') {
  //   handleLocate();
  // }
};

init();
