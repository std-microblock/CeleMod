use std::{
    fmt,
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

static LOG_FILE: OnceLock<Mutex<Option<File>>> = OnceLock::new();
static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();

fn default_log_path() -> PathBuf {
    dirs::home_dir()
        .map(|home| home.join(".celemod").join("celemod.log"))
        .unwrap_or_else(|| PathBuf::from("celemod.log"))
}

pub(crate) fn initialize() {
    let path = default_log_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&path)
        .ok();
    let _ = LOG_PATH.set(path);
    let _ = LOG_FILE.set(Mutex::new(file));

    let previous_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |panic_info| {
        error(format_args!("panic: {panic_info}"));
        previous_hook(panic_info);
    }));
}

pub(crate) fn path() -> &'static Path {
    LOG_PATH.get_or_init(default_log_path).as_path()
}

fn timestamp_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn write(level: &str, source: &str, message: fmt::Arguments<'_>) {
    let line = format!(
        "[{}] [{level}] [{source}] {message}\n",
        timestamp_millis()
    );
    if let Some(file) = LOG_FILE.get()
        && let Ok(mut file) = file.lock()
        && let Some(file) = file.as_mut()
    {
        let _ = file.write_all(line.as_bytes());
        let _ = file.flush();
    }

    if level == "ERROR" || level == "WARN" {
        eprint!("{line}");
    } else {
        print!("{line}");
    }
}

pub(crate) fn info(message: fmt::Arguments<'_>) {
    write("INFO", "backend", message);
}

pub(crate) fn warn(message: fmt::Arguments<'_>) {
    write("WARN", "backend", message);
}

pub(crate) fn error(message: fmt::Arguments<'_>) {
    write("ERROR", "backend", message);
}

pub(crate) fn frontend(level: &str, message: &str) {
    let level = match level.to_ascii_uppercase().as_str() {
        "DEBUG" => "DEBUG",
        "WARN" => "WARN",
        "ERROR" => "ERROR",
        _ => "INFO",
    };
    write(level, "frontend", format_args!("{message}"));
}
