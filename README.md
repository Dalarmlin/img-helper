# img-helper

A minimal dark-mode single-page app for reverse image search. The frontend talks to a Cloudflare Worker, which proxies Google Lens results through SerpApi.

This project is intended for teaching and learning: exploring reverse image search APIs, browser uploads to temporary hosts, Passcode-protected Worker endpoints, and a simple GitHub Pages + Workers deployment workflow. It is not meant as a production-ready commercial product.

## Features

- Passcode auth via the `X-Access-Passcode` header, saved in `localStorage`
- Two image sources: public URL, or local file upload
- Local uploads send the original file through the Worker to a temporary image host (preferred: imgdb.io with `ttl=300`)
- Live preview after entering a URL or choosing a file
- Renders Exact Match and Visual Match result cards from the Worker API
- Highlights common social platforms (Instagram, Facebook, TikTok, X/Twitter, Threads, LinkedIn)

## Project layout

```
img-helper/
├── index.html       # Frontend SPA (HTML / CSS / JS)
├── worker.js        # Cloudflare Worker
├── wrangler.jsonc   # Wrangler deploy config
├── package.json
└── README.md
```

## Deploy the frontend to GitHub Pages

### 1. Create a GitHub repository

1. Create a new repository on [GitHub](https://github.com/new), for example `img-helper`
2. Push this project:

```bash
git init
git add .
git commit -m "Initial commit: img-helper SPA"
git branch -M main
git remote add origin https://github.com/<your-username>/img-helper.git
git push -u origin main
```

### 2. Enable GitHub Pages

1. Open the repository → **Settings** → **Pages**
2. Under **Build and deployment**:
   - **Source**: `Deploy from a branch`
   - **Branch**: `main` (or your branch)
   - **Folder**: `/ (root)`
3. Click **Save**

After a minute or two, the site should be available at:

```
https://<your-username>.github.io/img-helper/
```

If the repository name is different, the URL path will match that name. This project includes a `.nojekyll` file so Pages serves the static SPA correctly.

### 3. How to use

1. Open the deployed page
2. Enter the Passcode
3. Paste a public image URL, or switch to **Upload** and choose a local image
4. Click **Start analysis**

The Passcode is stored in browser `localStorage` and will be filled in automatically next time.

## Backend (Cloudflare Worker)

Set your Worker URL in `index.html`, for example:

```js
const WORKER_URL = 'https://your-worker.example.workers.dev';
```

The Worker should:

- Accept `POST` requests
- Validate the `X-Access-Passcode` header
- Accept search body `{ "imageUrl": "https://..." }` (also accepts `image_url`)
- Query both `exact_matches` and `visual_matches` (`hl=zh-tw`, `country=tw`, `auto_crop=false`)
- Support `POST ?action=host` with multipart form data to upload the original file to a temporary host and return a public URL
- Return `401` when the Passcode is invalid

This repo includes a ready-to-deploy `worker.js`. After changing the Worker, deploy with:

```bash
npm install
npm run deploy
```

Secrets (set once):

```bash
npx wrangler secret put CUSTOM_PASSCODE
npx wrangler secret put SERPAPI_KEY
```

## Notes

- Built for teaching and learning reverse image search, Workers, and static hosting—not for production-scale or commercial use
- Passcode is stored only in the browser; clearing site data requires re-entering it
- Image URLs must be publicly reachable over `http(s)`
- Upload limit is 5 MB; temporary hosts usually expire after about 5 minutes (fallback hosts may keep files for up to 1 hour)
