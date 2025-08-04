
const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const { searchGoogleMaps, cancelScraping } = require("./googleMaps"); 
const fs = require("fs");
const xlsx = require("xlsx");
const { google } = require('googleapis');
const http = require('http');
const url = require('url');

let mainWindow;
let oauth2Client;
let scrapingProcess = null;
let emailSendingProcess = null;
let userProfile = null;

app.whenReady().then(() => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, "/src/img/bcdq.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false, 
      contextIsolation: true, 
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

ipcMain.on("google-auth", async (event) => {
  try {
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

    const server = http.createServer(async (req, res) => {
      const queryObject = url.parse(req.url, true).query;
      
      if (queryObject.code) {
        try {
          const { tokens } = await oauth2Client.getAccessToken(queryObject.code);
          oauth2Client.setCredentials(tokens);
          
          const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
          const userInfo = await oauth2.userinfo.get();
          userProfile = userInfo.data;
          
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<h1>Authentication successful! You can close this window.</h1>');
          
          event.reply("auth-success", userProfile);
          server.close();
        } catch (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<h1>Authentication failed. Please try again.</h1>');
          event.reply("auth-error", error.message);
          server.close();
        }
      }
    });

    server.listen(3000, () => {
      shell.openExternal(authUrl);
    });
  } catch (error) {
    event.reply("auth-error", error.message);
  }
});

ipcMain.on("send-emails", async (event, { emailData, template }) => {
  try {
    if (!oauth2Client || !oauth2Client.credentials) {
      event.reply("email-status", "❌ Please authenticate with Google first");
      return;
    }

    emailSendingProcess = true;
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    let sentCount = 0;
    let failedCount = 0;
    const validEmails = emailData.filter(data => data.email && data.email !== "No info" && data.email !== "Fetching...");
    const totalEmails = validEmails.length;

    event.reply("email-status", `📧 Starting to send ${totalEmails} emails...`);

    for (const data of validEmails) {
      if (!emailSendingProcess) {
        event.reply("email-status", "❌ Email sending cancelled by user");
        return;
      }

      try {
        let emailContent = template
          .replace(/{companyName}/g, data.companyName || "")
          .replace(/{email}/g, data.email || "")
          .replace(/{phone}/g, data.phone || "")
          .replace(/{address}/g, data.address || "")
          .replace(/{website}/g, data.website || "");

        const emailMessage = [
          `To: ${data.email}`,
          `Subject: Business Inquiry for ${data.companyName}`,
          `Content-Type: text/html; charset="UTF-8"`,
          '',
          emailContent
        ].join('\n');

        const encodedEmail = Buffer.from(emailMessage)
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');

        await gmail.users.messages.send({
          userId: 'me',
          requestBody: { raw: encodedEmail }
        });

        sentCount++;
        event.reply("email-progress", { sent: sentCount, total: totalEmails, current: data.companyName });
        
        await new Promise(resolve => setTimeout(resolve, 1500));
      } catch (emailError) {
        failedCount++;
        console.error(`Failed to send email to ${data.email}:`, emailError.message);
      }
    }

    emailSendingProcess = false;
    event.reply("email-status", `✅ Email sending complete! Sent: ${sentCount}, Failed: ${failedCount}`);
  } catch (error) {
    emailSendingProcess = false;
    event.reply("email-status", `❌ Error sending emails: ${error.message}`);
  }
});

ipcMain.on("cancel-emails", (event) => {
  emailSendingProcess = false;
  event.reply("email-status", "❌ Email sending cancelled by user");
});

ipcMain.on("download-excel", (event, scrapedData) => {
  if (!scrapedData || scrapedData.length === 0) {
    event.reply("download-status", "❌ No data available to download.");
    return;
  }

  try {
    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.json_to_sheet(scrapedData);
    xlsx.utils.book_append_sheet(workbook, worksheet, "ScrapedData");

    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const filePath = path.join(app.getPath("desktop"), `LeadsData_${timestamp}.xlsx`);

    xlsx.writeFile(workbook, filePath);
    event.reply("download-status", `✅ File saved: ${filePath}`);
  } catch (error) {
    event.reply("download-status", `❌ Error: ${error.message}`);
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
