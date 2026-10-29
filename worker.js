/**
 * Cloudflare Worker for img-helper
 *
 * 可直接貼到 Cloudflare Workers；密碼 / Key 建議改成 Secrets：
 *   CUSTOM_PASSCODE、SERPAPI_KEY
 *
 * 準度策略：
 *   1) 先查 exact_matches（完全相同圖片）
 *   2) 再查 visual_matches（視覺相似）
 *   3) 使用台灣語系 hl=zh-tw、country=tw
 *   4) auto_crop=false，避免裁切後對錯主體
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

    try {
      const body = await request.json();
      const imageUrl = body.imageUrl || body.image_url || '';
      const imageBase64 = body.image_base64 || body.imageBase64 || '';
      const mimeType = body.mime_type || body.mimeType || 'image/jpeg';

      let imageId = '';
      if (imageBase64) {
        imageId = await uploadImageToSerpApi(imageBase64, mimeType, SERPAPI_KEY);
      } else if (!imageUrl) {
        return json(
          { error: 'Missing imageUrl or image_base64' },
          400,
          corsHeaders
        );
      }

      const source = imageId
        ? { image_id: imageId }
        : { url: imageUrl };

      // 並行查 Exact + Visual，提升「找來源」準度
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

      // 前端相容：visual_matches 仍保留；同時回傳 exact_matches
      // 也把 exact 放在前面合併成 matches，方便舊前端
      const merged = [
        ...exactMatches.map((m) => ({ ...m, match_type: 'exact' })),
        ...visualMatches.map((m) => ({ ...m, match_type: 'visual' })),
      ];

      return json(
        {
          exact_matches: exactMatches,
          visual_matches: visualMatches,
          matches: merged,
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
  });

  if (source.image_id) {
    params.set('image_id', source.image_id);
  } else if (source.url) {
    params.set('url', source.url);
  }

  const response = await fetch(
    `https://serpapi.com/search.json?${params.toString()}`
  );
  return response.json();
}

function extensionFromMime(mimeType) {
  const map = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  };
  return map[(mimeType || '').toLowerCase()] || 'jpg';
}

async function uploadImageToSerpApi(base64, mimeType, apiKey) {
  const binary = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

  if (binary.byteLength > 3000 * 1024) {
    throw new Error('Image too large (max 3000 KB)');
  }

  const form = new FormData();
  const filename = `upload.${extensionFromMime(mimeType)}`;
  form.append(
    'image',
    new Blob([binary], { type: mimeType || 'image/jpeg' }),
    filename
  );
  form.append('api_key', apiKey);

  const uploadResponse = await fetch('https://serpapi.com/image', {
    method: 'POST',
    body: form,
  });

  const uploadData = await uploadResponse.json();
  if (!uploadResponse.ok || !uploadData.image_id) {
    throw new Error(
      uploadData.error ||
        uploadData.message ||
        'Failed to upload image to SerpApi'
    );
  }

  return uploadData.image_id;
}
