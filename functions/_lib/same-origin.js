/**
 * Defense-in-depth against cross-site request forgery on state-changing
 * endpoints.
 *
 * This app's auth model already isn't vulnerable to *classic* CSRF: every
 * mutating request carries a Bearer ID token the caller's JS has to attach
 * explicitly (see src/auth.js), not an ambient cookie a forged cross-site
 * <form> or <img> could replay automatically. A third-party page has no way
 * to read this app's token out of this browser to attach it.
 *
 * `Sec-Fetch-Site` closes the remaining gap cheaply: modern browsers attach
 * it to every request and scripts cannot set or spoof it. Rejecting anything
 * that isn't same-origin (or absent, e.g. very old browsers or non-browser
 * tooling — allowed through since the Bearer-token check still applies)
 * costs nothing legitimate ever hits and blocks a cross-site page from
 * reaching these endpoints even indirectly.
 */
export function isCrossSite(request) {
  return request.headers.get('Sec-Fetch-Site') === 'cross-site';
}
