#![feature(try_blocks)]

mod backend;
mod logging;
#[cfg(any(target_os = "android", test))]
mod log_viewer;
#[cfg(any(target_os = "android", test))]
mod installer_progress;
mod webview_runtime;
#[cfg(target_os = "android")]
mod android;

pub use backend::run;
