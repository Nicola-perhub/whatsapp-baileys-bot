const { makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode-terminal');

const app = express();
const PORT = process.env.PORT || 3000;
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || 'https://your-n8n-webhook-url.com';

app.use(express.json());

let sock;

// Logger
const logger = pino({
  level: process.env.LOG_LEVEL || 'silent'
});

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');

  sock = makeWASocket({
    auth: state,
    logger,
    browser: ['Bot PDF Reader', 'Chrome', '1.0.0']
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('🔗 QR Code generato! Scansiona con WhatsApp:');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('❌ Connessione chiusa:', lastDisconnect?.error, ', riconnessione:', shouldReconnect);
      if (shouldReconnect) connectToWhatsApp();
    } else if (connection === 'open') {
      console.log('✅ Bot WhatsApp connesso!');
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // Messaggi
  sock.ev.on('messages.upsert', async (m) => {
    const msg = m.messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const messageType = Object.keys(msg.message)[0];

    console.log("📩 Messaggio completo ricevuto:");
console.dir(msg, { depth: null });


    if (messageType === 'documentMessage' && msg.message.documentMessage.mimetype === 'application/pdf') {
      await handlePDFDocument(msg, from);
    } else if (messageType === 'conversation' || messageType === 'extendedTextMessage') {
      const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
      await handleTextMessage(text, from, msg);
    }
  });
}

async function handlePDFDocument(msg, from) {
  try {
    const doc = msg.message.documentMessage;
    console.log(`📄 PDF ricevuto: ${doc.fileName}`);

    await sock.sendMessage(from, { text: "📄 PDF ricevuto! Sto analizzando il documento..." });

    const buffer = await sock.downloadMediaMessage(msg);

    await sendToN8N({
      type: 'pdf',
      fileName: doc.fileName,
      fileBuffer: buffer.toString('base64'),
      from,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Errore gestione PDF:', error);
    await sock.sendMessage(from, {
      text: "❌ Errore nell'analisi del PDF. Riprova."
    });
  }
}

async function handleTextMessage(text, from, msg) {
  console.log(`💬 Messaggio testo: ${text}`);

  if (text.toLowerCase() === '/start') {
    await sock.sendMessage(from, {
      text: `🤖 *Bot Analisi PDF Attivo!*\n\n📄 Invia un PDF per l'analisi automatica\n🔍 Estrarrò contenuti e argomenti principali\n\n_Powered by Claude AI_`
    });
    return;
  }

  await sendToN8N({
    type: 'text',
    message: text,
    from,
    timestamp: new Date().toISOString()
  });
}

async function sendToN8N(data) {
  try {
    if (N8N_WEBHOOK_URL === 'https://your-n8n-webhook-url.com') {
      console.log('⚠️  Webhook n8n non configurato. Dati:', data);
      return;
    }

    const response = await axios.post(N8N_WEBHOOK_URL, data, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000
    });

    console.log('✅ Dati inviati a n8n:', response.status);

    if (response.data && response.data.reply) {
      await sock.sendMessage(data.from, {
        text: response.data.reply
      });
    }

  } catch (error) {
    console.error('❌ Errore invio a n8n:', error.message);
  }
}

app.post('/send-message', async (req, res) => {
  try {
    const { to, message } = req.body;

    if (!to || !message) {
      return res.status(400).json({ error: 'Parametri mancanti' });
    }

    await sock.sendMessage(to, { text: message });
    res.json({ success: true, message: 'Messaggio inviato' });

  } catch (error) {
    console.error('❌ Errore invio messaggio:', error);
    res.status(500).json({ error: 'Errore invio messaggio' });
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    bot_connected: sock?.user ? true : false,
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server avviato sulla porta ${PORT}`);
  connectToWhatsApp();
});

process.on('SIGINT', () => {
  console.log('🛑 Chiusura bot...');
  if (sock) sock.end();
  process.exit(0);
});
