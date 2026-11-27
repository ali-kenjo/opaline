//! Custom data sources, trust approval, and custom widget packages (brief §4.4–4.5, PLAN-2 P6).

pub mod manager;
pub mod model;
pub mod mqtt;
pub mod parsers;
pub mod runners;

pub use manager::{CUSTOM_WIDGETS_TOPIC, SOURCES_CATALOG_TOPIC, SourceManager};
pub use model::{
    CustomWidgetPackage, DbusBus, DbusMode, OutputFormat, SourceDiagnoseEntry, SourceKind,
    SourceLogEntry, SourceOrigin, SourceRuntimeStatus, SourceSpec, SourceState, TrustDecision,
    TrustStore,
};
