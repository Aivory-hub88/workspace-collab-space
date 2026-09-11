/**
 * Base-URL resolution for login hand-off links.
 *
 * Precedence: explicit env (`NEXT_PUBLIC_DASHBOARD_URL` /
 * `NEXT_PUBLIC_MARKETING_URL`) → localhost default in local dev → the
 * placeholder production default below, which deployments MUST override.
 */

export const DASHBOARD_URL_PROD = 'https://example.com/workspace'
export const DASHBOARD_URL_LOCAL = 'http://localhost:3000'
export const MARKETING_URL_PROD = 'https://example.com'
export const MARKETING_URL_LOCAL = 'http://localhost:9000'

export interface UrlResolverInput {
  dashboardEnv?: string | null
  marketingEnv?: string | null
  host?: string | null
}

function ambientHost(): string | undefined {
  if (typeof window === 'undefined') return undefined
  return window.location?.host
}

function isLocalHost(host: string | null | undefined): boolean {
  if (!host) return false
  const hostname = host.split(':')[0].trim().toLowerCase()
  return hostname === 'localhost' || hostname === '127.0.0.1'
}

export function getDashboardUrl(input: UrlResolverInput = {}): string {
  const rawEnv = input.dashboardEnv ?? process.env.NEXT_PUBLIC_DASHBOARD_URL ?? ''
  const env = rawEnv.trim()
  if (env) return env

  const host = input.host ?? ambientHost()
  return isLocalHost(host) ? DASHBOARD_URL_LOCAL : DASHBOARD_URL_PROD
}

export function getMarketingUrl(input: UrlResolverInput = {}): string {
  const rawEnv = input.marketingEnv ?? process.env.NEXT_PUBLIC_MARKETING_URL ?? ''
  const env = rawEnv.trim()

  let url: string
  if (env) {
    url = env
  } else {
    const host = input.host ?? ambientHost()
    url = isLocalHost(host) ? MARKETING_URL_LOCAL : MARKETING_URL_PROD
  }

  const dashboard = getDashboardUrl(input)
  if (url === dashboard) {
    url = url.endsWith('/') ? `${url}marketing` : `${url}/marketing`
  }
  return url
}
