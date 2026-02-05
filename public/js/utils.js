'use strict';

// ============================================================================
// Utilities
// ============================================================================

function escapeHtml(text) {
  let div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function autoResizeTextarea(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px';
}

function formatRelativeDate(dateString) {
  let date    = new Date(dateString);
  let now     = new Date();
  let diffMs  = now - date;
  let diffMin = Math.floor(diffMs / 60000);
  let diffHr  = Math.floor(diffMs / 3600000);
  let diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1)
    return 'just now';

  if (diffMin < 60)
    return `${diffMin}m ago`;

  if (diffHr < 24)
    return `${diffHr}h ago`;

  if (diffDay === 1)
    return 'yesterday';

  if (diffDay < 7)
    return `${diffDay} days ago`;

  return date.toLocaleDateString();
}
