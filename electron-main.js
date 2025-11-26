// electron-main.js
const { app, BrowserWindow } = require("electron");

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    autoHideMenuBar: true,
    icon: "C:\\Users\\pilot\\Desktop\\beook2pdf\\app\\favicon.ico",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // For now: load your running Next.js app on localhost:3000
  win.loadURL("http://localhost:3000");
  
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
