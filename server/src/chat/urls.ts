/**
 * Every public address of the chat connection, from `PUBLIC_URL` with any
 * trailing slash dropped: the issuer the chats compare (RFC 8414 and RFC 9207 ask
 * for an exact match), the endpoints, and the `/mcp` resource the tokens are for.
 * One place, so the metadata, the authorize page's form and the redirects never
 * spell one of them two ways.
 */
import type { Env } from '../env.js';

export interface ChatUrls {
  issuer: string;
  resource: string;
  authorize: string;
  token: string;
  register: string;
  revoke: string;
  resourceMetadata: string;
}

export function chatUrls(env: Pick<Env, 'PUBLIC_URL'>): ChatUrls {
  const base = env.PUBLIC_URL.replace(/\/+$/, '');
  return {
    issuer: base,
    resource: `${base}/mcp`,
    authorize: `${base}/oauth/authorize`,
    token: `${base}/oauth/token`,
    register: `${base}/oauth/register`,
    revoke: `${base}/oauth/revoke`,
    resourceMetadata: `${base}/.well-known/oauth-protected-resource`,
  };
}
