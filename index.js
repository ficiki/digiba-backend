require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

// ROUTES
const authRoutes = require("./routes/auth");
const bapbRoutes = require("./routes/bapb");
const bappRoutes = require("./routes/bapp");
const docsRoutes = require("./routes/documents");
const uploadRoutes = require("./routes/upload");
const notificationsRoutes = require("./routes/notifications");

const app = express();
const PORT = process.env.PORT || 4000;

/* =====================================================
   1️⃣ GLOBAL CORS HANDLER (PALING ATAS — KUNCI UTAMA)
===================================================== */
const ALLOWED_ORIGIN = "https://digiba-asah.netlify.app";

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin === ALLOWED_ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
  res.setHeader("Access-Control-Allow-Credentials", "true");

  // ⛔ TANGANI PREFLIGHT DI SINI (WAJIB)
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

/* =====================================================
   2️⃣ BODY PARSER
===================================================== */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* =====================================================
   3️⃣ SECURITY
===================================================== */
app.use(helmet());

/* =====================================================
   4️⃣ RATE LIMIT
===================================================== */
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 3000,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

/* =====================================================
   5️⃣ ROUTES
===================================================== */
app.use("/api/auth", authRoutes);
app.use("/api/bapb", bapbRoutes);
app.use("/api/bapp", bappRoutes);
app.use("/api/documents", docsRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/notifications", notificationsRoutes);

/* =====================================================
   6️⃣ HEALTH CHECK
===================================================== */
app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    time: new Date().toISOString(),
  });
});

/* =====================================================
   7️⃣ 404 HANDLER (PENTING AGAR TETAP ADA CORS)
===================================================== */
app.use((req, res) => {
  res.status(404).json({
    message: "Route not found",
  });
});

/* =====================================================
   8️⃣ ERROR HANDLER
===================================================== */
app.use((err, req, res, next) => {
  console.error("SERVER ERROR:", err.message);
  res.status(500).json({
    message: "Internal server error",
  });
});

/* =====================================================
   9️⃣ START SERVER
===================================================== */
app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});
