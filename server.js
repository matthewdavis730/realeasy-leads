const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const PORT = process.env.PORT || 8000;
const DB_PATH = path.join(__dirname, 'db.json');

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// INITIAL DEFAULT SYSTEM USERS & ROLES
const defaultUsers = [
  {
    id: "usr-keith",
    email: "keith@whatsrealeasy.com",
    password: "admin",
    role: "admin",
    name: "Keith Thunds",
    phone: "(866) 921-8235"
  },
  {
    id: "usr-apex",
    email: "apex@example.com",
    password: "password",
    role: "contractor",
    name: "Apex Plumbing & Rooter",
    license: "CSLB #1094851",
    walletBalance: 650.00,
    activeCitiesFilter: ["newark", "las vegas"],
    smsAlerts: true,
    emailReports: true,
    description: "Apex Plumbing & Rooter has been providing premium commercial and residential drain cleaning, pipe replacements, and emergency plumbing services in the Bay Area and Las Vegas since 2012.",
    phone: "(510) 555-9000",
    verified: false,
    verificationStatus: "unverified",
    verificationIdDoc: "",
    verificationLicenseDoc: "",
    verificationRejectionReason: "",
    avatarImage: ""
  },
  {
    id: "usr-homeowner",
    email: "homeowner@example.com",
    password: "password",
    role: "homeowner",
    name: "David Vance",
    phone: "(510) 555-0811"
  }
];

const defaultLeads = [
  {
    id: "lead-1784498870112",
    customerId: "usr-homeowner",
    niche: "plumbing",
    title: "Emergency Gas Water Heater Leak",
    city: "Newark, CA",
    description: "Emergency gas water heater tank is leaking. Basement floor has water pooling. Customer needs a plumber out immediately.",
    price: 30.00,
    customerName: "David Vance",
    customerPhone: "(510) 555-0811",
    date: "Just now",
    status: "unlocked",
    jobRevenue: 0,
    disputed: false,
    disputeReason: ""
  },
  {
    id: "lead-1",
    customerId: "usr-homeowner",
    niche: "plumbing",
    title: "Whole Home PEX Repiping",
    city: "Newark, CA",
    description: "Aging copper pipes corroding, causing low water pressure and rust-colored water in a single-family home. Homeowner wants a full replacement with modern PEX piping.",
    price: 35.00,
    customerName: "James Miller",
    customerPhone: "(510) 555-0143",
    date: "10 mins ago",
    status: "unlocked",
    jobRevenue: 0,
    disputed: false,
    disputeReason: ""
  },
  {
    id: "lead-2",
    customerId: "usr-homeowner",
    niche: "roofing",
    title: "Commercial Flat Roof Patch & Seal",
    city: "Las Vegas, NV",
    description: "Active leaks detected over the main warehouse bay. Flat TPO roofing needs patching, sealing, and a reflective coating applied before the heat increases.",
    price: 45.00,
    customerName: "Sarah Jenkins (Vegas Logistics)",
    customerPhone: "(702) 608-4491",
    date: "2 hours ago",
    status: "unlocked",
    jobRevenue: 0,
    disputed: false,
    disputeReason: ""
  },
  {
    id: "lead-3",
    customerId: "usr-homeowner",
    niche: "plumbing",
    title: "Gas Water Heater Leak & Replacement",
    city: "Newark, CA",
    description: "50-gallon gas water heater is leaking from the bottom valve. Needs immediate replacement with a energy-efficient unit.",
    price: 25.00,
    customerName: "Robert Chen",
    customerPhone: "(510) 555-0988",
    date: "4 hours ago",
    status: "unlocked",
    jobRevenue: 0,
    disputed: false,
    disputeReason: ""
  },
  {
    id: "lead-4",
    customerId: "usr-homeowner",
    niche: "roofing",
    title: "Emergency Shingle Roof Repair",
    city: "San Rafael, CA (Bay Area)",
    description: "Wind damage caused shingles to blow off a residential roof. Water is starting to seep into the attic. Needs immediate tarping and shingle patch.",
    price: 30.00,
    customerName: "Michael Thompson",
    customerPhone: "(415) 521-8977",
    date: "1 day ago",
    status: "unlocked",
    jobRevenue: 0,
    disputed: false,
    disputeReason: ""
  }
];

const defaultUnlocks = [
  { leadId: "lead-1784498870112", contractorId: "usr-apex", unlockedAt: "2026-07-20T11:45:00Z" },
  { leadId: "lead-1", contractorId: "usr-apex", unlockedAt: "2026-07-20T11:46:00Z" },
  { leadId: "lead-2", contractorId: "usr-apex", unlockedAt: "2026-07-20T11:47:00Z" },
  { leadId: "lead-3", contractorId: "usr-apex", unlockedAt: "2026-07-20T11:48:00Z" },
  { leadId: "lead-4", contractorId: "usr-apex", unlockedAt: "2026-07-20T11:49:00Z" }
];

const defaultTransactions = [
  { userId: "usr-apex", type: "deposit", amount: 500.00, title: "Stripe Mock Deposit", date: "04:09 AM, Jul 20" },
  { userId: "usr-apex", type: "deposit", amount: 150.00, title: "Initial Platform Credit", date: "Joined Platform" }
];

// Helper to read database state with defensive migrations
function readDB() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      const db = {
        users: defaultUsers,
        leads: defaultLeads,
        unlocks: defaultUnlocks,
        transactions: defaultTransactions,
        disputes: [],
        callLogs: []
      };
      fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
      return db;
    }
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const db = JSON.parse(raw);
    
    // Perform migrations if database is older schema
    if (!db.users) {
      db.users = defaultUsers;
      if (db.profile) {
        // Migrate old contractor profile
        const apexIdx = db.users.findIndex(u => u.id === 'usr-apex');
        if (apexIdx !== -1) {
          db.users[apexIdx] = { ...db.users[apexIdx], ...db.profile };
        }
        delete db.profile;
      }
    }
    if (!db.unlocks) {
      db.unlocks = [];
      // If leads were marked unlocked in old schema, populate unlocks
      db.leads.forEach(l => {
        if (l.unlocked) {
          db.unlocks.push({ leadId: l.id, contractorId: 'usr-apex', unlockedAt: new Date().toISOString() });
        }
      });
    }
    if (!db.transactions) db.transactions = [];
    if (!db.disputes) db.disputes = [];
    if (!db.callLogs) db.callLogs = [];
    
    // Check that each transaction has a userId
    db.transactions.forEach(tx => {
      if (!tx.userId) tx.userId = 'usr-apex';
    });
    // Check that each dispute has a userId
    db.disputes.forEach(d => {
      if (!d.userId) d.userId = 'usr-apex';
    });
    // Check that each callLog has a userId
    db.callLogs.forEach(c => {
      if (!c.userId) c.userId = 'usr-apex';
    });

    return db;
  } catch (e) {
    console.error("Error reading database file, returning defaults:", e);
    return {
      users: defaultUsers,
      leads: defaultLeads,
      unlocks: defaultUnlocks,
      transactions: defaultTransactions,
      disputes: [],
      callLogs: []
    };
  }
}

// Helper to write database state
function writeDB(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("Error writing database file:", e);
  }
}

// Middleware or helper to get requesting user context
function getRequestUser(req, db) {
  const userId = req.headers['x-user-id'] || 'usr-apex';
  return db.users.find(u => u.id === userId) || db.users.find(u => u.role === 'contractor');
}

// ==========================================================================
// 🛡️ API ROUTES: SIGNUP & LOGIN Gateways
// ==========================================================================
app.post('/api/auth/signup', (req, res) => {
  const db = readDB();
  const { name, email, password, role, license, phone, city, niche } = req.body;

  if (!email || !password || !role || !name) {
    return res.status(400).json({ error: "Missing required registration parameters." });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const userExists = db.users.some(u => u.email === normalizedEmail);
  if (userExists) {
    return res.status(400).json({ error: "An account with this email address already exists." });
  }

  const newUser = {
    id: "usr-" + Date.now(),
    email: normalizedEmail,
    password,
    role,
    name,
    phone: phone || "",
    city: city || "",
    suspended: false
  };

  if (role === 'contractor') {
    newUser.license = license || "CSLB Pending";
    newUser.walletBalance = 150.00;
    newUser.activeCitiesFilter = city ? [city.toLowerCase()] : ["newark", "las vegas"];
    newUser.smsAlerts = true;
    newUser.emailReports = false;
    newUser.verified = false;
    newUser.verificationStatus = "unverified";
    newUser.verificationIdDoc = "";
    newUser.verificationLicenseDoc = "";
    newUser.verificationRejectionReason = "";
    newUser.avatarImage = "";
    newUser.description = `${name} is a professional contractor service specializing in ${niche || 'plumbing'}.`;

    // Log initial deposit
    db.transactions.unshift({
      userId: newUser.id,
      type: "deposit",
      amount: 150.00,
      title: "Initial Platform Credit",
      date: "Joined Platform"
    });
  }

  db.users.push(newUser);
  writeDB(db);

  // Strip password in response
  const { password: _, ...userWithoutPass } = newUser;
  res.json({ success: true, user: userWithoutPass });
});

app.post('/api/auth/login', (req, res) => {
  const db = readDB();
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const user = db.users.find(u => u.email === normalizedEmail && u.password === password);

  if (!user) {
    return res.status(401).json({ error: "Invalid email or password credentials." });
  }

  if (user.suspended) {
    return res.status(403).json({ error: `Your ${user.role} account has been suspended by Admin. Please contact support.` });
  }

  const { password: _, ...userWithoutPass } = user;
  res.json({ success: true, user: userWithoutPass });
});

// ==========================================================================
// 🛡️ API ROUTE: PROFILE & STATUS
// ==========================================================================
app.get('/api/profile', (req, res) => {
  const db = readDB();
  const user = getRequestUser(req, db);
  if (!user) return res.status(404).json({ error: "User not found." });
  
  const { password, ...userWithoutPass } = user;
  res.json(userWithoutPass);
});

app.post('/api/profile/update', (req, res) => {
  const db = readDB();
  const user = getRequestUser(req, db);
  if (!user) return res.status(404).json({ error: "User not found." });

  const { activeCitiesFilter, smsAlerts, emailReports, name, license, description, phone, email, verified, avatarImage, verificationStatus, verificationIdDoc, verificationLicenseDoc, verificationRejectionReason, addresses, niche, city } = req.body;

  const dbUser = db.users.find(u => u.id === user.id);

  if (activeCitiesFilter !== undefined) dbUser.activeCitiesFilter = activeCitiesFilter;
  if (smsAlerts !== undefined) dbUser.smsAlerts = smsAlerts;
  if (emailReports !== undefined) dbUser.emailReports = emailReports;
  if (name !== undefined) dbUser.name = name;
  if (license !== undefined) dbUser.license = license;
  if (description !== undefined) dbUser.description = description;
  if (phone !== undefined) dbUser.phone = phone;
  if (email !== undefined) dbUser.email = email;
  if (verified !== undefined) dbUser.verified = verified;
  if (avatarImage !== undefined) dbUser.avatarImage = avatarImage;
  if (verificationStatus !== undefined) dbUser.verificationStatus = verificationStatus;
  if (verificationIdDoc !== undefined) dbUser.verificationIdDoc = verificationIdDoc;
  if (verificationLicenseDoc !== undefined) dbUser.verificationLicenseDoc = verificationLicenseDoc;
  if (verificationRejectionReason !== undefined) dbUser.verificationRejectionReason = verificationRejectionReason;
  if (addresses !== undefined) dbUser.addresses = addresses;
  if (niche !== undefined) dbUser.niche = niche;
  if (city !== undefined) dbUser.city = city;

  writeDB(db);
  const { password, ...userWithoutPass } = dbUser;
  res.json({ success: true, profile: userWithoutPass });
});

// Submit Verification Documents
app.post('/api/profile/verify/submit', (req, res) => {
  const db = readDB();
  const user = getRequestUser(req, db);
  if (!user) return res.status(404).json({ error: "User not found." });

  const { idDoc, licenseDoc } = req.body;
  if (!idDoc || !licenseDoc) {
    return res.status(400).json({ error: "Both State ID and Contractor License copies are required." });
  }

  const dbUser = db.users.find(u => u.id === user.id);
  dbUser.verificationStatus = "pending";
  dbUser.verificationIdDoc = idDoc;
  dbUser.verificationLicenseDoc = licenseDoc;
  dbUser.verificationRejectionReason = "";

  writeDB(db);
  
  const { password, ...userWithoutPass } = dbUser;
  broadcast({ type: "PROFILE_VERIFICATION_SUBMITTED", profile: userWithoutPass });
  res.json({ success: true, profile: userWithoutPass });
});

// Resolve Verification (Admin Action)
app.post('/api/profile/verify/resolve', (req, res) => {
  const db = readDB();
  const adminUser = getRequestUser(req, db);
  if (!adminUser || adminUser.role !== 'admin') {
    return res.status(403).json({ error: "Unauthorized. Admin permissions required." });
  }

  const { contractorId, action, reason } = req.body;
  const targetUser = db.users.find(u => u.id === contractorId);
  if (!targetUser) {
    return res.status(404).json({ error: "Contractor not found." });
  }

  if (action === "approve") {
    targetUser.verified = true;
    targetUser.verificationStatus = "verified";
    targetUser.verificationRejectionReason = "";
  } else if (action === "reject") {
    targetUser.verified = false;
    targetUser.verificationStatus = "rejected";
    targetUser.verificationRejectionReason = reason || "Documents are blurred or invalid.";
  } else {
    return res.status(400).json({ error: "Invalid action. Use 'approve' or 'reject'." });
  }

  writeDB(db);
  const { password, ...userWithoutPass } = targetUser;
  broadcast({ type: "PROFILE_VERIFICATION_RESOLVED", profile: userWithoutPass });
  res.json({ success: true, profile: userWithoutPass });
});

// ==========================================================================
// 🛡️ API ROUTE: LEADS LISTING (Multi-Tenant Secure Server-Side Data Masking)
// ==========================================================================
app.get('/api/leads', (req, res) => {
  const db = readDB();
  const user = getRequestUser(req, db);

  // If homeowner, return ONLY leads submitted by them with unlocking contractor info
  if (user && user.role === 'homeowner') {
    const homeownerLeads = db.leads.filter(l => l.customerId === user.id);
    const leadsWithContractor = homeownerLeads.map(l => {
      const unlock = db.unlocks.find(u => u.leadId === l.id);
      if (unlock) {
        const contractor = db.users.find(u => u.id === unlock.contractorId);
        if (contractor) {
          return {
            ...l,
            unlocked: true,
            contractorName: contractor.name,
            contractorPhone: contractor.phone,
            contractorNiche: contractor.niche || 'plumbing',
            contractorAvatar: contractor.avatarImage || ''
          };
        }
      }
      return { ...l, unlocked: false };
    });
    return res.json(leadsWithContractor);
  }

  // If Admin, return all leads with FULL details (but with correct unlocked state)
  if (user && user.role === 'admin') {
    return res.json(db.leads.map(l => {
      const isUnlocked = db.unlocks.some(u => u.leadId === l.id);
      return { ...l, unlocked: isUnlocked };
    }));
  }

  // If Contractor, apply Pay-To-Unlock security rules
  const maskedLeads = db.leads.map(lead => {
    // Check if THIS specific contractor has unlocked this lead
    const isUnlockedByMe = db.unlocks.some(u => u.leadId === lead.id && u.contractorId === user.id);
    
    if (isUnlockedByMe) {
      return { ...lead, unlocked: true };
    } else {
      // Mask customer personal info
      const nameParts = lead.customerName.split(' ');
      const firstName = nameParts[0] || 'Customer';
      const lastNameInitial = nameParts[1] ? nameParts[1].charAt(0) + '.' : '';
      const phoneParts = lead.customerPhone.split('-');
      const areaCode = phoneParts[0] || '(510)';

      return {
        ...lead,
        unlocked: false,
        customerName: `${firstName} ${lastNameInitial}`.trim(),
        customerPhone: `${areaCode}-***-****` // Completely secure!
      };
    }
  });

  res.json(maskedLeads);
});

// ==========================================================================
// 🛡️ API ROUTE: UNLOCK LEAD TRANSACTION (Isolate Balance Deduction per Contractor)
// ==========================================================================
app.post('/api/leads/unlock', (req, res) => {
  const db = readDB();
  const user = getRequestUser(req, db);
  const { id } = req.body;

  if (!user || user.role !== 'contractor') {
    return res.status(403).json({ error: "Only contractors can unlock leads." });
  }

  const leadIndex = db.leads.findIndex(l => l.id === id);
  if (leadIndex === -1) {
    return res.status(404).json({ error: "Lead not found." });
  }

  const lead = db.leads[leadIndex];
  
  // Check if already unlocked
  const alreadyUnlocked = db.unlocks.some(u => u.leadId === lead.id && u.contractorId === user.id);
  if (alreadyUnlocked) {
    return res.json({ success: true, lead: { ...lead, unlocked: true } });
  }

  // Verify specific contractor's balance
  const dbUser = db.users.find(u => u.id === user.id);
  if (dbUser.walletBalance < lead.price) {
    return res.status(400).json({ error: "Insufficient wallet balance." });
  }

  // Deduct contractor wallet
  dbUser.walletBalance -= lead.price;

  // Add lock entry
  db.unlocks.push({
    leadId: lead.id,
    contractorId: user.id,
    unlockedAt: new Date().toISOString()
  });

  // Add ledger transaction log
  const formattedDate = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ", " + new Date().toLocaleDateString([], { month: 'short', day: 'numeric' });
  const newTx = {
    userId: user.id,
    type: "unlock",
    amount: lead.price,
    title: `${lead.title} (${lead.city})`,
    date: formattedDate
  };
  db.transactions.unshift(newTx);

  writeDB(db);

  const { password, ...userWithoutPass } = dbUser;
  broadcast({ type: 'LEAD_UNLOCKED', leadId: lead.id, profile: userWithoutPass, contractorId: user.id });

  res.json({ success: true, lead: { ...lead, unlocked: true }, profile: userWithoutPass });
});

// ==========================================================================
// 🛡️ API ROUTE: WALLET DEPOSITS & Stripe Gateway Intent Webhook mock
// ==========================================================================
app.post('/api/wallet/deposit', (req, res) => {
  const db = readDB();
  const user = getRequestUser(req, db);
  const { amount, description } = req.body;

  if (!user || user.role !== 'contractor') {
    return res.status(403).json({ error: "Only contractors can deposit funds." });
  }

  const depositVal = parseFloat(amount);
  if (isNaN(depositVal) || depositVal <= 0) {
    return res.status(400).json({ error: "Invalid deposit amount." });
  }

  const dbUser = db.users.find(u => u.id === user.id);
  dbUser.walletBalance += depositVal;

  const formattedDate = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ", " + new Date().toLocaleDateString([], { month: 'short', day: 'numeric' });
  const newTx = {
    userId: user.id,
    type: "deposit",
    amount: depositVal,
    title: description || "Stripe Deposit",
    date: formattedDate
  };
  db.transactions.unshift(newTx);

  writeDB(db);

  const { password, ...userWithoutPass } = dbUser;
  res.json({ success: true, profile: userWithoutPass });
});

app.get('/api/transactions', (req, res) => {
  const db = readDB();
  const user = getRequestUser(req, db);
  
  if (user && user.role === 'admin') {
    return res.json(db.transactions);
  }
  
  // Return only matching user transactions
  const userTx = db.transactions.filter(tx => tx.userId === user.id);
  res.json(userTx);
});

// ==========================================================================
// 🛡️ API ROUTE: POST NEW LEAD (Admin / Homeowner / AI Sim Call Channel)
// ==========================================================================
app.post('/api/leads/create', (req, res) => {
  const db = readDB();
  const user = getRequestUser(req, db);
  const { niche, title, city, description, price, customerName, customerPhone } = req.body;

  const customerId = user ? user.id : "usr-homeowner";

  // Dynamic Pricing Rules Engine Lookup
  let finalPrice = parseFloat(price);
  if (!finalPrice) {
    const rules = db.pricingRules || [];
    const matchedRule = rules.find(r => 
      r.niche === niche && 
      city.toLowerCase().includes(r.city.toLowerCase())
    );
    if (matchedRule) {
      finalPrice = matchedRule.price;
    } else {
      // Fallback base pricing
      finalPrice = niche === 'roofing' ? 45.00 : niche === 'glass' ? 35.00 : 30.00;
    }
  }

  const newLead = {
    id: "lead-" + Date.now(),
    customerId,
    niche,
    title,
    city,
    description,
    price: finalPrice,
    customerName: customerName || "Emergency Client",
    customerPhone: customerPhone || "(510) 555-0811",
    date: "Just now",
    status: "unlocked",
    jobRevenue: 0,
    disputed: false,
    disputeReason: ""
  };

  db.leads.unshift(newLead);
  writeDB(db);

  // Broadcast new lead event over websockets for real-time notification sound/popups!
  broadcast({ type: 'NEW_LEAD', lead: newLead });

  res.json({ success: true, lead: newLead });
});

// ==========================================================================
// 🛡️ API ROUTE: LEAD DISPUTES MANAGEMENT
// ==========================================================================
app.get('/api/disputes', (req, res) => {
  const db = readDB();
  const user = getRequestUser(req, db);

  if (user && user.role === 'admin') {
    return res.json(db.disputes);
  }
  const userDisputes = db.disputes.filter(d => d.userId === user.id);
  res.json(userDisputes);
});

app.post('/api/leads/dispute', (req, res) => {
  const db = readDB();
  const user = getRequestUser(req, db);
  const { id, reason } = req.body;

  if (!user || user.role !== 'contractor') {
    return res.status(403).json({ error: "Only contractors can dispute leads." });
  }

  const leadIndex = db.leads.findIndex(l => l.id === id);
  if (leadIndex === -1) {
    return res.status(404).json({ error: "Lead not found." });
  }

  const lead = db.leads[leadIndex];
  lead.disputed = true;
  lead.disputeReason = reason;

  const dispute = {
    id: "dispute-" + Date.now(),
    userId: user.id,
    leadId: lead.id,
    title: lead.title,
    city: lead.city,
    price: lead.price,
    reason: reason || "Unspecified issue",
    status: "pending",
    timestamp: new Date().toLocaleString()
  };

  db.disputes.unshift(dispute);
  writeDB(db);

  broadcast({ type: 'DISPUTE_SUBMITTED', dispute });
  res.json({ success: true, lead, dispute });
});

app.post('/api/leads/dispute/resolve', (req, res) => {
  const db = readDB();
  const adminUser = getRequestUser(req, db);
  if (!adminUser || adminUser.role !== 'admin') {
    return res.status(403).json({ error: "Unauthorized. Admin credentials required." });
  }

  const { disputeId, action } = req.body;
  const disputeIndex = db.disputes.findIndex(d => d.id === disputeId);
  if (disputeIndex === -1) {
    return res.status(404).json({ error: "Dispute not found." });
  }

  const dispute = db.disputes[disputeIndex];
  const leadIndex = db.leads.findIndex(l => l.id === dispute.leadId);
  const lead = leadIndex !== -1 ? db.leads[leadIndex] : null;

  const targetContractor = db.users.find(u => u.id === dispute.userId);

  if (action === "approve") {
    dispute.status = "approved";
    if (lead) {
      lead.disputed = false;
      lead.status = "unlocked";
      lead.jobRevenue = 0;
    }
    // Remove the lock entry to let the contractor unlock again if they want, or just delete it
    db.unlocks = db.unlocks.filter(u => !(u.leadId === dispute.leadId && u.contractorId === dispute.userId));

    // Refund target contractor balance
    if (targetContractor) {
      targetContractor.walletBalance += dispute.price;
      
      // Add Refund Ledger Transaction log
      const formattedDate = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ", " + new Date().toLocaleDateString([], { month: 'short', day: 'numeric' });
      db.transactions.unshift({
        userId: targetContractor.id,
        type: "deposit",
        amount: dispute.price,
        title: `Refund: ${dispute.title}`,
        date: formattedDate
      });
    }
  } else {
    dispute.status = "rejected";
    if (lead) {
      lead.disputed = false;
    }
  }

  writeDB(db);
  
  const profileResponse = targetContractor ? { id: targetContractor.id, walletBalance: targetContractor.walletBalance } : null;
  broadcast({ type: 'DISPUTE_RESOLVED', dispute, profile: profileResponse });
  res.json({ success: true, dispute, profile: profileResponse });
});

// ==========================================================================
// 🛡️ API ROUTE: JOB STATUS & REVENUE UPDATES
// ==========================================================================
app.post('/api/leads/status', (req, res) => {
  const db = readDB();
  const { id, status, jobRevenue } = req.body;

  const leadIndex = db.leads.findIndex(l => l.id === id);
  if (leadIndex === -1) {
    return res.status(404).json({ error: "Lead not found." });
  }

  const lead = db.leads[leadIndex];
  lead.status = status || "unlocked";
  if (status === "completed") {
    lead.jobRevenue = parseFloat(jobRevenue) || 0;
  } else {
    lead.jobRevenue = 0;
  }

  writeDB(db);
  broadcast({ type: 'LEAD_STATUS_UPDATED', lead });
  res.json({ success: true, lead });
});

// ==========================================================================
// 🛡️ API ROUTE: VoIP CALL LOGS & RECORDINGS
// ==========================================================================
app.get('/api/calls', (req, res) => {
  const db = readDB();
  const user = getRequestUser(req, db);
  
  if (user && user.role === 'admin') {
    return res.json(db.callLogs);
  }
  const userCalls = db.callLogs.filter(c => c.userId === user.id);
  res.json(userCalls);
});

app.post('/api/calls/log', (req, res) => {
  const db = readDB();
  const user = getRequestUser(req, db);
  const { customerName, customerPhone, duration, transcript, niche } = req.body;

  const newLog = {
    id: "call-" + Date.now(),
    userId: user ? user.id : "usr-apex",
    customerName,
    customerPhone,
    duration,
    transcript,
    niche,
    timestamp: new Date().toLocaleString()
  };

  db.callLogs.unshift(newLog);
  writeDB(db);

  res.json({ success: true, log: newLog });
});

// ==========================================================================
// 🛡️ API ROUTE: PLATFORM RESET (Wipe back to default users/leads)
// ==========================================================================
app.post('/api/platform/reset', (req, res) => {
  const db = {
    users: defaultUsers,
    leads: defaultLeads,
    unlocks: defaultUnlocks,
    transactions: defaultTransactions,
    disputes: [],
    callLogs: []
  };
  writeDB(db);
  res.json({ success: true, profile: defaultUsers[1] }); // Return apex contractor as reset fallback
});

// ==========================================================================
// 🛡️ API ROUTE: SAFE PUBLIC DIRECTORY FOR HOMEOWNERS
// ==========================================================================
app.get('/api/contractors/public', (req, res) => {
  const db = readDB();
  const contractors = db.users
    .filter(u => u.role === 'contractor' && !u.suspended)
    .map(u => ({
      id: u.id,
      name: u.name,
      niche: u.niche || 'plumbing',
      city: u.city || 'Newark, CA',
      verified: u.verified || false,
      avatarImage: u.avatarImage || '',
      description: u.description || `${u.name} is a local home service professional.`
    }));
  res.json(contractors);
});

// Serve frontend assets
// ==========================================================================
// 🛡️ API ROUTE: ADMIN GET ALL CONTRACTORS (For Keith's backoffice auditing)
// ==========================================================================
app.get('/api/admin/contractors', (req, res) => {
  const db = readDB();
  const adminUser = getRequestUser(req, db);
  if (!adminUser || adminUser.role !== 'admin') {
    return res.status(403).json({ error: "Admin credentials required." });
  }

  const contractors = db.users
    .filter(u => u.role === 'contractor')
    .map(({ password, ...c }) => c);

  res.json(contractors);
});

// 🛡️ API ROUTE: ADMIN ADJUST CONTRACTOR BALANCE
app.post('/api/admin/contractors/adjust-balance', (req, res) => {
  const db = readDB();
  const adminUser = getRequestUser(req, db);
  if (!adminUser || adminUser.role !== 'admin') {
    return res.status(403).json({ error: "Admin credentials required." });
  }

  const { contractorId, amount } = req.body;
  const targetContractor = db.users.find(u => u.id === contractorId && u.role === 'contractor');
  if (!targetContractor) {
    return res.status(404).json({ error: "Contractor not found." });
  }

  const adjustVal = parseFloat(amount);
  if (isNaN(adjustVal)) {
    return res.status(400).json({ error: "Invalid adjustment amount." });
  }

  targetContractor.walletBalance += adjustVal;

  const formattedDate = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ", " + new Date().toLocaleDateString([], { month: 'short', day: 'numeric' });
  db.transactions.unshift({
    userId: contractorId,
    type: adjustVal >= 0 ? "deposit" : "unlock",
    amount: Math.abs(adjustVal),
    title: `Admin Manual Adjustment: ${adjustVal >= 0 ? '+' : '-'}$${Math.abs(adjustVal).toFixed(2)}`,
    date: formattedDate
  });

  writeDB(db);
  broadcast({ type: "WALLETS_UPDATED" });
  res.json({ success: true, profile: targetContractor });
});

// 🛡️ API ROUTE: ADMIN TOGGLE CONTRACTOR SUSPENSION
app.post('/api/admin/contractors/toggle-suspension', (req, res) => {
  const db = readDB();
  const adminUser = getRequestUser(req, db);
  if (!adminUser || adminUser.role !== 'admin') {
    return res.status(403).json({ error: "Admin credentials required." });
  }

  const { contractorId } = req.body;
  const targetContractor = db.users.find(u => u.id === contractorId && u.role === 'contractor');
  if (!targetContractor) {
    return res.status(404).json({ error: "Contractor not found." });
  }

  targetContractor.suspended = !targetContractor.suspended;
  writeDB(db);
  
  broadcast({ type: "CONTRACTOR_SUSPENSION_TOGGLED", contractorId, suspended: targetContractor.suspended });
  res.json({ success: true, contractor: targetContractor });
});

// 🛡️ API ROUTE: ADMIN GET ALL HOMEOWNERS
app.get('/api/admin/homeowners', (req, res) => {
  const db = readDB();
  const adminUser = getRequestUser(req, db);
  if (!adminUser || adminUser.role !== 'admin') {
    return res.status(403).json({ error: "Admin credentials required." });
  }

  const homeowners = db.users
    .filter(u => u.role === 'homeowner')
    .map(h => {
      // Calculate total requests submitted
      const requestCount = db.leads.filter(l => l.customerId === h.id).length;
      const { password, ...hNoPass } = h;
      return { ...hNoPass, requestCount };
    });

  res.json(homeowners);
});

// 🛡️ API ROUTE: ADMIN TOGGLE HOMEOWNER SUSPENSION
app.post('/api/admin/homeowners/toggle-suspension', (req, res) => {
  const db = readDB();
  const adminUser = getRequestUser(req, db);
  if (!adminUser || adminUser.role !== 'admin') {
    return res.status(403).json({ error: "Admin credentials required." });
  }

  const { homeownerId } = req.body;
  const targetHomeowner = db.users.find(u => u.id === homeownerId && u.role === 'homeowner');
  if (!targetHomeowner) {
    return res.status(404).json({ error: "Homeowner not found." });
  }

  targetHomeowner.suspended = !targetHomeowner.suspended;
  writeDB(db);

  broadcast({ type: "HOMEOWNER_SUSPENSION_TOGGLED", homeownerId, suspended: targetHomeowner.suspended });
  res.json({ success: true, homeowner: targetHomeowner });
});

// 🛡️ API ROUTE: ADMIN GET PRICING RULES
app.get('/api/admin/pricing-rules', (req, res) => {
  const db = readDB();
  const adminUser = getRequestUser(req, db);
  if (!adminUser || adminUser.role !== 'admin') {
    return res.status(403).json({ error: "Admin credentials required." });
  }
  res.json(db.pricingRules || []);
});

// 🛡️ API ROUTE: ADMIN SAVE PRICING RULES
app.post('/api/admin/pricing-rules/save', (req, res) => {
  const db = readDB();
  const adminUser = getRequestUser(req, db);
  if (!adminUser || adminUser.role !== 'admin') {
    return res.status(403).json({ error: "Admin credentials required." });
  }

  const { rules } = req.body;
  if (!Array.isArray(rules)) {
    return res.status(400).json({ error: "Rules must be an array." });
  }

  db.pricingRules = rules;
  writeDB(db);
  res.json({ success: true, rules: db.pricingRules });
});

// 🛡️ API ROUTE: ADMIN GET AI INSTRUCTIONS
app.get('/api/admin/ai-instructions', (req, res) => {
  const db = readDB();
  const adminUser = getRequestUser(req, db);
  if (!adminUser || adminUser.role !== 'admin') {
    return res.status(403).json({ error: "Admin credentials required." });
  }
  res.json(db.aiConfig || { systemInstructions: "You are a professional local emergency operator." });
});

// 🛡️ API ROUTE: ADMIN SAVE AI INSTRUCTIONS
app.post('/api/admin/ai-instructions/update', (req, res) => {
  const db = readDB();
  const adminUser = getRequestUser(req, db);
  if (!adminUser || adminUser.role !== 'admin') {
    return res.status(403).json({ error: "Admin credentials required." });
  }

  const { systemInstructions } = req.body;
  if (typeof systemInstructions !== 'string') {
    return res.status(400).json({ error: "Instructions must be a string." });
  }

  if (!db.aiConfig) db.aiConfig = {};
  db.aiConfig.systemInstructions = systemInstructions;
  writeDB(db);
  res.json({ success: true, aiConfig: db.aiConfig });
});

app.use(express.static(__dirname));

// Send main file
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// HTTP Server
const server = http.createServer(app);

// WebSocket Server
const wss = new WebSocket.Server({ server });
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => {
    clients.delete(ws);
  });
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

server.listen(PORT, () => {
  console.log(`Server successfully launched and running at http://localhost:${PORT}/`);
});
