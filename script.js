/**
 * maz Gaaav Public Client Script
 * Fetches dynamic live APK status from server, handles phone mockup tabs, download toast, and FAQ accordion.
 */

document.addEventListener('DOMContentLoaded', () => {

  // 1. Phone Mockup Screen Tab Switcher
  const screenTabs = document.querySelectorAll('.screen-tab-btn');
  const mockupScreens = document.querySelectorAll('.mockup-img');

  screenTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetId = tab.getAttribute('data-target');

      screenTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      mockupScreens.forEach(screen => {
        if (screen.id === targetId) {
          screen.classList.add('active');
        } else {
          screen.classList.remove('active');
        }
      });
    });
  });

  // 2. Fetch Live APK Information from Server
  const heroBadgeVersion = document.getElementById('heroBadgeVersion');
  const heroMainLabel = document.getElementById('heroMainLabel');
  const heroSubLabel = document.getElementById('heroSubLabel');
  const bottomMainLabel = document.getElementById('bottomMainLabel');
  const specSizeText = document.getElementById('specSizeText');
  const specVersionText = document.getElementById('specVersionText');
  const navBtnLabel = document.getElementById('navBtnLabel');
  const toastTitle = document.getElementById('toastTitle');
  const socialDownloadText = document.getElementById('socialDownloadText');

  const downloadBtns = [
    document.getElementById('navDownloadBtn'),
    document.getElementById('heroDownloadBtn'),
    document.getElementById('bottomDownloadBtn')
  ];
  const downloadToast = document.getElementById('downloadToast');
  let toastTimer;
  let activeApkData = null;

  async function loadLiveApk() {
    try {
      const res = await fetch('/api/apk-info');
      const data = await res.json();
      activeApkData = data;

      if (data.exists && data.filename) {
        // APK is LIVE & ready for download
        if (heroBadgeVersion) heroBadgeVersion.textContent = `• ${data.version} (नवीन)`;
        if (heroMainLabel) heroMainLabel.textContent = `Download APK (${data.version})`;
        if (heroSubLabel) heroSubLabel.textContent = `Android साठी अधिकृत ॲप (${data.sizeFormatted})`;
        if (bottomMainLabel) bottomMainLabel.textContent = `मोफत APK डाऊनलोड (${data.version})`;
        if (specSizeText) specSizeText.textContent = data.sizeFormatted;
        if (specVersionText) specVersionText.textContent = `${data.version} (Android 6.0+)`;
        if (navBtnLabel) navBtnLabel.textContent = `Download (${data.version})`;
        if (socialDownloadText && data.downloadCount > 0) {
          socialDownloadText.textContent = `${data.downloadCount}+`;
        }

        downloadBtns.forEach(btn => {
          if (btn) {
            btn.href = '/api/download-apk';
            btn.style.opacity = '1';
            btn.style.cursor = 'pointer';
          }
        });

      } else {
        // No APK is currently uploaded
        if (heroBadgeVersion) heroBadgeVersion.textContent = '• नवीन आवृत्ती लवकरच येत आहे';
        if (heroMainLabel) heroMainLabel.textContent = 'लवकरच येत आहे (Coming Soon)';
        if (heroSubLabel) heroSubLabel.textContent = 'ॲडमिन नवीन फाईल अपलोड करत आहेत';
        if (bottomMainLabel) bottomMainLabel.textContent = 'नवीन व्हर्जन लवकरच उपलब्ध होईल';
        if (specSizeText) specSizeText.textContent = 'लवकरच';
        if (specVersionText) specVersionText.textContent = 'लवकरच येत आहे';
        if (navBtnLabel) navBtnLabel.textContent = 'लवकरच';

        downloadBtns.forEach(btn => {
          if (btn) {
            btn.removeAttribute('href');
            btn.style.opacity = '0.75';
          }
        });
      }

    } catch (err) {
      console.warn('Could not fetch APK info, using defaults:', err);
    }
  }

  loadLiveApk();

  // 3. Download Button Feedback Toast
  downloadBtns.forEach(btn => {
    if (btn) {
      btn.addEventListener('click', (e) => {
        if (!activeApkData || !activeApkData.exists) {
          e.preventDefault();
          showDownloadToast('⚠️ ॲडमिन कडून नवीन APK लवकरच अपलोड केले जाईल. कृपया थोड्या वेळाने तपासा.');
          return;
        }

        const fileName = activeApkData.filename || 'maz-gaaav.apk';
        showDownloadToast(`${fileName} डाऊनलोड होत आहे...`);
      });
    }
  });

  function showDownloadToast(msg) {
    if (!downloadToast) return;
    if (toastTitle) toastTitle.textContent = msg;
    downloadToast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      downloadToast.classList.remove('show');
    }, 4500);
  }

  // 4. FAQ Accordion
  const faqItems = document.querySelectorAll('.faq-item');
  faqItems.forEach(item => {
    const questionBtn = item.querySelector('.faq-question');
    if (questionBtn) {
      questionBtn.addEventListener('click', () => {
        const isOpen = item.classList.contains('active');
        faqItems.forEach(i => i.classList.remove('active'));
        if (!isOpen) {
          item.classList.add('active');
        }
      });
    }
  });

  // 5. Mobile Navigation Menu Toggle
  const mobileBtn = document.getElementById('mobileMenuBtn');
  const navLinks = document.querySelector('.nav-links');

  if (mobileBtn && navLinks) {
    mobileBtn.addEventListener('click', () => {
      const isVisible = navLinks.style.display === 'flex';
      navLinks.style.display = isVisible ? 'none' : 'flex';
      if (!isVisible) {
        navLinks.style.flexDirection = 'column';
        navLinks.style.position = 'absolute';
        navLinks.style.top = '74px';
        navLinks.style.left = '0';
        navLinks.style.right = '0';
        navLinks.style.background = '#FFFFFF';
        navLinks.style.padding = '20px';
        navLinks.style.boxShadow = '0 10px 20px rgba(0,0,0,0.1)';
        navLinks.style.borderBottom = '1px solid #E2E8F0';
      }
    });

    navLinks.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        if (window.innerWidth <= 768) {
          navLinks.style.display = 'none';
        }
      });
    });
  }

});
