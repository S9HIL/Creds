const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const { makeWASocket } = require('@whiskeysockets/baileys');
const pino = require('pino');
const NodeCache = require('node-cache');
const multer = require('multer');
const { delay, useMultiFileAuthState, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');

const app = express();

// Middleware setup
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ dest: 'uploads/' });
const activeSessions = new Map();
const dataDir = path.join(__dirname, 'data');

// Function to create session folder
async function createSessionFolder(sessionId) {
  const sessionFolder = path.join(dataDir, sessionId);
  try {
    await fs.mkdir(sessionFolder, { recursive: true });
  } catch (err) {
    console.error(`Error creating folder for session ${sessionId}`, err);
  }
  return sessionFolder;
}

// Function to check if credentials are duplicate
async function isDuplicateCreds(credentialsPath) {
  const credentials = await fs.readFile(credentialsPath, 'utf-8');
  for (const [sessionId, sessionData] of activeSessions) {
    const sessionPath = path.join(dataDir, sessionId, 'creds.json');
    const sessionCreds = await fs.readFile(sessionPath, 'utf-8');
    if (credentials === sessionCreds) {
      return true; // Duplicate found
    }
  }
  return false; // No duplicate
}

// Route to handle starting a session
app.post('/start-session', async (req, res) => {
  const { sessionId } = req.body;
  if (activeSessions.has(sessionId)) {
    res.status(400).send('Session already started');
  } else {
    const sessionFolder = await createSessionFolder(sessionId);
    const socket = makeWASocket({
      auth: useMultiFileAuthState(path.join(sessionFolder, 'auth'))
    });
    activeSessions.set(sessionId, { socket });

    socket.ev.on('connection.update', (update) => {
      if (update.connection === 'open') {
        res.send('Session started successfully');
      } else if (update.connection === 'close') {
        activeSessions.delete(sessionId);
        res.send('Session closed');
      }
    });

    socket.ev.on('message', (message) => {
      console.log('Received message:', message);
    });
  }
});

// Route to handle sending a message
app.post('/send-message', async (req, res) => {
  const { sessionId, message, target } = req.body;
  const session = activeSessions.get(sessionId);
  
  if (session) {
    const { socket } = session;
    try {
      await socket.sendMessage(target, { text: message });
      res.send('Message sent');
    } catch (err) {
      res.status(500).send('Error sending message');
    }
  } else {
    res.status(400).send('Session not found');
  }
});

// Route to handle stopping a session
app.post('/stop-session', (req, res) => {
  const { sessionId } = req.body;
  const session = activeSessions.get(sessionId);
  
  if (session) {
    session.socket.ev.removeAllListeners();
    activeSessions.delete(sessionId);
    res.send('Session stopped');
  } else {
    res.status(400).send('Session not found');
  }
});

// Start the server
app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
