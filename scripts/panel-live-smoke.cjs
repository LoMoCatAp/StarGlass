'use strict';
// Runtime end-to-end check: drive the main process's own updateSettings() -- the
// exact path the settings UI calls -- and assert the NATIVE panel window really
// resizes.  The panel cannot be screenshotted (WDA_EXCLUDEFROMCAPTURE), so its
// window geometry is the observable.
//
// Requires the app to be started with STARGLASS_TEST_HOOKS=1, which this script
// sets itself.  ASCII-only, matching the rest of the tooling.

const { _electron: electron } = require('@playwright/test');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// Enumerates the native panel window by CLASS NAME.  Enumerating by PID alone
// picks up ImGui's helper windows and yields the wrong geometry.
const PS = `
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices;
public static class PG {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public static string FindAll() {
    var acc = new StringBuilder();
    EnumWindows((h,l) => {
      int pid; GetWindowThreadProcessId(h, out pid);
      try {
        if (System.Diagnostics.Process.GetProcessById(pid).ProcessName == "glasspanel") {
          var sb = new StringBuilder(64); GetClassNameW(h, sb, 64);
          if (sb.ToString() == "StarGlassPanel") {
            RECT r; GetWindowRect(h, out r);
            acc.Append((r.Right - r.Left) + "x" + (r.Bottom - r.Top) + ";");
          }
        }
      } catch {}
      return true;
    }, IntPtr.Zero);
    return acc.ToString();
  }
}
"@
[void][PG]::SetProcessDPIAware()
[PG]::FindAll()
`;

function panelGeometry() {
  try {
    return execFileSync('powershell', ['-NoProfile', '-Command', PS], { encoding: 'utf8' }).trim();
  } catch (error) {
    return `(probe failed: ${error.message})`;
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const root = path.join(__dirname, '..');
  const dataDir = path.join(root, '.test-data', `live-${Date.now()}`);
  fs.mkdirSync(dataDir, { recursive: true });
  const env = {
    ...process.env,
    STARGLASS_DATA_DIR: dataDir,
    STARGLASS_NATIVE_PANEL: '1',
    STARGLASS_TEST_HOOKS: '1',
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = await electron.launch({
    executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: ['.'],
    cwd: root,
    env,
  });
  try {
    await app.firstWindow();

    let before = '';
    for (let i = 0; i < 60; i++) {
      await wait(500);
      before = panelGeometry();
      if (before) break;
    }
    console.log('panel geometry before:', before || '(panel never appeared)');

    // Same call the settings window makes after a save.
    const applied = await app.evaluate(() =>
      global.__starglassTest.updateSettings({
        ...global.__starglassTest.snapshot().settings,
        compact: true,
        fontSize: 12,
      }));
    console.log('settings now:', JSON.stringify({ compact: applied.settings.compact, fontSize: applied.settings.fontSize }));

    await wait(3000);
    const after = panelGeometry();
    console.log('panel geometry after :', after);

    const changed = Boolean(before) && Boolean(after) && before !== after;
    console.log(JSON.stringify({ passed: changed, before, after }));
    process.exitCode = changed ? 0 : 2;
  } finally {
    await app.close();
  }
})();
