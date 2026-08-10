// OAuth callbacks are provider-authentication mechanics. They are never valid
// application preview targets, so the remote-preview guard has no loopback exception.
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

export function assertRemotePreviewUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`remote preview URL is invalid: ${value}`);
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (LOCAL_HOSTNAMES.has(hostname) || hostname.endsWith('.local')) {
    throw new Error(
      `browser target blocked: ${hostname} is local. Use the project's Cloudflare preview URL.`,
    );
  }
  if (url.protocol !== 'https:')
    throw new Error(
      `browser target blocked: remote preview must use HTTPS, received ${url.protocol}`,
    );
  if (!hostname.endsWith('.workers.dev') && !hostname.endsWith('.pages.dev')) {
    throw new Error(
      `browser target blocked: expected a Cloudflare workers.dev or pages.dev preview URL, received ${hostname}`,
    );
  }
  return url;
}
