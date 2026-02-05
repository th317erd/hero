'use strict';

// ============================================================================
// Web Search Function
// ============================================================================
// Fetches web pages using a headless browser and returns the text content.
// Uses Puppeteer for headless Chrome/Chromium browsing.

import { InteractionFunction, PERMISSION } from '../function.mjs';

/**
 * WebSearch Function class.
 * Fetches a URL using a headless browser and returns the page content.
 */
export class WebSearchFunction extends InteractionFunction {
  /**
   * Register the websearch function with the interaction system.
   *
   * @returns {Object} Registration info
   */
  static register() {
    return {
      name:        'websearch',
      description: 'Fetch web pages or search the web using a headless browser',
      target:      '@system',
      permission:  PERMISSION.ALWAYS,
      schema: {
        type:       'object',
        properties: {
          url: {
            type:        'string',
            description: 'URL to fetch directly',
          },
          query: {
            type:        'string',
            description: 'Search query (uses Google)',
          },
          selector: {
            type:        'string',
            description: 'CSS selector for content extraction',
            default:     'body',
          },
          timeout: {
            type:        'number',
            description: 'Page load timeout in milliseconds',
            default:     30000,
          },
          waitForSelector: {
            type:        'boolean',
            description: 'Wait for selector before extracting content',
            default:     false,
          },
        },
        oneOf: [
          { required: ['url'] },
          { required: ['query'] },
        ],
      },
      examples: [
        {
          description: 'Fetch a specific URL',
          payload:     { url: 'https://example.com' },
        },
        {
          description: 'Search the web',
          payload:     { query: 'best running shoes 2024' },
        },
      ],
    };
  }

  constructor(context = {}) {
    super('websearch', context);
    this.browser = null;
  }

  /**
   * Check if the websearch is allowed.
   * Can be extended to restrict certain URLs or domains.
   *
   * @param {Object} payload - The payload to check
   * @param {Object} context - Execution context
   * @returns {Promise<{allowed: boolean, reason?: string}>}
   */
  async allowed(payload, context = {}) {
    // Basic validation
    if (!payload) {
      return { allowed: false, reason: 'Payload is required' };
    }

    if (!payload.url && !payload.query) {
      return { allowed: false, reason: 'Either url or query is required' };
    }

    // Could add URL/domain blocking here
    // For example: block internal network, localhost, etc.
    if (payload.url) {
      try {
        let url = new URL(payload.url.startsWith('http') ? payload.url : `https://${payload.url}`);

        // Block localhost and internal networks
        if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
          return { allowed: false, reason: 'Cannot fetch localhost URLs' };
        }

        // Block private IP ranges
        if (/^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/.test(url.hostname)) {
          return { allowed: false, reason: 'Cannot fetch private network URLs' };
        }
      } catch (e) {
        return { allowed: false, reason: `Invalid URL: ${e.message}` };
      }
    }

    return { allowed: true };
  }

  /**
   * Execute the web search.
   *
   * @param {Object} params - Parameters
   * @param {string} params.url - URL to fetch
   * @param {string} params.query - Search query (alternative to url)
   * @param {string} [params.selector='body'] - CSS selector for content extraction
   * @param {number} [params.timeout=30000] - Page load timeout in ms
   * @param {boolean} [params.waitForSelector=false] - Wait for selector before extracting
   * @returns {Promise<Object>} Result with text content
   */
  async execute(params) {
    // If query provided, perform a search
    if (params.query) {
      return await this._search(params.query, params);
    }

    // Otherwise fetch the URL directly
    return await this._fetch(params.url, params);
  }

  /**
   * Fetch a URL and return its content.
   *
   * @private
   */
  async _fetch(url, options = {}) {
    let { selector = 'body', timeout = 30000, waitForSelector = false } = options;

    // Normalize URL
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }

    let puppeteer;
    let browser;
    let page;

    try {
      // Dynamic import of puppeteer
      puppeteer = await import('puppeteer');

      // Launch browser
      browser = await puppeteer.default.launch({
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      });

      this.browser = browser;

      // Create page
      page = await browser.newPage();

      // Set user agent
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      // Set viewport
      await page.setViewport({ width: 1280, height: 800 });

      // Navigate to URL
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout:   timeout,
      });

      // Wait for selector if requested
      if (waitForSelector && selector !== 'body') {
        await page.waitForSelector(selector, { timeout: timeout / 2 });
      }

      // Extract text content
      let content = await page.evaluate((sel) => {
        let element = document.querySelector(sel);
        if (!element) return null;

        // Get inner text (visible text only)
        return element.innerText;
      }, selector);

      // Get page title
      let title = await page.title();

      // Get final URL (after redirects)
      let finalUrl = page.url();

      return {
        success:  true,
        url:      finalUrl,
        title:    title,
        content:  content || '',
        selector: selector,
      };

    } catch (error) {
      return {
        success: false,
        url:     url,
        error:   error.message,
      };

    } finally {
      // Clean up
      if (browser) {
        await browser.close();
        this.browser = null;
      }
    }
  }

  /**
   * Perform a web search.
   *
   * @private
   */
  async _search(query, options = {}) {
    // Encode query for URL
    let encodedQuery = encodeURIComponent(query);
    let searchUrl    = `https://www.google.com/search?q=${encodedQuery}`;

    let result = await this._fetch(searchUrl, {
      selector: '#search',  // Google's search results container
      timeout:  options.timeout || 30000,
    });

    if (result.success) {
      return {
        success: true,
        query:   query,
        url:     result.url,
        content: result.content,
      };
    }

    return {
      success: false,
      query:   query,
      error:   result.error,
    };
  }

  /**
   * Cancel the web search.
   */
  cancel(reason) {
    if (this.browser) {
      this.browser.close().catch(() => {});
      this.browser = null;
    }
    return super.cancel(reason);
  }
}

/**
 * Fetch a web page and return its text content.
 * Convenience function that creates a WebSearchFunction instance.
 *
 * @param {string} url - URL to fetch
 * @param {Object} options - Options
 * @returns {Promise<Object>} Result
 */
export async function fetchWebPage(url, options = {}) {
  let func = new WebSearchFunction(options.context || {});
  return await func.start({ url, ...options });
}

/**
 * Search the web using a search engine.
 *
 * @param {string} query - Search query
 * @param {Object} options - Options
 * @returns {Promise<Object>} Search results
 */
export async function searchWeb(query, options = {}) {
  let func = new WebSearchFunction(options.context || {});
  return await func.start({ query, ...options });
}

export default WebSearchFunction;
