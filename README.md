# Faris Travel – Flight Search (Milestone 1)

Flight search for faristravelusa.com, powered by the Duffel Flights API.

**Milestone 1 scope:** backend API proxy + flight search, in Duffel test mode.
Booking (passenger details, orders, payment) is Milestone 2. The Arabic version of the widget is Milestone 3.

## Files

| File | What it does |
| --- | --- |
| `index.html` | The site, with the flight search section added under the hero. Nothing else changed. |
| `flights/flights.css`, `flights/flights.js` | Search widget: airport suggestions, round trip / one way, travelers, cabin, results, sorting, direct-only filter. |
| `flights/api.php` | Backend proxy for **IONOS** (PHP). The browser calls this; it calls Duffel. |
| `flights/config.example.php` | Template for the Duffel token. Copy to `config.php` on the server. |
| `flights/.htaccess` | Blocks direct access to `config.php`. |
| `api/flights.js` + `vercel.json` | Same proxy for **Vercel**, used for the demo link. Served at the same `/flights/api.php` URL. |

The Duffel token is **never** in this repo or in the browser.

## Deploy on IONOS (PHP hosting)

1. Upload `index.html` and the `flights` folder to the web root (keep the folder name `flights`, and make sure the hidden `.htaccess` file is uploaded).
2. In `flights/`, copy `config.example.php` to `config.php` and paste the Duffel token.
3. Check: `https://yourdomain.com/flights/api.php?action=places&q=detroit` should return a list of airports.

Needs PHP 7.4+ (8.x recommended) with cURL — both standard on IONOS Web Hosting.
`api/`, `vercel.json` and `.vercelignore` are only for Vercel and don't need uploading to IONOS.

## Deploy on Vercel (demo link)

1. Import this repo at vercel.com/new (Framework preset: **Other**, no build command).
2. Add environment variable `DUFFEL_TOKEN` = your Duffel token.
3. Deploy, then open the `*.vercel.app` link.

## Test mode

With a `duffel_test_` token, results come from Duffel's sandbox airline **Duffel Airways**. That is expected.
For real airlines, use a live token from an approved Duffel account. No code changes needed.
