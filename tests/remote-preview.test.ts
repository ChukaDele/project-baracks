import { describe, expect, it } from 'vitest';
import { assertRemotePreviewUrl } from '../src/web/remote-preview.js';

describe('remote web preview guard', () => {
  it.each(['http://localhost:3000', 'https://127.0.0.1:3101', 'https://[::1]:5173', 'https://site.local'])('blocks local browser target %s', (url) => {
    expect(() => assertRemotePreviewUrl(url)).toThrow(/browser target blocked/);
  });
  it('blocks non-Cloudflare and non-HTTPS targets', () => {
    expect(() => assertRemotePreviewUrl('http://atelier.example.com')).toThrow(/HTTPS/);
    expect(() => assertRemotePreviewUrl('https://atelier.example.com')).toThrow(/Cloudflare/);
  });
  it('accepts remote Cloudflare preview URLs', () => {
    expect(assertRemotePreviewUrl('https://atelier-v1-chuka-personal-site.account.workers.dev').hostname).toContain('workers.dev');
    expect(assertRemotePreviewUrl('https://chuka-personal-site.pages.dev').hostname).toContain('pages.dev');
  });
});
