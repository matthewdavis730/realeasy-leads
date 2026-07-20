// ==========================================================================
// 🎯 RealEasy Leads - Client-Side App Logic & State Management (2026)
// ==========================================================================

// Safe localStorage wrapper for file:// compatibility
const safeStorage = {
  getItem: (key) => {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      console.warn("localStorage blocked or unavailable, using in-memory fallback.");
      return null;
    }
  },
  setItem: (key, val) => {
    try {
      localStorage.setItem(key, val);
    } catch (e) {
      console.warn("localStorage write blocked or unavailable.");
    }
  },
  clear: () => {
    try {
      localStorage.clear();
    } catch (e) {
      console.warn("localStorage clear blocked or unavailable.");
    }
  }
};

// GLOBAL FETCH INTERCEPTOR FOR MULTI-TENANT AUTH
const originalFetch = window.fetch;
window.fetch = function(url, options = {}) {
  if (!options.headers) {
    options.headers = {};
  }
  const storedUser = safeStorage.getItem("re_current_user");
  if (storedUser) {
    const user = JSON.parse(storedUser);
    options.headers['x-user-id'] = user.id;
  }
  return originalFetch(url, options);
};

// AUTH STATE VARIABLES
let currentUser = null;
let authMode = "login"; // "login" | "signup"
let selectedRole = "contractor"; // "contractor" | "homeowner" | "admin"

// APP STATE
let walletBalance = 150.00;
let leads = [];
let transactions = [];
let disputes = [];
let callLogs = [];
let activeCitiesFilter = ["newark", "las vegas"];
let currentSearchQuery = "";
let currentNicheFilter = "all";
let uploadedAvatarBase64 = "";

// Setup WebSocket for Real-Time Event Sync
const socketProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const socketUrl = `${socketProtocol}//${window.location.host}`;
let wsClient;

function connectWebSocket() {
  wsClient = new WebSocket(socketUrl);
  
  wsClient.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'NEW_LEAD') {
        // Trigger inbound lead sound and alert
        triggerSmsNotification(`New Available Lead: ${data.lead.title} in ${data.lead.city}.`);
        fetchLeads();
      } else if (data.type === 'LEAD_UNLOCKED') {
        fetchLeads();
        fetchProfile();
      } else if (data.type === 'DISPUTE_SUBMITTED' || data.type === 'DISPUTE_RESOLVED') {
        fetchLeads();
        fetchDisputes();
        fetchProfile();
      } else if (data.type === 'LEAD_STATUS_UPDATED') {
        fetchLeads();
      } else if (data.type === 'PROFILE_VERIFICATION_SUBMITTED' || data.type === 'PROFILE_VERIFICATION_RESOLVED') {
        fetchProfile();
      }
    } catch(e) {
      console.error("Error parsing WebSocket message:", e);
    }
  };

  wsClient.onclose = () => {
    // Attempt reconnect after 3 seconds
    setTimeout(connectWebSocket, 3000);
  };
}

// FETCH PROFILE DATA FROM API
function fetchProfile() {
  return fetch('/api/profile')
    .then(res => res.json())
    .then(data => {
      safeStorage.setItem("re_profile", JSON.stringify(data));
      applyProfileData(data);
    })
    .catch(err => {
      console.warn("Profile fetch failed, using local storage cache:", err);
      const cached = safeStorage.getItem("re_profile");
      if (cached) {
        applyProfileData(JSON.parse(cached));
      } else {
        applyProfileData({
          name: "Apex Plumbing & Rooter",
          license: "CSLB #1094851",
          walletBalance: walletBalance,
          activeCitiesFilter: activeCitiesFilter,
          verified: false,
          verificationStatus: "unverified",
          description: "Apex Plumbing & Rooter has been providing premium commercial and residential drain cleaning, pipe replacements, and emergency plumbing services in the Bay Area and Las Vegas since 2012.",
          phone: "(510) 555-9000",
          email: "contact@apexplumbing.com",
          avatarImage: ""
        });
      }
    });
}

function applyProfileData(data) {
  walletBalance = data.walletBalance !== undefined ? data.walletBalance : walletBalance;
  activeCitiesFilter = data.activeCitiesFilter || ["newark", "las vegas"];
  
  // Update DOM values
  document.getElementById("profile-display-name").textContent = data.name;
  document.getElementById("profile-display-license").textContent = `licensee: ${data.license}`;
  document.getElementById("profile-display-desc").textContent = data.description || "No description set.";
  document.getElementById("profile-display-phone").textContent = data.phone || "Not set";
  document.getElementById("profile-display-email").textContent = data.email || "Not set";
  
  // Update Avatar
  const avatarEl = document.getElementById("profile-avatar");
  const editPreviewEl = document.getElementById("profile-edit-avatar-preview");
  const initials = data.name.split(' ').map(n => n.charAt(0)).join('').slice(0, 2).toUpperCase();
  
  if (data.avatarImage) {
    const imgHtml = `<img src="${data.avatarImage}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;
    if (avatarEl) avatarEl.innerHTML = imgHtml;
    if (editPreviewEl) editPreviewEl.innerHTML = imgHtml;
    uploadedAvatarBase64 = data.avatarImage;
  } else {
    if (avatarEl) avatarEl.textContent = initials || "AP";
    if (editPreviewEl) editPreviewEl.textContent = initials || "AP";
    uploadedAvatarBase64 = "";
  }

  // Verification badge & accordion rendering
  const badge = document.getElementById("profile-verification-badge");
  const accordion = document.getElementById("profile-verify-accordion");
  const statusVal = data.verificationStatus || (data.verified ? "verified" : "unverified");

  if (badge) {
    if (statusVal === "verified") {
      badge.textContent = "✓ Verified CSLB Contractor";
      badge.style.background = "rgba(16, 185, 129, 0.08)";
      badge.style.color = "var(--success)";
      if (accordion) accordion.style.display = "none";
    } else if (statusVal === "pending") {
      badge.textContent = "⏳ Audit Pending Review";
      badge.style.background = "rgba(245, 158, 11, 0.08)";
      badge.style.color = "#f59e0b";
      
      if (accordion) {
        accordion.style.display = "block";
        accordion.innerHTML = `
          <summary style="font-size: 11px; font-weight: 700; cursor: pointer; color: #f59e0b; user-select: none;">
            ⏳ Audit Status: Under Review
          </summary>
          <div style="margin-top: 10px; font-size: 11px; color: var(--text-secondary); line-height: 1.4;">
            Your credentials and uploaded ID/CSLB pocket card are currently being audited by the compliance team. You will be notified immediately upon approval.
          </div>
        `;
      }
    } else if (statusVal === "rejected") {
      badge.textContent = "❌ Verification Rejected";
      badge.style.background = "rgba(239, 68, 68, 0.08)";
      badge.style.color = "var(--error)";
      
      if (accordion) {
        accordion.style.display = "block";
        accordion.innerHTML = `
          <summary style="font-size: 11px; font-weight: 700; cursor: pointer; color: var(--error); user-select: none;">
            ❌ Audit Rejected (Click to Resubmit)
          </summary>
          <div style="margin-top: 10px; display: flex; flex-direction: column; gap: 8px; font-size: 11px;">
            <div style="background: rgba(239, 68, 68, 0.06); padding: 8px 10px; border-radius: 8px; border: 1px solid rgba(239, 68, 68, 0.15); color: #f87171; line-height: 1.4;">
              <strong>Rejection Reason:</strong> ${data.verificationRejectionReason || "Uploaded documents were blurry or unreadable."}
            </div>
            <p style="color: var(--text-muted); margin: 0 0 5px 0; line-height: 1.4;">Please upload clear copies of your ID and CSLB card to audit again.</p>
            
            <div class="form-group">
              <label style="font-size: 9px; margin-bottom: 2px;">1. Government Issued Photo ID</label>
              <input type="file" id="verify-id-file" accept="image/*" class="form-input" style="padding: 4px; font-size: 10px; background: rgba(0,0,0,0.2);">
            </div>
            
            <div class="form-group">
              <label style="font-size: 9px; margin-bottom: 2px;">2. CSLB Pocket Card Copy</label>
              <input type="file" id="verify-license-file" accept="image/*" class="form-input" style="padding: 4px; font-size: 10px; background: rgba(0,0,0,0.2);">
            </div>
            
            <button id="profile-verify-submit-btn" class="btn btn-primary" style="font-size: 11px; padding: 6px 0; border-radius: 8px; background: var(--success); width: 100%; margin-top: 5px;">
              🚀 Resubmit Documents
            </button>
          </div>
        `;
        attachVerifySubmitListener();
      }
    } else {
      badge.textContent = "⚠️ Unverified";
      badge.style.background = "rgba(255, 255, 255, 0.05)";
      badge.style.color = "#94a3b8";
      if (accordion) {
        accordion.style.display = "block";
        accordion.innerHTML = `
          <summary style="font-size: 11px; font-weight: 700; cursor: pointer; color: var(--text-primary); user-select: none;">
            🛡️ Submit Verification Documents
          </summary>
          <div style="margin-top: 10px; display: flex; flex-direction: column; gap: 8px; font-size: 11px;">
            <p style="color: var(--text-muted); margin: 0 0 5px 0; line-height: 1.4;">To verify your profile, upload a copy of your State ID and your physical CSLB Contractor license pocket card.</p>
            
            <div class="form-group">
              <label style="font-size: 9px; margin-bottom: 2px;">1. Government Issued Photo ID</label>
              <input type="file" id="verify-id-file" accept="image/*" class="form-input" style="padding: 4px; font-size: 10px; background: rgba(0,0,0,0.2);">
            </div>
            
            <div class="form-group">
              <label style="font-size: 9px; margin-bottom: 2px;">2. CSLB Pocket Card Copy</label>
              <input type="file" id="verify-license-file" accept="image/*" class="form-input" style="padding: 4px; font-size: 10px; background: rgba(0,0,0,0.2);">
            </div>
            
            <button id="profile-verify-submit-btn" class="btn btn-primary" style="font-size: 11px; padding: 6px 0; border-radius: 8px; background: var(--success); width: 100%; margin-top: 5px;">
              🚀 Submit Documents for Audit
            </button>
          </div>
        `;
        attachVerifySubmitListener();
      }
    }
  }

  // Sync Edit profile inputs values
  document.getElementById("profile-input-name").value = data.name;
  document.getElementById("profile-input-license").value = data.license;
  document.getElementById("profile-input-phone").value = data.phone || "";
  document.getElementById("profile-input-email").value = data.email || "";
  document.getElementById("profile-input-desc").value = data.description || "";

  // Sync switch UI toggles
  const toggleSMS = document.getElementById("toggle-sms");
  const toggleEmail = document.getElementById("toggle-email");
  if (toggleSMS) {
    const knob = toggleSMS.querySelector(".switch-knob");
    if (data.smsAlerts) {
      toggleSMS.classList.add("active");
      toggleSMS.style.background = "var(--success)";
      if (knob) knob.style.left = "20px";
    } else {
      toggleSMS.classList.remove("active");
      toggleSMS.style.background = "rgba(255,255,255,0.1)";
      if (knob) knob.style.left = "2px";
    }
  }
  if (toggleEmail) {
    const knob = toggleEmail.querySelector(".switch-knob");
    if (data.emailReports) {
      toggleEmail.classList.add("active");
      toggleEmail.style.background = "var(--success)";
      if (knob) knob.style.left = "20px";
    } else {
      toggleEmail.classList.remove("active");
      toggleEmail.style.background = "rgba(255,255,255,0.1)";
      if (knob) knob.style.left = "2px";
    }
  }
  updateWalletUI();
  renderAdminVerificationLedger(data);
}

// FETCH LEADS DATA FROM API
function fetchLeads() {
  return fetch('/api/leads')
    .then(res => res.json())
    .then(data => {
      leads = data;
      renderLeads();
    });
}

// FETCH TRANSACTIONS HISTORY FROM API
function fetchTransactions() {
  return fetch('/api/transactions')
    .then(res => res.json())
    .then(data => {
      transactions = data;
      renderTransactions();
    });
}

// FETCH DISPUTES DATA FROM API
function fetchDisputes() {
  return fetch('/api/disputes')
    .then(res => res.json())
    .then(data => {
      disputes = data;
      renderDisputes();
    });
}

// INITIALIZE APPLICATION
function initApp() {
  initTime();
  
  const user = currentUser;
  if (!user) {
    checkAuthSession();
    return;
  }

  // Setup WebSocket connection
  connectWebSocket();

  // Role-Gated Data Loading
  if (user.role === 'homeowner') {
    fetchLeads().then(() => {
      setupEventListeners();
      setupHomeownerTickets();
    }).catch(err => {
      console.error("Homeowner leads load failed:", err);
      setupEventListeners();
    });
  } else if (user.role === 'admin') {
    // Admin (Keith) Data Loading
    Promise.all([
      fetchLeads(),
      fetchDisputes(),
      fetchAdminContractors()
    ]).then(() => {
      setupEventListeners();
      setupAiCallSimulator();
    }).catch(err => {
      console.error("Admin data load failed:", err);
      setupEventListeners();
      setupAiCallSimulator();
    });
  } else {
    // Contractor Data Loading
    Promise.all([
      fetchProfile(),
      fetchLeads(),
      fetchTransactions(),
      fetchDisputes(),
      fetchCallLogs()
    ]).then(() => {
      setupEventListeners();
      setupAiCallSimulator();
    }).catch(err => {
      console.error("Error loading application data from backend server:", err);
      setupEventListeners();
      setupAiCallSimulator();
    });
  }
}

// 🔐 SESSION CHECK & AUTH GATE CONTROLLERS
function checkAuthSession() {
  const storedUser = safeStorage.getItem("re_current_user");
  const authGate = document.getElementById("auth-gate");
  
  if (storedUser) {
    currentUser = JSON.parse(storedUser);
    if (authGate) authGate.style.display = "none";
    applyRoleLayout(currentUser);
    initApp();
  } else {
    currentUser = null;
    if (authGate) authGate.style.display = "flex";
    setupAuthListeners();
  }
}

function setupAuthListeners() {
  const authGate = document.getElementById("auth-gate");
  if (!authGate) return;

  const roleBtns = document.querySelectorAll("#auth-role-selector .role-btn");
  const toggleLink = document.getElementById("auth-toggle-mode");
  const authForm = document.getElementById("auth-form");
  const submitBtn = document.getElementById("auth-submit-btn");

  const nameGroup = document.getElementById("auth-group-name");
  const phoneGroup = document.getElementById("auth-group-phone");
  const licenseGroup = document.getElementById("auth-group-license");
  const subtitle = document.getElementById("auth-gate-subtitle");

  // Handle role selection
  roleBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      roleBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      selectedRole = btn.getAttribute("data-role");
      
      // Update subtitles
      subtitle.textContent = selectedRole.charAt(0).toUpperCase() + selectedRole.slice(1) + " " + (authMode === "login" ? "Login" : "Registration");
      
      // Update form dynamic fields based on current mode and role
      updateAuthFormFields();
    });
  });

  // Handle sign up vs login toggles
  if (toggleLink) {
    toggleLink.addEventListener("click", () => {
      if (authMode === "login") {
        authMode = "signup";
        toggleLink.textContent = "Already have an account? Log In";
        submitBtn.textContent = "Create Account";
      } else {
        authMode = "login";
        toggleLink.textContent = "Don't have an account? Sign Up";
        submitBtn.textContent = "Log In securely";
      }
      subtitle.textContent = selectedRole.charAt(0).toUpperCase() + selectedRole.slice(1) + " " + (authMode === "login" ? "Login" : "Registration");
      updateAuthFormFields();
    });
  }

  function updateAuthFormFields() {
    if (authMode === "login") {
      nameGroup.style.display = "none";
      phoneGroup.style.display = "none";
      licenseGroup.style.display = "none";
    } else {
      nameGroup.style.display = "block";
      phoneGroup.style.display = "block";
      if (selectedRole === "contractor") {
        licenseGroup.style.display = "block";
      } else {
        licenseGroup.style.display = "none";
      }
    }
  }

  // Handle Form Submit (API Call / Cache Fallback)
  if (authForm) {
    // Prevent duplicate registrations
    authForm.onsubmit = (e) => {
      e.preventDefault();

      const email = document.getElementById("auth-input-email").value.trim();
      const password = document.getElementById("auth-input-password").value;
      const name = document.getElementById("auth-input-name").value.trim();
      const phone = document.getElementById("auth-input-phone").value.trim();
      const license = document.getElementById("auth-input-license").value.trim();

      const endpoint = authMode === "login" ? "/api/auth/login" : "/api/auth/signup";
      const payload = authMode === "login" 
        ? { email, password } 
        : { name, email, password, role: selectedRole, phone, license };

      submitBtn.disabled = true;
      submitBtn.textContent = "⚡ Verifying Credentials...";

      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      .then(res => {
        if (!res.ok) {
          return res.json().then(err => { throw new Error(err.error || "Authentication failed"); });
        }
        return res.json();
      })
      .then(data => {
        safeStorage.setItem("re_current_user", JSON.stringify(data.user));
        currentUser = data.user;
        
        // Hide gate and load app
        authGate.style.display = "none";
        applyRoleLayout(currentUser);
        initApp();
        triggerDynamicIslandNotification("🔐 Access Granted!");
      })
      .catch(err => {
        console.error("Auth API failed, trying offline mock:", err);
        
        // Offline demo fallback in case API is offline or file:// mode
        if (authMode === "login") {
          let demoUser = null;
          if (email === "keith@whatsrealeasy.com") {
            demoUser = { id: "usr-keith", email, role: "admin", name: "Keith Thunds" };
          } else if (email === "homeowner@example.com") {
            demoUser = { id: "usr-homeowner", email, role: "homeowner", name: "David Vance", phone: "(510) 555-0811" };
          } else {
            demoUser = { id: "usr-apex", email, role: "contractor", name: name || "Apex Plumbing", license: license || "CSLB #1094851", walletBalance: 650.00 };
          }
          
          safeStorage.setItem("re_current_user", JSON.stringify(demoUser));
          currentUser = demoUser;
          authGate.style.display = "none";
          applyRoleLayout(currentUser);
          initApp();
          triggerDynamicIslandNotification("🔐 Offline Demo Mode Activated!");
        } else {
          alert("Offline registration error. Please use demo credentials to log in: keith@whatsrealeasy.com (Admin) or apex@example.com (Pro) or homeowner@example.com (Client).");
          submitBtn.disabled = false;
          submitBtn.textContent = authMode === "login" ? "Log In securely" : "Create Account";
        }
      });
    };
  }
}

function applyRoleLayout(user) {
  const roleLabel = document.getElementById("header-user-role");
  const walletBadge = document.getElementById("wallet-trigger");
  const navBar = document.querySelector(".nav-bar");
  const navMarket = document.getElementById("nav-marketplace");
  const navUnlocked = document.getElementById("nav-unlocked");
  const navProfile = document.getElementById("nav-profile");
  const navAdmin = document.getElementById("nav-admin");

  const screens = document.querySelectorAll(".app-screen");

  if (roleLabel) {
    roleLabel.textContent = user.role === 'admin' ? "Admin Portal" : user.role === 'homeowner' ? "Homeowner Portal" : "Contractor Portal";
  }

  // Hide all screens initially
  screens.forEach(s => s.classList.remove("active"));

  if (user.role === 'homeowner') {
    // Homeowner UI
    if (walletBadge) walletBadge.style.display = "none";
    if (navBar) navBar.style.display = "none";
    
    const homeownerScreen = document.getElementById("screen-homeowner");
    if (homeownerScreen) homeownerScreen.classList.add("active");
  } else if (user.role === 'admin') {
    // Admin UI (Keith)
    if (walletBadge) walletBadge.style.display = "none";
    if (navBar) {
      navBar.style.display = "flex";
      if (navMarket) navMarket.style.display = "none";
      if (navUnlocked) navUnlocked.style.display = "none";
      if (navProfile) navProfile.style.display = "flex";
      if (navAdmin) navAdmin.style.display = "flex";
    }

    const adminScreen = document.getElementById("screen-admin");
    if (adminScreen) adminScreen.classList.add("active");
    if (navAdmin) {
      document.querySelectorAll(".nav-bar .nav-item").forEach(i => i.classList.remove("active"));
      navAdmin.classList.add("active");
    }
  } else {
    // Contractor UI
    if (walletBadge) walletBadge.style.display = "flex";
    if (navBar) {
      navBar.style.display = "flex";
      if (navMarket) navMarket.style.display = "flex";
      if (navUnlocked) navUnlocked.style.display = "flex";
      if (navProfile) navProfile.style.display = "flex";
      if (navAdmin) navAdmin.style.display = "none";
    }

    const marketScreen = document.getElementById("screen-marketplace");
    if (marketScreen) marketScreen.classList.add("active");
    if (navMarket) {
      document.querySelectorAll(".nav-bar .nav-item").forEach(i => i.classList.remove("active"));
      navMarket.classList.add("active");
    }
  }
}

function handleLogout() {
  safeStorage.clear();
  currentUser = null;
  location.reload();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}

// CLOCK INITIALIZER (iOS Top Status Bar)
function initTime() {
  const timeEl = document.getElementById("status-time");
  const update = () => {
    const now = new Date();
    let hours = now.getHours();
    let minutes = now.getMinutes();
    minutes = minutes < 10 ? "0" + minutes : minutes;
    timeEl.textContent = `${hours}:${minutes}`;
  };
  update();
  setInterval(update, 60000);
}

// UPDATE WALLET BALANCE IN UI WITH EFFECTS
function updateWalletUI() {
  const headerBal = document.getElementById("header-wallet-balance");
  const mainBal = document.getElementById("wallet-display-balance");
  
  // Format to 2 decimal places
  const formatted = `$${walletBalance.toFixed(2)}`;
  
  // Apply changes
  headerBal.textContent = formatted;
  mainBal.textContent = walletBalance.toFixed(2);
}

// SETUP DOM EVENT LISTENERS
function setupEventListeners() {
  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.onclick = () => {
      if (confirm("Are you sure you want to log out of RealEasy Leads?")) {
        handleLogout();
      }
    };
  }

  // Navigation Tab Switches
  const navItems = document.querySelectorAll(".nav-bar .nav-item");
  const screens = document.querySelectorAll(".app-screen");
  
  navItems.forEach(item => {
    item.addEventListener("click", () => {
      const targetScreenId = item.getAttribute("data-screen");
      
      // Update Navbar active class
      navItems.forEach(i => i.classList.remove("active"));
      item.classList.add("active");
      
      // Update screen active class
      screens.forEach(s => s.classList.remove("active"));
      document.getElementById(targetScreenId).classList.add("active");
      
      // Expand Dynamic Island for a bounce effect on navigation
      triggerDynamicIslandNotification("Switched view");
    });
  });

  // Profile Edit Toggle Handlers
  const editBtn = document.getElementById("profile-edit-btn");
  const cancelBtn = document.getElementById("profile-cancel-btn");
  const saveBtn = document.getElementById("profile-save-btn");
  const displayCard = document.getElementById("profile-details-display");
  const editForm = document.getElementById("profile-edit-container");
  const fileInput = document.getElementById("profile-file-input");
  const editAvatarPreview = document.getElementById("profile-edit-avatar-preview");

  if (editBtn && editForm && displayCard) {
    editBtn.addEventListener("click", () => {
      displayCard.style.display = "none";
      editForm.style.display = "block";
    });
  }

  if (cancelBtn && editForm && displayCard) {
    cancelBtn.addEventListener("click", () => {
      editForm.style.display = "none";
      displayCard.style.display = "block";
    });
  }

  // Handle Photo Avatar File Upload
  if (fileInput && editAvatarPreview) {
    fileInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          uploadedAvatarBase64 = event.target.result;
          editAvatarPreview.innerHTML = `<img src="${uploadedAvatarBase64}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;
          triggerDynamicIslandNotification("📷 Photo uploaded!");
        };
        reader.readAsDataURL(file);
      }
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      const name = document.getElementById("profile-input-name").value.trim();
      const license = document.getElementById("profile-input-license").value.trim();
      const phone = document.getElementById("profile-input-phone").value.trim();
      const email = document.getElementById("profile-input-email").value.trim();
      const description = document.getElementById("profile-input-desc").value.trim();

      if (!name || !license) {
        alert("Name and License fields are required.");
        return;
      }

      const updateData = { name, license, phone, email, description, avatarImage: uploadedAvatarBase64 };

      fetch('/api/profile/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData)
      })
      .then(res => res.json())
      .then(() => {
        fetchProfile();
        editForm.style.display = "none";
        displayCard.style.display = "block";
        triggerDynamicIslandNotification("👤 Profile updated!");
      })
      .catch(err => {
        console.warn("API save failed. Saving locally to localStorage cache:", err);
        
        // Save to cache
        let cached = JSON.parse(safeStorage.getItem("re_profile") || "{}");
        cached = { ...cached, ...updateData };
        safeStorage.setItem("re_profile", JSON.stringify(cached));
        
        applyProfileData(cached);
        editForm.style.display = "none";
        displayCard.style.display = "block";
        triggerDynamicIslandNotification("👤 Profile updated locally!");
      });
    });
  }

  // List vs Map View Toggle
  const viewListBtn = document.getElementById("view-list-btn");
  const viewMapBtn = document.getElementById("view-map-btn");
  const leadsContainer = document.getElementById("available-leads-container");
  const mapViewContainer = document.getElementById("map-view-container");
  const popupCard = document.getElementById("map-popup-card");

  if (viewListBtn && viewMapBtn) {
    viewListBtn.addEventListener("click", () => {
      viewListBtn.classList.add("active");
      viewListBtn.style.background = "rgba(255,255,255,0.06)";
      viewListBtn.style.color = "var(--text-primary)";
      
      viewMapBtn.classList.remove("active");
      viewMapBtn.style.background = "transparent";
      viewMapBtn.style.color = "var(--text-muted)";
      
      leadsContainer.style.display = "flex";
      mapViewContainer.style.display = "none";
      if (popupCard) popupCard.style.display = "none";
    });

    viewMapBtn.addEventListener("click", () => {
      viewMapBtn.classList.add("active");
      viewMapBtn.style.background = "rgba(255,255,255,0.06)";
      viewMapBtn.style.color = "var(--text-primary)";
      
      viewListBtn.classList.remove("active");
      viewListBtn.style.background = "transparent";
      viewListBtn.style.color = "var(--text-muted)";
      
      leadsContainer.style.display = "none";
      mapViewContainer.style.display = "block";
      
      renderMapMarkers();
    });
  }

  // Search & Filter Listeners (Phase 2 Upgrade - Feature 6)
  const searchInput = document.getElementById("lead-search-input");
  const clearSearchBtn = document.getElementById("search-clear-btn");
  const filterPills = document.querySelectorAll(".filter-pill");

  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      currentSearchQuery = e.target.value.trim().toLowerCase();
      if (clearSearchBtn) {
        clearSearchBtn.style.display = currentSearchQuery.length > 0 ? "block" : "none";
      }
      renderLeads();
    });
  }

  if (clearSearchBtn && searchInput) {
    clearSearchBtn.addEventListener("click", () => {
      searchInput.value = "";
      currentSearchQuery = "";
      clearSearchBtn.style.display = "none";
      renderLeads();
    });
  }

  filterPills.forEach(pill => {
    pill.addEventListener("click", () => {
      // Toggle active states
      filterPills.forEach(p => {
        p.classList.remove("active");
        p.style.background = "transparent";
        p.style.color = "var(--text-secondary)";
        p.style.borderColor = "";
      });

      pill.classList.add("active");
      currentNicheFilter = pill.getAttribute("data-filter");

      // Custom themed backgrounds on filter selection
      if (currentNicheFilter === "all") {
        pill.style.background = "rgba(255,255,255,0.06)";
        pill.style.color = "var(--text-primary)";
      } else if (currentNicheFilter === "plumbing") {
        pill.style.background = "rgba(16, 185, 129, 0.12)";
        pill.style.color = "var(--success)";
        pill.style.borderColor = "rgba(16, 185, 129, 0.3)";
      } else if (currentNicheFilter === "roofing") {
        pill.style.background = "rgba(99, 102, 241, 0.12)";
        pill.style.color = "var(--primary)";
        pill.style.borderColor = "rgba(99, 102, 241, 0.3)";
      }

      renderLeads();
    });
  });

  // City Preference Toggles (Focus Cities Settings - Phase 2 Polish)
  const cityBadges = document.querySelectorAll(".city-pref-badge");
  cityBadges.forEach(badge => {
    const city = badge.getAttribute("data-city");
    
    // Sync initial style based on state
    if (activeCitiesFilter.includes(city)) {
      badge.classList.add("active");
      badge.style.background = "rgba(16, 185, 129, 0.1)";
      badge.style.borderColor = "rgba(16, 185, 129, 0.25)";
      badge.style.color = "var(--success)";
    } else {
      badge.classList.remove("active");
      badge.style.background = "rgba(255,255,255,0.03)";
      badge.style.borderColor = "rgba(255,255,255,0.08)";
      badge.style.color = "var(--text-muted)";
    }

    badge.addEventListener("click", () => {
      const isActive = badge.classList.contains("active");
      if (isActive) {
        badge.classList.remove("active");
        badge.style.background = "rgba(255,255,255,0.03)";
        badge.style.borderColor = "rgba(255,255,255,0.08)";
        badge.style.color = "var(--text-muted)";
        activeCitiesFilter = activeCitiesFilter.filter(c => c !== city);
      } else {
        badge.classList.add("active");
        badge.style.background = "rgba(16, 185, 129, 0.1)";
        badge.style.borderColor = "rgba(16, 185, 129, 0.25)";
        badge.style.color = "var(--success)";
        activeCitiesFilter.push(city);
      }
      
      // Update database profile settings
      fetch('/api/profile/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activeCitiesFilter })
      })
      .then(res => res.json())
      .then(() => {
        renderLeads();
      });
    });
  });

  // Switch Toggle click listeners (Phase 2 Polish)
  const toggleSMS = document.getElementById("toggle-sms");
  const toggleEmail = document.getElementById("toggle-email");

  if (toggleSMS) {
    toggleSMS.addEventListener("click", () => {
      const isActive = toggleSMS.classList.contains("active");
      const knob = toggleSMS.querySelector(".switch-knob");
      const nextSMSVal = !isActive;
      
      if (isActive) {
        toggleSMS.classList.remove("active");
        toggleSMS.style.background = "rgba(255,255,255,0.1)";
        if (knob) knob.style.left = "2px";
        triggerDynamicIslandNotification("💬 SMS Notifications Disabled");
      } else {
        toggleSMS.classList.add("active");
        toggleSMS.style.background = "var(--success)";
        if (knob) knob.style.left = "20px";
        triggerDynamicIslandNotification("💬 SMS Notifications Enabled");
      }

      fetch('/api/profile/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ smsAlerts: nextSMSVal })
      });
    });
  }

  if (toggleEmail) {
    toggleEmail.addEventListener("click", () => {
      const isActive = toggleEmail.classList.contains("active");
      const knob = toggleEmail.querySelector(".switch-knob");
      const nextEmailVal = !isActive;
      
      if (isActive) {
        toggleEmail.classList.remove("active");
        toggleEmail.style.background = "rgba(255,255,255,0.1)";
        if (knob) knob.style.left = "2px";
        triggerDynamicIslandNotification("📧 Email Reports Disabled");
      } else {
        toggleEmail.classList.add("active");
        toggleEmail.style.background = "var(--success)";
        if (knob) knob.style.left = "20px";
        triggerDynamicIslandNotification("📧 Email Reports Enabled");
      }

      fetch('/api/profile/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailReports: nextEmailVal })
      });
    });
  }

  // Modal Open/Close (Wallet Sheet)
  const walletTrigger = document.getElementById("wallet-trigger");
  const addFundsBtnMain = document.getElementById("add-funds-btn-main");
  const closeBtn = document.getElementById("modal-close-btn");
  const overlay = document.getElementById("modal-overlay");
  const modalSheet = document.getElementById("modal-sheet");

  const openWalletModal = () => {
    overlay.classList.add("active");
    modalSheet.style.bottom = "0px";
  };

  const closeWalletModal = () => {
    overlay.classList.remove("active");
    modalSheet.style.bottom = "-100%";
  };

  walletTrigger.addEventListener("click", openWalletModal);
  addFundsBtnMain.addEventListener("click", openWalletModal);
  closeBtn.addEventListener("click", closeWalletModal);
  overlay.addEventListener("click", closeWalletModal);

  // Deposit Form Submit
  const depositForm = document.getElementById("deposit-form");
  depositForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const amount = parseFloat(document.getElementById("deposit-amount").value);
    
    if (amount && amount > 0) {
      // Show Stripe Elements loader spinner overlay
      const overlay = document.getElementById("stripe-loading-overlay");
      if (overlay) {
        overlay.style.display = "flex";
        setTimeout(() => { overlay.style.opacity = "1"; }, 10);
      }

      setTimeout(() => {
        fetch('/api/wallet/deposit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount, description: "Stripe Mock Deposit" })
        })
        .then(res => res.json())
        .then(data => {
          walletBalance = data.profile.walletBalance;
          updateWalletUI();
          fetchTransactions();
          
          // Hide overlay
          if (overlay) {
            overlay.style.opacity = "0";
            setTimeout(() => { overlay.style.display = "none"; }, 300);
          }
          
          closeWalletModal();
          triggerDynamicIslandNotification(`+$${amount.toFixed(2)} Deposited!`);
          
          // Pulse animation effect on wallet displays
          const badges = [document.getElementById("wallet-trigger"), document.querySelector(".wallet-card")];
          badges.forEach(b => {
            if (b) {
              b.style.transform = "scale(1.05)";
              b.style.boxShadow = "0 0 25px rgba(16, 185, 129, 0.4)";
              setTimeout(() => {
                b.style.transform = "";
                b.style.boxShadow = "";
              }, 300);
            }
          });
        });
      }, 1400); // 1.4s simulated Stripe Elements gateway delay
    }
  });

  // Post Lead Form Submit (Admin)
  const postLeadForm = document.getElementById("post-lead-form");
  postLeadForm.addEventListener("submit", (e) => {
    e.preventDefault();
    
    const niche = document.getElementById("lead-niche").value;
    const title = document.getElementById("lead-title").value;
    const city = document.getElementById("lead-city").value;
    const description = document.getElementById("lead-desc").value;
    const price = parseFloat(document.getElementById("lead-price").value);
    const customerName = document.getElementById("lead-name").value;
    const customerPhone = document.getElementById("lead-phone").value;

    fetch('/api/leads/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ niche, title, city, description, price, customerName, customerPhone })
    })
    .then(res => res.json())
    .then(() => {
      // Reset Form
      postLeadForm.reset();
      
      // Switch Screen back to Marketplace
      document.getElementById("nav-marketplace").click();
      
      // Re-fetch leads
      fetchLeads();
      triggerDynamicIslandNotification("Lead posted to feed!");
    });
  });

  // Reset Mockup Data Click Handler
  const resetBtn = document.getElementById("reset-mockup-btn");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      const confirmReset = confirm("Are you sure you want to reset all mockup data back to defaults? This will clear your wallet deposits, unlocked leads, and custom listings.");
      if (confirmReset) {
        fetch('/api/platform/reset', { method: 'POST' })
        .then(() => {
          triggerDynamicIslandNotification("🔄 Resetting data...");
          setTimeout(() => {
            window.location.reload();
          }, 800);
        });
      }
    });
  }
}

// RENDER MARKETPLACE & UNLOCKED FEEDS
function renderLeads() {
  const marketContainer = document.getElementById("available-leads-container");
  const unlockedContainer = document.getElementById("unlocked-leads-container");
  
  marketContainer.innerHTML = "";
  unlockedContainer.innerHTML = "";
  
  let availableCount = 0;
  let unlockedCount = 0;

  leads.forEach(lead => {
    if (lead.unlocked) {
      unlockedCount++;
      
      // Dynamic rendering based on dispute / progress status
      let disputeHTML = "";
      if (lead.disputed) {
        disputeHTML = `<div style="font-size: 11px; color:#f87171; font-weight:700; background: rgba(239, 68, 68, 0.05); padding: 6px 12px; border-radius: 8px; margin-top: 10px; border: 1px solid rgba(239, 68, 68, 0.15); text-align: center;">⚠️ Dispute Pending Review</div>`;
      } else {
        disputeHTML = `
          <div style="display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap;">
            <button class="btn btn-secondary" onclick="disputeLead('${lead.id}')" style="flex: 1; padding: 6px 0; font-size: 10px; border-radius: 8px; border: 1px solid rgba(239, 68, 68, 0.25); color: #f87171; background: rgba(239, 68, 68, 0.03);">⚠️ Dispute Refund</button>
            <a href="javascript:void(0)" onclick="simulateCall('${lead.customerName.replace(/'/g, "\\'")}', '${lead.customerPhone}', '${lead.niche}')" class="btn btn-primary" style="flex: 1.2; text-align: center; text-decoration: none; padding: 6px 0; font-size: 10px; border-radius: 8px; background: var(--primary); display: flex; align-items: center; justify-content: center; gap: 4px;">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="margin-top:-1px;"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
              Place VoIP Call
            </a>
          </div>
        `;
      }

      const isCompleted = lead.status === "completed";
      const revenueInputHTML = isCompleted ? `
        <div style="display: flex; align-items: center; gap: 8px; margin-top: 10px; padding: 8px 10px; background: rgba(16, 185, 129, 0.04); border-radius: 10px; border: 1px solid rgba(16, 185, 129, 0.1);">
          <span style="font-size: 10px; color: var(--success); font-weight:700;">Logged Revenue:</span>
          <input type="number" placeholder="Value ($)" value="${lead.jobRevenue || ''}" onchange="updateJobRevenue('${lead.id}', this.value)" style="flex:1; background: rgba(0,0,0,0.2); border: 1px solid var(--border-card); border-radius: 6px; padding: 4px 6px; font-size:11px; color:#fff; font-weight:800; max-width:80px;">
        </div>
      ` : "";

      // Render unlocked lead card
      const card = document.createElement("div");
      card.className = "lead-card";
      card.innerHTML = `
        <div class="lead-top">
          <span class="lead-badge badge-${lead.niche}">${lead.niche === 'plumbing' ? 'Plumbing' : 'Roofing'}</span>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="font-size: 9px; color: var(--text-muted); font-weight: 700; text-transform: uppercase;">Status:</span>
            <select onchange="updateLeadStatus('${lead.id}', this.value)" style="background: rgba(255,255,255,0.04); border: 1px solid var(--border-card); border-radius: 6px; font-size: 9px; padding: 2px 4px; color: var(--text-primary); font-weight: 700; cursor: pointer;">
              <option value="unlocked" ${lead.status === 'unlocked' ? 'selected' : ''}>Unlocked</option>
              <option value="contacted" ${lead.status === 'contacted' ? 'selected' : ''}>Contacted</option>
              <option value="booked" ${lead.status === 'booked' ? 'selected' : ''}>Job Booked</option>
              <option value="completed" ${lead.status === 'completed' ? 'selected' : ''}>Completed</option>
              <option value="lost" ${lead.status === 'lost' ? 'selected' : ''}>Lost</option>
            </select>
          </div>
        </div>
        <h3 class="lead-title">${lead.title}</h3>
        <p class="lead-details">${lead.description}</p>
        <div class="verifications-row" style="display: flex; gap: 6px; margin-top: 10px; margin-bottom: 5px;">
          <span style="font-size: 9px; padding: 2px 6px; border-radius: 8px; background: rgba(16, 185, 129, 0.08); color: var(--success); font-weight: 700; display: inline-flex; align-items: center; gap: 3px;">
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4"><polyline points="20 6 9 17 4 12"></polyline></svg>
            Phone Verified
          </span>
          <span style="font-size: 9px; padding: 2px 6px; border-radius: 8px; background: rgba(99, 102, 241, 0.08); color: var(--primary); font-weight: 700; display: inline-flex; align-items: center; gap: 3px;">
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4"><polyline points="20 6 9 17 4 12"></polyline></svg>
            AI Audited
          </span>
        </div>
        <div class="lead-info-row">
          <div class="lead-info-item">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
            <span>${lead.city}</span>
          </div>
        </div>
        <div class="unlocked-details">
          <div class="unlocked-item">
            <span class="unlocked-label">Customer:</span>
            <span class="unlocked-value">${lead.customerName}</span>
          </div>
          <div class="unlocked-item">
            <span class="unlocked-label">Phone:</span>
            <span class="unlocked-value" style="color: var(--primary); font-weight: 700;">${lead.customerPhone}</span>
          </div>
        </div>
        ${revenueInputHTML}
        ${disputeHTML}
      `;
      unlockedContainer.appendChild(card);
    } else {
      // Available lead: apply filter check
      const matchesCity = activeCitiesFilter.some(c => lead.city && lead.city.toLowerCase().includes(c.toLowerCase()));
      const matchesNiche = currentNicheFilter === "all" || lead.niche === currentNicheFilter;
      const matchesSearch = lead.title.toLowerCase().includes(currentSearchQuery) || 
                            lead.city.toLowerCase().includes(currentSearchQuery) ||
                            lead.description.toLowerCase().includes(currentSearchQuery);

      if (matchesNiche && matchesSearch && matchesCity) {
        availableCount++;
        // Render available lead card
        const card = document.createElement("div");
        card.className = "lead-card";
        card.innerHTML = `
          <div class="lead-top">
            <span class="lead-badge badge-${lead.niche}">${lead.niche === 'plumbing' ? 'Plumbing' : 'Roofing'}</span>
            <span class="lead-price">$${lead.price.toFixed(2)}</span>
          </div>
          <h3 class="lead-title">${lead.title}</h3>
          <p class="lead-details">${lead.description}</p>
          <div class="verifications-row" style="display: flex; gap: 6px; margin-top: 10px; margin-bottom: 5px;">
            <span style="font-size: 9px; padding: 2px 6px; border-radius: 8px; background: rgba(16, 185, 129, 0.08); color: var(--success); font-weight: 700; display: inline-flex; align-items: center; gap: 3px;">
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4"><polyline points="20 6 9 17 4 12"></polyline></svg>
              Phone Verified
            </span>
            <span style="font-size: 9px; padding: 2px 6px; border-radius: 8px; background: rgba(99, 102, 241, 0.08); color: var(--primary); font-weight: 700; display: inline-flex; align-items: center; gap: 3px;">
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4"><polyline points="20 6 9 17 4 12"></polyline></svg>
              AI Audited
            </span>
          </div>
          <div class="lead-info-row">
            <div class="lead-info-item">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
              <span>${lead.city}</span>
            </div>
            <div class="lead-info-item">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
              <span>${lead.date}</span>
            </div>
          </div>
          <button class="btn btn-primary" onclick="unlockLead('${lead.id}')" style="width: 100%; margin-top: 5px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
            Unlock Lead Details
          </button>
        `;
        marketContainer.appendChild(card);
      }
    }
  });

  // Add empty states if feed empty
  if (availableCount === 0) {
    marketContainer.innerHTML = `<div class="lead-card" style="text-align:center; padding: 40px 20px; color: var(--text-muted);">No new leads in your area. Check back later!</div>`;
  }
  if (unlockedCount === 0) {
    unlockedContainer.innerHTML = `<div class="lead-card" style="text-align:center; padding: 40px 20px; color: var(--text-muted);">You haven't unlocked any leads yet. Go to Market to find clients.</div>`;
  }

  // Update counts
  document.getElementById("available-count-badge").textContent = `${availableCount} Leads Available`;
  document.getElementById("unlocked-count-badge").textContent = `${unlockedCount} Leads Unlocked`;
  updateAnalyticsUI();
  updateProfileUI();
  
  // Refresh map markers if map is visible
  if (document.getElementById("map-view-container") && document.getElementById("map-view-container").style.display === "block") {
    renderMapMarkers();
  }
}

// UNLOCK LEAD FLOW
window.unlockLead = function(id) {
  const leadIndex = leads.findIndex(l => l.id === id);
  if (leadIndex === -1) return;
  
  const lead = leads[leadIndex];
  
  // Check funds client-side first
  if (walletBalance < lead.price) {
    triggerDynamicIslandNotification("❌ Insufficient Funds!");
    alert("Insufficient funds! Please add a deposit to unlock this lead.");
    return;
  }
  
  // Confirm action
  const confirmUnlock = confirm(`Unlock this lead for $${lead.price.toFixed(2)}?`);
  if (!confirmUnlock) return;
  
  // Post transaction unlock to backend server
  fetch('/api/leads/unlock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id })
  })
  .then(res => {
    if (!res.ok) {
      return res.json().then(err => { throw new Error(err.error || "Failed to unlock"); });
    }
    return res.json();
  })
  .then(data => {
    // Update local state
    leads[leadIndex] = data.lead;
    walletBalance = data.profile.walletBalance;
    
    // Update UI
    updateWalletUI();
    renderLeads();
    fetchTransactions();
    
    triggerDynamicIslandNotification("🔓 Lead Unlocked successfully!");
  })
  .catch(err => {
    alert("Failed to unlock lead: " + err.message);
  });
};

// DYNAMIC ISLAND VISUAL NOTIFIER (iOS Interactive Feel)
function triggerDynamicIslandNotification(text) {
  const island = document.getElementById("dynamic-island");
  
  // Set contents & styles
  island.innerHTML = `<span style="font-size: 11px; font-weight: 700; white-space: nowrap; animation: fadeIn 0.2s;">${text}</span>`;
  island.style.width = "260px";
  island.style.height = "38px";
  
  // Auto collapse back to standard pill notch shape after 3.2s
  setTimeout(() => {
    island.style.width = "";
    island.style.height = "";
    island.innerHTML = "";
  }, 3200);
}

// ==========================================================================
// 🤖 INBOUND HOMEOWNER AI DISPATCH CHAT SIMULATOR (Phase 2 Upgrade - Feature 1)
// ==========================================================================
let isAiSimulating = false;

// Simple structured dialogue script representing what is processed
const aiDialogScript = [
  { sender: "System", text: "Incoming Hotline Call connected to Homeowner AI Dispatcher...", isAi: false },
  { sender: "AI Operator", text: "Hello! Thank you for calling RealEasy Hotline. What home service issue are you experiencing today?", isAi: true },
  { sender: "Caller (Newark)", text: "Hi, I have a major leak in my gas water heater tank. Water is pooling all over the basement floor.", isAi: false },
  { sender: "AI Operator", text: "I understand, water heater leaks can cause significant damage. Let me verify, what is your full name and the address/city of the property?", isAi: true },
  { sender: "Caller (Newark)", text: "My name is David Vance. I'm located in Newark, California.", isAi: false },
  { sender: "AI Operator", text: "Thank you, David. I am initiating an emergency plumbing service request for Newark, CA. What is the best phone number to reach you immediately?", isAi: true },
  { sender: "Caller (Newark)", text: "You can reach me at 510-555-0811.", isAi: false },
  { sender: "AI Operator", text: "Perfect, David. I've logged this. An emergency plumber from our network will unlock this lead and call you back in a few minutes.", isAi: true },
  { sender: "System", text: "Call successfully completed. Structuring lead parameters...", isAi: false }
];

function runAiSimulation() {
  if (isAiSimulating) return;
  isAiSimulating = true;

  const chatBody = document.getElementById("ai-chat-body");
  const statusLabel = document.getElementById("ai-status-label");
  const typingIndicator = document.getElementById("ai-typing-indicator");

  chatBody.innerHTML = "";
  statusLabel.textContent = "Connecting inbound call...";
  typingIndicator.style.display = "none";

  let currentStep = 0;

  function nextStep() {
    if (!isAiSimulating) return;

    if (currentStep >= aiDialogScript.length) {
      statusLabel.textContent = "Syncing with contractor feed...";
      
      // Dispatch parameters to backend API to post the new lead
      const newLead = {
        niche: "plumbing",
        title: "Emergency Gas Water Heater Leak",
        city: "Newark, CA",
        description: "Emergency gas water heater tank is leaking. Basement floor has water pooling. Customer needs a plumber out immediately.",
        price: 30.00,
        customerName: "David Vance",
        customerPhone: "(510) 555-0811"
      };

      setTimeout(() => {
        fetch('/api/leads/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newLead)
        })
        .then(res => res.json())
        .then(() => {
          isAiSimulating = false;
          
          // Close sheet
          document.getElementById("ai-chat-overlay").click();
          // Reload leads
          fetchLeads();
          triggerDynamicIslandNotification("🤖 New AI Lead: Water Heater Leak Newark");
          triggerSmsNotification("New Available Lead: Emergency Gas Water Heater Leak in Newark, CA.");
        });
      }, 2000);
      return;
    }

    const msg = aiDialogScript[currentStep];
    statusLabel.textContent = msg.isAi ? "🤖 AI Operator typing..." : "📞 Customer speaking...";

    if (msg.isAi) {
      typingIndicator.style.display = "flex";
      setTimeout(() => {
        typingIndicator.style.display = "none";
        appendChatBubble(msg.sender, msg.text, true);
        currentStep++;
        setTimeout(nextStep, 1000);
      }, 1800);
    } else {
      setTimeout(() => {
        appendChatBubble(msg.sender, msg.text, false);
        currentStep++;
        setTimeout(nextStep, 800);
      }, 1200);
    }
  }

  // Start the simulation flow
  setTimeout(nextStep, 1500);
}

function appendChatBubble(sender, text, isAi) {
  const chatBody = document.getElementById("ai-chat-body");
  
  const senderEl = document.createElement("div");
  senderEl.className = `chat-sender ${isAi ? 'sender-right' : 'sender-left'}`;
  senderEl.textContent = sender;

  const bubbleEl = document.createElement("div");
  bubbleEl.className = `chat-bubble ${isAi ? 'bubble-right' : 'bubble-left'}`;
  bubbleEl.textContent = text;

  chatBody.appendChild(senderEl);
  chatBody.appendChild(bubbleEl);
  
  // Auto scroll
  chatBody.scrollTop = chatBody.scrollHeight;
}

// ==========================================================================
// 📞 OUTBOUND PHONE CALL SIMULATOR (Phase 2 Upgrade - Feature 2)
// ==========================================================================
let activeCallInterval = null;
let callDurationSeconds = 0;
let callSynthInterval = null;
let audioCtx = null;

// Dialogue scripts for customers explaining their problem
const customerRecordings = {
  plumbing: [
    "Hello? Yes! Hi! Thank goodness you called back so fast.",
    "My gas water heater in Newark is leaking water from the tank bottom. It's a steady flow.",
    "The basement floor is already covered in water, and it's getting near the electrical washer.",
    "I shut off the water valve, but it's still leaking. I need an expert repiping or replacement plumber out here immediately!",
    "Can you verify when someone can arrive? Thanks."
  ],
  roofing: [
    "Hello? Yes, this is Sarah with Vegas Logistics.",
    "Our main warehouse flat roof has a major leak over the shipping bay.",
    "It's pouring rain and water is getting onto our electronics and packaging equipment.",
    "I need a commercial roofer to apply patches and reflective coating right away before we lose inventory.",
    "How quickly can you dispatch a crew here? Please let me know."
  ]
};

window.simulateCall = function(customerName, customerPhone, niche) {
  // Grab dialer overlay DOM items
  const overlay = document.getElementById("call-dialer-overlay");
  const sheet = document.getElementById("call-dialer-sheet");
  const endBtn = document.getElementById("end-call-btn");
  const nameEl = document.getElementById("dialer-customer-name");
  const statusEl = document.getElementById("dialer-call-status");
  const transcriptEl = document.getElementById("dialer-transcript");

  // Configure dialer header details
  nameEl.textContent = customerName;
  statusEl.textContent = "Calling...";
  statusEl.style.color = "var(--success)";
  transcriptEl.textContent = "[Ringing...]";
  transcriptEl.style.color = "var(--text-secondary)";

  // Open Dialer Screen
  overlay.classList.add("active");
  sheet.style.bottom = "0px";

  // Synthesize Call Ringing sounds using Web Audio API
  playRingbackTone();

  // Setup Outgoing call state flow
  let ringCount = 0;
  
  const callFlowTimeout = setTimeout(() => {
    // Stop ringing beep
    stopRingbackTone();

    // Call connected!
    statusEl.textContent = "00:00";
    statusEl.style.color = "var(--text-primary)";
    
    // Start duration timer
    callDurationSeconds = 0;
    activeCallInterval = setInterval(() => {
      callDurationSeconds++;
      let mins = Math.floor(callDurationSeconds / 60);
      let secs = callDurationSeconds % 60;
      mins = mins < 10 ? "0" + mins : mins;
      secs = secs < 10 ? "0" + secs : secs;
      statusEl.textContent = `${mins}:${secs}`;
    }, 1000);

    // Play recording dialogues
    const script = customerRecordings[niche] || customerRecordings["plumbing"];
    let dialogIndex = 0;

    transcriptEl.textContent = "";

    const playNextDialogue = () => {
      if (dialogIndex >= script.length) {
        transcriptEl.innerHTML += "<div style='color:var(--text-muted); font-weight:600; margin-top:10px; text-align:center;'>[Customer hung up]</div>";
        clearInterval(activeCallInterval);
        statusEl.textContent = "Call Ended";
        statusEl.style.color = "var(--error)";
        
        // Log Call History on server
        logCallHistory(customerName, customerPhone, statusEl.textContent, transcriptEl.innerHTML, niche);
        return;
      }

      const text = script[dialogIndex];
      
      // Gray out old dialogue lines
      const activeLine = transcriptEl.querySelector(".active-transcript-line");
      if (activeLine) {
        activeLine.classList.remove("active-transcript-line");
        activeLine.style.color = "var(--text-muted)";
        activeLine.style.fontWeight = "400";
      }
      
      // Append new line with speaker tags
      const lineEl = document.createElement("div");
      lineEl.className = "active-transcript-line";
      lineEl.style.color = "var(--success)";
      lineEl.style.fontWeight = "600";
      lineEl.style.marginBottom = "10px";
      lineEl.style.transition = "color 0.4s";
      
      // Get current duration timer digits
      const timeStamp = statusEl.textContent;
      lineEl.innerHTML = `<span style='opacity:0.6; font-size:10px;'>(${timeStamp})</span> <span style='font-size:11px; text-transform:uppercase; letter-spacing:0.5px;'>Customer:</span> "${text}"`;
      
      transcriptEl.appendChild(lineEl);
      
      // Auto scroll
      const container = document.getElementById("dialer-transcript-container");
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
      
      dialogIndex++;

      // Trigger next line in 4.5 seconds
      callSynthInterval = setTimeout(playNextDialogue, 4500);
    };

    playNextDialogue();

  }, 3500); // 3.5s ringing simulation

  // End Call Button click handler function
  const endCallHandler = () => {
    // Clear all pending audio/time intervals
    clearTimeout(callFlowTimeout);
    clearTimeout(callSynthInterval);
    clearInterval(activeCallInterval);
    stopRingbackTone();

    // Log call if duration was active
    if (statusEl.textContent !== "Calling..." && statusEl.textContent !== "Disconnected" && statusEl.textContent !== "Call Ended") {
      logCallHistory(customerName, customerPhone, statusEl.textContent, transcriptEl.innerHTML, niche);
    }

    // Reset details and close overlay sheets
    statusEl.textContent = "Disconnected";
    statusEl.style.color = "var(--error)";
    
    setTimeout(() => {
      overlay.classList.remove("active");
      sheet.style.bottom = "-100%";
    }, 600);

    endBtn.removeEventListener("click", endCallHandler);
  };

  endBtn.addEventListener("click", endCallHandler);
};

function playRingbackTone() {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }

    const beep = () => {
      if (!audioCtx || audioCtx.state === 'closed') return;
      
      const osc1 = audioCtx.createOscillator();
      const osc2 = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      osc1.frequency.value = 440;
      osc2.frequency.value = 480;

      osc1.connect(gainNode);
      osc2.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.08, audioCtx.currentTime + 0.1);
      gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime + 1.8);
      gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 2.0);

      osc1.start();
      osc2.start();

      setTimeout(() => {
        try {
          osc1.stop();
          osc2.stop();
        } catch(err){}
      }, 2100);
    };

    beep();
    callDurationSeconds = 0; // reuse for beep interval counting
    activeCallInterval = setInterval(beep, 4000);
  } catch (e) {
    console.log("AudioContext failed to load or requires user gesture first.");
  }
}

function stopRingbackTone() {
  if (activeCallInterval) {
    clearInterval(activeCallInterval);
    activeCallInterval = null;
  }
}

// LOG CALL TO BACKEND
function logCallHistory(customerName, customerPhone, duration, transcript, niche) {
  fetch('/api/calls/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customerName, customerPhone, duration, transcript, niche })
  })
  .then(res => res.json())
  .then(() => {
    fetchCallLogs();
  });
}

// ==========================================================================
// 📈 PLATFORM PERFORMANCE ANALYTICS (Phase 2 Upgrade - Feature 3)
// ==========================================================================
function updateAnalyticsUI() {
  const revEl = document.getElementById("analytics-revenue");
  const spendEl = document.getElementById("analytics-spend");
  const roiEl = document.getElementById("analytics-roi");
  const countEl = document.getElementById("analytics-unlocked-count");
  const sunBar = document.getElementById("bar-sun");
  const sunVal = document.getElementById("bar-sun-value");

  if (!revEl || !spendEl || !roiEl) return;

  const totalLeads = leads.length;
  const unlockedLeads = leads.filter(l => l.unlocked);
  const unlockedCount = unlockedLeads.length;
  
  // Spend = Sum of unlocked lead prices
  const totalSpend = unlockedLeads.reduce((sum, l) => sum + l.price, 0);
  // Revenue = Sum of completed job values
  const totalRevenue = leads.reduce((sum, l) => sum + (l.jobRevenue || 0), 0);
  // ROI Calculation
  const netRoi = totalSpend === 0 ? 0 : Math.round(((totalRevenue - totalSpend) / totalSpend) * 100);

  // Update text values
  spendEl.textContent = `$${totalSpend.toFixed(2)}`;
  revEl.textContent = `$${totalRevenue.toFixed(2)}`;
  
  roiEl.textContent = `${netRoi}%`;
  if (netRoi > 0) {
    roiEl.style.color = "var(--success)";
  } else if (netRoi < 0) {
    roiEl.style.color = "var(--error)";
  } else {
    roiEl.style.color = "var(--text-secondary)";
  }

  if (countEl) {
    countEl.textContent = `${unlockedCount} / ${totalLeads}`;
  }

  // Update Sunday bar height dynamically (Capped at 100% height relative to $150 week target)
  const targetRevenue = 150;
  const heightPercent = Math.min((totalRevenue / targetRevenue) * 100, 100);
  
  if (sunBar && sunVal) {
    // Capped at 4% min to keep Sunday bar visible on baseline
    sunBar.style.height = `${heightPercent === 0 ? 4 : heightPercent}%`;
    sunVal.textContent = `$${totalRevenue.toFixed(0)}`;
  }
}

// ==========================================================================
// 🗺️ RADAR MAP VIEW GENERATOR & CONTROLLER (Phase 2 Upgrade - Feature 4)
// ==========================================================================
function renderMapMarkers() {
  const markersGroup = document.getElementById("map-markers-group");
  const popupCard = document.getElementById("map-popup-card");
  
  if (!markersGroup) return;
  markersGroup.innerHTML = "";
  
  // Filter available leads by current filters
  const availableLeads = leads.filter(lead => {
    if (lead.unlocked) return false;
    const matchesCity = activeCitiesFilter.some(c => lead.city && lead.city.toLowerCase().includes(c.toLowerCase()));
    const matchesNiche = currentNicheFilter === "all" || lead.niche === currentNicheFilter;
    const matchesSearch = lead.title.toLowerCase().includes(currentSearchQuery) || 
                          lead.city.toLowerCase().includes(currentSearchQuery) ||
                          lead.description.toLowerCase().includes(currentSearchQuery);
    return matchesNiche && matchesSearch && matchesCity;
  });
  
  // Coordinates index for cities (with slight random offset to prevent overlap)
  const getCityCoords = (city, index) => {
    const offset = (index * 8) % 15 - 7; // jitter
    const cityName = city.toLowerCase();
    
    if (cityName.includes("las vegas") || cityName.includes("nv")) {
      return { x: 210 + offset, y: 220 + (offset / 2) };
    } else if (cityName.includes("newark")) {
      return { x: 75 + offset, y: 110 + (offset / 2) };
    } else {
      // default San Rafael
      return { x: 130 + offset, y: 170 + (offset / 2) };
    }
  };

  availableLeads.forEach((lead, i) => {
    const coords = getCityCoords(lead.city, i);
    
    // Create map marker dot group elements
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("class", "map-marker");
    g.setAttribute("transform", `translate(${coords.x}, ${coords.y})`);
    
    // Pulse animation ring (outer)
    const pulse = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    pulse.setAttribute("class", "map-pulse-circle");
    pulse.setAttribute("cx", "0");
    pulse.setAttribute("cy", "0");
    pulse.setAttribute("r", "14");
    pulse.setAttribute("fill", lead.niche === 'plumbing' ? "rgba(16, 185, 129, 0.25)" : "rgba(99, 102, 241, 0.25)");
    
    // Inner solid dot
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("cx", "0");
    dot.setAttribute("cy", "0");
    dot.setAttribute("r", "6");
    dot.setAttribute("fill", lead.niche === 'plumbing' ? "var(--success)" : "var(--primary)");
    dot.setAttribute("stroke", "#fff");
    dot.setAttribute("stroke-width", "1.5");
    
    g.appendChild(pulse);
    g.appendChild(dot);
    markersGroup.appendChild(g);

    // Click event to show popup card details
    g.addEventListener("click", (e) => {
      e.stopPropagation(); // prevent background svg click
      
      const badge = document.getElementById("popup-badge");
      const price = document.getElementById("popup-price");
      const title = document.getElementById("popup-title");
      const loc = document.getElementById("popup-location");
      const unlockBtn = document.getElementById("popup-unlock-btn");

      badge.textContent = lead.niche === 'plumbing' ? 'Plumbing' : 'Roofing';
      badge.className = `lead-badge badge-${lead.niche}`;
      price.textContent = `$${lead.price.toFixed(2)}`;
      title.textContent = lead.title;
      loc.textContent = lead.city;

      // Clear previous click handler
      const newUnlockBtn = unlockBtn.cloneNode(true);
      unlockBtn.parentNode.replaceChild(newUnlockBtn, unlockBtn);

      // Configure unlock button
      newUnlockBtn.addEventListener("click", () => {
        window.unlockLead(lead.id);
        popupCard.style.display = "none";
      });

      popupCard.style.display = "block";
    });
  });

  // Close popup if clicking on map background
  const mapSvg = document.getElementById("radar-map-svg");
  if (mapSvg) {
    mapSvg.addEventListener("click", () => {
      if (popupCard) popupCard.style.display = "none";
    });
  }
}

// ==========================================================================
// 💬 iOS STYLE SMS NOTIFICATION SYSTEM (Phase 2 Upgrade - Feature 5)
// ==========================================================================
let smsTimeout = null;

function triggerSmsNotification(text) {
  const banner = document.getElementById("sms-notification");
  const smsText = document.getElementById("sms-text");

  if (!banner || !smsText) return;

  // Clear previous timer if any
  if (smsTimeout) {
    clearTimeout(smsTimeout);
  }

  // Set message text
  smsText.textContent = text;

  // Position banner down (12px)
  banner.style.transform = "translateY(0)";

  // Synthesize pleasant double-chime iOS SMS sound
  playSmsSound();

  // Navigation click event (Go to marketplace screen, switch to list view)
  const clickHandler = () => {
    // Switch to Marketplace screen
    document.getElementById("nav-marketplace").click();
    
    // Switch to List view
    const listBtn = document.getElementById("view-list-btn");
    if (listBtn) listBtn.click();
    
    // Slide banner up
    banner.style.transform = "translateY(-150%)";
    banner.removeEventListener("click", clickHandler);
  };

  banner.addEventListener("click", clickHandler);

  // Auto-dismiss after 6 seconds
  smsTimeout = setTimeout(() => {
    banner.style.transform = "translateY(-150%)";
    banner.removeEventListener("click", clickHandler);
  }, 6000);
}

// SYNTHESIZE DOUBLE CHIME (iOS text sound)
function playSmsSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    
    const playChime = (freq, time, duration) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = "sine";
      osc.frequency.value = freq;
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      gain.gain.setValueAtTime(0, ctx.currentTime + time);
      gain.gain.linearRampToValueAtTime(0.12, ctx.currentTime + time + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + time + duration);
      
      osc.start(ctx.currentTime + time);
      osc.stop(ctx.currentTime + time + duration);
    };

    // Tone 1: 830Hz (high), Tone 2: 1040Hz (higher)
    playChime(830, 0, 0.15);
    playChime(1040, 0.09, 0.22);
  } catch(e) {
    console.log("AudioContext blocked or failed.");
  }
}

// ==========================================================================
// 📜 WALLET TRANSACTION HISTORY (Phase 2 Upgrade - Feature 7)
// ==========================================================================
function renderTransactions() {
  const container = document.getElementById("transaction-history-list");
  if (!container) return;
  
  container.innerHTML = "";
  
  if (transactions.length === 0) {
    container.innerHTML = `<div style="text-align:center; padding: 20px; font-size:11px; color:var(--text-muted);">No recent transactions.</div>`;
    return;
  }
  
  transactions.forEach(tx => {
    const item = document.createElement("div");
    item.style.display = "flex";
    item.style.justifyContent = "space-between";
    item.style.alignItems = "center";
    item.style.padding = "10px 12px";
    item.style.background = "rgba(255,255,255,0.02)";
    item.style.border = "1px solid var(--border-card)";
    item.style.borderRadius = "12px";
    
    // Receipt invoice downloader integration (Phase 4 Upgrade)
    const receiptLink = `<a href="javascript:void(0)" onclick="downloadInvoice('${tx.title.replace(/'/g, "\\'")}', ${tx.amount}, '${tx.date}', '${tx.type}')" style="font-size: 9px; color: var(--primary); text-decoration: underline; margin-top: 2px; display: inline-block;">Receipt 📄</a>`;
    
    const leftCol = `
      <div>
        <div style="font-size: 12px; font-weight: 700; color: var(--text-primary); margin-bottom: 2px;">${tx.title}</div>
        <div style="font-size: 9px; color: var(--text-muted);">${tx.date}</div>
        ${receiptLink}
      </div>
    `;
    
    const isDeposit = tx.type === "deposit";
    const rightCol = `
      <div style="font-size: 13px; font-weight: 800; color: ${isDeposit ? 'var(--success)' : 'var(--error)'}; font-family: var(--font-display);">
        ${isDeposit ? '+' : '-'}$${tx.amount.toFixed(2)}
      </div>
    `;
    
    item.innerHTML = leftCol + rightCol;
    container.appendChild(item);
  });
}

// ==========================================================================
// 👤 CONTRACTOR PROFILE UI CONTROLLER (Phase 2 Upgrade - Feature 8)
// ==========================================================================
function updateProfileUI() {
  const leadsCountEl = document.getElementById("profile-leads-unlocked");
  const spentEl = document.getElementById("profile-total-spent");

  if (!leadsCountEl || !spentEl) return;

  const unlockedLeads = leads.filter(l => l.unlocked);
  const count = unlockedLeads.length;
  const totalSpent = unlockedLeads.reduce((sum, l) => sum + l.price, 0);

  leadsCountEl.textContent = count;
  spentEl.textContent = `$${totalSpent.toFixed(2)}`;
}

// ==========================================================================
// 📞 OUTBOUND VOICE CALLS LOGGER (Phase 4 Upgrade)
// ==========================================================================
function renderCallLogs() {
  const container = document.getElementById("profile-calls-container");
  if (!container) return;

  container.innerHTML = "";

  if (callLogs.length === 0) {
    container.innerHTML = `<div style="text-align:center; padding: 20px; font-size:11px; color:var(--text-muted);">No outgoing call logs recorded yet.</div>`;
    return;
  }

  callLogs.forEach(log => {
    const card = document.createElement("div");
    card.className = "lead-card";
    card.style.margin = "0";
    card.style.padding = "10px 12px";
    card.style.border = "1px solid var(--border-card)";
    card.style.background = "rgba(255,255,255,0.01)";
    
    card.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
        <span style="font-size: 11px; font-weight: 700; color: var(--text-primary);">${log.customerName}</span>
        <span class="lead-badge badge-${log.niche}" style="font-size: 8px; padding: 1px 6px;">${log.niche === 'plumbing' ? 'Plumbing' : 'Roofing'}</span>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center; font-size: 9px; color: var(--text-muted);">
        <span>${log.timestamp}</span>
        <span>Duration: <strong style="color:#fff;">${log.duration}</strong></span>
      </div>
      
      <details style="margin-top: 8px; border-top: 1px solid rgba(255,255,255,0.03); padding-top: 6px;">
        <summary style="font-size: 9px; color: var(--primary); cursor: pointer; user-select: none;">Show Call Transcript</summary>
        <div style="font-size: 11px; color: var(--text-secondary); max-height: 120px; overflow-y: auto; padding: 8px; background: rgba(0,0,0,0.15); border-radius: 8px; margin-top: 5px;">
          ${log.transcript}
        </div>
      </details>
    `;
    container.appendChild(card);
  });
}

// ==========================================================================
// 🛡️ LEAD DISPUTES LEDGER CONTROLLER (Phase 4 Upgrade)
// ==========================================================================
function renderDisputes() {
  const card = document.getElementById("admin-disputes-card");
  const container = document.getElementById("admin-disputes-list");

  if (!card || !container) return;

  if (disputes.length === 0) {
    card.style.display = "none";
    return;
  }

  card.style.display = "block";
  container.innerHTML = "";

  disputes.forEach(d => {
    const item = document.createElement("div");
    item.className = "lead-card";
    item.style.margin = "0";
    item.style.padding = "10px 12px";
    item.style.background = "rgba(0,0,0,0.1)";
    
    let badgeColor = "#94a3b8";
    if (d.status === "approved") badgeColor = "var(--success)";
    if (d.status === "rejected") badgeColor = "var(--error)";

    let actionsHTML = "";
    if (d.status === "pending") {
      actionsHTML = `
        <div style="display: flex; gap: 8px; margin-top: 8px; justify-content: flex-end;">
          <button class="btn btn-secondary" onclick="resolveDispute('${d.id}', 'reject')" style="font-size: 8px; padding: 2px 8px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.08);">Reject</button>
          <button class="btn btn-primary" onclick="resolveDispute('${d.id}', 'approve')" style="font-size: 8px; padding: 2px 8px; border-radius: 6px; background: var(--success);">Approve Refund</button>
        </div>
      `;
    }

    item.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
        <span style="font-size: 11px; font-weight: 700; color:#fff;">${d.title}</span>
        <span style="font-size: 8px; font-weight: 800; text-transform: uppercase; color: ${badgeColor}; padding: 2px 6px; border-radius: 6px; background: rgba(255,255,255,0.02);">${d.status}</span>
      </div>
      <div style="font-size: 10px; color: var(--text-secondary); line-height:1.4; margin-bottom: 4px;">
        Reason: "${d.reason}"
      </div>
      <div style="font-size: 8px; color: var(--text-muted);">
        Disputed at: ${d.timestamp} | Amount: $${d.price.toFixed(2)}
      </div>
      ${actionsHTML}
    `;
    container.appendChild(item);
  });
}

// CLIENT-SIDE LEAD ACTION BINDINGS
window.updateLeadStatus = function(id, status) {
  fetch('/api/leads/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, status })
  })
  .then(res => res.json())
  .then(() => {
    fetchLeads();
    triggerDynamicIslandNotification(`Lead status updated to ${status}`);
  });
};

window.updateJobRevenue = function(id, jobRevenue) {
  fetch('/api/leads/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, status: "completed", jobRevenue })
  })
  .then(res => res.json())
  .then(() => {
    fetchLeads();
    triggerDynamicIslandNotification("Job revenue logged!");
  });
};

window.disputeLead = function(id) {
  const reason = prompt("Describe your dispute details (e.g. Inaccurate details / Dead Phone number):");
  if (!reason || reason.trim() === "") return;

  fetch('/api/leads/dispute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, reason })
  })
  .then(res => res.json())
  .then(() => {
    fetchLeads();
    fetchDisputes();
    triggerDynamicIslandNotification("Dispute submitted successfully!");
  });
};

window.resolveDispute = function(disputeId, action) {
  const confirmResolve = confirm(`Are you sure you want to ${action} this lead dispute?`);
  if (!confirmResolve) return;

  fetch('/api/leads/dispute/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ disputeId, action })
  })
  .then(res => res.json())
  .then(() => {
    fetchDisputes();
    fetchLeads();
    fetchProfile();
    fetchTransactions();
    triggerDynamicIslandNotification(`Dispute ${action}d!`);
  });
};

// DYNAMIC INVOICE / RECEIPT FILE GENERATOR
window.downloadInvoice = function(title, amount, date, type) {
  const invoiceId = "INV-" + Date.now().toString().slice(-6);
  const isDeposit = type === "deposit";
  
  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>RealEasy Invoice ${invoiceId}</title>
  <style>
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background: #070a14; color: #f8fafc; padding: 40px; margin: 0; }
    .card { max-width: 600px; margin: auto; background: #0f172a; padding: 30px; border-radius: 20px; border: 1px solid #1e293b; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
    .header { display: flex; justify-content: space-between; border-bottom: 2px solid #334155; padding-bottom: 20px; margin-bottom: 25px; }
    .logo { font-size: 20px; font-weight: 800; color: #6366f1; letter-spacing: 0.5px; }
    .title { font-size: 13px; text-transform: uppercase; color: #94a3b8; letter-spacing: 1px; }
    .meta-row { display: flex; justify-content: space-between; font-size: 13px; color: #cbd5e1; margin-bottom: 12px; }
    .meta-label { color: #64748b; font-weight: 600; }
    .meta-value { font-weight: bold; }
    .total-card { margin-top: 30px; background: rgba(99, 102, 241, 0.08); border: 1px dashed #6366f1; padding: 15px 20px; border-radius: 12px; display: flex; justify-content: space-between; align-items: center; }
    .total-val { font-size: 22px; font-weight: 800; color: #818cf8; }
    .footer { text-align: center; font-size: 10px; color: #475569; margin-top: 40px; border-top: 1px solid #1e293b; padding-top: 20px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div>
        <div class="logo">RealEasy Leads</div>
        <div style="font-size: 11px; color: #64748b; margin-top: 4px;">Contractor Leads Marketplace Portal</div>
      </div>
      <div style="text-align: right;">
        <div class="title">Official Transaction Receipt</div>
        <div style="font-size: 12px; color: #475569; font-weight: bold; margin-top: 4px;">${invoiceId}</div>
      </div>
    </div>
    
    <div class="meta-row">
      <span class="meta-label">Billed To:</span>
      <span class="meta-value">Apex Plumbing & Rooter</span>
    </div>
    <div class="meta-row">
      <span class="meta-label">CSLB License:</span>
      <span class="meta-value">#1094851</span>
    </div>
    <div class="meta-row">
      <span class="meta-label">Transaction Date:</span>
      <span class="meta-value">${date}</span>
    </div>
    <div class="meta-row">
      <span class="meta-label">Description:</span>
      <span class="meta-value">${title}</span>
    </div>
    <div class="meta-row">
      <span class="meta-label">Payment Gateway:</span>
      <span class="meta-value">${isDeposit ? 'Stripe Elements Network' : 'Internal Ledger Deduction'}</span>
    </div>
    <div class="meta-row">
      <span class="meta-label">Status:</span>
      <span class="meta-value" style="color: #10b981;">✓ Settled</span>
    </div>

    <div class="total-card">
      <span style="font-weight: bold; font-size: 14px;">Total Paid (USD):</span>
      <span class="total-val">$${amount.toFixed(2)}</span>
    </div>

    <div class="footer">
      This is a system generated transaction receipt issued securely on behalf of RealEasy Leads Platform.
      <br>For payment audits or disputes, contact support@whatsrealeasy.com
    </div>
  </div>
</body>
</html>
  `;
  
  // Trigger file download
  const dataUri = 'data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent);
  const a = document.createElement('a');
  a.href = dataUri;
  a.download = `Receipt_${invoiceId}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  
  triggerDynamicIslandNotification("📄 Receipt Downloaded!");
};

// ==========================================================================
// 🤖 AI CALL SIMULATOR CONTROLLER (Inbound Lead Dispatcher trigger)
// ==========================================================================
function setupAiCallSimulator() {
  const triggerBtn = document.getElementById("simulate-ai-call-btn");
  const overlay = document.getElementById("ai-chat-overlay");
  const closeBtn = document.getElementById("ai-chat-close-btn");
  
  if (triggerBtn) {
    triggerBtn.addEventListener("click", () => {
      // Open AI Chat Simulation Modal Sheet
      overlay.classList.add("active");
      document.getElementById("ai-chat-sheet").style.bottom = "0px";
      
      // Start Sim
      runAiSimulation();
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      overlay.classList.remove("active");
      document.getElementById("ai-chat-sheet").style.bottom = "-100%";
      isAiSimulating = false;
    });
  }

  if (overlay) {
    overlay.addEventListener("click", () => {
      overlay.classList.remove("active");
      document.getElementById("ai-chat-sheet").style.bottom = "-100%";
      isAiSimulating = false;
    });
  }
}

// ==========================================================================
// 🛡️ COMPLIANCE AUDITING WORKFLOW SYSTEMS (Alternative Verification)
// ==========================================================================
function attachVerifySubmitListener() {
  const submitBtn = document.getElementById("profile-verify-submit-btn");
  if (!submitBtn) return;
  
  submitBtn.addEventListener("click", () => {
    const idFileInput = document.getElementById("verify-id-file");
    const licFileInput = document.getElementById("verify-license-file");
    
    if (!idFileInput || !licFileInput || !idFileInput.files[0] || !licFileInput.files[0]) {
      alert("Please select both a Government Photo ID and a CSLB Pocket Card Copy before submitting.");
      return;
    }
    
    submitBtn.textContent = "⚡ Uploading Credentials...";
    submitBtn.disabled = true;
    
    triggerDynamicIslandNotification("⏳ Uploading audit documents...");
    
    const readAsDataURL = (file) => new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.readAsDataURL(file);
    });
    
    Promise.all([
      readAsDataURL(idFileInput.files[0]),
      readAsDataURL(licFileInput.files[0])
    ]).then(([idDoc, licenseDoc]) => {
      fetch('/api/profile/verify/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idDoc, licenseDoc })
      })
      .then(res => res.json())
      .then(() => {
        fetchProfile();
        triggerDynamicIslandNotification("🛡️ Submitted for Review!");
        playSmsSound();
      })
      .catch(err => {
        console.warn("Documents API submission failed. Falling back to local storage cache:", err);
        
        let cached = JSON.parse(safeStorage.getItem("re_profile") || "{}");
        cached.verificationStatus = "pending";
        cached.verificationIdDoc = idDoc;
        cached.verificationLicenseDoc = licenseDoc;
        cached.verificationRejectionReason = "";
        safeStorage.setItem("re_profile", JSON.stringify(cached));
        
        applyProfileData(cached);
        triggerDynamicIslandNotification("🛡️ Submitted for Review locally!");
        playSmsSound();
      });
    });
  });
}

function renderAdminVerificationLedger(profile) {
  const card = document.getElementById("admin-verify-card");
  const container = document.getElementById("admin-verify-list");
  
  if (!card || !container) return;
  
  if (profile.verificationStatus !== "pending") {
    card.style.display = "none";
    return;
  }
  
  card.style.display = "block";
  container.innerHTML = `
    <div class="lead-card" style="margin: 0; padding: 12px; background: rgba(0,0,0,0.1); border: 1px solid var(--border-card);">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px;">
        <span style="font-size:12px; font-weight:800; color:#fff;">${profile.name}</span>
        <span style="font-size:8px; font-weight:800; color:#f59e0b; background:rgba(245,158,11,0.05); padding:2px 6px; border-radius:6px; border:1px solid rgba(245,158,11,0.15);">PENDING AUDIT</span>
      </div>
      <div style="font-size:10px; color:var(--text-secondary); line-height:1.4; margin-bottom: 8px;">
        CSLB License: <strong>${profile.license}</strong>
      </div>
      
      <!-- Document Previews -->
      <div style="display:flex; gap:8px; margin-bottom: 12px;">
        <button class="btn btn-secondary" onclick="viewAuditDocument('ID Document', '${profile.verificationIdDoc.replace(/'/g, "\\'")}')" style="flex:1; font-size:8px; padding:4px 0;">View Government ID</button>
        <button class="btn btn-secondary" onclick="viewAuditDocument('CSLB Pocket Card', '${profile.verificationLicenseDoc.replace(/'/g, "\\'")}')" style="flex:1; font-size:8px; padding:4px 0;">View CSLB Card</button>
      </div>
      
      <!-- Action Review Buttons -->
      <div style="display:flex; gap:8px; justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="resolveComplianceVerify('reject', '${profile.id}')" style="font-size:8px; padding:2px 8px; color:#f87171; border-color:rgba(239,68,68,0.25);">Reject Audit</button>
        <button class="btn btn-primary" onclick="resolveComplianceVerify('approve', '${profile.id}')" style="font-size:8px; padding:2px 8px; background:var(--success);">Approve Verify</button>
      </div>
    </div>
  `;
}

window.viewAuditDocument = function(title, base64) {
  const win = window.open();
  if (win) {
    win.document.write(`
      <html>
        <head>
          <title>${title}</title>
          <style>
            body { background: #070a14; color: #fff; text-align: center; font-family: sans-serif; padding: 40px 20px; }
            img { max-width: 90%; max-height: 80vh; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); border: 2px solid #1e293b; }
            h2 { color: #818cf8; margin-bottom: 20px; }
          </style>
        </head>
        <body>
          <h2>RealEasy Compliance Audit Preview - ${title}</h2>
          <img src="${base64}">
        </body>
      </html>
    `);
  } else {
    alert("Popup blocked! Please allow popups to view document images.");
  }
};

window.resolveComplianceVerify = function(action, contractorId) {
  let reason = "";
  if (action === "reject") {
    reason = prompt("Provide audit rejection reason:");
    if (reason === null) return;
  }
  
  const confirmAction = confirm(`Are you sure you want to ${action} this compliance verification?`);
  if (!confirmAction) return;
  
  fetch('/api/profile/verify/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, reason, contractorId })
  })
  .then(res => res.json())
  .then(() => {
    // If we are admin, we don't reload profile of admin, we reload all data
    initApp();
    triggerDynamicIslandNotification(`Compliance audit ${action}d!`);
  })
  .catch(err => {
    console.warn("Compliance resolve API failed. Falling back to local storage:", err);
    let cached = JSON.parse(safeStorage.getItem("re_profile") || "{}");
    if (action === "approve") {
      cached.verified = true;
      cached.verificationStatus = "verified";
      cached.verificationRejectionReason = "";
    } else {
      cached.verified = false;
      cached.verificationStatus = "rejected";
      cached.verificationRejectionReason = reason || "Documents are blurred or invalid.";
    }
    safeStorage.setItem("re_profile", JSON.stringify(cached));
    
    applyProfileData(cached);
    triggerDynamicIslandNotification(`Compliance audit ${action}d locally!`);
  });
};

// ==========================================================================
// 🏠 HOMEOWNER SERVICE TICKETS SYSTEM
// ==========================================================================
function setupHomeownerTickets() {
  const list = document.getElementById("homeowner-tickets-list");
  if (!list) return;

  if (leads.length === 0) {
    list.innerHTML = `
      <div style="text-align: center; padding: 30px 20px; color: var(--text-muted); font-size: 12px; line-height: 1.5; background: rgba(255,255,255,0.01); border: 1px dashed var(--border-card); border-radius: 18px;">
        No active requests found.<br>Use the form above to submit an emergency job.
      </div>
    `;
    return;
  }

  list.innerHTML = leads.map(t => {
    let badgeClass = "ticket-status-reviewing";
    let statusText = "Reviewing";
    if (t.status === "contacted") {
      badgeClass = "ticket-status-contacted";
      statusText = "Contractor Contacted";
    } else if (t.status === "booked") {
      badgeClass = "ticket-status-booked";
      statusText = "Job Booked";
    } else if (t.status === "completed") {
      badgeClass = "ticket-status-completed";
      statusText = "Completed";
    }
    return `
      <div class="lead-card" style="margin: 0; padding: 15px;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 8px;">
          <div>
            <span class="lead-badge" style="font-size: 9px; padding: 2px 6px;">${t.niche.toUpperCase()}</span>
            <h4 style="font-size: 13px; font-weight: 700; color: var(--text-primary); margin-top: 6px;">${t.title}</h4>
          </div>
          <span class="ticket-status-badge ${badgeClass}">${statusText}</span>
        </div>
        <p style="font-size: 11px; color: var(--text-secondary); line-height: 1.4; margin-bottom: 8px;">${t.description}</p>
        <div style="display:flex; justify-content:space-between; align-items:center; font-size: 10px; color: var(--text-muted);">
          <span>Location: <strong>${t.city}</strong></span>
          <span>Posted: <strong>${t.date || 'Just now'}</strong></span>
        </div>
      </div>
    `;
  }).join('');

  // Setup homeowner form submit listener (once)
  const form = document.getElementById("homeowner-request-form");
  if (form) {
    form.onsubmit = (e) => {
      e.preventDefault();
      const niche = document.getElementById("request-niche").value;
      const title = document.getElementById("request-title").value.trim();
      const city = document.getElementById("request-city").value;
      const description = document.getElementById("request-desc").value.trim();

      const submitBtn = document.getElementById("request-submit-btn");
      submitBtn.disabled = true;
      submitBtn.textContent = "⚡ Dispatching Professionals...";

      fetch('/api/leads/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ niche, title, city, description })
      })
      .then(res => {
        if (!res.ok) throw new Error("Failed to submit request");
        return res.json();
      })
      .then(() => {
        triggerDynamicIslandNotification("🚀 Service request dispatched!");
        form.reset();
        submitBtn.disabled = false;
        submitBtn.textContent = "🚀 Dispatch Local Contractors";
        // Reload leads
        fetchLeads().then(() => {
          setupHomeownerTickets();
        });
      })
      .catch(err => {
        console.error("Error creating ticket:", err);
        submitBtn.disabled = false;
        submitBtn.textContent = "🚀 Dispatch Local Contractors";
        alert("Failed to submit request. Please try again.");
      });
    };
  }
}

// FETCH REGISTERED CONTRACTORS FOR ADMIN CENTER
function fetchAdminContractors() {
  const container = document.getElementById("admin-contractors-list");
  if (!container) return Promise.resolve();

  return fetch('/api/admin/contractors')
    .then(res => res.json())
    .then(contractors => {
      if (contractors.length === 0) {
        container.innerHTML = `
          <div style="text-align: center; padding: 15px 0; color: var(--text-muted); font-size: 11px;">
            No contractors registered yet.
          </div>
        `;
        return;
      }
      container.innerHTML = contractors.map(c => {
        const badgeColor = c.verified ? "var(--success)" : "var(--text-muted)";
        const badgeBg = c.verified ? "rgba(16, 185, 129, 0.05)" : "rgba(255,255,255,0.03)";
        const badgeBorder = c.verified ? "rgba(16, 185, 129, 0.15)" : "rgba(255,255,255,0.08)";
        const statusText = c.verificationStatus ? c.verificationStatus.toUpperCase() : "UNVERIFIED";

        return `
          <div class="lead-card" style="margin: 0; padding: 12px; background: rgba(0,0,0,0.1); border: 1px solid var(--border-card); display: flex; flex-direction: column; gap: 6px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-size:12px; font-weight:800; color:#fff;">${c.name}</span>
              <span style="font-size:7px; font-weight:800; color:${badgeColor}; background:${badgeBg}; padding:2px 6px; border-radius:6px; border:1px solid ${badgeBorder};">${statusText}</span>
            </div>
            <div style="font-size:10px; color:var(--text-secondary); line-height: 1.4;">
              License: <strong>${c.license}</strong><br>
              Phone: <strong>${c.phone || 'N/A'}</strong><br>
              Email: <strong>${c.email}</strong>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; border-top: 1px solid rgba(255,255,255,0.03); padding-top: 6px; margin-top: 2px;">
              <span style="font-size: 9px; color: var(--text-muted);">Wallet Balance</span>
              <span style="font-size: 11px; font-weight: 800; color: var(--success);">$${c.walletBalance.toFixed(2)}</span>
            </div>
          </div>
        `;
      }).join('');
    })
    .catch(err => console.error("Error fetching contractors list:", err));
}
