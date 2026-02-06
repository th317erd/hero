'use strict';

// ============================================================================
// Hero Markup Language (HML) - Frontend Parser & Renderer
// ============================================================================

// Initialize markdown-it with HTML enabled
const md = window.markdownit({
  html:        true,   // Enable HTML tags in source
  linkify:     true,   // Auto-convert URLs to links
  typographer: true,   // Smart quotes, dashes
  breaks:      true,   // Convert \n to <br>
});

// Custom element allowlist - elements we process, all others stripped
const ALLOWED_ELEMENTS = [
  'todo', 'item', 'progress', 'link', 'copy', 'result',
  'websearch', 'bash', 'ask', 'thinking'
];

// Dangerous tags to completely remove (content and all)
// Note: SVG is allowed but sanitized for dangerous attributes
const DANGEROUS_TAGS = [
  'script',       // JavaScript execution
  'iframe',       // Embed external content
  'embed',        // Plugin execution
  'object',       // Plugin execution
  'style',        // CSS injection attacks
  'base',         // Hijacks all relative URLs
  'meta',         // Can redirect page
  'form',         // Phishing attacks
  'input',        // Form elements (phishing)
  'button',       // Form submission
  'textarea',     // Form elements
  'select',       // Form elements
  'math',         // XSS vectors in some browsers
  'noscript',     // Can leak info
  'template',     // Can hide malicious content
  'slot',         // Shadow DOM manipulation
  'interaction',  // Our protocol tag - should be processed server-side, strip from display
];

// Dangerous attributes to strip from ALL elements
const DANGEROUS_ATTRS = [
  // Event handlers
  'onclick', 'ondblclick', 'onmousedown', 'onmouseup', 'onmouseover',
  'onmousemove', 'onmouseout', 'onmouseenter', 'onmouseleave',
  'onkeydown', 'onkeyup', 'onkeypress',
  'onfocus', 'onblur', 'onchange', 'oninput', 'onsubmit', 'onreset',
  'onselect', 'onload', 'onerror', 'onabort', 'onunload', 'onresize',
  'onscroll', 'oncontextmenu', 'ondrag', 'ondragend', 'ondragenter',
  'ondragleave', 'ondragover', 'ondragstart', 'ondrop',
  'oncopy', 'oncut', 'onpaste', 'onwheel', 'ontouchstart', 'ontouchend',
  'ontouchmove', 'ontouchcancel', 'onanimationstart', 'onanimationend',
  'onanimationiteration', 'ontransitionend', 'onpointerdown', 'onpointerup',
  'onpointermove', 'onpointerenter', 'onpointerleave', 'onpointercancel',
  // Other dangerous attributes
  'formaction',   // Form hijacking
  'xlink:href',   // SVG links (can be javascript:)
  'data',         // Object tag data
  'srcdoc',       // Iframe content
  'sandbox',      // Can be used to weaken security
];

// ============================================================================
// Main Render Function
// ============================================================================

/**
 * Render content with markdown and custom HML elements.
 *
 * @param {string} content - Raw text with markdown and HML elements
 * @returns {string} Rendered HTML
 */
function renderMarkup(content) {
  if (!content) return '';

  // 1. Parse markdown (preserves our custom HTML elements)
  let html = md.render(content);

  // 2. Create DOM fragment for processing
  let template = document.createElement('template');
  template.innerHTML = html;

  // 3. Sanitize and process custom elements
  sanitizeContent(template.content);
  processCustomElements(template.content);

  // 4. Return processed HTML
  return template.innerHTML;
}

// ============================================================================
// Sanitization
// ============================================================================

/**
 * Sanitize content by removing dangerous elements and attributes.
 */
function sanitizeContent(container) {
  // Remove all dangerous tags completely
  for (let tag of DANGEROUS_TAGS) {
    container.querySelectorAll(tag).forEach((el) => el.remove());
  }

  // Add target="_blank" to all links for security and UX
  container.querySelectorAll('a[href]').forEach((el) => {
    let href = el.getAttribute('href');
    // Only add target="_blank" for external links (not anchors)
    if (href && !href.startsWith('#')) {
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener noreferrer');
    }
  });

  // Remove dangerous attributes from all elements
  container.querySelectorAll('*').forEach((el) => {
    for (let attr of DANGEROUS_ATTRS) {
      el.removeAttribute(attr);
    }

    // Remove javascript: and data: URLs from href/src attributes
    for (let urlAttr of ['href', 'src', 'action', 'poster', 'background']) {
      if (el.hasAttribute(urlAttr)) {
        let value = el.getAttribute(urlAttr);
        if (value) {
          let lower = value.toLowerCase().trim();
          if (lower.startsWith('javascript:') || lower.startsWith('data:text/html')) {
            el.setAttribute(urlAttr, '#');
          }
        }
      }
    }

    // Remove SVG-specific dangerous attributes
    if (el.tagName && el.tagName.toLowerCase() === 'svg') {
      el.removeAttribute('onload');
      el.removeAttribute('onerror');
    }

    // Check for SVG children with dangerous attributes
    if (el.closest && el.closest('svg')) {
      el.removeAttribute('onload');
      el.removeAttribute('onerror');
      el.removeAttribute('onbegin');
      el.removeAttribute('onend');
      el.removeAttribute('onrepeat');

      // Remove xlink:href with javascript:
      let xlinkHref = el.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
      if (xlinkHref && xlinkHref.toLowerCase().trim().startsWith('javascript:')) {
        el.removeAttributeNS('http://www.w3.org/1999/xlink', 'href');
      }
    }
  });
}

// ============================================================================
// Custom Element Processing
// ============================================================================

/**
 * Process all custom HML elements in the container.
 */
function processCustomElements(container) {
  processTodoElements(container);
  processProgressElements(container);
  processLinkElements(container);
  processCopyElements(container);
  processResultElements(container);
  processThinkingElements(container);
  processExecutableElements(container);
}

/**
 * Process <todo> elements into interactive task lists.
 */
function processTodoElements(container) {
  container.querySelectorAll('todo').forEach((el) => {
    let title = el.getAttribute('title') || 'Tasks';
    let items = Array.from(el.querySelectorAll('item')).map((item) => ({
      text:   item.textContent.trim(),
      status: item.getAttribute('status') || 'pending',
    }));

    let completed = items.filter((i) => i.status === 'completed').length;
    let percent   = (items.length > 0) ? Math.round((completed / items.length) * 100) : 0;

    let html = `
      <div class="hml-todo">
        <div class="hml-todo-header">
          <span class="hml-todo-title">${escapeHtml(title)}</span>
          <span class="hml-todo-progress">${completed}/${items.length}</span>
        </div>
        <div class="hml-todo-progress-bar">
          <div class="hml-todo-progress-fill" style="width: ${percent}%"></div>
        </div>
        <ul class="hml-todo-items">
          ${items.map((item) => `
            <li class="hml-todo-item ${item.status}">
              <span class="hml-todo-status">${getStatusIcon(item.status)}</span>
              <span class="hml-todo-text">${escapeHtml(item.text)}</span>
            </li>
          `).join('')}
        </ul>
      </div>
    `;

    el.outerHTML = html;
  });
}

/**
 * Process <progress> elements into progress bars.
 */
function processProgressElements(container) {
  container.querySelectorAll('progress').forEach((el) => {
    let value  = parseInt(el.getAttribute('value') || '0', 10);
    let max    = parseInt(el.getAttribute('max') || '100', 10);
    let status = el.getAttribute('status') || '';
    let label  = el.textContent.trim() || 'Progress';

    let percent = Math.min(100, Math.max(0, Math.round((value / max) * 100)));

    let html = `
      <div class="hml-progress">
        <div class="hml-progress-header">
          <span class="hml-progress-label">${escapeHtml(label)}</span>
          <span class="hml-progress-percent">${percent}%</span>
        </div>
        <div class="hml-progress-bar">
          <div class="hml-progress-fill" style="width: ${percent}%"></div>
        </div>
        ${(status) ? `<div class="hml-progress-status">${escapeHtml(status)}</div>` : ''}
      </div>
    `;

    el.outerHTML = html;
  });
}

/**
 * Process <link> elements into clickable links.
 */
function processLinkElements(container) {
  container.querySelectorAll('link').forEach((el) => {
    let href  = el.getAttribute('href') || '#';
    let label = el.textContent.trim() || href;

    // Determine link type
    let isInternal = href.startsWith('#msg-') || href.startsWith('#');
    let icon       = (isInternal) ? '↓' : '🔗';
    let linkClass  = (isInternal) ? 'hml-link-internal' : 'hml-link-external';

    if (isInternal) {
      let html = `
        <button class="hml-link ${linkClass}" onclick="scrollToMessage('${escapeHtml(href.slice(1))}')" title="Jump to message">
          <span class="hml-link-icon">${icon}</span>
          <span class="hml-link-label">${escapeHtml(label)}</span>
        </button>
      `;
      el.outerHTML = html;
    } else {
      let html = `
        <a class="hml-link ${linkClass}" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">
          <span class="hml-link-icon">${icon}</span>
          <span class="hml-link-label">${escapeHtml(label)}</span>
        </a>
      `;
      el.outerHTML = html;
    }
  });
}

/**
 * Process <copy> elements into copy-to-clipboard buttons.
 */
function processCopyElements(container) {
  container.querySelectorAll('copy').forEach((el) => {
    let text  = el.textContent.trim();
    let label = el.getAttribute('label') || 'Copy';

    // Escape text for use in onclick attribute
    let escapedText = text.replace(/'/g, "\\'").replace(/\n/g, '\\n');

    let html = `
      <button class="hml-copy" onclick="copyToClipboard('${escapedText}', this)" title="Copy to clipboard">
        <span class="hml-copy-icon">📋</span>
        <span class="hml-copy-label">${escapeHtml(label)}</span>
        <code class="hml-copy-text">${escapeHtml(text)}</code>
      </button>
    `;

    el.outerHTML = html;
  });
}

/**
 * Process <result> elements (output from executed commands).
 */
function processResultElements(container) {
  container.querySelectorAll('result').forEach((el) => {
    let forCmd = el.getAttribute('for') || 'command';
    let status = el.getAttribute('status') || 'success';
    let content = el.innerHTML;

    let statusClass;
    let icon;

    if (status === 'success') {
      statusClass = 'hml-result-success';
      icon = '✓';
    } else if (status === 'error') {
      statusClass = 'hml-result-error';
      icon = '✗';
    } else {
      statusClass = 'hml-result-pending';
      icon = '⏳';
    }

    let html = `
      <div class="hml-result ${statusClass}">
        <div class="hml-result-header">
          <span class="hml-result-icon">${icon}</span>
          <span class="hml-result-type">${escapeHtml(forCmd)}</span>
          <span class="hml-result-status">${escapeHtml(status)}</span>
        </div>
        <div class="hml-result-content">${content}</div>
      </div>
    `;

    el.outerHTML = html;
  });
}

/**
 * Process <thinking> elements into status indicators.
 */
function processThinkingElements(container) {
  container.querySelectorAll('thinking').forEach((el) => {
    let message = el.textContent.trim() || 'Processing...';

    let html = `
      <div class="hml-thinking">
        <div class="hml-thinking-indicator">
          <span></span><span></span><span></span>
        </div>
        <span class="hml-thinking-text">${escapeHtml(message)}</span>
      </div>
    `;

    el.outerHTML = html;
  });
}

/**
 * Process executable elements (<websearch>, <bash>, <ask>) into pending displays.
 * These are processed on the server, but if they appear unprocessed, show as pending.
 */
function processExecutableElements(container) {
  // Websearch
  container.querySelectorAll('websearch').forEach((el) => {
    let query = el.textContent.trim();
    let html = `
      <div class="hml-executable hml-websearch">
        <span class="hml-executable-icon">🔍</span>
        <span class="hml-executable-label">Web Search:</span>
        <span class="hml-executable-content">${escapeHtml(query)}</span>
        <span class="hml-executable-status">pending</span>
      </div>
    `;
    el.outerHTML = html;
  });

  // Bash
  container.querySelectorAll('bash').forEach((el) => {
    let command = el.textContent.trim();
    let html = `
      <div class="hml-executable hml-bash">
        <span class="hml-executable-icon">$</span>
        <span class="hml-executable-label">Command:</span>
        <code class="hml-executable-content">${escapeHtml(command)}</code>
        <span class="hml-executable-status">pending</span>
      </div>
    `;
    el.outerHTML = html;
  });

  // Ask
  container.querySelectorAll('ask').forEach((el) => {
    let question = el.textContent.trim();
    let options  = el.getAttribute('options');
    let html = `
      <div class="hml-executable hml-ask">
        <span class="hml-executable-icon">❓</span>
        <span class="hml-executable-label">Question:</span>
        <span class="hml-executable-content">${escapeHtml(question)}</span>
        ${(options) ? `<span class="hml-executable-options">[${escapeHtml(options)}]</span>` : ''}
        <span class="hml-executable-status">awaiting response</span>
      </div>
    `;
    el.outerHTML = html;
  });
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get status icon for todo items.
 */
function getStatusIcon(status) {
  switch (status) {
    case 'completed':   return '✓';
    case 'in_progress': return '⏳';
    case 'pending':
    default:            return '○';
  }
}

/**
 * Escape HTML entities.
 */
function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Copy text to clipboard (global function for onclick handlers).
 */
function copyToClipboard(text, button) {
  navigator.clipboard.writeText(text).then(() => {
    let label = button.querySelector('.hml-copy-label');
    let originalText = label.textContent;
    label.textContent = 'Copied!';
    button.classList.add('copied');

    setTimeout(() => {
      label.textContent = originalText;
      button.classList.remove('copied');
    }, 2000);
  }).catch((err) => {
    console.error('Failed to copy:', err);
  });
}

// Make copyToClipboard available globally
window.copyToClipboard = copyToClipboard;

// ============================================================================
// Hero Interaction WebComponent
// ============================================================================

/**
 * <hero-interaction> WebComponent
 * Displays a jiggling brain emoji while processing interactions.
 */
class HeroInteraction extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
  }

  static get observedAttributes() {
    return ['status', 'message'];
  }

  attributeChangedCallback() {
    this.render();
  }

  render() {
    let status  = this.getAttribute('status') || 'processing';
    let message = this.getAttribute('message') || '';

    // Default messages based on status
    if (!message) {
      switch (status) {
        case 'processing':
          message = 'Thinking...';
          break;
        case 'searching':
          message = 'Searching...';
          break;
        case 'waiting':
          message = 'Waiting...';
          break;
        case 'complete':
          message = 'Done';
          break;
        default:
          message = 'Processing...';
      }
    }

    let isActive = (status !== 'complete' && status !== 'error');

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }

        .brain {
          font-size: 1.2em;
          display: inline-block;
        }

        .brain.active {
          animation: jiggle 0.4s ease-in-out infinite;
        }

        @keyframes jiggle {
          0%, 100% {
            transform: rotate(0deg) scale(1);
          }
          25% {
            transform: rotate(-8deg) scale(1.05);
          }
          50% {
            transform: rotate(0deg) scale(1);
          }
          75% {
            transform: rotate(8deg) scale(1.05);
          }
        }

        .message {
          color: inherit;
          opacity: 0.8;
        }

        :host([status="complete"]) .brain {
          animation: none;
        }

        :host([status="error"]) .brain::after {
          content: "❌";
          font-size: 0.6em;
          position: relative;
          top: -0.3em;
        }
      </style>
      <span class="brain ${(isActive) ? 'active' : ''}" role="img" aria-label="thinking">🧠</span>
      <span class="message">${message}</span>
    `;
  }
}

// Register the WebComponent
customElements.define('hero-interaction', HeroInteraction);

// Export for use in app.js
window.renderMarkup = renderMarkup;
