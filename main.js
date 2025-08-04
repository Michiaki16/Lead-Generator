const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const { searchGoogleMaps, cancelScraping } = require("./googleMaps"); 
const fs = require("fs");
const xlsx = require("xlsx");
const { google } = require('googleapis');

let mainWindow;
let oauth2Client;
let scrapingProcess = null;

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
    scrapingProcess = searchGoogleMaps(query, event);
    await scrapingProcess;
  } catch (error) {
    event.reply("scraper-status", `❌ Error: ${error.message}`);
  }
});

// Cancel scraper
ipcMain.on("cancel-scraper", async (event) => {
  try {
    if (scrapingProcess) {
      await cancelScraping();
      scrapingProcess = null;
      event.reply("scraper-status", "❌ Scraping cancelled by user");
    }
  } catch (error) {
    console.error("Error cancelling scraper:", error);
  }
});

// Google OAuth setup
ipcMain.on("google-auth", async (event) => {
  try {
    // Initialize OAuth2 client
    oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      'http://localhost:3000/oauth2callback'
    );

    const scopes = [
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/userinfo.email'
    ];

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
    });

    // Open auth URL in browser
    require('electron').shell.openExternal(authUrl);
  } catch (error) {
    event.reply("auth-error", error.message);
  }
});

// Send emails
ipcMain.on("send-emails", async (event, { emailData, template }) => {
  try {
    if (!oauth2Client) {
      event.reply("email-status", "❌ Please authenticate with Google first");
      return;
    }

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    let sentCount = 0;
    let totalEmails = emailData.length;

    for (const data of emailData) {
      if (data.email && data.email !== "No info") {
        try {
          // Replace template variables
          let emailContent = template
            .replace(/{companyName}/g, data.companyName)
            .replace(/{email}/g, data.email)
            .replace(/{phone}/g, data.phone)
            .replace(/{address}/g, data.address)
            .replace(/{website}/g, data.website);

          const emailLines = [
            `To: ${data.email}`,
            `Subject: Business Inquiry for ${data.companyName}`,
            '',
            emailContent
          ];

          const email = emailLines.join('\n');
          const encodedEmail = Buffer.from(email).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

          await gmail.users.messages.send({
            userId: 'me',
            requestBody: {
              raw: encodedEmail,
            },
          });

          sentCount++;
          event.reply("email-progress", { sent: sentCount, total: totalEmails });
          
          // Add delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (emailError) {
          console.error(`Failed to send email to ${data.email}:`, emailError);
        }
      }
    }

    event.reply("email-status", `✅ Successfully sent ${sentCount} emails out of ${totalEmails}`);
  } catch (error) {
    event.reply("email-status", `❌ Error sending emails: ${error.message}`);
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
