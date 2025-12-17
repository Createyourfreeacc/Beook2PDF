// electron-main.js
const path = require("path");
const fs = require("fs");
const { app, BrowserWindow } = require("electron");

function resolveFirstExistingPath(candidates) {
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch {
      // ignore
    }
  }
  return undefined;
}

function getStartUrlFromConfig() {
  try {
    const configPath = path.join(process.cwd(), "config.json");
    if (!fs.existsSync(configPath)) return undefined;

    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);

    if (parsed && typeof parsed.startUrl === "string" && parsed.startUrl.trim()) {
      return parsed.startUrl.trim();
    }
  } catch {
    // ignore config errors and fall back to defaults/env
  }
  return undefined;
}

function createWindow() {
  const iconPath = resolveFirstExistingPath([
    // Dev: repo-relative
    path.join(__dirname, "app", "favicon.ico"),
    // Packaged: next to app code
    path.join(app.getAppPath(), "app", "favicon.ico"),
    // Packaged (common): resources folder
    path.join(process.resourcesPath, "app", "favicon.ico"),
  ]);

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    autoHideMenuBar: true,
    icon: iconPath,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Resolve start URL in this order:
  // 1) BEOOK2PDF_START_URL environment variable
  // 2) config.json "startUrl" (if present)
  // 3) Fallback to Next.js dev server http://localhost:3000
  const startUrl =
    process.env.BEOOK2PDF_START_URL ||
    getStartUrlFromConfig() ||
    "http://localhost:3000";
  win.loadURL(startUrl);
  
  // Uncomment if you want devtools:
  // win.webContents.openDevTools();
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
