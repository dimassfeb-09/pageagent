import { describe, it, expect } from 'vitest';
import { isQuotaError } from './llm';
import { needPageError } from './tools';
import { providerById, baseUrlOf, initialsOf } from './providers';
import { nanoid } from './types';

describe('utils', () => {
  it('isQuotaError detects 429 and keywords', () => {
    expect(isQuotaError(429, '')).toBe(true);
    expect(isQuotaError(400, 'rate limit exceeded')).toBe(true);
    expect(isQuotaError(400, 'ok')).toBe(false);
  });

  it('needPageError allows http(s) urls', () => {
    expect(needPageError('https://example.com')).toBeNull();
    expect(needPageError('ftp://x')).toEqual({ error: 'Not a web page' });
  });

  it('providerById and baseUrlOf', () => {
    const p = providerById('openai')!;
    expect(p).toBeTruthy();
    expect(baseUrlOf(p, { apiKey: '', baseUrl: 'https://x.com/v1/', models: [] })).toBe('https://x.com/v1');
  });

  it('initialsOf', () => {
    expect(initialsOf('Open AI')).toBe('OA');
  });

  it('nanoid length', () => {
    expect(nanoid(8)).toHaveLength(8);
  });
});