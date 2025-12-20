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

/* =======================
   1️⃣ CORS CONFIG
======================= */
const allowedOrigins = [
  "http://localhost:5173",
  "https://digiba-asah.netlify.app",
  "https://storied-dango-ac0686.netlify.app",
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

/* =======================
   2️⃣ PREFLIGHT FIX (NO CRASH)
======================= */
app.use((req, res, next) => {
  if (req.method === "OPTIONS") {
    res.header("Access-Control-Allow-Origin", req.headers.origin);
    res.header(
      "Access-Control-Allow-Methods",
      "GET,POST,PUT,DELETE,OPTIONS"
    );
    res.header(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization"
    );
    return res.sendStatus(204);
  }
  next();
});

/* =======================
   3️⃣ BODY PARSER
======================= */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* =======================
   4️⃣ SECURITY
======================= */
app.use(helmet());

/* =======================
   5️⃣ RATE LIMIT
======================= */
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3000,
});
app.use(apiLimiter);

/* =======================
   6️⃣ STATIC
======================= */
app.use("/uploads", express.static("uploads"));

/* =======================
   7️⃣ ROUTES
======================= */
app.use("/api/auth", authRoutes);
app.use("/api/bapb", bapbRoutes);
app.use("/api/bapp", bappRoutes);
app.use("/api/documents", docsRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/notifications", notificationsRoutes);

/* =======================
   8️⃣ HEALTH CHECK
======================= */
app.get("/api/health", (req, res) => {
  res.json({ status: "OK" });
});

/* =======================
   9️⃣ ERROR HANDLER
======================= */
app.use((err, req, res, next) => {
  console.error("ERROR:", err.message);
  if (err.message === "Not allowed by CORS") {
    return res.status(403).json({ message: "CORS blocked" });
  }
  res.status(500).json({ message: "Server error" });
});

/* =======================
   🔟 START SERVER
======================= */
app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});
