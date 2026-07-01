const express = require("express");
const fetch = require("node-fetch");
const multer = require("multer");

const app = express();
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage() });

const CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY;
const CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;

// В памяти храним токен (для теста; позже можно заменить на базу данных)
let savedToken = null;

app.get("/", (req, res) => {
  res.send("TikTok API server is running");
});

// Шаг 1: ссылка для авторизации начальника
app.get("/auth", (req, res) => {
  const url = `https://www.tiktok.com/v2/auth/authorize/?client_key=${CLIENT_KEY}&response_type=code&scope=user.info.basic,video.publish,video.upload&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=xyz`;
  res.redirect(url);
});

// Шаг 2: TikTok перенаправляет сюда с ?code=...
app.get("/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send("No code provided");

  try {
    const response = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: CLIENT_KEY,
        client_secret: CLIENT_SECRET,
        code: code,
        grant_type: "authorization_code",
        redirect_uri: REDIRECT_URI,
      }),
    });

    const data = await response.json();
    savedToken = data; // { access_token, refresh_token, ... }
    console.log("Token received:", data);
    res.send("Авторизация прошла успешно! Можешь закрыть эту вкладку.");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error exchanging code for token");
  }
});

// Шаг 3: загрузка видео
app.post("/upload", upload.single("video"), async (req, res) => {
  if (!savedToken) return res.status(401).send("Not authorized yet. Go to /auth first.");
  if (!req.file) return res.status(400).send("No video file uploaded");

  try {
    // Инициализация загрузки
    const initRes = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${savedToken.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        post_info: {
          title: req.body.title || "Uploaded via API",
          privacy_level: "SELF_ONLY", // измени на нужный уровень
        },
        source_info: {
          source: "FILE_UPLOAD",
          video_size: req.file.size,
          chunk_size: req.file.size,
          total_chunk_count: 1,
        },
      }),
    });

    const initData = await initRes.json();

    // Загружаем сам файл видео по upload_url
    await fetch(initData.data.upload_url, {
      method: "PUT",
      headers: {
        "Content-Type": "video/mp4",
        "Content-Range": `bytes 0-${req.file.size - 1}/${req.file.size}`,
      },
      body: req.file.buffer,
    });

    res.json({ status: "uploaded", publish_id: initData.data.publish_id });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error uploading video");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
