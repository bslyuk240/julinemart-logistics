import { describe, it, expect } from 'vitest';
import { slugifyChannel, buildCampaignTrackingUrl } from './qr';

describe('slugifyChannel', () => {
  it('lowercases and dash-separates a channel name', () => {
    expect(slugifyChannel('Vendor Shop Poster')).toBe('vendor-shop-poster');
  });

  it('strips characters outside a-z0-9', () => {
    expect(slugifyChannel('Instagram Bio! (Q3)')).toBe('instagram-bio-q3');
  });

  it('collapses repeated separators and trims leading/trailing dashes', () => {
    expect(slugifyChannel('  --Flyer--  ')).toBe('flyer');
  });

  it('returns an empty string for input with no encodable characters', () => {
    expect(slugifyChannel('!!!')).toBe('');
  });
});

describe('buildCampaignTrackingUrl', () => {
  it('builds a URL with the campaign slug path and qr_source param', () => {
    const url = buildCampaignTrackingUrl('https://julinemart.com', 'kitchen-world-summer', 'vendor-shop-poster-abc123');
    expect(url).toBe('https://julinemart.com/campaigns/kitchen-world-summer?qr_source=vendor-shop-poster-abc123');
  });

  // Regression guard: campaign slugs/tracking slugs come from user input via
  // the admin form — this must not allow query-param/URL injection, since
  // URLSearchParams encodes the value rather than concatenating it raw.
  it('encodes special characters in the tracking slug rather than injecting them raw', () => {
    const url = buildCampaignTrackingUrl('https://julinemart.com', 'kitchen-world-summer', 'a&b=c');
    expect(url).toContain('qr_source=a%26b%3Dc');
    expect(url).not.toContain('qr_source=a&b=c');
  });
});
