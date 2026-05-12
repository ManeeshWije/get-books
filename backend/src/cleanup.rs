use std::time::{Duration, SystemTime};

const TEMP_DIR: &str = "/tmp";
const FILE_MAX_AGE: Duration = Duration::from_secs(60 * 60);
const CLEANUP_INTERVAL: Duration = Duration::from_secs(10 * 60);

pub fn spawn_temp_file_cleanup_task() {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(CLEANUP_INTERVAL);

        loop {
            ticker.tick().await;

            if let Err(error) = cleanup_expired_temp_files().await {
                tracing::warn!("temp file cleanup failed: {error}");
            }
        }
    });
}

async fn cleanup_expired_temp_files() -> std::io::Result<()> {
    let mut entries = tokio::fs::read_dir(TEMP_DIR).await?;
    let now = SystemTime::now();

    while let Some(entry) = entries.next_entry().await? {
        let file_name = entry.file_name();
        let file_name = file_name.to_string_lossy();

        if !is_app_temp_file(&file_name) {
            continue;
        }

        let metadata = entry.metadata().await?;
        if !metadata.is_file() {
            continue;
        }

        let file_timestamp = metadata.created().or_else(|_| metadata.modified());
        let timestamp = match file_timestamp {
            Ok(value) => value,
            Err(_) => {
                tracing::debug!("Skipping file without usable timestamp: {file_name}");
                continue;
            }
        };

        let age = now.duration_since(timestamp).unwrap_or(Duration::ZERO);
        if age <= FILE_MAX_AGE {
            continue;
        }

        if let Err(error) = tokio::fs::remove_file(entry.path()).await {
            tracing::warn!("Failed to delete expired temp file {file_name}: {error}");
        } else {
            tracing::info!("Deleted expired temp file: {file_name}");
        }
    }

    Ok(())
}

fn is_app_temp_file(file_name: &str) -> bool {
    if let Some(uuid_candidate) = file_name.strip_suffix(".kepub.epub") {
        return uuid::Uuid::parse_str(uuid_candidate).is_ok();
    }

    if let Some(uuid_candidate) = file_name.strip_suffix(".epub") {
        return uuid::Uuid::parse_str(uuid_candidate).is_ok();
    }

    false
}

#[cfg(test)]
mod tests {
    use super::is_app_temp_file;

    #[test]
    fn matches_supported_temp_file_names() {
        assert!(is_app_temp_file(
            "2a8d8ed8-fb30-4f62-b68f-b558f7f2f4e3.epub"
        ));
        assert!(is_app_temp_file(
            "2a8d8ed8-fb30-4f62-b68f-b558f7f2f4e3.kepub.epub"
        ));
    }

    #[test]
    fn ignores_unrelated_temp_file_names() {
        assert!(!is_app_temp_file("notes.txt"));
        assert!(!is_app_temp_file("book.epub"));
        assert!(!is_app_temp_file("1234.kepub.epub"));
    }
}
