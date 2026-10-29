/**
 * Cloudflare Worker for img-helper
 *
 * 建議把密碼與 API Key 放進 Workers Secrets：
 *   CUSTOM_PASSCODE
 *   SERPAPI_KEY
 *
 * 支援：
 *   { "imageUrl": "https://..." } 或 { "image_url": "https://..." }
 *   { "image_base64": "<base64>", "mime_type": "image/jpeg" }
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

    const CUSTOM_PASSCODE = env.CUSTOM_PASSCODE;
    const SERPAPI_KEY = env.SERPAPI_KEY;

    if (!CUSTOM_PASSCODE || !SERPAPI_KEY) {
      return json(
        { error: 'Server misconfigured: missing secrets' },
        500,
        corsHeaders
      );
    }

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

      let lensQuery;

      if (imageBase64) {
        const imageId = await uploadImageToSerpApi(
          imageBase64,
          mimeType,
          SERPAPI_KEY
        );
        lensQuery = `engine=google_lens&image_id=${encodeURIComponent(imageId)}&api_key=${encodeURIComponent(SERPAPI_KEY)}`;
      } else if (imageUrl) {
        lensQuery = `engine=google_lens&url=${encodeURIComponent(imageUrl)}&api_key=${encodeURIComponent(SERPAPI_KEY)}`;
      } else {
        return json(
          { error: 'Missing imageUrl or image_base64' },
          400,
          corsHeaders
        );
      }

      const apiResponse = await fetch(
        `https://serpapi.com/search.json?${lensQuery}`
      );
      const data = await apiResponse.json();

      return new Response(JSON.stringify(data), {
        status: apiResponse.ok ? 200 : apiResponse.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
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

  // 前端允許最大 3000 KB（若 SerpApi 拒收過大檔案，會回傳其錯誤訊息）
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
