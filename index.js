require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

// Routes
const authRoutes = require("./routes/auth");
const bapbRoutes = require("./routes/bapb");
const bappRoutes = require("./routes/bapp");
const docsRoutes = require("./routes/documents");
const uploadRoutes = require("./routes/upload");
const notificationsRoutes = require("./routes/notifications");

const app = express();
const PORT = process.env.PORT || 4000;

/* =====================================================
   1️⃣ CORS CONFIG (WAJIB PALING ATAS)
===================================================== */
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  "https://storied-dango-ac0686.netlify.app",
  "https://digiba-asah.netlify.app"
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow Postman / curl / server-to-server
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      } else {
        return callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// HANDLE PREFLIGHT REQUEST (INI KUNCI FIX ERROR KAMU)
app.options("*", cors());

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
const isDevelopment = process.env.NODE_ENV === "development";

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 menit
  max: isDevelopment ? 5000 : 3000,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Terlalu banyak permintaan, silakan coba lagi nanti.",
  },
});

app.use(apiLimiter);

/* =====================================================
   5️⃣ STATIC FILES
===================================================== */
app.use("/uploads", express.static("uploads"));

/* =====================================================
   6️⃣ ROUTES
===================================================== */
app.use("/api/auth", authRoutes);
app.use("/api/bapb", bapbRoutes);
app.use("/api/bapp", bappRoutes);
app.use("/api/documents", docsRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/notifications", notificationsRoutes);

/* =====================================================
   7️⃣ HEALTH CHECK
===================================================== */
app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    message: "Backend running successfully",
    timestamp: new Date().toISOString(),
  });
});

/* =====================================================
   8️⃣ GLOBAL ERROR HANDLER
===================================================== */
app.use((err, req, res, next) => {
  console.error("ERROR:", err.message);

  if (err.message === "Not allowed by CORS") {
    return res.status(403).json({
      message: "CORS error: Origin not allowed",
    });
  }

  res.status(500).json({
    message: "Internal server error",
    error: err.message,
  });
});

/* =====================================================
   9️⃣ START SERVER
===================================================== */
app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
  console.log(`🌍 Allowed origins:`);
  allowedOrigins.forEach((o) => console.log(`   - ${o}`));
});
