//! Pressure stall information (`/proc/pressure/{cpu,memory,io}`).

use opaline_ipc::Value;

/// The `avg10/60/300` percentages of the `some` and `full` lines.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Psi {
    pub some: [f64; 3],
    /// `None` for `/proc/pressure/cpu` on older kernels, which has no `full` line.
    pub full: Option<[f64; 3]>,
}

impl Psi {
    pub fn to_value(self) -> Value {
        let mut entries = vec![
            ("some10", Value::Num(self.some[0])),
            ("some60", Value::Num(self.some[1])),
            ("some300", Value::Num(self.some[2])),
        ];
        if let Some(full) = self.full {
            entries.push(("full10", Value::Num(full[0])));
            entries.push(("full60", Value::Num(full[1])));
            entries.push(("full300", Value::Num(full[2])));
        }
        Value::map(entries)
    }
}

pub fn parse_psi(text: &str) -> Option<Psi> {
    let mut psi = Psi::default();
    let mut seen_some = false;
    for line in text.lines() {
        let mut fields = line.split_ascii_whitespace();
        let kind = fields.next()?;
        let mut avg = [0.0; 3];
        for field in fields {
            let Some((key, value)) = field.split_once('=') else {
                continue;
            };
            let slot = match key {
                "avg10" => 0,
                "avg60" => 1,
                "avg300" => 2,
                _ => continue,
            };
            avg[slot] = value.parse().ok()?;
        }
        match kind {
            "some" => {
                psi.some = avg;
                seen_some = true;
            }
            "full" => psi.full = Some(avg),
            _ => {}
        }
    }
    seen_some.then_some(psi)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_some_and_full() {
        let psi = parse_psi(
            "some avg10=1.50 avg60=0.75 avg300=0.10 total=9410083\nfull avg10=0.20 avg60=0.00 avg300=0.00 total=8816440\n",
        );
        assert_eq!(
            psi,
            Some(Psi {
                some: [1.5, 0.75, 0.1],
                full: Some([0.2, 0.0, 0.0]),
            })
        );
        assert_eq!(parse_psi(""), None);
    }
}
