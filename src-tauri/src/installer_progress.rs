//! Progress is a real installer stage, never a percentage inferred from log count.
#[derive(Default)]
pub(crate) struct InstallerProgress {
    stage: u8,
}

impl InstallerProgress {
    pub(crate) fn status(&mut self, log: &str, elapsed: u64) -> String {
        for line in log.lines() {
            let stage = if line.starts_with("Combining Documentation")
                || line.starts_with("Creating .NET runtime configuration")
                || line.contains("Skipping desktop apphosts")
            {
                7
            } else if line.starts_with("Running MonoMod.RuntimeDetour.HookGen")
                || (line.starts_with("Running MonoMod for ") && line.contains("MMHOOK_"))
            {
                6
            } else if line.starts_with("Running MonoMod for ") && line.ends_with("/Celeste.dll") {
                5
            } else if line.starts_with("Running MonoMod for ") && line.ends_with("/FNA.dll") {
                4
            } else if line.starts_with("Converting ") {
                3
            } else if line.starts_with("Creating backup")
                || line.starts_with("Backing up ")
                || line.starts_with("Loading Mono.Cecil")
                || line.starts_with("Applying patch vanilla")
            {
                2
            } else {
                1
            };
            self.stage = self.stage.max(stage);
        }
        let detail = log
            .lines()
            .rev()
            .find(|s| !s.trim().is_empty())
            .unwrap_or("");
        format!(
            "Android installer: {}",
            serde_json::json!({
                "stage": self.stage.max(1), "total": 7, "elapsed": elapsed,
                "detail": detail.chars().take(600).collect::<String>()
            })
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reports_milestones_not_log_line_percentages() {
        let mut progress = InstallerProgress::default();
        assert!(progress.status("", 0).contains("\"stage\":1"));
        assert!(
            progress
                .status("Converting /game/Celeste.exe to .NET Core", 10)
                .contains("\"stage\":3")
        );
        assert!(
            progress
                .status(
                    "Running MonoMod for /game/MiniInstallerWorkspace/Celeste.dll",
                    20
                )
                .contains("\"stage\":5")
        );
        assert!(
            progress
                .status("[MonoMod] [Main] Done.", 90)
                .contains("\"stage\":5")
        );
        assert!(
            progress
                .status("Running MonoMod for /game/MMHOOK_Celeste.dll", 91)
                .contains("\"stage\":6")
        );
        assert!(
            progress
                .status("Combining Documentation", 100)
                .contains("\"stage\":7")
        );
        assert!(progress.status("", 101).contains("\"stage\":7"));
    }
}
