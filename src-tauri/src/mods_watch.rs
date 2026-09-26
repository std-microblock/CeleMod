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
    time::{Duration, Instant, UNIX_EPOCH},
};

use notify::{RecursiveMode, Watcher};
use serde::Serialize;

pub const MODS_CHANGED_EVENT: &str = "celemod://mods-changed";

/// Folders are written as a burst of events. Wait until the burst settles
/// before looking at the folder to reduce scans of archives still being copied.
/// The periodic reconciliation below bounds the wait if events never settle.
const QUIET_PERIOD: Duration = Duration::from_millis(600);
/// Reconcile even when native events are lost, the directory is replaced, or
/// an event burst never becomes quiet. This scans metadata, not archive contents.
const RECONCILE_INTERVAL: Duration = Duration::from_secs(2);
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
    // Keep polling alive even if the native watcher cannot be started.
    sender: Option<mpsc::SyncSender<()>>,
    worker: Option<JoinHandle<()>>,
}

impl ActiveWatcher {
    fn shutdown(mut self) {
        self.stop.store(true, Ordering::SeqCst);
        // Drop both senders to disconnect the event stream and let the worker
        // leave its wait loop immediately, including in polling-only mode.
        self.watcher = None;
        self.sender = None;
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
        crate::logging::info(format_args!(
            "Mods folder changed at {}: added={:?}, removed={:?}, changed={:?}",
            game_path.display(),
            event.added,
            event.removed,
            event.changed
        ));
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
    let mut next_scan = Instant::now() + RECONCILE_INTERVAL;
    let mut quiet_until: Option<Instant> = None;
    loop {
        if stop.load(Ordering::SeqCst) {
            return;
        }
        let deadline = quiet_until.map_or(next_scan, |quiet| quiet.min(next_scan));
        let timeout = deadline
            .saturating_duration_since(Instant::now())
            .min(STOP_POLL_INTERVAL);
        match receiver.recv_timeout(timeout) {
            Ok(()) => quiet_until = Some(Instant::now() + QUIET_PERIOD),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }
        if stop.load(Ordering::SeqCst) {
            return;
        }
        let now = Instant::now();
        if now >= next_scan || quiet_until.is_some_and(|quiet| now >= quiet) {
            report_change(&mut snapshot, &mods_dir, &game_path, &on_change);
            quiet_until = None;
            next_scan = Instant::now() + RECONCILE_INTERVAL;
        }
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
        fs::create_dir_all(&mods_dir)?;
    }
    let snapshot = mods_snapshot(&mods_dir);
    // Notifications are only wakeups; one pending wakeup is enough regardless
    // of the number of files being copied into a directory Mod.
    let (sender, receiver) = mpsc::sync_channel::<()>(1);
    let event_sender = sender.clone();
    let stop = Arc::new(AtomicBool::new(false));
    let native_watcher = (|| -> notify::Result<notify::RecommendedWatcher> {
        let mut watcher =
            notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
                match result {
                    Ok(event) if matches!(event.kind, notify::EventKind::Access(_)) => return,
                    Ok(_) => {}
                    Err(error) => {
                        crate::logging::warn(format_args!(
                            "Mods folder watcher error: {error}; reconciling folder"
                        ));
                    }
                }
                let _ = event_sender.try_send(());
            })?;
        watcher.watch(&mods_dir, RecursiveMode::Recursive)?;
        Ok(watcher)
    })();
    let watcher = match native_watcher {
        Ok(watcher) => Some(watcher),
        Err(error) => {
            crate::logging::warn(format_args!(
                "Cannot start native watcher for {}: {error}; using periodic reconciliation",
                mods_dir.display()
            ));
            None
        }
    };
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
        watcher,
        sender: Some(sender),
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
        fs::write(
            mods.join("FolderMod").join("everest.yaml"),
            b"- Name: Folder",
        )
        .unwrap();
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

    // Start with a reconciliation event as a barrier: subsequent changes must
    // be detected by the worker loop, not its initial snapshot reconciliation.
    fn start_test_worker(
        root: &Path,
    ) -> (
        mpsc::Sender<()>,
        mpsc::Receiver<ModsChangedEvent>,
        Arc<AtomicBool>,
        JoinHandle<()>,
    ) {
        let mods = root.join("Mods");
        fs::create_dir_all(&mods).unwrap();
        fs::write(mods.join("Initial.zip"), b"initial").unwrap();
        let (sender, receiver) = mpsc::channel();
        let (events, changes) = mpsc::channel();
        let stop = Arc::new(AtomicBool::new(false));
        let worker_stop = Arc::clone(&stop);
        let game_path = root.to_path_buf();
        let worker = thread::spawn(move || {
            run_worker(
                receiver,
                worker_stop,
                game_path,
                mods,
                Snapshot::new(),
                move |event| {
                    let _ = events.send(event);
                },
            );
        });
        assert_eq!(
            changes.recv_timeout(Duration::from_secs(5)).unwrap().added,
            vec!["Initial.zip"]
        );
        (sender, changes, stop, worker)
    }

    #[test]
    fn worker_recovers_when_native_notifications_are_missing() {
        let root = test_dir("missed-notifications");
        let (sender, changes, stop, worker) = start_test_worker(&root);
        fs::write(root.join("Mods/NewMod.zip"), b"new mod").unwrap();
        // Deliberately do not send a filesystem notification.
        let result = changes.recv_timeout(Duration::from_secs(5));
        stop.store(true, Ordering::SeqCst);
        drop(sender);
        worker.join().unwrap();
        fs::remove_dir_all(root).ok();
        assert_eq!(
            result
                .expect("missed notifications must be reconciled")
                .added,
            vec!["NewMod.zip"]
        );
    }

    #[test]
    fn worker_does_not_starve_during_continuous_notifications() {
        let root = test_dir("busy-folder");
        let (sender, changes, stop, worker) = start_test_worker(&root);
        fs::write(root.join("Mods/NewMod.zip"), b"new mod").unwrap();
        let producer_stop = Arc::clone(&stop);
        let producer = thread::spawn(move || {
            while !producer_stop.load(Ordering::SeqCst) {
                if sender.send(()).is_err() {
                    break;
                }
                thread::sleep(Duration::from_millis(50));
            }
        });
        let result = changes.recv_timeout(Duration::from_secs(5));
        stop.store(true, Ordering::SeqCst);
        producer.join().unwrap();
        worker.join().unwrap();
        fs::remove_dir_all(root).ok();
        assert_eq!(
            result
                .expect("a busy directory must not postpone refresh forever")
                .added,
            vec!["NewMod.zip"]
        );
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
        // The first event can come from startup reconciliation. A second copy
        // proves that changes are still reported after initialization.
        fs::write(mods.join("LaterMod.zip"), b"later zip contents").unwrap();
        let later = receiver.recv_timeout(Duration::from_secs(5));
        stop();
        fs::remove_dir_all(root).ok();
        assert_eq!(
            later.expect("watcher stopped after initialization").added,
            vec!["LaterMod.zip"]
        );
    }
}
