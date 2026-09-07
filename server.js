const express = require("express");
const multer = require("multer");
const QRCode = require("qrcode");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
// Secret Admin Password set to 0003 as requested
const ADMIN_PIN = process.env.ADMIN_PIN || "0003";

// UPI & Premium Download Settings
const UPI_ID = "shivampund814@oksbi";
const APP_PRICE = "10.00";
const PAYEE_NAME = "maz Gaaav App";

const DOWNLOADS_DIR = path.join(__dirname, "downloads");
const META_FILE = path.join(DOWNLOADS_DIR, "apk-meta.json");
const PAYMENTS_FILE = path.join(DOWNLOADS_DIR, "payments.json");

// In-memory valid download tokens (expires in 15 minutes)
const validDownloadTokens = new Set();

// Ensure downloads directory exists
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

// Helpers for reading/writing metadata
function getMeta() {
  try {
    if (fs.existsSync(META_FILE)) {
      const data = JSON.parse(fs.readFileSync(META_FILE, "utf8"));
      // Verify physical file actually exists
      if (data.exists && data.filename) {
        const filePath = path.join(DOWNLOADS_DIR, data.filename);
        if (!fs.existsSync(filePath)) {
          data.exists = false;
        }
      }
      return data;
    }
  } catch (err) {
    console.error("Error reading apk-meta.json:", err);
  }
  return {
    exists: false,
    filename: "",
    version: "",
    sizeBytes: 0,
    sizeFormatted: "",
    uploadDate: "",
    releaseNotes: "",
    downloadCount: 0
  };
}

function saveMeta(meta) {
  try {
    fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2), "utf8");
  } catch (err) {
    console.error("Error writing apk-meta.json:", err);
  }
}

// Helpers for reading/writing payments
function getPayments() {
  try {
    if (fs.existsSync(PAYMENTS_FILE)) {
      return JSON.parse(fs.readFileSync(PAYMENTS_FILE, "utf8"));
    }
  } catch (err) {
    console.error("Error reading payments.json:", err);
  }
  return [];
}

function savePayments(payments) {
  try {
    fs.writeFileSync(PAYMENTS_FILE, JSON.stringify(payments, null, 2), "utf8");
  } catch (err) {
    console.error("Error writing payments.json:", err);
  }
}

// Format file size helper
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  return mb.toFixed(1) + " MB";
}

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, DOWNLOADS_DIR);
  },
  filename: function (req, file, cb) {
    const safeVersion = (req.body.version || "latest").replace(/[^a-zA-Z0-9.-]/g, "_");
    const filename = `maz-gaaav-${safeVersion}.apk`;
    cb(null, filename);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 300 * 1024 * 1024 }, // Max 300 MB
  fileFilter: function (req, file, cb) {
    cb(null, true);
  }
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static assets
app.use("/assets", express.static(path.join(__dirname, "assets")));
app.use(express.static(__dirname, { index: false }));

// 1. Public Pages
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Private Admin Page (Secret URL)
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

// 2. API: Dynamic QR Code Generation for Direct ₹10 UPI Payment
app.get("/api/qr-code", async (req, res) => {
  try {
    const upiUri = `upi://pay?pa=${UPI_ID}&pn=${encodeURIComponent(PAYEE_NAME)}&am=${APP_PRICE}&cu=INR&tn=${encodeURIComponent("maz Gaaav APK Download")}`;

    const qrSvg = await QRCode.toString(upiUri, {
      type: "svg",
      margin: 1,
      color: {
        dark: "#0F172A",
        light: "#FFFFFF"
      }
    });

    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.send(qrSvg);
  } catch (err) {
    res.status(500).send("Error generating QR code");
  }
});

// Downloadable QR Code PNG for printing posters (₹10 UPI)
app.get("/api/qr-code/download", async (req, res) => {
  try {
    const upiUri = `upi://pay?pa=${UPI_ID}&pn=${encodeURIComponent(PAYEE_NAME)}&am=${APP_PRICE}&cu=INR&tn=${encodeURIComponent("maz Gaaav APK Download")}`;

    const qrBuffer = await QRCode.toBuffer(upiUri, {
      type: "png",
      width: 600,
      margin: 2,
      color: {
        dark: "#0F172A",
        light: "#FFFFFF"
      }
    });

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Disposition", 'attachment; filename="maz-gaaav-payment-qr.png"');
    res.send(qrBuffer);
  } catch (err) {
    res.status(500).send("Error generating PNG QR code");
  }
});

// 3. API: Verify Admin PIN
app.post("/api/verify-pin", (req, res) => {
  const { pin } = req.body;
  if (pin === ADMIN_PIN) {
    return res.json({ success: true, message: "PIN verified successfully" });
  }
  return res.status(401).json({ success: false, message: "चुकीचा पासवर्ड (Incorrect Password). कृपया पुन्हा प्रयत्न करा." });
});

// 4. API: Get Current APK & Payment Info
app.get("/api/apk-info", (req, res) => {
  const meta = getMeta();
  res.json({
    ...meta,
    price: `₹${APP_PRICE}`,
    upiId: UPI_ID,
    payeeName: PAYEE_NAME,
    upiUrl: `upi://pay?pa=${UPI_ID}&pn=${encodeURIComponent(PAYEE_NAME)}&am=${APP_PRICE}&cu=INR&tn=${encodeURIComponent("maz Gaaav APK Download")}`
  });
});

// 5. API: Verify Payment & Generate Download Token
app.post("/api/verify-payment", (req, res) => {
  const { mobile, utr } = req.body || {};

  if (!mobile || !/^[6-9]\d{9}$/.test(mobile.trim())) {
    return res.status(400).json({ success: false, error: "कृपया १० अंकी वैध मोबाईल नंबर टाका." });
  }

  if (!utr || !/^\d{12}$/.test(utr.trim())) {
    return res.status(400).json({ success: false, error: "कृपया GPay मधील १२ अंकी वैध UTR / UPI Reference Number टाका." });
  }

  const cleanUtr = utr.trim();
  const cleanMobile = mobile.trim();
  const payments = getPayments();

  // Check if UTR is already used to prevent duplicate downloads
  const alreadyUsed = payments.find(p => p.utr === cleanUtr);
  if (alreadyUsed) {
    return res.status(400).json({ success: false, error: "हा UTR नंबर आधीच वापरला गेला आहे! कृपया नवीन व्यवहार करा." });
  }

  // Generate secure 15-minute download token
  const token = "pay_" + Math.random().toString(36).substring(2) + "_" + Date.now();
  validDownloadTokens.add(token);

  // Auto-expire token after 15 minutes
  setTimeout(() => {
    validDownloadTokens.delete(token);
  }, 15 * 60 * 1000);

  // Record payment in payments.json
  const now = new Date();
  const formattedTime = now.toLocaleDateString("mr-IN", {
    day: "numeric",
    month: "short",
    year: "numeric"
  }) + " " + now.toLocaleTimeString("mr-IN", { hour: "2-digit", minute: "2-digit" });

  payments.unshift({
    mobile: cleanMobile,
    utr: cleanUtr,
    amount: `₹${APP_PRICE}`,
    upiId: UPI_ID,
    time: formattedTime,
    status: "Verified & Unlocked"
  });

  savePayments(payments);

  res.json({
    success: true,
    message: "पेमेंट यशस्वीरीत्या पडताळले!",
    token: token,
    downloadUrl: `/api/download-apk?token=${token}`
  });
});

// 6. API: Get Payment History (For Admin)
app.get("/api/admin/payments", (req, res) => {
  const pin = req.headers["x-admin-pin"] || req.query.pin;
  if (pin !== ADMIN_PIN) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  res.json(getPayments());
});

// 7. API: Upload APK (Protected by Secret PIN)
app.post("/api/upload-apk", (req, res) => {
  upload.single("apkFile")(req, res, (err) => {
    if (err) {
      return res.status(400).json({ success: false, message: `अपलोड त्रुटी (Upload Error): ${err.message}` });
    }

    const pin = req.headers["x-admin-pin"] || req.body.adminPin;
    if (pin !== ADMIN_PIN) {
      if (req.file) {
        fs.unlink(req.file.path, () => {});
      }
      return res.status(401).json({ success: false, message: "अनधिकृत प्रवेश! चुकीचा पासवर्ड." });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: "कृपया APK फाईल निवडा." });
    }

    const currentMeta = getMeta();

    // If an older different file existed, delete old file to save server space
    if (currentMeta.exists && currentMeta.filename && currentMeta.filename !== req.file.filename) {
      const oldFilePath = path.join(DOWNLOADS_DIR, currentMeta.filename);
      if (fs.existsSync(oldFilePath)) {
        try { fs.unlinkSync(oldFilePath); } catch (e) {}
      }
    }

    const version = req.body.version && req.body.version.trim() ? req.body.version.trim() : "v1.0.0";
    const releaseNotes = req.body.releaseNotes ? req.body.releaseNotes.trim() : "";

    const now = new Date();
    const formattedDate = now.toLocaleDateString("mr-IN", {
      day: "numeric",
      month: "short",
      year: "numeric"
    }) + " " + now.toLocaleTimeString("mr-IN", { hour: "2-digit", minute: "2-digit" });

    const newMeta = {
      exists: true,
      filename: req.file.filename,
      version: version,
      sizeBytes: req.file.size,
      sizeFormatted: formatBytes(req.file.size),
      uploadDate: formattedDate,
      releaseNotes: releaseNotes,
      downloadCount: currentMeta.filename === req.file.filename ? currentMeta.downloadCount : 0
    };

    saveMeta(newMeta);

    res.json({
      success: true,
      message: "APK फाईल यशस्वीरीत्या अपलोड झाली!",
      meta: newMeta
    });
  });
});

// 8. API: Delete APK (Protected by PIN)
app.post("/api/delete-apk", (req, res) => {
  const pin = req.headers["x-admin-pin"] || req.body.adminPin;
  if (pin !== ADMIN_PIN) {
    return res.status(401).json({ success: false, message: "अनधिकृत प्रवेश! चुकीचा पासवर्ड." });
  }

  const currentMeta = getMeta();
  if (currentMeta.exists && currentMeta.filename) {
    const filePath = path.join(DOWNLOADS_DIR, currentMeta.filename);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        console.error("Error deleting physical file:", err);
      }
    }
  }

  const emptyMeta = {
    exists: false,
    filename: "",
    version: "",
    sizeBytes: 0,
    sizeFormatted: "",
    uploadDate: "",
    releaseNotes: "",
    downloadCount: 0
  };

  saveMeta(emptyMeta);

  res.json({
    success: true,
    message: "APK फाईल सर्व्हरवरून यशस्वीरीत्या डिलीट करण्यात आली!",
    meta: emptyMeta
  });
});

// 9. SECURE APK Download Endpoint (Requires Paid Token or Admin PIN)
app.get("/api/download-apk", (req, res) => {
  const token = req.query.token;
  const pin = req.query.pin;

  // Verify access: Either admin with PIN, or user with valid payment token
  const isAdmin = pin === ADMIN_PIN;
  const hasValidToken = token && validDownloadTokens.has(token);

  if (!isAdmin && !hasValidToken) {
    return res.status(403).send(`
      <!DOCTYPE html>
      <html lang="mr">
      <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>पेमेंट आवश्यक आहे</title>
      <style>
        body { font-family: system-ui, sans-serif; text-align: center; padding: 40px 16px; background: #f8fafc; color: #0f172a; }
        .card { background: #fff; padding: 32px 24px; border-radius: 20px; max-width: 440px; margin: 0 auto; box-shadow: 0 10px 30px rgba(0,0,0,0.1); border: 1px solid #e2e8f0; }
        .badge { background: #fee2e2; color: #dc2626; font-weight: 700; font-size: 0.8rem; padding: 4px 12px; border-radius: 99px; }
        h2 { margin: 16px 0 8px; font-size: 1.4rem; }
        p { color: #64748b; font-size: 0.95rem; line-height: 1.5; margin-bottom: 24px; }
        .btn { display: inline-block; background: #059669; color: #fff; text-decoration: none; font-weight: 700; padding: 12px 24px; border-radius: 12px; font-size: 1rem; box-shadow: 0 4px 12px rgba(5,150,105,0.3); }
      </style>
      </head>
      <body>
        <div class="card">
          <span class="badge">🔒 थेट डाऊनलोड बंद आहे</span>
          <h2>₹१० चे पेमेंट आवश्यक आहे</h2>
          <p>maz Gaaav APK डाऊनलोड करण्यासाठी कृपया मुख्य पृष्ठावर जाऊन GPay द्वारे ₹१० भरा आणि UTR नंबर टाका.</p>
          <a href="/" class="btn">मुख्य पृष्ठावर जा & ₹१० भरा ➔</a>
        </div>
      </body>
      </html>
    `);
  }

  // If downloaded via token, consume token once
  if (hasValidToken && !isAdmin) {
    validDownloadTokens.delete(token);
  }

  const meta = getMeta();

  if (!meta.exists || !meta.filename) {
    return res.status(404).send(`
      <!DOCTYPE html>
      <html lang="mr">
      <head><meta charset="UTF-8"><title>APK उपलब्ध नाही</title>
      <style>body{font-family:sans-serif;text-align:center;padding:50px;background:#f8fafc;color:#1e293b;}
      .box{background:#fff;padding:30px;border-radius:16px;max-width:500px;margin:0 auto;box-shadow:0 4px 20px rgba(0,0,0,0.08);}
      a{color:#059669;font-weight:bold;text-decoration:none;}</style></head>
      <body><div class="box">
        <h2>⚠️ APK अजून अपलोड केलेले नाही</h2>
        <p>ॲडमिन लवकरच नवीन व्हर्जन अपलोड करतील. कृपया काही वेळाने पुन्हा प्रयत्न करा.</p>
        <p><a href="/">मुख्य पानावर जा (Back to Home)</a></p>
      </div></body></html>
    `);
  }

  const filePath = path.join(DOWNLOADS_DIR, meta.filename);
  if (!fs.existsSync(filePath)) {
    meta.exists = false;
    saveMeta(meta);
    return res.status(404).send("APK फाईल सापडली नाही.");
  }

  meta.downloadCount = (meta.downloadCount || 0) + 1;
  saveMeta(meta);

  res.download(filePath, meta.filename, (err) => {
    if (err && !res.headersSent) {
      res.status(500).send("डाऊनलोड करताना त्रुटी आली.");
    }
  });
});

// Legacy direct file request fallback
app.get("/downloads/:filename", (req, res) => {
  res.redirect("/api/download-apk");
});

app.listen(PORT, () => {
  console.log("=".repeat(55));
  console.log("  maz Gaaav Mahur-Kinwat Portal is LIVE!");
  console.log(`  🌐 Public Website:       http://localhost:${PORT}`);
  console.log(`  🔒 Private Admin Panel:   http://localhost:${PORT}/admin`);
  console.log(`  💳 UPI Payment ID:       ${UPI_ID} (₹${APP_PRICE})`);
  console.log(`  📲 Dynamic QR Code API:  http://localhost:${PORT}/api/qr-code`);
  console.log("=".repeat(55));
});
