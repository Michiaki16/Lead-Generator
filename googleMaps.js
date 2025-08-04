const puppeteerExtra = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const cheerio = require("cheerio");

puppeteerExtra.use(StealthPlugin());

let browserMaps;
let isCancelled = false;

async function cancelScraping() {
  isCancelled = true;
  if (browserMaps) {
    await browserMaps.close();
  }
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 100;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });
}

function estimateScrapingTime(businessCount) {
  const timePerBusiness = 2; // seconds per business
  const totalMinutes = Math.ceil((businessCount * timePerBusiness) / 60);
  return Math.max(1, totalMinutes);
}

async function scrapeEmailsParallel(businesses, event) {
  const batchSize = 5;
  const batches = [];

  for (let i = 0; i < businesses.length; i += batchSize) {
    batches.push(businesses.slice(i, i + batchSize));
  }

  let processedCount = 0;

  for (const batch of batches) {
    if (isCancelled) return;

    const promises = batch.map(async (business, index) => {
      if (isCancelled) return;

      try {
        if (business.bizWebsite) {
          const page = await browserMaps.newPage();
          await page.goto(business.bizWebsite, { 
            waitUntil: "networkidle2", 
            timeout: 10000 
          });

          const content = await page.content();
          const emailMatch = content.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);

          if (emailMatch) {
            business.email = emailMatch[0];
          } else {
            business.email = "No info";
          }

          await page.close();
        } else {
          business.email = "No info";
        }
      } catch (error) {
        business.email = "No info";
      }

      processedCount++;
      event.reply("scraper-progress", { 
        current: processedCount, 
        total: businesses.length,
        business: business.storeName 
      });
    });

    await Promise.all(promises);

    // Small delay between batches
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

async function searchGoogleMaps(GOOGLE_MAPS_QUERY, event) {
  isCancelled = false;
  try {
    console.log("Launching Google Maps Puppeteer...");
    browserMaps = await puppeteerExtra.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });

    const page = await browserMaps.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(GOOGLE_MAPS_QUERY)}`, {
      waitUntil: "networkidle2",
    });

    if (isCancelled) {
      await browserMaps.close();
      return;
    }

    await autoScroll(page);

    if (isCancelled) {
      await browserMaps.close();
      return;
    }

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

    if (isCancelled) {
      await browserMaps.close();
      return;
    }

    console.log(`Found ${businesses.length} businesses. Scraping websites for emails...`);
    event.reply("scraper-status", `Found ${businesses.length} businesses. Estimating time...`);

    const estimatedTime = estimateScrapingTime(businesses.length);
    console.log(`Estimated time required: ${estimatedTime} minutes`);
    event.reply("estimated-time", estimatedTime);

    if (isCancelled) {
      await browserMaps.close();
      return;
    }

    await scrapeEmailsParallel(businesses, event);

    await browserMaps.close();

    console.log("Scraping completed, sending results to frontend...");
    event.reply("scraper-results", businesses);
    event.reply("scraper-status", "Scraping completed!");
  } catch (error) {
    console.error("Error in searchGoogleMaps:", error.message);
    event.reply("scraper-status", `Error: ${error.message}`);
    if (browserMaps) {
      await browserMaps.close();
    }
  }
}

module.exports = {
  searchGoogleMaps,
  cancelScraping
};