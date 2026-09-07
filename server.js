const express = require("express");
const multer = require("multer");
const QRCode = require("qrcode");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
// Secret Admin Password set to 0003 as requested
const ADMIN_PIN = process.env.ADMIN_PIN || "0003";

const DOWNLOADS_DIR = path.join(__dirname, "downloads");
const META_FILE = path.join(DOWNLOADS_DIR, "apk-meta.json");

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

// 2. API: Dynamic QR Code Generation for APK Download
app.get("/api/qr-code", async (req, res) => {
  try {
    const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
    const host = req.headers.host;
    const downloadUrl = `${protocol}://${host}/api/download-apk`;

    const qrSvg = await QRCode.toString(downloadUrl, {
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

// Downloadable QR Code PNG for printing posters
app.get("/api/qr-code/download", async (req, res) => {
  try {
    const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
    const host = req.headers.host;
    const downloadUrl = `${protocol}://${host}/api/download-apk`;

    const qrBuffer = await QRCode.toBuffer(downloadUrl, {
      type: "png",
      width: 600,
      margin: 2,
      color: {
        dark: "#0F172A",
        light: "#FFFFFF"
      }
    });

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Disposition", 'attachment; filename="maz-gaaav-download-qr.png"');
    res.send(qrBuffer);
  } catch (err) {
    res.status(500).send("Error generating PNG QR code");
  }
});

// 3. API: Verify PIN
app.post("/api/verify-pin", (req, res) => {
  const { pin } = req.body;
  if (pin === ADMIN_PIN) {
    return res.json({ success: true, message: "PIN verified successfully" });
  }
  return res.status(401).json({ success: false, message: "चुकीचा पासवर्ड (Incorrect Password). कृपया पुन्हा प्रयत्न करा." });
});

// 4. API: Get Current APK Info
app.get("/api/apk-info", (req, res) => {
  const meta = getMeta();
  res.json(meta);
});

// 5. API: Upload APK (Protected by Secret PIN)
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

// 6. API: Delete APK (Protected by PIN)
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

// 7. Public Download Endpoint
app.get("/api/download-apk", (req, res) => {
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
  console.log(`  📲 Dynamic QR Code API:  http://localhost:${PORT}/api/qr-code`);
  console.log("=".repeat(55));
});