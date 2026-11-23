// Free ad-hoc signature for macOS builds. Without any signature, Apple Silicon
// Macs report the downloaded app as "damaged". Ad-hoc signing fixes that;
// Gatekeeper still asks for right-click > Open once (no paid Apple ID).
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
exports.default = async function (context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  for (const arch of ['mac-arm64', 'mac-x64']) {
    const binary = path.join(app, 'Contents', 'Resources', 'cloudflared', arch, 'cloudflared');
    if (fs.existsSync(binary)) fs.chmodSync(binary, 0o755);
  }
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  console.log('ad-hoc signed', app);
};
