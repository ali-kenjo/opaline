//! Session D-Bus service `io.github.ali_kenjo.Opaline` and single-instance handling.
//!
//! The first core owns the name. Any later `opaline` invocation finds the name taken, forwards
//! its request (Edit, Peek, Settings, Quit) to the running core and exits.

use opaline_ipc::BackendKind;
use tokio::sync::{mpsc, watch};
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
    OpenOnboarding,
    Quit,
}

struct AppService {
    requests: mpsc::UnboundedSender<AppRequest>,
    backend: watch::Receiver<BackendKind>,
    layer: LayerLaunch,
}

/// How the shell helper should start the layer in Native mode: this very binary (so dev
/// builds work) and a few environment variables (the helper accepts only an allow-list).
#[derive(Debug, Clone, Default)]
pub struct LayerLaunch {
    pub executable: String,
    pub environment: std::collections::HashMap<String, String>,
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

    fn open_onboarding(&self) {
        self.forward(AppRequest::OpenOnboarding);
    }

    fn quit(&self) {
        self.forward(AppRequest::Quit);
    }

    #[zbus(property)]
    fn backend_mode(&self) -> String {
        match *self.backend.borrow() {
            BackendKind::Native => "native",
            BackendKind::Instant => "instant",
        }
        .to_owned()
    }

    #[zbus(property)]
    fn layer_executable(&self) -> String {
        self.layer.executable.clone()
    }

    #[zbus(property)]
    fn layer_environment(&self) -> std::collections::HashMap<String, String> {
        self.layer.environment.clone()
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
    fn open_onboarding(&self) -> zbus::Result<()>;
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
    backend: watch::Receiver<BackendKind>,
    layer: LayerLaunch,
) -> zbus::Result<Claim> {
    let service = AppService {
        requests,
        backend,
        layer,
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

/// Keeps the `BackendMode` D-Bus property in sync as core switches between Instant and Native.
pub async fn sync_backend(
    conn: Connection,
    mut hub_backend: watch::Receiver<BackendKind>,
    tx: watch::Sender<BackendKind>,
) {
    loop {
        let current = *hub_backend.borrow_and_update();
        if tx.send(current).is_err() {
            return;
        }
        if let Ok(iface) = conn
            .object_server()
            .interface::<_, AppService>(OBJECT_PATH)
            .await
        {
            let _ = iface
                .get()
                .await
                .backend_mode_changed(iface.signal_emitter())
                .await;
        }
        if hub_backend.changed().await.is_err() {
            return;
        }
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
        AppRequest::OpenOnboarding => proxy.open_onboarding().await,
        AppRequest::Quit => proxy.quit().await,
    }
}
