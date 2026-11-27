//! Lightweight async MQTT 3.1.1 client with TLS (`tokio-rustls`) and GNOME Keyring
//! credentials (brief §4.4, PLAN-2 task 6.4).
//!
//! Uses only the workspace's existing `tokio`, `rustls`, `tokio-rustls`, and `rustls-native-certs`
//! crates (zero extra dependencies, zero unsafe code).

use std::sync::Arc;
use std::time::Duration;

use rustls::RootCertStore;
use rustls_pki_types::ServerName;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio_rustls::TlsConnector;

const MAX_PACKET_LEN: usize = 512 * 1024;
const KEEPALIVE_S: u16 = 30;

/// Decoded MQTT 3.1.1 packet relevant to a read-only subscriber.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MqttPacket {
    ConnAck { return_code: u8 },
    SubAck { packet_id: u16 },
    Publish { topic: String, payload: Vec<u8> },
    PingResp,
    Other(u8),
}

fn encode_remaining_len(mut len: usize, out: &mut Vec<u8>) {
    loop {
        let mut byte = (len % 128) as u8;
        len /= 128;
        if len > 0 {
            byte |= 0x80;
        }
        out.push(byte);
        if len == 0 {
            break;
        }
    }
}

fn push_utf8_str(s: &str, out: &mut Vec<u8>) -> Result<(), String> {
    let len = u16::try_from(s.len()).map_err(|_| "mqtt string too long")?;
    out.extend_from_slice(&len.to_be_bytes());
    out.extend_from_slice(s.as_bytes());
    Ok(())
}

/// Encodes an MQTT 3.1.1 CONNECT packet (Clean Session = 1).
pub fn encode_connect(
    client_id: &str,
    username: Option<&str>,
    password: Option<&str>,
    keepalive_s: u16,
) -> Result<Vec<u8>, String> {
    let mut payload = Vec::new();
    // Variable header: Protocol Name "MQTT", Level 4 (3.1.1), Connect Flags, Keep Alive
    push_utf8_str("MQTT", &mut payload)?;
    payload.push(4);
    let mut flags = 0x02u8; // Clean Session
    if username.is_some() {
        flags |= 0x80;
    }
    if password.is_some() {
        flags |= 0x40;
    }
    payload.push(flags);
    payload.extend_from_slice(&keepalive_s.to_be_bytes());

    // Payload: Client ID, optional Username, optional Password
    push_utf8_str(client_id, &mut payload)?;
    if let Some(u) = username {
        push_utf8_str(u, &mut payload)?;
    }
    if let Some(p) = password {
        push_utf8_str(p, &mut payload)?;
    }

    let mut packet = Vec::with_capacity(payload.len() + 5);
    packet.push(0x10); // CONNECT
    encode_remaining_len(payload.len(), &mut packet);
    packet.extend_from_slice(&payload);
    Ok(packet)
}

/// Encodes an MQTT 3.1.1 SUBSCRIBE packet for one topic filter at QoS 0.
pub fn encode_subscribe(packet_id: u16, topic_filter: &str) -> Result<Vec<u8>, String> {
    let mut body = Vec::new();
    body.extend_from_slice(&packet_id.to_be_bytes());
    push_utf8_str(topic_filter, &mut body)?;
    body.push(0); // QoS 0

    let mut packet = Vec::with_capacity(body.len() + 5);
    packet.push(0x82); // SUBSCRIBE with required flags 0010
    encode_remaining_len(body.len(), &mut packet);
    packet.extend_from_slice(&body);
    Ok(packet)
}

pub fn encode_pingreq() -> [u8; 2] {
    [0xC0, 0x00]
}

pub fn encode_disconnect() -> [u8; 2] {
    [0xE0, 0x00]
}

/// Reads and decodes one MQTT 3.1.1 packet from an async stream.
pub async fn read_packet<R: AsyncRead + Unpin>(reader: &mut R) -> Result<MqttPacket, String> {
    let mut header = [0u8; 1];
    reader
        .read_exact(&mut header)
        .await
        .map_err(|e| format!("mqtt-eof: {e}"))?;
    let ptype = header[0] >> 4;
    let flags = header[0] & 0x0f;

    // Decode variable-length Remaining Length (up to 4 bytes).
    let mut multiplier: usize = 1;
    let mut rem_len: usize = 0;
    for _ in 0..4 {
        let mut b = [0u8; 1];
        reader
            .read_exact(&mut b)
            .await
            .map_err(|e| format!("mqtt-len-eof: {e}"))?;
        rem_len += usize::from(b[0] & 0x7f) * multiplier;
        if rem_len > MAX_PACKET_LEN {
            return Err("mqtt-packet-too-large".into());
        }
        if (b[0] & 0x80) == 0 {
            break;
        }
        multiplier = multiplier.saturating_mul(128);
    }

    let mut body = vec![0u8; rem_len];
    if rem_len > 0 {
        reader
            .read_exact(&mut body)
            .await
            .map_err(|e| format!("mqtt-body-eof: {e}"))?;
    }

    match ptype {
        2 => {
            if body.len() < 2 {
                return Err("malformed CONNACK".into());
            }
            Ok(MqttPacket::ConnAck {
                return_code: body[1],
            })
        }
        3 => {
            if body.len() < 2 {
                return Err("malformed PUBLISH".into());
            }
            let topic_len = usize::from(u16::from_be_bytes([body[0], body[1]]));
            if body.len() < 2 + topic_len {
                return Err("malformed PUBLISH topic".into());
            }
            let topic = String::from_utf8(body[2..2 + topic_len].to_vec())
                .map_err(|_| "PUBLISH topic not utf-8")?;
            let qos = (flags >> 1) & 0x03;
            let payload_start = 2 + topic_len + if qos > 0 { 2 } else { 0 };
            if body.len() < payload_start {
                return Err("malformed PUBLISH qos".into());
            }
            Ok(MqttPacket::Publish {
                topic,
                payload: body[payload_start..].to_vec(),
            })
        }
        9 => {
            if body.len() < 2 {
                return Err("malformed SUBACK".into());
            }
            Ok(MqttPacket::SubAck {
                packet_id: u16::from_be_bytes([body[0], body[1]]),
            })
        }
        13 => Ok(MqttPacket::PingResp),
        other => Ok(MqttPacket::Other(other)),
    }
}

/// Parameters to connect and subscribe to an MQTT broker.
#[derive(Debug, Clone)]
pub struct MqttConnectConfig {
    pub host: String,
    pub port: u16,
    pub tls: bool,
    pub topic: String,
    pub client_id: String,
    pub username: Option<String>,
    pub password: Option<String>,
}

async fn run_session<S, F>(
    mut stream: S,
    cfg: &MqttConnectConfig,
    mut on_message: F,
    mut shutdown: tokio::sync::watch::Receiver<bool>,
) -> Result<(), String>
where
    S: AsyncRead + AsyncWrite + Unpin,
    F: FnMut(String, Vec<u8>),
{
    let connect = encode_connect(
        &cfg.client_id,
        cfg.username.as_deref(),
        cfg.password.as_deref(),
        KEEPALIVE_S,
    )?;
    stream
        .write_all(&connect)
        .await
        .map_err(|e| format!("mqtt-connect-write: {e}"))?;

    let ack = tokio::time::timeout(Duration::from_secs(10), read_packet(&mut stream))
        .await
        .map_err(|_| "mqtt-connack-timeout".to_owned())??;
    match ack {
        MqttPacket::ConnAck { return_code: 0 } => {}
        MqttPacket::ConnAck { return_code } => {
            return Err(format!("mqtt-connack-refused: code {return_code}"));
        }
        other => return Err(format!("mqtt-expected-connack, got {other:?}")),
    }

    let sub = encode_subscribe(1, &cfg.topic)?;
    stream
        .write_all(&sub)
        .await
        .map_err(|e| format!("mqtt-subscribe-write: {e}"))?;

    let mut ping = tokio::time::interval(Duration::from_secs(u64::from(KEEPALIVE_S / 2)));
    ping.tick().await; // consume immediate tick

    loop {
        tokio::select! {
            _ = shutdown.changed() => {
                if *shutdown.borrow() {
                    let _ = stream.write_all(&encode_disconnect()).await;
                    return Ok(());
                }
            }
            _ = ping.tick() => {
                stream
                    .write_all(&encode_pingreq())
                    .await
                    .map_err(|e| format!("mqtt-ping-write: {e}"))?;
            }
            pkt = read_packet(&mut stream) => {
                match pkt? {
                    MqttPacket::Publish { topic, payload } => on_message(topic, payload),
                    MqttPacket::SubAck { .. } | MqttPacket::PingResp | MqttPacket::Other(_) => {}
                    MqttPacket::ConnAck { .. } => {}
                }
            }
        }
    }
}

/// Connects to an MQTT broker (with SSRF IP check + optional TLS 1.3 via `rustls`) and invokes
/// `on_message` for every received PUBLISH packet until `shutdown` becomes `true` or an error
/// occurs.
pub async fn connect_and_subscribe<F>(
    cfg: &MqttConnectConfig,
    on_message: F,
    shutdown: tokio::sync::watch::Receiver<bool>,
) -> Result<(), String>
where
    F: FnMut(String, Vec<u8>),
{
    // SSRF guard: block link-local / cloud metadata; allow TLS anywhere or plain MQTT on loopback/LAN.
    let scheme = if cfg.tls { "https" } else { "http" };
    let pinned = crate::http::resolve_and_validate(scheme, &cfg.host, cfg.port, !cfg.tls).await?;

    let tcp = tokio::time::timeout(Duration::from_secs(10), TcpStream::connect(pinned))
        .await
        .map_err(|_| "mqtt-connect-timeout".to_owned())?
        .map_err(|e| format!("mqtt-tcp-failed: {e}"))?;

    if cfg.tls {
        let mut roots = RootCertStore::empty();
        for cert in rustls_native_certs::load_native_certs().certs {
            let _ = roots.add(cert);
        }
        let tls_cfg = rustls::ClientConfig::builder()
            .with_root_certificates(roots)
            .with_no_client_auth();
        let connector = TlsConnector::from(Arc::new(tls_cfg));
        let server_name = ServerName::try_from(cfg.host.clone())
            .map_err(|_| "mqtt-invalid-tls-hostname".to_owned())?;
        let tls_stream = connector
            .connect(server_name, tcp)
            .await
            .map_err(|e| format!("mqtt-tls-handshake-failed: {e}"))?;
        run_session(tls_stream, cfg, on_message, shutdown).await
    } else {
        run_session(tcp, cfg, on_message, shutdown).await
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use std::sync::{Arc, Mutex};
    use tokio::net::TcpListener;

    use super::*;

    #[tokio::test]
    async fn connects_subscribes_and_receives_publish_from_loopback_broker() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();

        let broker = tokio::spawn(async move {
            let (mut sock, _) = listener.accept().await.unwrap();
            let mut buf = [0u8; 256];
            // Read CONNECT
            let n = sock.read(&mut buf).await.unwrap();
            assert_eq!(buf[0], 0x10);
            assert!(n > 10);
            // Send CONNACK (accepted)
            sock.write_all(&[0x20, 0x02, 0x00, 0x00]).await.unwrap();
            // Read SUBSCRIBE
            let n = sock.read(&mut buf).await.unwrap();
            assert_eq!(buf[0], 0x82);
            assert!(n > 5);
            // Send SUBACK
            sock.write_all(&[0x90, 0x03, 0x00, 0x01, 0x00])
                .await
                .unwrap();
            // Send PUBLISH topic="home/temp" payload="22.4"
            let topic = b"home/temp";
            let payload = b"22.4";
            let rem = 2 + topic.len() + payload.len();
            let mut pub_pkt = vec![0x30, rem as u8, 0, topic.len() as u8];
            pub_pkt.extend_from_slice(topic);
            pub_pkt.extend_from_slice(payload);
            sock.write_all(&pub_pkt).await.unwrap();
            // Wait until client disconnects
            let _ = sock.read(&mut buf).await;
        });

        let (tx, rx) = tokio::sync::watch::channel(false);
        let received = Arc::new(Mutex::new(Vec::<(String, String)>::new()));
        let rec_clone = received.clone();
        let tx_clone = tx.clone();

        let cfg = MqttConnectConfig {
            host: "127.0.0.1".into(),
            port,
            tls: false,
            topic: "home/#".into(),
            client_id: "opaline-test".into(),
            username: None,
            password: None,
        };

        connect_and_subscribe(
            &cfg,
            move |topic, bytes| {
                let text = String::from_utf8_lossy(&bytes).into_owned();
                rec_clone.lock().unwrap().push((topic, text));
                let _ = tx_clone.send(true);
            },
            rx,
        )
        .await
        .unwrap();

        broker.await.unwrap();
        let msgs = received.lock().unwrap();
        assert_eq!(msgs.as_slice(), &[("home/temp".into(), "22.4".into())]);
    }

    #[test]
    fn encodes_connect_with_credentials_and_subscribe() {
        let pkt = encode_connect("cid", Some("user"), Some("pass"), 30).unwrap();
        assert_eq!(pkt[0], 0x10);
        let sub = encode_subscribe(7, "sensors/+/temp").unwrap();
        assert_eq!(sub[0], 0x82);
    }
}
