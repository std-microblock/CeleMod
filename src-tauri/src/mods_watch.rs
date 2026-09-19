//! Cross-platform watching of the Celeste `Mods` directory.
//!
//! Everest, the game itself and other tools can add, update or remove Mods
//! while CeleMod is running. Watching the folder lets the frontend reload the
//! Mod list automatically instead of waiting for a manual refresh.

use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, RecvTimeoutError},
    },
    thread::{self, JoinHandle},
    time::{Duration, UNIX_EPOCH},
};

use notify::{RecursiveMode, Watcher};
use serde::Serialize;

pub const MODS_CHANGED_EVENT: &str = "celemod://mods-changed";

/// Folders are written as a burst of events. Wait until the burst settles
/// before looking at the folder, otherwise archives would be parsed while they
/// are still being copied.
const QUIET_PERIOD: Duration = Duration::from_millis(600);
/// How often the worker wakes up to notice a stop request.
const STOP_POLL_INTERVAL: Duration = Duration::from_millis(200);

/// Entries CeleMod manages itself inside the Mods folder.
const IGNORED_ENTRIES: [&str; 2] = ["blacklist.txt", "celemod_yaml_cache"];

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModsChangedEvent {
    pub game_path: String,
    pub added: Vec<String>,
    pub removed: Vec<String>,
    pub changed: Vec<String>,
}

impl ModsChangedEvent {
    fn is_empty(&self) -> bool {
        self.added.is_empty() && self.removed.is_empty() && self.changed.is_empty()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ModFingerprint {
    file: String,
    size: u64,
    modified_at: u128,
}

type Snapshot = BTreeMap<String, ModFingerprint>;

fn modification_time(metadata: &fs::Metadata) -> u128 {
    metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_nanos())
        .unwrap_or_default()
}

fn fingerprint(metadata: &fs::Metadata, file: String) -> ModFingerprint {
    ModFingerprint {
        file,
        size: metadata.len(),
        modified_at: modification_time(metadata),
    }
}

fn is_ignored_entry(name: &str) -> bool {
    name.starts_with('.')
        || IGNORED_ENTRIES
            .iter()
            .any(|ignored| name.eq_ignore_ascii_case(ignored))
}

fn is_zip_archive(path: &Path) -> bool {
    path.extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("zip"))
}

/// Directory Mods are identified by their `everest.yaml`; folders without one
/// are not installed Mods and are ignored.
fn directory_mod_fingerprint(path: &Path, file: String) -> Option<ModFingerprint> {
    let mut result = ["everest.yaml", "everest.yml"]
        .iter()
        .filter_map(|name| fs::metadata(path.join(name)).ok())
        .map(|metadata| fingerprint(&metadata, file.clone()))
        .next()?;
    // The folder timestamp catches Mods that are rebuilt in place without
    // touching their metadata file.
    if let Ok(metadata) = fs::metadata(path) {
        result.modified_at = result.modified_at.max(modification_time(&metadata));
    }
    Some(result)
}

/// Cheap fingerprint of everything that is currently a Mod in `mods_dir`.
/// Only that level is inspected: Mods are either archives or folders that
/// contain an `everest.yaml`.
fn mods_snapshot(mods_dir: &Path) -> Snapshot {
    let mut snapshot = Snapshot::new();
    let Ok(entries) = fs::read_dir(mods_dir) else {
        return snapshot;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if is_ignored_entry(&name) {
            continue;
        }
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let path = entry.path();
        let fingerprint = if file_type.is_dir() {
            directory_mod_fingerprint(&path, name.clone())
        } else if file_type.is_file() && is_zip_archive(&path) {
            fs::metadata(&path)
                .ok()
                .map(|metadata| fingerprint(&metadata, name.clone()))
        } else {
            None
        };
        if let Some(fingerprint) = fingerprint {
            snapshot.insert(name.to_ascii_lowercase(), fingerprint);
        }
    }
    snapshot
}

fn describe_change(game_path: &str, before: &Snapshot, after: &Snapshot) -> ModsChangedEvent {
    let mut event = ModsChangedEvent {
        game_path: game_path.to_owned(),
        added: Vec::new(),
        removed: Vec::new(),
        changed: Vec::new(),
    };
    for (key, entry) in after {
        match before.get(key) {
            None => event.added.push(entry.file.clone()),
            Some(previous) if previous != entry => event.changed.push(entry.file.clone()),
            Some(_) => {}
        }
    }
    for (key, entry) in before {
        if !after.contains_key(key) {
            event.removed.push(entry.file.clone());
        }
    }
    event
}

struct ActiveWatcher {
    stop: Arc<AtomicBool>,
    watcher: Option<notify::RecommendedWatcher>,
    worker: Option<JoinHandle<()>>,
}

impl ActiveWatcher {
    fn shutdown(mut self) {
        self.stop.store(true, Ordering::SeqCst);
        // Dropping the watcher closes the event stream, which disconnects the
        // channel and lets the worker leave its wait loop immediately.
        self.watcher = None;
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

static ACTIVE_WATCHER: Mutex<Option<ActiveWatcher>> = Mutex::new(None);

fn take_active_watcher() -> Option<ActiveWatcher> {
    ACTIVE_WATCHER
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .take()
}

/// Stops watching the Mods folder, e.g. because the game path changed.
pub fn stop() {
    if let Some(watcher) = take_active_watcher() {
        watcher.shutdown();
    }
}

fn report_change(
    snapshot: &mut Snapshot,
    mods_dir: &Path,
    game_path: &Path,
    on_change: &impl Fn(ModsChangedEvent),
) {
    let next = mods_snapshot(mods_dir);
    if next == *snapshot {
        return;
    }
    let event = describe_change(&game_path.to_string_lossy(), snapshot, &next);
    *snapshot = next;
    if !event.is_empty() {
        on_change(event);
    }
}

fn run_worker(
    receiver: mpsc::Receiver<()>,
    stop: Arc<AtomicBool>,
    game_path: PathBuf,
    mods_dir: PathBuf,
    mut snapshot: Snapshot,
    on_change: impl Fn(ModsChangedEvent),
) {
    // Reconcile Mods that appeared between the initial scan and the watcher
    // being registered, so nothing can slip through unnoticed.
    report_change(&mut snapshot, &mods_dir, &game_path, &on_change);
    loop {
        match receiver.recv_timeout(STOP_POLL_INTERVAL) {
            Ok(()) => {}
            Err(RecvTimeoutError::Timeout) => {
                if stop.load(Ordering::SeqCst) {
                    return;
                }
                continue;
            }
            Err(RecvTimeoutError::Disconnected) => return,
        }
        // Coalesce the burst of events: keep draining until the folder is calm.
        loop {
            match receiver.recv_timeout(QUIET_PERIOD) {
                Ok(()) => {}
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => return,
            }
            if stop.load(Ordering::SeqCst) {
                return;
            }
        }
        if stop.load(Ordering::SeqCst) {
            return;
        }
        report_change(&mut snapshot, &mods_dir, &game_path, &on_change);
    }
}

/// Watches `<game_path>/Mods` and calls `on_change` whenever the set of
/// installed Mods changes. Any previous watcher is replaced.
pub fn watch(
    game_path: &Path,
    on_change: impl Fn(ModsChangedEvent) + Send + 'static,
) -> anyhow::Result<()> {
    stop();
    let game_path = game_path.to_path_buf();
    let mods_dir = game_path.join("Mods");
    if !mods_dir.is_dir() {
        // Everest creates the folder on first launch. Watching needs it to
        // exist and CeleMod manages this folder anyway, so create it up front.
        if let Err(error) = fs::create_dir_all(&mods_dir) {
            crate::logging::warn(format_args!(
                "Cannot watch {}: {error:#}",
                mods_dir.display()
            ));
            return Ok(());
        }
    }
    let snapshot = mods_snapshot(&mods_dir);
    let (sender, receiver) = mpsc::channel::<()>();
    let stop = Arc::new(AtomicBool::new(false));
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
        match result {
            Ok(_) => {
                let _ = sender.send(());
            }
            Err(error) => {
                crate::logging::warn(format_args!("Mods folder watcher error: {error}"));
            }
        }
    })?;
    watcher.watch(&mods_dir, RecursiveMode::Recursive)?;
    let worker_stop = Arc::clone(&stop);
    let worker_game_path = game_path.clone();
    let worker_mods_dir = mods_dir.clone();
    let worker = thread::Builder::new()
        .name("celemod-mods-watch".to_string())
        .spawn(move || {
            run_worker(
                receiver,
                worker_stop,
                worker_game_path,
                worker_mods_dir,
                snapshot,
                on_change,
            );
        })?;
    let mut slot = ACTIVE_WATCHER
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *slot = Some(ActiveWatcher {
        stop,
        watcher: Some(watcher),
        worker: Some(worker),
    });
    drop(slot);
    crate::logging::info(format_args!(
        "Watching {} for Mod changes",
        mods_dir.display()
    ));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_dir(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "celemod-watch-{name}-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn snapshot_only_reports_installed_mods() {
        let root = test_dir("snapshot");
        let mods = root.join("Mods");
        fs::create_dir_all(&mods).unwrap();
        fs::write(mods.join("Archive.zip"), b"zip").unwrap();
        fs::write(mods.join("notes.txt"), b"not a mod").unwrap();
        fs::write(mods.join("blacklist.txt"), b"Archive.zip\n").unwrap();
        fs::create_dir_all(mods.join("FolderMod")).unwrap();
        fs::write(mods.join("FolderMod").join("everest.yaml"), b"- Name: Folder").unwrap();
        fs::create_dir_all(mods.join("JustAFolder")).unwrap();

        let snapshot = mods_snapshot(&mods);
        let files = snapshot
            .values()
            .map(|entry| entry.file.as_str())
            .collect::<Vec<_>>();
        assert_eq!(files, vec!["Archive.zip", "FolderMod"]);
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn snapshot_ignores_metadata_only_changes() {
        let root = test_dir("metadata");
        let mods = root.join("Mods");
        fs::create_dir_all(&mods).unwrap();
        fs::write(mods.join("Archive.zip"), b"zip").unwrap();
        let before = mods_snapshot(&mods);

        fs::write(mods.join("blacklist.txt"), b"Archive.zip\n").unwrap();
        let after = mods_snapshot(&mods);

        assert_eq!(before, after);
        assert!(describe_change("/game", &before, &after).is_empty());
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn describe_change_lists_added_removed_and_updated_mods() {
        let root = test_dir("diff");
        let mods = root.join("Mods");
        fs::create_dir_all(&mods).unwrap();
        fs::write(mods.join("Kept.zip"), b"one").unwrap();
        fs::write(mods.join("Removed.zip"), b"two").unwrap();
        let before = mods_snapshot(&mods);

        fs::write(mods.join("Removed.zip"), b"two").unwrap();
        fs::remove_file(mods.join("Removed.zip")).unwrap();
        fs::write(mods.join("Added.zip"), b"three").unwrap();
        fs::write(mods.join("Kept.zip"), b"a much longer body").unwrap();
        let after = mods_snapshot(&mods);

        let event = describe_change("/game", &before, &after);
        assert_eq!(event.game_path, "/game");
        assert_eq!(event.added, vec!["Added.zip"]);
        assert_eq!(event.removed, vec!["Removed.zip"]);
        assert_eq!(event.changed, vec!["Kept.zip"]);
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn watcher_reports_new_mods() {
        let root = test_dir("watcher");
        let mods = root.join("Mods");
        fs::create_dir_all(&mods).unwrap();
        let (sender, receiver) = mpsc::channel::<ModsChangedEvent>();
        watch(&root, move |event| {
            let _ = sender.send(event);
        })
        .unwrap();

        fs::write(mods.join("NewMod.zip"), b"zip contents").unwrap();

        let event = receiver
            .recv_timeout(Duration::from_secs(20))
            .expect("watcher did not report the new Mod");
        assert_eq!(event.added, vec!["NewMod.zip"]);
        assert_eq!(event.game_path, root.to_string_lossy());
        stop();
        fs::remove_dir_all(root).ok();
    }
}
