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
app.use(express.json());

// INITIAL DEFAULT DATA (Directly matching whatsrealeasy's actual niches)
const defaultProfile = {
  name: "Apex Plumbing & Rooter",
  license: "CSLB #1094851",
  walletBalance: 150.00,
  activeCitiesFilter: ["newark", "las vegas"],
  smsAlerts: true,
  emailReports: false,
  description: "Apex Plumbing & Rooter has been providing premium commercial and residential drain cleaning, pipe replacements, and emergency plumbing services in the Bay Area and Las Vegas since 2012.",
  phone: "(510) 555-9000",
  email: "contact@apexplumbing.com",
  verified: false,
  verificationStatus: "unverified",
  verificationIdDoc: "",
  verificationLicenseDoc: "",
  verificationRejectionReason: ""
};

const defaultLeads = [
  {
    id: "lead-1",
    niche: "plumbing",
    title: "Whole Home PEX Repiping",
    city: "Newark, CA",
    description: "Aging copper pipes corroding, causing low water pressure and rust-colored water in a single-family home. Homeowner wants a full replacement with modern PEX piping.",
    price: 35.00,
    customerName: "James Miller",
    customerPhone: "(510) 555-0143",
    unlocked: false,
    date: "10 mins ago",
    status: "unlocked", // default progress status
    jobRevenue: 0,
    disputed: false,
    disputeReason: ""
  },
  {
    id: "lead-2",
    niche: "roofing",
    title: "Commercial Flat Roof Patch & Seal",
    city: "Las Vegas, NV",
    description: "Active leaks detected over the main warehouse bay. Flat TPO roofing needs patching, sealing, and a reflective coating applied before the heat increases.",
    price: 45.00,
    customerName: "Sarah Jenkins (Vegas Logistics)",
    customerPhone: "(702) 608-4491",
    unlocked: false,
    date: "2 hours ago",
    status: "unlocked",
    jobRevenue: 0,
    disputed: false,
    disputeReason: ""
  },
  {
    id: "lead-3",
    niche: "plumbing",
    title: "Gas Water Heater Leak & Replacement",
    city: "Newark, CA",
    description: "50-gallon gas water heater is leaking from the bottom valve. Needs immediate replacement with a energy-efficient unit.",
    price: 25.00,
    customerName: "Robert Chen",
    customerPhone: "(510) 555-0988",
    unlocked: false,
    date: "4 hours ago",
    status: "unlocked",
    jobRevenue: 0,
    disputed: false,
    disputeReason: ""
  },
  {
    id: "lead-4",
    niche: "roofing",
    title: "Emergency Shingle Roof Repair",
    city: "San Rafael, CA (Bay Area)",
    description: "Wind damage caused shingles to blow off a residential roof. Water is starting to seep into the attic. Needs immediate tarping and shingle patch.",
    price: 30.00,
    customerName: "Michael Thompson",
    customerPhone: "(415) 521-8977",
    unlocked: false,
    date: "1 day ago",
    status: "unlocked",
    jobRevenue: 0,
    disputed: false,
    disputeReason: ""
  }
];

const defaultTransactions = [
  { type: "deposit", amount: 150.00, title: "Initial Platform Credit", date: "Joined Platform" }
];

// Helper to read database state
function readDB() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      const db = { profile: defaultProfile, leads: defaultLeads, transactions: defaultTransactions, disputes: [], callLogs: [] };
      fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
      return db;
    }
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const db = JSON.parse(raw);
    
    // Ensure nested fields are initialized defensively for backward compatibility
    if (!db.disputes) db.disputes = [];
    if (!db.callLogs) db.callLogs = [];
    if (db.profile && db.profile.verified === undefined) {
      db.profile.verified = false;
      db.profile.description = defaultProfile.description;
      db.profile.phone = defaultProfile.phone;
      db.profile.email = defaultProfile.email;
    }
    db.leads.forEach(l => {
      if (l.status === undefined) l.status = "unlocked";
      if (l.jobRevenue === undefined) l.jobRevenue = 0;
      if (l.disputed === undefined) l.disputed = false;
      if (l.disputeReason === undefined) l.disputeReason = "";
    });
    
    return db;
  } catch (e) {
    console.error("Error reading database file, returning defaults:", e);
    return { profile: defaultProfile, leads: defaultLeads, transactions: defaultTransactions, disputes: [], callLogs: [] };
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

// ==========================================================================
// 🛡️ API ROUTE: CONTRACTOR PROFILE & WALLET STATUS
// ==========================================================================
app.get('/api/profile', (req, res) => {
  const db = readDB();
  res.json(db.profile);
});

app.post('/api/profile/update', (req, res) => {
  const db = readDB();
  const { activeCitiesFilter, smsAlerts, emailReports, name, license, description, phone, email, verified, avatarImage, verificationStatus, verificationIdDoc, verificationLicenseDoc, verificationRejectionReason } = req.body;

  if (activeCitiesFilter !== undefined) db.profile.activeCitiesFilter = activeCitiesFilter;
  if (smsAlerts !== undefined) db.profile.smsAlerts = smsAlerts;
  if (emailReports !== undefined) db.profile.emailReports = emailReports;
  if (name !== undefined) db.profile.name = name;
  if (license !== undefined) db.profile.license = license;
  if (description !== undefined) db.profile.description = description;
  if (phone !== undefined) db.profile.phone = phone;
  if (email !== undefined) db.profile.email = email;
  if (verified !== undefined) db.profile.verified = verified;
  if (avatarImage !== undefined) db.profile.avatarImage = avatarImage;
  if (verificationStatus !== undefined) db.profile.verificationStatus = verificationStatus;
  if (verificationIdDoc !== undefined) db.profile.verificationIdDoc = verificationIdDoc;
  if (verificationLicenseDoc !== undefined) db.profile.verificationLicenseDoc = verificationLicenseDoc;
  if (verificationRejectionReason !== undefined) db.profile.verificationRejectionReason = verificationRejectionReason;

  writeDB(db);
  res.json({ success: true, profile: db.profile });
});

// Submit Verification Documents
app.post('/api/profile/verify/submit', (req, res) => {
  const db = readDB();
  const { idDoc, licenseDoc } = req.body;

  if (!idDoc || !licenseDoc) {
    return res.status(400).json({ error: "Both State ID and Contractor License copies are required." });
  }

  db.profile.verificationStatus = "pending";
  db.profile.verificationIdDoc = idDoc;
  db.profile.verificationLicenseDoc = licenseDoc;
  db.profile.verificationRejectionReason = "";

  writeDB(db);
  broadcast({ type: "PROFILE_VERIFICATION_SUBMITTED", profile: db.profile });
  res.json({ success: true, profile: db.profile });
});

// Resolve Verification (Approve / Reject)
app.post('/api/profile/verify/resolve', (req, res) => {
  const db = readDB();
  const { action, reason } = req.body;

  if (action === "approve") {
    db.profile.verified = true;
    db.profile.verificationStatus = "verified";
    db.profile.verificationRejectionReason = "";
  } else if (action === "reject") {
    db.profile.verified = false;
    db.profile.verificationStatus = "rejected";
    db.profile.verificationRejectionReason = reason || "Documents are blurred or invalid.";
  } else {
    return res.status(400).json({ error: "Invalid action. Use 'approve' or 'reject'." });
  }

  writeDB(db);
  broadcast({ type: "PROFILE_VERIFICATION_RESOLVED", profile: db.profile });
  res.json({ success: true, profile: db.profile });
});

// ==========================================================================
// 🛡️ API ROUTE: LEADS LISTING (With Secure Server-Side Data Masking!)
// ==========================================================================
app.get('/api/leads', (req, res) => {
  const db = readDB();
  
  // SECURE MASKING: Clone leads and mask sensitive details for locked state checks
  const maskedLeads = db.leads.map(lead => {
    if (lead.unlocked) {
      // Return full details if already unlocked
      return lead;
    } else {
      // Strip out real names/phones for available leads to prevent console hacking!
      const nameParts = lead.customerName.split(' ');
      const firstName = nameParts[0] || 'Customer';
      const lastNameInitial = nameParts[1] ? nameParts[1].charAt(0) + '.' : '';
      
      const phoneParts = lead.customerPhone.split('-');
      const areaCode = phoneParts[0] || '(510)';
      
      return {
        ...lead,
        customerName: `${firstName} ${lastNameInitial}`.trim(),
        customerPhone: `${areaCode}-***-****` // Securely masked on server side!
      };
    }
  });

  res.json(maskedLeads);
});

// ==========================================================================
// 🛡️ API ROUTE: UNLOCK LEAD TRANSACTION (Secure Balance Deduction)
// ==========================================================================
app.post('/api/leads/unlock', (req, res) => {
  const db = readDB();
  const { id } = req.body;
  
  const leadIndex = db.leads.findIndex(l => l.id === id);
  if (leadIndex === -1) {
    return res.status(404).json({ error: "Lead not found." });
  }

  const lead = db.leads[leadIndex];
  if (lead.unlocked) {
    return res.json({ success: true, lead }); // Already unlocked
  }

  // Verify wallet balance
  if (db.profile.walletBalance < lead.price) {
    return res.status(400).json({ error: "Insufficient wallet balance." });
  }

  // Deduct balance and commit transaction securely
  db.profile.walletBalance -= lead.price;
  lead.unlocked = true;

  // Add ledger transaction log
  const formattedDate = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ", " + new Date().toLocaleDateString([], { month: 'short', day: 'numeric' });
  const newTx = {
    type: "unlock",
    amount: lead.price,
    title: `${lead.title} (${lead.city})`,
    date: formattedDate
  };
  db.transactions.unshift(newTx);

  writeDB(db);

  // Broadcast update via WebSockets to all connected clients
  broadcast({ type: 'LEAD_UNLOCKED', leadId: lead.id, profile: db.profile });

  res.json({ success: true, lead, profile: db.profile });
});

// ==========================================================================
// 🛡️ API ROUTE: WALLET DEPOSITS & Stripe Gateway Intent Webhook mock
// ==========================================================================
app.post('/api/wallet/deposit', (req, res) => {
  const db = readDB();
  const { amount, description } = req.body;

  const depositVal = parseFloat(amount);
  if (isNaN(depositVal) || depositVal <= 0) {
    return res.status(400).json({ error: "Invalid deposit amount." });
  }

  db.profile.walletBalance += depositVal;

  const formattedDate = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ", " + new Date().toLocaleDateString([], { month: 'short', day: 'numeric' });
  const newTx = {
    type: "deposit",
    amount: depositVal,
    title: description || "Stripe Deposit",
    date: formattedDate
  };
  db.transactions.unshift(newTx);

  writeDB(db);

  res.json({ success: true, profile: db.profile });
});

app.get('/api/transactions', (req, res) => {
  const db = readDB();
  res.json(db.transactions);
});

// ==========================================================================
// 🛡️ API ROUTE: POST NEW LEAD (Admin / AI Sim Call Channel)
// ==========================================================================
app.post('/api/leads/create', (req, res) => {
  const db = readDB();
  const { niche, title, city, description, price, customerName, customerPhone } = req.body;

  const newLead = {
    id: "lead-" + Date.now(),
    niche,
    title,
    city,
    description,
    price: parseFloat(price) || 30.00,
    customerName,
    customerPhone,
    unlocked: false,
    date: "Just now"
  };

  db.leads.unshift(newLead);
  writeDB(db);

  // Broadcast new lead event over websockets for real-time notification sound/popups!
  broadcast({ type: 'NEW_LEAD', lead: newLead });

  res.json({ success: true, lead: newLead });
});

// ==========================================================================
// 🛡️ API ROUTE: LEAD DISPUTES MANAGEMENT (Phase 4 Upgrade)
// ==========================================================================
app.get('/api/disputes', (req, res) => {
  const db = readDB();
  res.json(db.disputes);
});

app.post('/api/leads/dispute', (req, res) => {
  const db = readDB();
  const { id, reason } = req.body;

  const leadIndex = db.leads.findIndex(l => l.id === id);
  if (leadIndex === -1) {
    return res.status(404).json({ error: "Lead not found." });
  }

  const lead = db.leads[leadIndex];
  lead.disputed = true;
  lead.disputeReason = reason;

  const dispute = {
    id: "dispute-" + Date.now(),
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
  const { disputeId, action } = req.body; // action: "approve" or "reject"

  const disputeIndex = db.disputes.findIndex(d => d.id === disputeId);
  if (disputeIndex === -1) {
    return res.status(404).json({ error: "Dispute not found." });
  }

  const dispute = db.disputes[disputeIndex];
  const leadIndex = db.leads.findIndex(l => l.id === dispute.leadId);
  const lead = leadIndex !== -1 ? db.leads[leadIndex] : null;

  if (action === "approve") {
    dispute.status = "approved";
    if (lead) {
      lead.unlocked = false;
      lead.disputed = false;
      lead.status = "unlocked";
      lead.jobRevenue = 0;
    }

    // Refund Contractor Wallet
    db.profile.walletBalance += dispute.price;

    // Add Refund Ledger Transaction log
    const formattedDate = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ", " + new Date().toLocaleDateString([], { month: 'short', day: 'numeric' });
    const newTx = {
      type: "deposit",
      amount: dispute.price,
      title: `Refund: ${dispute.title}`,
      date: formattedDate
    };
    db.transactions.unshift(newTx);
  } else {
    dispute.status = "rejected";
    if (lead) {
      lead.disputed = false;
    }
  }

  writeDB(db);
  broadcast({ type: 'DISPUTE_RESOLVED', dispute, profile: db.profile });
  res.json({ success: true, dispute, profile: db.profile });
});

// ==========================================================================
// 🛡️ API ROUTE: JOB STATUS & REVENUE UPDATES (Phase 4 Upgrade)
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
// 🛡️ API ROUTE: OUTBOUND VoIP CALL LOGS & RECORDINGS (Phase 4 Upgrade)
// ==========================================================================
app.get('/api/calls', (req, res) => {
  const db = readDB();
  res.json(db.callLogs);
});

app.post('/api/calls/log', (req, res) => {
  const db = readDB();
  const { customerName, customerPhone, duration, transcript, niche } = req.body;

  const newLog = {
    id: "call-" + Date.now(),
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
// 🛡️ API ROUTE: PLATFORM RESET (Wipe local state back to fresh default defaults)
// ==========================================================================
app.post('/api/platform/reset', (req, res) => {
  const db = { profile: defaultProfile, leads: defaultLeads, transactions: defaultTransactions, disputes: [], callLogs: [] };
  writeDB(db);
  res.json({ success: true, profile: db.profile });
});

// Serve frontend assets
app.use(express.static(__dirname));

// Send main file
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// HTTP Server
const server = http.createServer(app);

// WebSocket Server for Real-Time Dispatch Alerts
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
