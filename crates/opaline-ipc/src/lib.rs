//! Wire protocol between `opaline` (core) and `opaline --layer` (renderer).
//!
//! Transport: a Unix stream socket in `$XDG_RUNTIME_DIR/opaline/`. Every frame is
//! `u32` little-endian length, then one kind byte, then the payload. The length counts
//! the kind byte plus the payload. Messages are MessagePack (`rmp-serde`, named fields so
//! that optional fields can be added without breaking older peers); the audio spectrum
//! uses a raw binary frame to avoid per-frame serialisation cost.

pub mod frame;
pub mod paths;
pub mod proto;

pub use frame::{
    FrameKind, RawFrame, SpectrumFrame, encode_audio_frame, read_frame, write_audio_frame,
    write_message, write_spectrum,
};
pub use proto::*;

/// Bumped on every incompatible protocol change. Core and layer ship in one binary, so a
/// mismatch only happens while an old layer process is still running during an upgrade.
pub const PROTOCOL_VERSION: u16 = 1;

/// Errors produced while encoding, decoding or transporting frames.
#[derive(Debug, thiserror::Error)]
pub enum IpcError {
    #[error("i/o error: {0}")]
    Io(#[from] std::io::Error),
    #[error("frame of {0} bytes exceeds the {max} byte limit", max = frame::MAX_FRAME_LEN)]
    FrameTooLarge(u32),
    #[error("empty frame")]
    EmptyFrame,
    #[error("unknown frame kind {0:#04x}")]
    UnknownKind(u8),
    #[error("connection closed in the middle of a frame")]
    TruncatedFrame,
    #[error("malformed spectrum frame")]
    MalformedSpectrum,
    #[error("could not encode message: {0}")]
    Encode(#[from] rmp_serde::encode::Error),
    #[error("could not decode message: {0}")]
    Decode(#[from] rmp_serde::decode::Error),
    #[error("$XDG_RUNTIME_DIR is not set")]
    NoRuntimeDir,
}
