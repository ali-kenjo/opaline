//! Length-prefixed framing.

use serde::{Serialize, de::DeserializeOwned};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

use crate::IpcError;

/// Largest accepted frame (kind byte plus payload). Album art never travels over IPC
/// (it is served through a custom protocol), so 1 MiB is generous.
pub const MAX_FRAME_LEN: u32 = 1 << 20;

const HEADER_LEN: usize = 4;
const SPECTRUM_HEADER_LEN: usize = 2 + 4;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum FrameKind {
    /// A MessagePack-encoded [`crate::ClientMsg`] or [`crate::ServerMsg`].
    Message = 0x01,
    /// A raw [`SpectrumFrame`].
    Spectrum = 0x02,
}

impl TryFrom<u8> for FrameKind {
    type Error = IpcError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0x01 => Ok(Self::Message),
            0x02 => Ok(Self::Spectrum),
            other => Err(IpcError::UnknownKind(other)),
        }
    }
}

/// A frame as read from the wire, before its payload is decoded.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawFrame {
    pub kind: FrameKind,
    pub payload: Vec<u8>,
}

impl RawFrame {
    /// Decodes a [`FrameKind::Message`] payload.
    pub fn decode_message<T: DeserializeOwned>(&self) -> Result<T, IpcError> {
        Ok(rmp_serde::from_slice(&self.payload)?)
    }

    /// Decodes a [`FrameKind::Spectrum`] payload.
    pub fn decode_spectrum(&self) -> Result<SpectrumFrame, IpcError> {
        SpectrumFrame::decode(&self.payload)
    }
}

/// Audio spectrum levels for one visualizer tick: band levels scaled to `0..=255`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpectrumFrame {
    pub topic: u16,
    pub seq: u32,
    pub levels: Vec<u8>,
}

impl SpectrumFrame {
    fn encoded_len(&self) -> usize {
        SPECTRUM_HEADER_LEN + self.levels.len()
    }

    fn encode_into(&self, out: &mut Vec<u8>) {
        out.extend_from_slice(&self.topic.to_le_bytes());
        out.extend_from_slice(&self.seq.to_le_bytes());
        out.extend_from_slice(&self.levels);
    }

    fn decode(payload: &[u8]) -> Result<Self, IpcError> {
        let (topic, rest) = payload
            .split_first_chunk::<2>()
            .ok_or(IpcError::MalformedSpectrum)?;
        let (seq, levels) = rest
            .split_first_chunk::<4>()
            .ok_or(IpcError::MalformedSpectrum)?;
        Ok(Self {
            topic: u16::from_le_bytes(*topic),
            seq: u32::from_le_bytes(*seq),
            levels: levels.to_vec(),
        })
    }
}

fn frame_header(kind: FrameKind, payload_len: usize) -> Result<[u8; HEADER_LEN + 1], IpcError> {
    let len = u32::try_from(payload_len + 1).map_err(|_| IpcError::FrameTooLarge(u32::MAX))?;
    if len > MAX_FRAME_LEN {
        return Err(IpcError::FrameTooLarge(len));
    }
    let [a, b, c, d] = len.to_le_bytes();
    Ok([a, b, c, d, kind as u8])
}

/// Encodes `msg` into `buf` (cleared first) as one complete frame.
pub fn encode_message<T: Serialize>(msg: &T, buf: &mut Vec<u8>) -> Result<(), IpcError> {
    buf.clear();
    buf.extend_from_slice(&[0; HEADER_LEN + 1]);
    rmp_serde::encode::write_named(buf, msg)?;
    let header = frame_header(FrameKind::Message, buf.len() - HEADER_LEN - 1)?;
    buf[..HEADER_LEN + 1].copy_from_slice(&header);
    Ok(())
}

/// Encodes a spectrum frame into `buf` (cleared first).
pub fn encode_spectrum(frame: &SpectrumFrame, buf: &mut Vec<u8>) -> Result<(), IpcError> {
    buf.clear();
    let header = frame_header(FrameKind::Spectrum, frame.encoded_len())?;
    buf.extend_from_slice(&header);
    frame.encode_into(buf);
    Ok(())
}

/// Encodes and writes one message frame. `scratch` is reused between calls to avoid
/// allocating per message.
pub async fn write_message<W, T>(w: &mut W, msg: &T, scratch: &mut Vec<u8>) -> Result<(), IpcError>
where
    W: AsyncWrite + Unpin,
    T: Serialize,
{
    encode_message(msg, scratch)?;
    w.write_all(scratch).await?;
    Ok(())
}

/// Encodes and writes one spectrum frame.
pub async fn write_spectrum<W>(
    w: &mut W,
    frame: &SpectrumFrame,
    scratch: &mut Vec<u8>,
) -> Result<(), IpcError>
where
    W: AsyncWrite + Unpin,
{
    encode_spectrum(frame, scratch)?;
    w.write_all(scratch).await?;
    Ok(())
}

/// Reads one frame. Returns `Ok(None)` when the peer closed the connection cleanly
/// between frames.
pub async fn read_frame<R: AsyncRead + Unpin>(r: &mut R) -> Result<Option<RawFrame>, IpcError> {
    let mut len_buf = [0u8; HEADER_LEN];
    let mut filled = 0;
    while filled < HEADER_LEN {
        let n = r.read(&mut len_buf[filled..]).await?;
        if n == 0 {
            return if filled == 0 {
                Ok(None)
            } else {
                Err(IpcError::TruncatedFrame)
            };
        }
        filled += n;
    }
    let len = u32::from_le_bytes(len_buf);
    if len == 0 {
        return Err(IpcError::EmptyFrame);
    }
    if len > MAX_FRAME_LEN {
        return Err(IpcError::FrameTooLarge(len));
    }
    let kind = FrameKind::try_from(r.read_u8().await.map_err(truncated)?)?;
    let mut payload = vec![0u8; len as usize - 1];
    r.read_exact(&mut payload).await.map_err(truncated)?;
    Ok(Some(RawFrame { kind, payload }))
}

fn truncated(e: std::io::Error) -> IpcError {
    if e.kind() == std::io::ErrorKind::UnexpectedEof {
        IpcError::TruncatedFrame
    } else {
        IpcError::Io(e)
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

    use super::*;
    use crate::proto::{ClientMsg, Hello, Role};
    use proptest::prelude::*;
    use tokio::io::AsyncWriteExt;

    fn hello() -> ClientMsg {
        ClientMsg::Hello(Hello {
            protocol: crate::PROTOCOL_VERSION,
            role: Role::Layer,
            pid: 42,
            app_version: "0.1.0".into(),
        })
    }

    #[tokio::test]
    async fn message_round_trip_through_a_tiny_pipe() {
        // A 3-byte pipe forces every read to be partial.
        let (mut a, mut b) = tokio::io::duplex(3);
        let writer = tokio::spawn(async move {
            let mut scratch = Vec::new();
            write_message(&mut a, &hello(), &mut scratch).await.unwrap();
            write_message(&mut a, &ClientMsg::Ping { nonce: 7 }, &mut scratch)
                .await
                .unwrap();
        });
        let first = read_frame(&mut b).await.unwrap().unwrap();
        assert_eq!(first.kind, FrameKind::Message);
        assert_eq!(first.decode_message::<ClientMsg>().unwrap(), hello());
        let second = read_frame(&mut b).await.unwrap().unwrap();
        assert_eq!(
            second.decode_message::<ClientMsg>().unwrap(),
            ClientMsg::Ping { nonce: 7 }
        );
        writer.await.unwrap();
        assert!(read_frame(&mut b).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn rejects_oversized_frames_without_allocating_them() {
        let (mut a, mut b) = tokio::io::duplex(64);
        a.write_all(&(MAX_FRAME_LEN + 1).to_le_bytes())
            .await
            .unwrap();
        assert!(matches!(
            read_frame(&mut b).await,
            Err(IpcError::FrameTooLarge(_))
        ));
    }

    #[tokio::test]
    async fn rejects_empty_and_unknown_frames() {
        let (mut a, mut b) = tokio::io::duplex(64);
        a.write_all(&0u32.to_le_bytes()).await.unwrap();
        assert!(matches!(
            read_frame(&mut b).await,
            Err(IpcError::EmptyFrame)
        ));

        let (mut a, mut b) = tokio::io::duplex(64);
        a.write_all(&[1, 0, 0, 0, 0x7f]).await.unwrap();
        assert!(matches!(
            read_frame(&mut b).await,
            Err(IpcError::UnknownKind(0x7f))
        ));
    }

    #[tokio::test]
    async fn eof_inside_a_frame_is_an_error() {
        let (mut a, mut b) = tokio::io::duplex(64);
        a.write_all(&[10, 0, 0, 0, 0x01, 1, 2]).await.unwrap();
        drop(a);
        assert!(matches!(
            read_frame(&mut b).await,
            Err(IpcError::TruncatedFrame)
        ));

        let (mut a, mut b) = tokio::io::duplex(64);
        a.write_all(&[10, 0]).await.unwrap();
        drop(a);
        assert!(matches!(
            read_frame(&mut b).await,
            Err(IpcError::TruncatedFrame)
        ));
    }

    #[test]
    fn garbage_message_payload_is_a_decode_error() {
        let frame = RawFrame {
            kind: FrameKind::Message,
            payload: vec![0xc1, 0xff, 0x00],
        };
        assert!(frame.decode_message::<ClientMsg>().is_err());
    }

    #[test]
    fn short_spectrum_payload_is_rejected() {
        let frame = RawFrame {
            kind: FrameKind::Spectrum,
            payload: vec![1, 2, 3],
        };
        assert!(matches!(
            frame.decode_spectrum(),
            Err(IpcError::MalformedSpectrum)
        ));
    }

    proptest! {
        #[test]
        fn spectrum_round_trip(topic: u16, seq: u32, levels in proptest::collection::vec(any::<u8>(), 0..256)) {
            let frame = SpectrumFrame { topic, seq, levels };
            let mut buf = Vec::new();
            encode_spectrum(&frame, &mut buf).unwrap();
            let rt = tokio::runtime::Builder::new_current_thread().build().unwrap();
            let decoded = rt.block_on(async {
                let mut slice: &[u8] = &buf;
                read_frame(&mut slice).await.unwrap().unwrap()
            });
            prop_assert_eq!(decoded.kind, FrameKind::Spectrum);
            prop_assert_eq!(decoded.decode_spectrum().unwrap(), frame);
        }

        #[test]
        fn random_bytes_never_panic_the_reader(bytes in proptest::collection::vec(any::<u8>(), 0..64)) {
            let rt = tokio::runtime::Builder::new_current_thread().build().unwrap();
            rt.block_on(async {
                let mut slice: &[u8] = &bytes;
                while let Ok(Some(frame)) = read_frame(&mut slice).await {
                    let _ = frame.decode_message::<ClientMsg>();
                    let _ = frame.decode_spectrum();
                }
            });
        }
    }
}
