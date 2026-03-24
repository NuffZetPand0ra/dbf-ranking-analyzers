// Shared utilities used by both dbf_handicap.js and dbf_handicap_histogram.js

function pickDecoder(contentType) {
  const m = (contentType || '').match(/charset\s*=\s*([^;]+)/i);
  let charset = m ? m[1].trim().toLowerCase() : 'windows-1252';
  if (charset === 'iso-8859-1' || charset === 'latin1') charset = 'windows-1252';
  try {
    return new TextDecoder(charset);
  } catch (_) {
    return new TextDecoder('windows-1252');
  }
}

async function fetchHtmlText(url, signal) {
  const res = await fetch(url, { signal, cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const decoder = pickDecoder(res.headers.get('content-type'));
  const buf = await res.arrayBuffer();
  return decoder.decode(buf);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
