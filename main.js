const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { searchGoogleMaps } = require("./googleMaps"); // Import the function

let mainWindow;

app.whenReady().then(() => {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    icon: path.join(__dirname, "/src/img/bcdq.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: true, 
      contextIsolation: false, 
    },
  });

  mainWindow.loadFile("index.html");
});

ipcMain.on("run-scraper", async (event, query) => {
  try {
    await searchGoogleMaps(query, event);
  } catch (error) {
    event.reply("scraper-status", `❌ Error: ${error.message}`);
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
