//! Where the IPC socket lives.

use std::path::{Path, PathBuf};

use crate::IpcError;

/// Directory name under `$XDG_RUNTIME_DIR`. Created by core with mode `0700`.
pub const RUNTIME_SUBDIR: &str = "opaline";
/// Socket file name inside [`RUNTIME_SUBDIR`]. Created by core with mode `0600`.
pub const SOCKET_NAME: &str = "ipc.sock";

/// `$XDG_RUNTIME_DIR/opaline`.
pub fn runtime_dir() -> Result<PathBuf, IpcError> {
    let base = std::env::var_os("XDG_RUNTIME_DIR").ok_or(IpcError::NoRuntimeDir)?;
    Ok(runtime_dir_in(Path::new(&base)))
}

/// `$XDG_RUNTIME_DIR/opaline/ipc.sock`.
pub fn socket_path() -> Result<PathBuf, IpcError> {
    Ok(runtime_dir()?.join(SOCKET_NAME))
}

/// [`runtime_dir`] relative to an explicit base, for tests.
pub fn runtime_dir_in(base: &Path) -> PathBuf {
    base.join(RUNTIME_SUBDIR)
}
