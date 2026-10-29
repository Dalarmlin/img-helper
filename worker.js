/**
 * Cloudflare Worker for img-helper
 *
 * Secrets / 程式碼內設定：
 *   CUSTOM_PASSCODE、SERPAPI_KEY
 *
 * 端點：
 *   POST JSON { imageUrl }           → Google Lens（exact + visual）
 *   POST multipart ?action=host      → 以原始檔轉送臨時圖床，回傳公開網址
 *                                      （不用 base64，避免人臉比對失真）
 *
 * 圖床策略（皆傳原始 binary）：
 *   1) imgdb.io（ttl=300 秒 ≈ 5 分鐘）
 *   2) tmpdrop（ttl=1h）備援
 */

export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Access-Passcode',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405, corsHeaders);
    }

    // ==========================================
    // 請在這裡修改你的設定（或改用 Workers Secrets）
    // ==========================================
    const CUSTOM_PASSCODE =
      (env && env.CUSTOM_PASSCODE) || 'CHANGE_ME_PASSCODE';
    const SERPAPI_KEY = (env && env.SERPAPI_KEY) || 'CHANGE_ME_SERPAPI_KEY';
    // ==========================================

    const clientPasscode = request.headers.get('X-Access-Passcode');
    if (clientPasscode !== CUSTOM_PASSCODE) {
      return json(
        { error: 'Unauthorized: Invalid Passcode' },
        401,
        corsHeaders
      );
    }

    const reqUrl = new URL(request.url);
    const action = reqUrl.searchParams.get('action') || '';
    const contentType = request.headers.get('content-type') || '';

    if (action === 'host' || contentType.includes('multipart/form-data')) {
      try {
        const form = await request.formData();
        const file =
          form.get('image') || form.get('file') || form.get('fileToUpload');
        if (!file || typeof file === 'string') {
          return json({ error: 'Missing image file' }, 400, corsHeaders);
        }

        const hosted = await hostOriginalImage(file);
        return json(
          {
            url: hosted.url,
            imageUrl: hosted.url,
            provider: hosted.provider,
            expires_in: hosted.expiresIn,
          },
          200,
          corsHeaders
        );
      } catch (err) {
        return json({ error: err.message || String(err) }, 502, corsHeaders);
      }
    }

    try {
      const body = await request.json();
      const imageUrl = body.imageUrl || body.image_url || '';

      if (!imageUrl) {
        return json({ error: 'Missing imageUrl' }, 400, corsHeaders);
      }

      const source = { url: imageUrl };

      const [exactData, visualData] = await Promise.all([
        searchGoogleLens(SERPAPI_KEY, source, 'exact_matches'),
        searchGoogleLens(SERPAPI_KEY, source, 'visual_matches'),
      ]);

      const exactMatches = Array.isArray(exactData.exact_matches)
        ? exactData.exact_matches
        : [];
      const visualMatches = Array.isArray(visualData.visual_matches)
        ? visualData.visual_matches
        : [];

      const merged = [
        ...exactMatches.map((m) => ({ ...m, match_type: 'exact' })),
        ...visualMatches.map((m) => ({ ...m, match_type: 'visual' })),
      ];

      return json(
        {
          exact_matches: exactMatches,
          visual_matches: visualMatches,
          matches: merged,
          imageUrl,
          search_information:
            exactData.search_information || visualData.search_information || null,
          error: exactData.error || visualData.error || undefined,
        },
        200,
        corsHeaders
      );
    } catch (err) {
      return json({ error: err.message || String(err) }, 500, corsHeaders);
    }
  },
};

function json(payload, status, corsHeaders) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function hostOriginalImage(file) {
  const filename = file.name || 'upload.jpg';
  const errors = [];

  // 1) imgdb.io：ttl=300（約 5 分鐘），原始檔 FormData
  try {
    const form = new FormData();
    form.append('file', file, filename);
    form.append('ttl', '300');

    const res = await fetch('https://imgdb.io/api/v1/upload', {
      method: 'POST',
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    const url = data.url || '';
    if (res.ok && /^https?:\/\//i.test(url)) {
      return { url, provider: 'imgdb', expiresIn: 300 };
    }
    errors.push(`imgdb: ${data.error || res.status}`);
  } catch (err) {
    errors.push(`imgdb: ${err.message || err}`);
  }

  // 2) tmpdrop：ttl=1h 備援，原始檔
  try {
    const form = new FormData();
    form.append('file', file, filename);
    form.append('ttl', '1h');

    const res = await fetch('https://tmpdrop.solardev.online/upload', {
      method: 'POST',
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    const url = data.url || '';
    if (res.ok && /^https?:\/\//i.test(url)) {
      return { url, provider: 'tmpdrop', expiresIn: 3600 };
    }
    errors.push(`tmpdrop: ${data.error || res.status}`);
  } catch (err) {
    errors.push(`tmpdrop: ${err.message || err}`);
  }

  // 3) img402：原始檔備援
  try {
    const form = new FormData();
    form.append('file', file, filename);

    const res = await fetch('https://img402.dev/api/free', {
      method: 'POST',
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    const url = data.url || '';
    if (res.ok && /^https?:\/\//i.test(url)) {
      return { url, provider: 'img402', expiresIn: null };
    }
    errors.push(`img402: ${data.error || res.status}`);
  } catch (err) {
    errors.push(`img402: ${err.message || err}`);
  }

  throw new Error(`臨時圖床上傳失敗：${errors.join(' | ')}`);
}

async function searchGoogleLens(apiKey, source, type) {
  const params = new URLSearchParams({
    engine: 'google_lens',
    type,
    hl: 'zh-tw',
    country: 'tw',
    auto_crop: 'false',
    api_key: apiKey,
    url: source.url,
  });

  const response = await fetch(
    `https://serpapi.com/search.json?${params.toString()}`
  );
  return response.json();
}
