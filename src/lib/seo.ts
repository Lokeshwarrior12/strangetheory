import { APP_DESCRIPTION, APP_NAME } from './config';

export interface SeoParams {
  title: string;
  description?: string;
  ogImage?: string;
  canonicalPath?: string;
  jsonLd?: Record<string, unknown>;
}

function setMeta(attr: 'name' | 'property', key: string, value: string) {
  let el = document.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', value);
}

function setCanonical(url: string) {
  let link = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.setAttribute('rel', 'canonical');
    document.head.appendChild(link);
  }
  link.setAttribute('href', url);
}

function toAbsoluteUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}${pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`}`;
}

export function applySeo({ title, description = APP_DESCRIPTION, ogImage, canonicalPath, jsonLd }: SeoParams) {
  const fullTitle = title.includes(APP_NAME) ? title : `${title} · ${APP_NAME}`;
  const path =
    canonicalPath || (typeof window !== 'undefined' ? `${window.location.pathname}${window.location.search}` : '/');
  const canonicalUrl = toAbsoluteUrl(path);
  const resolvedOgImage = toAbsoluteUrl(ogImage || '/api/og/strangetheory.svg');

  document.title = fullTitle;
  setCanonical(canonicalUrl);
  setMeta('name', 'description', description);
  setMeta('property', 'og:title', fullTitle);
  setMeta('property', 'og:description', description);
  setMeta('property', 'og:url', canonicalUrl);
  setMeta('property', 'og:image', resolvedOgImage);
  setMeta('name', 'twitter:title', fullTitle);
  setMeta('name', 'twitter:description', description);
  setMeta('name', 'twitter:image', resolvedOgImage);

  let script = document.getElementById('st-jsonld') as HTMLScriptElement | null;
  if (jsonLd) {
    if (!script) {
      script = document.createElement('script');
      script.id = 'st-jsonld';
      script.type = 'application/ld+json';
      document.head.appendChild(script);
    }
    script.textContent = JSON.stringify(jsonLd);
  } else if (script) {
    script.remove();
  }
}
