// Embedded Timezone, Locale, World-Clock & Country Centroid Table (A1 + A2)
// Zero network requests, zero IP lookups.
(function (root) {
  'use strict';

  const TZ_MAP = {
    'America/New_York': { city: 'New York', country: 'United States', code: 'US', lat: 40.71, lon: -74.01 },
    'America/Detroit': { city: 'Detroit', country: 'United States', code: 'US', lat: 42.33, lon: -83.05 },
    'America/Chicago': { city: 'Chicago', country: 'United States', code: 'US', lat: 41.88, lon: -87.63 },
    'America/Denver': { city: 'Denver', country: 'United States', code: 'US', lat: 39.74, lon: -104.99 },
    'America/Phoenix': { city: 'Phoenix', country: 'United States', code: 'US', lat: 33.45, lon: -112.07 },
    'America/Los_Angeles': { city: 'Los Angeles', country: 'United States', code: 'US', lat: 34.05, lon: -118.24 },
    'America/Anchorage': { city: 'Anchorage', country: 'United States', code: 'US', lat: 61.22, lon: -149.90 },
    'Pacific/Honolulu': { city: 'Honolulu', country: 'United States', code: 'US', lat: 21.31, lon: -157.86 },
    'America/Toronto': { city: 'Toronto', country: 'Canada', code: 'CA', lat: 43.65, lon: -79.38 },
    'America/Vancouver': { city: 'Vancouver', country: 'Canada', code: 'CA', lat: 49.28, lon: -123.12 },
    'America/Halifax': { city: 'Halifax', country: 'Canada', code: 'CA', lat: 44.65, lon: -63.57 },
    'America/Edmonton': { city: 'Calgary', country: 'Canada', code: 'CA', lat: 51.05, lon: -114.07 },
    'America/Mexico_City': { city: 'Mexico City', country: 'Mexico', code: 'MX', lat: 19.43, lon: -99.13 },
    'America/Bogota': { city: 'Bogota', country: 'Colombia', code: 'CO', lat: 4.71, lon: -74.07 },
    'America/Lima': { city: 'Lima', country: 'Peru', code: 'PE', lat: -12.05, lon: -77.04 },
    'America/Santiago': { city: 'Santiago', country: 'Chile', code: 'CL', lat: -33.45, lon: -70.67 },
    'America/Sao_Paulo': { city: 'Sao Paulo', country: 'Brazil', code: 'BR', lat: -23.55, lon: -46.63 },
    'America/Argentina/Buenos_Aires': { city: 'Buenos Aires', country: 'Argentina', code: 'AR', lat: -34.60, lon: -58.38 },
    'America/Buenos_Aires': { city: 'Buenos Aires', country: 'Argentina', code: 'AR', lat: -34.60, lon: -58.38 },
    'Europe/London': { city: 'London', country: 'United Kingdom', code: 'GB', lat: 51.51, lon: -0.13 },
    'Europe/Dublin': { city: 'Dublin', country: 'Ireland', code: 'IE', lat: 53.35, lon: -6.26 },
    'Europe/Lisbon': { city: 'Lisbon', country: 'Portugal', code: 'PT', lat: 38.72, lon: -9.14 },
    'Europe/Madrid': { city: 'Madrid', country: 'Spain', code: 'ES', lat: 40.42, lon: -3.70 },
    'Europe/Paris': { city: 'Paris', country: 'France', code: 'FR', lat: 48.86, lon: 2.35 },
    'Europe/Brussels': { city: 'Brussels', country: 'Belgium', code: 'BE', lat: 50.85, lon: 4.35 },
    'Europe/Amsterdam': { city: 'Amsterdam', country: 'Netherlands', code: 'NL', lat: 52.37, lon: 4.90 },
    'Europe/Berlin': { city: 'Berlin', country: 'Germany', code: 'DE', lat: 52.52, lon: 13.40 },
    'Europe/Zurich': { city: 'Zurich', country: 'Switzerland', code: 'CH', lat: 47.37, lon: 8.54 },
    'Europe/Rome': { city: 'Rome', country: 'Italy', code: 'IT', lat: 41.90, lon: 12.50 },
    'Europe/Vienna': { city: 'Vienna', country: 'Austria', code: 'AT', lat: 48.21, lon: 16.37 },
    'Europe/Prague': { city: 'Prague', country: 'Czechia', code: 'CZ', lat: 50.08, lon: 14.44 },
    'Europe/Warsaw': { city: 'Warsaw', country: 'Poland', code: 'PL', lat: 52.23, lon: 21.01 },
    'Europe/Copenhagen': { city: 'Copenhagen', country: 'Denmark', code: 'DK', lat: 55.68, lon: 12.57 },
    'Europe/Oslo': { city: 'Oslo', country: 'Norway', code: 'NO', lat: 59.91, lon: 10.75 },
    'Europe/Stockholm': { city: 'Stockholm', country: 'Sweden', code: 'SE', lat: 59.33, lon: 18.07 },
    'Europe/Helsinki': { city: 'Helsinki', country: 'Finland', code: 'FI', lat: 60.17, lon: 24.94 },
    'Europe/Athens': { city: 'Athens', country: 'Greece', code: 'GR', lat: 37.98, lon: 23.73 },
    'Europe/Bucharest': { city: 'Bucharest', country: 'Romania', code: 'RO', lat: 44.43, lon: 26.10 },
    'Europe/Kyiv': { city: 'Kyiv', country: 'Ukraine', code: 'UA', lat: 50.45, lon: 30.52 },
    'Europe/Kiev': { city: 'Kyiv', country: 'Ukraine', code: 'UA', lat: 50.45, lon: 30.52 },
    'Europe/Istanbul': { city: 'Istanbul', country: 'Turkey', code: 'TR', lat: 41.01, lon: 28.98 },
    'Europe/Moscow': { city: 'Moscow', country: 'Russia', code: 'RU', lat: 55.76, lon: 37.62 },
    'Africa/Casablanca': { city: 'Casablanca', country: 'Morocco', code: 'MA', lat: 33.57, lon: -7.59 },
    'Africa/Cairo': { city: 'Cairo', country: 'Egypt', code: 'EG', lat: 30.04, lon: 31.24 },
    'Africa/Lagos': { city: 'Lagos', country: 'Nigeria', code: 'NG', lat: 6.52, lon: 3.38 },
    'Africa/Nairobi': { city: 'Nairobi', country: 'Kenya', code: 'KE', lat: -1.29, lon: 36.82 },
    'Africa/Johannesburg': { city: 'Johannesburg', country: 'South Africa', code: 'ZA', lat: -26.20, lon: 28.05 },
    'Asia/Jerusalem': { city: 'Jerusalem', country: 'Israel', code: 'IL', lat: 31.77, lon: 35.21 },
    'Asia/Riyadh': { city: 'Riyadh', country: 'Saudi Arabia', code: 'SA', lat: 24.71, lon: 46.68 },
    'Asia/Dubai': { city: 'Dubai', country: 'United Arab Emirates', code: 'AE', lat: 25.20, lon: 55.27 },
    'Asia/Tehran': { city: 'Tehran', country: 'Iran', code: 'IR', lat: 35.69, lon: 51.39 },
    'Asia/Karachi': { city: 'Karachi', country: 'Pakistan', code: 'PK', lat: 24.86, lon: 67.00 },
    'Asia/Kolkata': { city: 'New Delhi', country: 'India', code: 'IN', lat: 28.61, lon: 77.21 },
    'Asia/Calcutta': { city: 'New Delhi', country: 'India', code: 'IN', lat: 28.61, lon: 77.21 },
    'Asia/Colombo': { city: 'Colombo', country: 'Sri Lanka', code: 'LK', lat: 6.93, lon: 79.86 },
    'Asia/Kathmandu': { city: 'Kathmandu', country: 'Nepal', code: 'NP', lat: 27.72, lon: 85.32 },
    'Asia/Dhaka': { city: 'Dhaka', country: 'Bangladesh', code: 'BD', lat: 23.81, lon: 90.41 },
    'Asia/Bangkok': { city: 'Bangkok', country: 'Thailand', code: 'TH', lat: 13.76, lon: 100.50 },
    'Asia/Ho_Chi_Minh': { city: 'Ho Chi Minh City', country: 'Vietnam', code: 'VN', lat: 10.82, lon: 106.63 },
    'Asia/Saigon': { city: 'Ho Chi Minh City', country: 'Vietnam', code: 'VN', lat: 10.82, lon: 106.63 },
    'Asia/Jakarta': { city: 'Jakarta', country: 'Indonesia', code: 'ID', lat: -6.21, lon: 106.85 },
    'Asia/Kuala_Lumpur': { city: 'Kuala Lumpur', country: 'Malaysia', code: 'MY', lat: 3.14, lon: 101.69 },
    'Asia/Singapore': { city: 'Singapore', country: 'Singapore', code: 'SG', lat: 1.35, lon: 103.82 },
    'Asia/Manila': { city: 'Manila', country: 'Philippines', code: 'PH', lat: 14.60, lon: 120.98 },
    'Asia/Shanghai': { city: 'Shanghai', country: 'China', code: 'CN', lat: 31.23, lon: 121.47 },
    'Asia/Hong_Kong': { city: 'Hong Kong', country: 'China', code: 'HK', lat: 22.32, lon: 114.17 },
    'Asia/Taipei': { city: 'Taipei', country: 'Taiwan', code: 'TW', lat: 25.03, lon: 121.57 },
    'Asia/Seoul': { city: 'Seoul', country: 'South Korea', code: 'KR', lat: 37.57, lon: 126.98 },
    'Asia/Tokyo': { city: 'Tokyo', country: 'Japan', code: 'JP', lat: 35.68, lon: 139.77 },
    'Australia/Perth': { city: 'Perth', country: 'Australia', code: 'AU', lat: -31.95, lon: 115.86 },
    'Australia/Adelaide': { city: 'Adelaide', country: 'Australia', code: 'AU', lat: -34.93, lon: 138.60 },
    'Australia/Brisbane': { city: 'Brisbane', country: 'Australia', code: 'AU', lat: -27.47, lon: 153.03 },
    'Australia/Sydney': { city: 'Sydney', country: 'Australia', code: 'AU', lat: -33.87, lon: 151.21 },
    'Australia/Melbourne': { city: 'Melbourne', country: 'Australia', code: 'AU', lat: -37.81, lon: 144.96 },
    'Pacific/Auckland': { city: 'Auckland', country: 'New Zealand', code: 'NZ', lat: -36.85, lon: 174.76 },
    'UTC': { city: 'London', country: 'United Kingdom', code: 'GB', lat: 51.51, lon: -0.13 }
  };

  const LOCALE_REGIONS = {
    US: { city: 'Washington D.C.', country: 'United States', lat: 38.90, lon: -77.04, tz: 'America/New_York' },
    CA: { city: 'Toronto', country: 'Canada', lat: 43.65, lon: -79.38, tz: 'America/Toronto' },
    MX: { city: 'Mexico City', country: 'Mexico', lat: 19.43, lon: -99.13, tz: 'America/Mexico_City' },
    BR: { city: 'Sao Paulo', country: 'Brazil', lat: -23.55, lon: -46.63, tz: 'America/Sao_Paulo' },
    AR: { city: 'Buenos Aires', country: 'Argentina', lat: -34.60, lon: -58.38, tz: 'America/Argentina/Buenos_Aires' },
    GB: { city: 'London', country: 'United Kingdom', lat: 51.51, lon: -0.13, tz: 'Europe/London' },
    UK: { city: 'London', country: 'United Kingdom', lat: 51.51, lon: -0.13, tz: 'Europe/London' },
    FR: { city: 'Paris', country: 'France', lat: 48.86, lon: 2.35, tz: 'Europe/Paris' },
    DE: { city: 'Berlin', country: 'Germany', lat: 52.52, lon: 13.40, tz: 'Europe/Berlin' },
    ES: { city: 'Madrid', country: 'Spain', lat: 40.42, lon: -3.70, tz: 'Europe/Madrid' },
    IT: { city: 'Rome', country: 'Italy', lat: 41.90, lon: 12.50, tz: 'Europe/Rome' },
    NL: { city: 'Amsterdam', country: 'Netherlands', lat: 52.37, lon: 4.90, tz: 'Europe/Amsterdam' },
    SE: { city: 'Stockholm', country: 'Sweden', lat: 59.33, lon: 18.07, tz: 'Europe/Stockholm' },
    NO: { city: 'Oslo', country: 'Norway', lat: 59.91, lon: 10.75, tz: 'Europe/Oslo' },
    PL: { city: 'Warsaw', country: 'Poland', lat: 52.23, lon: 21.01, tz: 'Europe/Warsaw' },
    RU: { city: 'Moscow', country: 'Russia', lat: 55.76, lon: 37.62, tz: 'Europe/Moscow' },
    TR: { city: 'Istanbul', country: 'Turkey', lat: 41.01, lon: 28.98, tz: 'Europe/Istanbul' },
    IN: { city: 'New Delhi', country: 'India', lat: 28.61, lon: 77.21, tz: 'Asia/Kolkata' },
    PK: { city: 'Karachi', country: 'Pakistan', lat: 24.86, lon: 67.00, tz: 'Asia/Karachi' },
    SG: { city: 'Singapore', country: 'Singapore', lat: 1.35, lon: 103.82, tz: 'Asia/Singapore' },
    CN: { city: 'Beijing', country: 'China', lat: 39.90, lon: 116.40, tz: 'Asia/Shanghai' },
    JP: { city: 'Tokyo', country: 'Japan', lat: 35.68, lon: 139.77, tz: 'Asia/Tokyo' },
    KR: { city: 'Seoul', country: 'South Korea', lat: 37.57, lon: 126.98, tz: 'Asia/Seoul' },
    AU: { city: 'Sydney', country: 'Australia', lat: -33.87, lon: 151.21, tz: 'Australia/Sydney' },
    NZ: { city: 'Auckland', country: 'New Zealand', lat: -36.85, lon: 174.76, tz: 'Pacific/Auckland' },
    ZA: { city: 'Johannesburg', country: 'South Africa', lat: -26.20, lon: 28.05, tz: 'Africa/Johannesburg' },
    EG: { city: 'Cairo', country: 'Egypt', lat: 30.04, lon: 31.24, tz: 'Africa/Cairo' },
    NG: { city: 'Lagos', country: 'Nigeria', lat: 6.52, lon: 3.38, tz: 'Africa/Lagos' },
    AE: { city: 'Dubai', country: 'United Arab Emirates', lat: 25.20, lon: 55.27, tz: 'Asia/Dubai' }
  };

  // Country regions for local lat/lon hover name lookup on 3D Globe (A2)
  // Ordered with smaller / distinct countries before large overarching boxes where boxes overlap.
  const COUNTRY_BOXES = [
    { name: 'United Kingdom', lat: 54.0, lon: -2.0, minLat: 49.8, maxLat: 60.9, minLon: -8.6, maxLon: 1.8 },
    { name: 'Ireland', lat: 53.4, lon: -8.0, minLat: 51.4, maxLat: 55.4, minLon: -10.6, maxLon: -6.0 },
    { name: 'Portugal', lat: 39.4, lon: -8.2, minLat: 36.9, maxLat: 42.2, minLon: -9.6, maxLon: -6.2 },
    { name: 'Spain', lat: 40.4, lon: -3.7, minLat: 36.0, maxLat: 43.8, minLon: -9.3, maxLon: 3.4 },
    { name: 'France', lat: 46.2, lon: 2.2, minLat: 42.3, maxLat: 51.1, minLon: -5.1, maxLon: 8.3 },
    { name: 'Netherlands', lat: 52.1, lon: 5.3, minLat: 50.7, maxLat: 53.6, minLon: 3.3, maxLon: 7.2 },
    { name: 'Germany', lat: 51.2, lon: 10.4, minLat: 47.3, maxLat: 55.1, minLon: 5.9, maxLon: 15.0 },
    { name: 'Switzerland', lat: 46.8, lon: 8.2, minLat: 45.8, maxLat: 47.8, minLon: 5.9, maxLon: 10.5 },
    { name: 'Italy', lat: 41.9, lon: 12.6, minLat: 36.6, maxLat: 47.1, minLon: 6.6, maxLon: 18.5 },
    { name: 'Poland', lat: 51.9, lon: 19.1, minLat: 49.0, maxLat: 54.9, minLon: 14.1, maxLon: 24.2 },
    { name: 'Norway', lat: 60.5, lon: 8.5, minLat: 57.9, maxLat: 71.2, minLon: 4.5, maxLon: 31.1 },
    { name: 'Sweden', lat: 60.1, lon: 18.6, minLat: 55.3, maxLat: 69.1, minLon: 11.1, maxLon: 24.2 },
    { name: 'Finland', lat: 61.9, lon: 25.7, minLat: 59.8, maxLat: 70.1, minLon: 20.5, maxLon: 31.6 },
    { name: 'Ukraine', lat: 48.4, lon: 31.2, minLat: 44.3, maxLat: 52.4, minLon: 22.1, maxLon: 40.2 },
    { name: 'Greece', lat: 39.1, lon: 21.8, minLat: 34.8, maxLat: 41.8, minLon: 19.3, maxLon: 29.6 },
    { name: 'Turkey', lat: 38.9, lon: 35.2, minLat: 35.8, maxLat: 42.1, minLon: 26.0, maxLon: 44.8 },
    { name: 'Iceland', lat: 64.9, lon: -19.0, minLat: 63.2, maxLat: 66.6, minLon: -24.5, maxLon: -13.4 },
    { name: 'Greenland', lat: 71.7, lon: -42.6, minLat: 59.8, maxLat: 83.6, minLon: -73.0, maxLon: -12.0 },
    { name: 'United States', lat: 39.8, lon: -98.6, minLat: 24.5, maxLat: 49.4, minLon: -125.0, maxLon: -66.9 },
    { name: 'Alaska (US)', lat: 64.2, lon: -149.5, minLat: 54.0, maxLat: 71.5, minLon: -168.0, maxLon: -130.0 },
    { name: 'Canada', lat: 56.1, lon: -106.3, minLat: 42.0, maxLat: 83.1, minLon: -141.0, maxLon: -52.6 },
    { name: 'Mexico', lat: 23.6, lon: -102.5, minLat: 14.5, maxLat: 32.7, minLon: -117.2, maxLon: -86.7 },
    { name: 'Colombia', lat: 4.6, lon: -74.3, minLat: -4.2, maxLat: 12.6, minLon: -79.0, maxLon: -66.8 },
    { name: 'Peru', lat: -9.2, lon: -75.0, minLat: -18.4, maxLat: -0.0, minLon: -81.4, maxLon: -68.7 },
    { name: 'Chile', lat: -35.7, lon: -71.5, minLat: -55.9, maxLat: -17.5, minLon: -75.7, maxLon: -66.4 },
    { name: 'Argentina', lat: -38.4, lon: -63.6, minLat: -55.1, maxLat: -21.8, minLon: -73.6, maxLon: -53.6 },
    { name: 'Brazil', lat: -14.2, lon: -51.9, minLat: -33.8, maxLat: 5.3, minLon: -74.0, maxLon: -34.8 },
    { name: 'Morocco', lat: 31.8, lon: -7.1, minLat: 27.6, maxLat: 36.0, minLon: -13.2, maxLon: -1.0 },
    { name: 'Algeria', lat: 28.0, lon: 1.7, minLat: 19.0, maxLat: 37.1, minLon: -8.7, maxLon: 12.0 },
    { name: 'Egypt', lat: 26.8, lon: 30.8, minLat: 22.0, maxLat: 31.7, minLon: 24.7, maxLon: 36.9 },
    { name: 'Nigeria', lat: 9.1, lon: 8.7, minLat: 4.2, maxLat: 13.9, minLon: 2.7, maxLon: 14.7 },
    { name: 'Kenya', lat: -0.0, lon: 37.9, minLat: -4.7, maxLat: 5.1, minLon: 33.9, maxLon: 41.9 },
    { name: 'Ethiopia', lat: 9.1, lon: 40.5, minLat: 3.4, maxLat: 14.9, minLon: 33.0, maxLon: 48.0 },
    { name: 'South Africa', lat: -30.6, lon: 22.9, minLat: -34.9, maxLat: -22.1, minLon: 16.4, maxLon: 32.9 },
    { name: 'Madagascar', lat: -18.8, lon: 46.9, minLat: -25.6, maxLat: -11.9, minLon: 43.2, maxLon: 50.5 },
    { name: 'Saudi Arabia', lat: 23.9, lon: 45.1, minLat: 16.3, maxLat: 32.2, minLon: 34.5, maxLon: 55.7 },
    { name: 'United Arab Emirates', lat: 23.4, lon: 53.8, minLat: 22.6, maxLat: 26.1, minLon: 51.5, maxLon: 56.4 },
    { name: 'Iran', lat: 32.4, lon: 53.7, minLat: 25.0, maxLat: 39.8, minLon: 44.0, maxLon: 63.3 },
    { name: 'Pakistan', lat: 30.4, lon: 69.3, minLat: 23.6, maxLat: 37.1, minLon: 60.9, maxLon: 77.8 },
    { name: 'Sri Lanka', lat: 7.9, lon: 80.7, minLat: 5.9, maxLat: 9.9, minLon: 79.5, maxLon: 81.9 },
    { name: 'Nepal', lat: 28.4, lon: 84.1, minLat: 26.3, maxLat: 30.5, minLon: 80.0, maxLon: 88.2 },
    { name: 'Bangladesh', lat: 23.7, lon: 90.4, minLat: 20.7, maxLat: 26.7, minLon: 88.0, maxLon: 92.7 },
    { name: 'India', lat: 20.6, lon: 78.9, minLat: 7.8, maxLat: 35.5, minLon: 68.1, maxLon: 97.4 },
    { name: 'Thailand', lat: 15.9, lon: 100.9, minLat: 5.6, maxLat: 20.5, minLon: 97.3, maxLon: 105.7 },
    { name: 'Vietnam', lat: 14.1, lon: 108.3, minLat: 8.4, maxLat: 23.4, minLon: 102.1, maxLon: 109.5 },
    { name: 'Malaysia', lat: 4.2, lon: 101.9, minLat: 0.8, maxLat: 7.4, minLon: 99.6, maxLon: 119.3 },
    { name: 'Singapore', lat: 1.35, lon: 103.82, minLat: 1.15, maxLat: 1.50, minLon: 103.6, maxLon: 104.1 },
    { name: 'Indonesia', lat: -0.8, lon: 113.9, minLat: -11.0, maxLat: 5.9, minLon: 95.0, maxLon: 141.0 },
    { name: 'Philippines', lat: 12.9, lon: 121.8, minLat: 4.6, maxLat: 21.1, minLon: 116.9, maxLon: 126.6 },
    { name: 'Taiwan', lat: 23.7, lon: 121.0, minLat: 21.9, maxLat: 25.3, minLon: 120.0, maxLon: 122.0 },
    { name: 'South Korea', lat: 35.9, lon: 127.8, minLat: 33.1, maxLat: 38.6, minLon: 125.1, maxLon: 129.6 },
    { name: 'Japan', lat: 36.2, lon: 138.3, minLat: 24.0, maxLat: 45.6, minLon: 122.9, maxLon: 145.8 },
    { name: 'China', lat: 35.9, lon: 104.2, minLat: 18.2, maxLat: 53.6, minLon: 73.5, maxLon: 134.8 },
    { name: 'Russia', lat: 61.5, lon: 105.3, minLat: 41.2, maxLat: 77.7, minLon: 19.6, maxLon: 180.0 },
    { name: 'Australia', lat: -25.3, lon: 133.8, minLat: -43.7, maxLat: -10.7, minLon: 113.3, maxLon: 153.6 },
    { name: 'New Zealand', lat: -40.9, lon: 174.9, minLat: -47.3, maxLat: -34.4, minLon: 166.4, maxLon: 178.6 },
    { name: 'Antarctica', lat: -80.0, lon: 0.0, minLat: -90.0, maxLat: -63.0, minLon: -180.0, maxLon: 180.0 }
  ];

  const WORLD_CLOCK_PRESETS = [
    { city: 'New York', country: 'United States', tz: 'America/New_York' },
    { city: 'San Francisco', country: 'United States', tz: 'America/Los_Angeles' },
    { city: 'London', country: 'United Kingdom', tz: 'Europe/London' },
    { city: 'Paris', country: 'France', tz: 'Europe/Paris' },
    { city: 'Berlin', country: 'Germany', tz: 'Europe/Berlin' },
    { city: 'Dubai', country: 'UAE', tz: 'Asia/Dubai' },
    { city: 'New Delhi', country: 'India', tz: 'Asia/Kolkata' },
    { city: 'Singapore', country: 'Singapore', tz: 'Asia/Singapore' },
    { city: 'Tokyo', country: 'Japan', tz: 'Asia/Tokyo' },
    { city: 'Seoul', country: 'South Korea', tz: 'Asia/Seoul' },
    { city: 'Sydney', country: 'Australia', tz: 'Australia/Sydney' },
    { city: 'Toronto', country: 'Canada', tz: 'America/Toronto' },
    { city: 'Sao Paulo', country: 'Brazil', tz: 'America/Sao_Paulo' },
    { city: 'Cairo', country: 'Egypt', tz: 'Africa/Cairo' }
  ];

  function resolveLocalCentroid() {
    let tz = '';
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch (_) {}

    if (tz && TZ_MAP[tz]) {
      return { ...TZ_MAP[tz], tz, source: 'timezone' };
    }
    if (tz && tz.includes('/')) {
      const cityPart = tz.split('/').pop().replace(/_/g, ' ').toLowerCase();
      for (const [key, val] of Object.entries(TZ_MAP)) {
        if (val.city.toLowerCase() === cityPart) {
          return { ...val, tz: key, source: 'timezone' };
        }
      }
    }

    const lang = (typeof navigator !== 'undefined' && navigator.language) ? navigator.language : '';
    const region = lang.includes('-') ? lang.split('-').pop().toUpperCase() : '';
    if (region && LOCALE_REGIONS[region]) {
      return { ...LOCALE_REGIONS[region], code: region, source: 'locale' };
    }

    return { city: 'London', country: 'United Kingdom', code: 'GB', lat: 51.51, lon: -0.13, tz: 'Europe/London', source: 'fallback' };
  }

  function lookupCountryAt(lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '';
    // Check specific bounding boxes first; prefer closest centroid among matching boxes
    let best = null;
    let bestDist = Infinity;
    for (const c of COUNTRY_BOXES) {
      if (lat >= c.minLat && lat <= c.maxLat && lon >= c.minLon && lon <= c.maxLon) {
        const dLat = lat - c.lat;
        const dLon = lon - c.lon;
        const d = dLat * dLat + dLon * dLon;
        if (d < bestDist) {
          bestDist = d;
          best = c;
        }
      }
    }
    if (best) return best.name;

    // Ocean fallback names so hover feedback is informative everywhere on the globe
    if (lat > 66) return 'Arctic Ocean';
    if (lat < -60) return 'Southern Ocean';
    if (lon > -70 && lon < 20) return lat >= 0 ? 'North Atlantic Ocean' : 'South Atlantic Ocean';
    if (lon >= 20 && lon <= 120 && lat < 25) return 'Indian Ocean';
    return lat >= 0 ? 'North Pacific Ocean' : 'South Pacific Ocean';
  }

  function findCountryCentroid(nameOrCode) {
    if (!nameOrCode) return null;
    const q = String(nameOrCode).trim().toLowerCase();
    for (const box of COUNTRY_BOXES) {
      if (box.name.toLowerCase() === q) return { name: box.name, lat: box.lat, lon: box.lon };
    }
    for (const val of Object.values(TZ_MAP)) {
      if (val.country.toLowerCase() === q || val.city.toLowerCase() === q) {
        return { name: val.country, lat: val.lat, lon: val.lon };
      }
    }
    return null;
  }

  function findTimezoneForCity(query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return null;
    for (const p of WORLD_CLOCK_PRESETS) {
      if (p.city.toLowerCase() === q || p.city.toLowerCase().includes(q)) return p;
    }
    for (const [tz, val] of Object.entries(TZ_MAP)) {
      if (val.city.toLowerCase() === q || val.city.toLowerCase().includes(q) || tz.toLowerCase() === q) {
        return { city: val.city, country: val.country, tz };
      }
    }
    return null;
  }

  root.RustyLocations = {
    TZ_MAP,
    LOCALE_REGIONS,
    WORLD_CLOCK_PRESETS,
    resolveLocalCentroid,
    lookupCountryAt,
    findCountryCentroid,
    findTimezoneForCity
  };
})(typeof window !== 'undefined' ? window : this);
