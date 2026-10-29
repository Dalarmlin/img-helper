# img-helper

極簡暗色系單頁前端，用於呼叫 Cloudflare Worker 進行以圖搜圖。僅供個人與朋友私下使用。

## 功能

- Passcode 通過 `X-Access-Passcode` 標頭驗證，並自動存入 `localStorage`
- 支援兩種圖片來源：公開網址，或本機上傳
- 輸入網址 / 選擇檔案後即時預覽
- 呼叫 Cloudflare Worker API，渲染 `visual_matches` 結果卡片
- 自動標示常見社群平台來源（Instagram、Facebook、TikTok、X/Twitter、Threads、LinkedIn）

## 檔案結構

```
img-helper/
├── index.html   # 完整 SPA（HTML / CSS / JS）
└── README.md
```

## 部署到 GitHub Pages

### 1. 建立 GitHub 儲存庫

1. 到 [GitHub](https://github.com/new) 建立新的公開（或私人）儲存庫，例如 `img-helper`
2. 將本專案推送到該儲存庫：

```bash
git init
git add index.html README.md
git commit -m "Initial commit: img-helper SPA"
git branch -M main
git remote add origin https://github.com/<你的帳號>/img-helper.git
git push -u origin main
```

### 2. 啟用 GitHub Pages

1. 開啟儲存庫 → **Settings** → **Pages**
2. 在 **Build and deployment** 區塊：
   - **Source**：選擇 `Deploy from a branch`
   - **Branch**：選擇 `main`（或你使用的分支）
   - **Folder**：選擇 `/ (root)`
3. 按下 **Save**

約等待一到兩分鐘後，網站會出現在：

```
https://<你的帳號>.github.io/img-helper/
```

若儲存庫名稱不是 `img-helper`，網址會對應實際儲存庫名稱。

### 3. 使用方式

1. 打開部署後的網頁
2. 輸入通行密碼（Passcode）
3. 選擇「網址」貼上公開圖片連結，或切換「上傳」選本機圖片
4. 點擊「開始比對分析」

密碼會自動保存在瀏覽器 `localStorage`，下次開啟會自動填入。

## 後端設定

前端已寫死 Worker 位址：

```js
const WORKER_URL = 'https://img-helper.brianlin2021.workers.dev';
```

請確認該 Worker：

- 接受 `POST` 請求
- 驗證標頭 `X-Access-Passcode`
- 請求 body 為 JSON，兩種模式其一：
  - 網址：`{ "image_url": "https://..." }`
  - 上傳：`{ "image_base64": "<base64>", "mime_type": "image/jpeg" }`
- 成功時回傳含 `visual_matches` 陣列的 JSON
- 密碼錯誤時回傳 `401`

若 Worker 有 CORS 限制，請允許來自 GitHub Pages 網域的請求，並允許自訂標頭 `X-Access-Passcode`。

## 注意事項

- 此工具僅供私人使用，請勿公開分享 Passcode
- Passcode 存在使用者本機瀏覽器，清除網站資料後需重新輸入
- 圖片網址必須為可公開存取的 `http(s)` 連結
- 上傳圖片建議小於 5MB；Worker 需支援 `image_base64` 才能使用上傳模式
