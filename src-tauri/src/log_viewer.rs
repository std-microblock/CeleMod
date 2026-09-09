//! Bounded, read-only log snapshots. Callers choose files from a fixed allowlist.
use std::{
    fs::File,
    io::{self, Read, Seek, SeekFrom},
    path::Path,
};

pub(crate) const MAX_LOG_BYTES: u64 = 256 * 1024;

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LogSnapshot {
    pub(crate) content: String,
    exists: bool,
    truncated: bool,
    size: u64,
    modified_at: Option<u64>,
}

pub(crate) fn read(path: &Path) -> io::Result<LogSnapshot> {
    let mut file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(LogSnapshot {
                content: String::new(),
                exists: false,
                truncated: false,
                size: 0,
                modified_at: None,
            });
        }
        Err(error) => return Err(error),
    };
    let metadata = file.metadata()?;
    if !metadata.is_file() {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "Not a log file"));
    }
    let size = metadata.len();
    let start = size.saturating_sub(MAX_LOG_BYTES);
    file.seek(SeekFrom::Start(start))?;
    // Bound the read even if another process keeps appending to the log.
    let mut bytes = Vec::new();
    file.take(MAX_LOG_BYTES).read_to_end(&mut bytes)?;
    // The tail may start inside a UTF-8 character. Skip only continuation bytes;
    // retain invalid bytes elsewhere as replacement characters for diagnostics.
    let skip = if start > 0 {
        bytes.iter().take(3).take_while(|b| (**b & 0xc0) == 0x80).count()
    } else {
        0
    };
    Ok(LogSnapshot {
        content: String::from_utf8_lossy(&bytes[skip..]).into_owned(),
        exists: true,
        truncated: start > 0,
        size,
        modified_at: metadata.modified().ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis() as u64),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct Fixture(std::path::PathBuf);
    impl Fixture {
        fn new() -> Self {
            static NEXT: AtomicUsize = AtomicUsize::new(0);
            let path = std::env::temp_dir().join(format!("celemod-log-test-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
            std::fs::create_dir(&path).unwrap();
            Self(path)
        }
        fn log(&self) -> std::path::PathBuf { self.0.join("game.log") }
    }
    impl Drop for Fixture {
        fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
    }

    #[test]
    fn missing_and_empty_are_distinct() {
        let fixture = Fixture::new();
        assert!(!read(&fixture.log()).unwrap().exists);
        std::fs::write(fixture.log(), "").unwrap();
        let log = read(&fixture.log()).unwrap();
        assert!(log.exists);
        assert!(log.content.is_empty());
        assert!(!log.truncated);
    }

    #[test]
    fn preserves_text_and_reads_new_content_on_refresh() {
        let fixture = Fixture::new();
        std::fs::write(fixture.log(), "游戏启动\r\n<error> & details\n").unwrap();
        assert_eq!(read(&fixture.log()).unwrap().content, "游戏启动\r\n<error> & details\n");
        std::fs::write(fixture.log(), "new session").unwrap();
        assert_eq!(read(&fixture.log()).unwrap().content, "new session");
    }

    #[test]
    fn bounds_large_logs_and_avoids_split_utf8() {
        let fixture = Fixture::new();
        let text = format!("中{}", "x".repeat(MAX_LOG_BYTES as usize - 1));
        std::fs::write(fixture.log(), &text).unwrap();
        let log = read(&fixture.log()).unwrap();
        assert!(log.truncated);
        assert_eq!(log.size, text.len() as u64);
        assert_eq!(log.content, "x".repeat(MAX_LOG_BYTES as usize - 1));
        assert!(log.modified_at.is_some());
    }

    #[test]
    fn exact_limit_is_not_truncated_and_invalid_utf8_is_readable() {
        let fixture = Fixture::new();
        std::fs::write(fixture.log(), vec![b'x'; MAX_LOG_BYTES as usize]).unwrap();
        assert!(!read(&fixture.log()).unwrap().truncated);
        std::fs::write(fixture.log(), [b'a', 0xff, b'b']).unwrap();
        assert_eq!(read(&fixture.log()).unwrap().content, "a\u{fffd}b");
    }

    #[test]
    fn directories_are_errors_not_empty_logs() {
        let fixture = Fixture::new();
        assert!(read(&fixture.0).is_err());
    }
}
