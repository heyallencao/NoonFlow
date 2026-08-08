import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeForIframe, sanitizeForStreaming } from '../../lib/widget-sanitizer';

describe('widget payload security policy', () => {
  it('allows only approved schemes for anchor href', () => {
    const html = [
      '<a href="https://example.com/x">https</a>',
      '<a href="http://example.com/x">http</a>',
      '<a href="mailto:test@example.com">mailto</a>',
      '<a href="tel:+123456789">tel</a>',
      '<a href="ask:refine chart">ask</a>',
      '<a href="#local">hash</a>',
    ].join('');

    const sanitized = sanitizeForIframe(html);
    assert.equal(sanitized.includes('href="https://example.com/x"'), true);
    assert.equal(sanitized.includes('href="http://example.com/x"'), true);
    assert.equal(sanitized.includes('href="mailto:test@example.com"'), true);
    assert.equal(sanitized.includes('href="tel:+123456789"'), true);
    assert.equal(sanitized.includes('href="ask:refine chart"'), true);
    assert.equal(sanitized.includes('href="#local"'), true);
  });

  it('blocks disallowed or ambiguous anchor href values', () => {
    const html = [
      '<a href="javascript:alert(1)">js</a>',
      '<a href="data:text/html;base64,AAAA">data</a>',
      '<a href="file:///etc/passwd">file</a>',
      '<a href="/relative/path">relative</a>',
      '<a href="../escape">escape</a>',
      '<a href="ftp://example.com/file.txt">ftp</a>',
    ].join('');
    const sanitized = sanitizeForIframe(html);

    assert.equal(sanitized.includes('javascript:'), false);
    assert.equal(sanitized.includes('data:text/html'), false);
    assert.equal(sanitized.includes('file:///etc/passwd'), false);
    assert.equal(sanitized.includes('ftp://example.com/file.txt'), false);
    assert.equal((sanitized.match(/href="#"/g) || []).length >= 6, true);
  });

  it('allows only data:image for img/src and svg image href', () => {
    const html = [
      '<img src="data:image/png;base64,AAA" />',
      '<img src="https://example.com/a.png" />',
      '<img src="/asset/a.png" />',
      '<svg><image href="data:image/svg+xml;base64,AAA" /></svg>',
      '<svg><image href="https://example.com/a.svg" /></svg>',
      '<svg><image xlink:href="/asset/a.svg" /></svg>',
    ].join('');
    const sanitized = sanitizeForIframe(html);

    assert.equal(sanitized.includes('src="data:image/png;base64,AAA"'), true);
    assert.equal(sanitized.includes('href="data:image/svg+xml;base64,AAA"'), true);
    assert.equal(sanitized.includes('src="https://example.com/a.png"'), false);
    assert.equal(sanitized.includes('href="https://example.com/a.svg"'), false);
    assert.equal(sanitized.includes('xlink:href="/asset/a.svg"'), false);
    assert.equal((sanitized.match(/src="#"/g) || []).length >= 2, true);
  });

  it('removes form tags and strips form submission surfaces', () => {
    const html = '<form action="https://example.com"><button formaction="mailto:test@example.com"></button></form>';
    const sanitized = sanitizeForIframe(html);

    assert.equal(sanitized.includes('<form'), false);
    assert.equal(sanitized.includes('<button'), false);
    assert.equal(sanitized.includes('action='), false);
    assert.equal(sanitized.includes('formaction='), false);
  });

  it('uses deny-by-default for non-anchor/non-image URL attributes', () => {
    const html = '<svg><use href="https://example.com/sprite.svg#icon"></use></svg>';
    const sanitized = sanitizeForIframe(html);

    assert.equal(sanitized.includes('https://example.com/sprite.svg#icon'), false);
    assert.equal(sanitized.includes('href="#"'), true);
  });

  it('applies the same URL policy in streaming sanitizer', () => {
    const html = [
      '<a href="/internal/path">internal</a>',
      '<img src="/asset/banner.png" />',
      '<svg><image href="https://example.com/banner.svg" /></svg>',
    ].join('');
    const sanitized = sanitizeForStreaming(html);

    assert.equal(sanitized.includes('href="/internal/path"'), false);
    assert.equal(sanitized.includes('src="/asset/banner.png"'), false);
    assert.equal(sanitized.includes('href="https://example.com/banner.svg"'), false);
    assert.equal((sanitized.match(/="#"/g) || []).length >= 3, true);
  });
});
