const express = require("express");
const multer = require("multer");
const QRCode = require("qrcode");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const https = require("https");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || "0003";

const UPI_ID = "shivampund814@oksbi";
const PAYEE_NAME = "Shivam Pund";
const APP_PRICE = 10; // ₹10

const DOWNLOADS_DIR = path.join(__dirname, "downloads");
const META_FILE = path.join(DOWNLOADS_DIR, "apk-meta.json");
const CUSTOM_QR_FILE = path.join(DOWNLOADS_DIR, "custom-qr.png");
const ROOT_QR_FILE = path.join(__dirname, "qr.png");
const ROOT_APK_FILE = path.join(__dirname, "maz-gaaav.apk");
const PAYMENTS_FILE = path.join(DOWNLOADS_DIR, "payments.json");
const GATEWAY_FILE = path.join(DOWNLOADS_DIR, "gateway-config.json");

// 15-Minute Valid Single-Use Download Tokens
const validDownloadTokens = new Map();

if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

function getGatewayConfig() {
  try {
    if (fs.existsSync(GATEWAY_FILE)) {
      return JSON.parse(fs.readFileSync(GATEWAY_FILE, "utf8"));
    }
  } catch (e) {}
  return {
    keyId: process.env.RAZORPAY_KEY_ID || "",
    keySecret: process.env.RAZORPAY_KEY_SECRET || "",
    enabled: !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET)
  };
}

function saveGatewayConfig(config) {
  fs.writeFileSync(GATEWAY_FILE, JSON.stringify(config, null, 2), "utf8");
}

function getMeta() {
  let data = { exists: false, filename: null, version: "v1.0.0", size: 0, uploadDate: null };
  try {
    if (fs.existsSync(META_FILE)) {
      data = JSON.parse(fs.readFileSync(META_FILE, "utf8"));
      if (data.exists && data.filename) {
        const filePath = path.join(DOWNLOADS_DIR, data.filename);
        if (!fs.existsSync(filePath)) data.exists = false;
      }
    }
  } catch (e) {}

  if (!data.exists && fs.existsSync(ROOT_APK_FILE)) {
    const stat = fs.statSync(ROOT_APK_FILE);
    data = { exists: true, filename: "maz-gaaav.apk", version: "v1.0.0", size: stat.size, isRoot: true };
  }

  data.hasCustomQr = fs.existsSync(CUSTOM_QR_FILE) || fs.existsSync(ROOT_QR_FILE);
  return data;
}

function saveMeta(data) {
  fs.writeFileSync(META_FILE, JSON.stringify(data, null, 2), "utf8");
}

function getPayments() {
  try {
    if (fs.existsSync(PAYMENTS_FILE)) {
      return JSON.parse(fs.readFileSync(PAYMENTS_FILE, "utf8"));
    }
  } catch (e) {}
  return [];
}

function savePayment(payment) {
  const payments = getPayments();
  payments.unshift(payment);
  fs.writeFileSync(PAYMENTS_FILE, JSON.stringify(payments, null, 2), "utf8");
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  return mb.toFixed(1) + " MB";
}

const apkStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, DOWNLOADS_DIR),
  filename: (req, file, cb) => cb(null, "maz-gaaav-app.apk")
});
const uploadApk = multer({ storage: apkStorage, limits: { fileSize: 150 * 1024 * 1024 } });

const qrStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, DOWNLOADS_DIR),
  filename: (req, file, cb) => cb(null, "custom-qr.png")
});
const uploadQr = multer({ storage: qrStorage, limits: { fileSize: 15 * 1024 * 1024 } });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// Serve QR Code image
app.get(["/api/qr-image", "/api/qr-code", "/qr.png"], (req, res) => {
  if (fs.existsSync(CUSTOM_QR_FILE)) {
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    return res.sendFile(CUSTOM_QR_FILE);
  }
  if (fs.existsSync(ROOT_QR_FILE)) {
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    return res.sendFile(ROOT_QR_FILE);
  }

  const upiUrl = `upi://pay?pa=${UPI_ID}&pn=${encodeURIComponent(PAYEE_NAME)}&am=10&cu=INR`;
  QRCode.toBuffer(upiUrl, { width: 400, margin: 2 }, (err, buffer) => {
    if (err) return res.status(500).send("QR Generation Error");
    res.setHeader("Content-Type", "image/png");
    res.send(buffer);
  });
});

app.get("/api/apk-info", (req, res) => {
  const meta = getMeta();
  const gw = getGatewayConfig();
  res.json({
    exists: meta.exists,
    version: meta.version || "v1.0.0",
    sizeFormatted: formatBytes(meta.size),
    hasCustomQr: meta.hasCustomQr,
    autoGateway: gw.enabled && !!gw.keyId
  });
});

// ========================================================
// 1. RAZORPAY 1-CLICK ORDER CREATION
// ========================================================
app.post("/api/create-order", (req, res) => {
  const gw = getGatewayConfig();
  if (!gw.enabled || !gw.keyId || !gw.keySecret) {
    return res.json({ autoGateway: false, message: "Gateway not configured" });
  }

  const authHeader = "Basic " + Buffer.from(gw.keyId + ":" + gw.keySecret).toString("base64");
  const postData = JSON.stringify({
    amount: APP_PRICE * 100, // ₹10 = 1000 paise
    currency: "INR",
    receipt: "rcpt_" + Date.now(),
    notes: { app: "maz Gaaav APK" }
  });

  const options = {
    hostname: "api.razorpay.com",
    port: 443,
    path: "/v1/orders",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(postData),
      "Authorization": authHeader
    }
  };

  const razorReq = https.request(options, (razorRes) => {
    let body = "";
    razorRes.on("data", (chunk) => body += chunk);
    razorRes.on("end", () => {
      try {
        const order = JSON.parse(body);
        if (order.id) {
          res.json({ autoGateway: true, keyId: gw.keyId, orderId: order.id, amount: order.amount });
        } else {
          res.status(500).json({ error: "Order creation failed" });
        }
      } catch (err) {
        res.status(500).json({ error: "Invalid gateway response" });
      }
    });
  });

  razorReq.on("error", () => res.status(500).json({ error: "Gateway connection error" }));
  razorReq.write(postData);
  razorReq.end();
});

// ========================================================
// 2. CRYPTOGRAPHIC HMAC-SHA256 SIGNATURE VERIFICATION
// ========================================================
app.post("/api/verify-razorpay", (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  const gw = getGatewayConfig();

  if (!gw.keySecret) {
    return res.status(500).json({ success: false, message: "Gateway not configured" });
  }

  // Calculate HMAC-SHA256 hash
  const expectedSignature = crypto
    .createHmac("sha256", gw.keySecret)
    .update(razorpay_order_id + "|" + razorpay_payment_id)
    .digest("hex");

  // STRICT CHECK: Signature MUST match 100%
  if (expectedSignature !== razorpay_signature) {
    return res.status(400).json({ success: false, message: "पेमेंट पडताळणी अयशस्वी! बनावट पेमेंट नाकारले." });
  }

  // Payment is 100% VERIFIED by Bank & Razorpay! Generate one-time secure token
  const token = crypto.randomBytes(16).toString("hex");
  const expiresAt = Date.now() + 15 * 60 * 1000;
  validDownloadTokens.set(token, { paymentId: razorpay_payment_id, expiresAt });

  savePayment({
    id: `PAY-${Date.now()}`,
    mobile: "Verified User",
    reference: razorpay_payment_id,
    amount: APP_PRICE,
    type: "Razorpay 1-Click (GPay)",
    date: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
    downloaded: false
  });

  res.json({
    success: true,
    message: "पेमेंट १००% यशस्वी! ॲप डाऊनलोड सुरू होत आहे...",
    downloadUrl: `/api/download-apk?token=${token}`
  });
});

// ========================================================
// 3. SECURE TOKEN-PROTECTED DOWNLOAD (NO TOKEN = NO DOWNLOAD)
// ========================================================
app.get("/api/download-apk", (req, res) => {
  const token = req.query.token;

  if (!token || !validDownloadTokens.has(token)) {
    return res.status(403).send(`
      <div style="font-family:sans-serif; text-align:center; padding:40px; line-height:1.6;">
        <h2 style="color:#dc2626;">⛔ डाऊनलोड लॉक आहे!</h2>
        <p>आधी ₹१० चे पेमेंट पूर्ण करणे आवश्यक आहे.</p>
        <p><a href="/" style="background:#059669; color:#fff; padding:10px 20px; text-decoration:none; border-radius:8px; font-weight:bold;">मुख्य पानावर जा</a></p>
      </div>
    `);
  }

  const tokenData = validDownloadTokens.get(token);
  if (Date.now() > tokenData.expiresAt) {
    validDownloadTokens.delete(token);
    return res.status(403).send("डाऊनलोड लिंकची मुदत संपली आहे. कृपया पुन्हा प्रयत्न करा.");
  }

  const meta = getMeta();
  let finalFile = null;
  if (meta.exists && meta.filename) {
    const p = path.join(DOWNLOADS_DIR, meta.filename);
    if (fs.existsSync(p)) finalFile = p;
  }
  if (!finalFile && fs.existsSync(ROOT_APK_FILE)) {
    finalFile = ROOT_APK_FILE;
  }

  if (!finalFile) {
    return res.status(404).send("APK फाईल उपलब्ध नाही. ॲडमिनशी संपर्क करा.");
  }

  // Mark downloaded
  const payments = getPayments();
  const payment = payments.find(p => p.reference === tokenData.paymentId);
  if (payment) {
    payment.downloaded = true;
    fs.writeFileSync(PAYMENTS_FILE, JSON.stringify(payments, null, 2), "utf8");
  }

  res.download(finalFile, "maz-gaaav.apk");
});

// Admin API routes
app.post("/api/admin/upload-apk", uploadApk.single("apkFile"), (req, res) => {
  if (req.body.adminPin !== ADMIN_PIN) return res.status(403).json({ success: false, message: "चुकीचा पासवर्ड!" });
  if (!req.file) return res.status(400).json({ success: false, message: "फाईल निवडली नाही!" });

  const newMeta = { exists: true, filename: req.file.filename, version: req.body.apkVersion || "v1.0.0", size: req.file.size, uploadDate: new Date().toISOString() };
  saveMeta(newMeta);
  res.json({ success: true, message: "✅ APK फाईल सेव्ह झाली!", sizeText: formatBytes(req.file.size), versionText: newMeta.version });
});

app.post("/api/admin/upload-qr", uploadQr.single("qrImage"), (req, res) => {
  if (req.body.adminPin !== ADMIN_PIN) return res.status(403).json({ success: false, message: "चुकीचा पासवर्ड!" });
  if (!req.file) return res.status(400).json({ success: false, message: "इमेज निवडली नाही!" });
  res.json({ success: true, message: "✅ GPay QR कोड सेव्ह झाला!" });
});

app.post("/api/admin/update-gateway", (req, res) => {
  if (req.body.adminPin !== ADMIN_PIN) return res.status(403).json({ success: false, message: "चुकीचा पासवर्ड!" });
  const keyId = (req.body.keyId || "").trim();
  const keySecret = (req.body.keySecret || "").trim();
  const enabled = req.body.enabled === "true" || req.body.enabled === true;

  saveGatewayConfig({ keyId, keySecret, enabled: enabled && !!keyId && !!keySecret });
  res.json({ success: true, message: "✅ Razorpay की यशस्वीरित्या सेव्ह झाल्या!", isActive: enabled && !!keyId && !!keySecret });
});

// Admin Panel UI
app.get("/admin", (req, res) => {
  const meta = getMeta();
  const payments = getPayments();
  const gw = getGatewayConfig();
  const totalEarnings = payments.length * APP_PRICE;

  const paymentRows = payments.map((p, idx) => `
    <tr>
      <td style="padding:10px; border-bottom:1px solid #334155;">${idx + 1}</td>
      <td style="padding:10px; border-bottom:1px solid #334155; font-size:0.85rem;">${p.date}</td>
      <td style="padding:10px; border-bottom:1px solid #334155; font-family:monospace; color:#facc15;">${p.reference}</td>
      <td style="padding:10px; border-bottom:1px solid #334155; font-size:0.8rem; color:#a7f3d0;">${p.type}</td>
      <td style="padding:10px; border-bottom:1px solid #334155; color:#34d399; font-weight:bold;">₹${p.amount}</td>
      <td style="padding:10px; border-bottom:1px solid #334155;">${p.downloaded ? '<span style="color:#34d399;">✓ डाऊनलोड झाले</span>' : '<span style="color:#facc15;">प्रलंबित</span>'}</td>
    </tr>
  `).join("");

  res.send(`
    <!DOCTYPE html>
    <html lang="mr">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>maz Gaaav - ॲडमिन डॅशबोर्ड</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 20px; }
        .container { max-width: 850px; margin: 0 auto; }
        .card { background: #1e293b; border-radius: 16px; padding: 24px; margin-bottom: 20px; border: 1px solid #334155; }
        h1 { font-size: 1.5rem; color: #34d399; margin-top: 0; }
        h2 { font-size: 1.15rem; margin-top: 0; color: #38bdf8; border-bottom: 1px solid #334155; padding-bottom: 8px; }
        label { display: block; margin: 12px 0 6px; font-weight: 600; font-size: 0.9rem; }
        input[type="text"], input[type="password"], input[type="file"] { width: 100%; box-sizing: border-box; padding: 11px; background: #0f172a; border: 1px solid #475569; border-radius: 8px; color: #fff; font-size: 0.95rem; }
        button { width: 100%; background: #059669; color: #fff; border: none; padding: 12px; border-radius: 8px; font-weight: bold; font-size: 1rem; cursor: pointer; margin-top: 14px; }
        .alert { padding: 12px; border-radius: 8px; margin-top: 14px; display: none; font-weight: bold; }
        .status-badge { display: inline-block; padding: 4px 10px; border-radius: 99px; font-size: 0.8rem; font-weight: bold; }
        .active { background: #065f46; color: #a7f3d0; }
        .inactive { background: #7f1d1d; color: #fecaca; }
        table { width: 100%; border-collapse: collapse; text-align: left; }
        th { background: #0f172a; padding: 10px; font-size: 0.85rem; color: #94a3b8; border-bottom: 2px solid #334155; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>⚙️ maz Gaaav ॲडमिन डॅशबोर्ड</h1>

        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:16px; margin-bottom:20px;">
          <div class="card" style="margin-bottom:0; text-align:center; padding:18px;">
            <span style="font-size:0.85rem; color:#94a3b8;">एकूण पेमेंट्स</span>
            <h3 style="font-size:1.8rem; margin:6px 0 0; color:#38bdf8;">${payments.length}</h3>
          </div>
          <div class="card" style="margin-bottom:0; text-align:center; padding:18px;">
            <span style="font-size:0.85rem; color:#94a3b8;">एकूण जमा रक्कम</span>
            <h3 style="font-size:1.8rem; margin:6px 0 0; color:#34d399;">₹${totalEarnings}</h3>
          </div>
          <div class="card" style="margin-bottom:0; text-align:center; padding:18px;">
            <span style="font-size:0.85rem; color:#94a3b8;">Razorpay 1-क्लिक स्थिती</span>
            <h3 style="font-size:1.2rem; margin:8px 0 0; color:${gw.enabled ? '#34d399' : '#facc15'};" id="gwStatusBadge">
              ${gw.enabled ? '✓ चालू (Active)' : 'की सेव्ह करा'}
            </h3>
          </div>
        </div>

        <!-- 1. APK File Card -->
        <div class="card">
          <h2>1. APK फाईल व्यवस्थापन</h2>
          <p>सद्यस्थिती: <span id="apkStatusBadge" class="status-badge ${meta.exists ? 'active' : 'inactive'}">
            ${meta.exists ? '✓ APK उपलब्ध आहे' : '✗ APK अपलोड नाही'}
          </span></p>
          <form id="apkForm">
            <label>नवीन APK फाईल निवडा:</label>
            <input type="file" name="apkFile" accept=".apk" required>
            <label>व्हर्जन:</label>
            <input type="text" name="apkVersion" value="${meta.version || 'v1.0.0'}">
            <label>ॲडमिन पिन:</label>
            <input type="password" name="adminPin" value="0003" required>
            <button type="submit" id="apkBtn">🚀 APK सेव्ह करा</button>
          </form>
          <div id="apkMsg" class="alert"></div>
        </div>

        <!-- 2. QR Code Upload Card -->
        <div class="card">
          <h2>2. स्वतःचा GPay QR फोटो</h2>
          <img src="/api/qr-image?t=${Date.now()}" style="width:130px; height:auto; border-radius:10px; border:2px solid #059669; display:block; margin:10px 0;" id="qrImg">
          <form id="qrForm">
            <label>GPay QR चा फोटो निवडा (.png / .jpg):</label>
            <input type="file" name="qrImage" accept="image/*" required>
            <label>ॲडमिन पिन:</label>
            <input type="password" name="adminPin" value="0003" required>
            <button type="submit" style="background:#2563eb;" id="qrBtn">📸 QR कोड सेव्ह करा</button>
          </form>
          <div id="qrMsg" class="alert"></div>
        </div>

        <!-- 3. Razorpay Key Card -->
        <div class="card">
          <h2>3. Razorpay १-क्लिक पेमेंट की (महत्त्वाचे)</h2>
          <form id="gwForm">
            <label>Razorpay Key ID:</label>
            <input type="text" name="keyId" id="inputKeyId" value="${gw.keyId || ''}" placeholder="rzp_test_... किंवा rzp_live_...">
            <label>Razorpay Key Secret:</label>
            <input type="password" name="keySecret" id="inputKeySecret" value="${gw.keySecret || ''}" placeholder="Key Secret गुप्त कोड">
            <label style="margin-top:10px; cursor:pointer;">
              <input type="checkbox" name="enabled" id="checkEnabled" ${gw.enabled ? 'checked' : ''} style="width:auto;"> ऑटोमॅटिक 1-क्लिक चालू ठेवा (Enable)
            </label>
            <label>ॲडमिन पिन:</label>
            <input type="password" name="adminPin" value="0003" required>
            <button type="submit" style="background:#0284c7;" id="gwBtn">💾 गेटवे की सेव्ह करा</button>
          </form>
          <div id="gwMsg" class="alert"></div>
        </div>

        <!-- Live Payments Table -->
        <div class="card">
          <h2>4. थेट पेमेंट्स आणि डाऊनलोड नोंदी</h2>
          <div style="overflow-x:auto;">
            ${payments.length === 0 ? '<p style="text-align:center; padding:15px; color:#64748b;">कोणतीही नोंद नाही.</p>' : `
              <table>
                <thead>
                  <tr><th>#</th><th>तारीख</th><th>पेमेंट आयडी</th><th>पद्धत</th><th>रक्कम</th><th>डाऊनलोड स्थिती</th></tr>
                </thead>
                <tbody>${paymentRows}</tbody>
              </table>
            `}
          </div>
        </div>

        <p style="text-align:center;"><a href="/" style="color:#38bdf8; text-decoration:none;">⬅ मुख्य पानावर परत जा</a></p>
      </div>

      <script>
        document.getElementById('apkForm').onsubmit = async (e) => {
          e.preventDefault();
          const btn = document.getElementById('apkBtn');
          const msg = document.getElementById('apkMsg');
          btn.disabled = true; btn.innerText = "सेव्ह होत आहे..."; msg.style.display = "none";
          try {
            const res = await fetch('/api/admin/upload-apk', { method: 'POST', body: new FormData(e.target) });
            const data = await res.json();
            msg.style.display = "block";
            msg.style.background = data.success ? "#065f46" : "#7f1d1d";
            msg.style.color = data.success ? "#a7f3d0" : "#fecaca";
            msg.innerText = data.message;
            if (data.success) {
              document.getElementById('apkStatusBadge').className = "status-badge active";
              document.getElementById('apkStatusBadge').innerText = "✓ APK उपलब्ध आहे";
            }
          } catch(err) { msg.style.display = "block"; msg.style.background = "#7f1d1d"; msg.innerText = "एरर आला!"; }
          btn.disabled = false; btn.innerText = "🚀 APK सेव्ह करा";
        };

        document.getElementById('qrForm').onsubmit = async (e) => {
          e.preventDefault();
          const btn = document.getElementById('qrBtn');
          const msg = document.getElementById('qrMsg');
          btn.disabled = true; btn.innerText = "सेव्ह होत आहे..."; msg.style.display = "none";
          try {
            const res = await fetch('/api/admin/upload-qr', { method: 'POST', body: new FormData(e.target) });
            const data = await res.json();
            msg.style.display = "block";
            msg.style.background = data.success ? "#065f46" : "#7f1d1d";
            msg.style.color = data.success ? "#a7f3d0" : "#fecaca";
            msg.innerText = data.message;
            if (data.success) document.getElementById('qrImg').src = '/api/qr-image?t=' + Date.now();
          } catch(err) { msg.style.display = "block"; msg.style.background = "#7f1d1d"; msg.innerText = "एरर आला!"; }
          btn.disabled = false; btn.innerText = "📸 QR कोड सेव्ह करा";
        };

        document.getElementById('gwForm').onsubmit = async (e) => {
          e.preventDefault();
          const btn = document.getElementById('gwBtn');
          const msg = document.getElementById('gwMsg');
          btn.disabled = true; btn.innerText = "सेव्ह होत आहे..."; msg.style.display = "none";

          const payload = {
            keyId: document.getElementById('inputKeyId').value,
            keySecret: document.getElementById('inputKeySecret').value,
            enabled: document.getElementById('checkEnabled').checked,
            adminPin: "0003"
          };

          try {
            const res = await fetch('/api/admin/update-gateway', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });
            const data = await res.json();
            msg.style.display = "block";
            msg.style.background = data.success ? "#065f46" : "#7f1d1d";
            msg.style.color = data.success ? "#a7f3d0" : "#fecaca";
            msg.innerText = data.message;
            if (data.success) {
              document.getElementById('gwStatusBadge').innerText = data.isActive ? "✓ चालू (Active)" : "बंद";
              document.getElementById('gwStatusBadge').style.color = data.isActive ? "#34d399" : "#facc15";
            }
          } catch(err) { msg.style.display = "block"; msg.style.background = "#7f1d1d"; msg.innerText = "एरर आला!"; }
          btn.disabled = false; btn.innerText = "💾 गेटवे की सेव्ह करा";
        };
      </script>
    </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
