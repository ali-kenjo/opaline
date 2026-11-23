//! `system.loadavg`: the 1/5/15-minute load averages from `/proc/loadavg`.
//!
//! The first topic, used since Phase 0 to prove the core → layer path.

use opaline_ipc::{Availability, TopicUpdate, Value};

use crate::engine::{Probe, Provider, ProviderError, SampleCx, TopicDesc, update};

pub const TOPIC: &str = "system.loadavg";
const PATH: &str = "/proc/loadavg";

/// Parses the first three fields of `/proc/loadavg`.
pub fn parse(content: &str) -> Option<[f64; 3]> {
    let mut fields = content.split_ascii_whitespace();
    let mut next = || {
        fields
            .next()?
            .parse::<f64>()
            .ok()
            .filter(|v| v.is_finite() && *v >= 0.0)
    };
    Some([next()?, next()?, next()?])
}

/// Reads `/proc/loadavg`.
#[derive(Debug, Default)]
pub struct LoadAvg;

const TOPICS: &[TopicDesc] = &[TopicDesc::new(TOPIC)];

impl Provider for LoadAvg {
    fn id(&self) -> &'static str {
        "loadavg"
    }

    fn topics(&self) -> &[TopicDesc] {
        TOPICS
    }

    fn probe(&mut self) -> Probe {
        match std::fs::read_to_string(PATH)
            .ok()
            .as_deref()
            .and_then(parse)
        {
            Some(_) => Probe::default().available(TOPIC),
            None => Probe::default().missing(
                TOPIC,
                Availability::Unavailable {
                    reason: "loadavg-unreadable".into(),
                },
            ),
        }
    }

    fn sample(&mut self, _cx: &SampleCx<'_>) -> Result<Vec<TopicUpdate>, ProviderError> {
        let content = std::fs::read_to_string(PATH)?;
        let value = parse(&content).map_or_else(
            || Value::unavailable("loadavg-unreadable"),
            |values| Value::Nums(values.to_vec()),
        );
        Ok(vec![update(TOPIC, value)])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_proc_loadavg() {
        assert_eq!(
            parse("0.52 0.58 0.59 2/1234 98765\n"),
            Some([0.52, 0.58, 0.59])
        );
    }

    #[test]
    fn rejects_garbage() {
        assert_eq!(parse(""), None);
        assert_eq!(parse("0.1 0.2"), None);
        assert_eq!(parse("a b c"), None);
        assert_eq!(parse("-1 0 0"), None);
        assert_eq!(parse("NaN 0 0"), None);
    }
}
