/**
 * maz Gaaav Admin Dashboard Logic
 * Handles PIN authentication, live status fetch, file upload with progress, and APK deletion.
 */

document.addEventListener('DOMContentLoaded', () => {

  const authGate = document.getElementById('authGate');
  const dashboard = document.getElementById('dashboard');
  const pinForm = document.getElementById('pinForm');
  const adminPinInput = document.getElementById('adminPinInput');
  const pinError = document.getElementById('pinError');
  const logoutBtn = document.getElementById('logoutBtn');

  // Elements for Live Status
  const liveStatusBadge = document.getElementById('liveStatusBadge');
  const apkInfoBox = document.getElementById('apkInfoBox');
  const noApkBox = document.getElementById('noApkBox');
  const metaFilename = document.getElementById('metaFilename');
  const metaVersion = document.getElementById('metaVersion');
  const metaSize = document.getElementById('metaSize');
  const metaUploadDate = document.getElementById('metaUploadDate');
  const metaDownloads = document.getElementById('metaDownloads');
  const metaNotesWrap = document.getElementById('metaNotesWrap');
  const metaNotes = document.getElementById('metaNotes');
  const deleteApkBtn = document.getElementById('deleteApkBtn');

  // Elements for Upload
  const uploadForm = document.getElementById('uploadForm');
  const dropZone = document.getElementById('dropZone');
  const apkFileInput = document.getElementById('apkFileInput');
  const selectedFilePill = document.getElementById('selectedFilePill');
  const selectedFileName = document.getElementById('selectedFileName');
  const selectedFileSize = document.getElementById('selectedFileSize');
  const versionInput = document.getElementById('versionInput');
  const releaseNotesInput = document.getElementById('releaseNotesInput');
  const progressWrap = document.getElementById('progressWrap');
  const progressBarFill = document.getElementById('progressBarFill');
  const progressPercent = document.getElementById('progressPercent');
  const progressStatusText = document.getElementById('progressStatusText');
  const submitUploadBtn = document.getElementById('submitUploadBtn');

  // Modal & Toast
  const confirmModal = document.getElementById('confirmModal');
  const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
  const confirmDeleteActionBtn = document.getElementById('confirmDeleteActionBtn');
  const adminToast = document.getElementById('adminToast');

  let currentAdminPin = sessionStorage.getItem('maz_admin_pin') || '';

  // 1. Check existing session
  if (currentAdminPin) {
    verifyPinSilently(currentAdminPin);
  } else {
    showLogin();
  }

  function showLogin() {
    authGate.style.display = 'flex';
    dashboard.style.display = 'none';
    adminPinInput.value = '';
    pinError.textContent = '';
    adminPinInput.focus();
  }

  function showDashboard() {
    authGate.style.display = 'none';
    dashboard.style.display = 'block';
    fetchApkInfo();
  }

  // 2. PIN Verification
  pinForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const enteredPin = adminPinInput.value.trim();
    if (!enteredPin) return;

    pinError.textContent = 'तपासत आहे... (Verifying)';

    try {
      const res = await fetch('/api/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: enteredPin })
      });
      const data = await res.json();

      if (res.ok && data.success) {
        currentAdminPin = enteredPin;
        sessionStorage.setItem('maz_admin_pin', currentAdminPin);
        showDashboard();
      } else {
        pinError.textContent = data.message || 'चुकीचा PIN. कृपया पुन्हा तपासा.';
      }
    } catch (err) {
      pinError.textContent = 'सर्व्हरशी संपर्क होऊ शकला नाही.';
    }
  });

  async function verifyPinSilently(pin) {
    try {
      const res = await fetch('/api/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pin })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showDashboard();
      } else {
        sessionStorage.removeItem('maz_admin_pin');
        showLogin();
      }
    } catch (err) {
      showLogin();
    }
  }

  logoutBtn.addEventListener('click', () => {
    sessionStorage.removeItem('maz_admin_pin');
    currentAdminPin = '';
    showLogin();
    showToast('लॉगआउट यशस्वी!');
  });

  // 3. Fetch and Render APK Info
  async function fetchApkInfo() {
    try {
      const res = await fetch('/api/apk-info');
      const data = await res.json();

      if (data.exists && data.filename) {
        // Active APK view
        liveStatusBadge.innerHTML = '<span class="badge-live">● सक्रिय (LIVE ON SITE)</span>';
        apkInfoBox.style.display = 'grid';
        noApkBox.style.display = 'none';

        metaFilename.textContent = data.filename;
        metaVersion.textContent = data.version || 'v1.0.0';
        metaSize.textContent = data.sizeFormatted || '-';
        metaUploadDate.textContent = data.uploadDate || '-';
        metaDownloads.textContent = (data.downloadCount || 0) + ' वेळा डाऊनलोड झाले';

        if (data.releaseNotes && data.releaseNotes.trim()) {
          metaNotesWrap.style.display = 'block';
          metaNotes.textContent = data.releaseNotes;
        } else {
          metaNotesWrap.style.display = 'none';
        }
      } else {
        // No APK view
        liveStatusBadge.innerHTML = '<span class="badge-offline">○ फाईल उपलब्ध नाही</span>';
        apkInfoBox.style.display = 'none';
        noApkBox.style.display = 'block';
      }
    } catch (err) {
      console.error('Error fetching APK info:', err);
    }
  }

  // 4. File Selection & Drag-and-Drop
  apkFileInput.addEventListener('change', () => {
    handleFileSelected(apkFileInput.files[0]);
  });

  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
    }, false);
  });

  dropZone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const file = dt.files[0];
    if (file) {
      apkFileInput.files = dt.files;
      handleFileSelected(file);
    }
  });

  function handleFileSelected(file) {
    if (!file) {
      selectedFilePill.style.display = 'none';
      return;
    }
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
    selectedFileName.textContent = '📄 ' + file.name;
    selectedFileSize.textContent = `(${sizeMb} MB)`;
    selectedFilePill.style.display = 'inline-flex';
  }

  // 5. Upload APK with Real-Time Progress Bar
  uploadForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const file = apkFileInput.files[0];
    if (!file) {
      showToast('कृपया एक APK फाईल निवडा!', true);
      return;
    }

    const version = versionInput.value.trim() || 'v1.0.0';
    const releaseNotes = releaseNotesInput.value.trim();

    const formData = new FormData();
    formData.append('apkFile', file);
    formData.append('version', version);
    formData.append('releaseNotes', releaseNotes);
    formData.append('adminPin', currentAdminPin);

    // Prepare UI for upload
    submitUploadBtn.disabled = true;
    submitUploadBtn.textContent = 'अपलोड सुरू आहे...';
    progressWrap.style.display = 'block';
    progressBarFill.style.width = '0%';
    progressPercent.textContent = '0%';
    progressStatusText.textContent = 'सर्व्हरवर पाठवत आहे...';

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload-apk', true);
    xhr.setRequestHeader('x-admin-pin', currentAdminPin);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percent = Math.round((event.loaded / event.total) * 100);
        progressBarFill.style.width = percent + '%';
        progressPercent.textContent = percent + '%';
        if (percent === 100) {
          progressStatusText.textContent = 'फाईल सर्व्हरवर सेव्ह होत आहे...';
        }
      }
    };

    xhr.onload = () => {
      submitUploadBtn.disabled = false;
      submitUploadBtn.innerHTML = '<span>🚀 APK सर्व्हरवर सेव्ह करा (Upload &amp; Publish)</span>';

      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const res = JSON.parse(xhr.responseText);
          if (res.success) {
            showToast('🎉 ' + res.message);
            uploadForm.reset();
            selectedFilePill.style.display = 'none';
            versionInput.value = 'v1.0.0';
            progressWrap.style.display = 'none';
            fetchApkInfo();
          } else {
            showToast('❌ ' + res.message, true);
          }
        } catch (e) {
          showToast('अपलोड यशस्वी झाले!', false);
          fetchApkInfo();
        }
      } else {
        try {
          const errRes = JSON.parse(xhr.responseText);
          showToast('❌ ' + (errRes.message || 'अपलोड अयशस्वी'), true);
        } catch (e) {
          showToast('❌ सर्व्हर त्रुटी: ' + xhr.statusText, true);
        }
      }
    };

    xhr.onerror = () => {
      submitUploadBtn.disabled = false;
      submitUploadBtn.innerHTML = '<span>🚀 APK सर्व्हरवर सेव्ह करा (Upload &amp; Publish)</span>';
      showToast('❌ नेटवर्क त्रुटी. कृपया इंटरनेट तपासा.', true);
    };

    xhr.send(formData);
  });

  // 6. Delete APK Action
  deleteApkBtn.addEventListener('click', () => {
    confirmModal.style.display = 'flex';
  });

  cancelDeleteBtn.addEventListener('click', () => {
    confirmModal.style.display = 'none';
  });

  confirmDeleteActionBtn.addEventListener('click', async () => {
    confirmModal.style.display = 'none';
    confirmDeleteActionBtn.disabled = true;

    try {
      const res = await fetch('/api/delete-apk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-pin': currentAdminPin
        },
        body: JSON.stringify({ adminPin: currentAdminPin })
      });
      const data = await res.json();

      confirmDeleteActionBtn.disabled = false;
      if (res.ok && data.success) {
        showToast('🗑️ ' + data.message);
        fetchApkInfo();
      } else {
        showToast('❌ ' + (data.message || 'डिलीट करता आले नाही.'), true);
      }
    } catch (err) {
      confirmDeleteActionBtn.disabled = false;
      showToast('❌ सर्व्हरशी संपर्क होऊ शकला नाही.', true);
    }
  });

  // Toast Helper
  let toastTimeout;
  function showToast(msg, isError = false) {
    adminToast.textContent = msg;
    adminToast.className = 'admin-toast show' + (isError ? ' error' : '');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      adminToast.classList.remove('show');
    }, 4500);
  }

});
