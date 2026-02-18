import "dotenv/config";
import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(join(__dirname, "public")));
app.get("/falailogo.png", (_req, res) => {
  res.sendFile(join(__dirname, "falailogo.png"));
});

// Server-side token proxy — keeps FAL_KEY out of the browser
app.post("/api/fal/realtime-token", async (req, res) => {
  const { app: falApp } = req.body;
  // fal validates tokens by alias (the second path segment), not the full app path
  // e.g. "fal-ai/flux-2/klein" → alias "flux-2"
  const appPath = falApp ?? "fal-ai/flux-2/klein";
  const alias = appPath.split("/")[1] ?? appPath;
  try {
    const response = await fetch("https://rest.alpha.fal.ai/tokens/", {
      method: "POST",
      headers: {
        Authorization: `Key ${process.env.FAL_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        allowed_apps: [alias],
        token_expiration: 120,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("Token error:", text);
      return res.status(response.status).send(text);
    }

    // fal returns a JSON-encoded string — unwrap it so the client gets a plain token
    const raw = await response.text();
    let token;
    try {
      token = JSON.parse(raw);
      // handle legacy wrapped response: { detail: "<token>" }
      if (typeof token === "object" && token.detail) token = token.detail;
    } catch {
      token = raw;
    }
    res.send(typeof token === "string" ? token : JSON.stringify(token));
  } catch (err) {
    console.error("Token fetch failed:", err);
    res.status(500).send("Token generation failed");
  }
});

const server = app.listen(PORT, () => {
  console.log(`Klein Realtime running at http://localhost:${PORT}`);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Kill the existing process and retry.`);
  } else {
    console.error("Server error:", err);
  }
  process.exit(1);
});
