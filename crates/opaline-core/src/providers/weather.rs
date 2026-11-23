//! Weather from Open-Meteo (forecast, air quality; no API key, attribution shown by the
//! widget) for the location in settings, cached on disk, refreshed every 15 min while visible
//! and every 60 min otherwise. City search through Open-Meteo geocoding (brief §6 "Weather").

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use opaline_ipc::{ActivityClass, TopicUpdate, Value};
use serde::{Deserialize, Serialize};

use crate::engine::update;
use crate::hub::{Hub, now_ms};
use crate::json::from_json;
use crate::store::Location;

pub const CURRENT: &str = "weather.current";
pub const HOURLY: &str = "weather.hourly";
pub const DAILY: &str = "weather.daily";
pub const AIR: &str = "weather.air";
pub const TOPICS: &[&str] = &[CURRENT, HOURLY, DAILY, AIR];

const VISIBLE_EVERY: Duration = Duration::from_secs(15 * 60);
const HIDDEN_EVERY: Duration = Duration::from_secs(60 * 60);
const FORECAST: &str = "https://api.open-meteo.com/v1/forecast";
const AIR_QUALITY: &str = "https://air-quality-api.open-meteo.com/v1/air-quality";
const GEOCODING: &str = "https://geocoding-api.open-meteo.com/v1/search";

fn url(base: &str, params: &[(&str, String)]) -> Result<String, String> {
    reqwest::Url::parse_with_params(base, params)
        .map(|u| u.to_string())
        .map_err(|e| e.to_string())
}

pub fn forecast_url(l: &Location) -> Result<String, String> {
    url(
        FORECAST,
        &[
            ("latitude", l.latitude.to_string()),
            ("longitude", l.longitude.to_string()),
            (
                "current",
                "temperature_2m,apparent_temperature,relative_humidity_2m,is_day,weather_code,\
                 wind_speed_10m,wind_direction_10m,precipitation,cloud_cover,pressure_msl"
                    .into(),
            ),
            (
                "hourly",
                "temperature_2m,precipitation_probability,weather_code,is_day".into(),
            ),
            (
                "daily",
                "weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,\
                 precipitation_probability_max,uv_index_max"
                    .into(),
            ),
            ("forecast_days", "7".into()),
            ("forecast_hours", "24".into()),
            ("timezone", "auto".into()),
        ],
    )
}

pub fn air_url(l: &Location) -> Result<String, String> {
    url(
        AIR_QUALITY,
        &[
            ("latitude", l.latitude.to_string()),
            ("longitude", l.longitude.to_string()),
            ("current", "european_aqi,us_aqi,pm2_5,pm10".into()),
            ("timezone", "auto".into()),
        ],
    )
}

/// Turns Open-Meteo's column arrays (`hourly.time[]`, `hourly.temperature_2m[]`, …) into a list
/// of rows with our field names.
fn rows(block: Option<&serde_json::Value>, fields: &[(&str, &str)]) -> Value {
    let Some(block) = block else {
        return Value::unavailable("not-reported");
    };
    let len = block
        .get("time")
        .and_then(|t| t.as_array())
        .map_or(0, Vec::len);
    Value::List(
        (0..len)
            .map(|i| {
                Value::Map(
                    fields
                        .iter()
                        .map(|(ours, theirs)| {
                            let v = block
                                .get(*theirs)
                                .and_then(|c| c.get(i))
                                .cloned()
                                .unwrap_or_default();
                            ((*ours).to_owned(), from_json(&v))
                        })
                        .collect(),
                )
            })
            .collect(),
    )
}

pub fn values(
    location: &Location,
    forecast: &serde_json::Value,
    air: Option<&serde_json::Value>,
    fetched_ms: u64,
) -> Vec<TopicUpdate> {
    let c = forecast.get("current");
    let get = |k: &str| from_json(c.and_then(|c| c.get(k)).unwrap_or(&serde_json::Value::Null));
    let current = Value::map([
        ("location", Value::from(location.name.as_str())),
        ("tempC", get("temperature_2m")),
        ("feelsC", get("apparent_temperature")),
        ("humidity", get("relative_humidity_2m")),
        (
            "isDay",
            match c
                .and_then(|c| c.get("is_day"))
                .and_then(serde_json::Value::as_f64)
            {
                Some(d) => Value::Bool(d > 0.0),
                None => Value::unavailable("not-reported"),
            },
        ),
        ("code", get("weather_code")),
        ("windKmh", get("wind_speed_10m")),
        ("windDir", get("wind_direction_10m")),
        ("precipMm", get("precipitation")),
        ("cloud", get("cloud_cover")),
        ("pressureHpa", get("pressure_msl")),
        (
            "timezone",
            from_json(forecast.get("timezone").unwrap_or(&serde_json::Value::Null)),
        ),
        ("updatedMs", Value::Num(fetched_ms as f64)),
        ("source", Value::from("Open-Meteo")),
    ]);
    let hourly = rows(
        forecast.get("hourly"),
        &[
            ("time", "time"),
            ("tempC", "temperature_2m"),
            ("precipProb", "precipitation_probability"),
            ("code", "weather_code"),
            ("isDay", "is_day"),
        ],
    );
    let daily = rows(
        forecast.get("daily"),
        &[
            ("date", "time"),
            ("code", "weather_code"),
            ("maxC", "temperature_2m_max"),
            ("minC", "temperature_2m_min"),
            ("sunrise", "sunrise"),
            ("sunset", "sunset"),
            ("precipProb", "precipitation_probability_max"),
            ("uv", "uv_index_max"),
        ],
    );
    let air = match air.and_then(|a| a.get("current")) {
        Some(a) => Value::map([
            (
                "europeanAqi",
                from_json(a.get("european_aqi").unwrap_or(&serde_json::Value::Null)),
            ),
            (
                "usAqi",
                from_json(a.get("us_aqi").unwrap_or(&serde_json::Value::Null)),
            ),
            (
                "pm25",
                from_json(a.get("pm2_5").unwrap_or(&serde_json::Value::Null)),
            ),
            (
                "pm10",
                from_json(a.get("pm10").unwrap_or(&serde_json::Value::Null)),
            ),
        ]),
        None => Value::unavailable("not-reported"),
    };
    vec![
        update(CURRENT, current),
        update(HOURLY, hourly),
        update(DAILY, daily),
        update(AIR, air),
    ]
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Cache {
    location: Location,
    fetched_ms: u64,
    forecast: serde_json::Value,
    air: Option<serde_json::Value>,
}

fn cache_path() -> Option<PathBuf> {
    crate::paths::cache_dir()
        .ok()
        .map(|d| d.join("weather.json"))
}

fn read_cache(location: &Location) -> Option<Cache> {
    let text = std::fs::read_to_string(cache_path()?).ok()?;
    let cache: Cache = serde_json::from_str(&text).ok()?;
    (cache.location == *location).then_some(cache)
}

fn write_cache(cache: &Cache) {
    if let (Some(path), Ok(bytes)) = (cache_path(), serde_json::to_vec(cache)) {
        let _ = crate::paths::write_atomic(&path, &bytes);
    }
}

async fn fetch(location: &Location) -> Result<Cache, String> {
    let forecast = crate::http::get_json(&forecast_url(location)?).await?;
    // Air quality is a separate service; weather still works if it fails.
    let air = crate::http::get_json(&air_url(location)?).await.ok();
    Ok(Cache {
        location: location.clone(),
        fetched_ms: now_ms(),
        forecast,
        air,
    })
}

fn not_set_up(hub: &Hub, reason: &str) {
    hub.publish(
        TOPICS
            .iter()
            .map(|t| update(t, Value::unavailable(reason)))
            .collect(),
    );
}

pub async fn run(hub: Arc<Hub>) -> Result<(), String> {
    let mut subs = hub.watch_subscriptions();
    let mut settings = hub.watch_settings();
    let mut last: Option<Cache> = None;
    loop {
        subs.mark_unchanged();
        settings.mark_unchanged();
        let interest = TOPICS.iter().filter_map(|t| hub.interest(t)).max();
        if let Some(class) = interest {
            let s = hub.settings();
            match (&s.weather.location, s.weather.automatic) {
                (None, true) => not_set_up(&hub, "location-pending"),
                (None, false) => not_set_up(&hub, "no-location"),
                (Some(location), _) => {
                    let every = if class >= ActivityClass::Ambient {
                        VISIBLE_EVERY
                    } else {
                        HIDDEN_EVERY
                    };
                    let fresh = |c: &Cache| {
                        c.location == *location
                            && now_ms().saturating_sub(c.fetched_ms) < every.as_millis() as u64
                    };
                    if last.as_ref().is_none_or(|c| c.location != *location) {
                        let loc = location.clone();
                        last = tokio::task::spawn_blocking(move || read_cache(&loc))
                            .await
                            .ok()
                            .flatten();
                    }
                    if !last.as_ref().is_some_and(fresh) {
                        match fetch(location).await {
                            Ok(c) => {
                                let copy = c.clone();
                                tokio::task::spawn_blocking(move || write_cache(&copy));
                                last = Some(c);
                            }
                            Err(error) => {
                                tracing::warn!(%error, "weather fetch failed; keeping the cached forecast")
                            }
                        }
                    }
                    match &last {
                        Some(c) if c.location == *location => {
                            hub.publish(values(location, &c.forecast, c.air.as_ref(), c.fetched_ms))
                        }
                        _ => not_set_up(&hub, "offline"),
                    }
                }
            }
        }
        let wait = if interest.is_some_and(|c| c >= ActivityClass::Ambient) {
            VISIBLE_EVERY
        } else {
            HIDDEN_EVERY
        };
        tokio::select! {
            () = tokio::time::sleep(wait), if interest.is_some() => {}
            c = subs.changed() => c.map_err(|_| "hub closed".to_owned())?,
            c = settings.changed() => c.map_err(|_| "hub closed".to_owned())?,
        }
    }
}

/// City search for the weather location: up to 8 places with coordinates.
pub async fn geocode(query: &str, language: &str) -> Result<Value, String> {
    let query = query.trim();
    if query.chars().count() < 2 {
        return Ok(Value::List(Vec::new()));
    }
    let lang = if language.len() == 2 && language.chars().all(|c| c.is_ascii_alphabetic()) {
        language
    } else {
        "en"
    };
    let json = crate::http::get_json(&url(
        GEOCODING,
        &[
            ("name", query.to_owned()),
            ("count", "8".into()),
            ("language", lang.to_owned()),
            ("format", "json".into()),
        ],
    )?)
    .await?;
    Ok(geocode_results(&json))
}

pub fn geocode_results(json: &serde_json::Value) -> Value {
    let results = json
        .get("results")
        .and_then(|r| r.as_array())
        .cloned()
        .unwrap_or_default();
    Value::List(
        results
            .iter()
            .filter_map(|r| {
                Some(Value::map([
                    ("name", Value::from(r.get("name")?.as_str()?)),
                    ("latitude", Value::Num(r.get("latitude")?.as_f64()?)),
                    ("longitude", Value::Num(r.get("longitude")?.as_f64()?)),
                    (
                        "country",
                        Value::from(r.get("country").and_then(|c| c.as_str()).map(str::to_owned)),
                    ),
                    (
                        "region",
                        Value::from(r.get("admin1").and_then(|c| c.as_str()).map(str::to_owned)),
                    ),
                ]))
            })
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::panic)]

    use serde_json::json;

    use super::*;

    fn berlin() -> Location {
        Location {
            name: "Berlin".into(),
            latitude: 52.52,
            longitude: 13.41,
            country: Some("Germany".into()),
        }
    }

    #[test]
    fn urls() {
        let u = forecast_url(&berlin()).unwrap();
        assert!(
            u.starts_with("https://api.open-meteo.com/v1/forecast?latitude=52.52&longitude=13.41")
        );
        assert!(u.contains("timezone=auto"));
        assert!(air_url(&berlin()).unwrap().contains("european_aqi"));
    }

    #[test]
    fn values_from_a_reply() {
        let forecast = json!({
            "timezone": "Europe/Berlin",
            "current": {"temperature_2m": 4.2, "apparent_temperature": 1.0, "is_day": 0, "weather_code": 61},
            "hourly": {"time": ["2026-11-23T14:00", "2026-11-23T15:00"], "temperature_2m": [4.2, 4.0], "weather_code": [61, 3], "precipitation_probability": [80, 40], "is_day": [1, 1]},
            "daily": {"time": ["2026-11-23"], "temperature_2m_max": [6.0], "temperature_2m_min": [1.5], "weather_code": [61]}
        });
        let air = json!({"current": {"european_aqi": 22, "pm2_5": 6.1}});
        let v = values(&berlin(), &forecast, Some(&air), 1);
        let get = |t: &str| {
            v.iter()
                .find(|u| u.topic.as_str() == t)
                .unwrap()
                .value
                .clone()
        };
        let Value::Map(cur) = get(CURRENT) else {
            panic!()
        };
        assert_eq!(cur["tempC"], Value::Num(4.2));
        assert_eq!(cur["isDay"], Value::Bool(false));
        assert_eq!(cur["windKmh"], Value::unavailable("not-reported"));
        assert_eq!(cur["source"], Value::from("Open-Meteo"));
        let Value::List(hours) = get(HOURLY) else {
            panic!()
        };
        assert_eq!(hours.len(), 2);
        let Value::Map(h1) = &hours[1] else { panic!() };
        assert_eq!(h1["precipProb"], Value::Num(40.0));
        let Value::Map(a) = get(AIR) else { panic!() };
        assert_eq!(a["europeanAqi"], Value::Num(22.0));
    }

    #[test]
    fn geocoding_results() {
        let Value::List(r) = geocode_results(
            &json!({"results": [{"name": "Berlin", "latitude": 52.52, "longitude": 13.41, "country": "Deutschland", "admin1": "Berlin"}, {"name": "broken"}]}),
        ) else {
            panic!()
        };
        assert_eq!(r.len(), 1, "entries without coordinates are dropped");
        assert_eq!(geocode_results(&json!({})), Value::List(Vec::new()));
    }
}
