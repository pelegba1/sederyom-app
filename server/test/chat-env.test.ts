/**
 * The chat connection's two environment variables, read by `loadEnv`: the server's
 * own public address, and the fixed demo code, which is kept in its normalized form
 * and is turned off, with a warning, when it is not a code. A production server
 * whose address is not https warns, and its chat routes answer 503.
 */
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/env.js';
import { world } from './helpers/chatDb.js';

/** What `loadEnv` needs besides the chat's variables. */
const BASE = {
  DATABASE_URL: 'postgresql://sederyom:test@localhost:5432/sederyom',
  CRON_SECRET: 'test-cron-secret-0123456789abcdef',
};

const load = (extra: Record<string, string> = {}) => loadEnv({ ...BASE, ...extra } as NodeJS.ProcessEnv);

describe('PUBLIC_URL', () => {
  it('is the local server unless set', () => {
    expect(load().PUBLIC_URL).toBe('http://localhost:3000');
  });

  it('is read as given', () => {
    expect(load({ PUBLIC_URL: 'https://sederyom.example.com' }).PUBLIC_URL).toBe('https://sederyom.example.com');
  });

  it('must be a URL', () => {
    expect(() => load({ PUBLIC_URL: 'sederyom.example.com' })).toThrow(/PUBLIC_URL/);
  });
});

describe('CHAT_DEMO_CODE', () => {
  it('is absent unless set', () => {
    expect(load().CHAT_DEMO_CODE).toBeUndefined();
  });

  it('is kept as the normalized code, however it was written', () => {
    expect(load({ CHAT_DEMO_CODE: 'k7qm-2xpa' }).CHAT_DEMO_CODE).toBe('K7QM2XPA');
    expect(load({ CHAT_DEMO_CODE: ' K7QM 2XPA ' }).CHAT_DEMO_CODE).toBe('K7QM2XPA');
    expect(load({ CHAT_DEMO_CODE: 'K7QM2XPA' }).CHAT_DEMO_CODE).toBe('K7QM2XPA');
  });

  it('is absent when left blank, as a .env template leaves it', () => {
    expect(load({ CHAT_DEMO_CODE: '' }).CHAT_DEMO_CODE).toBeUndefined();
    expect(load({ CHAT_DEMO_CODE: '  ' }).CHAT_DEMO_CODE).toBeUndefined();
  });

  it('turns the demo off when it is not a code, with a warning that does not repeat the value, and the server still loads', () => {
    // Too short, too long, and characters outside the alphabet (no 0, 1, I or O).
    for (const bad of ['K7QM-2XP', 'K7QM-2XPAA', 'K7QM-2XP!', 'DEMO0000']) {
      const warned: string[] = [];
      const env = loadEnv({ ...BASE, CHAT_DEMO_CODE: bad } as NodeJS.ProcessEnv, (line) => void warned.push(line));
      expect(env.CHAT_DEMO_CODE, bad).toBeUndefined();
      expect(warned, bad).toHaveLength(1);
      expect(warned[0]).toMatch(/CHAT_DEMO_CODE/);
      expect(warned[0]).not.toContain(bad);
    }
  });

  it('warns about nothing when it is a code, or unset', () => {
    const warned: string[] = [];
    loadEnv({ ...BASE, CHAT_DEMO_CODE: 'DEMA2345' } as NodeJS.ProcessEnv, (line) => void warned.push(line));
    loadEnv({ ...BASE } as NodeJS.ProcessEnv, (line) => void warned.push(line));
    expect(warned).toEqual([]);
  });
});

describe('PUBLIC_URL in production', () => {
  const warnings = (extra: Record<string, string>) => {
    const warned: string[] = [];
    loadEnv({ ...BASE, ...extra } as NodeJS.ProcessEnv, (line) => void warned.push(line));
    return warned;
  };

  it('warns once, loudly, when it is left to the default or is not https', () => {
    for (const extra of [{}, { PUBLIC_URL: 'http://sederyom.example.com' }] as Record<string, string>[]) {
      const warned = warnings({ NODE_ENV: 'production', ...extra });
      expect(warned, JSON.stringify(extra)).toHaveLength(1);
      expect(warned[0]).toMatch(/PUBLIC_URL/);
      expect(warned[0]).not.toContain('sederyom.example.com');
    }
  });

  it('says nothing when it is https, or outside production', () => {
    expect(warnings({ NODE_ENV: 'production', PUBLIC_URL: 'https://sederyom.example.com' })).toEqual([]);
    expect(warnings({ NODE_ENV: 'development' })).toEqual([]);
    expect(warnings({ NODE_ENV: 'test' })).toEqual([]);
  });

  it('answers a chat 503 not_configured on every route of its side, and leaves the rest of the server alone', async () => {
    const { app } = world({ NODE_ENV: 'production' });
    for (const [method, url] of [
      ['GET', '/.well-known/oauth-protected-resource'],
      ['GET', '/.well-known/oauth-protected-resource/mcp'],
      ['GET', '/.well-known/oauth-authorization-server'],
      ['POST', '/oauth/register'],
      ['GET', '/oauth/authorize?client_id=x'],
      ['POST', '/oauth/token'],
      ['POST', '/oauth/revoke'],
      ['POST', '/mcp'],
    ] as const) {
      const res = await app.inject({ method, url });
      expect(res.statusCode, url).toBe(503);
      expect(res.json(), url).toEqual({ error: 'not_configured' });
    }
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });

  it('serves the chat as usual once it is https', async () => {
    const { app } = world({ NODE_ENV: 'production', PUBLIC_URL: 'https://sederyom.example.com' });
    const res = await app.inject({ method: 'GET', url: '/.well-known/oauth-authorization-server' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { issuer: string }).issuer).toBe('https://sederyom.example.com');
  });
});
