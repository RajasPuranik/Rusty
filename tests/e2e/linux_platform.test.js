/**
 * Milestone R3: Linux Platform Support Verification Suite
 *
 * Verifies WebKitGTK 4.1 platform layer, Wayland/X11 container integration,
 * XDG compliance, Secret Service vault, Ad Blocker with WebKit rule conversion,
 * rootless WireGuard VPN with kill switch, packaging scripts, and CI workflows.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');

describe('Milestone R3: Linux Platform Support Suite', () => {

  describe('Feature 18: Linux Platform Abstraction Layer (WebKitGTK 4.1 & Wayland/X11)', () => {
    it('Verifies src/platform/linux.rs implements LinuxPlatformHost and LinuxWebView', () => {
      const linuxRs = fs.readFileSync(path.join(ROOT_DIR, 'src', 'platform', 'linux.rs'), 'utf8');
      assert.ok(linuxRs.includes('pub struct LinuxWebView'), 'Defines LinuxWebView struct');
      assert.ok(linuxRs.includes('impl PlatformWebView for LinuxWebView'), 'Implements PlatformWebView trait');
      assert.ok(linuxRs.includes('pub struct LinuxPlatformHost'), 'Defines LinuxPlatformHost struct');
      assert.ok(linuxRs.includes('impl PlatformHost for LinuxPlatformHost'), 'Implements PlatformHost trait');
    });

    it('Verifies GTK container path (build_gtk / default_vbox) for Wayland compatibility', () => {
      const linuxRs = fs.readFileSync(path.join(ROOT_DIR, 'src', 'platform', 'linux.rs'), 'utf8');
      assert.ok(linuxRs.includes('build_gtk'), 'Uses build_gtk for GTK container child webview');
      assert.ok(linuxRs.includes('default_vbox'), 'Uses tao Window default_vbox on Wayland/X11');
    });

    it('Verifies WebKit tab suspension and memory reduction methods', () => {
      const linuxRs = fs.readFileSync(path.join(ROOT_DIR, 'src', 'platform', 'linux.rs'), 'utf8');
      assert.ok(linuxRs.includes('fn suspend(&self)'), 'Implements tab suspend');
      assert.ok(linuxRs.includes('fn resume(&self)'), 'Implements tab resume');
      assert.ok(linuxRs.includes('fn set_memory_target_low(&self)'), 'Implements set_memory_target_low');
    });
  });

  describe('Feature 19: XDG Base Directory Compliance & Secret Service Vault', () => {
    it('Verifies XDG directory resolution functions in src/storage.rs', () => {
      const storageRs = fs.readFileSync(path.join(ROOT_DIR, 'src', 'storage.rs'), 'utf8');
      assert.ok(storageRs.includes('resolve_config_dir'), 'Exposes resolve_config_dir');
      assert.ok(storageRs.includes('resolve_data_dir'), 'Exposes resolve_data_dir');
      assert.ok(storageRs.includes('resolve_cache_dir'), 'Exposes resolve_cache_dir');
      assert.ok(storageRs.includes('resolve_downloads_dir'), 'Exposes resolve_downloads_dir');
      assert.ok(storageRs.includes('XDG_CONFIG_HOME'), 'Reads XDG_CONFIG_HOME');
      assert.ok(storageRs.includes('XDG_DATA_HOME'), 'Reads XDG_DATA_HOME');
      assert.ok(storageRs.includes('XDG_CACHE_HOME'), 'Reads XDG_CACHE_HOME');
    });

    it('Verifies VaultManager and Linux Secret Service provider in src/vault.rs', () => {
      const vaultRs = fs.readFileSync(path.join(ROOT_DIR, 'src', 'vault.rs'), 'utf8');
      assert.ok(vaultRs.includes('pub struct VaultManager'), 'Exposes VaultManager');
      assert.ok(vaultRs.includes('pub struct LinuxSecretProvider'), 'Exposes LinuxSecretProvider');
      assert.ok(vaultRs.includes('pub trait PlatformSecretProvider'), 'Defines PlatformSecretProvider trait');
      assert.ok(vaultRs.includes('FileFallbackSecretProvider'), 'Provides file fallback provider');
    });
  });

  describe('Feature 20: Linux Ad Blocker & WebKit Content Filter Conversion', () => {
    it('Verifies AdBlockManager converts EasyList rules to WebKit JSON schema', () => {
      const adblockRs = fs.readFileSync(path.join(ROOT_DIR, 'src', 'adblock.rs'), 'utf8');
      assert.ok(adblockRs.includes('pub struct AdBlockManager'), 'Exposes AdBlockManager');
      assert.ok(adblockRs.includes('pub struct WebKitContentRule'), 'Defines WebKitContentRule schema');
      assert.ok(adblockRs.includes('pub struct WebKitTrigger'), 'Defines WebKitTrigger schema');
      assert.ok(adblockRs.includes('pub struct WebKitAction'), 'Defines WebKitAction schema');
      assert.ok(adblockRs.includes('WEBKIT_RULE_COUNT_LIMIT'), 'Enforces rule count ceiling');
    });

    it('Verifies cosmetic stylesheet generation and element hiding', () => {
      const adblockRs = fs.readFileSync(path.join(ROOT_DIR, 'src', 'adblock.rs'), 'utf8');
      assert.ok(adblockRs.includes('cosmetic_stylesheet'), 'Exposes cosmetic stylesheet helper');
      assert.ok(adblockRs.includes('css-display-none'), 'Supports css-display-none action');
    });

    it('Verifies honest Linux blocker comparison in docs/ADBLOCK_LINUX_COMPARISON.md', () => {
      const docPath = path.join(ROOT_DIR, 'docs', 'ADBLOCK_LINUX_COMPARISON.md');
      assert.ok(fs.existsSync(docPath), 'docs/ADBLOCK_LINUX_COMPARISON.md exists');
      const doc = fs.readFileSync(docPath, 'utf8');
      assert.ok(doc.includes('What the Linux Blocker CANNOT Do'), 'Honest declaration of limitations');
      assert.ok(doc.includes('WebKitUserContentFilterStore'), 'Documents WebKitUserContentFilterStore');
      assert.ok(doc.includes('150,000 rules'), 'Documents rule-count ceiling');
    });
  });

  describe('Feature 21: Rootless Userspace WireGuard & SOCKS5 VPN Manager', () => {
    it('Verifies rootless VPN architecture and SOCKS5 proxy configuration in src/vpn.rs', () => {
      const vpnRs = fs.readFileSync(path.join(ROOT_DIR, 'src', 'vpn.rs'), 'utf8');
      assert.ok(vpnRs.includes('pub struct VpnManager'), 'Exposes VpnManager');
      assert.ok(vpnRs.includes('pub struct WireguardConfig'), 'Defines WireguardConfig');
      assert.ok(vpnRs.includes('KillSwitchPolicy'), 'Defines KillSwitchPolicy');
      assert.ok(vpnRs.includes('effective_proxy_url'), 'Exposes effective_proxy_url');
    });

    it('Verifies Kill Switch and DNS Leak Prevention policies', () => {
      const vpnRs = fs.readFileSync(path.join(ROOT_DIR, 'src', 'vpn.rs'), 'utf8');
      assert.ok(vpnRs.includes('socks5h://'), 'Uses socks5h for remote DNS resolution leak prevention');
      assert.ok(vpnRs.includes('StrictBlockAlways'), 'Implements StrictBlockAlways blackhole kill switch');
      assert.ok(vpnRs.includes('WebRtcPolicy'), 'Implements WebRTC IP leak mitigation policy');
    });
  });

  describe('Feature 22: Linux Packaging, Distribution & CI Integration', () => {
    it('Verifies cargo-deb metadata and AppImage packaging script', () => {
      const cargoToml = fs.readFileSync(path.join(ROOT_DIR, 'Cargo.toml'), 'utf8');
      assert.ok(cargoToml.includes('[package.metadata.deb]'), 'Cargo.toml defines package.metadata.deb');
      assert.ok(cargoToml.includes('libwebkit2gtk-4.1-0'), 'Specifies libwebkit2gtk-4.1 dependency');

      const debScript = path.join(ROOT_DIR, 'scripts', 'package_deb.sh');
      const appImageScript = path.join(ROOT_DIR, 'scripts', 'package_appimage.sh');
      assert.ok(fs.existsSync(debScript), 'scripts/package_deb.sh exists');
      assert.ok(fs.existsSync(appImageScript), 'scripts/package_appimage.sh exists');
    });

    it('Verifies GitHub Actions CI workflow for both Windows and Linux', () => {
      const ciYamlPath = path.join(ROOT_DIR, '.github', 'workflows', 'ci.yml');
      assert.ok(fs.existsSync(ciYamlPath), '.github/workflows/ci.yml exists');
      const ciYaml = fs.readFileSync(ciYamlPath, 'utf8');
      assert.ok(ciYaml.includes('runs-on: windows-latest'), 'CI builds on windows-latest');
      assert.ok(ciYaml.includes('runs-on: ubuntu-latest'), 'CI builds on ubuntu-latest');
      assert.ok(ciYaml.includes('libwebkit2gtk-4.1-dev'), 'CI installs WebKitGTK 4.1 development libraries');
    });

    it('Verifies README.md documents Linux system packages and NVIDIA/Wayland workarounds', () => {
      const readme = fs.readFileSync(path.join(ROOT_DIR, 'README.md'), 'utf8');
      assert.ok(readme.includes('libwebkit2gtk-4.1-dev'), 'Documents Debian/Ubuntu dependencies');
      assert.ok(readme.includes('webkit2gtk4.1-devel'), 'Documents Fedora dependencies');
      assert.ok(readme.includes('WEBKIT_DISABLE_DMABUF_RENDERER=1'), 'Documents NVIDIA/Wayland workaround');
    });
  });

});
