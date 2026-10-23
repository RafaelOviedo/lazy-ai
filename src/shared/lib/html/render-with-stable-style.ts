const leadingStylePattern = /^\s*<style>([\s\S]*?)<\/style>/;
const adoptedStyles = new WeakMap<Document, Set<string>>();

/**
 * Replaces an element's markup, moving its leading `<style>` block into the
 * document head the first time it is seen and leaving it there.
 *
 * TermDOM restyles the whole screen whenever a `<style>` element is added or
 * removed, which takes seconds with a long conversation open. Components
 * re-render on selection and focus changes, and modals swap in and out, so no
 * render may add or remove a stylesheet after the first.
 */
export function renderWithStableStyle(host: Element, html: string): void {
  const match = leadingStylePattern.exec(html);

  if (!match) {
    host.innerHTML = html;
    return;
  }

  adoptStyle(host.ownerDocument, match[1]);
  host.innerHTML = html.slice(match[0].length);
}

function adoptStyle(document: Document, css: string): void {
  let adopted = adoptedStyles.get(document);

  if (!adopted) {
    adopted = new Set();
    adoptedStyles.set(document, adopted);
  }

  if (adopted.has(css)) return;

  adopted.add(css);

  const style = document.createElement("style");

  style.textContent = css;
  document.head.appendChild(style);
}
