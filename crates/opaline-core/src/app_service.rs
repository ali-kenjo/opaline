//! Session D-Bus service `io.github.ali_kenjo.Opaline` and single-instance handling.
//!
//! The first core owns the name. Any later `opaline` invocation finds the name taken, forwards
//! its request (Edit, Peek, Settings, Quit) to the running core and exits.

use tokio::sync::mpsc;
use zbus::fdo::{RequestNameFlags, RequestNameReply};
use zbus::{Connection, connection, interface, proxy};

pub const BUS_NAME: &str = "io.github.ali_kenjo.Opaline";
pub const OBJECT_PATH: &str = "/io/github/ali_kenjo/Opaline";

/// A request from the tray, a desktop-file action, a second launch or the D-Bus API.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppRequest {
    Peek,
    Edit,
    OpenSettings,
    Quit,
}

struct AppService {
    requests: mpsc::UnboundedSender<AppRequest>,
    backend: String,
}

impl AppService {
    fn forward(&self, request: AppRequest) {
        if self.requests.send(request).is_err() {
            tracing::warn!(?request, "core is shutting down; request dropped");
        }
    }
}

#[interface(name = "io.github.ali_kenjo.Opaline1")]
impl AppService {
    fn peek(&self) {
        self.forward(AppRequest::Peek);
    }

    fn edit(&self) {
        self.forward(AppRequest::Edit);
    }

    fn open_settings(&self) {
        self.forward(AppRequest::OpenSettings);
    }

    fn quit(&self) {
        self.forward(AppRequest::Quit);
    }

    #[zbus(property)]
    fn backend_mode(&self) -> String {
        self.backend.clone()
    }
}

#[proxy(
    interface = "io.github.ali_kenjo.Opaline1",
    default_service = "io.github.ali_kenjo.Opaline",
    default_path = "/io/github/ali_kenjo/Opaline"
)]
trait Opaline {
    fn peek(&self) -> zbus::Result<()>;
    fn edit(&self) -> zbus::Result<()>;
    fn open_settings(&self) -> zbus::Result<()>;
    fn quit(&self) -> zbus::Result<()>;
}

/// Outcome of trying to become the running core.
#[derive(Debug)]
pub enum Claim {
    /// We own the name. Keep the connection alive for as long as core runs.
    Primary(Connection),
    /// Another core owns it.
    AlreadyRunning,
}

/// Serves the interface and asks for the bus name without queueing.
pub async fn claim(
    requests: mpsc::UnboundedSender<AppRequest>,
    backend: &str,
) -> zbus::Result<Claim> {
    let service = AppService {
        requests,
        backend: backend.to_owned(),
    };
    let conn = connection::Builder::session()
        .serve_at(OBJECT_PATH, service)
        .build()
        .await?;
    // zbus 6 reports `Exists` as `Error::NameTaken` rather than as a reply.
    match conn
        .request_name_with_flags(BUS_NAME, RequestNameFlags::DO_NOT_QUEUE)
        .await
    {
        Ok(RequestNameReply::PrimaryOwner | RequestNameReply::AlreadyOwner) => {
            Ok(Claim::Primary(conn))
        }
        Ok(RequestNameReply::Exists | RequestNameReply::InQueue) | Err(zbus::Error::NameTaken) => {
            Ok(Claim::AlreadyRunning)
        }
        Err(error) => Err(error),
    }
}

/// Sends `request` to the running core.
pub async fn forward(request: AppRequest) -> zbus::Result<()> {
    let conn = Connection::session().await?;
    let proxy = OpalineProxy::new(&conn).await?;
    match request {
        AppRequest::Peek => proxy.peek().await,
        AppRequest::Edit => proxy.edit().await,
        AppRequest::OpenSettings => proxy.open_settings().await,
        AppRequest::Quit => proxy.quit().await,
    }
}
