/**
 * Cloudflare Worker for img-helper
 *
 * Secrets / 程式碼內設定：
 *   CUSTOM_PASSCODE、SERPAPI_KEY、IMGBB_API_KEY
 *
 * 端點：
 *   POST JSON { imageUrl }        → Google Lens（exact + visual）
 *   POST ?action=imgbb-config     → 回傳 ImgBB key（瀏覽器以原始檔 FormData 直連上傳）
 *
 * 注意：不使用 base64 上傳，以免人臉／以圖搜圖準度下降。
 * 也不由 Worker 代轉檔案（Worker IP 易被 ImgBB 擋）。
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
    const IMGBB_API_KEY = (env && env.IMGBB_API_KEY) || 'CHANGE_ME_IMGBB_API_KEY';
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

    if (action === 'imgbb-config') {
      if (!IMGBB_API_KEY || IMGBB_API_KEY === 'CHANGE_ME_IMGBB_API_KEY') {
        return json(
          { error: 'Worker missing IMGBB_API_KEY' },
          500,
          corsHeaders
        );
      }
      return json(
        {
          key: IMGBB_API_KEY,
          expiration: 300,
          upload_url: 'https://api.imgbb.com/1/upload',
        },
        200,
        corsHeaders
      );
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
