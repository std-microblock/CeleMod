use std::{
    fmt,
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

/// How many previous runs are kept next to the current log file.
const MAX_PREVIOUS_LOGS: usize = 5;

static LOG_FILE: OnceLock<Mutex<Option<File>>> = OnceLock::new();
static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();

fn default_log_path() -> PathBuf {
    dirs::home_dir()
        .map(|home| home.join(".celemod").join("celemod.log"))
        .unwrap_or_else(|| PathBuf::from("celemod.log"))
}

/// `celemod.log` → `celemod.1.log` → … → `celemod.{MAX_PREVIOUS_LOGS}.log`
fn rotated_path(path: &Path, index: usize) -> PathBuf {
    let stem = path
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "celemod".to_string());
    let extension = path
        .extension()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "log".to_string());
    path.with_file_name(format!("{stem}.{index}.{extension}"))
}

/// Moves the log of the previous run aside instead of deleting it: a crash that
/// only happens on the first launch after an update is otherwise gone before
/// anyone can look at it.
fn rotate(path: &Path) {
    let size = fs::metadata(path)
        .map(|metadata| metadata.len())
        .unwrap_or_default();
    if size == 0 {
        // The previous run died before writing anything worth keeping.
        let _ = fs::remove_file(path);
        return;
    }

    let _ = fs::remove_file(rotated_path(path, MAX_PREVIOUS_LOGS));
    for index in (1..MAX_PREVIOUS_LOGS).rev() {
        let previous = rotated_path(path, index);
        if previous.is_file() {
            let _ = fs::rename(&previous, rotated_path(path, index + 1));
        }
    }
    let _ = fs::rename(path, rotated_path(path, 1));
}

pub(crate) fn initialize() {
    let path = default_log_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    rotate(&path);
    let file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&path)
        .ok();
    let _ = LOG_PATH.set(path);
    let _ = LOG_FILE.set(Mutex::new(file));

    // Identify this run as early as possible: the webview check and a failing
    // plugin initialization both abort before the backend would log anything.
    info(format_args!(
        "CeleMod v{} ({})",
        env!("VERSION"),
        env!("GIT_HASH")
    ));
    info(format_args!("{}", run_context()));

    let previous_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |panic_info| {
        error(format_args!("panic: {panic_info}"));
        previous_hook(panic_info);
    }));
}

fn run_context() -> String {
    let mut parts = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        parts.push(format!("exe: {}", exe.display()));
    }
    if let Ok(cwd) = std::env::current_dir() {
        parts.push(format!("cwd: {}", cwd.display()));
    }
    parts.push(format!(
        "os: {} {}",
        std::env::consts::OS,
        std::env::consts::ARCH
    ));
    parts.join(" | ")
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
    let line = format!("[{}] [{level}] [{source}] {message}\n", timestamp_millis());
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct Fixture(PathBuf);

    impl Fixture {
        fn new() -> Self {
            static NEXT: AtomicUsize = AtomicUsize::new(0);
            let path = std::env::temp_dir().join(format!(
                "celemod-logging-test-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn log(&self) -> PathBuf {
            self.0.join("celemod.log")
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn older_runs_are_kept_and_the_oldest_is_dropped() {
        let fixture = Fixture::new();
        let log = fixture.log();
        for index in 1..=MAX_PREVIOUS_LOGS {
            fs::write(
                rotated_path(&log, index),
                format!("run-{}", MAX_PREVIOUS_LOGS + 1 - index),
            )
            .unwrap();
        }
        fs::write(&log, "current").unwrap();

        rotate(&log);

        assert!(!log.exists(), "the current log is moved aside");
        assert_eq!(
            fs::read_to_string(rotated_path(&log, 1)).unwrap(),
            "current"
        );
        assert_eq!(
            fs::read_to_string(rotated_path(&log, MAX_PREVIOUS_LOGS)).unwrap(),
            "run-2"
        );
        assert!(
            !rotated_path(&log, MAX_PREVIOUS_LOGS + 1).exists(),
            "only the recent runs are kept"
        );
    }

    #[test]
    fn empty_log_is_removed_instead_of_rotated() {
        let fixture = Fixture::new();
        let log = fixture.log();
        fs::write(&log, "").unwrap();

        rotate(&log);

        assert!(!log.exists());
        assert!(!rotated_path(&log, 1).exists());
    }

    #[test]
    fn missing_log_does_not_create_history() {
        let fixture = Fixture::new();
        let log = fixture.log();

        rotate(&log);

        assert!(!rotated_path(&log, 1).exists());
    }

    #[test]
    fn rotated_names_keep_the_extension_of_the_log() {
        assert_eq!(
            rotated_path(Path::new("/home/orange/.celemod/celemod.log"), 3),
            Path::new("/home/orange/.celemod/celemod.3.log")
        );
    }
}
