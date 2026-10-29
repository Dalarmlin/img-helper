/**
 * Cloudflare Worker for img-helper
 *
 * 可直接貼到 Cloudflare Workers；密碼 / Key 建議改成 Secrets：
 *   CUSTOM_PASSCODE、SERPAPI_KEY、IMGBB_API_KEY（可選）
 *
 * 端點：
 *   POST JSON { imageUrl }         → Google Lens（exact + visual）
 *   POST multipart ?action=imgbb   → 代轉上傳到 ImgBB（expiration=300 秒）
 *
 * 準度策略：
 *   1) exact_matches + visual_matches
 *   2) hl=zh-tw、country=tw
 *   3) auto_crop=false
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
    const IMGBB_API_KEY = (env && env.IMGBB_API_KEY) || '';
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

        let publicUrl = '';

        if (IMGBB_API_KEY) {
          const imgbbForm = new FormData();
          imgbbForm.append('image', file, file.name || 'upload.jpg');
          imgbbForm.append('name', file.name || 'upload');

          const imgbbRes = await fetch(
            `https://api.imgbb.com/1/upload?key=${encodeURIComponent(IMGBB_API_KEY)}&expiration=${expiration}`,
            { method: 'POST', body: imgbbForm }
          );
          const imgbbData = await imgbbRes.json();
          publicUrl =
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
        } else {
          // 無 API key：走 ImgBB 匿名 json 上傳，5 分鐘自動刪除
          const anonForm = new FormData();
          anonForm.append('source', file, file.name || 'upload.jpg');
          anonForm.append('type', 'file');
          anonForm.append('action', 'upload');
          anonForm.append('expiration', 'PT5M');

          const anonRes = await fetch('https://imgbb.com/json', {
            method: 'POST',
            body: anonForm,
          });
          const anonData = await anonRes.json();
          publicUrl =
            (anonData.image && (anonData.image.url || anonData.image.display_url)) ||
            (anonData.data &&
              anonData.data.image &&
              (anonData.data.image.url || anonData.data.image.display_url)) ||
            '';

          if (!anonRes.ok || !publicUrl) {
            return json(
              { error: 'ImgBB anonymous upload failed' },
              502,
              corsHeaders
            );
          }
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
