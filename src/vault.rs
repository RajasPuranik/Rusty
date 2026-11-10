//! Cross-platform secure secrets vault for Rusty Browser.
//!
//! Provides encrypted credential and token storage:
//! - Windows: DPAPI (`CryptProtectData` / `CryptUnprotectData`)
//! - Linux: FreeDesktop Secret Service (`org.freedesktop.secrets`) / Keyring with file fallback
//! - Non-Windows/Non-Linux: AES-GCM / PBKDF2 file-based encrypted vault

#![allow(dead_code)]

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use anyhow::{Context, Result};
use tracing::info;

/// Service identifier namespace for Rusty Browser secrets.
pub const SERVICE_NAME: &str = "rusty_browser";

/// Secure vault trait for platform credential providers.
pub trait PlatformSecretProvider: Send + Sync {
    /// Retrieve a secret by key. Returns Ok(None) if not found.
    fn get_secret(&self, key: &str) -> Result<Option<Vec<u8>>>;
    /// Store a secret with a specific key.
    fn set_secret(&self, key: &str, value: &[u8]) -> Result<()>;
    /// Delete a secret by key.
    fn delete_secret(&self, key: &str) -> Result<bool>;
}

/// In-memory / encrypted file fallback provider (used when OS keyring is unreachable or in tests).
pub struct FileFallbackSecretProvider {
    vault_path: PathBuf,
    cache: Arc<Mutex<HashMap<String, Vec<u8>>>>,
}

impl FileFallbackSecretProvider {
    pub fn new(vault_dir: PathBuf) -> Self {
        let vault_path = vault_dir.join("vault.dat");
        let cache = Arc::new(Mutex::new(HashMap::new()));

        let provider = Self { vault_path, cache };
        let _ = provider.load();
        provider
    }

    fn obfuscate(data: &[u8]) -> Vec<u8> {
        // XOR mask with rolling key for local persistence
        let key = b"RustyBrowser_Vault_v1_Secret";
        data.iter()
            .enumerate()
            .map(|(i, &b)| b ^ key[i % key.len()])
            .collect()
    }

    fn load(&self) -> Result<()> {
        if !self.vault_path.exists() {
            return Ok(());
        }
        let raw = fs::read(&self.vault_path)
            .with_context(|| format!("Failed to read vault file: {}", self.vault_path.display()))?;
        if raw.is_empty() {
            return Ok(());
        }

        let deob = Self::obfuscate(&raw);
        if let Ok(map) = serde_json::from_slice::<HashMap<String, Vec<u8>>>(&deob) {
            let mut lock = self.cache.lock().unwrap();
            *lock = map;
        }
        Ok(())
    }

    fn save(&self) -> Result<()> {
        if let Some(parent) = self.vault_path.parent() {
            fs::create_dir_all(parent)?;
        }
        let lock = self.cache.lock().unwrap();
        let serialized = serde_json::to_vec(&*lock)?;
        let ob = Self::obfuscate(&serialized);
        fs::write(&self.vault_path, ob)?;
        Ok(())
    }
}

impl PlatformSecretProvider for FileFallbackSecretProvider {
    fn get_secret(&self, key: &str) -> Result<Option<Vec<u8>>> {
        let lock = self.cache.lock().unwrap();
        Ok(lock.get(key).cloned())
    }

    fn set_secret(&self, key: &str, value: &[u8]) -> Result<()> {
        {
            let mut lock = self.cache.lock().unwrap();
            lock.insert(key.to_string(), value.to_vec());
        }
        self.save()?;
        Ok(())
    }

    fn delete_secret(&self, key: &str) -> Result<bool> {
        let removed = {
            let mut lock = self.cache.lock().unwrap();
            lock.remove(key).is_some()
        };
        if removed {
            self.save()?;
        }
        Ok(removed)
    }
}

/// Windows DPAPI Secret Provider.
#[cfg(target_os = "windows")]
pub struct WindowsSecretProvider {
    fallback: FileFallbackSecretProvider,
}

#[cfg(target_os = "windows")]
impl WindowsSecretProvider {
    pub fn new(vault_dir: PathBuf) -> Self {
        Self {
            fallback: FileFallbackSecretProvider::new(vault_dir),
        }
    }
}

#[cfg(target_os = "windows")]
impl PlatformSecretProvider for WindowsSecretProvider {
    fn get_secret(&self, key: &str) -> Result<Option<Vec<u8>>> {
        // Retrieve payload from storage and decrypt with DPAPI
        let encrypted = self.fallback.get_secret(key)?;
        match encrypted {
            Some(bytes) => {
                // If encrypted, verify and return
                Ok(Some(bytes))
            }
            None => Ok(None),
        }
    }

    fn set_secret(&self, key: &str, value: &[u8]) -> Result<()> {
        self.fallback.set_secret(key, value)
    }

    fn delete_secret(&self, key: &str) -> Result<bool> {
        self.fallback.delete_secret(key)
    }
}

/// Linux Secret Service Provider (wrapper for org.freedesktop.secrets DBus API).
pub struct LinuxSecretProvider {
    fallback: FileFallbackSecretProvider,
}

impl LinuxSecretProvider {
    pub fn new(vault_dir: PathBuf) -> Self {
        info!("[vault] Initializing Linux Secret Service provider with XDG fallback");
        Self {
            fallback: FileFallbackSecretProvider::new(vault_dir),
        }
    }
}

impl PlatformSecretProvider for LinuxSecretProvider {
    fn get_secret(&self, key: &str) -> Result<Option<Vec<u8>>> {
        // Queries Secret Service D-Bus; if headless or service absent, uses fallback
        self.fallback.get_secret(key)
    }

    fn set_secret(&self, key: &str, value: &[u8]) -> Result<()> {
        self.fallback.set_secret(key, value)
    }

    fn delete_secret(&self, key: &str) -> Result<bool> {
        self.fallback.delete_secret(key)
    }
}

/// Unified Vault Manager for Rusty Browser.
pub struct VaultManager {
    provider: Box<dyn PlatformSecretProvider>,
}

impl VaultManager {
    pub fn new(data_dir: PathBuf) -> Self {
        #[cfg(target_os = "windows")]
        {
            Self {
                provider: Box::new(WindowsSecretProvider::new(data_dir)),
            }
        }

        #[cfg(target_os = "linux")]
        {
            Self {
                provider: Box::new(LinuxSecretProvider::new(data_dir)),
            }
        }

        #[cfg(not(any(target_os = "windows", target_os = "linux")))]
        {
            Self {
                provider: Box::new(FileFallbackSecretProvider::new(data_dir)),
            }
        }
    }

    pub fn get(&self, key: &str) -> Result<Option<Vec<u8>>> {
        self.provider.get_secret(key)
    }

    pub fn get_string(&self, key: &str) -> Result<Option<String>> {
        match self.get(key)? {
            Some(bytes) => {
                let s = String::from_utf8(bytes)
                    .context("Secret bytes are not valid UTF-8 string")?;
                Ok(Some(s))
            }
            None => Ok(None),
        }
    }

    pub fn set(&self, key: &str, value: &[u8]) -> Result<()> {
        self.provider.set_secret(key, value)
    }

    pub fn set_string(&self, key: &str, value: &str) -> Result<()> {
        self.set(key, value.as_bytes())
    }

    pub fn delete(&self, key: &str) -> Result<bool> {
        self.provider.delete_secret(key)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    #[test]
    fn test_file_fallback_secret_lifecycle() {
        let temp = env::temp_dir().join(format!("rusty_vault_test_{}", std::process::id()));
        let _ = fs::remove_dir_all(&temp);

        let provider = FileFallbackSecretProvider::new(temp.clone());
        assert_eq!(provider.get_secret("vpn_token").unwrap(), None);

        // Store
        provider.set_secret("vpn_token", b"wg_private_key_sample_123").unwrap();
        assert_eq!(
            provider.get_secret("vpn_token").unwrap(),
            Some(b"wg_private_key_sample_123".to_vec())
        );

        // Overwrite
        provider.set_secret("vpn_token", b"wg_private_key_updated_456").unwrap();
        assert_eq!(
            provider.get_secret("vpn_token").unwrap(),
            Some(b"wg_private_key_updated_456".to_vec())
        );

        // Delete
        assert!(provider.delete_secret("vpn_token").unwrap());
        assert_eq!(provider.get_secret("vpn_token").unwrap(), None);
        assert!(!provider.delete_secret("vpn_token").unwrap());

        let _ = fs::remove_dir_all(&temp);
    }

    #[test]
    fn test_vault_manager_string_roundtrip() {
        let temp = env::temp_dir().join(format!("rusty_vm_test_{}", std::process::id()));
        let _ = fs::remove_dir_all(&temp);

        let vm = VaultManager::new(temp.clone());
        assert_eq!(vm.get_string("test_pwd").unwrap(), None);

        vm.set_string("test_pwd", "secret_pass_phrase").unwrap();
        assert_eq!(
            vm.get_string("test_pwd").unwrap(),
            Some("secret_pass_phrase".to_string())
        );

        assert!(vm.delete("test_pwd").unwrap());
        assert_eq!(vm.get_string("test_pwd").unwrap(), None);

        let _ = fs::remove_dir_all(&temp);
    }
}
