# maz Gaaav (माझं गाव) - Official Website & APK Download Portal

This is the landing website for the **maz Gaaav** Android bus tracking app.

## 📁 Project Structure

- index.html: Main landing page (Mobile-friendly, responsive, bilingual Marathi/Hindi/English)
- styles.css: Modern UI styling (Emerald village green & ST bus Lalpari theme)
- script.js: Interactive elements, live simulator, download toast notification
- ssets/:
  - logo.svg: Official vector logo of maz Gaaav
  - mockups/: High-resolution mockups (screen-live.svg, screen-table.svg, screen-alert.svg)
- downloads/:
  - maz-gaaav.apk: The APK file downloaded by the Download APK button.

---

## 📲 How to upload your real APK file:

1. Copy your compiled Android APK file (e.g. from Android Studio / Flutter / React Native).
2. Rename it to maz-gaaav.apk.
3. Paste and replace it in the downloads/ folder:
   maz-gaaav-website/downloads/maz-gaaav.apk
4. That's it! Whenever users click **Download APK** on the website, they will immediately get your app!

---

## 🌐 How to view/host locally:

You can open index.html directly in any web browser, or run a local server:

`ash
# Using Python
python -m http.server 8080

# Or with Node.js npx
npx serve .
`
