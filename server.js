const path = require("path");
const express = require("express");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 8080);

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "aitookmyjob",
    timestamp: new Date().toISOString()
  });
});

app.listen(port, () => {
  // Keep this log simple for container logs.
  console.log(`aitookmyjob running on :${port}`);
});
