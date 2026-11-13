// Setup guide page: copy buttons and fallback for missing screenshots (no imports)

// Show the placeholder when a screenshot is missing. 'error' does not bubble and the image may
// already have failed before this deferred module runs, so check both.
function showPlaceholder(img) {
  img.classList.add('hidden');
  const placeholder = img.nextElementSibling;
  if (placeholder) placeholder.classList.add('is-visible');
}

document.querySelectorAll('.guide-media img').forEach((img) => {
  if (img.complete && img.naturalWidth === 0) {
    showPlaceholder(img);
  } else {
    img.addEventListener('error', () => showPlaceholder(img));
  }
});

// Copy button functionality
document.querySelectorAll('.copy-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const text = btn.dataset.copy;
    try {
      await navigator.clipboard.writeText(text);
      const original = btn.textContent;
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = original;
        btn.classList.remove('copied');
      }, 2000);
    } catch (err) {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = 'Copy';
        btn.classList.remove('copied');
      }, 2000);
    }
  });
});
