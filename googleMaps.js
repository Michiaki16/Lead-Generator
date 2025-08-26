
const puppeteerExtra = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const cheerio = require("cheerio");
const chromeLauncher = require("chrome-launcher");
const { exec } = require("child_process");

puppeteerExtra.use(StealthPlugin());

let browserMaps;
let isCancelled = false;

async function cancelScraping() {
  isCancelled = true;
  if (browserMaps) {
    await browserMaps.close();
  }
}

async function getChromePath() {
  const installations = await chromeLauncher.Launcher.getInstallations();
  if (installations.length > 0) {
    return installations[0];
  } else {
    throw new Error("Chrome installation not found.");
  }
}

async function autoScroll(page) {
  console.log("Starting enhanced auto-scroll to load maximum results...");
  
  await page.evaluate(async () => {
    const wrapper = document.querySelector('div[role="feed"]') || 
                   document.querySelector('[role="main"]') || 
                   document.querySelector('.section-layout') ||
                   document.querySelector('[data-value="Search results"]') ||
                   document.querySelector('.section-result') ||
                   document.body;

    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 1000;
      const scrollDelay = 3000;

      const timer = setInterval(async () => {
        let scrollHeightBefore = wrapper.scrollHeight;
        
        if (wrapper && wrapper !== document.body) {
          wrapper.scrollBy(0, distance);
        } else {
          window.scrollBy(0, distance);
        }
        
        totalHeight += distance;

        // Try to click "Show more results" buttons
        const showMoreButtons = document.querySelectorAll(
          'button[jsaction*="more"], button[aria-label*="more"], button[aria-label*="More"], ' +
          '.section-loading-more-results button, button[data-value="Show more results"]'
        );
        showMoreButtons.forEach(button => {
          if (button.offsetParent !== null && button.style.display !== 'none') {
            try {
              button.click();
            } catch (e) {
              // Ignore click errors
            }
          }
        });

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
  
  console.log("Enhanced auto-scroll process completed");
}

function estimateScrapingTime(businessCount) {
  const totalBatches = Math.ceil(businessCount / 5);
  return totalBatches * 1;
}

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function scrapeEmailsParallel(businesses, event) {
  const chromePath = await getChromePath();
  const browser = await puppeteerExtra.launch({
    headless: true,
    executablePath: chromePath,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const batchSize = 5;
  const businessChunks = [];

  for (let i = 0; i < businesses.length; i += batchSize) {
    businessChunks.push(businesses.slice(i, i + batchSize));
  }

  const totalBatches = businessChunks.length;
  const estimatedTimePerBatch = 60;
  let processedCount = 0;

  for (const [index, chunk] of businessChunks.entries()) {
    if (isCancelled) break;
    
    console.log(`Processing batch ${index + 1} of ${totalBatches}...`);

    await Promise.all(
      chunk.map(async (biz) => {
        if (isCancelled) return;
        
        if (!biz.bizWebsite || !biz.bizWebsite.startsWith("http")) {
          biz.email = "No information";
          processedCount++;
          event.reply("scraper-progress", { 
            current: processedCount, 
            total: businesses.length,
            business: biz.storeName 
          });
          return;
        }

        try {
          const page = await browser.newPage();
          await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
          
          await page.goto(biz.bizWebsite, {
            waitUntil: "networkidle2",
            timeout: 120000,
          });
          await delay(3000);
          
          const pageHtml = await page.content();

          // Enhanced email regex including obfuscated emails
          const emailMatches = pageHtml.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|[a-zA-Z0-9._%+-]+\s?\[at\]\s?[a-zA-Z0-9.-]+\s?\[dot\]\s?[a-zA-Z]{2,}/g);
          
          if (emailMatches) {
            const normalizedEmails = emailMatches.map((email) =>
              email.replace(/\[at\]/g, "@").replace(/\[dot\]/g, ".").toLowerCase()
            );
            
            // Filter out invalid emails
            const validEmails = normalizedEmails.filter(email => {
              return email.length > 5 && 
                     email.length < 60 &&
                     email.includes('@') &&
                     email.includes('.') &&
                     !email.includes('noreply') && 
                     !email.includes('no-reply') &&
                     !email.includes('donotreply') &&
                     !email.includes('example.com') &&
                     !email.includes('test@') &&
                     !email.includes('sample@') &&
                     !email.includes('placeholder') &&
                     !email.includes('your-email') &&
                     !email.includes('youremail') &&
                     !email.includes('email@domain') &&
                     !email.includes('name@domain') &&
                     !email.includes('user@example');
            });
            
            if (validEmails.length > 0) {
              const domain = new URL(biz.bizWebsite).hostname.replace("www.", "");
              const prioritizedEmail = validEmails.find((email) => email.includes(domain)) || validEmails[0];
              biz.email = prioritizedEmail;
            } else {
              biz.email = await searchContactPages(page, biz);
            }
          } else {
            biz.email = await searchContactPages(page, biz);
          }

          await page.close();
        } catch (error) {
          console.error(`Error scraping email for ${biz.storeName}:`, error.message);
          biz.email = "No information";
        }

        processedCount++;
        event.reply("scraper-progress", { 
          current: processedCount, 
          total: businesses.length,
          business: biz.storeName 
        });
      })
    );

    const batchesRemaining = totalBatches - (index + 1);
    const secondsLeft = batchesRemaining * estimatedTimePerBatch;
    const minutesLeft = Math.floor(secondsLeft / 60);
    const extraSeconds = secondsLeft % 60;

    event.reply(
      "scraper-status",
      `Batch ${index + 1}/${totalBatches} completed. Estimated time left: ${minutesLeft}m ${extraSeconds}s`
    );

    if (index < totalBatches - 1) {
      await delay(60000);
    }
  }

  await browser.close();
}

async function searchContactPages(page, biz) {
  try {
    // Look for contact and about page links
    const links = await page.$$eval("a", (anchors) =>
      anchors.map((a) => ({
        href: a.href,
        text: a.textContent.toLowerCase()
      })).filter((link) => {
        const href = link.href.toLowerCase();
        const text = link.text;
        return (text.includes("contact") || 
               text.includes("about") ||
               text.includes("reach") ||
               text.includes("get in touch") ||
               href.includes("contact") ||
               href.includes("about") ||
               href.includes("/contact-us") ||
               href.includes("/contact-me") ||
               href.includes("/about-us")) &&
               link.href.startsWith("http");
      }).map(link => link.href).slice(0, 3)
    );

    for (const link of links) {
      try {
        await page.goto(link, { 
          waitUntil: "networkidle2", 
          timeout: 120000 
        });
        await delay(2000);
        
        const contactPageHtml = await page.content();
        const contactEmailMatches = contactPageHtml.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
        
        if (contactEmailMatches) {
          const validContactEmails = contactEmailMatches.filter(email => {
            const lowerEmail = email.toLowerCase();
            return email.length > 5 && 
                   email.length < 60 &&
                   !lowerEmail.includes('noreply') && 
                   !lowerEmail.includes('no-reply') &&
                   !lowerEmail.includes('donotreply') &&
                   !lowerEmail.includes('example.com') &&
                   !lowerEmail.includes('test@') &&
                   !lowerEmail.includes('sample@');
          });
          
          if (validContactEmails.length > 0) {
            return validContactEmails[0];
          }
        }
      } catch (e) {
        console.log(`Failed to load contact/about page: ${link}`);
      }
    }

    return "No information";
  } catch (error) {
    console.log(`Error searching contact pages for ${biz.storeName}`);
    return "No information";
  }
}

async function searchGoogleMaps(GOOGLE_MAPS_QUERY, event) {
  isCancelled = false;
  try {
    console.log("Launching Google Maps Puppeteer...");
    const chromePath = await getChromePath();
    
    browserMaps = await puppeteerExtra.launch({
      headless: true,
      executablePath: chromePath,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      protocolTimeout: 300000,
    });

    const page = await browserMaps.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    page.setDefaultTimeout(300000);
    page.setDefaultNavigationTimeout(60000);

    await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(GOOGLE_MAPS_QUERY)}`, {
      waitUntil: "networkidle2",
    });

    if (isCancelled) {
      await browserMaps.close();
      return;
    }

    event.reply("scraper-status", "Scrolling to load all available results...");
    await autoScroll(page);

    if (isCancelled) {
      await browserMaps.close();
      return;
    }
    
    const businessCount = await page.evaluate(() => {
      return document.querySelectorAll("a[href*='/maps/place/']").length;
    });
    
    console.log(`Scrolling completed. Found ${businessCount} potential businesses to extract.`);
    event.reply("scraper-status", `Scrolling completed. Found ${businessCount} businesses. Extracting data...`);

    const html = await page.content();
    const $ = cheerio.load(html);
    const businesses = [];

    console.log("Extracting business details...");
    $("a[href*='/maps/place/']").each((i, el) => {
      const parent = $(el).closest("div");
      const url = $(el).attr("href");
      
      let website = parent.find('a[data-value="Website"]').attr("href");
      if (!website) {
        website = parent.find('a[href^="http"]:not([href*="google.com"]):not([href*="maps"]):not([href*="goo.gl"])').first().attr("href");
      }
      
      const storeName = parent.find("div.fontHeadlineSmall").text();
      const address = parent.find("div.fontBodyMedium").first().text().trim();

      let rawText = parent.text();
      let phoneMatch = rawText.match(/(\+?\d{1,4}[-.\s]?)?\(?\d{3,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}|\+63\s?\d{2,3}[\s-]?\d{3}[\s-]?\d{4}|\(\d{3}\)\s?\d{3}-\d{4}/g);
      let phone = phoneMatch ? phoneMatch.join(", ") : "No information";

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
