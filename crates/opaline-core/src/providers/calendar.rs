//! Calendar: events from Evolution Data Server (what GNOME Calendar and GNOME Online Accounts
//! use) over its D-Bus API, plus ICS/webcal subscriptions, expanded into occurrences for the
//! next two weeks (brief §6 "Clock and calendar", ADR 0010).

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use chrono::{
    DateTime, Duration as ChronoDuration, Local, NaiveDate, NaiveDateTime, TimeZone, Utc,
};
use opaline_ipc::{TopicUpdate, Value};
use zbus::Connection;

use crate::engine::{update, while_subscribed};
use crate::hub::Hub;

pub const EVENTS: &str = "calendar.events";
pub const TOPICS: &[&str] = &[EVENTS];
const PERIOD: Duration = Duration::from_secs(300);
const DAYS_AHEAD: i64 = 14;
const MAX_EVENTS: usize = 200;
const MAX_OCCURRENCES: u16 = 100;
const ICS_MAX: usize = 4 << 20;

/// A date-time property: `DTSTART;TZID=Europe/Berlin:20261123T090000`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IcalTime {
    pub value: String,
    pub tzid: Option<String>,
    pub date_only: bool,
}

impl IcalTime {
    /// The instant this time denotes. Floating times and unknown zones (Windows names from
    /// Exchange) are read as local time.
    pub fn to_utc(&self) -> Option<DateTime<Utc>> {
        if self.date_only {
            let d = NaiveDate::parse_from_str(&self.value, "%Y%m%d").ok()?;
            return Local
                .from_local_datetime(&d.and_hms_opt(0, 0, 0)?)
                .earliest()
                .map(|t| t.with_timezone(&Utc));
        }
        if let Some(v) = self.value.strip_suffix('Z') {
            let n = NaiveDateTime::parse_from_str(v, "%Y%m%dT%H%M%S").ok()?;
            return Some(Utc.from_utc_datetime(&n));
        }
        let n = NaiveDateTime::parse_from_str(&self.value, "%Y%m%dT%H%M%S").ok()?;
        match self
            .tzid
            .as_deref()
            .and_then(|z| z.parse::<chrono_tz::Tz>().ok())
        {
            Some(tz) => tz
                .from_local_datetime(&n)
                .earliest()
                .map(|t| t.with_timezone(&Utc)),
            None => Local
                .from_local_datetime(&n)
                .earliest()
                .map(|t| t.with_timezone(&Utc)),
        }
    }

    fn to_line(&self, name: &str) -> String {
        match (&self.tzid, self.date_only) {
            (_, true) => format!("{name};VALUE=DATE:{}", self.value),
            (Some(tz), false) if tz.parse::<chrono_tz::Tz>().is_ok() => {
                format!("{name};TZID={tz}:{}", self.value)
            }
            _ => format!("{name}:{}", self.value),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Event {
    pub uid: String,
    pub summary: Option<String>,
    pub location: Option<String>,
    pub start: Option<IcalTime>,
    pub end: Option<IcalTime>,
    /// `DURATION` in seconds, when there's no DTEND.
    pub duration_s: Option<i64>,
    pub rrule: Option<String>,
    pub exdates: Vec<IcalTime>,
    pub recurrence_id: Option<IcalTime>,
    pub cancelled: bool,
}

/// Unfolds continuation lines (RFC 5545 §3.1).
fn unfold(text: &str) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    for raw in text.split('\n') {
        let raw = raw.trim_end_matches('\r');
        if let Some(rest) = raw.strip_prefix([' ', '\t']) {
            if let Some(last) = lines.last_mut() {
                last.push_str(rest);
            }
        } else if !raw.is_empty() {
            lines.push(raw.to_owned());
        }
    }
    lines
}

fn unescape_text(s: &str) -> String {
    s.replace("\\n", "\n")
        .replace("\\N", "\n")
        .replace("\\,", ",")
        .replace("\\;", ";")
        .replace("\\\\", "\\")
}

/// `NAME;PARAM=x;PARAM2=y:value` → (name, params, value).
fn split_prop(line: &str) -> Option<(String, HashMap<String, String>, String)> {
    let (head, value) = line.split_once(':')?;
    let mut parts = head.split(';');
    let name = parts.next()?.to_ascii_uppercase();
    let params = parts
        .filter_map(|p| p.split_once('='))
        .map(|(k, v)| (k.to_ascii_uppercase(), v.trim_matches('"').to_owned()))
        .collect();
    Some((name, params, value.to_owned()))
}

fn time(params: &HashMap<String, String>, value: &str) -> IcalTime {
    IcalTime {
        value: value.to_owned(),
        tzid: params.get("TZID").cloned(),
        date_only: params.get("VALUE").is_some_and(|v| v == "DATE")
            || (value.len() == 8 && !value.contains('T')),
    }
}

/// `PT1H30M`, `P1D`, `-PT15M` → seconds.
pub fn parse_duration(s: &str) -> Option<i64> {
    let (sign, s) = s
        .strip_prefix('-')
        .map_or((1, s.trim_start_matches('+')), |r| (-1, r));
    let s = s.strip_prefix('P')?;
    let (mut total, mut num, mut in_time) = (0i64, String::new(), false);
    for c in s.chars() {
        match c {
            'T' => in_time = true,
            '0'..='9' => num.push(c),
            unit => {
                let n: i64 = num.parse().ok()?;
                num.clear();
                total += n * match (unit, in_time) {
                    ('W', _) => 604_800,
                    ('D', _) => 86_400,
                    ('H', true) => 3600,
                    ('M', true) => 60,
                    ('S', true) => 1,
                    _ => return None,
                };
            }
        }
    }
    Some(sign * total)
}

/// Every VEVENT in an iCalendar text (an EDS object, or a whole .ics file).
pub fn parse_events(text: &str) -> Vec<Event> {
    let mut events = Vec::new();
    let mut current: Option<Event> = None;
    let mut depth = 0usize;
    for line in unfold(text) {
        let upper = line.to_ascii_uppercase();
        if upper == "BEGIN:VEVENT" {
            current = Some(Event::default());
            depth = 0;
            continue;
        }
        if upper == "END:VEVENT" {
            if let Some(e) = current.take() {
                events.push(e);
            }
            continue;
        }
        let Some(e) = current.as_mut() else { continue };
        // Skip nested components such as VALARM.
        if upper.starts_with("BEGIN:") {
            depth += 1;
            continue;
        }
        if upper.starts_with("END:") {
            depth = depth.saturating_sub(1);
            continue;
        }
        if depth > 0 {
            continue;
        }
        let Some((name, params, value)) = split_prop(&line) else {
            continue;
        };
        match name.as_str() {
            "UID" => e.uid = value,
            "SUMMARY" => e.summary = Some(unescape_text(&value)),
            "LOCATION" => e.location = Some(unescape_text(&value)).filter(|l| !l.is_empty()),
            "DTSTART" => e.start = Some(time(&params, &value)),
            "DTEND" => e.end = Some(time(&params, &value)),
            "DURATION" => e.duration_s = parse_duration(&value),
            "RRULE" => e.rrule = Some(value),
            "EXDATE" => e.exdates.extend(value.split(',').map(|v| time(&params, v))),
            "RECURRENCE-ID" => e.recurrence_id = Some(time(&params, &value)),
            "STATUS" => e.cancelled = value.eq_ignore_ascii_case("CANCELLED"),
            _ => {}
        }
    }
    events
}

/// One occurrence to show.
#[derive(Debug, Clone, PartialEq)]
pub struct Occurrence {
    pub title: String,
    pub location: Option<String>,
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
    pub all_day: bool,
    pub calendar: String,
    pub color: Option<String>,
}

fn length(e: &Event, start: DateTime<Utc>) -> ChronoDuration {
    if let Some(end) = e.end.as_ref().and_then(IcalTime::to_utc) {
        return (end - start).max(ChronoDuration::zero());
    }
    if let Some(d) = e.duration_s {
        return ChronoDuration::seconds(d.max(0));
    }
    if e.start.as_ref().is_some_and(|s| s.date_only) {
        ChronoDuration::days(1)
    } else {
        ChronoDuration::zero()
    }
}

/// Expands events (with their recurrence rules, exceptions and moved instances) into the
/// occurrences overlapping `[from, to)`.
pub fn occurrences(
    events: &[Event],
    from: DateTime<Utc>,
    to: DateTime<Utc>,
    calendar: &str,
    color: Option<&str>,
) -> Vec<Occurrence> {
    // Moved or changed instances replace the occurrence their RECURRENCE-ID names.
    let overridden: HashSet<(String, i64)> = events
        .iter()
        .filter_map(|e| {
            Some((
                e.uid.clone(),
                e.recurrence_id.as_ref()?.to_utc()?.timestamp(),
            ))
        })
        .collect();
    let mut out = Vec::new();
    for e in events.iter().filter(|e| !e.cancelled) {
        let Some(start) = e.start.as_ref() else {
            continue;
        };
        let Some(first) = start.to_utc() else {
            continue;
        };
        let len = length(e, first);
        let starts: Vec<DateTime<Utc>> = match (&e.rrule, &e.recurrence_id) {
            (Some(rule), None) => {
                let mut text = format!("{}\nRRULE:{rule}", start.to_line("DTSTART"));
                for ex in &e.exdates {
                    text.push('\n');
                    text.push_str(&ex.to_line("EXDATE"));
                }
                match text.parse::<rrule::RRuleSet>() {
                    Ok(set) => {
                        let after = (from - len - ChronoDuration::seconds(1))
                            .with_timezone(&rrule::Tz::UTC);
                        set.after(after)
                            .before(to.with_timezone(&rrule::Tz::UTC))
                            .all(MAX_OCCURRENCES)
                            .dates
                            .into_iter()
                            .map(|d| d.with_timezone(&Utc))
                            .filter(|d| !overridden.contains(&(e.uid.clone(), d.timestamp())))
                            .collect()
                    }
                    Err(error) => {
                        tracing::debug!(%error, uid = %e.uid, "unsupported recurrence rule; showing the first occurrence");
                        vec![first]
                    }
                }
            }
            _ => vec![first],
        };
        for s in starts {
            let end = s + len;
            if end > from && s < to || (len.is_zero() && s >= from && s < to) {
                out.push(Occurrence {
                    title: e.summary.clone().unwrap_or_default(),
                    location: e.location.clone(),
                    start: s,
                    end,
                    all_day: start.date_only,
                    calendar: calendar.to_owned(),
                    color: color.map(str::to_owned),
                });
            }
        }
    }
    out
}

pub fn events_value(mut list: Vec<Occurrence>) -> Value {
    list.sort_by_key(|o| (o.start, !o.all_day));
    Value::List(
        list.into_iter()
            .take(MAX_EVENTS)
            .map(|o| {
                Value::map([
                    ("title", Value::from(o.title)),
                    ("location", Value::from(o.location)),
                    ("startMs", Value::Num(o.start.timestamp_millis() as f64)),
                    ("endMs", Value::Num(o.end.timestamp_millis() as f64)),
                    ("allDay", Value::Bool(o.all_day)),
                    ("calendar", Value::from(o.calendar)),
                    ("color", Value::from(o.color)),
                ])
            })
            .collect(),
    )
}

/// A calendar source from EDS: its key-file `Data`.
#[derive(Debug, Clone, PartialEq)]
pub struct Source {
    pub uid: String,
    pub name: String,
    pub color: Option<String>,
}

/// Reads an EDS source key file: enabled sources with a `[Calendar]` group, localized name.
pub fn parse_source(uid: &str, data: &str, lang: Option<&str>) -> Option<Source> {
    let mut group = String::new();
    let (mut name, mut localized, mut enabled, mut is_calendar, mut selected, mut color) =
        (None, None, true, false, true, None);
    for line in data.lines() {
        let line = line.trim();
        if let Some(g) = line.strip_prefix('[').and_then(|l| l.strip_suffix(']')) {
            group = g.to_owned();
            is_calendar |= group == "Calendar";
            continue;
        }
        let Some((k, v)) = line.split_once('=') else {
            continue;
        };
        match (group.as_str(), k) {
            ("Data Source", "DisplayName") => name = Some(v.to_owned()),
            ("Data Source", key) if lang.is_some_and(|l| key == format!("DisplayName[{l}]")) => {
                localized = Some(v.to_owned())
            }
            ("Data Source", "Enabled") => enabled = v == "true",
            ("Calendar", "Selected") => selected = v == "true",
            ("Calendar", "Color") => color = Some(v.to_owned()).filter(|c| c.starts_with('#')),
            _ => {}
        }
    }
    (is_calendar && enabled && selected).then(|| Source {
        uid: uid.to_owned(),
        name: localized.or(name).unwrap_or_else(|| uid.to_owned()),
        color,
    })
}

const SOURCES: &str = "org.gnome.evolution.dataserver.Sources5";
const CALENDARS: &str = "org.gnome.evolution.dataserver.Calendar8";

async fn eds_sources(conn: &Connection) -> Result<Vec<Source>, String> {
    let proxy = zbus::fdo::ObjectManagerProxy::builder(conn)
        .destination(SOURCES)
        .path("/org/gnome/evolution/dataserver/SourceManager")
        .build()
        .await
        .map_err(|e| e.to_string())?;
    let objects = proxy
        .get_managed_objects()
        .await
        .map_err(|e| e.to_string())?;
    let lang = std::env::var("LANG")
        .ok()
        .and_then(|l| l.split(['_', '.']).next().map(str::to_owned));
    Ok(objects
        .values()
        .filter_map(|ifaces| {
            let props = ifaces
                .iter()
                .find(|(n, _)| n.as_str() == "org.gnome.evolution.dataserver.Source")?
                .1;
            let uid = props.get("UID").and_then(|v| <&str>::try_from(v).ok())?;
            let data = props.get("Data").and_then(|v| <&str>::try_from(v).ok())?;
            parse_source(uid, data, lang.as_deref())
        })
        .collect())
}

fn sexp_time(t: DateTime<Utc>) -> String {
    t.format("%Y%m%dT%H%M%SZ").to_string()
}

async fn eds_events(
    conn: &Connection,
    source: &Source,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
) -> Result<Vec<Occurrence>, String> {
    let (path, bus): (String, String) = conn
        .call_method(
            Some(CALENDARS),
            "/org/gnome/evolution/dataserver/CalendarFactory",
            Some("org.gnome.evolution.dataserver.CalendarFactory"),
            "OpenCalendar",
            &(source.uid.as_str(),),
        )
        .await
        .map_err(|e| e.to_string())?
        .body()
        .deserialize()
        .map_err(|e| e.to_string())?;
    let iface = "org.gnome.evolution.dataserver.Calendar";
    conn.call_method(Some(bus.as_str()), path.as_str(), Some(iface), "Open", &())
        .await
        .map_err(|e| e.to_string())?;
    let sexp = format!(
        "(occur-in-time-range? (make-time \"{}\") (make-time \"{}\"))",
        sexp_time(from),
        sexp_time(to)
    );
    let objects: Vec<String> = conn
        .call_method(
            Some(bus.as_str()),
            path.as_str(),
            Some(iface),
            "GetObjectList",
            &(sexp.as_str(),),
        )
        .await
        .map_err(|e| e.to_string())?
        .body()
        .deserialize()
        .map_err(|e| e.to_string())?;
    let events: Vec<Event> = objects.iter().flat_map(|o| parse_events(o)).collect();
    Ok(occurrences(
        &events,
        from,
        to,
        &source.name,
        source.color.as_deref(),
    ))
}

async fn ics_events(
    url: &str,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
) -> Result<Vec<Occurrence>, String> {
    let https = url.replacen("webcal://", "https://", 1);
    let (body, _) = crate::http::fetch_limited(
        &https,
        ICS_MAX,
        &["text/calendar", "text/plain", "application/octet-stream"],
    )
    .await?;
    let text = String::from_utf8_lossy(&body);
    let name = text
        .lines()
        .find_map(|l| l.strip_prefix("X-WR-CALNAME:"))
        .map_or_else(|| https.clone(), |n| n.trim().to_owned());
    Ok(occurrences(&parse_events(&text), from, to, &name, None))
}

async fn fetch(conn: Option<&Connection>, hub: &Hub) -> Result<Vec<TopicUpdate>, String> {
    let settings = hub.settings();
    let from = Local::now()
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .and_then(|d| Local.from_local_datetime(&d).earliest())
        .map_or_else(Utc::now, |d| d.with_timezone(&Utc));
    let to = from + ChronoDuration::days(DAYS_AHEAD);
    let mut all = Vec::new();
    let mut sources_ok = false;
    if settings.calendar.system
        && let Some(conn) = conn
    {
        match eds_sources(conn).await {
            Ok(sources) => {
                sources_ok = true;
                for s in &sources {
                    match eds_events(conn, s, from, to).await {
                        Ok(mut v) => all.append(&mut v),
                        Err(error) => {
                            tracing::debug!(%error, source = %s.uid, "calendar source unreadable")
                        }
                    }
                }
            }
            Err(error) => tracing::debug!(%error, "Evolution Data Server not reachable"),
        }
    }
    for url in &settings.calendar.subscriptions {
        match ics_events(url, from, to).await {
            Ok(mut v) => {
                sources_ok = true;
                all.append(&mut v);
            }
            Err(error) => tracing::warn!(%error, "calendar subscription failed"),
        }
    }
    let value =
        if sources_ok || settings.calendar.subscriptions.is_empty() && !settings.calendar.system {
            events_value(all)
        } else {
            Value::unavailable("no-calendar-source")
        };
    Ok(vec![update(EVENTS, value)])
}

pub async fn run(hub: Arc<Hub>) -> Result<(), String> {
    let conn = Connection::session().await.ok();
    while_subscribed(&hub, TOPICS, PERIOD, || {
        let (conn, hub) = (conn.clone(), hub.clone());
        async move { fetch(conn.as_ref(), &hub).await }
    })
    .await
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::panic)]

    use super::*;

    fn utc(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    const WEEKLY: &str = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:standup\r\nSUMMARY:Stand-up\\, team\r\nLOCATION:Room 1\r\nDTSTART;TZID=Europe/Berlin:20261102T093000\r\nDTEND;TZID=Europe/Berlin:20261102T094500\r\nRRULE:FREQ=WEEKLY;BYDAY=MO\r\nEXDATE;TZID=Europe/Berlin:20261116T093000\r\nBEGIN:VALARM\r\nTRIGGER:-PT10M\r\nSUMMARY:not this\r\nEND:VALARM\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:standup\r\nRECURRENCE-ID;TZID=Europe/Berlin:20261123T093000\r\nSUMMARY:Stand-up (moved)\r\nDTSTART;TZID=Europe/Berlin:20261123T110000\r\nDTEND;TZID=Europe/Berlin:20261123T111500\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:holiday\r\nSUMMARY:Holiday\r\nDTSTART;VALUE=DATE:20261125\r\nDTEND;VALUE=DATE:20261126\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:gone\r\nSUMMARY:Cancelled\r\nSTATUS:CANCELLED\r\nDTSTART:20261124T100000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

    #[test]
    fn parses_and_expands() {
        let events = parse_events(WEEKLY);
        assert_eq!(events.len(), 4);
        assert_eq!(
            events[0].summary.as_deref(),
            Some("Stand-up, team"),
            "escapes undone, VALARM ignored"
        );
        let occ = occurrences(
            &events,
            utc("2026-11-09T00:00:00Z"),
            utc("2026-12-01T00:00:00Z"),
            "Work",
            Some("#62a0ea"),
        );
        let titles: Vec<(String, String)> = occ
            .iter()
            .map(|o| (o.title.clone(), o.start.to_rfc3339()))
            .collect();
        assert!(titles.contains(&("Stand-up, team".into(), "2026-11-09T08:30:00+00:00".into())));
        assert!(
            !titles.iter().any(|(_, s)| s.starts_with("2026-11-16")),
            "EXDATE removes the 16th"
        );
        assert!(titles.contains(&(
            "Stand-up (moved)".into(),
            "2026-11-23T10:00:00+00:00".into()
        )));
        assert!(
            !titles.contains(&("Stand-up, team".into(), "2026-11-23T08:30:00+00:00".into())),
            "the moved instance replaces the original"
        );
        assert!(titles.contains(&("Stand-up, team".into(), "2026-11-30T08:30:00+00:00".into())));
        assert!(occ.iter().any(|o| o.title == "Holiday" && o.all_day));
        assert!(!occ.iter().any(|o| o.title == "Cancelled"));
        assert_eq!(occ[0].calendar, "Work");
    }

    #[test]
    fn durations() {
        assert_eq!(parse_duration("PT1H30M"), Some(5400));
        assert_eq!(parse_duration("P1D"), Some(86_400));
        assert_eq!(parse_duration("-PT15M"), Some(-900));
        assert_eq!(parse_duration("P2W"), Some(1_209_600));
        assert_eq!(parse_duration("1H"), None);
    }

    #[test]
    fn eds_sources() {
        let data = "[Data Source]\nDisplayName=Personal\nDisplayName[de]=Persönlich\nEnabled=true\nParent=local-stub\n\n[Calendar]\nBackendName=local\nColor=#62a0ea\nSelected=true\n";
        assert_eq!(
            parse_source("system-calendar", data, Some("de")),
            Some(Source {
                uid: "system-calendar".into(),
                name: "Persönlich".into(),
                color: Some("#62a0ea".into()),
            })
        );
        assert_eq!(
            parse_source("x", &data.replace("Selected=true", "Selected=false"), None),
            None
        );
        assert_eq!(
            parse_source(
                "x",
                "[Data Source]\nDisplayName=Contacts\n[Address Book]\n",
                None
            ),
            None
        );
    }

    #[test]
    fn folded_lines() {
        let e = parse_events(
            "BEGIN:VEVENT\r\nUID:x\r\nSUMMARY:A very long\r\n  title\r\nDTSTART:20261123T100000Z\r\nEND:VEVENT\r\n",
        );
        assert_eq!(e[0].summary.as_deref(), Some("A very long title"));
    }
}
