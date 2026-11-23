//! Audio spectrum for the visualizer: passive capture of the **default sink's monitor** (what
//! the speakers play, never the microphone), FFT in Rust, log-spaced bands with attack/decay
//! smoothing and peak hold, sent as raw binary frames at 60 Hz (brief §6 "Audio spectrum").
//!
//! Capture runs only while a visualizer is visible (`audio.spectrum` subscribed at Ambient or
//! above) and audio is playing; it stops after 3 s of silence or when MPRIS reports paused.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

use opaline_ipc::{ActivityClass, SpectrumFrame, Value};
use rustfft::num_complex::Complex32;
use rustfft::{Fft, FftPlanner};

use crate::engine::update;
use crate::hub::Hub;

pub const SPECTRUM: &str = "audio.spectrum";
pub const STATE: &str = "audio.state";
/// The `u16` id of `audio.spectrum` in binary frames.
pub const SPECTRUM_ID: u16 = 1;
pub const BANDS: usize = 32;
pub const FFT_SIZE: usize = 2048;
const FRAME: Duration = Duration::from_micros(16_667);
const SILENCE_STOP: Duration = Duration::from_secs(3);
/// Below this peak amplitude a frame counts as silent (−80 dBFS).
const SILENCE_LEVEL: f32 = 1e-4;
const F_LOW: f32 = 40.0;
const F_HIGH: f32 = 16_000.0;
const FLOOR_DB: f32 = -70.0;
const ATTACK: f32 = 0.7;
const DECAY: f32 = 0.12;
const PEAK_HOLD_FRAMES: u32 = 30;
const PEAK_FALL: f32 = 0.02;

/// Turns windows of mono samples into smoothed band levels and peaks (0…1).
pub struct Analyzer {
    fft: Arc<dyn Fft<f32>>,
    window: Vec<f32>,
    buf: Vec<Complex32>,
    scratch: Vec<Complex32>,
    /// Per band: the FFT bins it averages.
    bins: Vec<(usize, usize)>,
    levels: [f32; BANDS],
    peaks: [f32; BANDS],
    peak_age: [u32; BANDS],
}

impl std::fmt::Debug for Analyzer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Analyzer")
            .field("levels", &self.levels)
            .finish_non_exhaustive()
    }
}

/// Band edges in FFT bins, log-spaced from 40 Hz to 16 kHz (or Nyquist), at least one bin each.
pub fn band_bins(rate: u32) -> Vec<(usize, usize)> {
    let nyquist = rate as f32 / 2.0;
    let high = F_HIGH.min(nyquist * 0.95);
    let hz_per_bin = rate as f32 / FFT_SIZE as f32;
    (0..BANDS)
        .map(|i| {
            let f0 = F_LOW * (high / F_LOW).powf(i as f32 / BANDS as f32);
            let f1 = F_LOW * (high / F_LOW).powf((i + 1) as f32 / BANDS as f32);
            let b0 = ((f0 / hz_per_bin).floor() as usize).max(1);
            let b1 = ((f1 / hz_per_bin).ceil() as usize)
                .max(b0 + 1)
                .min(FFT_SIZE / 2);
            (b0, b1)
        })
        .collect()
}

impl Analyzer {
    pub fn new(rate: u32) -> Self {
        let fft = FftPlanner::new().plan_fft_forward(FFT_SIZE);
        let scratch = vec![Complex32::default(); fft.get_inplace_scratch_len()];
        // Hann window.
        let window = (0..FFT_SIZE)
            .map(|i| {
                0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / (FFT_SIZE - 1) as f32).cos()
            })
            .collect();
        Self {
            fft,
            window,
            buf: vec![Complex32::default(); FFT_SIZE],
            scratch,
            bins: band_bins(rate),
            levels: [0.0; BANDS],
            peaks: [0.0; BANDS],
            peak_age: [0; BANDS],
        }
    }

    pub fn set_rate(&mut self, rate: u32) {
        self.bins = band_bins(rate);
    }

    /// Analyses the newest `FFT_SIZE` samples and updates the smoothed levels.
    pub fn process(&mut self, samples: &[f32]) {
        let start = samples.len().saturating_sub(FFT_SIZE);
        let window = &samples[start..];
        for (i, slot) in self.buf.iter_mut().enumerate() {
            let s = window.get(i).copied().unwrap_or(0.0);
            *slot = Complex32::new(s * self.window[i], 0.0);
        }
        self.fft
            .process_with_scratch(&mut self.buf, &mut self.scratch);
        // A full-scale sine through a Hann window peaks at about N/4.
        let full_scale = FFT_SIZE as f32 / 4.0;
        for (band, &(b0, b1)) in self.bins.iter().enumerate() {
            let mag = self.buf[b0..b1]
                .iter()
                .map(|c| c.norm())
                .fold(0.0f32, f32::max)
                / full_scale;
            let db = 20.0 * (mag + 1e-9).log10();
            let target = ((db - FLOOR_DB) / -FLOOR_DB).clamp(0.0, 1.0);
            let level = &mut self.levels[band];
            *level += (target - *level) * if target > *level { ATTACK } else { DECAY };
            if *level >= self.peaks[band] {
                self.peaks[band] = *level;
                self.peak_age[band] = 0;
            } else if self.peak_age[band] < PEAK_HOLD_FRAMES {
                self.peak_age[band] += 1;
            } else {
                self.peaks[band] = (self.peaks[band] - PEAK_FALL).max(*level);
            }
        }
    }

    /// Levels then peaks, as bytes (`2 × BANDS`).
    pub fn bytes(&self) -> Vec<u8> {
        self.levels
            .iter()
            .chain(self.peaks.iter())
            .map(|v| (v * 255.0).round() as u8)
            .collect()
    }

    pub fn levels(&self) -> &[f32; BANDS] {
        &self.levels
    }
}

/// The newest mono samples from the capture thread.
#[derive(Debug, Default)]
struct Ring {
    samples: VecDeque<f32>,
    /// Peak amplitude since the analyser last looked (for silence detection).
    peak: f32,
}

const RING_CAP: usize = FFT_SIZE * 2;

/// A running capture; dropping it stops the PipeWire loop and joins its thread.
struct Capture {
    quit: pipewire::channel::Sender<()>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl Drop for Capture {
    fn drop(&mut self) {
        let _ = self.quit.send(());
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

fn start_capture(ring: Arc<Mutex<Ring>>, rate: Arc<AtomicU32>) -> Result<Capture, String> {
    let (quit_tx, quit_rx) = pipewire::channel::channel::<()>();
    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<(), String>>();
    let thread = std::thread::Builder::new()
        .name("opaline-pw".into())
        .spawn(move || {
            if let Err(error) = capture_loop(ring, rate, quit_rx, &ready_tx) {
                let _ = ready_tx.send(Err(error));
            }
        })
        .map_err(|e| e.to_string())?;
    match ready_rx.recv_timeout(Duration::from_secs(5)) {
        Ok(Ok(())) => Ok(Capture {
            quit: quit_tx,
            thread: Some(thread),
        }),
        Ok(Err(error)) => {
            let _ = thread.join();
            Err(error)
        }
        Err(_) => {
            let _ = quit_tx.send(());
            Err("PipeWire did not start in time".into())
        }
    }
}

fn capture_loop(
    ring: Arc<Mutex<Ring>>,
    rate: Arc<AtomicU32>,
    quit: pipewire::channel::Receiver<()>,
    ready: &std::sync::mpsc::Sender<Result<(), String>>,
) -> Result<(), String> {
    use pipewire as pw;
    use pw::spa;
    use pw::spa::param::format::{MediaSubtype, MediaType};
    use pw::spa::param::format_utils;

    pw::init();
    let mainloop = pw::main_loop::MainLoopRc::new(None).map_err(|e| e.to_string())?;
    let context = pw::context::ContextRc::new(&mainloop, None).map_err(|e| e.to_string())?;
    let core = context.connect_rc(None).map_err(|e| e.to_string())?;
    let props = pw::properties::properties! {
        *pw::keys::MEDIA_TYPE => "Audio",
        *pw::keys::MEDIA_CATEGORY => "Capture",
        *pw::keys::MEDIA_ROLE => "Music",
        *pw::keys::APP_NAME => "Opaline",
        *pw::keys::NODE_NAME => "opaline-visualizer",
        // The monitor of the default sink; WirePlumber follows default-sink changes.
        *pw::keys::STREAM_CAPTURE_SINK => "true",
        // Don't keep the sink awake just because we listen.
        *pw::keys::NODE_PASSIVE => "true",
    };
    let stream = pw::stream::StreamBox::new(&core, "opaline-visualizer", props)
        .map_err(|e| e.to_string())?;

    struct Data {
        channels: u32,
        ring: Arc<Mutex<Ring>>,
        rate: Arc<AtomicU32>,
    }
    let _listener = stream
        .add_local_listener_with_user_data(Data {
            channels: 2,
            ring,
            rate,
        })
        .param_changed(|_, data, id, param| {
            let Some(param) = param else {
                return;
            };
            if id != spa::param::ParamType::Format.as_raw() {
                return;
            }
            let Ok((MediaType::Audio, MediaSubtype::Raw)) = format_utils::parse_format(param)
            else {
                return;
            };
            let mut info = spa::param::audio::AudioInfoRaw::new();
            if info.parse(param).is_ok() {
                data.channels = info.channels().max(1);
                data.rate.store(info.rate(), Ordering::Relaxed);
            }
        })
        .process(|stream, data| {
            let Some(mut buffer) = stream.dequeue_buffer() else {
                return;
            };
            let datas = buffer.datas_mut();
            let Some(d) = datas.first_mut() else {
                return;
            };
            let size = d.chunk().size() as usize;
            let channels = data.channels as usize;
            let Some(bytes) = d.data() else {
                return;
            };
            let bytes = &bytes[..size.min(bytes.len())];
            let mut ring = data.ring.lock().unwrap_or_else(PoisonError::into_inner);
            for frame in bytes.chunks_exact(4 * channels) {
                let mono = frame
                    .as_chunks::<4>()
                    .0
                    .iter()
                    .map(|b| f32::from_le_bytes(*b))
                    .sum::<f32>()
                    / channels as f32;
                ring.peak = ring.peak.max(mono.abs());
                if ring.samples.len() == RING_CAP {
                    ring.samples.pop_front();
                }
                ring.samples.push_back(mono);
            }
        })
        .register()
        .map_err(|e| e.to_string())?;

    let mut info = spa::param::audio::AudioInfoRaw::new();
    info.set_format(spa::param::audio::AudioFormat::F32LE);
    let obj = spa::pod::Object {
        type_: spa::utils::SpaTypes::ObjectParamFormat.as_raw(),
        id: spa::param::ParamType::EnumFormat.as_raw(),
        properties: info.into(),
    };
    let bytes = spa::pod::serialize::PodSerializer::serialize(
        std::io::Cursor::new(Vec::new()),
        &spa::pod::Value::Object(obj),
    )
    .map_err(|e| format!("{e:?}"))?
    .0
    .into_inner();
    let pod = spa::pod::Pod::from_bytes(&bytes).ok_or("bad format pod")?;
    stream
        .connect(
            spa::utils::Direction::Input,
            None,
            pw::stream::StreamFlags::AUTOCONNECT | pw::stream::StreamFlags::MAP_BUFFERS,
            &mut [pod],
        )
        .map_err(|e| e.to_string())?;

    let ml = mainloop.clone();
    let _quit = quit.attach(mainloop.loop_(), move |()| ml.quit());
    let _ = ready.send(Ok(()));
    mainloop.run();
    Ok(())
}

fn state(hub: &Hub, capturing: bool, reason: &str) {
    hub.publish(vec![update(
        STATE,
        Value::map([
            ("capturing", Value::Bool(capturing)),
            ("reason", Value::from(reason)),
        ]),
    )]);
}

fn visible(hub: &Hub) -> bool {
    hub.interest(SPECTRUM)
        .is_some_and(|c| c >= ActivityClass::Ambient)
}

/// The supervised task.
pub async fn run(hub: Arc<Hub>) -> Result<(), String> {
    let mut changes = hub.watch_subscriptions();
    let mut playing = hub.watch_media_playing();
    let mut seq = 0u32;
    loop {
        // Wait until a visualizer is visible and audio may be playing.
        loop {
            changes.mark_unchanged();
            playing.mark_unchanged();
            if visible(&hub) && *playing.borrow() != Some(false) {
                break;
            }
            if visible(&hub) {
                state(&hub, false, "paused");
            }
            tokio::select! {
                c = changes.changed() => c.map_err(|_| "hub closed".to_owned())?,
                p = playing.changed() => p.map_err(|_| "hub closed".to_owned())?,
            }
        }

        let ring = Arc::new(Mutex::new(Ring::default()));
        let rate = Arc::new(AtomicU32::new(48_000));
        let capture = {
            let (ring, rate) = (ring.clone(), rate.clone());
            tokio::task::spawn_blocking(move || start_capture(ring, rate))
                .await
                .map_err(|e| e.to_string())?
        };
        let capture = match capture {
            Ok(c) => c,
            Err(error) => {
                state(&hub, false, "unavailable");
                return Err(format!("audio capture: {error}"));
            }
        };
        state(&hub, true, "playing");
        tracing::debug!("visualizer capture started");

        let mut analyzer = Analyzer::new(rate.load(Ordering::Relaxed));
        let mut current_rate = rate.load(Ordering::Relaxed);
        let mut samples = Vec::with_capacity(FFT_SIZE);
        let mut last_sound = Instant::now();
        let mut tick = tokio::time::interval(FRAME);
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let reason = loop {
            tick.tick().await;
            if !visible(&hub) {
                break "hidden";
            }
            if *playing.borrow() == Some(false) {
                break "paused";
            }
            let r = rate.load(Ordering::Relaxed);
            if r != current_rate && r > 0 {
                analyzer.set_rate(r);
                current_rate = r;
            }
            let peak = {
                let mut ring = ring.lock().unwrap_or_else(PoisonError::into_inner);
                samples.clear();
                samples.extend(ring.samples.iter());
                std::mem::take(&mut ring.peak)
            };
            if peak > SILENCE_LEVEL {
                last_sound = Instant::now();
            } else if last_sound.elapsed() >= SILENCE_STOP {
                break "silent";
            }
            analyzer.process(&samples);
            seq = seq.wrapping_add(1);
            hub.publish_spectrum(SpectrumFrame {
                topic: SPECTRUM_ID,
                seq,
                levels: analyzer.bytes(),
            });
        };
        drop(capture);
        tracing::debug!(reason, "visualizer capture stopped");
        state(&hub, false, reason);
        if reason == "silent" {
            // Wait for something to change (playback starts, the visualizer re-appears) before
            // listening again, so silence doesn't keep a capture stream open.
            changes.mark_unchanged();
            playing.mark_unchanged();
            tokio::select! {
                c = changes.changed() => c.map_err(|_| "hub closed".to_owned())?,
                p = playing.changed() => p.map_err(|_| "hub closed".to_owned())?,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(freq: f32, amp: f32, rate: u32) -> Vec<f32> {
        (0..FFT_SIZE)
            .map(|i| amp * (2.0 * std::f32::consts::PI * freq * i as f32 / rate as f32).sin())
            .collect()
    }

    fn loudest(a: &Analyzer) -> usize {
        a.levels()
            .iter()
            .enumerate()
            .max_by(|x, y| x.1.total_cmp(y.1))
            .map_or(0, |(i, _)| i)
    }

    #[test]
    fn a_tone_lights_its_band() {
        let mut a = Analyzer::new(48_000);
        for _ in 0..10 {
            a.process(&sine(1000.0, 0.5, 48_000));
        }
        let band = loudest(&a);
        let (b0, b1) = band_bins(48_000)[band];
        let hz = 48_000.0 / FFT_SIZE as f32;
        assert!(
            b0 as f32 * hz <= 1000.0 + hz && b1 as f32 * hz >= 1000.0 - hz,
            "band {band}: {b0}..{b1}"
        );
        assert!(a.levels()[band] > 0.8, "{}", a.levels()[band]);
        let mut low = Analyzer::new(48_000);
        for _ in 0..10 {
            low.process(&sine(100.0, 0.5, 48_000));
        }
        assert!(loudest(&low) < band, "100 Hz sits below 1 kHz");
    }

    #[test]
    fn silence_is_zero_and_levels_decay_slower_than_they_rise() {
        let mut a = Analyzer::new(48_000);
        a.process(&vec![0.0; FFT_SIZE]);
        assert!(a.bytes().iter().all(|b| *b == 0));
        a.process(&sine(1000.0, 0.5, 48_000));
        let band = loudest(&a);
        let after_attack = a.levels()[band];
        a.process(&vec![0.0; FFT_SIZE]);
        let after_one_decay = a.levels()[band];
        assert!(after_attack > 0.5);
        assert!(after_one_decay > after_attack * 0.8, "decay is gentle");
        // Peak hold keeps the peak while the level falls.
        let bytes = a.bytes();
        assert!(bytes[BANDS + band] >= bytes[band]);
    }

    #[test]
    fn bands_cover_the_range_without_gaps() {
        let bins = band_bins(44_100);
        assert_eq!(bins.len(), BANDS);
        assert!(bins.iter().all(|(a, b)| b > a));
        assert!(bins.last().is_some_and(|(_, b)| *b <= FFT_SIZE / 2));
    }
}
