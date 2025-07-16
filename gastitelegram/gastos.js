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
            // Usamos toLocaleString para un formato de número más amigable
            const expenses = parseFloat(s.expenses).toLocaleString('es-AR');
            message += `*${s.currency}:* ${expenses}\n`;
        });
        message += "\n";
    }

    message += "*Últimos gastos registrados:*\n\n";

    // Limita la cantidad de transacciones para no hacer el mensaje muy largo
    transactions.slice(0, 10).forEach(tx => {
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
 * La estructura de la respuesta sugiere que esto llama a una Función de Base de Datos (RPC) en Supabase.
 * @param {string} accessToken - El token de acceso de Supabase.
 * @param {string} apiUrl - La URL base de la API de Gasti.
 * @param {string} apiKey - La API key de Supabase.
 * @returns {object|null} - La respuesta de la API o null si hay un error.
 */
async function getMonthlyExpenses(accessToken, apiUrl, apiKey) {
    // La estructura del JSON de ejemplo sugiere una llamada a una función RPC,
    // no a una tabla directamente. Asumo que se llama 'get_monthly_summary'.
    const rpcUrl = `${apiUrl}/rest/v1/rpc/get_monthly_summary`;
    console.log(`Obteniendo resumen de gastos desde: ${rpcUrl}`);

    try {
        const response = await fetch(rpcUrl, {
            method: 'POST', // Las RPC de Supabase se llaman con POST
            headers: {
                'apikey': apiKey,
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            // Se puede pasar un body con parámetros si la función los requiere
            body: JSON.stringify({})
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`Error al llamar a la RPC de Gasti.pro. Status: ${response.status}. Body: ${errorBody}`);
            return null;
        }

        const data = await response.json();
        console.log("Resumen de gastos obtenido con éxito.");
        return data;
    } catch (error) {
        console.error('Error en la petición RPC para obtener gastos:', error);
        return null;
    }
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
        // Reutiliza la lógica de autenticación existente
        const currentRefreshToken = await config.readRefreshToken();
        const tokenData = await getNewAccessToken(currentRefreshToken);

        if (!tokenData || !tokenData.accessToken) {
            throw new Error("Fallo al obtener token de Gasti.pro para ver los gastos.");
        }

        // Si la API rota el token, lo guardamos para la próxima vez
        if (tokenData.newRefreshToken && tokenData.newRefreshToken !== currentRefreshToken) {
            await config.writeRefreshToken(tokenData.newRefreshToken);
        }

        // Llama a la función que obtiene los datos de la API
        const apiResponse = await getMonthlyExpenses(
            tokenData.accessToken,
            config.GASTI_API_URL,
            config.SUPABASE_APIKEY
        );

        if (apiResponse === null) {
            throw new Error("La respuesta de la API de gastos estaba vacía o hubo un error.");
        }

        // Formatea la respuesta para el usuario
        const message = formatApiResponse(apiResponse);

        // Edita el mensaje de "pensando..." con el resultado final
        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: thinkingMessage.message_id,
            parse_mode: 'Markdown'
        });

    } catch (error) {
        console.error("Error procesando el comando /gastos:", error);
        await bot.editMessageText(
            "🔥 ¡Ups! Hubo un error y no pude obtener tus gastos. Revisa los logs del servidor.",
            { chat_id: chatId, message_id: thinkingMessage.message_id }
        );
    }
}

module.exports = { handleGastosCommand };
