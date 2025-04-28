#!/usr/bin/env node

import express from 'express';
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import NodeCache from 'node-cache';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4040;

// Security maximum sizes
const MAX_WIDTH = parseInt(process.env.MAX_WIDTH || '3000');
const MAX_HEIGHT = parseInt(process.env.MAX_HEIGHT || '3000');
const MAX_CACHE_SIZE_MB = parseInt(process.env.MAX_CACHE_SIZE_MB || '1000'); // 1000MB default
const MAX_CONCURRENT_REQUESTS = parseInt(process.env.MAX_CONCURRENT_REQUESTS || '10');

// Concurrent request tracking
let activeRequests = 0;

// Read domain whitelist from environment variables
const ALLOWED_DOMAINS = process.env.ALLOWED_DOMAINS 
  ? process.env.ALLOWED_DOMAINS.split(',').map(domain => domain.trim().toLowerCase())
  : [];

const WHITELIST_ENABLED = ALLOWED_DOMAINS.length > 0;

// Add security headers middleware
app.use((req, res, next) => {
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'");
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Rate limiting middleware
app.use((req, res, next) => {
  if (activeRequests >= MAX_CONCURRENT_REQUESTS) {
    return res.status(429).send('Too many requests. Please try again later.');
  }
  next();
});

// Function to check if a URL's domain is in the whitelist
function isDomainAllowed(url) {
  if (!WHITELIST_ENABLED) return true;
  
  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname.toLowerCase();
    
    // Check if the domain or any parent domain is in the whitelist
    return ALLOWED_DOMAINS.some(allowedDomain => {
      return domain === allowedDomain || 
             domain.endsWith('.' + allowedDomain);
    });
  } catch (error) {
    console.error(`❌ Error parsing URL: ${error.message}`);
    return false;
  }
}

// Cache configuration
const CACHE_DIR = path.join(__dirname, 'cache');
const memoryCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 }); // 1-hour TTL, check every 10 minutes

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  console.log(`🌸 Created cache directory at ${CACHE_DIR}`);
}

// Generate cache key from URL and dimensions
function generateCacheKey(url, width, height) {
  return crypto
    .createHash('md5')
    .update(`${url}-${width}-${height}`)
    .digest('hex');
}

// Get image path from cache
function getCacheFilePath(cacheKey) {
  return path.join(CACHE_DIR, `${cacheKey}.jpg`);
}

// Check if image exists in cache
function getFromCache(url, width, height) {
  const cacheKey = generateCacheKey(url, width, height);
  
  // Check memory cache first (faster)
  const memCacheResult = memoryCache.get(cacheKey);
  if (memCacheResult) {
    return memCacheResult;
  }
  
  // Then check file cache
  const filePath = getCacheFilePath(cacheKey);
  if (fs.existsSync(filePath)) {
    try {
      const stats = fs.statSync(filePath);
      const fileBuffer = fs.readFileSync(filePath);
      
      // Store in memory cache for faster access next time
      memoryCache.set(cacheKey, fileBuffer);
      
      return fileBuffer;
    } catch (error) {
      console.error(`❌ Error reading from cache: ${error.message}`);
      return null;
    }
  }
  
  return null;
}

// Save image to cache
function saveToCache(url, width, height, imageBuffer) {
  const cacheKey = generateCacheKey(url, width, height);
  const filePath = getCacheFilePath(cacheKey);
  
  try {
    // Check cache size before saving new files
    if (!exceedsCacheSize(imageBuffer.length)) {
      // Save to file cache
      fs.writeFileSync(filePath, imageBuffer);
      
      // Also save to memory cache
      memoryCache.set(cacheKey, imageBuffer);
      
      console.log(`💖 Cached image for ${url}`);
      return true;
    } else {
      console.warn('⚠️ Cache size limit reached. Running cleanup...');
      cleanupCache(true); // Force cleanup
      return false;
    }
  } catch (error) {
    console.error(`❌ Error saving to cache: ${error.message}`);
    return false;
  }
}

// Check if adding a new file would exceed cache size limit
function exceedsCacheSize(newFileSizeBytes) {
  try {
    const files = fs.readdirSync(CACHE_DIR);
    let totalSize = 0;
    
    for (const file of files) {
      if (!file.endsWith('.jpg')) continue;
      
      const filePath = path.join(CACHE_DIR, file);
      const stats = fs.statSync(filePath);
      totalSize += stats.size;
    }
    
    // Convert MB to bytes for comparison
    const maxSizeBytes = MAX_CACHE_SIZE_MB * 1024 * 1024;
    return (totalSize + newFileSizeBytes) > maxSizeBytes;
  } catch (error) {
    console.error(`❌ Error checking cache size: ${error.message}`);
    return false; // On error, assume we can still save
  }
}

// Cleanup old cache files (older than 7 days)
function cleanupCache(force = false) {
  const now = Date.now();
  const maxAge = force ? 1 : 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds, or 1ms if forced
  
  try {
    const files = fs.readdirSync(CACHE_DIR);
    let deletedCount = 0;
    
    // Sort files by age, oldest first
    const fileStats = files
      .filter(file => file.endsWith('.jpg'))
      .map(file => {
        const filePath = path.join(CACHE_DIR, file);
        const stats = fs.statSync(filePath);
        return { file, filePath, mtimeMs: stats.mtimeMs };
      })
      .sort((a, b) => a.mtimeMs - b.mtimeMs);
    
    for (const { file, filePath, mtimeMs } of fileStats) {
      const fileAge = now - mtimeMs;
      
      if (fileAge > maxAge) {
        fs.unlinkSync(filePath);
        deletedCount++;
        
        // If we're doing a forced cleanup, stop after removing 20% of files
        if (force && deletedCount >= Math.ceil(fileStats.length * 0.2)) {
          break;
        }
      }
    }
    
    if (deletedCount > 0) {
      console.log(`🧹 Cleaned up ${deletedCount} cache entries`);
    }
  } catch (error) {
    console.error(`❌ Error during cache cleanup: ${error.message}`);
  }
}

// Browser instance that will be reused
let browser;

// Initialize browser when server starts
async function initBrowser() {
  browser = await puppeteer.launch({
    headless: "new",
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-audio-output'
    ]
  });
  console.log('🌸 Browser initialized!');
}

// Close browser and database on server shutdown
process.on('SIGINT', async () => {
  if (browser) {
    await browser.close();
  }
  
  console.log('✨ Browser closed, goodbye!');
  process.exit();
});

// Middleware to handle server errors
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).send('Internal server error');
});

// Default welcome page
app.get('/', async (req, res) => {
  const { url, width = 1200, height = 630 } = req.query;
  
  // If no URL provided, show welcome page
  if (!url) {
    return res.send(`
      <html>
        <head>
          <title>URL to OpenGraph Image Service</title>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <meta name="description" content="Generate OpenGraph images from any URL. Perfect for social media previews and link sharing.">
          <meta name="keywords" content="opengraph, og image, url to image, screenshot service, social media preview">
          <meta name="author" content="url2og">
          
          <!-- Open Graph / Facebook -->
          <meta property="og:type" content="website">
          <meta property="og:url" content="https://github.com/Melchizedek6809/url2og">
          <meta property="og:title" content="URL to OpenGraph Image Service">
          <meta property="og:description" content="Generate OpenGraph images from any URL. Perfect for social media previews and link sharing.">
          
          <!-- Twitter -->
          <meta name="twitter:card" content="summary_large_image">
          <meta name="twitter:title" content="URL to OpenGraph Image Service">
          <meta name="twitter:description" content="Generate OpenGraph images from any URL. Perfect for social media previews and link sharing.">
          
          <style>
            body {
              font-family: Arial, sans-serif;
              max-width: 800px;
              margin: 0 auto;
              padding: 20px;
              line-height: 1.6;
            }
            h1 { color: #ff69b4; }
            code {
              background: #f4f4f4;
              padding: 2px 5px;
              border-radius: 3px;
            }
            .example {
              background: #f9f9f9;
              padding: 10px;
              border-left: 3px solid #ff69b4;
              margin: 15px 0;
            }
            .info {
              background: #fff8dc;
              border-left: 3px solid #ffd700;
              padding: 10px;
              margin: 15px 0;
            }
          </style>
        </head>
        <body>
          <h1>✨ URL to OpenGraph Image Service ✨</h1>
          <p>This service converts any URL into an OpenGraph-sized screenshot.</p>
          
          ${WHITELIST_ENABLED ? `
          <div class="info">
            <p><strong>⚠️ Note:</strong> This service is restricted to whitelisted domains only.</p>
            <p>Allowed domains: ${ALLOWED_DOMAINS.map(domain => `<a href="https://${domain}" target="_blank">${domain}</a>`).join(', ')}</p>
          </div>
          ` : ''}
          
          <h2>How to use:</h2>
          <div class="example">
            <p>Basic usage:</p>
            <code>http://localhost:${PORT}/?url=https://example.com</code>
          </div>
          
          <div class="example">
            <p>Custom dimensions:</p>
            <code>http://localhost:${PORT}/?url=https://example.com&width=1200&height=630</code>
          </div>
          
          <h2>Try it now!</h2>
          <form action="/" method="get">
            <p>
              <label for="url">URL to capture:</label><br>
              <input type="text" id="url" name="url" placeholder="https://example.com" style="width: 300px; padding: 5px;">
            </p>
            <p>
              <label for="width">Width:</label>
              <input type="number" id="width" name="width" value="1200" min="50" max="${MAX_WIDTH}" style="width: 70px; padding: 5px;">
              
              <label for="height">Height:</label>
              <input type="number" id="height" name="height" value="630" min="50" max="${MAX_HEIGHT}" style="width: 70px; padding: 5px;">
            </p>
            <button type="submit">Generate Image</button>
          </form>
          
          <footer style="margin-top: 30px; border-top: 1px solid #eee; padding-top: 15px; text-align: center; font-size: 14px;">
            <p>🌟 <a href="https://github.com/Melchizedek6809/url2og" target="_blank">View source code on GitHub</a> 🌟</p>
          </footer>
        </body>
      </html>
    `);
  }

  // Parse dimensions to integers
  let parsedWidth = parseInt(width);
  let parsedHeight = parseInt(height);
  
  // Validate dimensions with limits
  if (isNaN(parsedWidth) || parsedWidth < 50) parsedWidth = 1200;
  if (isNaN(parsedHeight) || parsedHeight < 50) parsedHeight = 630;
  if (parsedWidth > MAX_WIDTH) parsedWidth = MAX_WIDTH;
  if (parsedHeight > MAX_HEIGHT) parsedHeight = MAX_HEIGHT;
  
  // Validate URL 
  let targetUrl = url;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    targetUrl = `https://${url}`;
  }
  
  // Add URL2OG=1 parameter to the URL
  targetUrl += targetUrl.includes('?') ? '&URL2OG=1' : '?URL2OG=1';
  
  // Additional URL validation - reject URLs with control characters or very long URLs
  if (/[\u0000-\u001F\u007F-\u009F]/.test(targetUrl) || targetUrl.length > 2000) {
    return res.status(400).send('Invalid URL');
  }
  
  // Check if domain is allowed
  if (!isDomainAllowed(targetUrl)) {
    console.error(`🚫 Blocked request for non-whitelisted domain: ${targetUrl}`);
    return res.status(403).send(`
      <html>
        <head>
          <title>Access Denied</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              max-width: 800px;
              margin: 0 auto;
              padding: 20px;
              line-height: 1.6;
              text-align: center;
            }
            h1 { color: #ff4500; }
            .error {
              background: #fff0f0;
              border-left: 3px solid #ff4500;
              padding: 15px;
              margin: 20px 0;
              text-align: left;
            }
          </style>
        </head>
        <body>
          <h1>🚫 Access Denied</h1>
          <div class="error">
            <p>Sorry, this domain is not in the allowed domains list.</p>
            <p>This service is restricted to specific domains only.</p>
            ${ALLOWED_DOMAINS.length > 0 ? `<p>Allowed domains: ${ALLOWED_DOMAINS.join(', ')}</p>` : ''}
          </div>
          <p><a href="/">Return to homepage</a></p>
        </body>
      </html>
    `);
  }
  
  try {
    // Increment active requests counter
    activeRequests++;
    
    // Check cache first
    const cachedImage = getFromCache(targetUrl, parsedWidth, parsedHeight);
    
    if (cachedImage) {
      console.log(`🍰 Cache hit for ${targetUrl}!`);
      
      // Set response headers and send cached image
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
      res.setHeader('X-Cache', 'HIT');
      
      // Decrement active requests counter
      activeRequests--;
      
      return res.send(cachedImage);
    }
    
    console.log(`🔍 Cache miss! Capturing screenshot of ${targetUrl} at ${parsedWidth}x${parsedHeight} pixels...`);
    
    // Capture screenshot
    const page = await browser.newPage();
    try {
      // Set a navigation timeout
      page.setDefaultNavigationTimeout(30000);
      
      // Block unnecessary resources to improve performance and security
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        // Block media, font, and websocket requests to reduce attack surface
        const resourceType = req.resourceType();
        if (['media', 'font', 'websocket'].includes(resourceType)) {
          req.abort();
        } else {
          req.continue();
        }
      });
      
      await page.setViewport({
        width: parsedWidth,
        height: parsedHeight,
        deviceScaleFactor: 1,
      });
      
      await page.goto(targetUrl, {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });
      
      const screenshot = await page.screenshot({
        type: 'jpeg',
        quality: 90,
      });
      
      // Save to cache
      saveToCache(targetUrl, parsedWidth, parsedHeight, screenshot);
      
      // Set response headers and send image
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
      res.setHeader('X-Cache', 'MISS');
      res.send(screenshot);
      
      console.log(`✅ Screenshot of ${targetUrl} sent successfully!`);
    } finally {
      await page.close();
      // Decrement active requests counter
      activeRequests--;
    }
  } catch (error) {
    // Decrement active requests counter in case of error
    activeRequests--;
    
    console.error(`❌ Error capturing screenshot: ${error.message}`);
    res.status(500).send('Error capturing screenshot');
  }
});

// Health check endpoint for Docker
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Start the server
app.listen(PORT, async () => {
  // Initialize browser
  await initBrowser();
  
  // Set up automatic cache cleanup every 24 hours
  setInterval(() => {
    console.log('🧹 Running scheduled cache cleanup...');
    cleanupCache();
  }, 24 * 60 * 60 * 1000); // 24 hours
  
  console.log(`(●ﾟωﾟ●) Server is running at http://localhost:${PORT}`);
  console.log(`⚙️ Configuration:`);
  console.log(`  - Max width: ${MAX_WIDTH}px`);
  console.log(`  - Max height: ${MAX_HEIGHT}px`);
  console.log(`  - Max cache size: ${MAX_CACHE_SIZE_MB}MB`);
  console.log(`  - Max concurrent requests: ${MAX_CONCURRENT_REQUESTS}`);
  
  // Log whitelist status
  if (WHITELIST_ENABLED) {
    console.log(`🔒 Domain whitelist enabled with ${ALLOWED_DOMAINS.length} domains:`);
    ALLOWED_DOMAINS.forEach(domain => console.log(`  - ${domain}`));
  } else {
    console.log(`⚠️ No domain whitelist configured. Any domain is allowed.`);
    console.log(`   Set ALLOWED_DOMAINS environment variable to restrict access.`);
  }
}); 