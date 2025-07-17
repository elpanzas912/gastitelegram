const fetch = require('node-fetch');

const SYSTEM_PROMPT_RESUMEN = `
Eres un analista financiero experto. Tu tarea es analizar una lista de transacciones de gastos y proporcionar un resumen detallado y perspicaz. Tu análisis debe incluir:

1.  **Resumen General:** Una visión concisa de los patrones de gasto.
2.  **Categorías Principales:** Identifica las 3-5 categorías donde el usuario gasta más dinero.
3.  **Gastos Excesivos/Innecesarios:** Señala posibles áreas donde el gasto podría ser considerado excesivo o no esencial, justificando brevemente por qué.
4.  **Oportunidades de Ahorro:** Ofrece consejos prácticos y específicos sobre cómo el usuario puede reducir gastos en ciertas categorías o en general.
5.  **Tendencias:** Si hay suficientes datos, menciona cualquier tendencia interesante (ej. aumento/disminución en ciertas categorías, gastos estacionales).

Formato de las transacciones que recibirás:
- Fecha (YYYY-MM-DD), Descripción, Monto, Moneda, Categoría

Ejemplo de formato de salida:

--- Resumen Financiero ---

**Visión General:**
[Tu resumen conciso aquí]

**Top Categorías de Gasto:**
- [Categoría 1]: [Monto Total] [Moneda]
- [Categoría 2]: [Monto Total] [Moneda]
...

**Áreas de Gasto Excesivo:**
- [Categoría/Descripción]: [Justificación y Monto]

**Consejos para Ahorrar:**
- [Consejo 1]
- [Consejo 2]
...

**Tendencias Observadas:**
- [Tendencia 1]

Tu respuesta debe ser clara, concisa y fácil de entender para un usuario no financiero. Utiliza un lenguaje alentador y constructivo. No incluyas ninguna introducción o despedida, solo el resumen. Si no hay transacciones, indica que no hay datos para analizar.
`;

/**
 * Obtiene todas las transacciones de un usuario desde la API de Gasti.pro.
 * @param {string} accessToken - El token de acceso de Supabase.
 * @param {string} apiUrl - La URL base de la API de Gasti.
 * @param {string} apiKey - La API key de Supabase.
 * @returns {Array<object>} - Un array de objetos de transacción.
 * @throws {Error} Si la petición a la API falla.
 */
async function getAllTransactions(accessToken, apiUrl, apiKey) {
    const rpcUrl = `${apiUrl}/rest/v1/rpc/get_user_transactions_by_period`;
    console.log(`Obteniendo todas las transacciones desde: ${rpcUrl}`);

    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const hours = String(today.getHours()).padStart(2, '0');
    const minutes = String(today.getMinutes()).padStart(2, '0');
    const seconds = String(today.getSeconds()).padStart(2, '0');

    // Establecemos un rango muy amplio para intentar obtener todas las transacciones
    const dateTo = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}Z`;
    const dateFrom = `2020-01-01T00:00:00Z`; // Desde el 1 de enero de 2020

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
        const detailedError = `Error al llamar a la RPC para obtener todas las transacciones. Status: ${response.status}. Body: ${errorBody}`;
        console.error(detailedError);
        throw new Error(detailedError);
    }

    const data = await response.json();
    return data.transactions || []; // Aseguramos que siempre devolvemos un array
}

/**
 * Analiza las transacciones con DeepSeek AI.
 * @param {Array<object>} transactions - Array de objetos de transacción.
 * @param {string} deepseekApiKey - La API Key de DeepSeek.
 * @returns {string} - El resumen generado por la IA.
 * @throws {Error} Si la llamada a la API de DeepSeek falla.
 */
async function analyzeExpensesWithAI(transactions, deepseekApiKey) {
    if (transactions.length === 0) {
        return "No hay transacciones para analizar. Registra algunos gastos primero.";
    }

    // Formatear las transacciones para el prompt de la IA
    const formattedTransactions = transactions.map(tx => {
        const date = new Date(tx.date).toISOString().split('T')[0];
        const description = tx.description.replace(/\n/g, ' '); // Eliminar saltos de línea en descripción
        const amount = Math.abs(tx.amount);
        const currency = tx.currency;
        const category = tx.category || 'Sin categoría';
        return `${date}, ${description}, ${amount}, ${currency}, ${category}`;
    }).join('\n');

    const userPrompt = `Aquí están mis transacciones de gastos:\n\n${formattedTransactions}\n\nPor favor, genera el resumen financiero detallado siguiendo las instrucciones que te di.`;

    console.log("Enviando transacciones a DeepSeek para análisis...");

    const response = await fetch("https://api.deepseek.com/chat/completions", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${deepseekApiKey}` },
        body: JSON.stringify({
            model: "deepseek-chat", // Usamos el modelo deepseek-chat como en index.js
            messages: [
                { "role": "system", "content": SYSTEM_PROMPT_RESUMEN },
                { "role": "user", "content": userPrompt }
            ],
            temperature: 0.7, // Un poco más de creatividad para el resumen
            stream: false
        })
    });

    if (!response.ok) {
        const errorBody = await response.text();
        const detailedError = `Error en la respuesta de la API de DeepSeek para el resumen. Status: ${response.status}. Body: ${errorBody}`;
        console.error(detailedError);
        throw new Error(detailedError);
    }

    const aiResponse = await response.json();
    return aiResponse.choices[0].message.content.trim();
}

/**
 * Maneja el comando /resumen del bot.
 * @param {TelegramBot} bot - La instancia del bot.
 * @param {object} msg - El objeto del mensaje de Telegram.
 * @param {function} getNewAccessToken - La función para obtener un nuevo token de acceso.
 * @param {object} config - Un objeto con la configuración necesaria (tokens, URLs, etc.).
 */
async function handleResumenCommand(bot, msg, getNewAccessToken, config) {
    const chatId = msg.chat.id;
    const thinkingMessage = await bot.sendMessage(chatId, "🧠 Analizando tus gastos con IA... Esto puede tardar un momento.");

    try {
        const currentRefreshToken = await config.readRefreshToken();
        const tokenData = await getNewAccessToken(currentRefreshToken);

        if (!tokenData || !tokenData.accessToken) {
            throw new Error("Fallo al obtener token de Gasti.pro para generar el resumen.");
        }

        if (tokenData.newRefreshToken && tokenData.newRefreshToken !== currentRefreshToken) {
            await config.writeRefreshToken(tokenData.newRefreshToken);
        }

        const allTransactions = await getAllTransactions(
            tokenData.accessToken,
            config.GASTI_API_URL,
            config.SUPABASE_APIKEY
        );

        const aiSummary = await analyzeExpensesWithAI(allTransactions, config.DEEPSEEK_API_KEY);

        await bot.editMessageText(aiSummary, {
            chat_id: chatId,
            message_id: thinkingMessage.message_id,
            parse_mode: 'Markdown' // Asumimos que la IA devolverá Markdown
        });

    } catch (error) {
        console.error("Error procesando el comando /resumen:", error.message);
        await bot.editMessageText(
            "🔥 ¡Ups! Hubo un error al generar el resumen. Revisa los logs del servidor.",
            { chat_id: chatId, message_id: thinkingMessage.message_id }
        );
        throw error; // Relanzar para que el manejador principal lo capture
    }
}

module.exports = { handleResumenCommand };
