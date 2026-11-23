//! Latency: an unprivileged ICMP echo (datagram "ping" socket, allowed by
//! `net.ipv4.ping_group_range`), falling back to timing a TCP connect to port 443. Measured only
//! while someone is subscribed (brief §6 "Network").

use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Arc;
use std::time::{Duration, Instant};

use opaline_ipc::{TopicUpdate, Value};
use socket2::{Domain, Protocol, Socket, Type};

use crate::engine::{update, while_subscribed};
use crate::hub::Hub;

pub const LATENCY: &str = "network.latency";
const PERIOD: Duration = Duration::from_secs(5);
const TIMEOUT: Duration = Duration::from_secs(2);
/// Cloudflare's resolver (the default `network.latencyTarget`): anycast, close to most people,
/// answers pings.
pub const DEFAULT_TARGET: IpAddr = IpAddr::V4(Ipv4Addr::new(1, 1, 1, 1));

/// An ICMP echo request. With datagram ping sockets the kernel fills in the identifier and
/// the checksum, so only type, code, sequence and payload matter.
pub fn echo_request(seq: u16) -> [u8; 16] {
    let mut p = [0u8; 16];
    p[0] = 8; // echo request
    p[6..8].copy_from_slice(&seq.to_be_bytes());
    p[8..16].copy_from_slice(b"opaline!");
    p
}

/// Whether `reply` (no IP header on a datagram ping socket) is the echo reply for `seq`.
pub fn is_reply(reply: &[u8], seq: u16) -> bool {
    reply.len() >= 8 && reply[0] == 0 && reply[6..8] == seq.to_be_bytes()
}

async fn icmp(target: IpAddr, seq: u16) -> std::io::Result<Duration> {
    let IpAddr::V4(v4) = target else {
        return Err(std::io::Error::other("IPv6 ping not implemented"));
    };
    let socket = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::ICMPV4))?;
    socket.set_nonblocking(true)?;
    let socket = tokio::net::UdpSocket::from_std(std::net::UdpSocket::from(socket))?;
    let started = Instant::now();
    socket
        .send_to(&echo_request(seq), SocketAddr::new(IpAddr::V4(v4), 0))
        .await?;
    let mut buf = [0u8; 128];
    tokio::time::timeout(TIMEOUT, async {
        loop {
            let (n, _) = socket.recv_from(&mut buf).await?;
            if is_reply(&buf[..n], seq) {
                return Ok(started.elapsed());
            }
        }
    })
    .await
    .map_err(|_| std::io::Error::from(std::io::ErrorKind::TimedOut))?
}

async fn tcp(target: IpAddr) -> std::io::Result<Duration> {
    let started = Instant::now();
    tokio::time::timeout(
        TIMEOUT,
        tokio::net::TcpStream::connect(SocketAddr::new(target, 443)),
    )
    .await
    .map_err(|_| std::io::Error::from(std::io::ErrorKind::TimedOut))??;
    Ok(started.elapsed())
}

/// One measurement, as the `network.latency` value.
pub async fn measure(target: IpAddr, seq: u16) -> Value {
    let (result, method) = match icmp(target, seq).await {
        Ok(d) => (Ok(d), "icmp"),
        Err(icmp_error) => {
            tracing::debug!(%icmp_error, "ICMP ping failed; trying TCP");
            (tcp(target).await, "tcp")
        }
    };
    match result {
        Ok(d) => Value::map([
            ("ms", Value::Num(d.as_secs_f64() * 1000.0)),
            ("target", Value::from(target.to_string())),
            ("method", Value::from(method)),
        ]),
        Err(_) => Value::unavailable("unreachable"),
    }
}

pub async fn run(hub: Arc<Hub>) -> Result<(), String> {
    let mut seq = 0u16;
    while_subscribed(&hub, &[LATENCY], PERIOD, || {
        seq = seq.wrapping_add(1);
        let seq = seq;
        async move {
            Ok::<Vec<TopicUpdate>, String>(vec![update(
                LATENCY,
                measure(DEFAULT_TARGET, seq).await,
            )])
        }
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packets() {
        let p = echo_request(0x0102);
        assert_eq!(p[0], 8);
        assert_eq!(&p[6..8], &[1, 2]);
        let mut reply = p;
        reply[0] = 0;
        assert!(is_reply(&reply, 0x0102));
        assert!(!is_reply(&reply, 0x0103));
        assert!(!is_reply(&p, 0x0102), "our own request isn't a reply");
    }

    #[tokio::test]
    async fn loopback_answers() {
        // 127.0.0.1 always answers ICMP if ping sockets are allowed, else TCP fails fast.
        let v = measure(IpAddr::V4(Ipv4Addr::LOCALHOST), 1).await;
        assert!(matches!(v, Value::Map(_) | Value::Missing(_)), "{v:?}");
    }
}
