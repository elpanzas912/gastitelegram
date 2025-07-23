const fetch = require('node-fetch');

const SYSTEM_PROMPT_ANALYZE_QUERY = `
Eres una API experta en análisis de lenguaje natural para consultas financieras. Tu única tarea es analizar la consulta de un usuario y convertirla en un objeto JSON que pueda ser usado para filtrar transacciones.

**Instrucciones:**
1.  **Analiza el Periodo de Tiempo:**
    *   Interpreta frases como "hoy", "ayer", "esta semana", "la semana pasada", "este mes", "el mes pasado", "este año", "el año pasado".
    *   Interpreta meses específicos como "en enero", "de julio", etc. Asume el año actual (2025) si no se especifica.
    *   Calcula las fechas `date_from` y `date_to` en formato `YYYY-MM-DD`.
    *   Si no se especifica un periodo, asume "este mes".

2.  **Analiza el Tipo de Transacción:**
    *   Busca palabras clave como "gastos", "egresos", "salidas" para determinar `type: 'expense'`.
    *   Busca "ingresos", "entradas", "ganancias" para `type: 'income'`.
    *   Si no se especifica, usa `type: 'all'`.

3.  **Analiza la Categoría:**
    *   Si el usuario menciona una categoría (ej. "en comida", "de la categoría transporte"), extráela.
    *   La categoría debe coincidir con las usadas en el sistema. No incluyas el emoji.

4.  **Genera el JSON de Salida:**
    *   Tu respuesta DEBE SER ÚNICAMENTE el objeto JSON.
    *   La estructura debe ser:
      {
        "date_from": "YYYY-MM-DD",
        "date_to": "YYYY-MM-DD",
        "type": "'expense' | 'income' | 'all'",
        "category": "<nombre_de_categoria> | null"
      }
    *   Si no puedes entender la consulta, devuelve: {"error": "No entendí la consulta. Por favor, sé más específico."}

**Fecha de Referencia para cálculos:** 2025-07-23
`;

/**
 * Llama a la IA para analizar la consulta en lenguaje natural del usuario.
 * @param {string} query - La consulta del usuario.
 * @param {string} deepseekApiKey - La API key de DeepSeek.
 * @returns {object} - El objeto JSON con los parámetros de la consulta.
 */
async function analyzeQueryWithAI(query, deepseekApiKey) {
    console.log(`Enviando consulta a DeepSeek para análisis: "${query}"`);
    try {
        const response = await fetch("https://api.deepseek.com/chat/completions", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${deepseekApiKey}` },
            body: JSON.stringify({
                model: "deepseek-reasoner",
                messages: [
                    { "role": "system", "content": SYSTEM_PROMPT_ANALYZE_QUERY },
                    { "role": "user", "content": query }
                ],
                temperature: 0,
                stream: false
            })
        });

        if (!response.ok) {
            console.error("Error en la respuesta de la API de DeepSeek:", response.status, await response.text());
            return { error: "No pude contactar a la IA para analizar tu pregunta." };
        }

        const aiResponse = await response.json();
        let content = aiResponse.choices[0].message.content;
        content = content.replace(/```json|```/g, '').trim();
        const parsedContent = JSON.parse(content);
        console.log("Respuesta de la IA parseada:", parsedContent);
        return parsedContent;

    } catch (error) {
        console.error("Error fatal al procesar con DeepSeek:", error);
        return { error: "Hubo un error interno al analizar tu pregunta con la IA." };
    }
}

/**
 * Obtiene transacciones filtradas desde la API de Gasti.pro.
 * @param {object} params - Los parámetros de la consulta (date_from, date_to).
 * @param {string} accessToken - El token de acceso de Supabase.
 * @param {string} apiUrl - La URL base de la API de Gasti.
 * @param {string} apiKey - La API key de Supabase.
 * @returns {Array<object>} - Un array de objetos de transacción.
 */
async function getFilteredTransactions(params, accessToken, apiUrl, apiKey) {
    const rpcUrl = `${apiUrl}/rest/v1/rpc/get_user_transactions_by_period`;
    console.log(`Obteniendo transacciones filtradas desde: ${rpcUrl} con params:`, params);

    const requestBody = {
        date_from: `${params.date_from}T00:00:00Z`,
        date_to: `${params.date_to}T23:59:59Z`
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
        throw new Error(`Error al llamar a la RPC. Status: ${response.status}. Body: ${errorBody}`);
    }

    const data = await response.json();
    return data.transactions || [];
}

/**
 * Formatea las transacciones y genera un resumen.
 * @param {Array<object>} transactions - Las transacciones a formatear.
 * @param {object} queryParams - Los parámetros de la consulta original.
 * @returns {string} - El mensaje formateado para Telegram.
 */
function formatResults(transactions, queryParams) {
    let message = `🔎 *Resultados para tu consulta*

`;
    message += `*Período:* ${new Date(queryParams.date_from).toLocaleDateString('es-AR')} al ${new Date(queryParams.date_to).toLocaleDateString('es-AR')}
`;
    message += `*Tipo:* ${queryParams.type || 'Todos'}
`;
    if (queryParams.category) {
        message += `*Categoría:* ${queryParams.category}
`;
    }
    message += `
`;

    let filtered = [...transactions];

    // Filtrar por tipo
    if (queryParams.type === 'expense') {
        filtered = filtered.filter(t => t.amount < 0);
    } else if (queryParams.type === 'income') {
        filtered = filtered.filter(t => t.amount > 0);
    }

    // Filtrar por categoría
    if (queryParams.category) {
        const categoryRegex = new RegExp(queryParams.category, 'i');
        filtered = filtered.filter(t => t.category && categoryRegex.test(t.category));
    }

    if (filtered.length === 0) {
        return message + "No se encontraron transacciones que coincidan con tu búsqueda.";
    }

    let totalARS = 0;
    let totalUSD = 0;

    filtered.forEach(tx => {
        const date = new Date(tx.date).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
        const amount = parseFloat(tx.amount);
        const currency = tx.currency;
        const description = tx.description;
        const category = tx.category || 'Sin categoría';
        const typeIcon = amount < 0 ? '🔻' : '🔼';

        if (currency === 'ARS') totalARS += amount;
        if (currency === 'USD') totalUSD += amount;

        message += `${typeIcon} *${date}* - ${description}
`;
        message += `   └ ${category}: *${Math.abs(amount).toLocaleString('es-AR')} ${currency}*

`;
    });

    message += `*Resumen del Período:*
`;
    if (totalUSD !== 0) {
        message += `*Balance en USD:* ${totalUSD.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
`;
    }
    if (totalARS !== 0) {
        message += `*Balance en ARS:* ${totalARS.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })}
`;
    }
    message += `*Total de transacciones:* ${filtered.length}`;

    return message;
}


/**
 * Maneja el flujo completo de una consulta de información.
 * @param {TelegramBot} bot - La instancia del bot.
 * @param {object} msg - El objeto del mensaje de Telegram con la consulta.
 * @param {function} getNewAccessToken - La función para obtener un nuevo token de acceso.
 * @param {object} config - Un objeto con la configuración necesaria.
 */
async function handleInfoQuery(bot, msg, getNewAccessToken, config) {
    const chatId = msg.chat.id;
    const query = msg.text;

    const thinkingMessage = await bot.sendMessage(chatId, "🤔 Entendido. Analizando tu pregunta con IA...");

    try {
        // 1. Analizar la consulta del usuario con IA
        const queryParams = await analyzeQueryWithAI(query, config.DEEPSEEK_API_KEY);

        if (queryParams.error) {
            await bot.editMessageText(queryParams.error, { chat_id: chatId, message_id: thinkingMessage.message_id });
            return;
        }

        await bot.editMessageText("✅ Análisis completo. Buscando transacciones en Gasti.pro...", { chat_id: chatId, message_id: thinkingMessage.message_id });

        // 2. Obtener token de Gasti.pro
        const currentRefreshToken = await config.readRefreshToken();
        const tokenData = await getNewAccessToken(currentRefreshToken);
        if (!tokenData || !tokenData.accessToken) {
            throw new Error("Fallo al obtener token de Gasti.pro.");
        }
        if (tokenData.newRefreshToken && tokenData.newRefreshToken !== currentRefreshToken) {
            await config.writeRefreshToken(tokenData.newRefreshToken);
        }

        // 3. Obtener transacciones de la API
        const transactions = await getFilteredTransactions(
            queryParams,
            tokenData.accessToken,
            config.GASTI_API_URL,
            config.SUPABASE_APIKEY
        );

        // 4. Formatear y enviar resultados
        const finalMessage = formatResults(transactions, queryParams);

        await bot.editMessageText(finalMessage, {
            chat_id: chatId,
            message_id: thinkingMessage.message_id,
            parse_mode: 'Markdown'
        });

    } catch (error) {
        console.error("Error procesando la consulta de info:", error.message);
        await bot.editMessageText(
            "🔥 ¡Ups! Hubo un error al procesar tu solicitud. Revisa los logs del servidor.",
            { chat_id: chatId, message_id: thinkingMessage.message_id }
        );
        throw error;
    }
}

module.exports = { handleInfoQuery };
