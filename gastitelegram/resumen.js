const fetch = require('node-fetch');

const SYSTEM_PROMPT_RESUMEN = `
Eres un analista financiero y asesor personal. Tu tarea es tomar un resumen de datos financieros y convertirlo en un informe narrativo, amigable y fácil de entender.

**Instrucciones:**
1.  **Visión General:** Comienza con un párrafo corto que resuma la salud financiera general del usuario basándote en los balances netos. Sé alentador pero honesto.
2.  **Análisis de Gastos:** Comenta sobre los gastos totales en cada moneda. Luego, analiza las "Top 5 Categorías" de gasto. Señala dónde se está yendo la mayor parte del dinero y si alguna categoría parece particularmente alta.
3.  **Análisis de Ingresos:** Si hay datos de ingresos, coméntalos. Menciona las fuentes de ingresos y cómo se comparan con los gastos.
4.  **Consejos Prácticos y Oportunidades de Ahorro:** Esta es la parte más importante. Basándote en las categorías de gasto principales, ofrece de 2 a 4 consejos específicos, prácticos y accionables para que el usuario pueda reducir gastos. Por ejemplo, si "🍽️ Comida" es alto, sugiere planificar comidas o cocinar más en casa. Si "📱 Subscripciones" es alto, sugiere revisar los servicios que realmente usa.
5.  **Balance Final:** Termina con una nota positiva, resumiendo el balance neto y animando al usuario a seguir llevando un control de sus finanzas.

**Tono:**
- Empático, constructivo y alentador.
- Evita el lenguaje técnico complejo.
- Utiliza Markdown (negritas, listas) para que el texto sea fácil de leer.

**IMPORTANTE:** No inventes datos. Basa tu análisis estrictamente en el resumen de texto que te proporciono. No incluyas ninguna introducción o despedida, solo el informe.
`;

/**
 * Procesa las transacciones para generar un resumen numérico y estadístico.
 * @param {Array<object>} transacciones - El array de transacciones desde la API.
 * @returns {string} - Un string formateado con el resumen de datos.
 */
function analizarTransacciones(transacciones) {
    if (!transacciones || transacciones.length === 0) {
        return "No se encontraron transacciones para analizar.";
    }

    const gastos = transacciones.filter(t => t.type === 'expense');
    const ingresos = transacciones.filter(t => t.type === 'income');

    let totalGastosUSD = 0, totalGastosARS = 0;
    let gastosUSD = [], gastosARS = [];
    gastos.forEach(gasto => {
        const monto = Math.abs(parseFloat(gasto.amount)) || 0;
        if (gasto.currency === 'USD') {
            totalGastosUSD += monto;
            gastosUSD.push(gasto);
        } else if (gasto.currency === 'ARS') {
            totalGastosARS += monto;
            gastosARS.push(gasto);
        }
    });

    let totalIngresosUSD = 0, totalIngresosARS = 0;
    let ingresosUSD = [], ingresosARS = [];
    ingresos.forEach(ingreso => {
        const monto = parseFloat(ingreso.amount) || 0;
        if (ingreso.currency === 'USD') {
            totalIngresosUSD += monto;
            ingresosUSD.push(ingreso);
        } else if (ingreso.currency === 'ARS') {
            totalIngresosARS += monto;
            ingresosARS.push(ingreso);
        }
    });

    const balanceNetoUSD = totalIngresosUSD - totalGastosUSD;
    const balanceNetoARS = totalIngresosARS - totalGastosARS;

    let resumen = "=== RESUMEN FINANCIERO ===
";
    resumen += `Total gastado en USD: ${totalGastosUSD.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
`;
    resumen += `Total ingresos en USD: ${totalIngresosUSD.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
`;
    resumen += `Balance neto en USD: ${balanceNetoUSD.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}

`;
    resumen += `Total gastado en ARS: ${totalGastosARS.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
`;
    resumen += `Total ingresos en ARS: ${totalIngresosARS.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
`;
    resumen += `Balance neto en ARS: ${balanceNetoARS.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}

`;

    resumen += "=== ESTADÍSTICAS ADICIONALES ===
";
    resumen += `Número total de transacciones: ${transacciones.length}
`;
    resumen += `Transacciones de gasto: ${gastos.length}
`;
    resumen += `Transacciones de ingreso: ${ingresos.length}

`;

    const getTopCategorias = (listaGastos) => {
        const categorias = {};
        listaGastos.forEach(gasto => {
            const categoria = gasto.category || "Sin Categoría";
            const monto = Math.abs(parseFloat(gasto.amount)) || 0;
            categorias[categoria] = (categorias[categoria] || 0) + monto;
        });
        return Object.entries(categorias).sort((a, b) => b[1] - a[1]).slice(0, 5);
    };

    const topCategoriasUSD = getTopCategorias(gastosUSD);
    if (topCategoriasUSD.length > 0) {
        resumen += "=== TOP 5 CATEGORÍAS DE GASTO EN USD ===
";
        topCategoriasUSD.forEach(([categoria, monto]) => {
            resumen += `${categoria}: ${monto.toFixed(2)}
`;
        });
    }

    const topCategoriasARS = getTopCategorias(gastosARS);
    if (topCategoriasARS.length > 0) {
        resumen += "
=== TOP 5 CATEGORÍAS DE GASTO EN ARS ===
";
        topCategoriasARS.forEach(([categoria, monto]) => {
            resumen += `${categoria}: ${monto.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
`;
        });
    }
    
    return resumen;
}


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

    const dateTo = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}Z`;
    const dateFrom = `2020-01-01T00:00:00Z`; 

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
    // Aseguramos que 'type' y 'amount' existan y sean correctos
    return (data.transactions || []).map(tx => ({
        ...tx,
        type: tx.amount < 0 ? 'expense' : 'income',
        amount: parseFloat(tx.amount) || 0
    }));
}

/**
 * Envía el resumen de datos a DeepSeek AI para que genere un informe narrativo.
 * @param {string} dataSummary - El resumen de datos generado por `analizarTransacciones`.
 * @param {string} deepseekApiKey - La API Key de DeepSeek.
 * @returns {string} - El informe narrativo generado por la IA.
 * @throws {Error} Si la llamada a la API de DeepSeek falla.
 */
async function analyzeDataWithAI(dataSummary, deepseekApiKey) {
    if (!dataSummary || dataSummary.startsWith("No se encontraron")) {
        return dataSummary;
    }

    console.log("Enviando resumen de datos a DeepSeek para análisis narrativo...");

    const response = await fetch("https://api.deepseek.com/chat/completions", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${deepseekApiKey}` },
        body: JSON.stringify({
            model: "deepseek-chat",
            messages: [
                { "role": "system", "content": SYSTEM_PROMPT_RESUMEN },
                { "role": "user", "content": dataSummary }
            ],
            temperature: 0.7,
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
    const thinkingMessage = await bot.sendMessage(chatId, "🔍 Recopilando datos... Un momento.");

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
        
        await bot.editMessageText("⚙️ Procesando y calculando totales...", { chat_id: chatId, message_id: thinkingMessage.message_id });

        const dataSummary = analizarTransacciones(allTransactions);
        
        await bot.editMessageText("🧠 Generando análisis y consejos con IA...", { chat_id: chatId, message_id: thinkingMessage.message_id });

        const aiSummary = await analyzeDataWithAI(dataSummary, config.DEEPSEEK_API_KEY);

        await bot.editMessageText(aiSummary, {
            chat_id: chatId,
            message_id: thinkingMessage.message_id,
            parse_mode: 'Markdown'
        });

    } catch (error) {
        console.error("Error procesando el comando /resumen:", error.message);
        await bot.editMessageText(
            "🔥 ¡Ups! Hubo un error al generar el resumen. Revisa los logs del servidor.",
            { chat_id: chatId, message_id: thinkingMessage.message_id }
        );
        throw error;
    }
}

module.exports = { handleResumenCommand };
