import type { NextConfig } from 'next';

const apiProxyTarget = process.env.API_PROXY_TARGET?.replace(/\/+$/, '');

if (apiProxyTarget) {
  const target = new URL(apiProxyTarget);
  if (
    target.origin !== apiProxyTarget ||
    target.username ||
    target.password ||
    target.pathname !== '/' ||
    target.search ||
    target.hash
  ) {
    throw new Error('API_PROXY_TARGET must be an origin only, without credentials, path, query, or fragment');
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new Error('API_PROXY_TARGET must use HTTP or HTTPS');
  }
  if (process.env.NODE_ENV === 'production' && target.protocol !== 'https:') {
    throw new Error('API_PROXY_TARGET must use HTTPS in production');
  }
} else if (process.env.NODE_ENV === 'production') {
  throw new Error('API_PROXY_TARGET is required for production builds');
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    if (!apiProxyTarget) return [];
    return [{
      source: '/api/:path*',
      destination: `${apiProxyTarget}/api/:path*`,
    }];
  },
};

export default nextConfig;
