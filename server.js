const express = require("express");
const multer = require("multer");
const QRCode = require("qrcode");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const https = require("https");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PIN = "0003";

const UPI_ID = "shivampund814@oksbi";
const PAYEE_NAME = "Shivam Pund";
const APP_PRICE = 10;

const DOWNLOADS_DIR = path.join(__dirname, "downloads");
const CONFIG_FILE = path.join(DOWNLOADS_DIR, "admin-config.json");
const CUSTOM_QR_FILE = path.join(DOWNLOADS_DIR, "custom-qr.png");
const ROOT_QR_FILE = path.join(__dirname, "qr.png");
const ROOT_APK_FILE = path.join(__dirname, "maz-gaaav.apk");
const PAYMENTS_FILE = path.join(DOWNLOADS_DIR, "payments.json");

const validDownloadTokens = new Map();

if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

// 🛡️ INDESTRUCTIBLE UNIFIED CONFIG SYSTEM
function getConfig() {
  let cfg = {
    apk: { exists: false, filename: null, version: "v1.0.0", sizeText: "0 MB" },
    qr: { exists: false },
    gateway: { enabled: false, keyId: "", keySecret: "" }
  };

  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
      cfg = { ...cfg, ...saved };
    }
  } catch (e) {}

  // Check physical APK file
  const apkPath = path.join(DOWNLOADS_DIR, "maz-gaaav-app.apk");
  if (fs.existsSync(apkPath)) {
    const s = fs.statSync(apkPath);
    cfg.apk.exists = true;
    cfg.apk.filename = "maz-gaaav-app.apk";
    cfg.apk.sizeText = (s.size / (1024 * 1024)).toFixed(1) + " MB";
  } else if (fs.existsSync(ROOT_APK_FILE)) {
    const s = fs.statSync(ROOT_APK_FILE);
    cfg.apk.exists = true;
    cfg.apk.filename = "maz-gaaav.apk";
    cfg.apk.sizeText = (s.size / (1024 * 1024)).toFixed(1) + " MB";
  }

  cfg.qr.exists = fs.existsSync(CUSTOM_QR_FILE) || fs.existsSync(ROOT_QR_FILE);

  if (!cfg.gateway.keyId && process.env.RAZORPAY_KEY_ID) {
    cfg.gateway.keyId = process.env.RAZORPAY_KEY_ID;
    cfg.gateway.keySecret = process.env.RAZORPAY_KEY_SECRET || "";
    cfg.gateway.enabled = true;
  }

  return cfg;
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf8");
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
    if (err) return res.status(500).send("QR Error");
    res.setHeader("Content-Type", "image/png");
    res.send(buffer);
  });
});

app.get("/api/apk-info", (req, res) => {
  const cfg = getConfig();
  res.json({
    exists: cfg.apk.exists,
    version: cfg.apk.version || "v1.0.0",
    sizeFormatted: cfg.apk.sizeText,
    autoGateway: cfg.gateway.enabled && !!cfg.gateway.keyId
  });
});

// Razorpay 1-Click Order Creation
app.post("/api/create-order", (req, res) => {
  const cfg = getConfig();
  if (!cfg.gateway.enabled || !cfg.gateway.keyId || !cfg.gateway.keySecret) {
    return res.json({ autoGateway: false, message: "Gateway not configured" });
  }

  const authHeader = "Basic " + Buffer.from(cfg.gateway.keyId + ":" + cfg.gateway.keySecret).toString("base64");
  const postData = JSON.stringify({
    amount: APP_PRICE * 100,
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
          res.json({ autoGateway: true, keyId: cfg.gateway.keyId, orderId: order.id, amount: order.amount });
        } else {
          res.status(500).json({ error: "Order failed" });
        }
      } catch (err) {
        res.status(500).json({ error: "Invalid response" });
      }
    });
  });

  razorReq.on("error", () => res.status(500).json({ error: "Connection error" }));
  razorReq.write(postData);
  razorReq.end();
});

// Razorpay Signature Verification
app.post("/api/verify-razorpay", (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  const cfg = getConfig();

  if (!cfg.gateway.keySecret) {
    return res.status(500).json({ success: false, message: "Gateway not configured" });
  }

  const expectedSignature = crypto
    .createHmac("sha256", cfg.gateway.keySecret)
    .update(razorpay_order_id + "|" + razorpay_payment_id)
    .digest("hex");

  if (expectedSignature !== razorpay_signature) {
    return res.status(400).json({ success: false, message: "पेमेंट पडताळणी अयशस्वी!" });
  }

  const token = crypto.randomBytes(16).toString("hex");
  const expiresAt = Date.now() + 15 * 60 * 1000;
  validDownloadTokens.set(token, { paymentId: razorpay_payment_id, expiresAt });

  savePayment({
    id: `PAY-${Date.now()}`,
    reference: razorpay_payment_id,
    amount: APP_PRICE,
    type: "Razorpay GPay 1-Click",
    date: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
    downloaded: false
  });

  res.json({
    success: true,
    message: "पेमेंट १००% यशस्वी! ॲप डाऊनलोड सुरू होत आहे...",
    downloadUrl: `/api/download-apk?token=${token}`
  });
});

// Token-Protected Download
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

  let finalFile = null;
  const p = path.join(DOWNLOADS_DIR, "maz-gaaav-app.apk");
  if (fs.existsSync(p)) finalFile = p;
  if (!finalFile && fs.existsSync(ROOT_APK_FILE)) finalFile = ROOT_APK_FILE;

  if (!finalFile) {
    return res.status(404).send("APK फाईल उपलब्ध नाही. ॲडमिनशी संपर्क करा.");
  }

  const payments = getPayments();
  const payment = payments.find(p => p.reference === tokenData.paymentId);
  if (payment) {
    payment.downloaded = true;
    fs.writeFileSync(PAYMENTS_FILE, JSON.stringify(payments, null, 2), "utf8");
  }

  res.download(finalFile, "maz-gaaav.apk");
});

// ==========================================
// 🛡️ INDEPENDENT ADMIN SAVE APIS (NO INTERFERENCE)
// ==========================================
app.post("/api/admin/save-apk", uploadApk.single("apkFile"), (req, res) => {
  if (req.body.adminPin !== ADMIN_PIN) return res.status(403).json({ success: false, message: "चुकीचा पासवर्ड!" });
  if (!req.file) return res.status(400).json({ success: false, message: "फाईल निवडली नाही!" });

  const cfg = getConfig();
  cfg.apk.exists = true;
  cfg.apk.filename = "maz-gaaav-app.apk";
  cfg.apk.version = req.body.apkVersion || "v1.0.0";
  cfg.apk.sizeText = (req.file.size / (1024 * 1024)).toFixed(1) + " MB";
  saveConfig(cfg);

  res.json({ success: true, message: "✅ APK फाईल कायमची सेव्ह झाली!", sizeText: cfg.apk.sizeText });
});

app.post("/api/admin/save-qr", uploadQr.single("qrImage"), (req, res) => {
  if (req.body.adminPin !== ADMIN_PIN) return res.status(403).json({ success: false, message: "चुकीचा पासवर्ड!" });
  if (!req.file) return res.status(400).json({ success: false, message: "इमेज निवडली नाही!" });

  const cfg = getConfig();
  cfg.qr.exists = true;
  saveConfig(cfg);

  res.json({ success: true, message: "✅ GPay QR कोड कायमचा सेव्ह झाला!" });
});

app.post("/api/admin/save-gateway", (req, res) => {
  if (req.body.adminPin !== ADMIN_PIN) return res.status(403).json({ success: false, message: "चुकीचा पासवर्ड!" });
  const keyId = (req.body.keyId || "").trim();
  const keySecret = (req.body.keySecret || "").trim();
  const enabled = req.body.enabled === true || req.body.enabled === "true";

  const cfg = getConfig();
  cfg.gateway.keyId = keyId;
  cfg.gateway.keySecret = keySecret;
  cfg.gateway.enabled = enabled && !!keyId && !!keySecret;
  saveConfig(cfg);

  res.json({ success: true, message: "✅ Razorpay की कायमची सेव्ह झाली!", isActive: cfg.gateway.enabled });
});

// Admin Panel UI (ZERO RELOAD, PURE STATUS)
app.get("/admin", (req, res) => {
  const cfg = getConfig();
  const payments = getPayments();
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
        .status-box { padding: 12px; border-radius: 10px; font-weight: bold; margin-bottom: 14px; display: flex; align-items: center; justify-content: space-between; }
        .box-ok { background: #065f46; color: #a7f3d0; border: 1px solid #059669; }
        .box-wait { background: #854d0e; color: #fef08a; border: 1px solid #ca8a04; }
        .alert { padding: 12px; border-radius: 8px; margin-top: 12px; display: none; font-weight: bold; }
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
            <span style="font-size:0.85rem; color:#94a3b8;">Razorpay स्थिती</span>
            <h3 style="font-size:1.2rem; margin:8px 0 0; color:${cfg.gateway.enabled ? '#34d399' : '#facc15'};" id="gwTopStatus">
              ${cfg.gateway.enabled ? '✓ सक्रीय (Active)' : 'अपूर्ण'}
            </h3>
          </div>
        </div>

        <!-- 1. APK File Card -->
        <div class="card">
          <h2>1. APK फाईल व्यवस्थापन</h2>
          <div id="apkStatusBox" class="status-box ${cfg.apk.exists ? 'box-ok' : 'box-wait'}">
            <span>${cfg.apk.exists ? '✅ APK सर्व्हरवर सेव्ह आहे (' + cfg.apk.sizeText + ')' : '⚠️ APK फाईल अजून अपलोड केलेली नाही'}</span>
          </div>

          <label>नवीन APK फाईल निवडा:</label>
          <input type="file" id="apkFileInput" accept=".apk">
          <label>व्हर्जन:</label>
          <input type="text" id="apkVersionInput" value="${cfg.apk.version || 'v1.0.0'}">
          <button type="button" onclick="saveApk()" id="btnSaveApk">🚀 APK सेव्ह करा</button>
          <div id="apkAlert" class="alert"></div>
        </div>

        <!-- 2. QR Code Upload Card -->
        <div class="card">
          <h2>2. स्वतःचा GPay QR फोटो</h2>
          <div id="qrStatusBox" class="status-box ${cfg.qr.exists ? 'box-ok' : 'box-wait'}">
            <span>${cfg.qr.exists ? '✅ GPay QR कोड सेव्ह आहे' : '⚠️ QR फोटो अजून अपलोड केलेला नाही'}</span>
          </div>
          <img src="/api/qr-image?t=${Date.now()}" style="width:130px; height:auto; border-radius:10px; border:2px solid #059669; display:block; margin:10px 0;" id="qrImgPreview">

          <label>GPay QR चा फोटो निवडा (.png / .jpg):</label>
          <input type="file" id="qrFileInput" accept="image/*">
          <button type="button" style="background:#2563eb;" onclick="saveQr()" id="btnSaveQr">📸 QR कोड सेव्ह करा</button>
          <div id="qrAlert" class="alert"></div>
        </div>

        <!-- 3. Razorpay Key Card -->
        <div class="card">
          <h2>3. Razorpay १-क्लिक पेमेंट की (महत्त्वाचे)</h2>
          <div id="gwStatusBox" class="status-box ${cfg.gateway.enabled ? 'box-ok' : 'box-wait'}">
            <span>${cfg.gateway.enabled ? '✅ Razorpay चालू आहे (' + cfg.gateway.keyId + ')' : '⚠️ Razorpay की सेव्ह केलेली नाही'}</span>
          </div>

          <label>Razorpay Key ID:</label>
          <input type="text" id="gwKeyId" value="${cfg.gateway.keyId || ''}" placeholder="rzp_test_... किंवा rzp_live_...">
          <label>Razorpay Key Secret:</label>
          <input type="password" id="gwKeySecret" value="${cfg.gateway.keySecret || ''}" placeholder="Key Secret गुप्त कोड">
          <label style="margin-top:10px; cursor:pointer;">
            <input type="checkbox" id="gwEnabled" ${cfg.gateway.enabled ? 'checked' : ''} style="width:auto;"> 1-क्लिक पेमेंट चालू ठेवा (Enable)
          </label>
          <button type="button" style="background:#0284c7;" onclick="saveGateway()" id="btnSaveGw">💾 Razorpay की सेव्ह करा</button>
          <div id="gwAlert" class="alert"></div>
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
        // 1. Save APK without form reload
        async function saveApk() {
          const file = document.getElementById('apkFileInput').files[0];
          const alertBox = document.getElementById('apkAlert');
          const btn = document.getElementById('btnSaveApk');
          if (!file) {
            alertBox.style.display = 'block'; alertBox.style.background = '#7f1d1d'; alertBox.innerText = 'कृपया आधी APK फाईल निवडा!';
            return;
          }
          btn.disabled = true; btn.innerText = 'सेव्ह होत आहे...'; alertBox.style.display = 'none';
          const fd = new FormData();
          fd.append('apkFile', file);
          fd.append('apkVersion', document.getElementById('apkVersionInput').value);
          fd.append('adminPin', '0003');

          try {
            const res = await fetch('/api/admin/save-apk', { method: 'POST', body: fd });
            const data = await res.json();
            alertBox.style.display = 'block';
            alertBox.style.background = data.success ? '#065f46' : '#7f1d1d';
            alertBox.style.color = data.success ? '#a7f3d0' : '#fecaca';
            alertBox.innerText = data.message;
            if (data.success) {
              document.getElementById('apkStatusBox').className = 'status-box box-ok';
              document.getElementById('apkStatusBox').innerHTML = '<span>✅ APK सर्व्हरवर सेव्ह आहे (' + data.sizeText + ')</span>';
            }
          } catch(e) {
            alertBox.style.display = 'block'; alertBox.style.background = '#7f1d1d'; alertBox.innerText = 'एरर आला!';
          }
          btn.disabled = false; btn.innerText = '🚀 APK सेव्ह करा';
        }

        // 2. Save QR without form reload
        async function saveQr() {
          const file = document.getElementById('qrFileInput').files[0];
          const alertBox = document.getElementById('qrAlert');
          const btn = document.getElementById('btnSaveQr');
          if (!file) {
            alertBox.style.display = 'block'; alertBox.style.background = '#7f1d1d'; alertBox.innerText = 'कृपया आधी QR फोटो निवडा!';
            return;
          }
          btn.disabled = true; btn.innerText = 'सेव्ह होत आहे...'; alertBox.style.display = 'none';
          const fd = new FormData();
          fd.append('qrImage', file);
          fd.append('adminPin', '0003');

          try {
            const res = await fetch('/api/admin/save-qr', { method: 'POST', body: fd });
            const data = await res.json();
            alertBox.style.display = 'block';
            alertBox.style.background = data.success ? '#065f46' : '#7f1d1d';
            alertBox.style.color = data.success ? '#a7f3d0' : '#fecaca';
            alertBox.innerText = data.message;
            if (data.success) {
              document.getElementById('qrStatusBox').className = 'status-box box-ok';
              document.getElementById('qrStatusBox').innerHTML = '<span>✅ GPay QR कोड सेव्ह आहे</span>';
              document.getElementById('qrImgPreview').src = '/api/qr-image?t=' + Date.now();
            }
          } catch(e) {
            alertBox.style.display = 'block'; alertBox.style.background = '#7f1d1d'; alertBox.innerText = 'एरर आला!';
          }
          btn.disabled = false; btn.innerText = '📸 QR कोड सेव्ह करा';
        }

        // 3. Save Gateway without form reload
        async function saveGateway() {
          const alertBox = document.getElementById('gwAlert');
          const btn = document.getElementById('btnSaveGw');
          const keyId = document.getElementById('gwKeyId').value.trim();
          const keySecret = document.getElementById('gwKeySecret').value.trim();
          const enabled = document.getElementById('gwEnabled').checked;

          btn.disabled = true; btn.innerText = 'सेव्ह होत आहे...'; alertBox.style.display = 'none';

          try {
            const res = await fetch('/api/admin/save-gateway', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ keyId, keySecret, enabled, adminPin: '0003' })
            });
            const data = await res.json();
            alertBox.style.display = 'block';
            alertBox.style.background = data.success ? '#065f46' : '#7f1d1d';
            alertBox.style.color = data.success ? '#a7f3d0' : '#fecaca';
            alertBox.innerText = data.message;
            if (data.success && data.isActive) {
              document.getElementById('gwStatusBox').className = 'status-box box-ok';
              document.getElementById('gwStatusBox').innerHTML = '<span>✅ Razorpay चालू आहे (' + keyId + ')</span>';
              document.getElementById('gwTopStatus').innerText = '✓ सक्रीय (Active)';
              document.getElementById('gwTopStatus').style.color = '#34d399';
            }
          } catch(e) {
            alertBox.style.display = 'block'; alertBox.style.background = '#7f1d1d'; alertBox.innerText = 'एरर आला!';
          }
          btn.disabled = false; btn.innerText = '💾 Razorpay की सेव्ह करा';
        }
      </script>
    </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
