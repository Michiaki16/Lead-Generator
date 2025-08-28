
const puppeteerExtra = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const cheerio = require("cheerio");
const chromeLauncher = require("chrome-launcher");
const { exec } = require("child_process");
const emailUtils = require("./email-enhancement");

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
          
          // Retry mechanism for page loading
          let pageLoaded = false;
          for (let retry = 0; retry < 3; retry++) {
            try {
              await page.goto(biz.bizWebsite, {
                waitUntil: "networkidle2",
                timeout: 60000,
              });
              pageLoaded = true;
              break;
            } catch (pageError) {
              console.log(`Retry ${retry + 1} for ${biz.storeName}: ${pageError.message}`);
              if (retry < 2) await delay(2000);
            }
          }
          
          if (!pageLoaded) {
            throw new Error('Failed to load page after 3 attempts');
          }
          
          await delay(2000);
          
          const pageHtml = await page.content();

          // Extract emails using multiple patterns
          let allEmailMatches = [];
          for (const pattern of emailUtils.emailPatterns) {
            const matches = pageHtml.match(pattern) || [];
            allEmailMatches.push(...matches);
          }
          
          // Also search in page text content (visible text)
          const pageText = await page.evaluate(() => document.body.innerText || '');
          for (const pattern of emailUtils.emailPatterns) {
            const textMatches = pageText.match(pattern) || [];
            allEmailMatches.push(...textMatches);
          }
          
          if (allEmailMatches.length > 0) {
            // Normalize and validate all found emails
            const processedEmails = [];
            
            for (const email of allEmailMatches) {
              const normalizedEmail = emailUtils.normalizeEmail(email);
              const validation = emailUtils.validateEmail(normalizedEmail);
              
              if (validation.isValid) {
                processedEmails.push({
                  email: validation.email,
                  priority: validation.priority
                });
              }
            }
            
            // Remove duplicates and sort by priority
            const uniqueEmails = processedEmails.filter((item, index, self) => 
              index === self.findIndex(t => t.email === item.email)
            ).sort((a, b) => b.priority - a.priority);
            
            const validEmails = uniqueEmails.map(item => item.email);
            
              if (validEmails.length > 0) {
              const domain = new URL(biz.bizWebsite).hostname.replace("www.", "");
              const prioritizedEmail = validEmails.find((email) => email.includes(domain)) || validEmails[0];
              biz.email = prioritizedEmail;
              biz.allEmails = validEmails.slice(0, 3); // Store up to 3 emails for reference
              biz.emailSource = 'website_content';
            } else {
              const contactEmail = await searchContactPagesEnhanced(page, biz);
              biz.email = contactEmail;
              biz.emailSource = contactEmail.includes('(estimated)') ? 'estimated' : 'contact_page';
            }
          } else {
            const contactEmail = await searchContactPagesEnhanced(page, biz);
            biz.email = contactEmail;
            biz.emailSource = contactEmail.includes('(estimated)') ? 'estimated' : 'fallback';
          }

          await page.close();
        } catch (error) {
          console.error(`Error scraping email for ${biz.storeName}:`, error.message);
          
          // Final fallback: try to generate common email patterns
          if (biz.bizWebsite) {
            try {
              const domain = new URL(biz.bizWebsite).hostname.replace('www.', '');
              biz.email = `info@${domain} (estimated)`;
              biz.emailSource = 'domain_guess';
            } catch (e) {
              biz.email = "No information";
              biz.emailSource = 'failed';
            }
          } else {
            biz.email = "No information";
            biz.emailSource = 'no_website';
          }
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

async function searchContactPagesEnhanced(page, biz) {
  try {
    // Enhanced link detection for contact, about, team, and leadership pages
    const links = await page.$$eval("a", (anchors) =>
      anchors.map((a) => ({
        href: a.href,
        text: a.textContent.toLowerCase(),
        title: a.title ? a.title.toLowerCase() : ''
      })).filter((link) => {
        const href = link.href.toLowerCase();
        const text = link.text;
        const title = link.title;
        
        // Expanded search patterns for pages likely to contain emails
        const contactPatterns = [
          'contact', 'about', 'reach', 'get in touch', 'connect',
          'team', 'staff', 'leadership', 'management', 'directors',
          'our team', 'meet the team', 'who we are', 'our story',
          'headquarters', 'office', 'location', 'branch',
          'support', 'help', 'customer service', 'inquiry',
          'sales', 'business', 'partnership', 'collaborate'
        ];
        
        const urlPatterns = [
          '/contact', '/about', '/team', '/staff', '/leadership',
          '/management', '/our-team', '/meet-team', '/who-we-are',
          '/office', '/location', '/branch', '/support', '/help',
          '/sales', '/business', '/partnership', '/connect'
        ];
        
        // Check text, title, and href for patterns
        const hasContactPattern = contactPatterns.some(pattern => 
          text.includes(pattern) || title.includes(pattern)
        );
        
        const hasUrlPattern = urlPatterns.some(pattern => 
          href.includes(pattern)
        );
        
        return (hasContactPattern || hasUrlPattern) && 
               link.href.startsWith("http") &&
               !href.includes('facebook.com') &&
               !href.includes('twitter.com') &&
               !href.includes('instagram.com') &&
               !href.includes('linkedin.com/company');
      }).map(link => link.href).slice(0, 5) // Increased to 5 pages
    );

    // Try each contact page
    for (const link of links) {
      try {
        await page.goto(link, { 
          waitUntil: "networkidle2", 
          timeout: 60000 
        });
        await delay(1500);
        
        // Extract emails from both HTML and visible text
        const contactPageHtml = await page.content();
        const contactPageText = await page.evaluate(() => document.body.innerText || '');
        
        let allContactEmails = [];
        
        // Use enhanced email patterns
        for (const pattern of emailUtils.emailPatterns) {
          const htmlMatches = contactPageHtml.match(pattern) || [];
          const textMatches = contactPageText.match(pattern) || [];
          allContactEmails.push(...htmlMatches, ...textMatches);
        }
        
        if (allContactEmails.length > 0) {
          // Process and validate emails
          const processedEmails = [];
          
          for (const email of allContactEmails) {
            const normalizedEmail = emailUtils.normalizeEmail(email);
            const validation = emailUtils.validateEmail(normalizedEmail);
            
            if (validation.isValid) {
              processedEmails.push({
                email: validation.email,
                priority: validation.priority
              });
            }
          }
          
          // Remove duplicates and sort by priority
          const uniqueEmails = processedEmails.filter((item, index, self) => 
            index === self.findIndex(t => t.email === item.email)
          ).sort((a, b) => b.priority - a.priority);
          
          if (uniqueEmails.length > 0) {
            return uniqueEmails[0].email;
          }
        }
      } catch (e) {
        console.log(`Failed to load page: ${link}`);
        continue; // Try next page
      }
    }

    // If no emails found in contact pages, try social media extraction
    return await searchSocialMediaEmails(page, biz);
    
  } catch (error) {
    console.log(`Error searching contact pages for ${biz.storeName}`);
    return await searchSocialMediaEmails(page, biz);
  }
}

async function searchSocialMediaEmails(page, biz) {
  try {
    // Go back to the original website
    if (biz.bizWebsite) {
      await page.goto(biz.bizWebsite, { 
        waitUntil: "networkidle2", 
        timeout: 60000 
      });
      await delay(1000);
    }
    
    // Look for social media links and other external profiles
    const socialLinks = await page.$$eval("a", (anchors) =>
      anchors.map((a) => a.href).filter((href) => {
        const url = href.toLowerCase();
        return (url.includes('linkedin.com/in/') || 
               url.includes('linkedin.com/pub/') ||
               url.includes('facebook.com/') ||
               url.includes('twitter.com/') ||
               url.includes('instagram.com/')) &&
               href.startsWith("http");
      }).slice(0, 3)
    );

    // Try to find emails in form fields, placeholders, and meta tags
    const formEmails = await page.evaluate(() => {
      const emails = [];
      
      // Check form placeholders
      const inputs = document.querySelectorAll('input[type="email"], input[placeholder*="email" i], input[placeholder*="@"]');
      inputs.forEach(input => {
        if (input.placeholder && input.placeholder.includes('@')) {
          emails.push(input.placeholder);
        }
      });
      
      // Check meta tags
      const metaTags = document.querySelectorAll('meta');
      metaTags.forEach(meta => {
        const content = meta.getAttribute('content') || '';
        if (content.includes('@') && content.includes('.')) {
          emails.push(content);
        }
      });
      
      // Check data attributes
      const dataElements = document.querySelectorAll('[data-email], [data-contact], [data-mail]');
      dataElements.forEach(el => {
        const dataEmail = el.getAttribute('data-email') || el.getAttribute('data-contact') || el.getAttribute('data-mail');
        if (dataEmail && dataEmail.includes('@')) {
          emails.push(dataEmail);
        }
      });
      
      return emails;
    });
    
    // Process form emails
    if (formEmails.length > 0) {
      for (const email of formEmails) {
        const normalizedEmail = emailUtils.normalizeEmail(email);
        const validation = emailUtils.validateEmail(normalizedEmail);
        
        if (validation.isValid) {
          return validation.email;
        }
      }
    }
    
    // If still no email found, try a general email guess based on domain
    if (biz.bizWebsite) {
      try {
        const domain = new URL(biz.bizWebsite).hostname.replace('www.', '');
        const commonEmails = [
          `info@${domain}`,
          `contact@${domain}`,
          `hello@${domain}`,
          `admin@${domain}`,
          `support@${domain}`,
          `sales@${domain}`
        ];
        
        // Return the first common email pattern (this is a guess)
        for (const guessEmail of commonEmails) {
          const validation = emailUtils.validateEmail(guessEmail);
          if (validation.isValid) {
            return `${guessEmail} (estimated)`;
          }
        }
      } catch (e) {
        // Invalid URL
      }
    }
    
    return "No information";
  } catch (error) {
    console.log(`Error in social media search for ${biz.storeName}`);
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

    console.log("Scraping completed, performing email analysis...");
    
    // Analyze email collection results
    const emailStats = {
      total: businesses.length,
      withEmails: businesses.filter(b => b.email && b.email !== "No information").length,
      fromWebsite: businesses.filter(b => b.emailSource === 'website_content').length,
      fromContactPage: businesses.filter(b => b.emailSource === 'contact_page').length,
      estimated: businesses.filter(b => b.emailSource === 'estimated' || b.emailSource === 'domain_guess').length
    };
    
    console.log(`Email collection results:`, emailStats);
    event.reply("scraper-status", `Scraping completed! Found ${emailStats.withEmails}/${emailStats.total} email addresses`);
    event.reply("scraper-results", businesses);
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
