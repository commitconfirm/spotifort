// Copying the share link: Clipboard API first; if that is unavailable or refused, show the link in a read-only field,
// select it, and tell the visitor to copy it themselves. The field is shown either way so the link stays visible.

/**
 * @param {string} url
 * @param {{ output: HTMLElement, field: HTMLInputElement, confirm: HTMLElement }} els
 */
export async function copyShareLink(url, { output, field, confirm }) {
  field.value = url;
  output.hidden = false;
  let copied = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      copied = true;
    }
  } catch {
    copied = false;
  }
  if (copied) {
    confirm.textContent = 'Link copied. It lists your Treefort picks only, not the artists you added.';
  } else {
    field.focus();
    field.select();
    confirm.textContent = 'Copy this link to share your picks (it is selected for you).';
  }
}
