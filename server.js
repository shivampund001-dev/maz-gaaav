const express = require("express");
const multer = require("multer");
const QRCode = require("qrcode");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || "0003";

// UPI Settings
const UPI_ID = "shivampund814@oksbi";
const PAYEE_NAME = "Shivam Pund";

const DOWNLOADS_DIR = path.join(__dirname, "downloads");
const META_FILE = path.join(DOWNLOADS_DIR, "apk-meta.json");
const CUSTOM_QR_FILE = path.join(DOWNLOADS_DIR, "custom-qr.png");

// Ensure downloads directory exists
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

// Helpers for metadata
function getMeta() {
  try {
    if (fs.existsSync(META_FILE)) {
      const data = JSON.parse(fs.readFileSync(META_FILE, "utf8"));
      if (data.exists && data.filename) {
        const filePath = path.join(DOWNLOADS_DIR, data.filename);
        if (!fs.existsSync(filePath)) {
          data.exists = false;
        }
      }
      data.hasCustomQr = fs.existsSync(CUSTOM_QR_FILE);
      return data;
    }
  } catch (e) {}
  return {
    exists: false,
    filename: null,
    version: "v1.0.0",
    size: 0,
    uploadDate: null,
    hasCustomQr: fs.existsSync(CUSTOM_QR_FILE)
  };
}

function saveMeta(data) {
  fs.writeFileSync(META_FILE, JSON.stringify(data, null, 2), "utf8");
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  return mb.toFixed(1) + " MB";
}

// Multer storage for APK
const apkStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, DOWNLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `maz-gaaav-${Date.now()}${ext === ".apk" ? ".apk" : ".apk"}`);
  }
});
const uploadApk = multer({
  storage: apkStorage,
  limits: { fileSize: 150 * 1024 * 1024 }
});

// Multer storage for Custom QR Image
const qrStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, DOWNLOADS_DIR),
  filename: (req, file, cb) => cb(null, "custom-qr.png")
});
const uploadQr = multer({
  storage: qrStorage,
  limits: { fileSize: 15 * 1024 * 1024 }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// Dynamic QR Code Route (Serves Custom QR if uploaded, else generates on the fly)
app.get(["/api/qr-image", "/api/qr-code", "/qr.png"], (req, res) => {
  if (fs.existsSync(CUSTOM_QR_FILE)) {
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    return res.sendFile(CUSTOM_QR_FILE);
  }

  // Fallback: Generate clean UPI QR
  const upiUrl = `upi://pay?pa=${UPI_ID}&pn=${encodeURIComponent(PAYEE_NAME)}&am=10&cu=INR`;
  QRCode.toBuffer(upiUrl, { width: 400, margin: 2 }, (err, buffer) => {
    if (err) return res.status(500).send("QR Generation Error");
    res.setHeader("Content-Type", "image/png");
    res.send(buffer);
  });
});

// APK Info Endpoint
app.get("/api/apk-info", (req, res) => {
  const meta = getMeta();
  res.json({
    exists: meta.exists,
    version: meta.version || "v1.0.0",
    sizeFormatted: formatBytes(meta.size),
    uploadDate: meta.uploadDate,
    hasCustomQr: meta.hasCustomQr
  });
});

// Instant APK Download
app.get("/api/download-apk", (req, res) => {
  const meta = getMeta();
  if (!meta.exists || !meta.filename) {
    return res.status(404).send(`
      <div style="font-family:sans-serif; text-align:center; padding:40px;">
        <h2>APK फाईल उपलब्ध नाही</h2>
        <p>कृपया ॲडमिन पॅनेल (<a href="/admin">/admin</a>) मध्ये जाऊन APK फाईल अपलोड करा.</p>
      </div>
    `);
  }
  const filePath = path.join(DOWNLOADS_DIR, meta.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send("APK फाईल सर्व्हरवर सापडली नाही.");
  }
  res.download(filePath, "maz-gaaav.apk");
});

// Upload APK Route (Admin)
app.post("/api/admin/upload-apk", uploadApk.single("apkFile"), (req, res) => {
  const pin = req.body.adminPin;
  if (pin !== ADMIN_PIN) {
    if (req.file) try { fs.unlinkSync(req.file.path); } catch(e){}
    return res.status(403).json({ success: false, message: "चुकीचा ॲडमिन पासवर्ड!" });
  }
  if (!req.file) {
    return res.status(400).json({ success: false, message: "कोणतीही APK फाईल निवडली नाही!" });
  }

  const meta = getMeta();
  if (meta.filename && meta.filename !== req.file.filename) {
    const oldPath = path.join(DOWNLOADS_DIR, meta.filename);
    if (fs.existsSync(oldPath)) {
      try { fs.unlinkSync(oldPath); } catch(e){}
    }
  }

  const newMeta = {
    exists: true,
    filename: req.file.filename,
    version: req.body.apkVersion || "v1.0.0",
    size: req.file.size,
    uploadDate: new Date().toISOString()
  };
  saveMeta(newMeta);

  res.json({ success: true, message: "APK यशस्वीरित्या अपलोड झाले!", meta: newMeta });
});

// Upload Custom QR Route (Admin)
app.post("/api/admin/upload-qr", uploadQr.single("qrImage"), (req, res) => {
  const pin = req.body.adminPin;
  if (pin !== ADMIN_PIN) {
    if (req.file) try { fs.unlinkSync(req.file.path); } catch(e){}
    return res.status(403).json({ success: false, message: "चुकीचा ॲडमिन पासवर्ड!" });
  }
  if (!req.file) {
    return res.status(400).json({ success: false, message: "कोणतीही इमेज निवडली नाही!" });
  }

  const meta = getMeta();
  meta.hasCustomQr = true;
  saveMeta(meta);

  res.json({ success: true, message: "GPay QR कोड यशस्वीरित्या अपडेट झाला!" });
});

// Admin Panel UI
app.get("/admin", (req, res) => {
  const meta = getMeta();
  res.send(`
    <!DOCTYPE html>
    <html lang="mr">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>maz Gaaav - ॲडमिन कंट्रोल पॅनेल</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; }
        .card { background: #1e293b; border-radius: 16px; padding: 24px; margin-bottom: 20px; border: 1px solid #334155; }
        h1 { font-size: 1.5rem; color: #34d399; margin-top: 0; }
        h2 { font-size: 1.2rem; margin-top: 0; color: #38bdf8; border-bottom: 1px solid #334155; padding-bottom: 8px; }
        label { display: block; margin: 12px 0 6px; font-weight: 600; font-size: 0.9rem; }
        input[type="text"], input[type="password"], input[type="file"] { width: 100%; box-sizing: border-box; padding: 12px; background: #0f172a; border: 1px solid #475569; border-radius: 8px; color: #fff; font-size: 0.95rem; }
        button { width: 100%; background: #059669; color: #fff; border: none; padding: 13px; border-radius: 8px; font-weight: bold; font-size: 1rem; cursor: pointer; margin-top: 16px; }
        button:hover { background: #047857; }
        .alert { padding: 12px; border-radius: 8px; margin-bottom: 16px; display: none; }
        .status-badge { display: inline-block; padding: 4px 10px; border-radius: 99px; font-size: 0.8rem; font-weight: bold; }
        .active { background: #065f46; color: #a7f3d0; }
        .inactive { background: #7f1d1d; color: #fecaca; }
        .preview-img { width: 140px; height: auto; border-radius: 10px; border: 2px solid #059669; display: block; margin: 10px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>⚙️ maz Gaaav ॲडमिन पॅनेल</h1>
        
        <!-- APK Upload Card -->
        <div class="card">
          <h2>1. APK फाईल व्यवस्थापन</h2>
          <p>सद्यस्थिती: 
            ${meta.exists ? '<span class="status-badge active">✓ APK उपलब्ध आहे</span>' : '<span class="status-badge inactive">✗ APK अपलोड नाही</span>'}
          </p>
          ${meta.exists ? `<p style="font-size:0.85rem; color:#94a3b8;">फाईल: ${meta.filename} | साईज: ${formatBytes(meta.size)} | व्हर्जन: ${meta.version}</p>` : ''}
          
          <form id="apkForm">
            <label>नवीन APK फाईल निवडा:</label>
            <input type="file" name="apkFile" accept=".apk" required>
            
            <label>व्हर्जन (उदा. v1.0.0):</label>
            <input type="text" name="apkVersion" value="${meta.version || 'v1.0.0'}">

            <label>ॲडमिन पासवर्ड (PIN):</label>
            <input type="password" name="adminPin" placeholder="पासवर्ड टाका" required>

            <button type="submit" id="apkSubmitBtn">🚀 नवीन APK अपलोड करा</button>
          </form>
          <div id="apkMsg" class="alert"></div>
        </div>

        <!-- QR Code Upload Card -->
        <div class="card">
          <h2>2. स्वतःचा GPay QR कोड अपलोड करा</h2>
          <p>सध्याचा QR कोड:</p>
          <img src="/api/qr-image?t=${Date.now()}" alt="Current QR" class="preview-img" id="currentQrImg">

          <form id="qrForm">
            <label>तुमच्या GPay QR चा फोटो निवडा (.png / .jpg):</label>
            <input type="file" name="qrImage" accept="image/*" required>

            <label>ॲडमिन पासवर्ड (PIN):</label>
            <input type="password" name="adminPin" placeholder="पासवर्ड टाका" required>

            <button type="submit" style="background:#2563eb;" id="qrSubmitBtn">📸 नवीन GPay QR अपडेट करा</button>
          </form>
          <div id="qrMsg" class="alert"></div>
        </div>

        <p style="text-align:center;"><a href="/" style="color:#38bdf8; text-decoration:none;">⬅ मुख्य पानावर परत जा</a></p>
      </div>

      <script>
        // APK Upload Handler
        document.getElementById('apkForm').onsubmit = async (e) => {
          e.preventDefault();
          const btn = document.getElementById('apkSubmitBtn');
          const msg = document.getElementById('apkMsg');
          btn.disabled = true;
          btn.innerText = "अपलोड होत आहे... कृपया थांबा";
          msg.style.display = "none";

          const formData = new FormData(e.target);
          try {
            const res = await fetch('/api/admin/upload-apk', { method: 'POST', body: formData });
            const data = await res.json();
            msg.style.display = "block";
            if (data.success) {
              msg.style.background = "#065f46";
              msg.style.color = "#a7f3d0";
              msg.innerText = data.message;
              setTimeout(() => location.reload(), 1500);
            } else {
              msg.style.background = "#7f1d1d";
              msg.style.color = "#fecaca";
              msg.innerText = data.message;
            }
          } catch(err) {
            msg.style.display = "block";
            msg.style.background = "#7f1d1d";
            msg.innerText = "सर्व्हर एरर!";
          }
          btn.disabled = false;
          btn.innerText = "🚀 नवीन APK अपलोड करा";
        };

        // QR Upload Handler
        document.getElementById('qrForm').onsubmit = async (e) => {
          e.preventDefault();
          const btn = document.getElementById('qrSubmitBtn');
          const msg = document.getElementById('qrMsg');
          btn.disabled = true;
          btn.innerText = "QR अपडेट होत आहे...";
          msg.style.display = "none";

          const formData = new FormData(e.target);
          try {
            const res = await fetch('/api/admin/upload-qr', { method: 'POST', body: formData });
            const data = await res.json();
            msg.style.display = "block";
            if (data.success) {
              msg.style.background = "#065f46";
              msg.style.color = "#a7f3d0";
              msg.innerText = data.message;
              document.getElementById('currentQrImg').src = '/api/qr-image?t=' + Date.now();
            } else {
              msg.style.background = "#7f1d1d";
              msg.style.color = "#fecaca";
              msg.innerText = data.message;
            }
          } catch(err) {
            msg.style.display = "block";
            msg.style.background = "#7f1d1d";
            msg.innerText = "सर्व्हर एरर!";
          }
          btn.disabled = false;
          btn.innerText = "📸 नवीन GPay QR अपडेट करा";
        };
      </script>
    </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
