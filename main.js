const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const { searchGoogleMaps, cancelScraping } = require("./googleMaps");
const fs = require("fs");
const xlsx = require("xlsx");
const { google } = require("googleapis");
const http = require("http");
const url = require("url");
const EmailDatabase = require("./database");

let mainWindow;
let oauth2Client = null;
let authServer = null; // Track the OAuth server
let scrapingProcess = null;
let emailSendingProcess = null;
let userProfile = null;
let emailDB = null;
let activeTimeouts = new Set();
let currentEmailController = null;

app.whenReady().then(() => {
  emailDB = new EmailDatabase();

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
  mainWindow.setMenuBarVisibility(false);
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

oauth2Client = new google.auth.OAuth2(
  (process.env.GOOGLE_CLIENT_ID =
    "82150396052-rnvsou8p8gp54cf235gc59eagtcgie9n.apps.googleusercontent.com"),
  (process.env.GOOGLE_CLIENT_SECRET = "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"),
  "http://localhost:3000/oauth2callback"
);

ipcMain.on("google-auth", async (event) => {
  try {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      throw new Error("Google credentials not configured");
    }

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: [
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/userinfo.profile",
        "https://www.googleapis.com/auth/userinfo.email",
      ],
      prompt: "consent select_account",
    });

    // Close previous server if still running
    if (authServer) {
      try {
        authServer.close();
      } catch (e) {}
      authServer = null;
    }

    authServer = http.createServer(async (req, res) => {
      const { code } = url.parse(req.url, true).query;

      if (code) {
        try {
          const { tokens } = await oauth2Client.getToken(code);
          oauth2Client.setCredentials(tokens);

          const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
          const { data: userInfo } = await oauth2.userinfo.get();
          userProfile = userInfo;

          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(`
  <html>
    <head>
      <title>Authentication Successful</title>
      <style>
        body {
          background: linear-gradient(135deg, #43cea2 0%, #185a9d 100%);
          color: #fff;
          font-family: Arial, sans-serif;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100vh;
          margin: 0;
        }
        .container {
          background: rgba(0,0,0,0.3);
          padding: 40px 30px;
          border-radius: 16px;
          box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.37);
          text-align: center;
        }
        h1 {
          font-size: 2.2em;
          margin-bottom: 10px;
        }
        p {
          font-size: 1.2em;
        }
        .close-btn {
          margin-top: 25px;
          padding: 10px 24px;
          background: #43cea2;
          color: #fff;
          border: none;
          border-radius: 8px;
          font-size: 1em;
          cursor: pointer;
          transition: background 0.2s;
        }
        .close-btn:hover {
          background: #185a9d;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>✅ Authentication Successful!</h1>
        <p>You can now close this window and return to the app.</p>
        <button class="close-btn" onclick="window.close()">Close</button>
      </div>
    </body>
  </html>
`);

          event.reply("auth-success", userProfile);
          authServer.close();
        } catch (error) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end("<h1>Authentication failed. Please try again.</h1>");
          event.reply("auth-error", error.message);
          authServer.close();
        }
      }
    });

    const { exec } = require("child_process");
    const chromePath =
      '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"'; // Default Chrome path
    authServer.listen(3000, () => {
      exec(`${chromePath} "${authUrl}"`, (error) => {
        if (error) {
          // Fallback to default browser if Chrome is not found
          shell.openExternal(authUrl);
        }
      });
    });
  } catch (error) {
    event.reply("auth-error", error.message);
  }
});

// Email sending with rate limiting and retry logic
async function sendEmailWithRetry(
  gmail,
  emailData,
  templateData,
  maxRetries = 3,
  baseDelay = 5000
) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      let emailContent = templateData.body
        .replace(/{companyName}/g, emailData.companyName || "")
        .replace(/{email}/g, emailData.email || "")
        .replace(/{phone}/g, emailData.phone || "")
        .replace(/{address}/g, emailData.address || "")
        .replace(/{website}/g, emailData.website || "");

      const emailSubjectProcessed = templateData.subject
        .replace(/{companyName}/g, emailData.companyName || "")
        .replace(/{email}/g, emailData.email || "")
        .replace(/{phone}/g, emailData.phone || "")
        .replace(/{address}/g, emailData.address || "")
        .replace(/{website}/g, emailData.website || "");

      // Remove subject from email content if it appears at the beginning
      if (emailContent.trim().startsWith(emailSubjectProcessed)) {
        emailContent = emailContent.replace(emailSubjectProcessed, '').trim();
      }

      // Convert plain text to HTML with proper formatting
      const htmlContent = emailContent
        .replace(/\n/g, "<br>")
        .replace(/\r\n/g, "<br>")
        .replace(/\r/g, "<br>");

      // Add email footer
      const footerImagePath = path.join(__dirname, "src/img/Emailfooter2.jpg");
      let footerImage = "";

      try {
        const footerImageBuffer = fs.readFileSync(footerImagePath);
        const footerImageBase64 = footerImageBuffer.toString("base64");
        footerImage = `<br><br><div style="margin-top: 20px;"><img src="data:image/jpeg;base64,${footerImageBase64}" alt="Email Footer" style="max-width: 300px; height: auto;"></div>`;
      } catch (error) {
        console.log("Footer image not found, continuing without footer");
      }

      const fullHtmlContent = `
        <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0;">
          <div style="max-width: 800px; padding: 20px; background-color: #ffffff;">
            <div style="text-align: left; margin-bottom: 20px;">
              ${htmlContent}
            </div>
            ${footerImage}
          </div>
        </body>
        </html>`;

      const emailMessage = [
        `To: ${emailData.email}`,
        `Subject: ${emailSubjectProcessed}`,
        `Content-Type: text/html; charset="UTF-8"`,
        `MIME-Version: 1.0`,
        "",
        fullHtmlContent,
      ].join("\r\n");

      const encodedEmail = Buffer.from(emailMessage)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

      await gmail.users.messages.send({
        userId: "me",
        requestBody: { raw: encodedEmail },
      });

      return { success: true, subject: emailSubjectProcessed };
    } catch (error) {
      if (
        error.message.includes("Too many concurrent requests") &&
        attempt < maxRetries
      ) {
        const delay = baseDelay * Math.pow(2, attempt - 1); // Exponential backoff
        console.log(
          `Rate limit hit for ${emailData.email}, retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
}

ipcMain.on("send-emails", async (event, { emailData, template, subject }) => {
  try {
    if (!oauth2Client || !oauth2Client.credentials) {
      event.reply("email-status", "❌ Please authenticate with Google first");
      return;
    }

    emailSendingProcess = true;
    const gmail = google.gmail({ version: "v1", auth: oauth2Client });
    let sentCount = 0;
    let failedCount = 0;
    const validEmails = emailData.filter((data) => {
      // Basic email validation
      const email = data.email;
      return (
        email &&
        email !== "No info" &&
        email !== "Fetching..." &&
        email.includes("@") &&
        email.includes(".") &&
        !email.match(/^\d+$/) && // Not just numbers
        email.length > 5
      );
    });
    const totalEmails = validEmails.length;

    // Calculate and display estimated time
    const averageDelayPerEmail = 4.5; // seconds (3-5 seconds random delay + processing)
    const estimatedTotalSeconds = totalEmails * averageDelayPerEmail;
    const estimatedMinutes = Math.floor(estimatedTotalSeconds / 60);
    const estimatedSecondsRemainder = Math.floor(estimatedTotalSeconds % 60);
    
    let timeEstimateText = "";
    if (estimatedMinutes > 0) {
      timeEstimateText = ` - Est. time: ${estimatedMinutes}m ${estimatedSecondsRemainder}s`;
    } else {
      timeEstimateText = ` - Est. time: ${Math.floor(estimatedTotalSeconds)}s`;
    }

    event.reply(
      "email-status",
      `📧 Sending ${totalEmails} emails with rate limiting${timeEstimateText}`
    );

    // Prepare template data with subject and body
    const templateData = {
      subject: subject || "PRU LIFE UK FINANCIAL WELLNESS AND RETIREMENT PROGRAM PROPOSAL",
      body: template
    };

    for (const [index, data] of validEmails.entries()) {
      if (!emailSendingProcess) {
        event.reply("email-status", "❌ Email sending cancelled by user");
        return;
      }

      try {
        const result = await sendEmailWithRetry(gmail, data, templateData);

        if (result.success) {
          // Save to database
          try {
            await emailDB.addSentEmail({
              companyName: data.companyName,
              email: data.email,
              phone: data.phone,
              address: data.address,
              website: data.website,
              subject: result.subject,
            });
          } catch (dbError) {
            console.error("Error saving to database:", dbError);
          }

          sentCount++;
          console.log(`✅ Email sent successfully to ${data.email}`);
        }

        event.reply("email-progress", {
          sent: sentCount,
          total: totalEmails,
          current: data.companyName,
        });

        // Rate limiting: Wait between emails (increased from 1.5s to 3s)
        const delayTime = 3000 + Math.random() * 2000; // 3-5 seconds random delay
        await new Promise((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            activeTimeouts.delete(timeoutId);
            resolve();
          }, delayTime);
          activeTimeouts.add(timeoutId);
        });
      } catch (emailError) {
        failedCount++;
        console.error(
          `❌ Failed to send email to ${data.email}:`,
          emailError.message
        );

        // Longer delay after failures
        await new Promise((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            activeTimeouts.delete(timeoutId);
            resolve();
          }, 5000);
          activeTimeouts.add(timeoutId);
        });
      }
    }

    emailSendingProcess = false;
    event.reply(
      "email-status",
      `✅ Email sending complete! Sent: ${sentCount}, Failed: ${failedCount}`
    );
  } catch (error) {
    emailSendingProcess = false;
    event.reply("email-status", `❌ Error sending emails: ${error.message}`);
  }
});

ipcMain.on("cancel-emails", (event) => {
  if (emailSendingProcess) {
    emailSendingProcess = false;
    
    // Clear all active timeouts immediately
    console.log(`Clearing ${activeTimeouts.size} active timeouts`);
    for (const timeoutId of activeTimeouts) {
      clearTimeout(timeoutId);
    }
    activeTimeouts.clear();
    
    // Abort any ongoing Gmail API requests
    if (currentEmailController) {
      currentEmailController.abort();
      currentEmailController = null;
    }
    
    event.reply("email-status", "❌ Email sending cancelled by user");
    console.log("Email sending process cancelled by user - all timers cleared");
  }
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

    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
    const filePath = path.join(
      app.getPath("desktop"),
      `LeadsData_${timestamp}.xlsx`
    );

    xlsx.writeFile(workbook, filePath);
    event.reply("download-status", `✅ File saved: ${filePath}`);
  } catch (error) {
    event.reply("download-status", `❌ Error: ${error.message}`);
  }
});

// Database IPC handlers
ipcMain.handle("get-sent-emails", async () => {
  try {
    return await emailDB.getAllSentEmails();
  } catch (error) {
    console.error("Error getting sent emails:", error);
    return [];
  }
});

ipcMain.handle("check-email-sent", async (event, emailAddress) => {
  try {
    return await emailDB.checkIfEmailSent(emailAddress);
  } catch (error) {
    console.error("Error checking email:", error);
    return false;
  }
});

ipcMain.handle("delete-email-record", async (event, id) => {
  try {
    return await emailDB.deleteEmailRecord(id);
  } catch (error) {
    console.error("Error deleting email record:", error);
    throw error;
  }
});

ipcMain.handle("clear-all-email-history", async (event) => {
  try {
    return await emailDB.clearAllEmails();
  } catch (error) {
    console.error("Error clearing email history:", error);
    throw error;
  }
});

app.on("window-all-closed", () => {
  // Cancel all email processes and clear timeouts
  emailSendingProcess = false;
  console.log(`App closing - clearing ${activeTimeouts.size} active timeouts`);
  for (const timeoutId of activeTimeouts) {
    clearTimeout(timeoutId);
  }
  activeTimeouts.clear();
  
  if (currentEmailController) {
    currentEmailController.abort();
    currentEmailController = null;
  }
  
  if (emailDB) {
    emailDB.close();
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Also handle app quit event for additional safety
app.on("before-quit", () => {
  // Force stop all email processes
  emailSendingProcess = false;
  console.log(`Before quit - clearing ${activeTimeouts.size} active timeouts`);
  for (const timeoutId of activeTimeouts) {
    clearTimeout(timeoutId);
  }
  activeTimeouts.clear();
  
  if (currentEmailController) {
    currentEmailController.abort();
    currentEmailController = null;
  }
  
  console.log("App quitting - all email processes cancelled");
});
