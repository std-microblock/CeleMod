//! xxHash64 of Mod archives.
//!
//! Everest (and therefore Olympus) decides whether an installed Mod still
//! matches the newest released file by comparing the xxHash64 of the installed
//! archive with the hashes listed in the Mod update database.  Comparing the
//! `everest.yaml` version instead misses releases whose archive keeps the old
//! or a wrong version number (aonHelper 0.19.8 still declares 0.19.7), so
//! CeleMod uses the same hash as well.
//!
//! Hashing reads the whole archive, so results are cached and reused while the
//! file keeps its size and modification time.

use std::{
    collections::HashMap,
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
};

use anyhow::Context;
use lazy_static::lazy_static;
use parking_lot::Mutex;

/// Hashes are streamed so that large Mod archives never sit in memory.
const BUFFER_SIZE: usize = 1 << 20;

#[derive(Clone, PartialEq, Eq)]
struct CachedHash {
    size: u64,
    modified_at: u64,
    hash: String,
}

lazy_static! {
    static ref HASH_CACHE: Mutex<HashMap<PathBuf, CachedHash>> = Mutex::new(HashMap::new());
}

/// Lowercase hex xxHash64 of a file, matching `Everest.GetChecksum` and the
/// `xxHash` entries of the Mod update database.
pub fn hash_file(path: &Path) -> anyhow::Result<String> {
    let mut hasher = xxhash_rust::xxh64::Xxh64::new(0);
    let mut file =
        File::open(path).with_context(|| format!("Failed to open {}", path.display()))?;
    let mut buffer = vec![0u8; BUFFER_SIZE];
    loop {
        let read = file
            .read(&mut buffer)
            .with_context(|| format!("Failed to read {}", path.display()))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:016x}", hasher.digest()))
}

/// The cached hash of `path`, or `None` when it was never hashed or the file
/// changed since (a replaced Mod archive changes size and modification time).
pub fn cached_hash(path: &Path, size: u64, modified_at: u64) -> Option<String> {
    let key = cache_key(path);
    let cache = HASH_CACHE.lock();
    let entry = cache.get(&key)?;
    (entry.size == size && entry.modified_at == modified_at).then(|| entry.hash.clone())
}

/// The cached hash of `path`, hashing and caching it when needed.
pub fn ensure_hash(path: &Path, size: u64, modified_at: u64) -> anyhow::Result<String> {
    if let Some(hash) = cached_hash(path, size, modified_at) {
        return Ok(hash);
    }
    let hash = hash_file(path)?;
    HASH_CACHE.lock().insert(
        cache_key(path),
        CachedHash {
            size,
            modified_at,
            hash: hash.clone(),
        },
    );
    Ok(hash)
}

/// Mod archives are addressed by path, but the same file can be reached
/// through a symlinked `Mods` folder, so cache by the resolved path.
fn cache_key(path: &Path) -> PathBuf {
    fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
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
        let path =
            std::env::temp_dir().join(format!("celemod-{name}-{}-{unique}", std::process::id()));
        fs::create_dir_all(&path).unwrap();
        path
    }

    /// Reference values of the xxHash64 specification, so the implementation
    /// stays compatible with Everest's.
    #[test]
    fn hashes_known_content() {
        let root = test_dir("archive-hash");
        for (contents, expected) in [
            (&b""[..], "ef46db3751d8e999"),
            (&b"abc"[..], "44bc2cf5ad770999"),
            (&b"xxhash"[..], "32dd38952c4bc720"),
        ] {
            let path = root.join("archive.zip");
            fs::write(&path, contents).unwrap();
            assert_eq!(hash_file(&path).unwrap(), expected);
        }
    }

    #[test]
    fn reuses_the_cached_hash_until_the_file_changes() {
        let root = test_dir("archive-hash-cache");
        let path = root.join("archive.zip");
        fs::write(&path, b"first").unwrap();
        let metadata = fs::metadata(&path).unwrap();
        let size = metadata.len();
        let modified_at = metadata
            .modified()
            .unwrap()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        let first = ensure_hash(&path, size, modified_at).unwrap();
        assert_eq!(
            cached_hash(&path, size, modified_at).as_deref(),
            Some(first.as_str())
        );
        assert_eq!(ensure_hash(&path, size, modified_at).unwrap(), first);

        // A replaced archive keeps neither its size nor its timestamp.
        fs::write(&path, b"second").unwrap();
        let metadata = fs::metadata(&path).unwrap();
        let changed = ensure_hash(&path, metadata.len(), modified_at + 1).unwrap();
        assert_ne!(changed, first);
        assert_eq!(hash_file(&path).unwrap(), changed);
    }
}
