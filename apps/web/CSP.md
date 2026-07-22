# Content-Security-Policy rollout (web app)

`vercel.json` is strict JSON and cannot carry comments, so the reasoning lives here.

## Current state: Report-Only, deliberately

The policy ships as **`Content-Security-Policy-Report-Only`**. The browser evaluates
it and logs violations to the console, but blocks nothing.

This is not hedging. A CSP that is even slightly too strict does not degrade the app —
it produces a blank white page, because the very first script is refused. Shipping
`script-src 'self'` in enforcing mode without checking would be a full frontend
outage, and it would arrive at whichever pharmacy loaded the page next.

Report-Only lets us confirm the policy is correct against the real production bundle
before it can break anything.

## How to promote it to enforcing

1. Deploy with the Report-Only header (current state).
2. Open the app and exercise the real flows — **billing, inventory, reports,
   support with a file attachment**. The attachment viewer builds `blob:` URLs, and
   the reports pages render charts, so those are the most likely to violate.
3. Watch the browser console for `Content Security Policy` violation reports.
4. If clean, rename the key in `vercel.json`:

   ```
   "Content-Security-Policy-Report-Only"   →   "Content-Security-Policy"
   ```

5. If there are violations, widen the specific directive that failed — never fall
   back to a blanket `'unsafe-inline'` on `script-src`, which removes most of the
   protection CSP provides.

## Why each directive is set this way

| Directive | Value | Reason |
|---|---|---|
| `script-src` | `'self'` | No inline scripts. This is the directive that actually stops XSS, so it stays strict. |
| `style-src` | `'self' 'unsafe-inline'` | Animation and UI libraries inject `<style>` tags at runtime. Inline *styles* are a far weaker vector than inline scripts, so this is an acceptable trade. |
| `img-src` | `'self' data: blob:` | `blob:` is required — the support attachment viewer creates object URLs for downloaded files. |
| `connect-src` | `'self'` | The app calls `/api/v1` same-origin and Vercel rewrites it to the backend, so no external origin is needed. If the API ever stops being proxied, this must list it explicitly. |
| `frame-ancestors` | `'none'` | Clickjacking. Supersedes `X-Frame-Options` in modern browsers; both are sent. |
| `base-uri` | `'none'` | Stops an injected `<base>` tag silently rewriting every relative URL in the app. |
| `form-action` | `'self'` | A form must not be able to POST credentials to another origin. |

## Scope note

The header block is scoped to `/((?!api/).*)` — everything **except** `/api/`. Proxied
API responses carry their own headers set by the backend (`SecurityConfig`), and
layering a second CSP on top would mean two policies apply simultaneously, with the
most restrictive winning. That is confusing to debug and easy to get wrong.

## Related

The backend sets its own, separate CSP for the one HTML surface it serves (Swagger UI).
That policy is deliberately more permissive and does **not** protect this app — see
`SecurityConfig` in `apps/api-java`.
