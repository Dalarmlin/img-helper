/**
 * Cloudflare Worker for img-helper
 *
 * Secrets / 程式碼內設定：
 *   CUSTOM_PASSCODE、SERPAPI_KEY、IMGBB_API_KEY
 *   （ImgBB Key 只放 Worker，前端不需輸入）
 *
 * 端點：
 *   POST JSON { imageUrl }         → Google Lens（exact + visual）
 *   POST multipart ?action=imgbb   → 代轉上傳到 ImgBB（expiration 預設 300 秒）
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
    // 也可直接改成字串：'your_imgbb_api_key'
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
    const contentType = request.headers.get('content-type') || '';

    if (action === 'imgbb' || contentType.includes('multipart/form-data')) {
      try {
        const form = await request.formData();
        const file = form.get('image') || form.get('file') || form.get('fileToUpload');
        if (!file || typeof file === 'string') {
          return json({ error: 'Missing image file' }, 400, corsHeaders);
        }

        const expirationRaw = form.get('expiration');
        const expiration = Number(expirationRaw) > 0 ? Number(expirationRaw) : 300;

        if (!IMGBB_API_KEY || IMGBB_API_KEY === 'CHANGE_ME_IMGBB_API_KEY') {
          return json(
            {
              error:
                'Worker missing IMGBB_API_KEY. Set it in Worker code or Secrets.',
            },
            500,
            corsHeaders
          );
        }

        const imgbbForm = new FormData();
        imgbbForm.append('image', file, file.name || 'upload.jpg');
        imgbbForm.append('name', file.name || 'upload');

        const imgbbRes = await fetch(
          `https://api.imgbb.com/1/upload?key=${encodeURIComponent(IMGBB_API_KEY)}&expiration=${expiration}`,
          { method: 'POST', body: imgbbForm }
        );
        const imgbbData = await imgbbRes.json();
        const publicUrl =
          (imgbbData.data && (imgbbData.data.url || imgbbData.data.display_url)) ||
          '';

        if (!imgbbRes.ok || !imgbbData.success || !publicUrl) {
          return json(
            {
              error:
                (imgbbData.error && imgbbData.error.message) ||
                'ImgBB API upload failed',
            },
            502,
            corsHeaders
          );
        }

        return json({ url: publicUrl, imageUrl: publicUrl }, 200, corsHeaders);
      } catch (err) {
        return json({ error: err.message || String(err) }, 500, corsHeaders);
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
