//! Live Weather Service (Rust-side WinHTTP client + Open-Meteo).
//!
//! Design goals:
//! - Single swappable provider function [`fetch_from_provider`] so the data source can be
//!   changed in one place.
//! - 30-minute in-memory + disk cache (`CACHE_TTL_SECS = 1800`) with graceful offline fallback
//!   (`offline: true` when serving cached data while network is unreachable).
//! - **Zero IP geolocation lookups**: locations come ONLY from (1) user-typed city in Settings,
//!   (2) client timezone/locale centroid coordinates sent by NTP, or (3) explicit browser
//!   geolocation when the user clicks "Use my location".
//! - Runs in Rust so `rusty://app/` retains a strict `connect-src 'self'` CSP.

use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

/// 30-minute cache TTL as required by A1.
pub const CACHE_TTL_SECS: u64 = 30 * 60;

/// Single-day entry in the 5-day forecast row.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DailyForecast {
    pub date: String,
    pub temp_max_c: f64,
    pub temp_min_c: f64,
    pub weather_code: u32,
    pub condition: String,
    pub icon: String,
}

/// Weather payload sent to New Tab / Chrome WebViews.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WeatherData {
    pub temperature_c: f64,
    pub apparent_c: f64,
    pub humidity: u32,
    pub wind_kmh: f64,
    pub condition: String,
    pub icon: String,
    pub location: String,
    #[serde(default)]
    pub country: String,
    #[serde(default)]
    pub latitude: f64,
    #[serde(default)]
    pub longitude: f64,
    pub is_day: bool,
    pub weather_code: u32,
    pub updated_secs: u64,
    pub query: String,
    #[serde(default)]
    pub offline: bool,
    #[serde(default)]
    pub forecast: Vec<DailyForecast>,
}

/// Weather query input without any IP lookup fallback.
#[derive(Debug, Clone)]
pub enum WeatherRequest {
    City(String),
    Coords {
        lat: f64,
        lon: f64,
        label: Option<String>,
        country: Option<String>,
        query: String,
    },
}

impl WeatherRequest {
    fn cache_key(&self) -> String {
        match self {
            WeatherRequest::City(city) => format!("city:{}", city.trim().to_lowercase()),
            WeatherRequest::Coords { lat, lon, .. } => {
                format!("coords:{:.2},{:.2}", lat, lon)
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CachedWeatherEntry {
    key: String,
    fetched_secs: u64,
    data: WeatherData,
}

static MEMORY_CACHE: OnceLock<Mutex<HashMap<String, CachedWeatherEntry>>> = OnceLock::new();

fn memory_cache() -> &'static Mutex<HashMap<String, CachedWeatherEntry>> {
    MEMORY_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// Map WMO weather interpretation code + day/night flag to human description and icon key.
pub fn wmo_to_condition(code: u32, is_day: bool) -> (&'static str, &'static str) {
    match code {
        0 => (
            if is_day { "Clear Sky" } else { "Clear Night" },
            if is_day { "sun" } else { "moon" },
        ),
        1 => (
            "Mainly Clear",
            if is_day { "sun" } else { "moon" },
        ),
        2 => ("Partly Cloudy", "partly-cloudy"),
        3 => ("Overcast", "cloud"),
        45 | 48 => ("Foggy", "cloud"),
        51 | 53 | 55 => ("Light Drizzle", "rain"),
        56 | 57 => ("Freezing Drizzle", "rain"),
        61 | 63 | 65 => ("Rain", "rain"),
        66 | 67 => ("Freezing Rain", "rain"),
        71 | 73 | 75 | 77 => ("Snow", "snow"),
        80..=82 => ("Rain Showers", "rain"),
        85 | 86 => ("Snow Showers", "snow"),
        95 => ("Thunderstorm", "storm"),
        96 | 99 => ("Thunderstorm & Hail", "storm"),
        _ => ("Fair", if is_day { "sun" } else { "moon" }),
    }
}

fn json_as_f64(val: &serde_json::Value) -> Option<f64> {
    val.as_f64()
        .or_else(|| val.as_str().and_then(|s| s.trim().parse::<f64>().ok()))
}

fn parse_open_meteo_payload(
    body: &str,
    lat: f64,
    lon: f64,
    display_location: String,
    country: String,
    query: String,
    now: u64,
) -> Result<WeatherData, String> {
    let parsed: serde_json::Value =
        serde_json::from_str(body).map_err(|e| format!("Invalid Open-Meteo JSON response: {e}"))?;

    let current = parsed
        .get("current")
        .ok_or_else(|| "Missing `current` field in Open-Meteo response".to_owned())?;

    let temperature_c = current
        .get("temperature_2m")
        .and_then(json_as_f64)
        .ok_or_else(|| "Missing `temperature_2m` in Open-Meteo response".to_owned())?;
    let apparent_c = current
        .get("apparent_temperature")
        .and_then(json_as_f64)
        .unwrap_or(temperature_c);
    let humidity = current
        .get("relative_humidity_2m")
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as u32;
    let wind_kmh = current
        .get("wind_speed_10m")
        .and_then(json_as_f64)
        .unwrap_or(0.0);
    let weather_code = current
        .get("weather_code")
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as u32;
    let is_day = current
        .get("is_day")
        .and_then(|v| v.as_u64())
        .unwrap_or(1)
        != 0;

    let (condition, icon) = wmo_to_condition(weather_code, is_day);

    let mut forecast = Vec::with_capacity(5);
    if let Some(daily) = parsed.get("daily") {
        let dates = daily.get("time").and_then(|v| v.as_array());
        let codes = daily.get("weather_code").and_then(|v| v.as_array());
        let tmaxs = daily.get("temperature_2m_max").and_then(|v| v.as_array());
        let tmins = daily.get("temperature_2m_min").and_then(|v| v.as_array());
        if let (Some(ds), Some(cs), Some(xs), Some(ns)) = (dates, codes, tmaxs, tmins) {
            let count = ds.len().min(cs.len()).min(xs.len()).min(ns.len()).min(5);
            for i in 0..count {
                let d_str = ds[i].as_str().unwrap_or("").to_owned();
                let d_code = cs[i].as_u64().unwrap_or(0) as u32;
                let (d_cond, d_icon) = wmo_to_condition(d_code, true);
                let tmax = json_as_f64(&xs[i]).unwrap_or(temperature_c);
                let tmin = json_as_f64(&ns[i]).unwrap_or(temperature_c);
                forecast.push(DailyForecast {
                    date: d_str,
                    temp_max_c: (tmax * 10.0).round() / 10.0,
                    temp_min_c: (tmin * 10.0).round() / 10.0,
                    weather_code: d_code,
                    condition: d_cond.to_owned(),
                    icon: d_icon.to_owned(),
                });
            }
        }
    }

    Ok(WeatherData {
        temperature_c: (temperature_c * 10.0).round() / 10.0,
        apparent_c: (apparent_c * 10.0).round() / 10.0,
        humidity,
        wind_kmh: (wind_kmh * 10.0).round() / 10.0,
        condition: condition.to_owned(),
        icon: icon.to_owned(),
        location: display_location,
        country,
        latitude: lat,
        longitude: lon,
        is_day,
        weather_code,
        updated_secs: now,
        query,
        offline: false,
        forecast,
    })
}

/// **Single swappable weather data source function** (currently Open-Meteo, free & keyless).
///
/// Swap providers (OpenWeatherMap, WeatherAPI, PirateWeather, etc.) strictly inside this function
/// while keeping [`WeatherRequest`] and [`WeatherData`] intact.
pub fn fetch_from_provider(req: &WeatherRequest) -> Result<WeatherData, String> {
    let (lat, lon, display_location, country, query) = match req {
        WeatherRequest::City(raw_city) => {
            let trimmed = raw_city.trim();
            if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("auto") {
                return Err("No city specified (waiting for timezone/location)".to_owned());
            }
            let (glat, glon, label, ctry) = resolve_city_location(trimmed)?;
            (glat, glon, label, ctry, trimmed.to_owned())
        }
        WeatherRequest::Coords {
            lat,
            lon,
            label,
            country,
            query,
        } => {
            let lbl = label
                .clone()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| format!("{lat:.2}, {lon:.2}"));
            (
                *lat,
                *lon,
                lbl,
                country.clone().unwrap_or_default(),
                query.clone(),
            )
        }
    };

    let forecast_path = format!(
        "/v1/forecast?latitude={lat:.4}&longitude={lon:.4}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=5&timezone=auto"
    );
    let body = https_get("api.open-meteo.com", &forecast_path)?;
    parse_open_meteo_payload(
        &body,
        lat,
        lon,
        display_location,
        country,
        query,
        now_secs(),
    )
}

fn load_disk_cache(cache_dir: Option<&Path>) -> HashMap<String, CachedWeatherEntry> {
    let Some(dir) = cache_dir else {
        return HashMap::new();
    };
    let path = dir.join("weather_cache.json");
    if let Ok(raw) = fs::read_to_string(path) {
        if let Ok(entries) = serde_json::from_str::<Vec<CachedWeatherEntry>>(&raw) {
            return entries.into_iter().map(|e| (e.key.clone(), e)).collect();
        }
    }
    HashMap::new()
}

fn save_disk_cache(cache_dir: Option<&Path>, map: &HashMap<String, CachedWeatherEntry>) {
    let Some(dir) = cache_dir else {
        return;
    };
    let _ = fs::create_dir_all(dir);
    let path = dir.join("weather_cache.json");
    let values: Vec<&CachedWeatherEntry> = map.values().take(16).collect();
    if let Ok(json) = serde_json::to_string(&values) {
        let _ = fs::write(path, json);
    }
}

/// Fetch weather with 30-minute cache (`CACHE_TTL_SECS`) and graceful offline fallback.
pub fn fetch_weather_cached(
    req: WeatherRequest,
    force: bool,
    cache_dir: Option<&Path>,
) -> Result<WeatherData, String> {
    let key = req.cache_key();
    let now = now_secs();

    // Hydrate memory cache from disk once if empty
    {
        if let Ok(mut guard) = memory_cache().lock() {
            if guard.is_empty() {
                let disk = load_disk_cache(cache_dir);
                if !disk.is_empty() {
                    *guard = disk;
                }
            }
            if !force {
                if let Some(entry) = guard.get(&key) {
                    if now.saturating_sub(entry.fetched_secs) < CACHE_TTL_SECS {
                        let mut data = entry.data.clone();
                        data.offline = false;
                        return Ok(data);
                    }
                }
            }
        }
    }

    match fetch_from_provider(&req) {
        Ok(fresh) => {
            if let Ok(mut guard) = memory_cache().lock() {
                guard.insert(
                    key,
                    CachedWeatherEntry {
                        key: req.cache_key(),
                        fetched_secs: now,
                        data: fresh.clone(),
                    },
                );
                save_disk_cache(cache_dir, &guard);
            }
            Ok(fresh)
        }
        Err(err) => {
            // Graceful offline fallback: serve any matching or most recent cached weather marked offline=true
            if let Ok(guard) = memory_cache().lock() {
                if let Some(stale) = guard.get(&key).or_else(|| guard.values().max_by_key(|e| e.fetched_secs)) {
                    let mut offline_data = stale.data.clone();
                    offline_data.offline = true;
                    return Ok(offline_data);
                }
            }
            Err(err)
        }
    }
}

/// Backward-compatible wrapper: fetches by explicit city string (no IP lookup).
#[allow(dead_code)]
pub fn fetch_weather(location_query: &str) -> Result<WeatherData, String> {
    fetch_weather_cached(WeatherRequest::City(location_query.to_owned()), false, None)
}

fn resolve_city_location(city: &str) -> Result<(f64, f64, String, String), String> {
    let encoded = utf8_percent_encode(city, NON_ALPHANUMERIC).to_string();
    let path = format!("/v1/search?name={encoded}&count=1&language=en&format=json");
    let body = https_get("geocoding-api.open-meteo.com", &path)?;
    let parsed: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| format!("Invalid geocoding JSON response: {e}"))?;

    let first = parsed
        .get("results")
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.first())
        .ok_or_else(|| format!("City not found: {city}"))?;

    let lat = first
        .get("latitude")
        .and_then(json_as_f64)
        .ok_or_else(|| "Missing latitude in geocoding result".to_owned())?;
    let lon = first
        .get("longitude")
        .and_then(json_as_f64)
        .ok_or_else(|| "Missing longitude in geocoding result".to_owned())?;

    let name = first
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or(city);
    let cc = first
        .get("country_code")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty());
    let country = first
        .get("country")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_owned();
    let label = match cc {
        Some(code) => format!("{name}, {code}"),
        None => name.to_owned(),
    };

    Ok((lat, lon, label, country))
}

#[cfg(target_os = "windows")]
fn https_get(host: &str, path: &str) -> Result<String, String> {
    use std::ffi::c_void;
    use std::ptr;

    const WINHTTP_ACCESS_TYPE_DEFAULT_PROXY: u32 = 0;
    const WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY: u32 = 4;
    const WINHTTP_FLAG_SECURE: u32 = 0x0080_0000;
    const INTERNET_DEFAULT_HTTPS_PORT: u16 = 443;
    const WINHTTP_QUERY_STATUS_CODE: u32 = 0x13;
    const WINHTTP_QUERY_FLAG_NUMBER: u32 = 0x2000_0000;
    const MAX_BODY_BYTES: usize = 512 * 1024;

    #[link(name = "winhttp")]
    extern "system" {
        fn WinHttpOpen(
            pszAgentW: *const u16,
            dwAccessType: u32,
            pszProxyW: *const u16,
            pszProxyBypassW: *const u16,
            dwFlags: u32,
        ) -> *mut c_void;
        fn WinHttpSetTimeouts(
            hInternet: *mut c_void,
            nResolveTimeout: i32,
            nConnectTimeout: i32,
            nSendTimeout: i32,
            nReceiveTimeout: i32,
        ) -> i32;
        fn WinHttpConnect(
            hSession: *mut c_void,
            pswzServerName: *const u16,
            nServerPort: u16,
            dwReserved: u32,
        ) -> *mut c_void;
        fn WinHttpOpenRequest(
            hConnect: *mut c_void,
            pwszVerb: *const u16,
            pwszObjectName: *const u16,
            pwszVersion: *const u16,
            pwszReferrer: *const u16,
            ppwszAcceptTypes: *const *const u16,
            dwFlags: u32,
        ) -> *mut c_void;
        fn WinHttpSendRequest(
            hRequest: *mut c_void,
            lpszHeaders: *const u16,
            dwHeadersLength: u32,
            lpOptional: *const c_void,
            dwOptionalLength: u32,
            dwTotalLength: u32,
            dwContext: usize,
        ) -> i32;
        fn WinHttpReceiveResponse(
            hRequest: *mut c_void,
            lpReserved: *mut c_void,
        ) -> i32;
        fn WinHttpQueryHeaders(
            hRequest: *mut c_void,
            dwInfoLevel: u32,
            pwszName: *const u16,
            lpBuffer: *mut c_void,
            lpdwBufferLength: *mut u32,
            lpdwIndex: *mut u32,
        ) -> i32;
        fn WinHttpQueryDataAvailable(
            hRequest: *mut c_void,
            lpdwNumberOfBytesAvailable: *mut u32,
        ) -> i32;
        fn WinHttpReadData(
            hRequest: *mut c_void,
            lpBuffer: *mut u8,
            dwNumberOfBytesToRead: u32,
            lpdwNumberOfBytesRead: *mut u32,
        ) -> i32;
        fn WinHttpCloseHandle(hInternet: *mut c_void) -> i32;
    }

    struct WinHttpHandle(*mut c_void);
    impl Drop for WinHttpHandle {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe {
                    WinHttpCloseHandle(self.0);
                }
            }
        }
    }

    fn to_wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    unsafe {
        let agent = to_wide("RustyBrowser/0.2");
        let mut session_ptr = WinHttpOpen(
            agent.as_ptr(),
            WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
            ptr::null(),
            ptr::null(),
            0,
        );
        if session_ptr.is_null() {
            session_ptr = WinHttpOpen(
                agent.as_ptr(),
                WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
                ptr::null(),
                ptr::null(),
                0,
            );
        }
        if session_ptr.is_null() {
            return Err("WinHttpOpen failed".to_owned());
        }
        let session = WinHttpHandle(session_ptr);
        let _ = WinHttpSetTimeouts(session.0, 4000, 4000, 4000, 5000);

        let host_w = to_wide(host);
        let conn_ptr = WinHttpConnect(session.0, host_w.as_ptr(), INTERNET_DEFAULT_HTTPS_PORT, 0);
        if conn_ptr.is_null() {
            return Err(format!("WinHttpConnect failed for {host}"));
        }
        let conn = WinHttpHandle(conn_ptr);

        let verb_w = to_wide("GET");
        let path_w = to_wide(path);
        let req_ptr = WinHttpOpenRequest(
            conn.0,
            verb_w.as_ptr(),
            path_w.as_ptr(),
            ptr::null(),
            ptr::null(),
            ptr::null(),
            WINHTTP_FLAG_SECURE,
        );
        if req_ptr.is_null() {
            return Err(format!("WinHttpOpenRequest failed for {path}"));
        }
        let req = WinHttpHandle(req_ptr);

        if WinHttpSendRequest(req.0, ptr::null(), 0, ptr::null(), 0, 0, 0) == 0 {
            return Err(format!("HTTPS request send failed for {host}"));
        }
        if WinHttpReceiveResponse(req.0, ptr::null_mut()) == 0 {
            return Err(format!("HTTPS receive failed for {host}"));
        }

        let mut status_code: u32 = 0;
        let mut status_size: u32 = std::mem::size_of::<u32>() as u32;
        if WinHttpQueryHeaders(
            req.0,
            WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
            ptr::null(),
            (&mut status_code as *mut u32).cast::<c_void>(),
            &mut status_size,
            ptr::null_mut(),
        ) != 0
            && status_code >= 400
        {
            return Err(format!("HTTP {status_code} from {host}"));
        }

        let mut out: Vec<u8> = Vec::new();
        loop {
            let mut avail: u32 = 0;
            if WinHttpQueryDataAvailable(req.0, &mut avail) == 0 || avail == 0 {
                break;
            }
            if out.len().saturating_add(avail as usize) > MAX_BODY_BYTES {
                break;
            }
            let chunk_len = (avail as usize).min(16384);
            let mut buf = vec![0u8; chunk_len];
            let mut read: u32 = 0;
            if WinHttpReadData(req.0, buf.as_mut_ptr(), chunk_len as u32, &mut read) == 0 || read == 0
            {
                break;
            }
            out.extend_from_slice(&buf[..read as usize]);
        }

        String::from_utf8(out).map_err(|e| format!("Non-UTF8 HTTP body: {e}"))
    }
}

#[cfg(not(target_os = "windows"))]
fn https_get(host: &str, path: &str) -> Result<String, String> {
    let url = format!("https://{host}{path}");
    let output = std::process::Command::new("curl")
        .args(["-fsSL", "--max-time", "5", &url])
        .output()
        .map_err(|e| format!("Failed to execute curl: {e}"))?;
    if !output.status.success() {
        return Err(format!("HTTP error from {host}"));
    }
    String::from_utf8(output.stdout).map_err(|e| format!("Non-UTF8 body: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_wmo_mapping() {
        assert_eq!(wmo_to_condition(0, true), ("Clear Sky", "sun"));
        assert_eq!(wmo_to_condition(0, false), ("Clear Night", "moon"));
        assert_eq!(wmo_to_condition(2, true), ("Partly Cloudy", "partly-cloudy"));
        assert_eq!(wmo_to_condition(63, true), ("Rain", "rain"));
        assert_eq!(wmo_to_condition(95, true), ("Thunderstorm", "storm"));
    }

    #[test]
    fn test_json_as_f64_parses_both_number_and_string() {
        assert_eq!(json_as_f64(&serde_json::json!(22.75)), Some(22.75));
        assert_eq!(json_as_f64(&serde_json::json!("22.7196")), Some(22.7196));
        assert_eq!(json_as_f64(&serde_json::json!("not_a_num")), None);
    }

    #[test]
    fn test_parse_open_meteo_payload_with_five_day_forecast() {
        let sample = r#"{
            "current": {
                "temperature_2m": 28.44,
                "apparent_temperature": 30.12,
                "relative_humidity_2m": 62,
                "wind_speed_10m": 11.44,
                "weather_code": 2,
                "is_day": 1
            },
            "daily": {
                "time": ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14"],
                "weather_code": [0, 2, 61, 3, 95, 1],
                "temperature_2m_max": [31.2, 29.8, 26.5, 28.1, 27.0, 30.0],
                "temperature_2m_min": [21.0, 20.4, 19.8, 20.1, 18.9, 21.5]
            }
        }"#;

        let parsed = parse_open_meteo_payload(
            sample,
            19.076,
            72.8777,
            "Mumbai, IN".to_owned(),
            "India".to_owned(),
            "Mumbai".to_owned(),
            1700000000,
        )
        .expect("parse payload");

        assert_eq!(parsed.temperature_c, 28.4);
        assert_eq!(parsed.apparent_c, 30.1);
        assert_eq!(parsed.humidity, 62);
        assert_eq!(parsed.wind_kmh, 11.4);
        assert_eq!(parsed.condition, "Partly Cloudy");
        assert_eq!(parsed.location, "Mumbai, IN");
        assert_eq!(parsed.country, "India");
        assert!(!parsed.offline);
        assert_eq!(parsed.forecast.len(), 5);
        assert_eq!(parsed.forecast[0].date, "2026-11-09");
        assert_eq!(parsed.forecast[0].temp_max_c, 31.2);
        assert_eq!(parsed.forecast[2].condition, "Rain");
        assert_eq!(parsed.forecast[4].condition, "Thunderstorm");
    }

    #[test]
    fn test_city_empty_or_auto_does_not_ip_lookup() {
        let err_empty = fetch_from_provider(&WeatherRequest::City("".to_owned())).unwrap_err();
        assert!(err_empty.contains("No city"));
        let err_auto = fetch_from_provider(&WeatherRequest::City("auto".to_owned())).unwrap_err();
        assert!(err_auto.contains("No city"));
    }

    #[test]
    fn test_disk_cache_roundtrip_and_ttl() {
        let dir = std::env::temp_dir().join("rusty_browser_test_weather_cache");
        let _ = fs::remove_dir_all(&dir);
        let req = WeatherRequest::City("TestvilleCacheCheck".to_owned());
        let key = req.cache_key();
        let entry = CachedWeatherEntry {
            key: key.clone(),
            fetched_secs: now_secs(),
            data: WeatherData {
                temperature_c: 21.5,
                apparent_c: 21.0,
                humidity: 50,
                wind_kmh: 8.0,
                condition: "Clear Sky".to_owned(),
                icon: "sun".to_owned(),
                location: "Testville".to_owned(),
                country: "Testland".to_owned(),
                latitude: 10.0,
                longitude: 20.0,
                is_day: true,
                weather_code: 0,
                updated_secs: now_secs(),
                query: "TestvilleCacheCheck".to_owned(),
                offline: false,
                forecast: vec![],
            },
        };
        let mut map = HashMap::new();
        map.insert(key, entry);
        save_disk_cache(Some(&dir), &map);

        let loaded = load_disk_cache(Some(&dir));
        assert_eq!(loaded.len(), 1);
        let hit = loaded.values().next().unwrap();
        assert_eq!(hit.data.location, "Testville");
        assert_eq!(CACHE_TTL_SECS, 1800);

        let _ = fs::remove_dir_all(&dir);
    }
}
