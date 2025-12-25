// electron-main.js
const { app, BrowserWindow, dialog } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const http = require("http");
const net = require("net");
const fs = require("fs");
const fsp = require("fs/promises");

const isDev = !app.isPackaged;

let serverProcess = null;
let serverPort = null;

// ------------------------
// Logging (always to file)
// ------------------------
function safeMkdirpSync(p) {
  try {
    fs.mkdirSync(p, { recursive: true });
  } catch (_) {}
}

function createFileLogger(logFilePath) {
  safeMkdirpSync(path.dirname(logFilePath));

  const write = (line) => {
    try {
      fs.appendFileSync(logFilePath, line + "\n", "utf8");
    } catch (_) {}
  };

  const log = (msg) => {
    const line = `[${new Date().toISOString()}] ${msg}`;
    write(line);
    console.log(line);
  };

  const warn = (msg) => {
    const line = `[${new Date().toISOString()}] WARN ${msg}`;
    write(line);
    console.warn(line);
  };

  const error = (msg) => {
    const line = `[${new Date().toISOString()}] ERROR ${msg}`;
    write(line);
    console.error(line);
  };

  return { log, warn, error, logFilePath };
}

function getIconPath() {
  // In packaged mode, rely on the .exe icon (recommended).
  if (app.isPackaged) return undefined;
  return path.join(process.cwd(), "app", "favicon.ico");
}

// ------------------------
// Port selection (high range)
// ------------------------
async function getAvailablePort(min = 49152, max = 65535, attempts = 50) {
  const tryPort = (port) =>
    new Promise((resolve, reject) => {
      const srv = net
        .createServer()
        .once("error", reject)
        .once("listening", () => srv.close(() => resolve(port)))
        .listen(port, "127.0.0.1");
    });

  // random ports first
  for (let i = 0; i < attempts; i++) {
    const port = Math.floor(Math.random() * (max - min + 1)) + min;
    try {
      // eslint-disable-next-line no-await-in-loop
      return await tryPort(port);
    } catch (_) {}
  }

  // fallback: small scan window
  for (let port = min; port <= Math.min(max, min + 200); port++) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await tryPort(port);
    } catch (_) {}
  }

  throw new Error(`No free port found in range ${min}-${max}`);
}

async function waitForHttpReady(url, timeoutMs = 30000) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await new Promise((resolve) => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve(res.statusCode && res.statusCode < 500);
      });
      req.on("error", () => resolve(false));
      req.setTimeout(1500, () => {
        req.destroy();
        resolve(false);
      });
    });

    if (ok) return;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 250));
  }

  throw new Error(`Next.js server did not become ready in ${timeoutMs}ms: ${url}`);
}

// ------------------------
// Puppeteer helpers
// ------------------------
async function findChromeExeUnder(dir) {
  const candidates = [];

  async function walk(p, depth = 0) {
    if (depth > 7) return;
    let entries;
    try {
      entries = await fsp.readdir(p, { withFileTypes: true });
    } catch (_) {
      return;
    }

    for (const e of entries) {
      const full = path.join(p, e.name);
      if (e.isDirectory()) {
        await walk(full, depth + 1);
      } else if (e.isFile()) {
        const lower = e.name.toLowerCase();
        if (lower === "chrome.exe" || lower === "chrome-headless-shell.exe") {
          candidates.push(full);
        }
      }
    }
  }

  await walk(dir, 0);

  const chrome = candidates.find((p) => p.toLowerCase().endsWith("chrome.exe"));
  return chrome || candidates[0] || null;
}

// ------------------------
// Writable Next runtime in userData
// ALSO copy resources/next_node_modules -> runtime/node_modules
// ------------------------
async function readText(p) {
  try {
    return await fsp.readFile(p, "utf8");
  } catch (_) {
    return null;
  }
}

async function ensureWritableNextRuntime(resourcesDir, userDataDir, log) {
  const resourcesNextDir = path.join(resourcesDir, "next");
  const resourcesNextNodeModulesDir = path.join(resourcesDir, "next_node_modules");

  const runtimeDir = path.join(userDataDir, "next-runtime");
  const markerFile = path.join(runtimeDir, ".runtime-id");

  const buildId =
    (await readText(path.join(resourcesNextDir, ".next", "BUILD_ID")))?.trim() || "";
  const runtimeId = `${app.getVersion()}|${buildId}`;

  const currentId = (await readText(markerFile))?.trim() || "";

  // if runtime matches, keep it
  if (currentId === runtimeId) return runtimeDir;

  // validate packaged resources exist
  const nextServerInResources = path.join(resourcesNextDir, "server.js");
  if (!fs.existsSync(nextServerInResources)) {
    throw new Error(`Packaged Next server missing: ${nextServerInResources}`);
  }
  if (!fs.existsSync(resourcesNextNodeModulesDir)) {
    throw new Error(
      `Packaged next_node_modules missing: ${resourcesNextNodeModulesDir}\n` +
        `Your electron-builder.yml must include extraResources for dist/desktop/next_node_modules -> next_node_modules.`
    );
  }

  log.log(`Preparing writable Next runtime in: ${runtimeDir}`);

  // recreate runtime
  await fsp.rm(runtimeDir, { recursive: true, force: true });
  await fsp.mkdir(runtimeDir, { recursive: true });

  // Copy resources/next -> runtime (dereference avoids symlink creation issues)
  await fsp.cp(resourcesNextDir, runtimeDir, {
    recursive: true,
    force: true,
    dereference: true,
  });

  // Copy resources/next_node_modules -> runtime/node_modules (REAL node_modules!)
  const runtimeNodeModules = path.join(runtimeDir, "node_modules");
  await fsp.mkdir(runtimeNodeModules, { recursive: true });

  await fsp.cp(resourcesNextNodeModulesDir, runtimeNodeModules, {
    recursive: true,
    force: true,
    dereference: true,
  });

  await fsp.writeFile(markerFile, runtimeId, "utf8");
  return runtimeDir;
}

// ------------------------
// Start Next server
// ------------------------
async function startNextServerProd(log) {
  if (serverProcess) return;

  const resourcesDir = process.resourcesPath;
  const userDataDir = app.getPath("userData");

  const runtimeNextDir = await ensureWritableNextRuntime(resourcesDir, userDataDir, log);
  const nextServerJs = path.join(runtimeNextDir, "server.js");

  const nextCacheDir = path.join(userDataDir, "next-cache");
  const tempDir = path.join(userDataDir, "temp");
  safeMkdirpSync(nextCacheDir);
  safeMkdirpSync(tempDir);

  const puppeteerCacheDir = path.join(resourcesDir, "puppeteer");
  const puppeteerExe = await findChromeExeUnder(puppeteerCacheDir);

  serverPort = await getAvailablePort(49152, 65535);

  log.log(`Starting Next server: ${nextServerJs}`);
  log.log(`cwd=${runtimeNextDir}`);
  log.log(`url=http://127.0.0.1:${serverPort}`);
  log.log(`resources=${resourcesDir}`);
  log.log(`userData=${userDataDir}`);
  log.log(`NEXT_CACHE_DIR=${nextCacheDir}`);
  log.log(`PUPPETEER_CACHE_DIR=${puppeteerCacheDir}`);
  if (puppeteerExe) log.log(`PUPPETEER_EXECUTABLE_PATH=${puppeteerExe}`);

  const env = {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(serverPort),
    HOSTNAME: "127.0.0.1",

    // your server-side code can resolve packaged assets
    BEOOK2PDF_APP_ROOT: resourcesDir,

    // writable cache/temp
    NEXT_CACHE_DIR: nextCacheDir,
    TEMP: tempDir,
    TMP: tempDir,

    // Puppeteer: use packaged cache and avoid downloads
    PUPPETEER_CACHE_DIR: puppeteerCacheDir,
    PUPPETEER_SKIP_DOWNLOAD: "1",
    ...(puppeteerExe ? { PUPPETEER_EXECUTABLE_PATH: puppeteerExe } : {}),

    NEXT_TELEMETRY_DISABLED: "1",
    ELECTRON_RUN_AS_NODE: "1",
  };

  serverProcess = spawn(process.execPath, [nextServerJs], {
    env,
    cwd: runtimeNextDir,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  serverProcess.on("error", (e) => {
    log.error(`[next] spawn error: ${String(e)}`);
  });

  if (serverProcess.stdout) {
    serverProcess.stdout.on("data", (d) => log.log(`[next:stdout] ${String(d).trimEnd()}`));
  }
  if (serverProcess.stderr) {
    serverProcess.stderr.on("data", (d) => log.error(`[next:stderr] ${String(d).trimEnd()}`));
  }

  serverProcess.on("exit", (code) => {
    log.warn(`[next] exited with code ${code}`);
    serverProcess = null;
    serverPort = null;
  });

  await waitForHttpReady(`http://127.0.0.1:${serverPort}`, 30000);
  log.log("[next] HTTP ready");
}

// ------------------------
// Window
// ------------------------
function createWindow(startUrl) {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    autoHideMenuBar: true,
    icon: getIconPath(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadURL(startUrl);
  if (isDev) win.webContents.openDevTools();
  return win;
}

// ------------------------
// Single instance + lifecycle
// ------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const wins = BrowserWindow.getAllWindows();
    if (wins.length > 0) {
      const w = wins[0];
      if (w.isMinimized()) w.restore();
      w.focus();
    }
  });

  app.whenReady().then(async () => {
    const userDataDir = app.getPath("userData");
    const logFile = path.join(userDataDir, "logs", "next-server.log");
    const log = createFileLogger(logFile);

    try {
      if (isDev) {
        log.log("Dev mode: loading http://localhost:3000");
        createWindow("http://localhost:3000");
      } else {
        await startNextServerProd(log);
        createWindow(`http://127.0.0.1:${serverPort}`);
      }
    } catch (err) {
      const msg = String(err?.stack || err);
      log.error(`Startup failure: ${msg}`);

      dialog.showErrorBox(
        "Beook2PDF could not start",
        `The app failed to start.\n\n${msg}\n\nCheck logs in:\n${path.join(
          userDataDir,
          "logs"
        )}`
      );
      app.quit();
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        const url = isDev
          ? "http://localhost:3000"
          : `http://127.0.0.1:${serverPort ?? 49152}`;
        createWindow(url);
      }
    });
  });

  app.on("before-quit", () => {
    if (serverProcess) {
      try {
        serverProcess.kill();
      } catch (_) {}
      serverProcess = null;
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
