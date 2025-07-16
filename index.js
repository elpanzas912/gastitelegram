// Carga las variables de entorno desde el archivo .env al inicio de todo.
require('dotenv').config();

// ===================================================================================
// IMPORTACIONES
// ===================================================================================
const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');
const fs = require('fs').promises; // Usamos fs.promises para código asíncrono limpio
const path = require('path');     // Para construir rutas de archivo de forma segura
const { handleGastosCommand } = require('./gastitelegram/gastos');

// ===================================================================================
// CONFIGURACIÓN DE SECRETOS (Leídos desde el archivo .env)
// ===================================================================================
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const GASTI_INITIAL_REFRESH_TOKEN = process.env.GASTI_REFRESH_TOKEN; // El token para el primer arranque
const GASTI_API_URL = process.env.GASTI_API_URL || 'https://api.gasti.pro';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://db.gasti.pro';
const SUPABASE_APIKEY = process.env.SUPABASE_APIKEY;
const GASTI_USER_EMAIL = process.env.GASTI_USER_EMAIL;
const GASTI_USER_ID = process.env.GASTI_USER_ID;

if (!TELEGRAM_TOKEN || !DEEPSEEK_API_KEY || !GASTI_INITIAL_REFRESH_TOKEN || !SUPABASE_APIKEY) {
    console.error("FATAL ERROR: Faltan variables de entorno. Asegúrate de que todas las claves están en el archivo .env o en las variables de entorno de Railway.");
    process.exit(1);
}

// ===================================================================================
// LÓGICA DE ALMACENAMIENTO PERSISTENTE (CLAVE PARA RAILWAY)
// ===================================================================================

const DATA_DIR = process.env.RAILWAY_ENVIRONMENT ? '/data' : path.join(__dirname, 'local_data');
const TOKEN_FILE_PATH = path.join(DATA_DIR, 'gasti_token.json');

async function readRefreshToken() {
    try {
        await fs.access(TOKEN_FILE_PATH);
        const data = await fs.readFile(TOKEN_FILE_PATH, 'utf-8');
        const tokenData = JSON.parse(data);
        console.log("Refresh token leído desde el almacenamiento persistente:", TOKEN_FILE_PATH);
        return tokenData.refreshToken;
    } catch (error) {
        console.log("Archivo de token no encontrado. Usando el token inicial de las variables de entorno.");
        return GASTI_INITIAL_REFRESH_TOKEN;
    }
}

async function writeRefreshToken(newToken) {
    try {
        await fs.mkdir(path.dirname(TOKEN_FILE_PATH), { recursive: true });
        const tokenData = { refreshToken: newToken, lastUpdated: new Date().toISOString() };
        await fs.writeFile(TOKEN_FILE_PATH, JSON.stringify(tokenData, null, 2), 'utf-8');
        console.log("Nuevo refresh token guardado exitosamente en:", TOKEN_FILE_PATH);
    } catch (error) {
        console.error("Error fatal: No se pudo escribir el nuevo refresh token en el archivo:", error);
    }
}

// ===================================================================================
// PARTE 1: LÓGICA DE LA API DE GASTI.PRO
// ===================================================================================

async function getNewAccessToken(refreshToken) {
    console.log('Solicitando un nuevo token de acceso para Gasti.pro...');
    const url = `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`;
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'apikey': SUPABASE_APIKEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: refreshToken })
        });
        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`Error de la API de Gasti/Supabase. Status: ${response.status}. Body: ${errorBody}`);
            throw new Error('No se pudo refrescar el token de Gasti.pro.');
        }
        const data = await response.json();
        return {
            accessToken: data.access_token,
            newRefreshToken: data.refresh_token
        };
    } catch (error) {
        console.error('Error al obtener el access_token:', error.message);
        return null;
    }
}

async function sendTransaction(accessToken, expenseData) {
    console.log('Enviando transacción a Gasti.pro:', expenseData);
    const url = `${GASTI_API_URL}/rest/v1/transactions?select=*`;
    const transactionPayload = {
        description: expenseData.description,
        amount: -Math.abs(parseFloat(expenseData.amount)),
        category: expenseData.category,
        type: "expense",
        date: new Date().toISOString(),
        currency: (expenseData.currency || 'USD').toUpperCase(),
        user_email: GASTI_USER_EMAIL,
        user_id: GASTI_USER_ID
    };
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_APIKEY, 'Authorization': `Bearer ${accessToken}`, 'Prefer': 'return=representation' },
            body: JSON.stringify(transactionPayload)
        });
        if (!response.ok) {
            console.error('Error de Gasti.pro:', await response.text());
            return false;
        }
        console.log('¡Transacción creada con éxito en Gasti.pro!');
        return true;
    } catch (error) {
        console.error('Error al enviar la transacción:', error);
        return false;
    }
}

// ===================================================================================
// PARTE 2: LÓGICA DE IA CON DEEPSEEK
// ===================================================================================

const SYSTEM_PROMPT = `
Eres una API asistente de finanzas. Tu única tarea es analizar el texto de un usuario que describe un gasto y devolver un objeto JSON.
Tu respuesta DEBE SER ÚNICAMENTE el objeto JSON, sin explicaciones ni texto adicional.
El JSON debe tener la siguiente estructura:
{
  "amount": <número>,
  "description": "<descripción limpia del gasto>",
  "currency": "<código ISO de 3 letras, ej. USD, ARS, EUR>",
  "category": "<una de las siguientes categorías, incluyendo el emoji>"
}
Las categorías permitidas son ESTRICTAMENTE las siguientes: "💰 Ahorros", "🚗 Auto", "⛽ Combustible", "🍽️ Comida", "🎨 Decoración", "⚽ Deportes", "🤝 Donaciones", "📚 Educación", "💼 Emprendimiento", "🎮 Entretenimiento", "🅿️ Estacionamiento", "💊 Farmacia", "🏋️ Gimnasio", "👼 Hijos", "🎨 Hobbies", "📈 Inversiones", "🔧 Mantenimiento", "🐶 Mascotas", "📦 Otros", "💑 Pareja", "🏦 Prestamos", "🔄 Reconciliación de cuenta", "🎁 Regalos", "👕 Ropa", "🏥 Salud", "🔒 Seguros", "🚰 Servicios", "📱 Subscripciones", "🛒 Supermercado", "💳 Tarjetas", "💼 Trabajo", "🚌 Transporte", "🌴 Vacaciones", "🏠 Vivienda".
Reglas:
1. Debes elegir la categoría más apropiada de la lista, incluyendo su emoji. Si ninguna encaja, usa "📦 Otros".
2. Si no se especifica una moneda, asume 'USD'. El usuario es de Argentina, por lo que si dice 'pesos', asume 'ARS'.
3. La descripción debe ser concisa y clara.
4. Si el texto no parece ser un gasto, devuelve un JSON con la clave de error: {"error": "El texto no parece ser un gasto."}
`;

async function parseExpenseWithAI(text) {
    console.log(`Enviando a DeepSeek para análisis: "${text}"`);
    try {
        const response = await fetch("https://api.deepseek.com/chat/completions", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_API_KEY}` },
            body: JSON.stringify({
                model: "deepseek-chat",
                messages: [{ "role": "system", "content": SYSTEM_PROMPT }, { "role": "user", "content": text }],
                temperature: 0,
                stream: false
            })
        });
        if (!response.ok) { console.error("Error en la respuesta de la API de DeepSeek:", response.status, await response.text()); return null; }
        const aiResponse = await response.json();
        let content = aiResponse.choices[0].message.content;
        content = content.replace(/```json|```/g, '').trim();
        const parsedContent = JSON.parse(content);
        console.log("Respuesta de la IA parseada:", parsedContent);
        if (parsedContent.error) { console.log("La IA determinó que no es un gasto."); return null; }
        return parsedContent;
    } catch (error) { console.error("Error fatal al procesar con DeepSeek:", error); return null; }
}

// ===================================================================================
// PARTE 3: LÓGICA PRINCIPAL DEL BOT DE TELEGRAM (REFACTORIZADA)
// ===================================================================================

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// Un único manejador de mensajes para centralizar la lógica
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // Si no hay texto, no hacemos nada.
    if (!text) return;

    try {
        // Router de comandos
        if (text.startsWith('/start')) {
            console.log(`[${chatId}] Comando /start recibido.`);
            await bot.sendMessage(chatId, "¡Hola! Soy tu asistente de gastos con IA. Descríbeme tus gastos de forma natural y yo los registraré.\n\nPor ejemplo: 'Compré zapatillas nuevas por 50000 pesos' o 'Cena con amigos 45.50 usd'");

        } else if (text.startsWith('/gastos')) {
            console.log(`[${chatId}] Comando /gastos recibido.`);
            // Preparamos la configuración para la función externa
            const config = {
                readRefreshToken,
                writeRefreshToken,
                GASTI_API_URL,
                SUPABASE_APIKEY
            };
            // Llamamos a la lógica del comando /gastos
            await handleGastosCommand(bot, msg, getNewAccessToken, config);

        } else {
            // Si no es un comando, es un gasto para procesar
            console.log(`[${chatId}] Procesando texto de gasto: \"${text}\"`);
            const thinkingMessage = await bot.sendMessage(chatId, "🤔 Analizando tu gasto...");

            const expense = await parseExpenseWithAI(text);

            await bot.editMessageText(`Análisis completado.`, { chat_id: chatId, message_id: thinkingMessage.message_id });

            if (!expense || !expense.amount || !expense.description) {
                await bot.sendMessage(chatId, "😕 No pude entender los detalles de ese gasto. ¿Podrías intentarlo de nuevo con otro formato?");
                return;
            }

            await bot.sendMessage(chatId, `✅ ¡Entendido! Registrando en Gasti.pro:\n\n📝 **Descripción:** ${expense.description}\n💰 **Monto:** ${expense.amount} ${(expense.currency || 'USD').toUpperCase()}\n🏷️ **Categoría:** ${expense.category}`, { parse_mode: 'Markdown' });

            // Lógica de token y envío de transacción
            const currentRefreshToken = await readRefreshToken();
            const tokenData = await getNewAccessToken(currentRefreshToken);
            if (!tokenData || !tokenData.accessToken) {
                throw new Error("Fallo al obtener token de Gasti.pro. Verifica las credenciales y la conexión.");
            }

            if (tokenData.newRefreshToken && tokenData.newRefreshToken !== currentRefreshToken) {
                await writeRefreshToken(tokenData.newRefreshToken);
            }

            const success = await sendTransaction(tokenData.accessToken, expense);
            if (!success) {
                throw new Error("Fallo al enviar la transacción a Gasti.pro.");
            }

            await bot.sendMessage(chatId, "🎉 ¡Gasto registrado con éxito!");
        }
    } catch (error) {
        console.error(`[ERROR en el chat ${chatId}]`, error);
        await bot.sendMessage(chatId, "🔥 ¡Ups! Hubo un error en mi sistema. Ya estoy avisado y lo revisaré. Por favor, intenta de nuevo más tarde.");
    }
});

// Manejo de errores del bot para evitar que se caiga
bot.on('polling_error', (error) => {
    console.error(`Error de polling de Telegram: ${error.code} - ${error.message}`);
});

console.log("🤖 Bot de gastos con IA iniciado, escuchando mensajes...");
