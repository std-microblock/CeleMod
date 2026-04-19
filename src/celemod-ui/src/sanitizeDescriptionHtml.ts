const ALLOWED_DESCRIPTION_TAGS = new Set([
  'a',
  'b',
  'blockquote',
  'br',
  'code',
  'div',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'img',
  'li',
  'ol',
  'p',
  'pre',
  'span',
  'strong',
  'sub',
  'sup',
  'u',
  'ul',
]);

const isSafeDescriptionUrl = (url: string, isImage = false) => {
  const value = url.trim();
  if (!value) return false;
  if (value.startsWith('#')) return !isImage;
  if (value.startsWith('/')) return true;
  if (value.startsWith('./') || value.startsWith('../')) return true;

  const lower = value.toLowerCase();
  if (lower.startsWith('http://') || lower.startsWith('https://')) return true;
  if (!isImage && lower.startsWith('mailto:')) return true;

  return false;
};

export const sanitizeDescriptionHtml = (html: string) => {
  const container = document.createElement('div');
  const fragment = document.createDocumentFragment();
  container.innerHTML = html;

  const appendSafeNode = (node: Node, parent: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parent.appendChild(document.createTextNode(node.textContent ?? ''));
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const source = node as HTMLElement;
    const tagName = source.tagName.toLowerCase();

    if (!ALLOWED_DESCRIPTION_TAGS.has(tagName)) {
      for (const child of Array.from(source.childNodes)) {
        appendSafeNode(child, parent);
      }
      return;
    }

    const safeElement = document.createElement(tagName);

    if (tagName === 'a') {
      const href = source.getAttribute('href');
      const title = source.getAttribute('title');
      if (href && isSafeDescriptionUrl(href)) {
        safeElement.setAttribute('href', href);
      }
      if (title) safeElement.setAttribute('title', title);
    }

    if (tagName === 'img') {
      const src = source.getAttribute('src');
      const alt = source.getAttribute('alt');
      const title = source.getAttribute('title');
      if (!src || !isSafeDescriptionUrl(src, true)) return;
      safeElement.setAttribute('src', src);
      if (alt) safeElement.setAttribute('alt', alt);
      if (title) safeElement.setAttribute('title', title);
    }

    const clazz = source.getAttribute('class');
    if (clazz) safeElement.setAttribute('class', clazz);

    for (const child of Array.from(source.childNodes)) {
      appendSafeNode(child, safeElement);
    }

    parent.appendChild(safeElement);
  };

  for (const node of Array.from(container.childNodes)) {
    appendSafeNode(node, fragment);
  }

  return fragment;
};
