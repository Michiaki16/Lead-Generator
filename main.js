const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { searchGoogleMaps } = require("./googleMaps"); 
const fs = require("fs");
const xlsx = require("xlsx");

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
  mainWindow.maximize();
});

ipcMain.on("run-scraper", async (event, query) => {
  try {
    await searchGoogleMaps(query, event);
  } catch (error) {
    event.reply("scraper-status", `❌ Error: ${error.message}`);
  }
});

// ✅ DEBUG: Log when the download is triggered
ipcMain.on("download-excel", (event, scrapedData) => {
  console.log("🔹 Received request to download Excel");
  console.log("🔹 Scraped Data:", scrapedData);

  if (!scrapedData || scrapedData.length === 0) {
    console.log("❌ No data available to save!");
    event.reply("download-status", "❌ No data available to download.");
    return;
  }

  try {
    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.json_to_sheet(scrapedData);
    xlsx.utils.book_append_sheet(workbook, worksheet, "ScrapedData");

    const filePath = path.join(app.getPath("desktop"), "scraped_data.xlsx");
    console.log(`✅ Saving file to: ${filePath}`);

    xlsx.writeFile(workbook, filePath);
    event.reply("download-status", `✅ File saved successfully: ${filePath}`);
  } catch (error) {
    console.log("❌ Error saving file:", error);
    event.reply("download-status", `❌ Error: ${error.message}`);
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
