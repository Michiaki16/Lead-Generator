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
    event.reply("scraper-status", `Found ${businesses.length} businesses. Scraping emails...`);

    await scrapeEmails(businesses, event);

    await browserMaps.close();

    console.log("Saving data to Excel...");
    await saveToExcel(businesses, event);
    console.log("Data saved successfully!");

    event.reply("scraper-status", "Scraping completed! Data saved.");
  } catch (error) {
    console.error("Error in searchGoogleMaps:", error.message);
    event.reply("scraper-status", `Error: ${error.message}`);
  }
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

    event.reply("scraper-status", `Data saved to ${filePath}`);
  } catch (error) {
    console.error("Error saving to Excel:", error.message);
    event.reply("scraper-status", `Error saving data: ${error.message}`);
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

async function scrapeEmails(businesses, event) {
  const browser = await puppeteerExtra.launch({
    headless: "new",
    executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  for (const biz of businesses) {
    if (!biz.bizWebsite) {
      biz.email = "No information";
      continue;
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

      if (!emailMatch) {
        console.log(`Searching for contact page in ${biz.bizWebsite}...`);

        await page.waitForSelector("a", { timeout: 10000 });

        const contactLinks = await page.evaluate(() => {
          return Array.from(document.querySelectorAll("a"))
            .filter((link) => /contact|contact us/i.test(link.textContent))
            .map((link) => link.href);
        });

        if (contactLinks.length > 0) {
          console.log(`Navigating to contact page on ${contactLinks[0]}...`);
          await page.goto(contactLinks[0], { waitUntil: "domcontentloaded" });
          await new Promise((resolve) => setTimeout(resolve, 5000));

          const contactHtml = await page.content();
          const contactEmailMatch = contactHtml.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
          biz.email = contactEmailMatch ? contactEmailMatch[0] : "No information";
        } else {
          biz.email = "No information";
        }
      } else {
        biz.email = emailMatch[0];
      }

      await page.close();
    } catch (error) {
      console.error(`Error fetching details for ${biz.bizWebsite}: ${error.message}`);
      biz.email = "No information";
    }
  }

  await browser.close();
}

module.exports = { searchGoogleMaps };
