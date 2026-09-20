#![feature(try_blocks)]

#[cfg(target_os = "android")]
mod android;
mod backend;
#[cfg(any(target_os = "android", test))]
mod installer_progress;
#[cfg(any(target_os = "android", test))]
mod log_viewer;
mod logging;
mod webview_runtime;

pub use backend::run;
