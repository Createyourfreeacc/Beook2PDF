// electron-main.js
const { app, BrowserWindow } = require("electron");
const path = require("path");

const isDev = process.env.NODE_ENV === "development";

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    autoHideMenuBar: true,
    icon: path.join(process.cwd(), "app", "favicon.ico"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    // During development: load localhost
    win.loadURL("http://localhost:3000");
    win.webContents.openDevTools();
  } else {
    // Production: load the Next.js build
    const startUrl = `file://${path.join(__dirname, "out", "index.html")}`;
    win.loadURL(startUrl);
  }
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
