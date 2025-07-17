const fetch = require('node-fetch');

/**
 * Formatea la respuesta de la API en un mensaje legible para Telegram.
 * @param {object} apiResponse - La respuesta completa de la API de Gasti.pro.
 * @returns {string} - El mensaje formateado con Markdown.
 */
function formatApiResponse(apiResponse) {
    if (!apiResponse || !apiResponse.transactions || apiResponse.transactions.length === 0) {
        return "No se encontraron gastos recientes.";
    }

    const { transactions, summary } = apiResponse;
    let message = "📊 *Resumen de Gastos del Mes*\n\n";

    if (summary && summary.length > 0) {
        summary.forEach(s => {
            const expenses = parseFloat(s.expenses).toLocaleString('es-AR');
            message += `*${s.currency}:* ${expenses}\n`;
        });
        message += "\n";
    }

    message += "*Últimos gastos registrados:*\n\n";

    const sortedTransactions = [...transactions].sort((a, b) => new Date(b.date) - new Date(a.date));

    sortedTransactions.slice(0, 10).forEach(tx => {
        const date = new Date(tx.date).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
        const amount = Math.abs(tx.amount).toLocaleString('es-AR');
        const currency = tx.currency;
        const description = tx.description;
        const category = tx.category || 'Sin categoría';

        message += `🗓️ *${date}* - ${category}\n`;
        message += `   └ ${description}: *${amount} ${currency}*\n\n`;
    });

    if (transactions.length > 10) {
        message += `_... y ${transactions.length - 10} más._`;
    }

    return message;
}

/**
 * Obtiene el resumen de gastos mensuales desde la API de Gasti.pro.
 * @param {string} accessToken - El token de acceso de Supabase.
 * @param {string} apiUrl - La URL base de la API de Gasti.
 * @param {string} apiKey - La API key de Supabase.
 * @returns {object} - La respuesta de la API.
 * @throws {Error} Si la petición a la API falla.
 */
async function getMonthlyExpenses(accessToken, apiUrl, apiKey) {
    const rpcUrl = `${apiUrl}/rest/v1/rpc/get_user_transactions_by_period`;
    console.log(`Obteniendo resumen de gastos desde: ${rpcUrl}`);

    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const hours = String(today.getHours()).padStart(2, '0');
    const minutes = String(today.getMinutes()).padStart(2, '0');
    const seconds = String(today.getSeconds()).padStart(2, '0');

    const dateTo = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}Z`;
    const dateFrom = `2025-01-01T00:00:00Z`;

    const requestBody = {
        date_from: dateFrom,
        date_to: dateTo
    };

    const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: {
            'apikey': apiKey,
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        const errorBody = await response.text();
        const detailedError = `Error al llamar a la RPC de Gasti.pro. Status: ${response.status}. Body: ${errorBody}`;
        console.error(detailedError);
        throw new Error(detailedError);
    }

    const data = await response.json();
    console.log("Resumen de gastos obtenido con éxito.");
    return data;
}

/**
 * Maneja el comando /gastos del bot.
 * @param {TelegramBot} bot - La instancia del bot.
 * @param {object} msg - El objeto del mensaje de Telegram.
 * @param {function} getNewAccessToken - La función para obtener un nuevo token de acceso.
 * @param {object} config - Un objeto con la configuración necesaria (tokens, URLs, etc.).
 */
async function handleGastosCommand(bot, msg, getNewAccessToken, config) {
    const chatId = msg.chat.id;
    const thinkingMessage = await bot.sendMessage(chatId, "Buscando tus gastos en Gasti.pro...");

    try {
        const currentRefreshToken = await config.readRefreshToken();
        const tokenData = await getNewAccessToken(currentRefreshToken);

        if (!tokenData || !tokenData.accessToken) {
            throw new Error("Fallo al obtener token de Gasti.pro para ver los gastos.");
        }

        if (tokenData.newRefreshToken && tokenData.newRefreshToken !== currentRefreshToken) {
            await config.writeRefreshToken(tokenData.newRefreshToken);
        }

        const apiResponse = await getMonthlyExpenses(
            tokenData.accessToken,
            config.GASTI_API_URL,
            config.SUPABASE_APIKEY
        );

        const message = formatApiResponse(apiResponse);

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: thinkingMessage.message_id,
            parse_mode: 'Markdown'
        });

    } catch (error) {
        // Este catch ahora recibirá errores más detallados desde getMonthlyExpenses
        console.error("Error procesando el comando /gastos:", error.message);
        await bot.editMessageText(
            "🔥 ¡Ups! Hubo un error y no pude obtener tus gastos. Revisa los logs del servidor.",
            { chat_id: chatId, message_id: thinkingMessage.message_id }
        );
        // Relanzamos el error para que el manejador principal en index.js también lo registre.
        throw error;
    }
}

module.exports = { handleGastosCommand };