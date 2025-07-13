// Carga las variables de entorno desde el archivo .env al inicio de todo.
require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');

// ===================================================================================
// CONFIGURACIÓN DE SECRETOS (Leídos desde el archivo .env)
// ===================================================================================

// Leemos las claves secretas desde las variables de entorno.
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const GASTI_REFRESH_TOKEN = process.env.GASTI_REFRESH_TOKEN;
const GASTI_API_URL = process.env.GASTI_API_URL || 'https://TU_API_GASTI_URL';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://TU_SUPABASE_URL';
const SUPABASE_APIKEY = process.env.SUPABASE_APIKEY || 'TU_SUPABASE_APIKEY_PUBLICA';
const GASTI_USER_EMAIL = process.env.GASTI_USER_EMAIL || 'usuario@email.com';
const GASTI_USER_ID = process.env.GASTI_USER_ID || 'user-id-generico';

if (!TELEGRAM_TOKEN || !DEEPSEEK_API_KEY || !GASTI_REFRESH_TOKEN) {
    console.error("FATAL ERROR: Faltan variables de entorno. Asegúrate de que el archivo .env existe y está configurado correctamente.");
    process.exit(1);
}

// ===================================================================================
// PARTE 1: LÓGICA DE LA API DE GASTI.PRO (Sin cambios)
// ===================================================================================

async function getNewAccessToken(refreshToken) {
    console.log('Solicitando un nuevo token de acceso para Gasti.pro...');
    const url = `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`;
    const apiKeyPublica = SUPABASE_APIKEY;
    try {
        const response = await fetch(url, { method: 'POST', headers: { 'apikey': apiKeyPublica, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: refreshToken }) });
        if (!response.ok) throw new Error('No se pudo refrescar el token de Gasti.pro.');
        const data = await response.json();
        return data.access_token;
    } catch (error) { console.error('Error al obtener el access_token:', error.message); return null; }
}

async function sendTransaction(accessToken, expenseData) {
    console.log('Enviando transacción a Gasti.pro:', expenseData);
    const url = `${GASTI_API_URL}/rest/v1/transactions?select=*`;
    const apiKeyPublica = SUPABASE_APIKEY;

    const transactionPayload = {
        description: expenseData.description,
        amount: -Math.abs(parseFloat(expenseData.amount)),
        category: expenseData.category, // Se envía la categoría con emoji
        type: "expense",
        date: new Date().toISOString(),
        currency: (expenseData.currency || 'USD').toUpperCase(),
        user_email: GASTI_USER_EMAIL,
        user_id: GASTI_USER_ID
    };
    try {
        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': apiKeyPublica, 'Authorization': `Bearer ${accessToken}`, 'Prefer': 'return=representation' }, body: JSON.stringify(transactionPayload) });
        if (!response.ok) { console.error('Error de Gasti.pro:', await response.text()); return false; }
        console.log('¡Transacción creada con éxito en Gasti.pro!');
        return true;
    } catch (error) { console.error('Error al enviar la transacción:', error); return false; }
}

// ===================================================================================
// PARTE 2: LÓGICA DE IA CON DEEPSEEK (CON CATEGORÍAS Y EMOJIS)
// ===================================================================================

// --- CAMBIO CLAVE: La lista de categorías ahora incluye los emojis ---
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
                messages: [ { "role": "system", "content": SYSTEM_PROMPT }, { "role": "user", "content": text } ],
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
// PARTE 3: LÓGICA PRINCIPAL DEL BOT DE TELEGRAM (Sin cambios)
// ===================================================================================

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

console.log('🤖 Bot de gastos con IA iniciado, escuchando mensajes...');

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, "¡Hola! Soy tu asistente de gastos con IA. Descríbeme tus gastos de forma natural y yo los registraré.\n\nPor ejemplo: 'Compré zapatillas nuevas por 50000 pesos' o 'Cena con amigos 45.50 usd'");
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text || text.startsWith('/')) return;

    const thinkingMessage = await bot.sendMessage(chatId, "🤔 Analizando tu gasto...");
    const expense = await parseExpenseWithAI(text);
    
    bot.editMessageText(`Análisis completado.`, { chat_id: chatId, message_id: thinkingMessage.message_id });

    if (!expense || !expense.amount || !expense.description) {
        bot.sendMessage(chatId, "😕 No pude entender los detalles de ese gasto. ¿Podrías intentarlo de nuevo con otro formato?");
        return;
    }

    // El mensaje de confirmación ahora mostrará automáticamente la categoría con su emoji
    bot.sendMessage(chatId, `✅ ¡Entendido! Registrando en Gasti.pro:\n\n📝 **Descripción:** ${expense.description}\n💰 **Monto:** ${expense.amount} ${(expense.currency || 'USD').toUpperCase()}\n🏷️ **Categoría:** ${expense.category}`);

    try {
        const accessToken = await getNewAccessToken(GASTI_REFRESH_TOKEN);
        if (!accessToken) throw new Error("Fallo al obtener token de Gasti.pro.");

        const success = await sendTransaction(accessToken, expense);
        if (!success) throw new Error("Fallo al enviar la transacción a Gasti.pro.");

        bot.sendMessage(chatId, "🎉 ¡Gasto registrado con éxito!");

    } catch (error) {
        console.error("Error en el flujo principal:", error);
        bot.sendMessage(chatId, "🔥 ¡Ups! Hubo un error en mi sistema y no pude registrar el gasto.");
    }
});