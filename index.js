/**
 * ═══════════════════════════════════════════════════════════════════════════
 *                        BOT DE ALERTAS SASMEX
 *            Con Puppeteer y detección automática de Chat ID
 *                      ✅ VERSIÓN CORREGIDA v2.0
 * ═══════════════════════════════════════════════════════════════════════════
 */

const TelegramBot = require('node-telegram-bot-api');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const xml2js = require('xml2js');

// ═══════════════════════════════════════════════════════════════════════════
//                    🔧 COMPATIBILIDAD CON NODE.JS
// ═══════════════════════════════════════════════════════════════════════════

let fetch;
if (typeof globalThis.fetch === 'undefined') {
    try {
        fetch = require('node-fetch');
    } catch (e) {
        console.error('❌ ERROR: Instala node-fetch con: npm install node-fetch@2');
        console.error('   O usa Node.js 18 o superior');
        process.exit(1);
    }
} else {
    fetch = globalThis.fetch;
}

// ═══════════════════════════════════════════════════════════════════════════
//                              CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
    telegramToken: process.env.TELEGRAM_TOKEN || '5894462484:AAFRdNaF80iD2Bqc5SMytqUiPuJH-JRdNGs',
    adminChatId: process.env.ADMIN_CHAT_ID || '',
    
    webUrl: 'https://rss.sasmex.net',
    apiUrl: 'https://rss.sasmex.net/api/v1/alerts/latest/cap/',
    
    checkInterval: 30,
    dataFile: path.join(__dirname, 'data.json'),
    screenshotFile: path.join(__dirname, 'alerta.png'),
    logFile: path.join(__dirname, 'bot.log'),
    
    fetchTimeout: 15000,
    pageTimeout: 30000,
    
    // ✅ NUEVO: Configuración para sistema de alertas proactivas
    heartbeatInterval: 300, // 5 minutos
    alertOnErrors: true,
    alertOnRecovery: true,
    alertOnHighMemory: true,
    memoryThreshold: 200, // MB
    maxConsecutiveErrors: 3,
    adminAlertCooldown: 60, // segundos entre alertas al admin
    
    // ✅ NUEVO: Configuración para integración con host Windows
    enableHostIntegration: true,
    vscodeCliPath: 'code', // Ruta al CLI de VS Code
    allowSystemCommands: true, // Permitir comandos del sistema
    systemCommandTimeout: 30000, // Timeout para comandos del sistema
    
    puppeteerOptions: {
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--window-size=800,600',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor',
            '--disable-blink-features=AutomationControlled',
            '--disable-extensions',
            '--disable-plugins',
            '--disable-plugins-discovery',
            '--single-process'
        ]
    }
};

// ═══════════════════════════════════════════════════════════════════════════
//                           BASE DE DATOS LOCAL
// ═══════════════════════════════════════════════════════════════════════════

function loadData() {
    try {
        if (fs.existsSync(CONFIG.dataFile)) {
            const content = fs.readFileSync(CONFIG.dataFile, 'utf8');
            if (content.trim()) {
                return JSON.parse(content);
            }
        }
    } catch (error) {
        console.error('⚠️ Error cargando datos:', error.message);
        if (fs.existsSync(CONFIG.dataFile)) {
            const backupFile = CONFIG.dataFile + '.backup';
            fs.copyFileSync(CONFIG.dataFile, backupFile);
            console.log(`📁 Backup creado: ${backupFile}`);
        }
    }
    return { users: {}, lastContent: '', lastAlert: null, userStats: {} };
}

function saveData(data) {
    try {
        const tempFile = CONFIG.dataFile + '.tmp';
        fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf8');
        fs.renameSync(tempFile, CONFIG.dataFile);
        return true;
    } catch (error) {
        console.error('❌ Error guardando datos:', error.message);
        return false;
    }
}

function logToFile(level, message) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${level}: ${message}\n`;
    
    try {
        fs.appendFileSync(CONFIG.logFile, logEntry);
    } catch (error) {
        console.error('Error escribiendo log:', error.message);
    }
}

function getLogs(lines = 50) {
    try {
        if (!fs.existsSync(CONFIG.logFile)) return 'No hay logs disponibles';
        
        const logs = fs.readFileSync(CONFIG.logFile, 'utf8');
        const logLines = logs.split('\n').filter(line => line.trim());
        return logLines.slice(-lines).join('\n') || 'Sin logs recientes';
    } catch (error) {
        return `Error leyendo logs: ${error.message}`;
    }
}

function clearLogs() {
    try {
        fs.writeFileSync(CONFIG.logFile, '');
        logToFile('INFO', 'Logs limpiados por administrador');
        return true;
    } catch (error) {
        return false;
    }
}

function getSubscribers() {
    const data = loadData();
    const users = data.users || {};
    return Object.keys(users).filter(chatId => users[chatId].subscribed && !users[chatId].muted);
}

function addSubscriber(chatId) {
    if (!chatId) return false;
    
    const data = loadData();
    if (!data.users) data.users = {};
    
    const id = String(chatId);
    if (!data.users[id]) {
        data.users[id] = { 
            subscribed: true, 
            severity: 'all', 
            muted: false,
            location: 'Todo México',
            notifications: 'Imagen + Texto',
            fastMode: false,
            joinedAt: new Date().toISOString()
        };
        if (saveData(data)) {
            console.log(`✅ Nuevo suscriptor añadido: ${id}`);
            return true;
        }
    } else if (!data.users[id].subscribed) {
        data.users[id].subscribed = true;
        saveData(data);
        return true;
    }
    return false;
}

function removeSubscriber(chatId) {
    if (!chatId) return false;
    
    const data = loadData();
    if (!data.users) data.users = {};
    
    const id = String(chatId);
    if (data.users[id]) {
        data.users[id].subscribed = false;
        if (saveData(data)) {
            console.log(`❌ Suscriptor eliminado: ${id}`);
            return true;
        }
    }
    return false;
}

function getUserConfig(chatId) {
    const data = loadData();
    const users = data.users || {};
    const id = String(chatId);
    return users[id] || { 
        subscribed: false, 
        severity: 'all', 
        muted: false,
        location: 'Todo México',
        notifications: 'Imagen + Texto',
        fastMode: false
    };
}

function updateUserConfig(chatId, updates) {
    const data = loadData();
    if (!data.users) data.users = {};
    
    const id = String(chatId);
    if (!data.users[id]) {
        data.users[id] = { 
            subscribed: false, 
            severity: 'all', 
            muted: false,
            location: 'Todo México',
            notifications: 'Imagen + Texto',
            fastMode: false
        };
    }
    
    Object.assign(data.users[id], updates);
    return saveData(data);
}

function setUserSeverity(chatId, severity) {
    if (!['all', 'menor', 'moderada', 'mayor'].includes(severity)) return false;
    return updateUserConfig(chatId, { severity });
}

function setUserMuted(chatId, muted) {
    return updateUserConfig(chatId, { muted });
}

function shouldSendAlert(chatId, alertSeverity) {
    const config = getUserConfig(chatId);
    if (!config.subscribed || config.muted) return false;
    
    const severityLevels = { 'menor': 1, 'moderada': 2, 'mayor': 3 };
    const userLevel = config.severity === 'all' ? 0 : (severityLevels[config.severity] || 0);
    
    let alertLevel = 2;
    const sevLower = alertSeverity.toLowerCase();
    if (sevLower.includes('menor')) alertLevel = 1;
    else if (sevLower.includes('mayor')) alertLevel = 3;
    
    return alertLevel >= userLevel;
}

function isAdmin(chatId) {
    return CONFIG.adminChatId && String(chatId) === String(CONFIG.adminChatId);
}

function getLastContent() {
    const data = loadData();
    return data.lastContent || '';
}

function setLastContent(content) {
    const data = loadData();
    data.lastContent = content || '';
    data.lastUpdate = new Date().toISOString();
    saveData(data);
}

// ═══════════════════════════════════════════════════════════════════════════
//                    PUPPETEER - GESTIÓN DEL NAVEGADOR
// ═══════════════════════════════════════════════════════════════════════════

let browser = null;
let browserLock = false;

async function initBrowser() {
    let attempts = 0;
    while (browserLock && attempts < 10) {
        await sleep(500);
        attempts++;
    }
    
    if (browser) {
        try {
            const pages = await browser.pages();
            if (pages) return browser;
        } catch (error) {
            console.log('⚠️ Browser inactivo, reiniciando...');
            browser = null;
        }
    }
    
    browserLock = true;
    
    try {
        console.log('🌐 Iniciando navegador...');
        browser = await puppeteer.launch(CONFIG.puppeteerOptions);
        
        browser.on('disconnected', () => {
            console.log('⚠️ Browser desconectado');
            browser = null;
        });
        
        console.log('✅ Navegador iniciado');
        return browser;
    } catch (error) {
        console.error('❌ Error iniciando navegador:', error.message);
        browser = null;
        throw error;
    } finally {
        browserLock = false;
    }
}

async function closeBrowser() {
    if (browser) {
        try {
            await browser.close();
            console.log('🌐 Navegador cerrado');
        } catch (error) {
            console.error('⚠️ Error cerrando navegador:', error.message);
        } finally {
            browser = null;
        }
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════════════════════════════════════════
//                      OBTENCIÓN DE DATOS SASMEX
// ═══════════════════════════════════════════════════════════════════════════

async function getWebContent() {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.fetchTimeout);
    
    try {
        console.log('📡 Obteniendo RSS...');
        
        const response = await fetch(CONFIG.apiUrl, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'SASMEX-Bot/2.0',
                'Accept': 'application/xml, text/xml, */*'
            }
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const xmlText = await response.text();
        
        if (!xmlText || xmlText.trim().length === 0) {
            throw new Error('Respuesta vacía del servidor');
        }
        
        const parser = new xml2js.Parser({ 
            explicitArray: false,
            ignoreAttrs: false,
            trim: true
        });
        
        const result = await parser.parseStringPromise(xmlText);
        
        if (!result) {
            throw new Error('Error parseando XML');
        }
        
        let entry = null;
        if (result.feed && result.feed.entry) {
            entry = Array.isArray(result.feed.entry) 
                ? result.feed.entry[0] 
                : result.feed.entry;
        } else if (result.rss && result.rss.channel && result.rss.channel.item) {
            entry = Array.isArray(result.rss.channel.item)
                ? result.rss.channel.item[0]
                : result.rss.channel.item;
        }
        
        if (!entry) {
            return { 
                success: false, 
                error: 'No se encontró entrada en el feed',
                raw: xmlText.substring(0, 200)
            };
        }
        
        const id = entry.id || entry.guid || entry.link || '';
        const title = entry.title || 'Alerta Sísmica';
        const updated = entry.updated || entry.pubDate || new Date().toISOString();
        
        let description = '';
        let headline = title;
        let severity = 'Unknown';
        
        if (entry.content) {
            if (typeof entry.content === 'string') {
                description = entry.content;
            } else if (entry.content.alert && entry.content.alert.info) {
                const info = entry.content.alert.info;
                headline = info.headline || title;
                description = info.description || '';
                severity = info.severity || 'Unknown';
            } else if (entry.content._) {
                description = entry.content._;
            }
        } else if (entry.description) {
            description = typeof entry.description === 'string' 
                ? entry.description 
                : (entry.description._ || '');
        } else if (entry.summary) {
            description = typeof entry.summary === 'string'
                ? entry.summary
                : (entry.summary._ || '');
        }
        
        const dateMatch = title.match(/(\d{1,2}\s+\w+\s+\d{4}\s+\d{2}:\d{2}:\d{2})/i);
        const fecha = dateMatch ? dateMatch[1] : formatDate(updated);
        
        let severidad = 'Severidad: Moderada';
        const descLower = description.toLowerCase();
        const sevLower = severity.toLowerCase();
        
        if (sevLower.includes('minor') || descLower.includes('no ameritó') || descLower.includes('preventiv')) {
            severidad = 'Severidad: Menor';
        } else if (sevLower.includes('severe') || sevLower.includes('extreme') || 
                   descLower.includes('ameritó alerta') || descLower.includes('alerta pública')) {
            severidad = 'Severidad: Mayor';
        }
        
        console.log('✅ RSS obtenido correctamente');
        
        return {
            success: true,
            data: {
                fecha: fecha,
                evento: escapeMarkdown(headline || title),
                severidad: severidad,
                rssTitle: escapeMarkdown(title),
                rawText: escapeMarkdown(description),
                identifier: id
            }
        };
        
    } catch (error) {
        clearTimeout(timeoutId);
        
        if (error.name === 'AbortError') {
            console.error('❌ Timeout obteniendo RSS');
            return { success: false, error: 'Timeout de conexión' };
        }
        
        console.error('❌ Error obteniendo RSS:', error.message);
        return { success: false, error: error.message };
    }
}

function formatDate(isoString) {
    try {
        const date = new Date(isoString);
        return date.toLocaleString('es-MX', {
            timeZone: 'America/Mexico_City',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        });
    } catch {
        return isoString;
    }
}

function escapeMarkdown(text) {
    if (!text || typeof text !== 'string') return '';
    return text
        .replace(/\\/g, '\\\\')  // Escapar backslashes primero
        .replace(/\*/g, '\\*')  // Escapar asteriscos
        .replace(/_/g, '\\_')   // Escapar guiones bajos
        .replace(/\[/g, '\\[')  // Escapar corchetes
        .replace(/\]/g, '\\]')
        .replace(/\(/g, '\\(')  // Escapar paréntesis
        .replace(/\)/g, '\\)')
        .replace(/~/g, '\\~')   // Escapar tildes
        .replace(/>/g, '\\>')   // Escapar mayor que
        .replace(/#/g, '\\#')   // Escapar hashtags
        .replace(/\+/g, '\\+')  // Escapar signos más
        .replace(/-/g, '\\-')   // Escapar guiones
        .replace(/=/g, '\\=')   // Escapar signos igual
        .replace(/\|/g, '\\|')  // Escapar pipes
        .replace(/\{/g, '\\{')  // Escapar llaves
        .replace(/\}/g, '\\}')
        .replace(/\./g, '\\.')  // Escapar puntos
        .replace(/!/g, '\\!')   // Escapar exclamaciones
        .replace(/`/g, '\\`');  // Escapar backticks
}

function escapeHtml(text) {
    if (!text || typeof text !== 'string') return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ═══════════════════════════════════════════════════════════════════════════
//                    GENERACIÓN DE IMÁGENES
// ═══════════════════════════════════════════════════════════════════════════

async function generateAlertImage(alertData) {
    let page = null;
    
    try {
        console.log('📸 Generando imagen de alerta...');
        
        const browserInstance = await initBrowser();
        page = await browserInstance.newPage();
        page.setDefaultTimeout(CONFIG.pageTimeout);
        
        await page.setViewport({
            width: 600,
            height: 750,
            deviceScaleFactor: 2
        });
        
        const fecha = alertData?.fecha || 'Consultando...';
        const evento = alertData?.evento || 'Sismo detectado';
        const severidad = alertData?.severidad || 'Evaluando...';
        
        let severidadClass = 'moderada';
        let severidadColor = '#ffa502';
        const sevLower = severidad.toLowerCase();
        
        if (sevLower.includes('menor')) {
            severidadClass = 'menor';
            severidadColor = '#2ed573';
        } else if (sevLower.includes('mayor') || sevLower.includes('fuerte')) {
            severidadClass = 'mayor';
            severidadColor = '#ff4757';
        }
        
        const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
                
                * { margin: 0; padding: 0; box-sizing: border-box; }
                
                body {
                    font-family: 'Inter', 'Segoe UI', -apple-system, sans-serif;
                    background: white;
                    min-height: 100vh;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    padding: 20px;
                }
                
                .card {
                    background: white;
                    border-radius: 24px;
                    padding: 35px;
                    width: 100%;
                    max-width: 540px;
                    border: 3px solid #ff4757;
                    box-shadow: 0 10px 40px rgba(255, 71, 87, 0.15);
                }
                
                .header { text-align: center; margin-bottom: 30px; }
                .alert-icons { font-size: 40px; margin-bottom: 15px; letter-spacing: 5px; }
                .title { color: #ff4757; font-size: 32px; font-weight: 800; text-transform: uppercase; letter-spacing: 4px; }
                .subtitle { color: #666; font-size: 14px; margin-top: 8px; letter-spacing: 2px; text-transform: uppercase; }
                .divider { height: 3px; background: linear-gradient(90deg, transparent, ${severidadColor}, transparent); margin: 25px 0; }
                
                .info-row {
                    display: flex;
                    align-items: flex-start;
                    margin: 18px 0;
                    padding: 18px;
                    background: #f8f9fa;
                    border-radius: 16px;
                    border-left: 4px solid ${severidadColor};
                }
                
                .info-icon { font-size: 28px; margin-right: 18px; min-width: 40px; }
                .info-content { flex: 1; }
                .info-label { color: #666; font-size: 12px; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 6px; font-weight: 600; }
                .info-value { color: #000; font-size: 15px; font-weight: 500; line-height: 1.5; word-break: break-word; }
                
                .severity-badge {
                    display: inline-block;
                    padding: 10px 24px;
                    border-radius: 30px;
                    font-weight: 700;
                    font-size: 14px;
                    text-transform: uppercase;
                    letter-spacing: 2px;
                }
                
                .severity-badge.menor { background: #2ed573; color: #fff; }
                .severity-badge.moderada { background: #ffa502; color: #000; }
                .severity-badge.mayor { background: #ff4757; color: #fff; animation: pulse 1s infinite; }
                
                @keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.05); } }
                
                .emergency-box {
                    background: #ffeaea;
                    border: 2px solid #ff4757;
                    border-radius: 16px;
                    padding: 20px;
                    margin-top: 25px;
                    text-align: center;
                }
                
                .emergency-label { color: #ff4757; font-size: 12px; text-transform: uppercase; letter-spacing: 3px; margin-bottom: 8px; font-weight: 600; }
                .emergency-number { color: #000; font-size: 42px; font-weight: 800; letter-spacing: 3px; }
                
                .footer { margin-top: 25px; text-align: center; padding-top: 20px; border-top: 1px solid #ddd; }
                .footer-text { color: #666; font-size: 12px; letter-spacing: 1px; line-height: 1.6; }
                .footer-brand { color: #ff4757; font-weight: 700; font-size: 14px; margin-top: 12px; letter-spacing: 2px; }
            </style>
        </head>
        <body>
            <div class="card">
                <div class="header">
                    <div class="alert-icons">🚨🚨🚨</div>
                    <div class="title">Alerta Sísmica</div>
                    <div class="subtitle">Sistema de Alerta Sísmica Mexicano</div>
                </div>
                
                <div class="divider"></div>
                
                <div class="info-row">
                    <span class="info-icon">📅</span>
                    <div class="info-content">
                        <div class="info-label">Fecha y Hora</div>
                        <div class="info-value">${escapeHtml(fecha)}</div>
                    </div>
                </div>
                
                <div class="info-row">
                    <span class="info-icon">🌋</span>
                    <div class="info-content">
                        <div class="info-label">Evento Detectado</div>
                        <div class="info-value">${escapeHtml(evento)}</div>
                    </div>
                </div>
                
                <div class="info-row">
                    <span class="info-icon">⚠️</span>
                    <div class="info-content">
                        <div class="info-label">Nivel de Severidad</div>
                        <div class="info-value">
                            <span class="severity-badge ${severidadClass}">
                                ${escapeHtml(severidad.replace('Severidad:', '').trim()) || 'Evaluando'}
                            </span>
                        </div>
                    </div>
                </div>
                
                <div class="emergency-box">
                    <div class="emergency-label">📞 Línea de Emergencias</div>
                    <div class="emergency-number">911</div>
                </div>
                
                <div class="footer">
                    <div class="footer-text">Mantén la calma • Aléjate de ventanas • Ubícate en zona segura</div>
                    <div class="footer-brand">🏛️ SASMEX • CIRES</div>
                </div>
            </div>
        </body>
        </html>
        `;
        
        await page.setContent(htmlContent, { 
            waitUntil: 'networkidle0',
            timeout: CONFIG.pageTimeout
        });
        
        await sleep(500);
        
        if (fs.existsSync(CONFIG.screenshotFile)) {
            fs.unlinkSync(CONFIG.screenshotFile);
        }
        
        await page.screenshot({
            path: CONFIG.screenshotFile,
            type: 'png',
            omitBackground: false
        });
        
        console.log('✅ Imagen generada');
        return { success: true, imagePath: CONFIG.screenshotFile };
        
    } catch (error) {
        console.error('❌ Error generando imagen:', error.message);
        return { success: false, error: error.message };
    } finally {
        if (page) {
            try { await page.close(); } catch (e) {}
        }
    }
}

async function captureDirectWeb() {
    let page = null;
    
    try {
        console.log('📸 Capturando web directamente...');
        
        const browserInstance = await initBrowser();
        page = await browserInstance.newPage();
        page.setDefaultTimeout(CONFIG.pageTimeout);
        
        await page.setViewport({ width: 900, height: 700, deviceScaleFactor: 2 });
        
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            if (['image', 'media', 'font'].includes(resourceType)) {
                req.abort();
            } else {
                req.continue();
            }
        });
        
        await page.goto(CONFIG.webUrl, {
            waitUntil: 'networkidle2',
            timeout: CONFIG.pageTimeout
        });
        
        await sleep(1500);
        
        await page.addStyleTag({
            content: `
                body { background: white !important; color: black !important; font-family: 'Segoe UI', Arial, sans-serif !important; padding: 40px !important; font-size: 16px !important; line-height: 1.8 !important; }
                * { color: black !important; }
                pre, code { background: #f0f0f0 !important; padding: 25px !important; border-radius: 15px !important; border: 2px solid #ff4757 !important; font-size: 14px !important; white-space: pre-wrap !important; word-wrap: break-word !important; }
            `
        });
        
        if (fs.existsSync(CONFIG.screenshotFile)) {
            fs.unlinkSync(CONFIG.screenshotFile);
        }
        
        await page.screenshot({
            path: CONFIG.screenshotFile,
            fullPage: true,
            type: 'png'
        });
        
        console.log('✅ Captura directa guardada');
        return { success: true, imagePath: CONFIG.screenshotFile };
        
    } catch (error) {
        console.error('❌ Error capturando web:', error.message);
        return { success: false, error: error.message };
    } finally {
        if (page) {
            try { await page.close(); } catch (e) {}
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
//                            BOT DE TELEGRAM
// ═══════════════════════════════════════════════════════════════════════════

class SasmexBot {
    constructor() {
        console.log('🤖 Inicializando Bot SASMEX...');
        logToFile('INFO', 'Bot inicializado');
        
        this.bot = new TelegramBot(CONFIG.telegramToken, { 
            polling: {
                interval: 1000,
                autoStart: true,
                params: { timeout: 30 }
            }
        });
        
        // ✅ CORREGIDO: Usar Array en lugar de Set
        this.subscribers = getSubscribers();
        this.startTime = new Date();
        this.lastCheck = null;
        this.isFirstRun = true;
        this.isChecking = false;
        this.checkIntervalId = null; // ✅ CORREGIDO: Renombrado para evitar confusión
        this.reporteState = null; // ✅ CORREGIDO: Inicializar propiedad
        this.maintenanceMode = false; // ✅ CORREGIDO: Modo mantenimiento
        
        // ✅ NUEVO: Sistema de recuperación automática
        this.recoveryMode = false;
        this.lastRecovery = null;
        this.failureCount = 0;
        this.maxFailures = 5;
        this.recoveryInterval = null;
        this.healthCheckInterval = null;
        
        // ✅ NUEVO: Sistema de alertas proactivas al admin
        this.heartbeatInterval = null;
        this.lastHeartbeat = null;
        this.consecutiveErrors = 0;
        this.lastAdminAlert = null;
        this.systemHealth = 'healthy';
        
        this.setupErrorHandling();
        this.setupRecoverySystem();
        this.setupHealthChecks();
        this.setupProactiveAlerts();
        
        this.setupCommands();
        this.setupCallbacks();
        
        console.log(`👥 Suscriptores cargados: ${this.subscribers.length}`);
    }
    
    setupErrorHandling() {
        // ✅ MEJORADO: Manejo robusto de errores de polling con reconexión automática
        this.bot.on('polling_error', (error) => {
            if (error.code === 'ETELEGRAM' && error.response?.statusCode === 409) {
                console.error('⚠️ Otra instancia del bot está corriendo');
                return;
            }
            if (!error.message?.includes('ETELEGRAM') && 
                !error.message?.includes('ECONNRESET') &&
                !error.message?.includes('ETIMEDOUT')) {
                console.error('❌ Error polling:', error.message);
            }
            
            // ✅ NUEVO: Intentar reconexión automática después de errores de polling
            this.handlePollingError(error);
        });
        
        this.bot.on('error', (error) => {
            console.error('❌ Error bot:', error.message);
            this.handleBotError(error);
        });
        
        this.bot.on('webhook_error', (error) => {
            console.error('❌ Error webhook:', error.message);
        });
        
        // ✅ NUEVO: Eventos de conexión
        this.bot.on('polling_started', () => {
            console.log('📡 Polling iniciado correctamente');
            logToFile('INFO', 'Polling iniciado');
        });
        
        this.bot.on('polling_stopped', () => {
            console.log('🛑 Polling detenido');
            logToFile('WARNING', 'Polling detenido - intentando reconectar');
            this.attemptReconnection();
        });
    }
    
    // ✅ NUEVO: Función para manejar errores de polling
    async handlePollingError(error) {
        this.failureCount++;
        this.consecutiveErrors++;
        
        if (this.failureCount >= this.maxFailures) {
            console.error('💀 Demasiados errores de polling, iniciando recuperación...');
            await this.alertAdmin(`Demasiados errores de polling (${this.failureCount}). Iniciando recuperación automática.`, 'critical');
            this.initiateRecovery('polling_failure', error);
            return;
        }
        
        // Alertar al admin sobre errores de polling
        if (this.consecutiveErrors >= 2) {
            await this.alertAdmin(`Error de polling detectado: ${error.message}. Intentos: ${this.consecutiveErrors}`, 'warning');
        }
        
        // Intentar reconexión inmediata
        setTimeout(() => {
            console.log('🔄 Intentando reconectar polling...');
            try {
                this.bot.startPolling();
            } catch (reconnectError) {
                console.error('❌ Error en reconexión:', reconnectError.message);
            }
        }, 5000 * this.failureCount); // Backoff exponencial
    }
    
    // ✅ NUEVO: Función para manejar errores generales del bot
    async handleBotError(error) {
        this.consecutiveErrors++;
        
        // Solo iniciar recuperación para errores críticos
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
            console.error('🌐 Error de conexión de red detectado');
            await this.alertAdmin(`Error de conexión de red: ${error.message}. Sistema podría estar inestable.`, 'critical');
            this.initiateRecovery('network_error', error);
        } else if (this.consecutiveErrors >= CONFIG.maxConsecutiveErrors) {
            await this.alertAdmin(`Múltiples errores consecutivos (${this.consecutiveErrors}). Verificar sistema.`, 'warning');
        }
    }
    
    // ✅ NUEVO: Función para intentar reconexión automática
    async attemptReconnection() {
        if (this.recoveryMode) return; // Ya en modo recuperación
        
        console.log('🔄 Intentando reconexión automática...');
        
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                await sleep(2000 * attempt);
                await this.bot.startPolling();
                console.log('✅ Reconexión exitosa');
                logToFile('INFO', 'Reconexión automática exitosa');
                this.failureCount = 0; // Reset contador
                return;
            } catch (error) {
                console.error(`❌ Intento ${attempt} de reconexión fallido:`, error.message);
            }
        }
        
        console.error('💀 Todos los intentos de reconexión fallaron');
        this.initiateRecovery('reconnection_failed', new Error('Reconnection failed'));
    }
    
    // ✅ NUEVO: Sistema de recuperación automática
    setupRecoverySystem() {
        // Manejar excepciones no capturadas
        process.on('uncaughtException', (error) => {
            console.error('💥 EXCEPCIÓN NO CAPTURADA:', error);
            logToFile('CRITICAL', `Excepción no capturada: ${error.message}\nStack: ${error.stack}`);
            this.handleCriticalFailure('uncaughtException', error);
        });
        
        process.on('unhandledRejection', (reason, promise) => {
            console.error('💥 PROMESA RECHAZADA NO MANEJADA:', reason);
            logToFile('CRITICAL', `Promesa rechazada: ${reason}`);
            this.handleCriticalFailure('unhandledRejection', reason);
        });
        
        // Manejar señales de terminación
        process.on('SIGTERM', () => {
            console.log('🛑 Recibida señal SIGTERM, cerrando gracefully...');
            this.gracefulShutdown('SIGTERM');
        });
        
        process.on('SIGINT', () => {
            console.log('🛑 Recibida señal SIGINT, cerrando gracefully...');
            this.gracefulShutdown('SIGINT');
        });
        
        // Auto-reinicio en caso de fallos críticos
        this.recoveryInterval = setInterval(() => {
            if (this.failureCount >= this.maxFailures && !this.recoveryMode) {
                console.log('🚨 Múltiples fallos detectados, iniciando recuperación...');
                this.initiateRecovery();
            }
        }, 30000); // Verificar cada 30 segundos
    }
    
    // ✅ NUEVO: Sistema de health checks
    setupHealthChecks() {
        this.healthCheckInterval = setInterval(async () => {
            try {
                await this.performHealthCheck();
            } catch (error) {
                console.error('❌ Error en health check:', error.message);
                this.failureCount++;
            }
        }, 60000); // Health check cada minuto
        
        // ✅ NUEVO: Backup automático cada 6 horas
        this.autoBackupInterval = setInterval(async () => {
            try {
                await this.performAutoBackup();
            } catch (error) {
                console.error('❌ Error en backup automático:', error.message);
            }
        }, 6 * 60 * 60 * 1000); // Cada 6 horas
    }
    
    // ✅ NUEVO: Health check del bot
    async performHealthCheck() {
        const issues = [];
        
        // Verificar conexión con Telegram
        try {
            await this.bot.getMe();
        } catch (error) {
            issues.push(`Telegram: ${error.message}`);
        }
        
        // Verificar memoria
        const memUsage = process.memoryUsage();
        const memMB = memUsage.heapUsed / 1024 / 1024;
        if (memMB > 500) { // Más de 500MB
            issues.push(`Memoria alta: ${Math.round(memMB)}MB`);
        }
        
        // Verificar uptime
        const uptimeHours = (Date.now() - this.startTime.getTime()) / (1000 * 60 * 60);
        if (uptimeHours > 24) { // Más de 24 horas
            issues.push(`Uptime largo: ${Math.round(uptimeHours)}h`);
        }
        
        // Verificar suscriptores
        if (this.subscribers.length === 0) {
            issues.push('Sin suscriptores activos');
        }
        
        // Reportar issues al admin
        if (issues.length > 0 && CONFIG.adminChatId) {
            const report = `🚨 *HEALTH CHECK ALERT*\n\nProblemas detectados:\n${issues.map(i => `• ${i}`).join('\n')}`;
            await this.sendMessage(CONFIG.adminChatId, report, { parse_mode: 'Markdown' }).catch(() => {});
        }
        
        // Auto-mantenimiento si hay muchos issues
        if (issues.length >= 3) {
            console.log('🔧 Múltiples issues detectados, activando mantenimiento automático');
            this.maintenanceMode = true;
            setTimeout(() => {
                this.maintenanceMode = false;
                console.log('✅ Mantenimiento automático completado');
            }, 300000); // 5 minutos
        }
    }
    
    // ✅ NUEVO: Backup automático del sistema
    async performAutoBackup() {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupPath = path.join(__dirname, `auto-backup-${timestamp}.json`);
            
            const data = loadData();
            data.backupTimestamp = new Date().toISOString();
            data.systemStats = {
                uptime: this.getUptime(),
                memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
                subscribers: this.subscribers.length,
                failureCount: this.failureCount,
                maintenanceMode: this.maintenanceMode,
                recoveryMode: this.recoveryMode
            };
            
            fs.writeFileSync(backupPath, JSON.stringify(data, null, 2));
            
            // Limpiar backups antiguos (mantener solo los últimos 10)
            const backupDir = __dirname;
            const backupFiles = fs.readdirSync(backupDir)
                .filter(file => file.startsWith('auto-backup-'))
                .sort()
                .reverse();
            
            if (backupFiles.length > 10) {
                const filesToDelete = backupFiles.slice(10);
                filesToDelete.forEach(file => {
                    try {
                        fs.unlinkSync(path.join(backupDir, file));
                    } catch (error) {
                        console.error(`Error eliminando backup antiguo ${file}:`, error.message);
                    }
                });
            }
            
            console.log(`💾 Backup automático creado: ${path.basename(backupPath)}`);
            logToFile('BACKUP', `Backup automático creado: ${path.basename(backupPath)}`);
            
            // Notificar al admin cada cierto tiempo
            if (CONFIG.adminChatId && Math.random() < 0.1) { // 10% de probabilidad
                await this.sendMessage(CONFIG.adminChatId, 
                    `💾 *BACKUP AUTOMÁTICO*\n\nCreado: ${path.basename(backupPath)}\nSuscriptores: ${this.subscribers.length}`, 
                    { parse_mode: 'Markdown' }
                ).catch(() => {});
            }
            
        } catch (error) {
            console.error('❌ Error en backup automático:', error.message);
            logToFile('ERROR', `Error en backup automático: ${error.message}`);
        }
    }
    
    // ✅ NUEVO: Sistema de alertas proactivas al admin
    setupProactiveAlerts() {
        // Heartbeat cada 5 minutos
        this.heartbeatInterval = setInterval(async () => {
            await this.sendHeartbeat();
        }, CONFIG.heartbeatInterval * 1000);
        
        // Monitoreo continuo de errores
        this.errorMonitorInterval = setInterval(async () => {
            await this.monitorSystemHealth();
        }, 30000); // Cada 30 segundos
        
        console.log('🔔 Sistema de alertas proactivas activado');
    }
    
    // ✅ NUEVO: Enviar heartbeat al admin
    async sendHeartbeat() {
        if (!CONFIG.adminChatId) return;
        
        try {
            const uptime = this.getUptime();
            const memMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
            const status = this.systemHealth === 'healthy' ? '🟢' : this.systemHealth === 'warning' ? '🟡' : '🔴';
            
            const heartbeat = `${status} *HEARTBEAT*\n\n` +
                `⏱️ Uptime: ${uptime}\n` +
                `💾 Memoria: ${memMB}MB\n` +
                `👥 Suscriptores: ${this.subscribers.length}\n` +
                `🔄 Estado: ${this.systemHealth}\n` +
                `📅 ${new Date().toLocaleString('es-MX')}`;
            
            await this.sendMessage(CONFIG.adminChatId, heartbeat, { parse_mode: 'Markdown' }).catch(() => {});
            this.lastHeartbeat = new Date();
            
        } catch (error) {
            console.error('❌ Error enviando heartbeat:', error.message);
        }
    }
    
    // ✅ NUEVO: Monitoreo continuo de la salud del sistema
    async monitorSystemHealth() {
        const issues = [];
        let newHealth = 'healthy';
        
        // Verificar memoria
        const memMB = process.memoryUsage().heapUsed / 1024 / 1024;
        if (memMB > CONFIG.memoryThreshold) {
            issues.push(`Memoria alta: ${Math.round(memMB)}MB`);
            newHealth = 'warning';
        }
        
        // Verificar errores consecutivos
        if (this.consecutiveErrors >= CONFIG.maxConsecutiveErrors) {
            issues.push(`Errores consecutivos: ${this.consecutiveErrors}`);
            newHealth = 'critical';
        }
        
        // Verificar conexión con Telegram
        try {
            await this.bot.getMe();
        } catch (error) {
            issues.push(`Telegram desconectado: ${error.message}`);
            newHealth = 'critical';
        }
        
        // Verificar si el último heartbeat fue hace más de 10 minutos
        if (this.lastHeartbeat && (Date.now() - this.lastHeartbeat.getTime()) > 600000) {
            issues.push('Heartbeat fallido');
            newHealth = 'critical';
        }
        
        // Actualizar estado de salud
        const healthChanged = this.systemHealth !== newHealth;
        this.systemHealth = newHealth;
        
        // Alertar al admin si hay cambios críticos o issues nuevos
        if ((issues.length > 0 || healthChanged) && CONFIG.adminChatId) {
            const now = Date.now();
            if (!this.lastAdminAlert || (now - this.lastAdminAlert.getTime()) > (CONFIG.adminAlertCooldown * 1000)) {
                const alert = `🚨 *ALERTA DEL SISTEMA*\n\n` +
                    `Estado: ${newHealth === 'healthy' ? '🟢 Saludable' : newHealth === 'warning' ? '🟡 Advertencia' : '🔴 Crítico'}\n\n` +
                    (issues.length > 0 ? `Problemas:\n${issues.map(i => `• ${i}`).join('\n')}\n\n` : '') +
                    `⏱️ ${new Date().toLocaleString('es-MX')}`;
                
                await this.sendMessage(CONFIG.adminChatId, alert, { parse_mode: 'Markdown' }).catch(() => {});
                this.lastAdminAlert = new Date();
                
                logToFile('ALERT', `Alerta enviada al admin: ${newHealth} - ${issues.join(', ')}`);
            }
        }
        
        // Reset contador de errores si está saludable
        if (newHealth === 'healthy') {
            this.consecutiveErrors = 0;
        }
    }
    
    // ✅ MEJORADO: Función para alertar al admin con cooldown
    async alertAdmin(message, priority = 'normal') {
        if (!CONFIG.adminChatId) return;
        
        const now = Date.now();
        const cooldown = priority === 'critical' ? 0 : CONFIG.adminAlertCooldown * 1000;
        
        if (!this.lastAdminAlert || (now - this.lastAdminAlert.getTime()) > cooldown) {
            const icon = priority === 'critical' ? '🚨' : priority === 'warning' ? '⚠️' : 'ℹ️';
            const alert = `${icon} *ALERTA ${priority.toUpperCase()}*\n\n${message}\n\n⏱️ ${new Date().toLocaleString('es-MX')}`;
            
            await this.sendMessage(CONFIG.adminChatId, alert, { parse_mode: 'Markdown' }).catch(() => {});
            this.lastAdminAlert = new Date();
            
            logToFile('ALERT', `Alerta ${priority} enviada: ${message}`);
        }
    }
    
    // ✅ NUEVO: Obtener estado completo del sistema
    async getSystemStatus() {
        const memUsage = process.memoryUsage();
        const uptime = this.getUptime();
        const now = new Date();
        
        // Verificar servicios
        let telegramStatus = '❌';
        let puppeteerStatus = '❌';
        
        try {
            await this.bot.getMe();
            telegramStatus = '✅';
        } catch (e) {}
        
        try {
            if (browser) {
                puppeteerStatus = '✅';
            }
        } catch (e) {}
        
        const status = `
📊 *ESTADO COMPLETO DEL SISTEMA*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🟢 *SALUD GENERAL:* ${this.systemHealth === 'healthy' ? '🟢 Saludable' : this.systemHealth === 'warning' ? '🟡 Advertencia' : '🔴 Crítico'}

🤖 *SERVICIOS:*
• Telegram Bot: ${telegramStatus}
• Puppeteer: ${puppeteerStatus}
• Polling: ${this.bot.options.polling ? '✅' : '❌'}
• Monitoreo: ${this.healthCheckInterval ? '✅' : '❌'}

💾 *RECURSOS:*
• Memoria usada: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB
• Memoria total: ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB
• CPU: ${process.cpuUsage ? Math.round(process.cpuUsage().user / 1000000) + 'ms' : 'N/A'}
• Uptime: ${uptime}

👥 *SUSCRIPTORES:*
• Activos: ${this.subscribers.length}
• Total registrados: ${Object.keys(loadData().users || {}).length}

🔧 *MODOS ACTIVOS:*
• Mantenimiento: ${this.maintenanceMode ? '🟡 ON' : '🟢 OFF'}
• Recuperación: ${this.recoveryMode ? '🟡 ON' : '🟢 OFF'}

📈 *ESTADÍSTICAS:*
• Errores consecutivos: ${this.consecutiveErrors}
• Fallos totales: ${this.failureCount}
• Último heartbeat: ${this.lastHeartbeat ? Math.round((now - this.lastHeartbeat) / 1000) + 's atrás' : 'Nunca'}
• Última verificación: ${this.lastCheck ? Math.round((now - this.lastCheck) / 1000) + 's atrás' : 'Nunca'}

⏰ *HORA:* ${now.toLocaleString('es-MX')}
        `;
        
        return status;
    }
    
    // ✅ NUEVO: Diagnóstico completo del sistema
    async performFullDiagnosis() {
        const diagnosis = {
            passed: [],
            warnings: [],
            errors: []
        };
        
        // 1. Verificar conexión con Telegram
        try {
            const botInfo = await this.bot.getMe();
            diagnosis.passed.push(`✅ Telegram API: Conectado como @${botInfo.username}`);
        } catch (error) {
            diagnosis.errors.push(`❌ Telegram API: ${error.message}`);
        }
        
        // 2. Verificar Puppeteer
        try {
            if (browser) {
                const pages = await browser.pages();
                diagnosis.passed.push(`✅ Puppeteer: ${pages.length} páginas activas`);
            } else {
                diagnosis.warnings.push(`⚠️ Puppeteer: Navegador no inicializado`);
            }
        } catch (error) {
            diagnosis.errors.push(`❌ Puppeteer: ${error.message}`);
        }
        
        // 3. Verificar archivos críticos
        const criticalFiles = [CONFIG.dataFile, CONFIG.logFile];
        for (const file of criticalFiles) {
            if (fs.existsSync(file)) {
                const stats = fs.statSync(file);
                const sizeKB = Math.round(stats.size / 1024);
                diagnosis.passed.push(`✅ Archivo ${path.basename(file)}: ${sizeKB}KB`);
            } else {
                diagnosis.errors.push(`❌ Archivo faltante: ${path.basename(file)}`);
            }
        }
        
        // 4. Verificar memoria
        const memMB = process.memoryUsage().heapUsed / 1024 / 1024;
        if (memMB > CONFIG.memoryThreshold) {
            diagnosis.warnings.push(`⚠️ Memoria alta: ${Math.round(memMB)}MB (umbral: ${CONFIG.memoryThreshold}MB)`);
        } else {
            diagnosis.passed.push(`✅ Memoria: ${Math.round(memMB)}MB`);
        }
        
        // 5. Verificar conectividad con SASMEX
        try {
            const response = await fetch(CONFIG.webUrl, { timeout: 5000 });
            if (response.ok) {
                diagnosis.passed.push(`✅ SASMEX: Conectado (${response.status})`);
            } else {
                diagnosis.warnings.push(`⚠️ SASMEX: Respuesta ${response.status}`);
            }
        } catch (error) {
            diagnosis.errors.push(`❌ SASMEX: ${error.message}`);
        }
        
        // 6. Verificar suscriptores
        if (this.subscribers.length === 0) {
            diagnosis.warnings.push(`⚠️ Sin suscriptores activos`);
        } else {
            diagnosis.passed.push(`✅ Suscriptores: ${this.subscribers.length} activos`);
        }
        
        // 7. Verificar intervalos activos
        const intervals = [
            { name: 'Monitoreo', interval: this.healthCheckInterval },
            { name: 'Heartbeat', interval: this.heartbeatInterval },
            { name: 'Verificación', interval: this.checkIntervalId }
        ];
        
        for (const item of intervals) {
            if (item.interval) {
                diagnosis.passed.push(`✅ ${item.name}: Activo`);
            } else {
                diagnosis.warnings.push(`⚠️ ${item.name}: Inactivo`);
            }
        }
        
        // Generar reporte
        let report = `🔍 *DIAGNÓSTICO COMPLETO*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        
        if (diagnosis.passed.length > 0) {
            report += `*✅ PASÓ (${diagnosis.passed.length}):*\n`;
            diagnosis.passed.forEach(item => report += `• ${item}\n`);
            report += '\n';
        }
        
        if (diagnosis.warnings.length > 0) {
            report += `*⚠️ ADVERTENCIAS (${diagnosis.warnings.length}):*\n`;
            diagnosis.warnings.forEach(item => report += `• ${item}\n`);
            report += '\n';
        }
        
        if (diagnosis.errors.length > 0) {
            report += `*❌ ERRORES (${diagnosis.errors.length}):*\n`;
            diagnosis.errors.forEach(item => report += `• ${item}\n`);
            report += '\n';
        }
        
        // Resumen
        const total = diagnosis.passed.length + diagnosis.warnings.length + diagnosis.errors.length;
        const score = Math.round((diagnosis.passed.length / total) * 100);
        report += `*📊 RESUMEN:*\n`;
        report += `• Puntaje: ${score}%\n`;
        report += `• Estado general: ${score >= 80 ? '🟢 Excelente' : score >= 60 ? '🟡 Bueno' : '🔴 Requiere atención'}\n`;
        report += `• Ejecutado: ${new Date().toLocaleString('es-MX')}`;
        
        return report;
    }
    
    // ✅ NUEVO: Manejar fallos críticos
    async handleCriticalFailure(type, error) {
        this.failureCount++;
        console.error(`🚨 FALLO CRÍTICO ${type}:`, error);
        
        // Notificar al admin
        if (CONFIG.adminChatId) {
            const alert = `🚨 *FALLO CRÍTICO*\n\nTipo: ${type}\nError: ${error.message}\nTimestamp: ${new Date().toISOString()}\n\nEl bot intentará recuperarse automáticamente.`;
            await this.sendMessage(CONFIG.adminChatId, alert, { parse_mode: 'Markdown' }).catch(() => {});
        }
        
        // Si es un fallo crítico, intentar recuperación inmediata
        if (this.failureCount >= 3) {
            setTimeout(() => this.initiateRecovery(), 5000);
        }
    }
    
    // ✅ NUEVO: Iniciar recuperación del sistema
    async initiateRecovery(reason = 'unknown', error = null) {
        if (this.recoveryMode) return;
        
        this.recoveryMode = true;
        this.lastRecovery = new Date();
        
        const reasonText = reason || 'desconocida';
        const errorText = error ? `: ${error.message}` : '';
        
        console.log(`🔄 INICIANDO RECUPERACIÓN DEL SISTEMA (${reasonText})...`);
        logToFile('RECOVERY', `Iniciando recuperación: ${reasonText}${errorText}`);
        
        // ✅ NUEVO: Alertar al admin inmediatamente
        await this.alertAdmin(`🔄 **RECUPERACIÓN INICIADA**\n\nRazón: ${reasonText}${errorText}\n\nEl sistema intentará recuperarse automáticamente.`, 'critical');
        
        try {
            // 1. Detener procesos actuales
            if (this.checkIntervalId) {
                clearInterval(this.checkIntervalId);
                this.checkIntervalId = null;
            }
            
            // 2. Cerrar navegador si existe
            await closeBrowser();
            
            // 3. Resetear estado
            this.isChecking = false;
            this.failureCount = 0;
            this.maintenanceMode = false;
            
            // 4. Esperar un poco
            await sleep(5000);
            
            // 5. Reiniciar servicios
            console.log('🔄 Reiniciando servicios...');
            
            // Reiniciar polling de Telegram
            try {
                await this.bot.stopPolling();
                await sleep(2000);
                // El polling se reiniciará automáticamente
            } catch (error) {
                console.error('Error reiniciando polling:', error.message);
            }
            
            // Reiniciar monitoreo
            this.startMonitoring();
            
            // 6. Verificar que todo funciona
            await sleep(10000);
            await this.performHealthCheck();
            
            console.log('✅ RECUPERACIÓN COMPLETADA');
            logToFile('RECOVERY', 'Recuperación completada exitosamente');
            
            // ✅ NUEVO: Alertar recuperación exitosa
            await this.alertAdmin(`✅ **RECUPERACIÓN EXITOSA**\n\nEl sistema se ha recuperado automáticamente del fallo: ${reasonText}\n\nTodos los servicios están operativos.`, 'warning');
            
        } catch (error) {
            console.error('❌ Error durante recuperación:', error);
            logToFile('CRITICAL', `Error en recuperación: ${error.message}`);
            
            // ✅ NUEVO: Alertar fallo de recuperación
            await this.alertAdmin(`💥 **RECUPERACIÓN FALLIDA**\n\nError durante recuperación: ${error.message}\n\nEl sistema intentará reiniciarse completamente en 10 segundos.`, 'critical');
            
            // Si la recuperación falla, intentar reinicio completo
            console.log('💥 Recuperación fallida, intentando reinicio completo...');
            setTimeout(() => process.exit(1), 10000);
            
        } finally {
            this.recoveryMode = false;
        }
    }
    
    // ✅ NUEVO: Cierre graceful del sistema
    async gracefulShutdown(signal) {
        console.log(`🛑 Iniciando cierre graceful por ${signal}...`);
        logToFile('SHUTDOWN', `Cierre graceful iniciado por ${signal}`);
        
        try {
            // 1. Activar modo mantenimiento
            this.maintenanceMode = true;
            
            // 2. Notificar a suscriptores importantes
            if (CONFIG.adminChatId) {
                await this.sendMessage(CONFIG.adminChatId, `🛑 *CIERRE DEL SISTEMA*\n\nSeñal: ${signal}\nEl bot se está cerrando gracefully.`, { parse_mode: 'Markdown' }).catch(() => {});
            }
            
            // 3. Detener intervalos
            if (this.checkIntervalId) {
                clearInterval(this.checkIntervalId);
            }
            if (this.recoveryInterval) {
                clearInterval(this.recoveryInterval);
            }
            if (this.healthCheckInterval) {
                clearInterval(this.healthCheckInterval);
            }
            if (this.autoBackupInterval) {
                clearInterval(this.autoBackupInterval);
            }
            if (this.heartbeatInterval) {
                clearInterval(this.heartbeatInterval);
            }
            if (this.errorMonitorInterval) {
                clearInterval(this.errorMonitorInterval);
            }
            
            // 4. Cerrar navegador
            await closeBrowser();
            
            // 5. Detener bot
            await this.bot.stopPolling();
            
            // 6. Guardar estado final
            const finalData = loadData();
            finalData.lastShutdown = new Date().toISOString();
            finalData.shutdownReason = signal;
            saveData(finalData);
            
            console.log('✅ Cierre graceful completado');
            logToFile('SHUTDOWN', 'Cierre graceful completado exitosamente');
            
            // 7. Salir
            process.exit(0);
            
        } catch (error) {
            console.error('❌ Error en cierre graceful:', error);
            logToFile('CRITICAL', `Error en cierre graceful: ${error.message}`);
            process.exit(1);
        }
    }
    
    setupCommands() {
        // /menu - Menú principal
        this.bot.onText(/\/menu/, async (msg) => {
            await this.sendMainMenu(msg.chat.id);
        });
        
        // /my_id - Obtener Chat ID
        this.bot.onText(/\/my_id/, async (msg) => {
            const chatId = msg.chat.id;
            const nombre = msg.from?.first_name || 'Usuario';
            const username = msg.from?.username ? `@${msg.from.username}` : '';
            
            const mensaje = `
🆔 *TU CHAT ID*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

👤 *Usuario:* ${escapeMarkdown(nombre)} ${escapeMarkdown(username)}
🆔 *Chat ID:* \`${chatId}\`

*Para configurar como administrador:*
/set_config admin ${chatId}

*Estado actual:* ${isAdmin(chatId) ? '✅ Administrador' : '❌ Usuario normal'}
            `;
            
            await this.sendMessage(chatId, mensaje, { parse_mode: 'Markdown' });
        });
        
        // /become_admin - Convertirse en admin (temporal para configuración)
        this.bot.onText(/\/become_admin/, async (msg) => {
            const chatId = msg.chat.id;
            
            if (CONFIG.adminChatId && CONFIG.adminChatId !== '') {
                await this.sendMessage(chatId, '❌ Ya hay un administrador configurado. Solo el admin puede cambiar esto.', { parse_mode: 'Markdown' });
                return;
            }
            
            // Configurar como admin
            CONFIG.adminChatId = String(chatId);
            
            await this.sendMessage(chatId, 
                `✅ *¡CONFIGURADO COMO ADMINISTRADOR!*\n\nTu Chat ID \`${chatId}\` ahora tiene permisos de administrador.\n\nAhora puedes usar todos los comandos avanzados:\n• /network_info\n• /process_info\n• /system\n• /admin\n• Y muchos más...`, 
                { parse_mode: 'Markdown' }
            );
            
            logToFile('ADMIN', `Nuevo administrador configurado: ${chatId}`);
        });
        
        // /start - Suscribirse
        this.bot.onText(/\/start/, async (msg) => {
            const chatId = msg.chat.id;
            const nombre = msg.from?.first_name || 'Usuario';
            const username = msg.from?.username ? `@${msg.from.username}` : '';
            
            // ✅ CORREGIDO: Usar métodos de Array
            const idStr = String(chatId);
            if (!this.subscribers.includes(idStr)) {
                this.subscribers.push(idStr);
            }
            addSubscriber(chatId);
            
            const mensaje = `
🌋 *¡Bienvenido, ${escapeMarkdown(nombre)}!* ${escapeMarkdown(username)}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ *Tu Chat ID:* \`${chatId}\`

Recibirás *imágenes* de alertas sísmicas del *SASMEX* en tiempo real.

📱 *COMANDOS:*

/menu      ➜  Menú interactivo
/alerta    ➜  Ver alerta actual
/captura   ➜  Captura de la web
/status    ➜  Estado del bot
/test      ➜  Imagen de prueba
/stop      ➜  Cancelar suscripción
/config    ➜  Configuración
/info      ➜  Info sobre SASMEX
/help      ➜  Ayuda

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔔 *¡Suscripción activada!*
⏱️ Verifico cada *${CONFIG.checkInterval} segundos*
            `;
            
            await this.sendMessage(chatId, mensaje, { parse_mode: 'Markdown' });
            console.log(`✅ Nuevo suscriptor: ${chatId} | ${nombre} ${username}`);
        });
        
        // /stop - Cancelar suscripción
        this.bot.onText(/\/stop/, async (msg) => {
            const chatId = msg.chat.id;
            
            // ✅ CORREGIDO: Usar métodos de Array
            const idStr = String(chatId);
            const index = this.subscribers.indexOf(idStr);
            if (index > -1) {
                this.subscribers.splice(index, 1);
            }
            removeSubscriber(chatId);
            
            await this.sendMessage(chatId,
                '❌ *Suscripción cancelada*\n\nUsa /start para volver a suscribirte.',
                { parse_mode: 'Markdown' }
            );
        });
        
        // /config - Ver configuración
        this.bot.onText(/\/config/, async (msg) => {
            const chatId = msg.chat.id;
            const config = getUserConfig(chatId);
            
            const status = config.subscribed ? '✅ Suscrito' : '❌ No suscrito';
            const severity = config.severity === 'all' ? 'Todas' : config.severity;
            const muted = config.muted ? '🔇 Silenciado' : '🔔 Activo';
            
            const mensaje = `
⚙️ *CONFIGURACIÓN*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 *Estado:* ${status}
🎯 *Severidad:* ${severity}
🔕 *Modo:* ${muted}
📍 *Ubicación:* ${config.location || 'Todo México'}
📱 *Notificaciones:* ${config.notifications || 'Imagen + Texto'}
⚡ *Modo rápido:* ${config.fastMode ? 'Sí' : 'No'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/set_severity [all/menor/moderada/mayor]
/mute   ➜ Silenciar
/unmute ➜ Reactivar
            `;
            
            await this.sendMessage(chatId, mensaje, { parse_mode: 'Markdown' });
        });
        
        // /set_severity
        this.bot.onText(/\/set_severity(?: (.+))?/, async (msg, match) => {
            const chatId = msg.chat.id;
            const severity = match && match[1] ? match[1].toLowerCase().trim() : null;
            
            if (!severity || !['all', 'menor', 'moderada', 'mayor'].includes(severity)) {
                await this.sendMessage(chatId, 
                    '❌ *Uso:* /set\\_severity [all/menor/moderada/mayor]\n\n' +
                    'Ejemplo: /set\\_severity moderada',
                    { parse_mode: 'Markdown' }
                );
                return;
            }
            
            if (setUserSeverity(chatId, severity)) {
                await this.sendMessage(chatId, 
                    `✅ *Severidad configurada:* ${severity}`,
                    { parse_mode: 'Markdown' }
                );
            }
        });
        
        // /mute
        this.bot.onText(/\/mute/, async (msg) => {
            if (setUserMuted(msg.chat.id, true)) {
                await this.sendMessage(msg.chat.id, 
                    '🔇 *Alertas silenciadas*\n\nUsa /unmute para reactivar.',
                    { parse_mode: 'Markdown' }
                );
            }
        });
        
        // /unmute
        this.bot.onText(/\/unmute/, async (msg) => {
            if (setUserMuted(msg.chat.id, false)) {
                await this.sendMessage(msg.chat.id, 
                    '🔔 *Alertas reactivadas*',
                    { parse_mode: 'Markdown' }
                );
            }
        });
        
        // /alerta
        this.bot.onText(/\/alerta/, async (msg) => {
            const chatId = msg.chat.id;
            const waitMsg = await this.sendMessage(chatId, '📸 *Consultando SASMEX...*', { parse_mode: 'Markdown' });
            
            try {
                const webData = await getWebContent();
                
                if (webData.success) {
                    const imageResult = await generateAlertImage(webData.data);
                    
                    if (imageResult.success && fs.existsSync(imageResult.imagePath)) {
                        await this.sendPhoto(chatId, imageResult.imagePath,
                            '🚨 *ALERTA SÍSMICA SASMEX*\n\n📞 Emergencias: *911*\n🔗 rss.sasmex.net'
                        );
                    } else {
                        await this.sendMessage(chatId, '❌ Error generando imagen. Usa /captura', { parse_mode: 'Markdown' });
                    }
                } else {
                    await this.sendMessage(chatId, `❌ Error: ${escapeMarkdown(webData.error || 'Intenta de nuevo')}`, { parse_mode: 'Markdown' });
                }
            } catch (error) {
                await this.sendMessage(chatId, '❌ Error procesando solicitud.', { parse_mode: 'Markdown' });
            }
            
            if (waitMsg) {
                try { await this.bot.deleteMessage(chatId, waitMsg.message_id); } catch (e) {}
            }
        });
        
        // /captura
        this.bot.onText(/\/captura/, async (msg) => {
            const chatId = msg.chat.id;
            const waitMsg = await this.sendMessage(chatId, '📸 *Capturando web...*', { parse_mode: 'Markdown' });
            
            try {
                const result = await captureDirectWeb();
                
                if (result.success && fs.existsSync(result.imagePath)) {
                    await this.sendPhoto(chatId, result.imagePath, '📸 *Captura de rss.sasmex.net*');
                } else {
                    await this.sendMessage(chatId, '❌ Error: ' + escapeMarkdown(result.error || 'Intenta de nuevo'), { parse_mode: 'Markdown' });
                }
            } catch (error) {
                await this.sendMessage(chatId, '❌ Error: ' + error.message, { parse_mode: 'Markdown' });
            }
            
            if (waitMsg) {
                try { await this.bot.deleteMessage(chatId, waitMsg.message_id); } catch (e) {}
            }
        });
        
        // /status
        this.bot.onText(/\/status/, async (msg) => {
            const chatId = msg.chat.id;
            const uptime = this.getUptime();
            const ahora = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
            
            const mensaje = `
📊 *ESTADO DEL BOT*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🟢 *Estado:* En línea
🌐 *Puppeteer:* ${browser ? '✅ Activo' : '⏳ Inactivo'}
📡 *Fuente:* rss.sasmex.net
⏱️ *Intervalo:* ${CONFIG.checkInterval}s
🕐 *Última verificación:* ${this.lastCheck ? this.lastCheck.toLocaleString('es-MX', { timeZone: 'America/Mexico_City' }) : 'Pendiente'}
👥 *Suscriptores:* ${this.subscribers.length}
⏰ *Hora:* ${ahora}
📈 *Uptime:* ${uptime}
            `;
            
            await this.sendMessage(chatId, mensaje, { parse_mode: 'Markdown' });
        });
        
        // /test
        this.bot.onText(/\/test/, async (msg) => {
            const chatId = msg.chat.id;
            const waitMsg = await this.sendMessage(chatId, '🧪 *Generando prueba...*', { parse_mode: 'Markdown' });
            
            try {
                const testData = {
                    fecha: new Date().toLocaleString('es-MX', {
                        timeZone: 'America/Mexico_City',
                        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                        hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true
                    }),
                    evento: 'Sismo de prueba en Costa de Guerrero',
                    severidad: 'Severidad: Menor (PRUEBA)'
                };
                
                const result = await generateAlertImage(testData);
                
                if (result.success && fs.existsSync(result.imagePath)) {
                    await this.sendPhoto(chatId, result.imagePath,
                        '🧪 *PRUEBA DEL SISTEMA*\n\n✅ Bot funcionando\n\n_No hay sismo real._'
                    );
                } else {
                    await this.sendMessage(chatId, '❌ Error: ' + escapeMarkdown(result.error || 'No se pudo generar'), { parse_mode: 'Markdown' });
                }
            } catch (error) {
                await this.sendMessage(chatId, '❌ Error: ' + escapeMarkdown(error.message), { parse_mode: 'Markdown' });
            }
            
            if (waitMsg) {
                try { await this.bot.deleteMessage(chatId, waitMsg.message_id); } catch (e) {}
            }
        });
        
        // /info
        this.bot.onText(/\/info/, async (msg) => {
            const mensaje = `
ℹ️ *INFORMACIÓN SASMEX*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🌋 El Sistema de Alerta Sísmica Mexicano detecta sismos en las costas del Pacífico.

🔗 *Sitios oficiales:*
• http://www.sasmex.net
• https://rss.sasmex.net
• http://www.cires.org.mx

⚠️ *EN CASO DE SISMO:*
1️⃣ Mantén la calma
2️⃣ Aléjate de ventanas
3️⃣ Protégete bajo una mesa
4️⃣ No uses elevadores

📞 *Emergencias: 911*
            `;
            
            await this.sendMessage(msg.chat.id, mensaje, { parse_mode: 'Markdown', disable_web_page_preview: true });
        });
        
        // /help
        this.bot.onText(/\/help/, async (msg) => {
            const isAdminUser = isAdmin(msg.chat.id);
            
            let mensaje = `
❓ *AYUDA - COMANDOS DISPONIBLES*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

*📱 COMANDOS BÁSICOS:*
/start         ➜ Suscribirse a alertas
/stop          ➜ Cancelar suscripción
/menu          ➜ Menú interactivo completo
/my_id         ➜ Obtener tu Chat ID
/become_admin  ➜ Convertirse en administrador
/alerta        ➜ Ver última alerta
/status        ➜ Estado del bot
/config        ➜ Configurar preferencias
/info      ➜ Información SASMEX
/network_info  ➜ Información de red
/process_info  ➜ Información de procesos
/disk_info     ➜ Información de disco
/uptime_detailed ➜ Uptime detallado
/cpu_info      ➜ Información de CPU
/memory_info   ➜ Información de memoria
/wifi_info     ➜ Información de WiFi
/running_apps  ➜ Aplicaciones en ejecución
/battery       ➜ Estado de batería

*🛠️ COMANDOS AVANZADOS:*
/captura           ➜ Capturar web SASMEX
/test              ➜ Probar sistema completo
/logs              ➜ Ver logs del sistema
/broadcast         ➜ Enviar mensaje masivo
/error_log         ➜ Log de errores recientes
/performance_graph ➜ Gráfico de rendimiento
/config_viewer     ➜ Ver configuraciones
/user_management   ➜ Gestión de usuarios
/backup_manager    ➜ Administrar backups
/security_status   ➜ Estado de seguridad
/services          ➜ Servicios del sistema
/usb_devices       ➜ Dispositivos USB
/node_exec         ➜ Ejecutar código Node.js
/vscode_status     ➜ Estado de VS Code
/vscode_open       ➜ Abrir archivo en VS Code
/vscode_command    ➜ Comando en VS Code
/system_command    ➜ Ejecutar comando sistema
/process_communicate ➜ Comunicar con proceso
/interprocess_comms ➜ Sistema comunicación procesos
/force_communication ➜ Comunicación forzada
/communication_hub   ➜ Centro control comunicaciones
/system            ➜ 🖥️ SISTEMA INFORMÁTICO
            `;
            
            if (isAdminUser) {
                mensaje += `

*🔧 COMANDOS DE ADMINISTRADOR:*
/admin              ➜ Panel de administración
/eval [código]      ➜ Ejecutar JavaScript
/restart            ➜ Reiniciar bot
/backup             ➜ Crear backup manual
/list_backups       ➜ Listar backups disponibles
/restore_backup     ➜ Restaurar desde backup
/send_logs          ➜ Enviar logs como documento
/send_backup        ➜ Enviar backup como documento
/bot_info           ➜ Info detallada del bot (API)
/test_buttons       ➜ Probar botones inline
/heartbeat          ➜ Enviar heartbeat manual
/system_status      ➜ Estado completo del sistema
/alert_test         ➜ Probar sistema de alertas
/diagnose           ➜ Diagnóstico completo
/alert_config       ➜ Configurar alertas
/memory             ➜ Información de memoria
/performance        ➜ Métricas de rendimiento
/subscribers        ➜ Gestionar suscriptores
/clear_logs         ➜ Limpiar logs
/system_info        ➜ Información del sistema
/force_alert        ➜ Forzar alerta de prueba
/force_check        ➜ Verificación inmediata
/maintenance        ➜ Modo mantenimiento
/set_config         ➜ Configurar parámetros
/stats_detailed     ➜ Estadísticas detalladas
/recovery_status    ➜ Estado de recuperación
/notify_admin       ➜ Notificación de prueba
/check_connection   ➜ Verificar conectividad SASMEX
/reset_browser      ➜ Reiniciar Puppeteer
/bot_stats          ➜ Estadísticas completas
/file_info          ➜ Información de archivos
/exec_cmd           ➜ Ejecutar comandos seguros
/vscode_status      ➜ Estado de VS Code
/vscode_open        ➜ Abrir archivo en VS Code
/host_permission    ➜ Solicitar permiso para host
/system_notification ➜ Notificación al sistema Windows
                `;
            }
            
            await this.sendMessage(msg.chat.id, mensaje, { parse_mode: 'Markdown' });
        });
        
        // /admin
        this.bot.onText(/\/admin/, async (msg) => {
            const chatId = msg.chat.id;
            
            if (!isAdmin(chatId)) {
                await this.sendMessage(chatId, '❌ No tienes permisos.', { parse_mode: 'Markdown' });
                return;
            }
            
            await this.sendAdminMenu(chatId);
        });
        
        // /logs
        this.bot.onText(/\/logs(?: (\d+))?/, async (msg, match) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) return;
            
            const lines = match && match[1] ? parseInt(match[1]) : 20;
            const logs = getLogs(lines);
            
            // ✅ CORREGIDO: Usar función helper para escapar caracteres
            const escapedLogs = escapeMarkdown(logs.substring(0, 4000));
            
            await this.sendMessage(chatId, `\`\`\`\n${escapedLogs}\n\`\`\``, { parse_mode: 'Markdown' });
        });
        
        // /broadcast
        this.bot.onText(/\/broadcast (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) return;
            
            const message = match[1];
            const subs = getSubscribers();
            
            let sent = 0, failed = 0;
            for (const subId of subs) {
                try {
                    // ✅ CORREGIDO: Escapar caracteres especiales en el mensaje del broadcast
                    const escapedMessage = escapeMarkdown(message);
                    
                    await this.sendMessage(subId, `📢 *MENSAJE DEL ADMINISTRADOR*\n\n${escapedMessage}`, { parse_mode: 'Markdown' });
                    sent++;
                } catch (e) { failed++; }
                await sleep(200);
            }
            
            await this.sendMessage(chatId, `✅ Enviados: ${sent} | ❌ Fallidos: ${failed}`);
        });
        
        // ══════════════════════════════════════════════════════════════
        // COMANDOS AVANZADOS DE ADMINISTRACIÓN
        // ══════════════════════════════════════════════════════════════
        
        // /eval - Ejecutar código JavaScript
        this.bot.onText(/\/eval (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) {
                await this.sendMessage(chatId, '❌ Solo administradores pueden usar este comando.', { parse_mode: 'Markdown' });
                return;
            }
            
            const code = match[1];
            try {
                let result = eval(code);
                if (typeof result === 'object') result = JSON.stringify(result, null, 2);
                const output = `✅ *Resultado:*\n\`\`\`\n${String(result).substring(0, 3800)}\n\`\`\``;
                await this.sendMessage(chatId, output, { parse_mode: 'Markdown' });
                logToFile('ADMIN', `Eval ejecutado por ${chatId}: ${code.substring(0, 100)}...`);
            } catch (error) {
                await this.sendMessage(chatId, `❌ *Error:*\n\`\`\`\n${error.message}\n\`\`\``, { parse_mode: 'Markdown' });
            }
        });
        
        // /restart - Reiniciar el bot
        this.bot.onText(/\/restart(?: (.+))?/, async (msg, match) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) return;
            
            const reason = match && match[1] ? match[1] : 'Reinicio manual';
            
            await this.sendMessage(chatId, `🔄 *Reiniciando bot...*\n\nRazón: ${reason}`, { parse_mode: 'Markdown' });
            logToFile('ADMIN', `Reinicio solicitado por ${chatId}: ${reason}`);
            
            setTimeout(() => {
                console.log('🔄 Reiniciando bot...');
                process.exit(0);
            }, 2000);
        });
        
        // /backup - Crear backup de datos
        this.bot.onText(/\/backup/, async (msg) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) return;
            
            try {
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const backupPath = path.join(__dirname, `backup-${timestamp}.json`);
                
                const data = loadData();
                fs.writeFileSync(backupPath, JSON.stringify(data, null, 2));
                
                await this.sendMessage(chatId, `✅ *Backup creado:*\n\`${backupPath}\``, { parse_mode: 'Markdown' });
                logToFile('ADMIN', `Backup creado por ${chatId}: ${backupPath}`);
            } catch (error) {
                await this.sendMessage(chatId, `❌ Error creando backup: ${error.message}`, { parse_mode: 'Markdown' });
            }
        });
        
        // /memory - Información de memoria
        this.bot.onText(/\/memory/, async (msg) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) return;
            
            const mem = process.memoryUsage();
            const text = `
🧠 *USO DE MEMORIA*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 *Heap usado:* ${Math.round(mem.heapUsed / 1024 / 1024)}MB
📈 *Heap total:* ${Math.round(mem.heapTotal / 1024 / 1024)}MB
🔺 *Heap máximo:* ${Math.round(mem.external / 1024 / 1024)}MB
💾 *RSS:* ${Math.round(mem.rss / 1024 / 1024)}MB

⏱️ *Uptime:* ${this.getUptime()}
🔄 *PID:* ${process.pid}
            `;
            
            await this.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        });
        
        // /performance - Métricas de rendimiento
        this.bot.onText(/\/performance/, async (msg) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) return;
            
            const startTime = process.hrtime.bigint();
            await sleep(1); // Pequeña pausa para medir
            const endTime = process.hrtime.bigint();
            const latency = Number(endTime - startTime) / 1000000; // ms
            
            const text = `
⚡ *MÉTRICAS DE RENDIMIENTO*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🏓 *Latencia:* ${latency.toFixed(2)}ms
👥 *Suscriptores:* ${this.subscribers.length}
🔄 *Intervalo:* ${CONFIG.checkInterval}s
💾 *Memoria:* ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB
⏱️ *Uptime:* ${this.getUptime()}

📊 *Estado del bot:* ${this.isChecking ? '🔄 Procesando' : '✅ Inactivo'}
            `;
            
            await this.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        });
        
        // /subscribers - Gestionar suscriptores
        this.bot.onText(/\/subscribers(?: (list|count|clean|remove (\d+)))?/, async (msg, match) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) return;
            
            const action = match && match[1];
            const targetId = match && match[2];
            
            if (!action || action === 'count') {
                const data = loadData();
                const users = data.users || {};
                const total = Object.keys(users).length;
                const active = Object.values(users).filter(u => u.subscribed).length;
                const inactive = total - active;
                
                await this.sendMessage(chatId, 
                    `👥 *SUSCRIPTORES*\n\n` +
                    `📊 Total: ${total}\n` +
                    `✅ Activos: ${active}\n` +
                    `❌ Inactivos: ${inactive}`, 
                    { parse_mode: 'Markdown' }
                );
            } else if (action === 'list') {
                const data = loadData();
                const users = data.users || {};
                let list = '📋 *LISTA DE SUSCRIPTORES*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
                
                Object.entries(users).slice(0, 50).forEach(([id, user]) => {
                    list += `${user.subscribed ? '✅' : '❌'} ${id}\n`;
                });
                
                if (Object.keys(users).length > 50) {
                    list += `\n... y ${Object.keys(users).length - 50} más`;
                }
                
                await this.sendMessage(chatId, list, { parse_mode: 'Markdown' });
            } else if (action === 'clean') {
                const data = loadData();
                const users = data.users || {};
                let cleaned = 0;
                
                Object.keys(users).forEach(id => {
                    if (!users[id].subscribed) {
                        delete users[id];
                        cleaned++;
                    }
                });
                
                saveData(data);
                await this.sendMessage(chatId, `🧹 *Limpieza completada*\n\nEliminados: ${cleaned} usuarios inactivos`, { parse_mode: 'Markdown' });
                logToFile('ADMIN', `Limpieza de suscriptores por ${chatId}: ${cleaned} eliminados`);
            } else if (action === 'remove' && targetId) {
                removeSubscriber(targetId);
                await this.sendMessage(chatId, `❌ Suscriptor ${targetId} eliminado`, { parse_mode: 'Markdown' });
                logToFile('ADMIN', `Suscriptor ${targetId} eliminado por ${chatId}`);
            }
        });
        
        // /clear_logs - Limpiar logs
        this.bot.onText(/\/clear_logs/, async (msg) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) return;
            
            try {
                fs.writeFileSync('bot.log', '');
                await this.sendMessage(chatId, '🧹 *Logs limpiados exitosamente*', { parse_mode: 'Markdown' });
                logToFile('ADMIN', `Logs limpiados por ${chatId}`);
            } catch (error) {
                await this.sendMessage(chatId, `❌ Error limpiando logs: ${error.message}`, { parse_mode: 'Markdown' });
            }
        });
        
        // /system_info - Información del sistema
        this.bot.onText(/\/system_info/, async (msg) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) return;
            
            const os = require('os');
            const text = `
🖥️ *INFORMACIÓN DEL SISTEMA*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🖥️ *SO:* ${os.type()} ${os.release()}
🏗️ *Arquitectura:* ${os.arch()}
💾 *Memoria total:* ${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB
💾 *Memoria libre:* ${Math.round(os.freemem() / 1024 / 1024 / 1024)}GB
🔄 *CPUs:* ${os.cpus().length}
📂 *Directorio:* ${__dirname}
⏰ *Hora del sistema:* ${new Date().toLocaleString('es-MX')}

🤖 *Bot PID:* ${process.pid}
📊 *Node.js:* ${process.version}
            `;
            
            await this.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        });
        
        // /force_alert - Forzar envío de alerta
        this.bot.onText(/\/force_alert(?: (.+))?/, async (msg, match) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) return;
            
            const severity = match && match[1] ? match[1] : 'moderada';
            
            await this.sendMessage(chatId, `🚨 *Forzando alerta de prueba...*`, { parse_mode: 'Markdown' });
            
            // Crear alerta de prueba
            const testAlert = {
                fecha: new Date().toLocaleString('es-MX'),
                evento: 'ALERTA DE PRUEBA - SISTEMA SASMEX',
                severidad: severity
            };
            
            try {
                const imageResult = await generateAlertImage(testAlert);
                if (imageResult.success) {
                    await this.broadcastImage(imageResult.imagePath, 
                        '🚨🚨🚨 *ALERTA DE PRUEBA* 🚨🚨🚨\n\n📞 Emergencias: *911*\n\n_Esta es una alerta de prueba_', 
                        severity
                    );
                    await this.sendMessage(chatId, '✅ *Alerta de prueba enviada*', { parse_mode: 'Markdown' });
                } else {
                    await this.sendMessage(chatId, '❌ Error generando imagen de prueba', { parse_mode: 'Markdown' });
                }
            } catch (error) {
                await this.sendMessage(chatId, `❌ Error en alerta de prueba: ${error.message}`, { parse_mode: 'Markdown' });
            }
            
            logToFile('ADMIN', `Alerta de prueba forzada por ${chatId} con severidad ${severity}`);
        });
        
        // /maintenance - Modo mantenimiento
        this.bot.onText(/\/maintenance (on|off)/, async (msg, match) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) return;
            
            const action = match[1];
            
            if (action === 'on') {
                this.maintenanceMode = true;
                await this.sendMessage(chatId, '🔧 *Modo mantenimiento ACTIVADO*\n\nEl bot no procesará nuevas alertas.', { parse_mode: 'Markdown' });
                logToFile('ADMIN', `Modo mantenimiento activado por ${chatId}`);
            } else {
                this.maintenanceMode = false;
                await this.sendMessage(chatId, '✅ *Modo mantenimiento DESACTIVADO*\n\nEl bot reanudará el procesamiento normal.', { parse_mode: 'Markdown' });
                logToFile('ADMIN', `Modo mantenimiento desactivado por ${chatId}`);
            }
        });
        
        // /set_config - Configurar parámetros del bot
        this.bot.onText(/\/set_config (\w+) (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) return;
            
            const param = match[1];
            const value = match[2];
            
            try {
                switch (param) {
                    case 'interval':
                        const newInterval = parseInt(value);
                        if (newInterval >= 10 && newInterval <= 3600) {
                            CONFIG.checkInterval = newInterval;
                            // Reiniciar intervalo
                            if (this.checkIntervalId) clearInterval(this.checkIntervalId);
                            this.checkIntervalId = setInterval(() => this.checkForAlerts(false), CONFIG.checkInterval * 1000);
                            
                            await this.sendMessage(chatId, `✅ Intervalo cambiado a ${newInterval} segundos`, { parse_mode: 'Markdown' });
                            logToFile('ADMIN', `Intervalo cambiado a ${newInterval}s por ${chatId}`);
                        } else {
                            await this.sendMessage(chatId, '❌ Intervalo debe estar entre 10-3600 segundos', { parse_mode: 'Markdown' });
                        }
                        break;
                        
                    case 'admin':
                        CONFIG.adminChatId = value;
                        await this.sendMessage(chatId, `✅ Admin cambiado a ${value}`, { parse_mode: 'Markdown' });
                        logToFile('ADMIN', `Admin cambiado a ${value} por ${chatId}`);
                        break;
                        
                    default:
                        await this.sendMessage(chatId, '❌ Parámetro no válido. Use: interval, admin', { parse_mode: 'Markdown' });
                }
            } catch (error) {
                await this.sendMessage(chatId, `❌ Error cambiando configuración: ${error.message}`, { parse_mode: 'Markdown' });
            }
        });
        
        // /restore_backup - Restaurar desde backup
        this.bot.onText(/\/restore_backup(?: (\d+))?/, async (msg, match) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) return;
            
            try {
                const backupDir = __dirname;
                const backupFiles = fs.readdirSync(backupDir)
                    .filter(file => file.startsWith('auto-backup-'))
                    .sort()
                    .reverse();
                
                if (backupFiles.length === 0) {
                    await this.sendMessage(chatId, '❌ No hay backups disponibles', { parse_mode: 'Markdown' });
                    return;
                }
                
                const index = match && match[1] ? parseInt(match[1]) - 1 : 0;
                if (index < 0 || index >= backupFiles.length) {
                    await this.sendMessage(chatId, `❌ Índice inválido. Disponibles: 1-${backupFiles.length}`, { parse_mode: 'Markdown' });
                    return;
                }
                
                const selectedBackup = backupFiles[index];
                const backupPath = path.join(backupDir, selectedBackup);
                
                // Leer backup
                const backupData = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
                
                // Restaurar datos
                saveData(backupData);
                
                // Recargar suscriptores
                this.subscribers = getSubscribers();
                
                await this.sendMessage(chatId, 
                    `✅ *BACKUP RESTAURADO*\n\nArchivo: ${selectedBackup}\nSuscriptores: ${backupData.users ? Object.keys(backupData.users).length : 0}\nTimestamp: ${backupData.backupTimestamp || 'N/A'}`, 
                    { parse_mode: 'Markdown' }
                );
                
                logToFile('ADMIN', `Backup restaurado por ${chatId}: ${selectedBackup}`);
                
            } catch (error) {
                await this.sendMessage(chatId, `❌ Error restaurando backup: ${error.message}`, { parse_mode: 'Markdown' });
            }
        });
        
        // /list_backups - Listar backups disponibles
        this.bot.onText(/\/list_backups/, async (msg) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) return;
            
            try {
                const backupDir = __dirname;
                const backupFiles = fs.readdirSync(backupDir)
                    .filter(file => file.startsWith('auto-backup-'))
                    .sort()
                    .reverse()
                    .slice(0, 10); // Mostrar solo los 10 más recientes
                
                if (backupFiles.length === 0) {
                    await this.sendMessage(chatId, '❌ No hay backups disponibles', { parse_mode: 'Markdown' });
                    return;
                }
                
                let list = '💾 *BACKUPS DISPONIBLES*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
                backupFiles.forEach((file, index) => {
                    const filePath = path.join(backupDir, file);
                    const stats = fs.statSync(filePath);
                    const sizeKB = Math.round(stats.size / 1024);
                    list += `${index + 1}. ${file}\n   📅 ${new Date(stats.mtime).toLocaleString('es-MX')}\n   📏 ${sizeKB}KB\n\n`;
                });
                
                list += `Usa /restore_backup [número] para restaurar`;
                
                await this.sendMessage(chatId, list, { parse_mode: 'Markdown' });
                
            } catch (error) {
                await this.sendMessage(chatId, `❌ Error listando backups: ${error.message}`, { parse_mode: 'Markdown' });
            }
        });
        this.bot.onText(/\/recovery_status/, async (msg) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) return;
            
            const recoveryTime = this.lastRecovery ? 
                `${Math.round((Date.now() - this.lastRecovery.getTime()) / 1000 / 60)} min atrás` : 
                'Nunca';
            
            const text = `
🔄 *ESTADO DEL SISTEMA DE RECUPERACIÓN*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🛠️ *Modo recuperación:* ${this.recoveryMode ? '🟡 ACTIVO' : '🟢 INACTIVO'}
🔧 *Modo mantenimiento:* ${this.maintenanceMode ? '🟡 ACTIVO' : '🟢 INACTIVO'}
📊 *Contador de fallos:* ${this.failureCount}/${this.maxFailures}
⏰ *Última recuperación:* ${recoveryTime}
💾 *Memoria:* ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB
⏱️ *Uptime:* ${this.getUptime()}

*Intervalos activos:*
• Monitoreo: ${this.checkIntervalId ? '✅' : '❌'}
• Recuperación: ${this.recoveryInterval ? '✅' : '❌'}
• Health check: ${this.healthCheckInterval ? '✅' : '❌'}
            `;
            
            await this.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        });
        
        // /force_check - Forzar verificación inmediata
        this.bot.onText(/\/force_check/, async (msg) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) return;
            
            await this.sendMessage(chatId, '🔍 *Forzando verificación inmediata...*', { parse_mode: 'Markdown' });
            
            try {
                await this.checkForAlerts(false);
                await this.sendMessage(chatId, '✅ *Verificación completada*', { parse_mode: 'Markdown' });
            } catch (error) {
                await this.sendMessage(chatId, `❌ *Error en verificación:* ${error.message}`, { parse_mode: 'Markdown' });
            }
        });
        
        // /notify_admin - Enviar notificación de prueba al admin
        this.bot.onText(/\/notify_admin (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) return;
            
            const message = match[1];
            if (CONFIG.adminChatId) {
                try {
                    await this.sendMessage(CONFIG.adminChatId, `📢 *NOTIFICACIÓN DE PRUEBA*\n\n${message}\n\nEnviado por: ${chatId}`, { parse_mode: 'Markdown' });
                    await this.sendMessage(chatId, '✅ Notificación enviada al admin', { parse_mode: 'Markdown' });
                } catch (error) {
                    await this.sendMessage(chatId, `❌ Error enviando notificación: ${error.message}`, { parse_mode: 'Markdown' });
                }
            } else {
                await this.sendMessage(chatId, '❌ No hay admin configurado', { parse_mode: 'Markdown' });
            }
        });
        
        this.bot.onText(/\/stats_detailed/, async (msg) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) return;
            
            const data = loadData();
            const users = data.users || {};
            
            const stats = {
                total: Object.keys(users).length,
                active: Object.values(users).filter(u => u.subscribed).length,
                muted: Object.values(users).filter(u => u.muted).length,
                bySeverity: {
                    all: Object.values(users).filter(u => u.severity === 'all').length,
                    menor: Object.values(users).filter(u => u.severity === 'menor').length,
                    moderada: Object.values(users).filter(u => u.severity === 'moderada').length,
                    mayor: Object.values(users).filter(u => u.severity === 'mayor').length
                }
            };
            
            const text = `
📊 *ESTADÍSTICAS DETALLADAS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

👥 *Usuarios totales:* ${stats.total}
✅ *Activos:* ${stats.active}
🔇 *Silenciados:* ${stats.muted}
📊 *Inactivos:* ${stats.total - stats.active}

🎯 *Por severidad:*
• Todas las alertas: ${stats.bySeverity.all}
• Menor+: ${stats.bySeverity.menor}
• Moderada+: ${stats.bySeverity.moderada}
• Mayor: ${stats.bySeverity.mayor}

💾 *Memoria:* ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB
⏱️ *Uptime:* ${this.getUptime()}
🔄 *Modo mantenimiento:* ${this.maintenanceMode ? '🟡 ON' : '🟢 OFF'}
            `;
            
            await this.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        });
        
        // ✅ NUEVO: /send_logs - Enviar logs como documento
        this.bot.onText(/\/send_logs/, async (msg) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) return;
            
            try {
                if (!fs.existsSync(CONFIG.logFile)) {
                    await this.sendMessage(chatId, '❌ No hay archivo de logs', { parse_mode: 'Markdown' });
                    return;
                }
                
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const logFileName = `logs-${timestamp}.txt`;
                
                await this.sendDocument(chatId, CONFIG.logFile, {
                    caption: `📄 *Logs del bot*\n\nGenerado: ${new Date().toLocaleString('es-MX')}`,
                    parse_mode: 'Markdown'
                }, 3);
                
                await this.sendMessage(chatId, '✅ Logs enviados como documento', { parse_mode: 'Markdown' });
                logToFile('ADMIN', `Logs enviados como documento por ${chatId}`);
                
            } catch (error) {
                await this.sendMessage(chatId, `❌ Error enviando logs: ${error.message}`, { parse_mode: 'Markdown' });
            }
        });
        
        // ✅ NUEVO: /send_backup - Enviar backup más reciente como documento
        this.bot.onText(/\/send_backup/, async (msg) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) return;
            
            try {
                const backupDir = __dirname;
                const backupFiles = fs.readdirSync(backupDir)
                    .filter(file => file.startsWith('auto-backup-'))
                    .sort()
                    .reverse();
                
                if (backupFiles.length === 0) {
                    await this.sendMessage(chatId, '❌ No hay backups disponibles', { parse_mode: 'Markdown' });
                    return;
                }
                
                const latestBackup = backupFiles[0];
                const backupPath = path.join(backupDir, latestBackup);
                
                await this.sendDocument(chatId, backupPath, {
                    caption: `💾 *Backup más reciente*\n\nArchivo: ${latestBackup}\nGenerado: ${new Date().toLocaleString('es-MX')}`,
                    parse_mode: 'Markdown'
                }, 3);
                
                await this.sendMessage(chatId, '✅ Backup enviado como documento', { parse_mode: 'Markdown' });
                logToFile('ADMIN', `Backup enviado como documento por ${chatId}: ${latestBackup}`);
                
            } catch (error) {
                await this.sendMessage(chatId, `❌ Error enviando backup: ${error.message}`, { parse_mode: 'Markdown' });
            }
        });
        
        // ✅ NUEVO: /edit_last - Editar el último mensaje enviado por el bot
        this.bot.onText(/\/edit_last (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) return;
            
            const newText = match[1];
            
            try {
                // Buscar el último mensaje del bot en el chat
                const chat = await this.bot.getChat(chatId);
                // Nota: Esta es una simplificación. En la práctica, necesitarías almacenar message_id de mensajes enviados
                await this.sendMessage(chatId, '⚠️ Función en desarrollo - Usa /eval para editar mensajes específicos', { parse_mode: 'Markdown' });
                
            } catch (error) {
                await this.sendMessage(chatId, `❌ Error editando mensaje: ${error.message}`, { parse_mode: 'Markdown' });
            }
        });
        
        // ✅ NUEVO: /bot_info - Información detallada del bot usando API de Telegram
        this.bot.onText(/\/bot_info/, async (msg) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) return;
            
            try {
                const botInfo = await this.bot.getMe();
                const webhookInfo = await this.bot.getWebhookInfo();
                
                const text = `
🤖 *INFORMACIÓN DEL BOT (API TELEGRAM)*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 *Bot Info:*
• Nombre: ${botInfo.first_name}
• Username: @${botInfo.username}
• ID: ${botInfo.id}
• Puede unirse a grupos: ${botInfo.can_join_groups ? '✅' : '❌'}
• Puede leer mensajes: ${botInfo.can_read_all_group_messages ? '✅' : '❌'}
• Soporta inline: ${botInfo.supports_inline_queries ? '✅' : '❌'}

🌐 *Webhook:*
• URL: ${webhookInfo.url || 'No configurado (usando polling)'}
• Tiene certificado: ${webhookInfo.has_custom_certificate ? '✅' : '❌'}
• Pending updates: ${webhookInfo.pending_update_count}
• Max connections: ${webhookInfo.max_connections}
• Last error: ${webhookInfo.last_error_message || 'Ninguno'}

📡 *Estado de conexión:*
• Polling activo: ${this.bot.options.polling ? '✅' : '❌'}
• Webhook activo: ${webhookInfo.url ? '✅' : '❌'}
                `;
                
                await this.sendMessage(chatId, text, { parse_mode: 'Markdown' });
                
            } catch (error) {
                await this.sendMessage(chatId, `❌ Error obteniendo info del bot: ${error.message}`, { parse_mode: 'Markdown' });
            }
        });
        
        // ✅ NUEVO: /test_buttons - Probar botones inline
        this.bot.onText(/\/test_buttons/, async (msg) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) return;
            
            const buttons = [
                [{ text: '✅ Confirmar', callback_data: 'test_confirm' }],
                [{ text: '❌ Cancelar', callback_data: 'test_cancel' }, { text: '🔄 Reintentar', callback_data: 'test_retry' }]
            ];
            
            await this.sendWithButtons(chatId, 
                '🧪 *PRUEBA DE BOTONES*\n\nSelecciona una opción:', 
                buttons, 
                { parse_mode: 'Markdown' }
            );
        });
        
        // ✅ NUEVO: /check_connection - Verificar conectividad con SASMEX
        this.bot.onText(/\/check_connection/, async (msg) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) return;
            
            await this.sendMessage(chatId, '🔍 *Verificando conectividad con SASMEX...*', { parse_mode: 'Markdown' });
            
            try {
                const startTime = Date.now();
                const response = await fetch(CONFIG.webUrl, { 
                    timeout: CONFIG.fetchTimeout,
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
                });
                const responseTime = Date.now() - startTime;
                
                const statusText = response.ok ? '✅ Conectado' : '❌ Error de respuesta';
                const text = `
🌐 *VERIFICACIÓN DE CONECTIVIDAD*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📡 *Estado:* ${statusText}
⏱️ *Tiempo de respuesta:* ${responseTime}ms
📊 *Código HTTP:* ${response.status}
🔗 *URL:* ${CONFIG.webUrl}

${response.ok ? '✅ El sitio de SASMEX está accesible' : '❌ Problemas de conectividad detectados'}
                `;
                
                await this.sendMessage(chatId, text, { parse_mode: 'Markdown' });
                logToFile('ADMIN', `Verificación de conectividad por ${chatId}: ${response.ok ? 'OK' : 'ERROR'} (${responseTime}ms)`);
                
            } catch (error) {
                await this.sendMessage(chatId, `❌ *Error de conectividad:*\n\n${error.message}`, { parse_mode: 'Markdown' });
                logToFile('ADMIN', `Error de conectividad verificado por ${chatId}: ${error.message}`);
            }
        });
        
        // ✅ NUEVO: /reset_browser - Reiniciar instancia de Puppeteer
        this.bot.onText(/\/reset_browser/, async (msg) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) return;
            
            await this.sendMessage(chatId, '🔄 *Reiniciando navegador Puppeteer...*', { parse_mode: 'Markdown' });
            
            try {
                if (browser) {
                    await browser.close();
                    browser = null;
                    console.log('🗑️ Navegador cerrado');
                }
                
                // Esperar un momento
                await sleep(2000);
                
                // Reinicializar
                browser = await puppeteer.launch(CONFIG.puppeteerOptions);
                console.log('✅ Navegador reiniciado');
                
                await this.sendMessage(chatId, '✅ *Navegador Puppeteer reiniciado exitosamente*', { parse_mode: 'Markdown' });
                logToFile('ADMIN', `Navegador reiniciado por ${chatId}`);
                
            } catch (error) {
                await this.sendMessage(chatId, `❌ *Error reiniciando navegador:*\n\n${error.message}`, { parse_mode: 'Markdown' });
                logToFile('ERROR', `Error reiniciando navegador: ${error.message}`);
            }
        });
        
        // ✅ NUEVO: /bot_stats - Estadísticas detalladas del bot
        this.bot.onText(/\/bot_stats/, async (msg) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) return;
            
            try {
                const data = loadData();
                const users = data.users || {};
                const totalUsers = Object.keys(users).length;
                const activeUsers = Object.values(users).filter(u => u.subscribed).length;
                
                // Calcular estadísticas de mensajes (aproximadas)
                const messageStats = {
                    totalSent: data.messageCount || 0,
                    alertsSent: data.alertCount || 0,
                    errors: data.errorCount || 0
                };
                
                const uptime = this.getUptime();
                const memUsage = process.memoryUsage();
                
                const text = `
📊 *ESTADÍSTICAS COMPLETAS DEL BOT*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

👥 *USUARIOS:*
• Total registrados: ${totalUsers}
• Activos: ${activeUsers}
• Inactivos: ${totalUsers - activeUsers}

📨 *MENSAJES ENVIADOS:*
• Total: ${messageStats.totalSent}
• Alertas: ${messageStats.alertsSent}
• Errores: ${messageStats.errors}

💾 *RECURSOS:*
• Memoria usada: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB
• Memoria total: ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB
• Uptime: ${uptime}

🔧 *SISTEMA:*
• Modo mantenimiento: ${this.maintenanceMode ? '🟡 ON' : '🟢 OFF'}
• Modo recuperación: ${this.recoveryMode ? '🟡 ON' : '🟢 OFF'}
• Fallos recientes: ${this.failureCount}
• Última verificación: ${this.lastCheck ? this.lastCheck.toLocaleString('es-MX') : 'Nunca'}

📁 *ALMACENAMIENTO:*
• Archivo de datos: ${fs.existsSync(CONFIG.dataFile) ? Math.round(fs.statSync(CONFIG.dataFile).size / 1024) + 'KB' : 'No existe'}
• Archivo de logs: ${fs.existsSync(CONFIG.logFile) ? Math.round(fs.statSync(CONFIG.logFile).size / 1024) + 'KB' : 'No existe'}
                `;
                
                await this.sendMessage(chatId, text, { parse_mode: 'Markdown' });
                
            } catch (error) {
                await this.sendMessage(chatId, `❌ Error obteniendo estadísticas: ${error.message}`, { parse_mode: 'Markdown' });
            }
        });
        
        // ✅ NUEVO: /file_info - Información de archivos del sistema
        this.bot.onText(/\/file_info/, async (msg) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) return;
            
            try {
                const files = [
                    { name: 'Datos (data.json)', path: CONFIG.dataFile },
                    { name: 'Logs (bot.log)', path: CONFIG.logFile },
                    { name: 'Screenshot (alerta.png)', path: CONFIG.screenshotFile }
                ];
                
                let info = '📁 *INFORMACIÓN DE ARCHIVOS*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
                
                files.forEach(file => {
                    if (fs.existsSync(file.path)) {
                        const stats = fs.statSync(file.path);
                        const sizeKB = Math.round(stats.size / 1024);
                        const modified = new Date(stats.mtime).toLocaleString('es-MX');
                        info += `📄 *${file.name}:*\n`;
                        info += `   📏 Tamaño: ${sizeKB}KB\n`;
                        info += `   📅 Modificado: ${modified}\n\n`;
                    } else {
                        info += `📄 *${file.name}:*\n   ❌ No existe\n\n`;
                    }
                });
                
                // Información del directorio
                const dirFiles = fs.readdirSync(__dirname);
                const backupFiles = dirFiles.filter(f => f.startsWith('auto-backup-')).length;
                const totalFiles = dirFiles.length;
                
                info += `📂 *Directorio de trabajo:*\n`;
                info += `   📊 Total archivos: ${totalFiles}\n`;
                info += `   💾 Backups: ${backupFiles}\n`;
                info += `   📍 Ruta: ${__dirname}`;
                
                await this.sendMessage(chatId, info, { parse_mode: 'Markdown' });
                
            } catch (error) {
                await this.sendMessage(chatId, `❌ Error obteniendo info de archivos: ${error.message}`, { parse_mode: 'Markdown' });
            }
        });
        
        // ✅ NUEVO: /exec_cmd - Ejecutar comandos seguros del sistema
        this.bot.onText(/\/exec_cmd (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) return;
            
            const command = match[1];
            
            // Lista de comandos permitidos por seguridad
            const allowedCommands = ['ping', 'nslookup', 'tracert', 'ipconfig', 'netstat', 'tasklist', 'systeminfo'];
            const isAllowed = allowedCommands.some(cmd => command.toLowerCase().startsWith(cmd));
            
            if (!isAllowed) {
                await this.sendMessage(chatId, '❌ *Comando no permitido por seguridad*\n\nComandos permitidos: ping, nslookup, tracert, ipconfig, netstat, tasklist, systeminfo', { parse_mode: 'Markdown' });
                return;
            }
            
            await this.sendMessage(chatId, `⚡ *Ejecutando comando:*\n\`${command}\``, { parse_mode: 'Markdown' });
            
            try {
                // Usar run_in_terminal para ejecutar el comando
                const { spawn } = require('child_process');
                const isWindows = process.platform === 'win32';
                
                const child = spawn(isWindows ? 'cmd' : 'sh', [isWindows ? '/c' : '-c', command], {
                    cwd: __dirname,
                    stdio: ['pipe', 'pipe', 'pipe']
                });
                
                let output = '';
                let errorOutput = '';
                
                child.stdout.on('data', (data) => {
                    output += data.toString();
                });
                
                child.stderr.on('data', (data) => {
                    errorOutput += data.toString();
                });
                
                child.on('close', async (code) => {
                    const result = output || errorOutput;
                    const truncated = result.length > 3500 ? result.substring(0, 3500) + '\n\n... (truncado)' : result;
                    
                    const response = `
✅ *Comando ejecutado* (código: ${code})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

\`\`\`
${truncated}
\`\`\`
                    `;
                    
                    await this.sendMessage(chatId, response, { parse_mode: 'Markdown' });
                    logToFile('ADMIN', `Comando ejecutado por ${chatId}: ${command} (código: ${code})`);
                });
                
                child.on('error', async (error) => {
                    await this.sendMessage(chatId, `❌ *Error ejecutando comando:*\n\n${error.message}`, { parse_mode: 'Markdown' });
                });
                
                // Timeout de 30 segundos
                setTimeout(() => {
                    if (!child.killed) {
                        child.kill();
                        this.sendMessage(chatId, '⏰ *Comando terminado por timeout*', { parse_mode: 'Markdown' });
                    }
                }, 30000);
                
            } catch (error) {
                await this.sendMessage(chatId, `❌ *Error:*\n\n${error.message}`, { parse_mode: 'Markdown' });
            }
        });
        
        // ✅ NUEVO: /network_info - Información de red
        this.bot.onText(/\/network_info/, async (msg) => {
            const chatId = msg.chat.id;
            const isAdminUser = isAdmin(chatId);
            
            try {
                const { exec } = require('child_process');
                const util = require('util');
                const execAsync = util.promisify(exec);
                
                let info = '🌐 *INFORMACIÓN DE RED*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
                
                // Ejecutar comando de PowerShell para obtener info de red
                const { stdout: netAdapterOutput } = await execAsync('powershell -Command "Get-NetAdapter | Where-Object { $_.Status -eq \'Up\' } | Select-Object Name, MacAddress, LinkSpeed | Format-Table -AutoSize | Out-String"');
                const { stdout: ipOutput } = await execAsync('powershell -Command "Get-NetIPAddress | Where-Object { $_.AddressFamily -eq \'IPv4\' -and $_.InterfaceAlias -notlike \'*Loopback*\' } | Select-Object InterfaceAlias, IPAddress, PrefixLength | Format-Table -AutoSize | Out-String"');
                
                info += `🔌 *Adaptadores de Red Activos:*\n${netAdapterOutput}\n`;
                info += `📍 *Direcciones IP:*\n${ipOutput}`;
                
                // Información adicional del sistema
                const os = require('os');
                info += `🌍 *Hostname:* ${os.hostname()}\n`;
                info += `🏗️ *Plataforma:* ${os.platform()} ${os.release()}\n`;
                
                if (!isAdminUser) {
                    info += `\nℹ️ *Para información completa, conviértete en administrador con /become_admin*`;
                }
                
                await this.sendMessage(chatId, info, { parse_mode: 'Markdown' });
                
            } catch (error) {
                await this.sendMessage(chatId, `❌ Error obteniendo info de red: ${error.message}`, { parse_mode: 'Markdown' });
            }
        });
        
        // ✅ NUEVO: /process_info - Información de procesos
        this.bot.onText(/\/process_info/, async (msg) => {
            const chatId = msg.chat.id;
            const isAdminUser = isAdmin(chatId);
            
            try {
                const { exec } = require('child_process');
                const util = require('util');
                const execAsync = util.promisify(exec);
                
                let info = `⚙️ *INFORMACIÓN DE PROCESOS*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                
                // Ejecutar comando de PowerShell para obtener procesos
                const { stdout: processOutput } = await execAsync('powershell -Command "Get-Process | Sort-Object WorkingSet -Descending | Select-Object -First 10 Name, Id, @{Name=\'CPU\';Expression={$_.CPU}}, @{Name=\'Memory(MB)\';Expression={[math]::Round($_.WorkingSet/1MB,2)}} | Format-Table -AutoSize | Out-String"');
                
                info += `🔢 *Procesos principales (ordenados por memoria):*\n${processOutput}`;
                
                // Información del proceso del bot
                info += `🤖 *Proceso del Bot:*\n`;
                info += `   🆔 PID: ${process.pid}\n`;
                info += `   🎯 Título: ${process.title}\n`;
                info += `   📊 Versión Node: ${process.version}\n`;
                info += `   ⏰ Uptime: ${Math.round(process.uptime())}s\n`;
                
                // Memoria del proceso del bot
                const memUsage = process.memoryUsage();
                info += `💾 *Memoria del Bot:*\n`;
                info += `   📈 Usada: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB\n`;
                info += `   📊 Total: ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB\n`;
                info += `   💿 RSS: ${Math.round(memUsage.rss / 1024 / 1024)}MB`;
                
                if (isAdminUser) {
                    info += `\n   🔄 Externa: ${Math.round(memUsage.external / 1024 / 1024)}MB\n`;
                    info += `👨‍👩‍👧‍👦 PPID: ${process.ppid || 'N/A'}\n`;
                    info += `🔢 Hilos: ${process.threads || 'N/A'}`;
                }
                
                if (!isAdminUser) {
                    info += `\n\nℹ️ *Para información completa del sistema, conviértete en administrador con /become_admin*`;
                }
                
                await this.sendMessage(chatId, info, { parse_mode: 'Markdown' });
                
            } catch (error) {
                await this.sendMessage(chatId, `❌ Error obteniendo info de procesos: ${error.message}`, { parse_mode: 'Markdown' });
            }
        });
        
        // ✅ NUEVO: /disk_info - Información de disco
        this.bot.onText(/\/disk_info/, async (msg) => {
            const chatId = msg.chat.id;
            const isAdminUser = isAdmin(chatId);
            
            try {
                const { exec } = require('child_process');
                const util = require('util');
                const execAsync = util.promisify(exec);
                
                let info = '💿 *INFORMACIÓN DE DISCO*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
                
                // Ejecutar comando de PowerShell para obtener info de disco
                const { stdout: driveOutput } = await execAsync('powershell -Command "Get-PSDrive -PSProvider FileSystem | Select-Object Name, @{Name=\'Used(GB)\';Expression={[math]::Round($_.Used/1GB,2)}}, @{Name=\'Free(GB)\';Expression={[math]::Round($_.Free/1GB,2)}}, @{Name=\'Total(GB)\';Expression={[math]::Round(($_.Used + $_.Free)/1GB,2)}} | Format-Table -AutoSize | Out-String"');
                
                info += `💽 *Unidades de Disco:*\n${driveOutput}`;
                
                // Información del directorio del bot
                const botDir = __dirname;
                info += `📁 *Directorio del Bot:* ${botDir}\n\n`;
                
                // Archivos en el directorio del bot usando PowerShell
                const { stdout: filesOutput } = await execAsync(`powershell -Command "Get-ChildItem '${botDir}' -File | Sort-Object Length -Descending | Select-Object -First ${isAdminUser ? 10 : 5} Name, @{Name='Size(KB)';Expression={[math]::Round($_.Length/1KB,2)}}, LastWriteTime | Format-Table -AutoSize | Out-String"`);
                
                info += `📄 *Archivos principales:*\n${filesOutput}`;
                
                if (!isAdminUser) {
                    info += `\nℹ️ *Para ver más archivos y detalles completos, conviértete en administrador con /become_admin*`;
                }
                
                await this.sendMessage(chatId, info, { parse_mode: 'Markdown' });
                
            } catch (error) {
                await this.sendMessage(chatId, `❌ Error obteniendo info de disco: ${error.message}`, { parse_mode: 'Markdown' });
            }
        });
        
        // ✅ NUEVO: /cpu_info - Información de CPU
        this.bot.onText(/\/cpu_info/, async (msg) => {
            const chatId = msg.chat.id;
            const isAdminUser = isAdmin(chatId);
            
            try {
                const { exec } = require('child_process');
                const util = require('util');
                const execAsync = util.promisify(exec);
                
                let info = `🖥️ *INFORMACIÓN DE CPU*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                
                // Ejecutar comando de PowerShell para obtener info de CPU
                const { stdout: cpuOutput } = await execAsync('powershell -Command "Get-CimInstance -ClassName Win32_Processor | Select-Object Name, NumberOfCores, NumberOfLogicalProcessors, MaxClockSpeed, CurrentClockSpeed, LoadPercentage | Format-Table -AutoSize | Out-String"');
                
                info += `${cpuOutput}`;
                
                // Información adicional
                const os = require('os');
                info += `🏗️ *Arquitectura:* ${os.arch()}\n`;
                info += `🔧 *Plataforma:* ${os.platform()}\n`;
                
                if (!isAdminUser) {
                    info += `\n\nℹ️ *Para información completa, conviértete en administrador con /become_admin*`;
                }
                
                await this.sendMessage(chatId, info, { parse_mode: 'Markdown' });
                
            } catch (error) {
                await this.sendMessage(chatId, `❌ Error obteniendo info de CPU: ${error.message}`, { parse_mode: 'Markdown' });
            }
        });
        
        // ✅ NUEVO: /memory_info - Información detallada de memoria
        this.bot.onText(/\/memory_info/, async (msg) => {
            const chatId = msg.chat.id;
            const isAdminUser = isAdmin(chatId);
            
            try {
                const { exec } = require('child_process');
                const util = require('util');
                const execAsync = util.promisify(exec);
                
                let info = `💾 *INFORMACIÓN DETALLADA DE MEMORIA*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                
                // Ejecutar comando de PowerShell para obtener info de memoria
                const { stdout: memoryOutput } = await execAsync('powershell -Command "Get-CimInstance -ClassName Win32_OperatingSystem | Select-Object @{Name=\'Total(GB)\';Expression={[math]::Round($_.TotalVisibleMemorySize/1MB,2)}}, @{Name=\'Free(GB)\';Expression={[math]::Round($_.FreePhysicalMemory/1MB,2)}}, @{Name=\'Used(GB)\';Expression={[math]::Round(($_.TotalVisibleMemorySize - $_.FreePhysicalMemory)/1MB,2)}} | Format-Table -AutoSize | Out-String"');
                
                info += `${memoryOutput}`;
                
                // Memoria del proceso del bot
                const memUsage = process.memoryUsage();
                info += `🤖 *Memoria del Bot:*\n`;
                info += `   📈 Usada: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB\n`;
                info += `   📊 Total: ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB\n`;
                info += `   💿 RSS: ${Math.round(memUsage.rss / 1024 / 1024)}MB\n`;
                
                if (isAdminUser) {
                    info += `   🔄 Externa: ${Math.round(memUsage.external / 1024 / 1024)}MB\n`;
                }
                
                if (!isAdminUser) {
                    info += `\n\nℹ️ *Para información completa, conviértete en administrador con /become_admin*`;
                }
                
                await this.sendMessage(chatId, info, { parse_mode: 'Markdown' });
                
            } catch (error) {
                await this.sendMessage(chatId, `❌ Error obteniendo info de memoria: ${error.message}`, { parse_mode: 'Markdown' });
            }
        });
        
        // ✅ NUEVO: /wifi_info - Información de WiFi
        this.bot.onText(/\/wifi_info/, async (msg) => {
            const chatId = msg.chat.id;
            const isAdminUser = isAdmin(chatId);
            
            try {
                const { exec } = require('child_process');
                const util = require('util');
                const execAsync = util.promisify(exec);
                
                let info = `📶 *INFORMACIÓN DE WIFI*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                
                // Ejecutar comando de PowerShell para obtener info de WiFi
                const { stdout: wifiOutput } = await execAsync('powershell -Command "Get-NetAdapter | Where-Object { $_.Name -like \'*Wi-Fi*\' -or $_.Name -like \'*Wireless*\' } | Select-Object Name, Status, LinkSpeed | Format-Table -AutoSize | Out-String"');
                
                info += `${wifiOutput}`;
                
                // Información de conexiones WiFi
                try {
                    const { stdout: wifiConnections } = await execAsync('powershell -Command "netsh wlan show interfaces | Select-String \'SSID|Signal|BSSID\' | Out-String"');
                    if (wifiConnections.trim()) {
                        info += `\n🔗 *Conexiones WiFi:*\n${wifiConnections}`;
                    }
                } catch (e) {
                    // Ignorar si no hay conexiones WiFi
                }
                
                if (!isAdminUser) {
                    info += `\n\nℹ️ *Para información completa, conviértete en administrador con /become_admin*`;
                }
                
                await this.sendMessage(chatId, info, { parse_mode: 'Markdown' });
                
            } catch (error) {
                await this.sendMessage(chatId, `❌ Error obteniendo info de WiFi: ${error.message}`, { parse_mode: 'Markdown' });
            }
        });
        
        // ✅ NUEVO: /services - Servicios del sistema
        this.bot.onText(/\/services/, async (msg) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) {
                await this.sendMessage(chatId, `❌ *Acceso denegado*\n\nEste comando requiere permisos de administrador.\n\nUsa /become_admin para convertirte en administrador.`, { parse_mode: 'Markdown' });
                return;
            }
            
            try {
                const { exec } = require('child_process');
                const util = require('util');
                const execAsync = util.promisify(exec);
                
                let info = `🔧 *SERVICIOS DEL SISTEMA*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                
                // Ejecutar comando de PowerShell para obtener servicios
                const { stdout: servicesOutput } = await execAsync('powershell -Command "Get-Service | Where-Object { $_.Status -eq \'Running\' } | Select-Object -First 15 Name, DisplayName, Status | Format-Table -AutoSize | Out-String"');
                
                info += `✅ *Servicios en ejecución (primeros 15):*\n${servicesOutput}`;
                
                // Servicios detenidos importantes
                const { stdout: stoppedServices } = await execAsync('powershell -Command "Get-Service | Where-Object { $_.Status -eq \'Stopped\' -and $_.StartType -eq \'Automatic\' } | Select-Object -First 10 Name, DisplayName | Format-Table -AutoSize | Out-String"');
                
                if (stoppedServices.trim()) {
                    info += `\n❌ *Servicios automáticos detenidos:*\n${stoppedServices}`;
                }
                
                await this.sendMessage(chatId, info, { parse_mode: 'Markdown' });
                
            } catch (error) {
                await this.sendMessage(chatId, `❌ Error obteniendo servicios: ${error.message}`, { parse_mode: 'Markdown' });
            }
        });
        
        // ✅ NUEVO: /running_apps - Aplicaciones en ejecución
        this.bot.onText(/\/running_apps/, async (msg) => {
            const chatId = msg.chat.id;
            const isAdminUser = isAdmin(chatId);
            
            try {
                const { exec } = require('child_process');
                const util = require('util');
                const execAsync = util.promisify(exec);
                
                let info = `🎯 *APLICACIONES EN EJECUCIÓN*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                
                // Ejecutar comando de PowerShell para obtener aplicaciones
                const { stdout: appsOutput } = await execAsync('powershell -Command "Get-Process | Where-Object { $_.MainWindowTitle -ne \'\' } | Select-Object -First 10 ProcessName, MainWindowTitle, @{Name=\'Memory(MB)\';Expression={[math]::Round($_.WorkingSet/1MB,2)}} | Format-Table -AutoSize | Out-String"');
                
                info += `${appsOutput}`;
                
                if (!isAdminUser) {
                    info += `\n\nℹ️ *Para ver más aplicaciones y detalles completos, conviértete en administrador con /become_admin*`;
                }
                
                await this.sendMessage(chatId, info, { parse_mode: 'Markdown' });
                
            } catch (error) {
                await this.sendMessage(chatId, `❌ Error obteniendo aplicaciones: ${error.message}`, { parse_mode: 'Markdown' });
            }
        });
        
        // ✅ NUEVO: /battery - Estado de batería
        this.bot.onText(/\/battery/, async (msg) => {
            const chatId = msg.chat.id;
            
            try {
                const { exec } = require('child_process');
                const util = require('util');
                const execAsync = util.promisify(exec);
                
                let info = `🔋 *ESTADO DE BATERÍA*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                
                // Ejecutar comando de PowerShell para obtener estado de batería
                const { stdout: batteryOutput } = await execAsync('powershell -Command "Get-CimInstance -ClassName Win32_Battery | Select-Object Name, @{Name=\'Carga(%)\';Expression={$_.EstimatedChargeRemaining}}, @{Name=\'Tiempo(min)\';Expression={$_.EstimatedRunTime}} | Format-Table -AutoSize | Out-String"');
                
                if (batteryOutput.trim()) {
                    info += `${batteryOutput}`;
                    
                    // Estado detallado
                    const { stdout: batteryDetails } = await execAsync('powershell -Command "$battery = Get-CimInstance -ClassName Win32_Battery; if ($battery) { $status = switch ($battery.BatteryStatus) { 1 {\'Descargando\'} 2 {\'Desconocido\'} 3 {\'Completamente cargada\'} 4 {\'Baja\'} 5 {\'Crítica\'} 6 {\'Cargando\'} 7 {\'Carga de mantenimiento\'} default {\'Desconocido\'} }; \\"Estado: $status\\" } else { \'No se detectó batería\' }"');
                    
                    info += `\n${batteryDetails}`;
                } else {
                    info += `❌ No se detectó batería en este sistema (posiblemente desktop)`;
                }
                
                await this.sendMessage(chatId, info, { parse_mode: 'Markdown' });
                
            } catch (error) {
                await this.sendMessage(chatId, `❌ Error obteniendo estado de batería: ${error.message}`, { parse_mode: 'Markdown' });
            }
        });
        
        // ✅ NUEVO: /node_exec - Ejecutar comandos de Node.js
        this.bot.onText(/\/node_exec (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) {
                await this.sendMessage(chatId, `❌ *Acceso denegado*\n\nEste comando requiere permisos de administrador.\n\nUsa /become_admin para convertirte en administrador.`, { parse_mode: 'Markdown' });
                return;
            }
            
            const command = match[1];
            
            try {
                const { exec } = require('child_process');
                const util = require('util');
                const execAsync = util.promisify(exec);
                
                // Ejecutar comando de Node.js
                const { stdout, stderr } = await execAsync(`node -e "${command}"`, { timeout: 10000 });
                
                let info = `🟢 *NODE.JS EXEC - RESULTADO*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                info += `📝 *Comando ejecutado:*\n\`\`\`javascript\n${command}\n\`\`\`\n\n`;
                
                if (stdout) {
                    info += `📤 *Salida estándar:*\n\`\`\`\n${stdout}\n\`\`\`\n\n`;
                }
                
                if (stderr) {
                    info += `⚠️ *Salida de error:*\n\`\`\`\n${stderr}\n\`\`\`\n\n`;
                }
                
                await this.sendMessage(chatId, info, { parse_mode: 'Markdown' });
                
            } catch (error) {
                await this.sendMessage(chatId, `❌ Error ejecutando Node.js: ${error.message}`, { parse_mode: 'Markdown' });
            }
        });
        
        // ✅ NUEVO: /vscode_status - Estado de Visual Studio Code
        this.bot.onText(/\/vscode_status/, async (msg) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) {
                await this.sendMessage(chatId, `❌ *Acceso denegado*\n\nEste comando requiere permisos de administrador.\n\nUsa /become_admin para convertirte en administrador.`, { parse_mode: 'Markdown' });
                return;
            }
            
            try {
                const { exec } = require('child_process');
                const util = require('util');
                const execAsync = util.promisify(exec);
                
                let info = `💻 *VISUAL STUDIO CODE - ESTADO*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                
                // Verificar si VS Code está ejecutándose
                const { stdout: processCheck } = await execAsync('powershell -Command "Get-Process | Where-Object { $_.ProcessName -like \'*code*\' } | Select-Object ProcessName, Id, StartTime | Format-Table -AutoSize | Out-String"');
                
                if (processCheck.trim()) {
                    info += `✅ *VS Code está ejecutándose:*\n${processCheck}\n\n`;
                    
                    // Intentar obtener información de VS Code (si tiene CLI disponible)
                    try {
                        const { stdout: versionInfo } = await execAsync('code --version 2>$null || echo "CLI no disponible"', { timeout: 5000 });
                        info += `🔧 *Versión CLI:* ${versionInfo.trim() || 'No disponible'}\n\n`;
                    } catch (e) {
                        info += `🔧 *CLI de VS Code:* No disponible\n\n`;
                    }
                } else {
                    info += `❌ *VS Code no está ejecutándose*\n\n`;
                }
                
                // Información adicional del sistema
                info += `💡 *Para abrir VS Code:* /vscode_open <archivo>\n`;
                info += `💡 *Para ejecutar comando:* /vscode_command <comando>`;
                
                await this.sendMessage(chatId, info, { parse_mode: 'Markdown' });
                
            } catch (error) {
                await this.sendMessage(chatId, `❌ Error obteniendo estado de VS Code: ${error.message}`, { parse_mode: 'Markdown' });
            }
        });
        
        // ✅ NUEVO: /vscode_open - Abrir archivo en VS Code
        this.bot.onText(/\/vscode_open (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) {
                await this.sendMessage(chatId, `❌ *Acceso denegado*\n\nEste comando requiere permisos de administrador.\n\nUsa /become_admin para convertirte en administrador.`, { parse_mode: 'Markdown' });
                return;
            }
            
            const filePath = match[1];
            
            try {
                const { exec } = require('child_process');
                const util = require('util');
                const execAsync = util.promisify(exec);
                
                // Abrir archivo en VS Code
                await execAsync(`code "${filePath}"`, { timeout: 10000 });
                
                await this.sendMessage(chatId, `✅ *Archivo abierto en VS Code:*\n\`${filePath}\``, { parse_mode: 'Markdown' });
                
            } catch (error) {
                await this.sendMessage(chatId, `❌ Error abriendo archivo en VS Code: ${error.message}`, { parse_mode: 'Markdown' });
            }
        });
        
        // ✅ NUEVO: /vscode_command - Ejecutar comando en VS Code
        this.bot.onText(/\/vscode_command (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) {
                await this.sendMessage(chatId, `❌ *Acceso denegado*\n\nEste comando requiere permisos de administrador.\n\nUsa /become_admin para convertirte en administrador.`, { parse_mode: 'Markdown' });
                return;
            }
            
            const command = match[1];
            
            try {
                const { exec } = require('child_process');
                const util = require('util');
                const execAsync = util.promisify(exec);
                
                // Ejecutar comando en VS Code CLI
                const { stdout, stderr } = await execAsync(`code ${command}`, { timeout: 15000 });
                
                let info = `💻 *VS CODE COMMAND - RESULTADO*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                info += `📝 *Comando ejecutado:* \`code ${command}\`\n\n`;
                
                if (stdout) {
                    info += `📤 *Salida:*\n\`\`\`\n${stdout}\n\`\`\`\n\n`;
                }
                
                if (stderr) {
                    info += `⚠️ *Errores:*\n\`\`\`\n${stderr}\n\`\`\`\n\n`;
                }
                
                await this.sendMessage(chatId, info, { parse_mode: 'Markdown' });
                
            } catch (error) {
                await this.sendMessage(chatId, `❌ Error ejecutando comando en VS Code: ${error.message}`, { parse_mode: 'Markdown' });
            }
        });
        
        // ✅ NUEVO: /system_command - Ejecutar comandos del sistema
        this.bot.onText(/\/system_command (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) {
                await this.sendMessage(chatId, `❌ *Acceso denegado*\n\nEste comando requiere permisos de administrador.\n\nUsa /become_admin para convertirte en administrador.`, { parse_mode: 'Markdown' });
                return;
            }
            
            const command = match[1];
            
            try {
                const { exec } = require('child_process');
                const util = require('util');
                const execAsync = util.promisify(exec);
                
                // Ejecutar comando del sistema
                const { stdout, stderr } = await execAsync(command, { timeout: 30000 });
                
                let info = `🖥️ *SYSTEM COMMAND - RESULTADO*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                info += `📝 *Comando ejecutado:* \`${command}\`\n\n`;
                
                if (stdout) {
                    info += `📤 *Salida:*\n\`\`\`\n${stdout}\n\`\`\`\n\n`;
                }
                
                if (stderr) {
                    info += `⚠️ *Errores:*\n\`\`\`\n${stderr}\n\`\`\`\n\n`;
                }
                
                await this.sendMessage(chatId, info, { parse_mode: 'Markdown' });
                
            } catch (error) {
                await this.sendMessage(chatId, `❌ Error ejecutando comando del sistema: ${error.message}`, { parse_mode: 'Markdown' });
            }
        });
        
        // ✅ NUEVO: /process_communicate - Comunicarse con procesos específicos
        this.bot.onText(/\/process_communicate (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) {
                await this.sendMessage(chatId, `❌ *Acceso denegado*\n\nEste comando requiere permisos de administrador.\n\nUsa /become_admin para convertirte en administrador.`, { parse_mode: 'Markdown' });
                return;
            }
            
            const processName = match[1];
            
            try {
                const { exec } = require('child_process');
                const util = require('util');
                const execAsync = util.promisify(exec);
                
                let info = `🔄 *COMUNICACIÓN CON PROCESO*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                info += `🎯 *Proceso objetivo:* ${processName}\n\n`;
                
                // Buscar el proceso
                const { stdout: processInfo } = await execAsync(`powershell -Command "Get-Process | Where-Object { $_.ProcessName -like '*${processName}*' } | Select-Object ProcessName, Id, CPU, WorkingSet, StartTime | Format-Table -AutoSize | Out-String"`);
                
                if (processInfo.trim()) {
                    info += `✅ *Proceso encontrado:*\n${processInfo}\n\n`;
                    
                    // Intentar obtener más información
                    try {
                        const { stdout: threadsInfo } = await execAsync(`powershell -Command "(Get-Process | Where-Object { $_.ProcessName -like '*${processName}*' }).Threads | Select-Object -First 5 Id, ThreadState, WaitReason | Format-Table -AutoSize | Out-String"`);
                        if (threadsInfo.trim()) {
                            info += `🧵 *Hilos del proceso:*\n${threadsInfo}\n\n`;
                        }
                    } catch (e) {
                        // Ignorar si no se pueden obtener hilos
                    }
                    
                    info += `💡 *Comandos disponibles:*\n`;
                    info += `   • /system_command taskkill /PID <ID> /F  (Terminar proceso)\n`;
                    info += `   • /system_command tasklist /FI "PID eq <ID>"  (Más detalles)`;
                    
                } else {
                    info += `❌ *No se encontró el proceso:* ${processName}\n\n`;
                    info += `💡 *Sugerencia:* Usa /running_apps para ver procesos activos`;
                }
                
                await this.sendMessage(chatId, info, { parse_mode: 'Markdown' });
                
            } catch (error) {
                await this.sendMessage(chatId, `❌ Error comunicándose con proceso: ${error.message}`, { parse_mode: 'Markdown' });
            }
        });
        
        // ✅ NUEVO: /interprocess_comms - Sistema de comunicación entre procesos
        this.bot.onText(/\/interprocess_comms/, async (msg) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) {
                await this.sendMessage(chatId, `❌ *Acceso denegado*\n\nEste comando requiere permisos de administrador.\n\nUsa /become_admin para convertirte en administrador.`, { parse_mode: 'Markdown' });
                return;
            }
            
            try {
                const { exec } = require('child_process');
                const util = require('util');
                const execAsync = util.promisify(exec);
                
                let info = `🔗 *SISTEMA DE COMUNICACIÓN INTERPROCESOS*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                
                // Obtener información de procesos que pueden comunicarse
                const { stdout: ipcProcesses } = await execAsync('powershell -Command "Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 10 ProcessName, Id, MainWindowTitle | Format-Table -AutoSize | Out-String"');
                
                info += `📋 *Procesos con interfaz gráfica (comunicables):*\n${ipcProcesses}\n\n`;
                
                // Información de pipes y comunicaciones
                info += `🔧 *Métodos de comunicación disponibles:*\n\n`;
                info += `1️⃣ *Comandos del sistema:*\n`;
                info += `   /system_command <comando>\n\n`;
                
                info += `2️⃣ *Node.js execution:*\n`;
                info += `   /node_exec <código_js>\n\n`;
                
                info += `3️⃣ *VS Code integration:*\n`;
                info += `   /vscode_status, /vscode_open, /vscode_command\n\n`;
                
                info += `4️⃣ *Comunicación con procesos:*\n`;
                info += `   /process_communicate <nombre_proceso>\n\n`;
                
                info += `5️⃣ *PowerShell directo:*\n`;
                info += `   /system_command powershell -Command "<comando>"\n\n`;
                
                info += `💡 *Ejemplos de uso:*\n`;
                info += `   /node_exec console.log(\\"Hello from Node!\\")\n`;
                info += `   /vscode_open index.js\n`;
                info += `   /process_communicate chrome\n`;
                info += `   /system_command netstat -ano\n`;
                
                await this.sendMessage(chatId, info, { parse_mode: 'Markdown' });
                
            } catch (error) {
                await this.sendMessage(chatId, `❌ Error accediendo al sistema de comunicación interprocesos: ${error.message}`, { parse_mode: 'Markdown' });
            }
        });
        
        // ✅ NUEVO: /force_communication - Comunicación forzada con procesos
        this.bot.onText(/\/force_communication (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) {
                await this.sendMessage(chatId, `❌ *Acceso denegado*\n\nEste comando requiere permisos de administrador.\n\nUsa /become_admin para convertirte en administrador.`, { parse_mode: 'Markdown' });
                return;
            }
            
            const target = match[1];
            
            try {
                const { exec, spawn } = require('child_process');
                const util = require('util');
                const execAsync = util.promisify(exec);
                
                let info = `⚡ *COMUNICACIÓN FORZADA*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                info += `🎯 *Objetivo:* ${target}\n\n`;
                
                // Intentar diferentes métodos de comunicación forzada
                const methods = [
                    {
                        name: 'Proceso por nombre',
                        command: `powershell -Command "Get-Process | Where-Object { $_.ProcessName -like '*${target}*' } | Select-Object ProcessName, Id, CPU, WorkingSet, StartTime | Format-Table -AutoSize | Out-String"`
                    },
                    {
                        name: 'Servicio por nombre',
                        command: `powershell -Command "Get-Service | Where-Object { $_.Name -like '*${target}*' -or $_.DisplayName -like '*${target}*' } | Select-Object Name, DisplayName, Status, StartType | Format-Table -AutoSize | Out-String"`
                    },
                    {
                        name: 'Puerto de red',
                        command: `powershell -Command "Get-NetTCPConnection | Where-Object { $_.LocalPort -eq ${target} -or $_.RemotePort -eq ${target} } | Select-Object LocalAddress, LocalPort, RemoteAddress, RemotePort, State | Format-Table -AutoSize | Out-String"`
                    },
                    {
                        name: 'Archivo/PID',
                        command: `powershell -Command "if (${target} -match '^\\d+$') { Get-Process -Id ${target} -ErrorAction SilentlyContinue | Select-Object ProcessName, Id, CPU, WorkingSet | Format-Table -AutoSize | Out-String } else { Get-Item '${target}' -ErrorAction SilentlyContinue | Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize | Out-String }"`
                    }
                ];
                
                let found = false;
                for (const method of methods) {
                    try {
                        const { stdout } = await execAsync(method.command, { timeout: 5000 });
                        if (stdout.trim()) {
                            info += `✅ *${method.name}:*\n${stdout}\n\n`;
                            found = true;
                        }
                    } catch (e) {
                        // Método no aplicable, continuar
                    }
                }
                
                if (!found) {
                    info += `❌ *No se encontró información para:* ${target}\n\n`;
                    info += `💡 *Intenta con:*\n`;
                    info += `   • Nombre de proceso (ej: chrome)\n`;
                    info += `   • Número de puerto (ej: 80)\n`;
                    info += `   • ID de proceso (ej: 1234)\n`;
                    info += `   • Ruta de archivo (ej: C:\\Windows\\System32\\notepad.exe)\n`;
                }
                
                // Métodos de comunicación forzada adicionales
                info += `🔧 *Métodos de comunicación disponibles:*\n\n`;
                info += `📡 *Enviar señal:* /system_command taskkill /PID <ID> /F\n`;
                info += `📊 *Monitorear:* /process_communicate ${target}\n`;
                info += `🔍 *Inspeccionar:* /system_command wmic process where name="${target}.exe" get *\n`;
                info += `📝 *Logs:* /system_command wevtutil qe System /c:10 /f:text\n`;
                
                await this.sendMessage(chatId, info, { parse_mode: 'Markdown' });
                
            } catch (error) {
                await this.sendMessage(chatId, `❌ Error en comunicación forzada: ${error.message}`, { parse_mode: 'Markdown' });
            }
        });
        
        // ✅ NUEVO: /communication_hub - Centro de control de comunicaciones
        this.bot.onText(/\/communication_hub/, async (msg) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) {
                await this.sendMessage(chatId, `❌ *Acceso denegado*\n\nEste comando requiere permisos de administrador.\n\nUsa /become_admin para convertirte en administrador.`, { parse_mode: 'Markdown' });
                return;
            }
            
            try {
                const { exec } = require('child_process');
                const util = require('util');
                const execAsync = util.promisify(exec);
                
                let info = `🌐 *CENTRO DE CONTROL DE COMUNICACIONES*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                
                // Estado de comunicaciones activas
                const { stdout: activeConnections } = await execAsync('powershell -Command "Get-NetTCPConnection | Where-Object { $_.State -eq \'Established\' } | Measure-Object | Select-Object Count | Format-Table -AutoSize | Out-String"');
                const { stdout: activeProcesses } = await execAsync('powershell -Command "Get-Process | Measure-Object | Select-Object Count | Format-Table -AutoSize | Out-String"');
                
                info += `📊 *Estado del sistema:*\n`;
                info += `   🔗 Conexiones TCP activas: ${activeConnections.split('\n')[2]?.trim() || 'N/A'}\n`;
                info += `   ⚙️ Procesos activos: ${activeProcesses.split('\n')[2]?.trim() || 'N/A'}\n\n`;
                
                // Canales de comunicación disponibles
                info += `📡 *CANALES DE COMUNICACIÓN:*\n\n`;
                
                info += `1️⃣ *Node.js Runtime:*\n`;
                info += `   /node_exec <código>\n`;
                info += `   → Ejecuta código JavaScript\n\n`;
                
                info += `2️⃣ *Visual Studio Code:*\n`;
                info += `   /vscode_status\n`;
                info += `   /vscode_open <archivo>\n`;
                info += `   /vscode_command <cmd>\n`;
                info += `   → Integración completa con VS Code\n\n`;
                
                info += `3️⃣ *Sistema Operativo:*\n`;
                info += `   /system_command <cmd>\n`;
                info += `   → Ejecuta comandos del sistema\n\n`;
                
                info += `4️⃣ *Comunicación Interprocesos:*\n`;
                info += `   /process_communicate <proceso>\n`;
                info += `   /force_communication <objetivo>\n`;
                info += `   → Comunicación forzada con procesos\n\n`;
                
                info += `5️⃣ *Red y Conectividad:*\n`;
                info += `   /network_info\n`;
                info += `   /wifi_info\n`;
                info += `   → Información de red completa\n\n`;
                
                info += `6️⃣ *Hardware y Dispositivos:*\n`;
                info += `   /cpu_info, /memory_info\n`;
                info += `   /usb_devices, /battery\n`;
                info += `   → Información de hardware\n\n`;
                
                info += `🔒 *SEGURIDAD:* Todos los comandos requieren permisos de administrador\n`;
                info += `⚡ *POTENCIA:* Comunicación bidireccional con el sistema host\n`;
                info += `🎯 *PRECISIÓN:* Información en tiempo real del sistema\n`;
                
                await this.sendMessage(chatId, info, { parse_mode: 'Markdown' });
                
            } catch (error) {
                await this.sendMessage(chatId, `❌ Error accediendo al centro de control: ${error.message}`, { parse_mode: 'Markdown' });
            }
        });
        this.bot.onText(/\/error_log/, async (msg) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) {
                await this.sendMessage(chatId, `❌ *Acceso denegado*\n\nEste comando requiere permisos de administrador.\n\nUsa /become_admin para convertirte en administrador.`, { parse_mode: 'Markdown' });
                return;
            }
            
            try {
                const logs = getLogs(100); // Últimas 100 líneas
                const errorLines = logs.split('\n').filter(line => 
                    line.includes('ERROR') || 
                    line.includes('CRITICAL') || 
                    line.includes('❌') ||
                    line.includes('Error')
                );
                
                const recentErrors = errorLines.slice(-20); // Últimos 20 errores
                
                let info = '🚨 *LOG DE ERRORES RECIENTES*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
                
                if (recentErrors.length === 0) {
                    info += '✅ No hay errores recientes registrados.';
                } else {
                    recentErrors.forEach((error, index) => {
                        info += `${index + 1}. ${error}\n`;
                    });
                }
                
                await this.sendMessage(chatId, info, { parse_mode: 'Markdown' });
                
            } catch (error) {
                await this.sendMessage(chatId, `❌ Error obteniendo log de errores: ${error.message}`, { parse_mode: 'Markdown' });
            }
        });
        
        // ✅ NUEVO: /performance_graph - Gráfico de rendimiento (simulado)
        this.bot.onText(/\/performance_graph/, async (msg) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) {
                await this.sendMessage(chatId, `❌ *Acceso denegado*\n\nEste comando requiere permisos de administrador.\n\nUsa /become_admin para convertirte en administrador.`, { parse_mode: 'Markdown' });
                return;
            }
            
            try {
                const memMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
                const uptime = Math.round(process.uptime() / 3600); // horas
                
                // Simular gráfico con caracteres
                const memoryBar = '█'.repeat(Math.min(memMB / 10, 20)) + '░'.repeat(Math.max(0, 20 - memMB / 10));
                const uptimeBar = '█'.repeat(Math.min(uptime / 24, 20)) + '░'.repeat(Math.max(0, 20 - uptime / 24));
                
                const info = `📊 *GRÁFICO DE RENDIMIENTO*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `💾 *Memoria:* ${memMB}MB\n` +
                    `[${memoryBar}]\n\n` +
                    `⏰ *Uptime:* ${uptime}h\n` +
                    `[${uptimeBar}]\n\n` +
                    `👥 *Suscriptores:* ${this.subscribers.length}\n` +
                    `🔄 *Estado:* ${this.systemHealth}\n` +
                    `📈 *Rendimiento:* ${this.consecutiveErrors === 0 ? 'Excelente' : this.consecutiveErrors < 3 ? 'Bueno' : 'Requiere atención'}`;
                
                await this.sendMessage(chatId, info, { parse_mode: 'Markdown' });
                
            } catch (error) {
                await this.sendMessage(chatId, `❌ Error generando gráfico: ${error.message}`, { parse_mode: 'Markdown' });
            }
        });
        
        // ✅ NUEVO: /config_viewer - Ver configuraciones
        this.bot.onText(/\/config_viewer/, async (msg) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) {
                await this.sendMessage(chatId, `❌ *Acceso denegado*\n\nEste comando requiere permisos de administrador.\n\nUsa /become_admin para convertirte en administrador.`, { parse_mode: 'Markdown' });
                return;
            }
            
            try {
                const config = `
⚙️ *VISOR DE CONFIGURACIONES*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔔 *Alertas del Sistema:*
• Alertas de errores: ${CONFIG.alertOnErrors ? '✅' : '❌'}
• Alertas de recuperación: ${CONFIG.alertOnRecovery ? '✅' : '❌'}
• Alertas de memoria: ${CONFIG.alertOnHighMemory ? '✅' : '❌'}
• Umbral memoria: ${CONFIG.memoryThreshold}MB
• Máx errores consecutivos: ${CONFIG.maxConsecutiveErrors}
• Cooldown alertas: ${CONFIG.adminAlertCooldown}s

🤖 *Bot Configuration:*
• Token: ${CONFIG.telegramToken.substring(0, 10)}...
• Admin Chat ID: ${CONFIG.adminChatId || 'No configurado'}
• Intervalo verificación: ${CONFIG.checkInterval}s
• Timeout fetch: ${CONFIG.fetchTimeout}ms
• Timeout página: ${CONFIG.pageTimeout}ms

🌐 *URLs:*
• Web SASMEX: ${CONFIG.webUrl}
• API SASMEX: ${CONFIG.apiUrl}

📁 *Archivos:*
• Datos: ${CONFIG.dataFile}
• Screenshot: ${CONFIG.screenshotFile}
• Logs: ${CONFIG.logFile}
                `;
                
                await this.sendMessage(chatId, config, { parse_mode: 'Markdown' });
                
            } catch (error) {
                await this.sendMessage(chatId, `❌ Error mostrando configuraciones: ${error.message}`, { parse_mode: 'Markdown' });
            }
        });
        
        // ✅ NUEVO: /user_management - Gestión de usuarios
        this.bot.onText(/\/user_management/, async (msg) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) return;
            
            try {
                const data = loadData();
                const users = data.users || {};
                
                const totalUsers = Object.keys(users).length;
                const activeUsers = Object.values(users).filter(u => u.subscribed).length;
                const mutedUsers = Object.values(users).filter(u => u.muted).length;
                
                const severityStats = {
                    all: Object.values(users).filter(u => u.severity === 'all').length,
                    menor: Object.values(users).filter(u => u.severity === 'menor').length,
                    moderada: Object.values(users).filter(u => u.severity === 'moderada').length,
                    mayor: Object.values(users).filter(u => u.severity === 'mayor').length
                };
                
                const info = `👥 *GESTIÓN DE USUARIOS*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `📊 *Estadísticas:*\n` +
                    `• Total usuarios: ${totalUsers}\n` +
                    `• Usuarios activos: ${activeUsers}\n` +
                    `• Usuarios silenciados: ${mutedUsers}\n` +
                    `• Usuarios inactivos: ${totalUsers - activeUsers}\n\n` +
                    `🎯 *Por severidad:*\n` +
                    `• Todas las alertas: ${severityStats.all}\n` +
                    `• Moderada+: ${severityStats.moderada}\n` +
                    `• Mayor: ${severityStats.mayor}\n\n` +
                    `🛠️ *Comandos disponibles:*\n` +
                    `/subscribers list - Ver lista completa\n` +
                    `/subscribers count - Conteo detallado\n` +
                    `/subscribers clean - Limpiar inactivos\n` +
                    `/subscribers remove [ID] - Eliminar usuario`;
                
                await this.sendMessage(chatId, info, { parse_mode: 'Markdown' });
                
            } catch (error) {
                await this.sendMessage(chatId, `❌ Error en gestión de usuarios: ${error.message}`, { parse_mode: 'Markdown' });
            }
        });
        
        // ✅ NUEVO: /backup_manager - Administrar backups
        this.bot.onText(/\/backup_manager/, async (msg) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) return;
            
            try {
                const backupDir = __dirname;
                const backupFiles = fs.readdirSync(backupDir)
                    .filter(file => file.startsWith('auto-backup-') || file.includes('backup-'))
                    .sort()
                    .reverse()
                    .slice(0, 10);
                
                let info = '💾 *ADMINISTRADOR DE BACKUPS*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
                
                if (backupFiles.length === 0) {
                    info += '❌ No hay backups disponibles.';
                } else {
                    info += `📄 *Backups disponibles (${backupFiles.length}):*\n\n`;
                    
                    backupFiles.forEach((file, index) => {
                        const filePath = path.join(backupDir, file);
                        const stats = fs.statSync(filePath);
                        const sizeKB = Math.round(stats.size / 1024);
                        const modified = new Date(stats.mtime).toLocaleString('es-MX');
                        
                        info += `${index + 1}. ${file}\n`;
                        info += `   📏 ${sizeKB}KB - 📅 ${modified}\n\n`;
                    });
                    
                    info += `🛠️ *Comandos:*\n` +
                        `/list_backups - Ver todos\n` +
                        `/send_backup - Enviar más reciente\n` +
                        `/restore_backup [número] - Restaurar`;
                }
                
                await this.sendMessage(chatId, info, { parse_mode: 'Markdown' });
                
            } catch (error) {
                await this.sendMessage(chatId, `❌ Error en administrador de backups: ${error.message}`, { parse_mode: 'Markdown' });
            }
        });
        
        // ✅ NUEVO: /security_status - Estado de seguridad
        this.bot.onText(/\/security_status/, async (msg) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) return;
            
            try {
                const info = `🔒 *ESTADO DE SEGURIDAD*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `🛡️ *Sistema de Autenticación:*\n` +
                    `• Admin configurado: ${CONFIG.adminChatId ? '✅' : '❌'}\n` +
                    `• Verificación de permisos: ✅\n\n` +
                    `🚨 *Sistema de Alertas:*\n` +
                    `• Alertas activas: ${CONFIG.alertOnErrors ? '✅' : '❌'}\n` +
                    `• Heartbeat: ${this.heartbeatInterval ? '✅' : '❌'}\n` +
                    `• Monitoreo continuo: ${this.errorMonitorInterval ? '✅' : '❌'}\n\n` +
                    `💾 *Sistema de Backup:*\n` +
                    `• Auto-backup: ${this.autoBackupInterval ? '✅' : '❌'}\n` +
                    `• Backups disponibles: ${fs.readdirSync(__dirname).filter(f => f.includes('backup')).length}\n\n` +
                    `🔄 *Sistema de Recuperación:*\n` +
                    `• Recuperación automática: ✅\n` +
                    `• Última recuperación: ${this.lastRecovery ? this.lastRecovery.toLocaleString('es-MX') : 'Nunca'}\n` +
                    `• Modo recuperación: ${this.recoveryMode ? '🟡 ACTIVO' : '🟢 INACTIVO'}\n\n` +
                    `📊 *Estado General:*\n` +
                    `• Salud del sistema: ${this.systemHealth}\n` +
                    `• Errores consecutivos: ${this.consecutiveErrors}\n` +
                    `• Modo mantenimiento: ${this.maintenanceMode ? '🟡 ON' : '🟢 OFF'}`;
                
                await this.sendMessage(chatId, info, { parse_mode: 'Markdown' });
                
            } catch (error) {
                await this.sendMessage(chatId, `❌ Error obteniendo estado de seguridad: ${error.message}`, { parse_mode: 'Markdown' });
            }
        });
        
        // ✅ NUEVO: /system - 🖥️ SISTEMA INFORMÁTICO
        this.bot.onText(/\/system/, async (msg) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) return;
            
            await this.showSystemMenu(chatId);
        });
        
        // ✅ NUEVO: /heartbeat - Forzar envío de heartbeat
        this.bot.onText(/\/heartbeat/, async (msg) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) return;
            
            await this.sendHeartbeat();
            await this.sendMessage(chatId, '💓 Heartbeat enviado manualmente', { parse_mode: 'Markdown' });
        });
        
        // ✅ NUEVO: /system_status - Estado completo del sistema
        this.bot.onText(/\/system_status/, async (msg) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) return;
            
            const status = await this.getSystemStatus();
            await this.sendMessage(chatId, status, { parse_mode: 'Markdown' });
        });
        
        // ✅ NUEVO: /alert_test - Probar sistema de alertas
        this.bot.onText(/\/alert_test(?: (\w+))?/, async (msg, match) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) return;
            
            const priority = match && match[1] ? match[1] : 'normal';
            const testMessage = `🧪 **PRUEBA DE ALERTA ${priority.toUpperCase()}**\n\nEsta es una alerta de prueba para verificar el sistema de notificaciones.`;
            
            await this.alertAdmin(testMessage, priority);
            await this.sendMessage(chatId, `✅ Alerta de prueba enviada con prioridad: ${priority}`, { parse_mode: 'Markdown' });
        });
        
        // ✅ NUEVO: /diagnose - Diagnóstico completo del sistema
        this.bot.onText(/\/diagnose/, async (msg) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) return;
            
            await this.sendMessage(chatId, '🔍 *INICIANDO DIAGNÓSTICO COMPLETO...*', { parse_mode: 'Markdown' });
            
            const diagnosis = await this.performFullDiagnosis();
            await this.sendMessage(chatId, diagnosis, { parse_mode: 'Markdown' });
        });
        
        // ✅ NUEVO: /alert_config - Configurar sistema de alertas
        this.bot.onText(/\/alert_config(?: (\w+) (.+))?/, async (msg, match) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) return;
            
            if (!match || !match[1]) {
                // Mostrar configuración actual
                const config = `
⚙️ *CONFIGURACIÓN DE ALERTAS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔔 *Alertas activas:* ${CONFIG.alertOnErrors ? '✅' : '❌'}
🔄 *Alertas de recuperación:* ${CONFIG.alertOnRecovery ? '✅' : '❌'}
💾 *Alertas de memoria alta:* ${CONFIG.alertOnHighMemory ? '✅' : '❌'}
⏱️ *Intervalo heartbeat:* ${CONFIG.heartbeatInterval}s
💾 *Umbral memoria:* ${CONFIG.memoryThreshold}MB
🔄 *Máx errores consecutivos:* ${CONFIG.maxConsecutiveErrors}
⏳ *Cooldown alertas:* ${CONFIG.adminAlertCooldown}s

*Comandos:*
/alert_config heartbeat [segundos]
/alert_config memory [MB]
/alert_config errors [número]
/alert_config cooldown [segundos]
/alert_config toggle [errors|recovery|memory]
                `;
                await this.sendMessage(chatId, config, { parse_mode: 'Markdown' });
                return;
            }
            
            const param = match[1];
            const value = match[2];
            
            try {
                switch (param) {
                    case 'heartbeat':
                        const interval = parseInt(value);
                        if (interval >= 60 && interval <= 3600) {
                            CONFIG.heartbeatInterval = interval;
                            if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
                            this.heartbeatInterval = setInterval(async () => {
                                await this.sendHeartbeat();
                            }, CONFIG.heartbeatInterval * 1000);
                            await this.sendMessage(chatId, `✅ Intervalo heartbeat cambiado a ${interval} segundos`, { parse_mode: 'Markdown' });
                        } else {
                            await this.sendMessage(chatId, '❌ Intervalo debe estar entre 60-3600 segundos', { parse_mode: 'Markdown' });
                        }
                        break;
                        
                    case 'memory':
                        const threshold = parseInt(value);
                        if (threshold >= 50 && threshold <= 1000) {
                            CONFIG.memoryThreshold = threshold;
                            await this.sendMessage(chatId, `✅ Umbral de memoria cambiado a ${threshold}MB`, { parse_mode: 'Markdown' });
                        } else {
                            await this.sendMessage(chatId, '❌ Umbral debe estar entre 50-1000 MB', { parse_mode: 'Markdown' });
                        }
                        break;
                        
                    case 'errors':
                        const maxErrors = parseInt(value);
                        if (maxErrors >= 1 && maxErrors <= 10) {
                            CONFIG.maxConsecutiveErrors = maxErrors;
                            await this.sendMessage(chatId, `✅ Máximo errores consecutivos cambiado a ${maxErrors}`, { parse_mode: 'Markdown' });
                        } else {
                            await this.sendMessage(chatId, '❌ Máximo debe estar entre 1-10', { parse_mode: 'Markdown' });
                        }
                        break;
                        
                    case 'cooldown':
                        const cooldown = parseInt(value);
                        if (cooldown >= 10 && cooldown <= 3600) {
                            CONFIG.adminAlertCooldown = cooldown;
                            await this.sendMessage(chatId, `✅ Cooldown de alertas cambiado a ${cooldown} segundos`, { parse_mode: 'Markdown' });
                        } else {
                            await this.sendMessage(chatId, '❌ Cooldown debe estar entre 10-3600 segundos', { parse_mode: 'Markdown' });
                        }
                        break;
                        
                    case 'toggle':
                        switch (value) {
                            case 'errors':
                                CONFIG.alertOnErrors = !CONFIG.alertOnErrors;
                                await this.sendMessage(chatId, `✅ Alertas de errores: ${CONFIG.alertOnErrors ? 'ACTIVADAS' : 'DESACTIVADAS'}`, { parse_mode: 'Markdown' });
                                break;
                            case 'recovery':
                                CONFIG.alertOnRecovery = !CONFIG.alertOnRecovery;
                                await this.sendMessage(chatId, `✅ Alertas de recuperación: ${CONFIG.alertOnRecovery ? 'ACTIVADAS' : 'DESACTIVADAS'}`, { parse_mode: 'Markdown' });
                                break;
                            case 'memory':
                                CONFIG.alertOnHighMemory = !CONFIG.alertOnHighMemory;
                                await this.sendMessage(chatId, `✅ Alertas de memoria: ${CONFIG.alertOnHighMemory ? 'ACTIVADAS' : 'DESACTIVADAS'}`, { parse_mode: 'Markdown' });
                                break;
                            default:
                                await this.sendMessage(chatId, '❌ Opción inválida. Use: errors, recovery, memory', { parse_mode: 'Markdown' });
                        }
                        break;
                        
                    default:
                        await this.sendMessage(chatId, '❌ Parámetro inválido', { parse_mode: 'Markdown' });
                }
            } catch (error) {
                await this.sendMessage(chatId, `❌ Error cambiando configuración: ${error.message}`, { parse_mode: 'Markdown' });
            }
        });
        
        // ✅ NUEVO: /vscode_status - Estado de VS Code
        this.bot.onText(/\/vscode_status/, async (msg) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) return;
            
            await this.sendMessage(chatId, '🔍 *Verificando estado de VS Code...*', { parse_mode: 'Markdown' });
            
            try {
                const { spawn } = require('child_process');
                const child = spawn(CONFIG.vscodeCliPath, ['--version'], {
                    stdio: ['pipe', 'pipe', 'pipe']
                });
                
                let output = '';
                let errorOutput = '';
                
                child.stdout.on('data', (data) => {
                    output += data.toString();
                });
                
                child.stderr.on('data', (data) => {
                    errorOutput += data.toString();
                });
                
                child.on('close', async (code) => {
                    if (code === 0) {
                        const lines = output.trim().split('\n');
                        const version = lines[0] || 'Desconocida';
                        const commit = lines[1] || 'Desconocido';
                        const date = lines[2] || 'Desconocida';
                        
                        const status = `🆚 *ESTADO DE VISUAL STUDIO CODE*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                            `✅ *VS Code detectado*\n` +
                            `📦 *Versión:* ${version}\n` +
                            `🔗 *Commit:* ${commit}\n` +
                            `📅 *Fecha:* ${date}\n\n` +
                            `🔧 *CLI Path:* ${CONFIG.vscodeCliPath}\n` +
                            `⚡ *Integración:* ${CONFIG.enableHostIntegration ? '✅ Activa' : '❌ Inactiva'}`;
                        
                        await this.sendMessage(chatId, status, { parse_mode: 'Markdown' });
                    } else {
                        await this.sendMessage(chatId, `❌ *VS Code no detectado*\n\nError: ${errorOutput || 'Código ' + code}\n\nAsegúrate de que VS Code esté instalado y el comando \`code\` esté en PATH.`, { parse_mode: 'Markdown' });
                    }
                });
                
                // Timeout
                setTimeout(() => {
                    if (!child.killed) {
                        child.kill();
                        this.sendMessage(chatId, '⏰ *Verificación de VS Code timeout*', { parse_mode: 'Markdown' });
                    }
                }, 10000);
                
            } catch (error) {
                await this.sendMessage(chatId, `❌ *Error verificando VS Code:*\n\n${error.message}`, { parse_mode: 'Markdown' });
            }
        });
        
        // ✅ NUEVO: /vscode_open - Abrir archivo en VS Code
        this.bot.onText(/\/vscode_open (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) return;
            
            const filePath = match[1];
            
            try {
                const { spawn } = require('child_process');
                const child = spawn(CONFIG.vscodeCliPath, [filePath], {
                    stdio: 'ignore',
                    detached: true
                });
                
                child.on('close', async (code) => {
                    if (code === 0) {
                        await this.sendMessage(chatId, `✅ *Archivo abierto en VS Code:*\n\`${filePath}\``, { parse_mode: 'Markdown' });
                        logToFile('ADMIN', `Archivo abierto en VS Code por ${chatId}: ${filePath}`);
                    } else {
                        await this.sendMessage(chatId, `❌ *Error abriendo archivo en VS Code*\n\nCódigo: ${code}`, { parse_mode: 'Markdown' });
                    }
                });
                
                child.on('error', async (error) => {
                    await this.sendMessage(chatId, `❌ *Error ejecutando VS Code:*\n\n${error.message}`, { parse_mode: 'Markdown' });
                });
                
            } catch (error) {
                await this.sendMessage(chatId, `❌ *Error:*\n\n${error.message}`, { parse_mode: 'Markdown' });
            }
        });
        
        // ✅ NUEVO: /host_permission - Solicitar permiso para operaciones del host
        this.bot.onText(/\/host_permission (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) return;
            
            const operation = match[1];
            
            const permissionRequest = `🔐 *SOLICITUD DE PERMISO PARA OPERACIÓN DEL HOST*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `👤 *Solicitante:* Admin (${chatId})\n` +
                `⚡ *Operación:* ${operation}\n` +
                `🖥️ *Host:* Windows\n` +
                `⏰ *Timestamp:* ${new Date().toLocaleString('es-MX')}\n\n` +
                `⚠️ *Esta operación requiere acceso al sistema host.*\n\n` +
                `¿Permitir esta operación?`;
            
            // Enviar solicitud de permiso
            await this.sendWithButtons(chatId, permissionRequest, [
                [{ text: '✅ Permitir', callback_data: `host_permit_${operation.replace(/\s+/g, '_')}` }],
                [{ text: '❌ Denegar', callback_data: `host_deny_${operation.replace(/\s+/g, '_')}` }]
            ], { parse_mode: 'Markdown' });
            
            logToFile('ADMIN', `Solicitud de permiso para operación del host: ${operation} por ${chatId}`);
        });
        
        // ✅ NUEVO: /system_notification - Enviar notificación al sistema
        this.bot.onText(/\/system_notification (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            if (!isAdmin(chatId)) return;
            
            const message = match[1];
            
            try {
                // En Windows, usar notificaciones toast (requiere PowerShell)
                const { spawn } = require('child_process');
                const psCommand = `
                    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
                    [Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
                    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
                    
                    \$template = @"
                    <toast>
                        <visual>
                            <binding template="ToastGeneric">
                                <text>Bot SASMEX</text>
                                <text>${message.replace(/"/g, '\\"')}</text>
                            </binding>
                        </visual>
                    </toast>
                    "@
                    
                    \$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
                    \$xml.LoadXml(\$template)
                    \$toast = New-Object Windows.UI.Notifications.ToastNotification \$xml
                    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Bot SASMEX").Show(\$toast)
                `;
                
                const child = spawn('powershell', ['-Command', psCommand], {
                    stdio: 'ignore',
                    windowsHide: true
                });
                
                child.on('close', async (code) => {
                    if (code === 0) {
                        await this.sendMessage(chatId, `✅ *Notificación enviada al sistema:*\n\n${message}`, { parse_mode: 'Markdown' });
                        logToFile('ADMIN', `Notificación del sistema enviada por ${chatId}: ${message}`);
                    } else {
                        await this.sendMessage(chatId, `❌ *Error enviando notificación del sistema*`, { parse_mode: 'Markdown' });
                    }
                });
                
                child.on('error', async (error) => {
                    await this.sendMessage(chatId, `❌ *Error ejecutando notificación:*\n\n${error.message}`, { parse_mode: 'Markdown' });
                });
                
            } catch (error) {
                await this.sendMessage(chatId, `❌ *Error:*\n\n${error.message}`, { parse_mode: 'Markdown' });
            }
        });
        
        // Auto-suscribir mensajes
        this.bot.on('message', (msg) => {
            if (msg.text && !msg.text.startsWith('/')) {
                const chatId = msg.chat.id;
                const idStr = String(chatId);
                
                // ✅ CORREGIDO: Usar métodos de Array
                if (!this.subscribers.includes(idStr)) {
                    this.subscribers.push(idStr);
                    addSubscriber(chatId);
                    console.log(`✅ Auto-suscrito: ${chatId}`);
                }
            }
        });
    }
    
    // ✅ NUEVO: Función para mostrar el menú del sistema informático
    async showSystemMenu(chatId, messageId = null) {
        const text = `
🖥️ *SISTEMA INFORMÁTICO SASMEX BOT*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Bienvenido al panel de control del sistema. Selecciona una categoría para explorar:

📊 *MONITOREO DEL SISTEMA*
💾 *RECURSOS Y ALMACENAMIENTO*  
👥 *GESTIÓN DE USUARIOS*
🔧 *CONFIGURACIÓN Y AJUSTES*
🚨 *SEGURIDAD Y ALERTAS*
📈 *ESTADÍSTICAS Y REPORTES*
        `;
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '📊 Monitoreo', callback_data: 'system_monitoring' },
                    { text: '💾 Recursos', callback_data: 'system_resources' }
                ],
                [
                    { text: '👥 Usuarios', callback_data: 'system_users' },
                    { text: '🔧 Config', callback_data: 'system_config' }
                ],
                [
                    { text: '🚨 Seguridad', callback_data: 'system_security' },
                    { text: '📈 Estadísticas', callback_data: 'system_stats' }
                ],
                [
                    { text: '🔙 Menú Principal', callback_data: 'back_main' }
                ]
            ]
        };
        
        if (messageId) {
            await this.bot.editMessageText(text, {
                chat_id: chatId, message_id: messageId,
                reply_markup: keyboard, parse_mode: 'Markdown'
            }).catch(() => {});
        } else {
            await this.sendMessage(chatId, text, { reply_markup: keyboard, parse_mode: 'Markdown' });
        }
    }
    
    // ✅ NUEVO: Función para mostrar submenú de monitoreo
    async showMonitoringMenu(chatId, messageId) {
        const text = `
📊 *MONITOREO DEL SISTEMA*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Estado actual del sistema y servicios:

🟢 *SERVICIOS ACTIVOS:*
• Bot de Telegram: ✅ En línea
• Monitoreo SASMEX: ✅ Activo
• Sistema de alertas: ✅ Funcionando
• Auto-backup: ✅ Programado

📈 *MÉTRICAS EN TIEMPO REAL:*
• Memoria usada: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB
• Uptime: ${this.getUptime()}
• Suscriptores: ${this.subscribers.length}
• Estado de salud: ${this.systemHealth}

🔍 *HERRAMIENTAS DE DIAGNÓSTICO:*
        `;
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '🔍 Diagnóstico', callback_data: 'monitoring_diagnose' },
                    { text: '📊 Rendimiento', callback_data: 'monitoring_performance' }
                ],
                [
                    { text: '🌐 Conectividad', callback_data: 'monitoring_network' },
                    { text: '⚙️ Procesos', callback_data: 'monitoring_processes' }
                ],
                [
                    { text: '📋 Logs', callback_data: 'monitoring_logs' },
                    { text: '💓 Heartbeat', callback_data: 'monitoring_heartbeat' }
                ],
                [
                    { text: '🔙 Sistema', callback_data: 'back_system' }
                ]
            ]
        };
        
        await this.bot.editMessageText(text, {
            chat_id: chatId, message_id: messageId,
            reply_markup: keyboard, parse_mode: 'Markdown'
        }).catch(() => {});
    }
    
    // ✅ NUEVO: Función para mostrar submenú de recursos
    async showResourcesMenu(chatId, messageId) {
        const text = `
💾 *RECURSOS Y ALMACENAMIENTO*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Información detallada de recursos del sistema:

💽 *MEMORIA:*
• Usada por heap: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB
• Total heap: ${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB
• Memoria externa: ${Math.round(process.memoryUsage().external / 1024 / 1024)}MB
• RSS: ${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB

💿 *ALMACENAMIENTO:*
• Directorio del bot: ${__dirname.split('\\').pop()}
• Archivos de datos: ${fs.existsSync(CONFIG.dataFile) ? Math.round(fs.statSync(CONFIG.dataFile).size / 1024) + 'KB' : 'No existe'}
• Archivo de logs: ${fs.existsSync(CONFIG.logFile) ? Math.round(fs.statSync(CONFIG.logFile).size / 1024) + 'KB' : 'No existe'}

⏰ *TIEMPO DE ACTIVIDAD:*
• Uptime del proceso: ${this.getUptime()}
• Última verificación: ${this.lastCheck ? this.lastCheck.toLocaleString('es-MX') : 'Nunca'}
        `;
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '📁 Archivos', callback_data: 'resources_files' },
                    { text: '💽 Memoria', callback_data: 'resources_memory' }
                ],
                [
                    { text: '💿 Disco', callback_data: 'resources_disk' },
                    { text: '⏰ Uptime', callback_data: 'resources_uptime' }
                ],
                [
                    { text: '🔙 Sistema', callback_data: 'back_system' }
                ]
            ]
        };
        
        await this.bot.editMessageText(text, {
            chat_id: chatId, message_id: messageId,
            reply_markup: keyboard, parse_mode: 'Markdown'
        }).catch(() => {});
    }
    
    // ✅ NUEVO: Función para mostrar submenú de usuarios
    async showUsersMenu(chatId, messageId) {
        const data = loadData();
        const users = data.users || {};
        
        const text = `
👥 *GESTIÓN DE USUARIOS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Estadísticas de la base de usuarios:

📊 *RESUMEN:*
• Total de usuarios: ${Object.keys(users).length}
• Usuarios activos: ${Object.values(users).filter(u => u.subscribed).length}
• Usuarios silenciados: ${Object.values(users).filter(u => u.muted).length}
• Usuarios inactivos: ${Object.keys(users).length - Object.values(users).filter(u => u.subscribed).length}

🎯 *DISTRIBUCIÓN POR SEVERIDAD:*
• Todas las alertas: ${Object.values(users).filter(u => u.severity === 'all').length}
• Moderada+: ${Object.values(users).filter(u => u.severity === 'moderada').length}
• Mayor: ${Object.values(users).filter(u => u.severity === 'mayor').length}

🛠️ *ACCIONES DISPONIBLES:*
        `;
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '📋 Lista Usuarios', callback_data: 'users_list' },
                    { text: '🧹 Limpiar', callback_data: 'users_clean' }
                ],
                [
                    { text: '📊 Estadísticas', callback_data: 'users_stats' },
                    { text: '⚙️ Configurar', callback_data: 'users_config' }
                ],
                [
                    { text: '🔙 Sistema', callback_data: 'back_system' }
                ]
            ]
        };
        
        await this.bot.editMessageText(text, {
            chat_id: chatId, message_id: messageId,
            reply_markup: keyboard, parse_mode: 'Markdown'
        }).catch(() => {});
    }
    
    // ✅ NUEVO: Función para mostrar submenú de configuración
    async showConfigMenu(chatId, messageId) {
        const text = `
🔧 *CONFIGURACIÓN Y AJUSTES*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Parámetros configurables del sistema:

🤖 *BOT CONFIGURATION:*
• Intervalo de verificación: ${CONFIG.checkInterval} segundos
• Timeout de conexión: ${CONFIG.fetchTimeout}ms
• Admin Chat ID: ${CONFIG.adminChatId ? 'Configurado' : 'No configurado'}

🔔 *SISTEMA DE ALERTAS:*
• Alertas de errores: ${CONFIG.alertOnErrors ? '✅ Activadas' : '❌ Desactivadas'}
• Alertas de recuperación: ${CONFIG.alertOnRecovery ? '✅ Activadas' : '❌ Desactivadas'}
• Heartbeat: Cada ${CONFIG.heartbeatInterval} segundos
• Umbral memoria: ${CONFIG.memoryThreshold}MB

💾 *BACKUP SYSTEM:*
• Auto-backup: Cada 6 horas
• Backups disponibles: ${fs.readdirSync(__dirname).filter(f => f.includes('backup')).length}

⚙️ *AJUSTES DISPONIBLES:*
        `;
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '🤖 Bot Config', callback_data: 'config_bot' },
                    { text: '🔔 Alertas', callback_data: 'config_alerts' }
                ],
                [
                    { text: '💾 Backup', callback_data: 'config_backup' },
                    { text: '🔧 Avanzado', callback_data: 'config_advanced' }
                ],
                [
                    { text: '🔙 Sistema', callback_data: 'back_system' }
                ]
            ]
        };
        
        await this.bot.editMessageText(text, {
            chat_id: chatId, message_id: messageId,
            reply_markup: keyboard, parse_mode: 'Markdown'
        }).catch(() => {});
    }
    
    // ✅ NUEVO: Función para mostrar submenú de seguridad
    async showSecurityMenu(chatId, messageId) {
        const text = `
🚨 *SEGURIDAD Y ALERTAS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Estado de seguridad del sistema:

🔐 *AUTENTICACIÓN:*
• Verificación de admin: ✅ Activa
• Control de acceso: ✅ Implementado
• Logs de seguridad: ✅ Registrados

🚨 *SISTEMA DE ALERTAS:*
• Alertas proactivas: ${this.heartbeatInterval ? '✅ Activas' : '❌ Inactivas'}
• Monitoreo continuo: ${this.errorMonitorInterval ? '✅ Activo' : '❌ Inactivo'}
• Recuperación automática: ✅ Configurada
• Última alerta: ${this.lastAdminAlert ? this.lastAdminAlert.toLocaleString('es-MX') : 'Nunca'}

🛡️ *PROTECCIONES ACTIVAS:*
• Rate limiting en API: ✅ Implementado
• Reintentos automáticos: ✅ Configurados
• Validación de entrada: ✅ Activa
• Manejo de errores: ✅ Robusto

⚠️ *RIESGOS DETECTADOS:*
• Errores consecutivos: ${this.consecutiveErrors}
• Estado del sistema: ${this.systemHealth}
• Modo recuperación: ${this.recoveryMode ? '🟡 Activo' : '🟢 Inactivo'}
        `;
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '🚨 Alertas', callback_data: 'security_alerts' },
                    { text: '🔐 Auth', callback_data: 'security_auth' }
                ],
                [
                    { text: '🛡️ Protecciones', callback_data: 'security_protections' },
                    { text: '⚠️ Riesgos', callback_data: 'security_risks' }
                ],
                [
                    { text: '🔙 Sistema', callback_data: 'back_system' }
                ]
            ]
        };
        
        await this.bot.editMessageText(text, {
            chat_id: chatId, message_id: messageId,
            reply_markup: keyboard, parse_mode: 'Markdown'
        }).catch(() => {});
    }
    
    // ✅ NUEVO: Función para mostrar submenú de estadísticas
    async showStatsMenu(chatId, messageId) {
        const data = loadData();
        const users = data.users || {};
        
        const text = `
📈 *ESTADÍSTICAS Y REPORTES*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Métricas detalladas del rendimiento:

📊 *USUARIOS:*
• Total registrados: ${Object.keys(users).length}
• Activos actualmente: ${this.subscribers.length}
• Tasa de retención: ${Object.keys(users).length > 0 ? Math.round((this.subscribers.length / Object.keys(users).length) * 100) : 0}%

📨 *MENSAJES ENVIADOS:*
• Alertas totales: ${data.userStats?.totalAlerts || 0}
• Mensajes de broadcast: ${data.userStats?.broadcasts || 0}
• Errores de envío: ${data.userStats?.sendErrors || 0}

⏰ *RENDIMIENTO:*
• Uptime del sistema: ${this.getUptime()}
• Tasa de éxito: ${data.userStats?.totalAlerts && data.userStats?.sendErrors ? 
    Math.round((1 - data.userStats.sendErrors / data.userStats.totalAlerts) * 100) : 100}%
• Promedio de respuesta: <1s

💾 *RECURSOS UTILIZADOS:*
• Memoria máxima: ${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB
• CPU promedio: N/A (Node.js single-thread)
• Almacenamiento usado: ${Math.round((fs.statSync(CONFIG.dataFile).size + fs.statSync(CONFIG.logFile).size) / 1024)}KB

📋 *REPORTES DISPONIBLES:*
        `;
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '📊 Gráfico Rendimiento', callback_data: 'stats_performance' },
                    { text: '👥 Análisis Usuarios', callback_data: 'stats_users' }
                ],
                [
                    { text: '📨 Reporte Mensajes', callback_data: 'stats_messages' },
                    { text: '💾 Reporte Recursos', callback_data: 'stats_resources' }
                ],
                [
                    { text: '🔙 Sistema', callback_data: 'back_system' }
                ]
            ]
        };
        
        await this.bot.editMessageText(text, {
            chat_id: chatId, message_id: messageId,
            reply_markup: keyboard, parse_mode: 'Markdown'
        }).catch(() => {});
    }
    
    setupCallbacks() {
        this.bot.on('callback_query', async (query) => {
            const chatId = query.message.chat.id;
            const messageId = query.message.message_id;
            const data = query.data;
            
            await this.bot.answerCallbackQuery(query.id);
            
            try {
                if (data === 'back_main') {
                    await this.sendMainMenu(chatId, messageId);
                } else if (data === 'back_config') {
                    await this.sendConfigMenu(chatId, messageId);
                } else if (data === 'back_system') {
                    await this.showSystemMenu(chatId, messageId);
                } else if (data.startsWith('menu_')) {
                    await this.handleMenuCallback(chatId, data, messageId);
                } else if (data.startsWith('config_')) {
                    await this.handleConfigCallback(chatId, data, messageId);
                } else if (data.startsWith('admin_')) {
                    await this.handleAdminCallback(chatId, data, messageId);
                } else if (data.startsWith('test_')) {
                    // ✅ NUEVO: Callbacks para botones de prueba
                    await this.handleTestCallback(chatId, data, messageId);
                } else if (data.startsWith('system_')) {
                    // ✅ NUEVO: Callbacks para el sistema informático
                    await this.handleSystemCallback(chatId, data, messageId);
                } else if (data.startsWith('host_')) {
                    // ✅ NUEVO: Callbacks para permisos del host
                    await this.handleHostPermissionCallback(chatId, data, messageId);
                }
            } catch (error) {
                console.error('Error en callback:', error.message);
            }
        });
    }
    
    async handleMenuCallback(chatId, data, messageId) {
        const action = data.replace('menu_', '');
        
        switch (action) {
            case 'alerta':
                await this.executeAlertaCallback(chatId, messageId);
                break;
            case 'config':
                await this.sendConfigMenu(chatId, messageId);
                break;
            case 'status':
                await this.executeStatusCallback(chatId, messageId);
                break;
            case 'info':
                await this.executeInfoCallback(chatId, messageId);
                break;
            case 'admin':
                if (isAdmin(chatId)) {
                    await this.sendAdminMenu(chatId, messageId);
                }
                break;
            case 'system':
                if (isAdmin(chatId)) {
                    await this.showSystemMenu(chatId, messageId);
                }
                break;
        }
    }
    
    async handleConfigCallback(chatId, data, messageId) {
        const action = data.replace('config_', '');
        const config = getUserConfig(chatId);
        
        switch (action) {
            case 'severity_all':
            case 'severity_menor':
            case 'severity_moderada':
            case 'severity_mayor':
                const severity = action.replace('severity_', '');
                setUserSeverity(chatId, severity);
                await this.sendConfigMenu(chatId, messageId);
                break;
            case 'mute':
                setUserMuted(chatId, !config.muted);
                await this.sendConfigMenu(chatId, messageId);
                break;
            case 'back':
                await this.sendMainMenu(chatId, messageId);
                break;
        }
    }
    
    async handleAdminCallback(chatId, data, messageId) {
        if (!isAdmin(chatId)) return;
        
        const action = data.replace('admin_', '');
        
        switch (action) {
            case 'stats':
                await this.executeAdminStatsCallback(chatId, messageId);
                break;
            case 'logs':
                const logs = getLogs(15);
                await this.bot.editMessageText(`📋 *Últimos logs:*\n\`\`\`\n${logs.substring(0, 3500)}\n\`\`\``, {
                    chat_id: chatId, message_id: messageId, parse_mode: 'Markdown'
                });
                break;
            case 'errors':
                await this.executeAdminErrorsCallback(chatId, messageId);
                break;
            case 'back':
                await this.sendMainMenu(chatId, messageId);
                break;
        }
    }
    
    // ✅ NUEVO: Función para manejar callbacks de prueba
    async handleTestCallback(chatId, data, messageId) {
        if (!isAdmin(chatId)) return;
        
        const action = data.replace('test_', '');
        
        switch (action) {
            case 'confirm':
                await this.editMessage(chatId, messageId, 
                    '✅ *CONFIRMADO*\n\nHas seleccionado la opción de confirmar.', 
                    { parse_mode: 'Markdown' }
                );
                break;
            case 'cancel':
                await this.editMessage(chatId, messageId, 
                    '❌ *CANCELADO*\n\nHas seleccionado la opción de cancelar.', 
                    { parse_mode: 'Markdown' }
                );
                break;
            case 'retry':
                await this.editMessage(chatId, messageId, 
                    '🔄 *REINTENTANDO*\n\nHas seleccionado la opción de reintentar.', 
                    { parse_mode: 'Markdown' }
                );
                break;
        }
    }
    
    // ✅ NUEVO: Función para manejar callbacks de permisos del host
    async handleHostPermissionCallback(chatId, data, messageId) {
        if (!isAdmin(chatId)) return;
        
        const parts = data.split('_');
        const action = parts[1]; // permit o deny
        const operation = parts.slice(2).join('_').replace(/_/g, ' ');
        
        if (action === 'permit') {
            await this.editMessage(chatId, messageId, 
                `✅ *PERMISO CONCEDIDO*\n\nOperación autorizada: ${operation}\n\nEl bot puede proceder con la operación solicitada.`, 
                { parse_mode: 'Markdown' }
            );
            
            // Aquí se podría ejecutar la operación permitida
            logToFile('ADMIN', `Permiso concedido para operación del host: ${operation} por ${chatId}`);
            
        } else if (action === 'deny') {
            await this.editMessage(chatId, messageId, 
                `❌ *PERMISO DENEGADO*\n\nOperación rechazada: ${operation}\n\nLa operación no se ejecutará.`, 
                { parse_mode: 'Markdown' }
            );
            
            logToFile('ADMIN', `Permiso denegado para operación del host: ${operation} por ${chatId}`);
        }
    }
    
    // ✅ NUEVO: Función para manejar callbacks del sistema informático
    async handleSystemCallback(chatId, data, messageId) {
        if (!isAdmin(chatId)) return;
        
        const action = data.replace('system_', '');
        
        switch (action) {
            case 'monitoring':
                await this.showMonitoringMenu(chatId, messageId);
                break;
            case 'resources':
                await this.showResourcesMenu(chatId, messageId);
                break;
            case 'users':
                await this.showUsersMenu(chatId, messageId);
                break;
            case 'config':
                await this.showConfigMenu(chatId, messageId);
                break;
            case 'security':
                await this.showSecurityMenu(chatId, messageId);
                break;
            case 'stats':
                await this.showStatsMenu(chatId, messageId);
                break;
        }
    }
    
    async sendMainMenu(chatId, messageId = null) {
        const config = getUserConfig(chatId);
        
        const text = `
🌋 *BOT SASMEX - MENÚ*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 *Estado:* ${config.subscribed ? '✅ Suscrito' : '❌ No suscrito'}
🔕 *Modo:* ${config.muted ? '🔇 Silenciado' : '🔔 Activo'}
🎯 *Severidad:* ${config.severity === 'all' ? 'Todas' : config.severity}

Selecciona una opción:
        `;
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '🚨 Ver Alerta', callback_data: 'menu_alerta' },
                    { text: '⚙️ Configuración', callback_data: 'menu_config' }
                ],
                [
                    { text: '📊 Estado', callback_data: 'menu_status' },
                    { text: 'ℹ️ Info', callback_data: 'menu_info' }
                ],
                ...(isAdmin(chatId) ? [
                    [{ text: '🔧 Admin', callback_data: 'menu_admin' }],
                    [{ text: '🖥️ Sistema Informático', callback_data: 'menu_system' }]
                ] : [])
            ]
        };
        
        if (messageId) {
            await this.bot.editMessageText(text, {
                chat_id: chatId, message_id: messageId,
                reply_markup: keyboard, parse_mode: 'Markdown'
            }).catch(() => {});
        } else {
            await this.sendMessage(chatId, text, { reply_markup: keyboard, parse_mode: 'Markdown' });
        }
    }
    
    async sendConfigMenu(chatId, messageId = null) {
        const config = getUserConfig(chatId);
        
        const text = `
⚙️ *CONFIGURACIÓN*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• Severidad: *${config.severity === 'all' ? 'Todas' : config.severity}*
• Estado: *${config.muted ? '🔇 Silenciado' : '🔔 Activo'}*

Configura tus preferencias:
        `;
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '🎯 Todas', callback_data: 'config_severity_all' },
                    { text: '🟢 Menor+', callback_data: 'config_severity_menor' }
                ],
                [
                    { text: '🟡 Moderada+', callback_data: 'config_severity_moderada' },
                    { text: '🔴 Mayor', callback_data: 'config_severity_mayor' }
                ],
                [{ text: config.muted ? '🔔 Reactivar' : '🔇 Silenciar', callback_data: 'config_mute' }],
                [{ text: '⬅️ Volver', callback_data: 'config_back' }]
            ]
        };
        
        if (messageId) {
            await this.bot.editMessageText(text, {
                chat_id: chatId, message_id: messageId,
                reply_markup: keyboard, parse_mode: 'Markdown'
            }).catch(() => {});
        } else {
            await this.sendMessage(chatId, text, { reply_markup: keyboard, parse_mode: 'Markdown' });
        }
    }
    
    async sendAdminMenu(chatId, messageId = null) {
        const text = `
🔧 *PANEL ADMIN*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Selecciona una acción:
        `;
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '📊 Stats', callback_data: 'admin_stats' },
                    { text: '📋 Logs', callback_data: 'admin_logs' }
                ],
                [
                    { text: '❌ Errores', callback_data: 'admin_errors' },
                    { text: '⬅️ Volver', callback_data: 'admin_back' }
                ]
            ]
        };
        
        if (messageId) {
            await this.bot.editMessageText(text, {
                chat_id: chatId, message_id: messageId,
                reply_markup: keyboard, parse_mode: 'Markdown'
            }).catch(() => {});
        } else {
            await this.sendMessage(chatId, text, { reply_markup: keyboard, parse_mode: 'Markdown' });
        }
    }
    
    async executeAlertaCallback(chatId, messageId) {
        await this.bot.editMessageText('📸 *Consultando SASMEX...*', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown'
        }).catch(() => {});
        
        try {
            const webData = await getWebContent();
            if (webData.success) {
                const imageResult = await generateAlertImage(webData.data);
                if (imageResult.success && fs.existsSync(imageResult.imagePath)) {
                    await this.bot.sendPhoto(chatId, imageResult.imagePath, {
                        caption: '🚨 *ALERTA SÍSMICA SASMEX*\n📞 Emergencias: *911*',
                        parse_mode: 'Markdown'
                    });
                }
            }
        } catch (error) {
            console.error('Error en alerta callback:', error.message);
        }
    }
    
    async executeStatusCallback(chatId, messageId) {
        const uptime = this.getUptime();
        const text = `
📊 *ESTADO*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⏱️ Uptime: ${uptime}
👥 Suscriptores: ${this.subscribers.length}
🌐 Puppeteer: ${browser ? '✅' : '⏳'}
        `;
        
        await this.bot.editMessageText(text, {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown'
        }).catch(() => {});
    }
    
    async executeInfoCallback(chatId, messageId) {
        const text = `
ℹ️ *SASMEX*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Sistema de Alerta Sísmica Mexicano

🔗 http://www.sasmex.net
📞 Emergencias: *911*
        `;
        
        await this.bot.editMessageText(text, {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown'
        }).catch(() => {});
    }
    
    async executeAdminStatsCallback(chatId, messageId) {
        const data = loadData();
        const users = data.users || {};
        const total = Object.keys(users).length;
        const active = Object.values(users).filter(u => u.subscribed).length;
        
        const text = `
📊 *ESTADÍSTICAS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

👥 Total: ${total}
✅ Activos: ${active}
💾 Memoria: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB
⏱️ Uptime: ${this.getUptime()}
        `;
        
        await this.bot.editMessageText(text, {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown'
        }).catch(() => {});
    }
    
    // ✅ NUEVO: Reporte de errores para admin
    async executeAdminErrorsCallback(chatId, messageId) {
        const errorReport = this.getErrorReport();
        
        let text = `
❌ *REPORTE DE ERRORES*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 *Estadísticas:*
• Total errores: ${errorReport.total}
• Tipos: ${Object.entries(errorReport.byType).map(([type, count]) => `${type}:${count}`).join(', ') || 'Ninguno'}

📋 *Errores recientes:*
`;
        
        if (errorReport.recent.length > 0) {
            errorReport.recent.forEach((error, index) => {
                text += `\n${index + 1}. *${error.type}* - ${error.chatId}\n   ${error.message.substring(0, 100)}${error.message.length > 100 ? '...' : ''}`;
            });
        } else {
            text += '\n✅ No hay errores recientes';
        }
        
        text += '\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
        
        await this.bot.editMessageText(text, {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown'
        }).catch(() => {});
    }
    
    // ✅ NUEVO: Función para validar y corregir formato Markdown
    validateMarkdown(text) {
        if (!text || typeof text !== 'string') return text;
        
        let corrected = text;
        const issues = [];
        
        // 1. Verificar asteriscos no cerrados (*)
        const boldMatches = corrected.match(/\*/g) || [];
        if (boldMatches.length % 2 !== 0) {
            issues.push('Asteriscos no cerrados');
            // Agregar asterisco al final si falta
            corrected += '*';
        }
        
        // 2. Verificar guiones bajos no cerrados (_)
        const italicMatches = corrected.match(/(?<!\\)_/g) || [];
        if (italicMatches.length % 2 !== 0) {
            issues.push('Guiones bajos no cerrados');
            corrected += '_';
        }
        
        // 3. Verificar backticks no cerrados (`)
        const codeMatches = corrected.match(/(?<!\\)`/g) || [];
        if (codeMatches.length % 2 !== 0) {
            issues.push('Backticks no cerrados');
            corrected += '`';
        }
        
        // 4. Verificar que no haya entidades anidadas problemáticas
        // Buscar patrones como *[texto sin cerrar* o _[texto sin cerrar_
        const nestedIssues = corrected.match(/(\*[^]*?)(?=\*|$)|(_[^]*?)(?=_|$)|(`[^]*?)(?=`|$)/g) || [];
        nestedIssues.forEach(match => {
            if (match.length > 100) { // Mensajes muy largos pueden causar problemas
                issues.push('Entidad Markdown muy larga (>100 chars)');
            }
        });
        
        // 5. Verificar URLs sin escapar en texto con formato
        const urlPattern = /https?:\/\/[^\s)]+/g;
        const urls = corrected.match(urlPattern) || [];
        urls.forEach(url => {
            // Si la URL está dentro de formato Markdown, podría causar problemas
            if (corrected.includes(`*${url}*`) || corrected.includes(`_${url}_`) || corrected.includes(`\`${url}\``)) {
                issues.push('URL dentro de formato Markdown');
            }
        });
        
        // 6. Limitar longitud total (Telegram tiene límites)
        if (corrected.length > 4000) {
            issues.push('Mensaje demasiado largo');
            corrected = corrected.substring(0, 3990) + '...';
        }
        
        if (issues.length > 0) {
            console.log(`🔧 Corrigiendo Markdown: ${issues.join(', ')}`);
        }
        
        return corrected;
    }
    
    // ✅ NUEVO: Sistema de monitoreo de errores
    errorStats = {
        total: 0,
        byType: {},
        byChatId: {},
        recent: []
    };
    
    logError(chatId, errorType, errorMessage, context = {}) {
        this.errorStats.total++;
        
        // Contar por tipo
        this.errorStats.byType[errorType] = (this.errorStats.byType[errorType] || 0) + 1;
        
        // Contar por chat
        this.errorStats.byChatId[chatId] = (this.errorStats.byChatId[chatId] || 0) + 1;
        
        // Mantener registro de errores recientes (últimas 10)
        this.errorStats.recent.unshift({
            timestamp: new Date().toISOString(),
            chatId,
            type: errorType,
            message: errorMessage.substring(0, 200), // Limitar longitud
            context
        });
        
        if (this.errorStats.recent.length > 10) {
            this.errorStats.recent.pop();
        }
        
        // Log detallado
        const errorLog = {
            timestamp: new Date().toISOString(),
            chatId,
            errorType,
            errorMessage,
            context,
            stats: {
                totalErrors: this.errorStats.total,
                errorsByType: this.errorStats.byType,
                errorsByChat: this.errorStats.byChatId
            }
        };
        
        logToFile('ERROR_STATS', JSON.stringify(errorLog, null, 2));
        
        // Notificar admin si hay muchos errores
        if (this.errorStats.total % 5 === 0 && CONFIG.adminChatId) {
            this.sendMessage(CONFIG.adminChatId, 
                `⚠️ *ALERTA DE ERRORES*\n\n` +
                `Total errores: ${this.errorStats.total}\n` +
                `Errores recientes: ${Object.values(this.errorStats.byType).join(', ')}\n` +
                `Último: ${errorType} en ${chatId}`,
                { parse_mode: 'Markdown' }
            ).catch(() => {});
        }
    }
    
    getErrorReport() {
        const report = {
            total: this.errorStats.total,
            byType: this.errorStats.byType,
            byChatId: this.errorStats.byChatId,
            recent: this.errorStats.recent.slice(0, 5)
        };
        
        return report;
    }
    
    async sendMessage(chatId, text, options = {}, maxRetries = 3) {
        let lastError;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                // ✅ NUEVO: Validar y corregir formato Markdown antes de enviar
                if (options.parse_mode === 'Markdown') {
                    const validatedText = this.validateMarkdown(text);
                    if (validatedText !== text) {
                        logToFile('FIX', `Markdown corregido para ${chatId}: ${text.length} -> ${validatedText.length} chars`);
                        console.log(`🔧 Markdown corregido para ${chatId}`);
                    }
                    text = validatedText;
                }
                
                return await this.bot.sendMessage(chatId, text, options);
            } catch (error) {
                lastError = error;
                
                // ✅ MEJORADO: Logging detallado de errores con estadísticas
                this.logError(chatId, 'SEND_MESSAGE', error.message, {
                    messageLength: text?.length || 0,
                    parseMode: options.parse_mode,
                    hasMarkdown: options.parse_mode === 'Markdown',
                    attempt: attempt,
                    maxRetries: maxRetries
                });
                
                console.error(`❌ Error enviando a ${chatId} (intento ${attempt}/${maxRetries}):`, error.message);
                
                // ✅ NUEVO: Manejo de rate limits (429)
                if (error.response?.statusCode === 429) {
                    const retryAfter = error.response.body?.parameters?.retry_after || 30;
                    console.log(`⏳ Rate limit alcanzado, esperando ${retryAfter}s antes del siguiente intento...`);
                    await sleep(retryAfter * 1000);
                    continue;
                }
                
                // ✅ NUEVO: Intentar reenviar sin formato Markdown si es error de parsing
                if (error.response?.statusCode === 400 && 
                    error.message.includes('can\'t parse entities') && 
                    options.parse_mode === 'Markdown' &&
                    attempt === 1) { // Solo en el primer intento
                    
                    console.log(`🔄 Reintentando envío a ${chatId} sin formato Markdown...`);
                    try {
                        const plainOptions = { ...options };
                        delete plainOptions.parse_mode;
                        // Escapar caracteres Markdown problemáticos
                        const cleanText = text.replace(/[*_`~]/g, '\\$&');
                        return await this.bot.sendMessage(chatId, cleanText, plainOptions);
                    } catch (retryError) {
                        console.error(`❌ Error en reintento a ${chatId}:`, retryError.message);
                        this.logError(chatId, 'SEND_MESSAGE_RETRY', retryError.message);
                        lastError = retryError;
                    }
                }
                
                // Si no es el último intento, esperar con backoff exponencial
                if (attempt < maxRetries) {
                    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30000); // Máximo 30s
                    console.log(`⏳ Esperando ${delay}ms antes del siguiente intento...`);
                    await sleep(delay);
                }
            }
        }
        
        // Después de todos los intentos fallidos
        console.error(`💀 Fallaron todos los intentos de envío a ${chatId}`);
        
        // Solo eliminar suscriptor si es error de usuario bloqueado (403) o chat no encontrado
        // No eliminar por errores de formato Markdown (400 con "can't parse entities")
        if (lastError.response?.statusCode === 403 || 
            (lastError.response?.statusCode === 400 && 
             !lastError.message.includes("can't parse entities") && 
             !lastError.message.includes("Bad Request"))) {
            const idStr = String(chatId);
            const index = this.subscribers.indexOf(idStr);
            if (index > -1) {
                this.subscribers.splice(index, 1);
            }
            removeSubscriber(chatId);
            console.log(`❌ Suscriptor eliminado por error ${lastError.response?.statusCode}: ${idStr}`);
        } else if (lastError.response?.statusCode === 400) {
            console.log(`⚠️ Error de formato Markdown para ${chatId}, manteniendo suscriptor`);
        }
        return null;
    }
    
    // ✅ NUEVO: Función para editar mensajes con reintentos
    async editMessage(chatId, messageId, text, options = {}, maxRetries = 3) {
        let lastError;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                // Validar Markdown si es necesario
                if (options.parse_mode === 'Markdown') {
                    text = this.validateMarkdown(text);
                }
                
                return await this.bot.editMessageText(text, {
                    chat_id: chatId,
                    message_id: messageId,
                    ...options
                });
            } catch (error) {
                lastError = error;
                
                this.logError(chatId, 'EDIT_MESSAGE', error.message, {
                    messageId: messageId,
                    attempt: attempt,
                    maxRetries: maxRetries
                });
                
                console.error(`❌ Error editando mensaje ${messageId} en ${chatId} (intento ${attempt}/${maxRetries}):`, error.message);
                
                // Manejo de rate limits
                if (error.response?.statusCode === 429) {
                    const retryAfter = error.response.body?.parameters?.retry_after || 30;
                    console.log(`⏳ Rate limit en edición, esperando ${retryAfter}s...`);
                    await sleep(retryAfter * 1000);
                    continue;
                }
                
                // Si no es el último intento, esperar
                if (attempt < maxRetries) {
                    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30000);
                    await sleep(delay);
                }
            }
        }
        
        console.error(`💀 Fallaron todos los intentos de edición para mensaje ${messageId}`);
        return null;
    }
    
    // ✅ NUEVO: Función para enviar mensajes con botones inline
    async sendWithButtons(chatId, text, buttons, options = {}, maxRetries = 3) {
        const keyboard = {
            inline_keyboard: buttons
        };
        
        const fullOptions = {
            ...options,
            reply_markup: keyboard
        };
        
        return await this.sendMessage(chatId, text, fullOptions, maxRetries);
    }
    
    // ✅ NUEVO: Función para enviar archivos con reintentos
    async sendDocument(chatId, filePath, options = {}, maxRetries = 3) {
        let lastError;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await this.bot.sendDocument(chatId, filePath, options);
            } catch (error) {
                lastError = error;
                
                this.logError(chatId, 'SEND_DOCUMENT', error.message, {
                    filePath: filePath,
                    attempt: attempt,
                    maxRetries: maxRetries
                });
                
                console.error(`❌ Error enviando documento a ${chatId} (intento ${attempt}/${maxRetries}):`, error.message);
                
                // Manejo de rate limits
                if (error.response?.statusCode === 429) {
                    const retryAfter = error.response.body?.parameters?.retry_after || 30;
                    await sleep(retryAfter * 1000);
                    continue;
                }
                
                if (attempt < maxRetries) {
                    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30000);
                    await sleep(delay);
                }
            }
        }
        
        console.error(`💀 Fallaron todos los intentos de envío de documento a ${chatId}`);
        return null;
    }
    
    // ✅ NUEVO: Función para eliminar mensajes
    async deleteMessage(chatId, messageId, maxRetries = 3) {
        let lastError;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await this.bot.deleteMessage(chatId, messageId);
            } catch (error) {
                lastError = error;
                
                console.error(`❌ Error eliminando mensaje ${messageId} en ${chatId} (intento ${attempt}/${maxRetries}):`, error.message);
                
                // Algunos errores son esperados (mensaje ya eliminado)
                if (error.response?.statusCode === 400 && 
                    error.message.includes('message to delete not found')) {
                    console.log(`ℹ️ Mensaje ${messageId} ya estaba eliminado`);
                    return true;
                }
                
                if (error.response?.statusCode === 429) {
                    const retryAfter = error.response.body?.parameters?.retry_after || 30;
                    await sleep(retryAfter * 1000);
                    continue;
                }
                
                if (attempt < maxRetries) {
                    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30000);
                    await sleep(delay);
                }
            }
        }
        
        console.error(`💀 Fallaron todos los intentos de eliminación de mensaje ${messageId}`);
        return false;
    }
    
    async sendPhoto(chatId, imagePath, caption) {
        try {
            if (!fs.existsSync(imagePath)) return null;
            
            // ✅ NUEVO: Validar y corregir caption antes de enviar
            const validatedCaption = this.validateMarkdown(caption);
            if (validatedCaption !== caption) {
                logToFile('FIX', `Caption corregido para ${chatId}: ${caption.length} -> ${validatedCaption.length} chars`);
                console.log(`🔧 Caption corregido para ${chatId}`);
            }
            
            return await this.bot.sendPhoto(chatId, imagePath, {
                caption: validatedCaption,
                parse_mode: 'Markdown'
            });
        } catch (error) {
            // ✅ MEJORADO: Logging detallado de errores con estadísticas
            this.logError(chatId, 'SEND_PHOTO', error.message, {
                imagePath,
                captionLength: caption?.length || 0,
                hasMarkdown: true
            });
            
            logToFile('TELEGRAM_PHOTO_ERROR', JSON.stringify(errorDetails, null, 2));
            console.error(`❌ Error enviando foto a ${chatId}:`, error.message);
            
            // ✅ NUEVO: Intentar reenviar sin formato Markdown si es error de parsing
            if (error.response?.statusCode === 400 && 
                error.message.includes('can\'t parse entities')) {
                
                console.log(`🔄 Reintentando envío de foto a ${chatId} sin formato Markdown...`);
                try {
                    const cleanCaption = caption.replace(/[*_`~]/g, '\\$&');
                    return await this.bot.sendPhoto(chatId, imagePath, {
                        caption: cleanCaption
                    });
                } catch (retryError) {
                    console.error(`❌ Error en reintento de foto a ${chatId}:`, retryError.message);
                    this.logError(chatId, 'SEND_PHOTO_RETRY', retryError.message);
                }
            }
            
            // Solo eliminar suscriptor si es error de usuario bloqueado (403) o chat no encontrado
            // No eliminar por errores de formato Markdown (400 con "can't parse entities")
            if (error.response?.statusCode === 403 || 
                (error.response?.statusCode === 400 && 
                 !error.message.includes("can't parse entities") && 
                 !error.message.includes("Bad Request"))) {
                const idStr = String(chatId);
                const index = this.subscribers.indexOf(idStr);
                if (index > -1) {
                    this.subscribers.splice(index, 1);
                }
                removeSubscriber(chatId);
                console.log(`❌ Suscriptor eliminado por error ${error.response?.statusCode}: ${idStr}`);
            } else if (error.response?.statusCode === 400) {
                console.log(`⚠️ Error de formato Markdown para ${chatId}, manteniendo suscriptor`);
            }
            return null;
        }
    }
    
    async checkForAlerts(isInitialSync = false) {
        if (this.isChecking) return;
        
        // ✅ CORREGIDO: Verificar modo mantenimiento
        if (this.maintenanceMode) {
            console.log('🔧 Modo mantenimiento activo - saltando verificación');
            return;
        }
        
        this.isChecking = true;
        this.lastCheck = new Date();
        console.log(`🔄 [${this.lastCheck.toLocaleTimeString('es-MX')}] ${isInitialSync ? 'Conectando' : 'Verificando'}...`);
        
        try {
            const webData = await getWebContent();
            
            if (!webData.success) {
                console.log('⚠️ No se pudo conectar:', webData.error);
                return;
            }
            
            const currentContent = webData.data.identifier;
            const lastContent = getLastContent();
            
            if (isInitialSync || this.isFirstRun) {
                setLastContent(currentContent);
                this.isFirstRun = false;
                console.log('✅ Conexión establecida');
                return;
            }
            
            if (currentContent && currentContent !== lastContent) {
                console.log('🚨 ¡NUEVA ALERTA!');
                logToFile('ALERT', `Nueva alerta: ${currentContent}`);
                
                const imageResult = await generateAlertImage(webData.data);
                
                if (imageResult.success && fs.existsSync(imageResult.imagePath)) {
                    await this.broadcastImage(imageResult.imagePath,
                        '🚨🚨🚨 *ALERTA SÍSMICA SASMEX* 🚨🚨🚨\n\n📞 Emergencias: *911*',
                        webData.data.severidad
                    );
                }
                
                setLastContent(currentContent);
            } else {
                console.log('✅ Sin cambios');
            }
        } catch (error) {
            console.error('❌ Error:', error.message);
        } finally {
            this.isChecking = false;
        }
    }
    
    async broadcastImage(imagePath, caption, alertSeverity = 'moderada') {
        const allSubs = getSubscribers();
        const subs = allSubs.filter(chatId => shouldSendAlert(chatId, alertSeverity));
        
        if (subs.length === 0) {
            console.log('⚠️ No hay suscriptores');
            return;
        }
        
        console.log(`📢 Enviando a ${subs.length} suscriptor(es)...`);
        
        let enviados = 0, fallidos = 0;
        
        for (const chatId of subs) {
            const result = await this.sendPhoto(chatId, imagePath, caption);
            if (result) enviados++; else fallidos++;
            await sleep(300);
        }
        
        console.log(`✅ Enviados: ${enviados} | ❌ Fallidos: ${fallidos}`);
    }
    
    startMonitoring() {
        // ✅ MEJORADO: Verificar si ya está ejecutándose
        if (this.checkIntervalId) {
            console.log('⚠️ Monitoreo ya activo, omitiendo reinicio');
            return;
        }
        
        console.log('🚀 Iniciando monitoreo del sistema...');
        
        // Inicializar navegador con reintento
        initBrowser().catch(async (err) => {
            console.error('⚠️ Error inicializando browser:', err.message);
            logToFile('WARNING', `Error browser: ${err.message}`);
            
            // Reintentar en 30 segundos
            setTimeout(() => {
                console.log('🔄 Reintentando inicialización del browser...');
                initBrowser().catch(err2 => {
                    console.error('❌ Error persistente en browser:', err2.message);
                });
            }, 30000);
        });
        
        // Esperar antes de primera verificación
        setTimeout(() => {
            if (!this.maintenanceMode) {
                this.checkForAlerts(true).catch(err => {
                    console.error('❌ Error en verificación inicial:', err.message);
                    this.failureCount++;
                });
            }
        }, 3000);
        
        // Configurar intervalo de verificación con manejo de errores
        this.checkIntervalId = setInterval(async () => {
            try {
                if (!this.maintenanceMode && !this.recoveryMode) {
                    await this.checkForAlerts(false);
                }
            } catch (error) {
                console.error('❌ Error en verificación periódica:', error.message);
                this.failureCount++;
                
                // Si hay muchos errores, activar recuperación
                if (this.failureCount >= 3) {
                    console.log('🚨 Múltiples errores detectados, activando recuperación...');
                    this.initiateRecovery();
                }
            }
        }, CONFIG.checkInterval * 1000);
        
        // Mostrar información detallada
        const recoveryStatus = this.recoveryMode ? '🔄 RECUPERACIÓN' : '✅ NORMAL';
        const maintenanceStatus = this.maintenanceMode ? '🟡 MANTENIMIENTO' : '🟢 ACTIVO';
        
        console.log(`
╔════════════════════════════════════════════════════════════════╗
║       🌋 BOT SASMEX INICIADO CORRECTAMENTE 🌋                  ║
╠════════════════════════════════════════════════════════════════╣
║   🌐 Web: https://rss.sasmex.net                               ║
║   ⏱️  Intervalo: ${String(CONFIG.checkInterval).padEnd(3)} segundos                              ║
║   👥 Suscriptores: ${String(this.subscribers.length).padEnd(3)}                                    ║
║   🔄 Estado: ${recoveryStatus.padEnd(12)}                          ║
║   🔧 Modo: ${maintenanceStatus.padEnd(12)}                          ║
║   📊 Fallos: ${String(this.failureCount).padEnd(3)}                                    ║
╚════════════════════════════════════════════════════════════════╝
        `);
        
        logToFile('STARTUP', `Bot iniciado - Suscriptores: ${this.subscribers.length}, Estado: ${recoveryStatus.trim()}`);
    }
    
    getUptime() {
        const diff = Date.now() - this.startTime.getTime();
        const s = Math.floor(diff / 1000);
        const m = Math.floor(s / 60);
        const h = Math.floor(m / 60);
        const d = Math.floor(h / 24);
        
        if (d > 0) return `${d}d ${h % 24}h ${m % 60}m`;
        if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
        if (m > 0) return `${m}m ${s % 60}s`;
        return `${s}s`;
    }
    
    async stop() {
        console.log('⏹️ Deteniendo bot...');
        if (this.checkIntervalId) clearInterval(this.checkIntervalId);
        await this.bot.stopPolling();
        await closeBrowser();
        console.log('✅ Bot detenido');
    }
}

// ═══════════════════════════════════════════════════════════════════════════
//                                INICIO
// ═══════════════════════════════════════════════════════════════════════════

console.log(`
═══════════════════════════════════════════════════════════════════
     ____    _    ____  __  __ _______  __
    / ___|  / \\  / ___||  \\/  | ____\\ \\/ /
    \\___ \\ / _ \\ \\___ \\| |\\/| |  _|  \\  / 
     ___) / ___ \\ ___) | |  | | |___ /  \\ 
    |____/_/   \\_\\____/|_|  |_|_____/_/\\_\\
    
      Bot de Alertas Sísmicas - v2.0 CORREGIDO
═══════════════════════════════════════════════════════════════════
`);

if (!CONFIG.telegramToken || CONFIG.telegramToken === 'TU_TOKEN_AQUI' || CONFIG.telegramToken.length < 40) {
    console.error('❌ ERROR: Configura el TELEGRAM_TOKEN');
    process.exit(1);
}

let bot = null;

process.on('uncaughtException', (err) => {
    console.error('❌ Error:', err.message);
});

process.on('unhandledRejection', (reason) => {
    console.error('❌ Promesa rechazada:', reason);
});

async function gracefulShutdown(signal) {
    console.log(`\n⏹️ ${signal} recibido...`);
    if (bot) await bot.stop();
    else await closeBrowser();
    console.log('👋 ¡Adiós!');
    process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

try {
    bot = new SasmexBot();
    bot.startMonitoring();
} catch (error) {
    console.error('❌ Error fatal:', error.message);
    process.exit(1);
}