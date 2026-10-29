/**
 * Cloudflare Worker for img-helper
 *
 * Secrets / 程式碼內設定：
 *   CUSTOM_PASSCODE、SERPAPI_KEY、IMGBB_API_KEY
 *   （ImgBB Key 只放 Worker；前端不需手動輸入）
 *
 * 端點：
 *   POST JSON { imageUrl }              → Google Lens（exact + visual）
 *   POST ?action=imgbb-config           → 回傳 ImgBB key（供瀏覽器直連上傳，避開 Worker IP 被擋）
 *   POST multipart ?action=imgbb        → Worker 代轉上傳（備援；改以 base64）
 *
 * 說明：
 *   ImgBB 網站正常時，api.imgbb.com 仍可能對 Cloudflare Worker IP
 *   回傳「currently down for maintenance」。因此優先由瀏覽器直連上傳。
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

    if (!IMGBB_API_KEY || IMGBB_API_KEY === 'CHANGE_ME_IMGBB_API_KEY') {
      // 搜尋仍可用；只有上傳需要 ImgBB key
    }

    const reqUrl = new URL(request.url);
    const action = reqUrl.searchParams.get('action') || '';
    const contentType = request.headers.get('content-type') || '';

    // 給前端瀏覽器直連 ImgBB 用（避開 Worker IP 被誤判 maintenance）
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

    if (action === 'imgbb' || contentType.includes('multipart/form-data')) {
      try {
        if (!IMGBB_API_KEY || IMGBB_API_KEY === 'CHANGE_ME_IMGBB_API_KEY') {
          return json(
            { error: 'Worker missing IMGBB_API_KEY' },
            500,
            corsHeaders
          );
        }

        const form = await request.formData();
        const file = form.get('image') || form.get('file') || form.get('fileToUpload');
        if (!file || typeof file === 'string') {
          return json({ error: 'Missing image file' }, 400, corsHeaders);
        }

        const expirationRaw = form.get('expiration');
        const expiration = Number(expirationRaw) > 0 ? Number(expirationRaw) : 300;

        // 用 base64 上傳，比直接轉傳 binary 較不易被擋
        const buffer = await file.arrayBuffer();
        const base64 = arrayBufferToBase64(buffer);

        const imgbbForm = new FormData();
        imgbbForm.append('key', IMGBB_API_KEY);
        imgbbForm.append('image', base64);
        imgbbForm.append('name', file.name || 'upload');
        imgbbForm.append('expiration', String(expiration));

        const imgbbRes = await fetch('https://api.imgbb.com/1/upload', {
          method: 'POST',
          body: imgbbForm,
          headers: {
            Accept: 'application/json',
          },
        });
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
              status: imgbbRes.status,
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

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
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
