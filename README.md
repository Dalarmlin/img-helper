# img-helper

極簡暗色系單頁前端，用於呼叫 Cloudflare Worker 進行以圖搜圖。供教學使用。

## 功能

- Passcode 通過 `X-Access-Passcode` 標頭驗證，並自動存入 `localStorage`
- 支援兩種圖片來源：公開網址，或本機上傳
- 本機上傳會先經 Worker 代轉 ImgBB（`expiration=300`，約 5 分鐘自動刪除），取得公開網址後再搜尋
- 輸入網址 / 選擇檔案後即時預覽
- 呼叫 Cloudflare Worker API，渲染 exact / visual 結果卡片
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

請在 `index.html` 自行設定你的 Worker 位址，例如：

```js
const WORKER_URL = 'https://your-worker.example.workers.dev';
```

請確認該 Worker：

- 接受 `POST` 請求
- 驗證標頭 `X-Access-Passcode`
- 搜尋請求 body：`{ "imageUrl": "https://..." }`（也相容 `image_url`）
- Worker 會同時查 `exact_matches` 與 `visual_matches`（`hl=zh-tw`、`country=tw`、`auto_crop=false`）
- `POST ?action=imgbb` multipart：由 Worker 使用內建 `IMGBB_API_KEY` 代轉上傳
- 密碼錯誤時回傳 `401`

本 repo 附有可部署的 `worker.js`。請在 Worker 設定（或 Secrets）：

```bash
npx wrangler secret put CUSTOM_PASSCODE
npx wrangler secret put SERPAPI_KEY
npx wrangler secret put IMGBB_API_KEY
```

前端不需輸入 ImgBB Key；Key 只放在 Worker。

## 注意事項

- 供教學使用
- Passcode 存在使用者本機瀏覽器，清除網站資料後需重新輸入
- 圖片網址必須為可公開存取的 `http(s)` 連結
- 上傳圖片上限 5 MB；ImgBB 圖會在約 5 分鐘後自動刪除
