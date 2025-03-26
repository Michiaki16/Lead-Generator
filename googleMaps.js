const cheerio = require("cheerio");
const puppeteerExtra = require("puppeteer-extra");
const stealthPlugin = require("puppeteer-extra-plugin-stealth");
const puppeteer = require("puppeteer-core");
const ExcelJS = require("exceljs");
const dayjs = require("dayjs");
const path = require("path");

puppeteerExtra.use(stealthPlugin());

async function searchGoogleMaps(GOOGLE_MAPS_QUERY, event) {
  try {
    console.log("Launching Google Maps Puppeteer...");
    const browserMaps = await puppeteerExtra.launch({
      headless: "new",
      executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      
    });

    const page = await browserMaps.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(GOOGLE_MAPS_QUERY)}`, {
      waitUntil: "networkidle2",
    });

    await autoScroll(page);

    const html = await page.content();
    const $ = cheerio.load(html);
    const businesses = [];

    console.log("Extracting business details...");
    $("a[href*='/maps/place/']").each((i, el) => {
      const parent = $(el).closest("div");
      const url = $(el).attr("href");
      const website = parent.find('a[data-value="Website"]').attr("href");
      const storeName = parent.find("div.fontHeadlineSmall").text();
      const address = parent.find("div.fontBodyMedium").first().text().trim();

      let rawText = parent.text();
      let phoneMatch = rawText.match(/\(?0\d{1,4}\)?[\s-]?\d{3,4}[\s-]?\d{4}|\+63\s?\d{2,3}[\s-]?\d{3}[\s-]?\d{4}/g);
      let phone = phoneMatch ? phoneMatch.join(", ") : "No information";

      businesses.push({
        storeName: storeName || "N/A",
        address: address || "Not found",
        phone: phone,
        email: "Fetching...",
        googleUrl: url || null,
        bizWebsite: website || null,
      });
    });

    console.log(`Found ${businesses.length} businesses. Scraping websites for emails...`);
    event.reply("scraper-status", `Found ${businesses.length} businesses. Estimating time...`);

    const estimatedTime = estimateScrapingTime(businesses.length);
    console.log(`Estimated time required: ${estimatedTime} minutes`);
    event.reply("scraper-status", `Estimated time required: ${estimatedTime} minutes`);

    await scrapeEmailsParallel(businesses, event);

    await browserMaps.close();

    console.log("Scraping completed, sending results to frontend...");
    event.reply("scraper-results", businesses);
    event.reply("scraper-status", "Scraping completed!");
  } catch (error) {
    console.error("Error in searchGoogleMaps:", error.message);
    event.reply("scraper-status", `Error: ${error.message}`);
  }
}

function estimateScrapingTime(businessCount) {
  const mapsScrapingTime = businessCount * 4;
  const emailScrapingTime = Math.ceil((businessCount * 15) / 5);

  const totalSeconds = mapsScrapingTime + emailScrapingTime;
  return Math.ceil(totalSeconds / 60);
}

async function saveToExcel(businesses, event) {
  try {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Leads");

    worksheet.columns = [
      { header: "Store Name", key: "storeName", width: 25 },
      { header: "Address", key: "address", width: 30 },
      { header: "Phone", key: "phone", width: 20 },
      { header: "Email", key: "email", width: 30 },
      { header: "Google Maps URL", key: "googleUrl", width: 50 },
      { header: "Website", key: "bizWebsite", width: 50 },
    ];

    businesses.forEach((biz) => {
      worksheet.addRow(biz);
    });

    const timestamp = dayjs().format("MM-DD-YYYY_hh-mm_A");
    const filePath = path.join("C:\\Users\\Lyka Mae\\Downloads", `LeadsNgIna_${timestamp}.xlsx`);

    await workbook.xlsx.writeFile(filePath);
    console.log(`Excel file saved: ${filePath}`);

    event.reply("download-status", `Data saved to ${filePath}`);
  } catch (error) {
    console.error("Error saving to Excel:", error.message);
    event.reply("download-status", `Error saving data: ${error.message}`);
  }
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    const wrapper = document.querySelector('div[role="feed"]');

    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 1000;
      const scrollDelay = 3000;

      const timer = setInterval(async () => {
        let scrollHeightBefore = wrapper.scrollHeight;
        wrapper.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= scrollHeightBefore) {
          totalHeight = 0;
          await new Promise((resolve) => setTimeout(resolve, scrollDelay));

          let scrollHeightAfter = wrapper.scrollHeight;
          if (scrollHeightAfter > scrollHeightBefore) {
            return;
          } else {
            clearInterval(timer);
            resolve();
          }
        }
      }, 200);
    });
  });
}

async function scrapeEmailsParallel(businesses, event) {
  const browser = await puppeteerExtra.launch({
    headless: "new",
    executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const batchSize = 5;
  const businessChunks = [];

  for (let i = 0; i < businesses.length; i += batchSize) {
    businessChunks.push(businesses.slice(i, i + batchSize));
  }

  for (const [index, chunk] of businessChunks.entries()) {
    console.log(`Processing batch ${index + 1} of ${businessChunks.length}...`);

    await Promise.all(
      chunk.map(async (biz) => {
        if (!biz.bizWebsite) {
          biz.email = "No information";
          return;
        }

        try {
          const page = await browser.newPage();
          await page.goto(biz.bizWebsite, {
            waitUntil: "domcontentloaded",
            timeout: 30000,
          });

          await new Promise((resolve) => setTimeout(resolve, 5000));

          const pageHtml = await page.content();
          const emailMatch = pageHtml.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);

          biz.email = emailMatch ? emailMatch[0] : "No information";

          await page.close();
        } catch (error) {
          console.error(`Error fetching details for ${biz.bizWebsite}: ${error.message}`);
          biz.email = "No information";
        }
      })
    );

    if (index < businessChunks.length - 1) {
      console.log("Waiting 15 seconds before next batch...");
      await new Promise((resolve) => setTimeout(resolve, 15000));
    }
  }

  await browser.close();
}

module.exports = { searchGoogleMaps, saveToExcel };