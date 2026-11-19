/**
 * Strict allow-list HTML sanitizer & external-link detector (zero native dependencies).
 * Prevents XSS on save and on render across both server and client.
 */

const ALLOWED_TAGS = new Set([
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'u',
  'h2',
  'h3',
  'h4',
  'ul',
  'ol',
  'li',
  'blockquote',
  'code',
  'pre',
  'a',
  'img',
]);

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sanitizeRichText(raw: string): string {
  if (!raw) return '';
  let cleaned = raw
    .replace(/<\s*(script|style|iframe|object|embed|svg|math)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed)[^>]*\/?>/gi, '');

  cleaned = cleaned.replace(/<\/?([a-zA-Z0-9]+)([^>]*)>/g, (fullMatch, tagName: string, attrs: string) => {
    const tag = tagName.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) {
      return '';
    }
    const isClosing = fullMatch.startsWith('</');
    if (isClosing) {
      return tag === 'img' || tag === 'br' ? '' : `</${tag}>`;
    }
    if (tag === 'a') {
      const hrefMatch = attrs.match(/href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const rawHref = (hrefMatch?.[1] || hrefMatch?.[2] || hrefMatch?.[3] || '')
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .trim();
      const isRelative = rawHref.startsWith('/') && !rawHref.startsWith('//');
      if (/^https?:\/\//i.test(rawHref) || isRelative) {
        const safeHref = escapeHtml(rawHref);
        return `<a href="${safeHref}" rel="noopener noreferrer nofollow" target="_blank">`;
      }
      return '<a>';
    }
    if (tag === 'img') {
      const srcMatch = attrs.match(/src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const altMatch = attrs.match(/alt\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
      const rawSrc = (srcMatch?.[1] || srcMatch?.[2] || srcMatch?.[3] || '')
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .trim();
      if (
        /^https?:\/\//i.test(rawSrc) ||
        rawSrc.startsWith('/api/assets/') ||
        rawSrc.startsWith('/src/assets/') ||
        rawSrc.startsWith('/api/covers/')
      ) {
        const safeSrc = escapeHtml(rawSrc);
        const safeAlt = escapeHtml((altMatch?.[1] || altMatch?.[2] || 'Editorial figure').trim());
        return `<img src="${safeSrc}" alt="${safeAlt}" loading="lazy" referrerpolicy="no-referrer" />`;
      }
      return '';
    }
    if (tag === 'br') {
      return '<br />';
    }
    return `<${tag}>`;
  });

  return cleaned.trim();
}

export function sanitizePlainText(raw: string): string {
  return raw.replace(/<[^>]*>/g, '').trim();
}

export function containsExternalLink(text: string): boolean {
  return /(https?:\/\/|www\.[a-z0-9-]+\.[a-z]{2,})/i.test(text);
}
