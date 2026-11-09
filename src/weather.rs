//! Live Weather Service (Rust-side WinHTTP client + Open-Meteo).
//!
//! Performs HTTPS weather lookups inside Rust so the HTML/JS New Tab Page
//! maintains a strict `connect-src 'self'` Content-Security-Policy with
//! zero third-party network access required from scripts.

use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

/// Weather payload sent to New Tab / Chrome WebViews.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WeatherData {
    pub temperature_c: f64,
    pub apparent_c: f64,
    pub humidity: u32,
    pub wind_kmh: f64,
    pub condition: String,
    pub icon: String,
    pub location: String,
    pub is_day: bool,
    pub weather_code: u32,
    pub updated_secs: u64,
    pub query: String,
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

/// Fetch live weather for either an explicit city (`"Indore"`) or automatic IP location (`""` / `"auto"`).
pub fn fetch_weather(location_query: &str) -> Result<WeatherData, String> {
    let trimmed = location_query.trim();
    let is_auto = trimmed.is_empty() || trimmed.eq_ignore_ascii_case("auto");

    let (lat, lon, display_location) = if is_auto {
        resolve_auto_location()?
    } else {
        resolve_city_location(trimmed)?
    };

    let forecast_path = format!(
        "/v1/forecast?latitude={lat:.4}&longitude={lon:.4}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day&timezone=auto"
    );
    let body = https_get("api.open-meteo.com", &forecast_path)?;
    let parsed: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| format!("Invalid Open-Meteo JSON response: {e}"))?;

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
    let updated_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    Ok(WeatherData {
        temperature_c: (temperature_c * 10.0).round() / 10.0,
        apparent_c: (apparent_c * 10.0).round() / 10.0,
        humidity,
        wind_kmh: (wind_kmh * 10.0).round() / 10.0,
        condition: condition.to_owned(),
        icon: icon.to_owned(),
        location: display_location,
        is_day,
        weather_code,
        updated_secs,
        query: if is_auto {
            String::new()
        } else {
            trimmed.to_owned()
        },
    })
}

fn resolve_auto_location() -> Result<(f64, f64, String), String> {
    // Primary: GeoJS IP geolocation
    if let Ok(body) = https_get("get.geojs.io", "/v1/ip/geo.json") {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&body) {
            if let (Some(lat), Some(lon)) = (
                val.get("latitude").and_then(json_as_f64),
                val.get("longitude").and_then(json_as_f64),
            ) {
                let city = val
                    .get("city")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .unwrap_or("Local Area");
                let cc = val
                    .get("country_code")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty());
                let label = match cc {
                    Some(code) => format!("{city}, {code}"),
                    None => city.to_owned(),
                };
                return Ok((lat, lon, label));
            }
        }
    }

    // Secondary fallback: ipwho.is
    if let Ok(body) = https_get("ipwho.is", "/") {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&body) {
            let ok = val.get("success").and_then(|v| v.as_bool()).unwrap_or(false);
            if ok {
                if let (Some(lat), Some(lon)) = (
                    val.get("latitude").and_then(json_as_f64),
                    val.get("longitude").and_then(json_as_f64),
                ) {
                    let city = val
                        .get("city")
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.is_empty())
                        .unwrap_or("Local Area");
                    let cc = val
                        .get("country_code")
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.is_empty());
                    let label = match cc {
                        Some(code) => format!("{city}, {code}"),
                        None => city.to_owned(),
                    };
                    return Ok((lat, lon, label));
                }
            }
        }
    }

    Err("Could not detect IP geolocation (offline or service unreachable)".to_owned())
}

fn resolve_city_location(city: &str) -> Result<(f64, f64, String), String> {
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
    let label = match cc {
        Some(code) => format!("{name}, {code}"),
        None => name.to_owned(),
    };

    Ok((lat, lon, label))
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
}
