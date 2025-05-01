// Función principal de PoW
function resolverPoWAsync(dificultad, semilla, tiempoMaximo = 60000) {
    return new Promise((resolve, reject) => {
		
		let segundos = tiempoMaximo / 1000;
        let nonce = 0;
        let inicio = Date.now();
        let alertaEmitida = false;
        //let semilla = "3"

        function procesar() {
            const ahora = Date.now();

            if (!alertaEmitida && (ahora - inicio > tiempoMaximo)) {
                alertaEmitida = true;
                const seguir = confirm(`⚠️Llevas: ${segundos} segundos, procesando la peticion criptografica. ¿Quieres seguir?`);
                if (!seguir) {
                    reject("Usuario canceló");
                    return;
                }
                //inicio = Date.now();
            }

            let encontrado = false;

            // 💬 Marca de vida visual cada tanda
            //console.log(`🔄 Procesando nonce ~${nonce}... Tiempo: ${Date.now() - inicio}ms`);

            for (let i = 0; i < 5000; i++) {
                const texto = semilla + nonce;
                const hash = CryptoJS.SHA256(texto).toString(CryptoJS.enc.Hex);

                const prefijo = hash.slice(0, dificultad);
                const esValido = /^[0-9]+$/.test(prefijo);

                if (esValido) {
                    const tiempo = Date.now() - inicio;
                    console.log(`✅ Solución encontrada en nonce ${nonce} en ${tiempo}ms`);
                    resolve({ nonce, hash, tiempo });
                    encontrado = true;
                    break;
                }

                nonce++;
            }

            if (!encontrado) {
                setTimeout(procesar, 0);
            }
        }

        procesar();
    });
}

