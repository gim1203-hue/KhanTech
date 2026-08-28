const PRIVATE_HOSTS = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|::1$)/i;

function cleanText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const value = requestUrl.searchParams.get('url');
  if (!value) return Response.json({ error: 'A URL is required.' }, { status: 400 });

  try {
    const target = new URL(value);
    if (!['http:', 'https:'].includes(target.protocol) || PRIVATE_HOSTS.test(target.hostname)) {
      return Response.json({ error: 'Only public web pages are supported.' }, { status: 400 });
    }

    const response = await fetch(target.toString(), {
      headers: { 'User-Agent': 'Mira personal page reader/1.0' },
      redirect: 'follow',
      signal: AbortSignal.timeout(9000),
    });
    if (!response.ok) throw new Error('Page request failed');
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      return Response.json({ error: 'This file type cannot be read yet.' }, { status: 415 });
    }

    const html = (await response.text()).slice(0, 750_000);
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim();
    const description = html.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']+)/i)?.[1];
    const text = cleanText(html);
    return Response.json({
      title: title || target.hostname,
      excerpt: (description || text).slice(0, 520),
      url: target.toString(),
    });
  } catch {
    return Response.json({ error: 'The page could not be reached or blocked automated reading.' }, { status: 502 });
  }
}
