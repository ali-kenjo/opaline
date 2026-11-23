//! Fans: every hwmon `fan*_input`, read-only. Unlabeled fans are "Fan N"; we don't guess which
//! one cools what (brief §6 "Fans", SENSORS.md §9).

use opaline_ipc::{Availability, TopicUpdate, Value};

use super::hwmon;
use crate::engine::{Probe, Provider, ProviderError, SampleCx, TopicDesc, update};
use crate::sysfs::{HotFile, Root};

pub const FANS: &str = "fans.list";
const TOPICS: &[TopicDesc] = &[TopicDesc::new(FANS)];

struct Fan {
    name: String,
    device: String,
    max: Option<f64>,
    input: Option<HotFile>,
}

pub struct Fans {
    fans: Vec<Fan>,
}

impl std::fmt::Debug for Fans {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Fans")
            .field("count", &self.fans.len())
            .finish()
    }
}

impl Fans {
    pub fn new(root: &Root) -> Self {
        let mut n = 0;
        let fans = hwmon::discover(root)
            .into_iter()
            .flat_map(|dev| dev.fans.into_iter().map(move |c| (dev.name.clone(), c)))
            .map(|(device, c)| {
                n += 1;
                Fan {
                    name: c.label.clone().unwrap_or_else(|| format!("Fan {n}")),
                    device,
                    max: c.max,
                    input: root.open(&c.input).ok(),
                }
            })
            .collect();
        Self { fans }
    }
}

impl Provider for Fans {
    fn id(&self) -> &'static str {
        "fans"
    }

    fn topics(&self) -> &[TopicDesc] {
        TOPICS
    }

    fn probe(&mut self) -> Probe {
        if self.fans.is_empty() {
            Probe::default().missing(
                FANS,
                Availability::Unavailable {
                    reason: "no-fan-sensor".into(),
                },
            )
        } else {
            Probe::default()
                .available(FANS)
                .detail("fans", self.fans.len().to_string())
        }
    }

    fn sample(&mut self, cx: &SampleCx<'_>) -> Result<Vec<TopicUpdate>, ProviderError> {
        if !cx.is_due(FANS) {
            return Ok(Vec::new());
        }
        if self.fans.is_empty() {
            return Ok(vec![update(FANS, Value::unavailable("no-fan-sensor"))]);
        }
        let list = self
            .fans
            .iter_mut()
            .map(|f| {
                let rpm = f
                    .input
                    .as_mut()
                    .and_then(|i| i.read().ok())
                    .and_then(|b| std::str::from_utf8(b).ok())
                    .and_then(|s| s.trim().parse::<f64>().ok());
                Value::map([
                    ("name", Value::from(f.name.as_str())),
                    ("device", Value::from(f.device.as_str())),
                    ("rpm", Value::from(rpm)),
                    ("maxRpm", Value::from(f.max)),
                ])
            })
            .collect();
        Ok(vec![update(FANS, Value::List(list))])
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::panic)]

    use super::*;
    use crate::sysfs::fixture;

    #[test]
    fn unlabeled_fans_are_numbered() {
        let mut fans = Fans::new(&fixture("hp-i5-10300h"));
        let cx = SampleCx {
            now: std::time::Instant::now(),
            due: &[FANS],
        };
        let v = fans.sample(&cx).unwrap().remove(0).value;
        let Value::List(list) = v else { panic!() };
        assert_eq!(list.len(), 2);
        let Value::Map(first) = &list[0] else {
            panic!()
        };
        assert_eq!(first["name"], Value::from("Fan 1"));
        assert_eq!(first["device"], Value::from("hp"));
        assert!(matches!(first["rpm"], Value::Num(_)));
    }

    #[test]
    fn no_fans_in_a_vm() {
        let mut fans = Fans::new(&fixture("synthetic-vm"));
        let cx = SampleCx {
            now: std::time::Instant::now(),
            due: &[FANS],
        };
        assert_eq!(
            fans.sample(&cx).unwrap()[0].value,
            Value::unavailable("no-fan-sensor")
        );
    }
}
