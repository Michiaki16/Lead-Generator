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

    const promises = batch.map(async (business) => {
      if (isCancelled) return;

      let page = null;
      try {
        // First try to get email from Google Maps URL if no website is available
        let websiteUrl = business.bizWebsite;
        
        if (!websiteUrl && business.googleUrl) {
          // Extract website from Google Maps page
          page = await browserMaps.newPage();
          await page.goto(business.googleUrl, { 
            waitUntil: "networkidle2", 
            timeout: 15000 
          });
          
          // Look for website link on Google Maps page
          const websiteLink = await page.evaluate(() => {
            const websiteButton = document.querySelector('a[data-value="Website"]');
            return websiteButton ? websiteButton.href : null;
          });
          
          if (websiteLink) {
            websiteUrl = websiteLink;
            business.bizWebsite = websiteLink; // Update the business object
          }
          
          await page.close();
          page = null;
        }

        if (websiteUrl) {
          page = await browserMaps.newPage();
          
          // Set user agent to avoid blocking
          await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
          
          await page.goto(websiteUrl, { 
            waitUntil: "domcontentloaded", 
            timeout: 15000 
          });

          // Wait a bit for dynamic content to load
          await page.waitForTimeout(2000);

          // Enhanced email extraction
          const emailData = await page.evaluate(() => {
            const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
            const text = document.body.innerText;
            const html = document.body.innerHTML;
            
            // Find emails in text content
            const textEmails = text.match(emailRegex) || [];
            
            // Find emails in HTML (including mailto links)
            const mailtoLinks = Array.from(document.querySelectorAll('a[href*="mailto:"]'))
              .map(link => link.href.replace('mailto:', '').split('?')[0]);
            
            // Find emails in HTML content
            const htmlEmails = html.match(emailRegex) || [];
            
            // Combine and deduplicate emails
            const allEmails = [...new Set([...textEmails, ...mailtoLinks, ...htmlEmails])];
            
            // Filter out common non-business emails and prioritize contact/info emails
            const filteredEmails = allEmails.filter(email => {
              const lowerEmail = email.toLowerCase();
              return !lowerEmail.includes('noreply') && 
                     !lowerEmail.includes('no-reply') &&
                     !lowerEmail.includes('donotreply') &&
                     !lowerEmail.includes('example.com') &&
                     email.length < 50; // Avoid very long emails which might be false positives
            });
            
            // Prioritize business-relevant emails
            const priorityEmails = filteredEmails.filter(email => {
              const lowerEmail = email.toLowerCase();
              return lowerEmail.includes('info') || 
                     lowerEmail.includes('contact') || 
                     lowerEmail.includes('hello') ||
                     lowerEmail.includes('admin') ||
                     lowerEmail.includes('support');
            });
            
            return priorityEmails.length > 0 ? priorityEmails[0] : (filteredEmails.length > 0 ? filteredEmails[0] : null);
          });

          business.email = emailData || "No info";
          await page.close();
          page = null;
        } else {
          business.email = "No info";
        }
      } catch (error) {
        console.error(`Error scraping email for ${business.storeName}:`, error.message);
        business.email = "No info";
        
        if (page) {
          try {
            await page.close();
          } catch (closeError) {
            console.error("Error closing page:", closeError.message);
          }
        }
      }

      processedCount++;
      event.reply("scraper-progress", { 
        current: processedCount, 
        total: businesses.length,
        business: business.storeName 
      });
    });

    await Promise.all(promises);

    // Delay between batches to avoid overwhelming servers
    await new Promise(resolve => setTimeout(resolve, 2000));
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
      
      // More comprehensive website extraction
      let website = parent.find('a[data-value="Website"]').attr("href");
      if (!website) {
        // Look for other potential website links
        website = parent.find('a[href^="http"]:not([href*="google.com"]):not([href*="maps"]):not([href*="goo.gl"])').first().attr("href");
      }
      
      const storeName = parent.find("div.fontHeadlineSmall").text();
      const address = parent.find("div.fontBodyMedium").first().text().trim();

      let rawText = parent.text();
      // Enhanced phone number regex to catch more formats
      let phoneMatch = rawText.match(/(\+?\d{1,4}[-.\s]?)?\(?\d{3,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}|\+63\s?\d{2,3}[\s-]?\d{3}[\s-]?\d{4}|\(\d{3}\)\s?\d{3}-\d{4}/g);
      let phone = phoneMatch ? phoneMatch.join(", ") : "No information";

      // Only add businesses with valid names
      if (storeName && storeName.trim().length > 0) {
        businesses.push({
          storeName: storeName.trim(),
          address: address || "Not found",
          phone: phone,
          email: "Fetching...",
          googleUrl: url ? `https://www.google.com${url}` : null,
          bizWebsite: website || null,
        });
      }
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