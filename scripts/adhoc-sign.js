// Free ad-hoc signature for macOS builds. Without any signature, Apple Silicon
// Macs report the downloaded app as "damaged". Ad-hoc signing fixes that;
// Gatekeeper still asks for right-click > Open once (no paid Apple ID).
const { execFileSync } = require('child_process');
const path = require('path');
exports.default = async function (context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  console.log('ad-hoc signed', app);
};
