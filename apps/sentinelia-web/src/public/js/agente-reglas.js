(function iniciarAdministracionReglasTelemetria() {
  const seccionCrear = document.querySelector('#crear-interpretacion');
  const desplegableCrear = seccionCrear?.querySelector('details');
  const abrirCrearDesdeEnlace = () => {
    if (window.location.hash === '#crear-interpretacion' && desplegableCrear) {
      desplegableCrear.open = true;
    }
  };
  abrirCrearDesdeEnlace();
  window.addEventListener('hashchange', abrirCrearDesdeEnlace);
  for (const enlace of document.querySelectorAll('[data-abrir-crear-regla]')) {
    enlace.addEventListener('click', () => {
      if (desplegableCrear) desplegableCrear.open = true;
    });
  }

  const formularios = document.querySelectorAll('[data-regla-telemetria-form]');

  for (const formulario of formularios) {
    const selectorSenal = formulario.querySelector('[data-regla-senal]');
    const selectorTipo = formulario.querySelector('[data-regla-tipo]');
    const selectorOperador = formulario.querySelector('[data-regla-operador]');
    const campoOperador = formulario.querySelector('[data-campo-operador]');
    const entradaUmbral = formulario.querySelector('[data-regla-umbral]');
    const ayudaDuracion = formulario.querySelector('[data-regla-duracion-ayuda]');
    const campoMomento = formulario.querySelector('[data-campo-momento]');
    const entradaMomentoLocal = formulario.querySelector('[data-regla-momento-local]');
    const entradaMomentoUtc = formulario.querySelector('[data-regla-momento-utc]');
    const ayudaMomento = formulario.querySelector('[data-regla-momento-ayuda]');
    const campoMomentoRelativo = formulario.querySelector(
      '[data-campo-momento-relativo]'
    );
    const selectorFormaRelativa = formulario.querySelector('[data-relativo-forma]');
    const campoLimiteRelativo = formulario.querySelector('[data-relativo-limite]');
    const camposIntervaloRelativo = formulario.querySelectorAll(
      '[data-relativo-intervalo]'
    );
    const camposHisteresisSimple = formulario.querySelectorAll(
      '[data-relativo-histeresis-simple]'
    );
    const camposHisteresisIntervalo = formulario.querySelectorAll(
      '[data-relativo-histeresis-intervalo]'
    );
    const controlesRelativos = formulario.querySelectorAll(
      '[name^="relativo_"]'
    );
    const direccionesRelativas = formulario.querySelectorAll(
      '[data-relativo-direccion]'
    );
    const magnitudesRelativas = formulario.querySelectorAll(
      '[data-relativo-magnitud]'
    );
    const salidaResumenRelativo = formulario.querySelector('[data-relativo-resumen]');
    const campoRegex = formulario.querySelector('[data-campo-regex]');
    const selectorModoRegex = formulario.querySelector('[data-regla-regex-modo]');
    const entradaPatronRegex = formulario.querySelector('[data-regla-regex-patron]');
    const opcionesRegex = formulario.querySelectorAll('[data-regla-regex-opcion]');
    const ayudaRegex = formulario.querySelector('[data-regla-regex-ayuda]');
    const campoConteoRegex = formulario.querySelector('[data-campo-regex-conteo]');
    const entradaUmbralRegex = formulario.querySelector('[data-regla-regex-umbral]');
    const entradaMuestraRegex = formulario.querySelector('[data-regla-regex-muestra]');
    const ayudaMuestraRegex = formulario.querySelector(
      '[data-regla-regex-muestra-ayuda]'
    );
    const botonPrevisualizar = formulario.querySelector('[data-regla-previsualizar]');
    const salida = formulario.querySelector('[data-regla-preview]');

    const obtenerSenal = () => {
      const opcion = selectorSenal?.selectedOptions?.[0];
      return {
        id: opcion?.value || formulario.dataset.senalId || '',
        tipo: opcion?.dataset.tipo || formulario.dataset.senalTipo || '',
        unidad: opcion?.dataset.unidad || formulario.dataset.senalUnidad || '',
        admiteValor: (opcion?.dataset.admiteValor || formulario.dataset.senalAdmiteValor) !== 'false'
      };
    };

    const sincronizar = ({ conservarTipo = false } = {}) => {
      const senal = obtenerSenal();
      const tiposPermitidos = senal.admiteValor
        ? new Set([
            senal.tipo,
            ...(senal.tipo === 'momento_utc' &&
              selectorTipo.querySelector('option[value="momento_utc_relativo"]')
              ? ['momento_utc_relativo']
              : []),
            ...(senal.tipo === 'texto' ? ['texto_regex'] : []),
            'calidad'
          ])
        : new Set(['calidad']);
      for (const opcion of selectorTipo.options) {
        opcion.disabled = !tiposPermitidos.has(opcion.value);
      }
      if (!conservarTipo || !tiposPermitidos.has(selectorTipo.value)) {
        selectorTipo.value = senal.tipo === 'momento_utc' &&
          tiposPermitidos.has('momento_utc_relativo')
          ? 'momento_utc_relativo'
          : (tiposPermitidos.has(senal.tipo) ? senal.tipo : 'calidad');
      }

      const tipo = selectorTipo.value;
      const duracion = tipo === 'duracion';
      const momentoUtc = tipo === 'momento_utc';
      const momentoUtcRelativo = tipo === 'momento_utc_relativo';
      const ordenableNumerico = tipo === 'numero' || duracion;
      const ordenable = ordenableNumerico || momentoUtc;
      const calidad = tipo === 'calidad';
      const regex = tipo === 'texto_regex';
      const regexConteo = regex && selectorModoRegex.value === 'conteo';
      formulario.querySelector('[data-campo-numero]').hidden = !ordenableNumerico;
      campoMomento.hidden = !momentoUtc;
      if (campoMomentoRelativo) campoMomentoRelativo.hidden = !momentoUtcRelativo;
      formulario.querySelector('[data-campo-valor]').hidden =
        ordenable || momentoUtcRelativo || calidad || regex;
      formulario.querySelector('[data-campo-calidad]').hidden = !calidad;
      campoRegex.hidden = !regex;
      campoOperador.hidden = regex && !regexConteo;
      selectorOperador.disabled = regex && !regexConteo;
      selectorOperador.required = !regex || regexConteo;
      selectorModoRegex.disabled = !regex;
      entradaPatronRegex.disabled = !regex;
      for (const opcion of opcionesRegex) opcion.disabled = !regex;
      campoConteoRegex.hidden = !regexConteo;
      entradaUmbralRegex.disabled = !regexConteo;
      entradaUmbralRegex.required = regexConteo;
      entradaMuestraRegex.disabled = !regex;
      sincronizarControlesRelativos(momentoUtcRelativo);
      formulario.querySelector('[data-regla-unidad]').textContent = duracion
        ? '(segundos)'
        : senal.unidad
          ? `(${senal.unidad}, solo lectura)`
          : '(sin unidad)';

      entradaUmbral.step = duracion ? '0.0001' : 'any';
      if (duracion) {
        entradaUmbral.min = '0';
      } else {
        entradaUmbral.removeAttribute('min');
      }
      actualizarAyudaDuracion();
      if (momentoUtc && !entradaMomentoLocal.value && entradaMomentoUtc.value) {
        entradaMomentoLocal.value = formatearMomentoUtcComoLocal(
          entradaMomentoUtc.value
        );
      }
      actualizarUmbralMomento();
      actualizarAyudaRegex();
      actualizarAyudaMuestraRegex();
      actualizarResumenRelativo();

      if (!regex || regexConteo) {
        for (const opcion of selectorOperador.options) {
          opcion.disabled = !(ordenable || regexConteo) &&
            !['=', '!='].includes(opcion.value);
        }
        if (
          !(ordenable || regexConteo) &&
          !['=', '!='].includes(selectorOperador.value)
        ) {
          selectorOperador.value = '=';
        }
      }
    };

    const sincronizarControlesRelativos = (activo) => {
      if (!campoMomentoRelativo) return;
      const intervalo = activo && selectorFormaRelativa.value === 'fuera_intervalo';
      campoLimiteRelativo.hidden = !activo || intervalo;
      for (const campo of camposIntervaloRelativo) campo.hidden = !intervalo;
      for (const campo of camposHisteresisSimple) campo.hidden = !activo || intervalo;
      for (const campo of camposHisteresisIntervalo) campo.hidden = !intervalo;
      for (const control of controlesRelativos) {
        const contenedorOculto = control.closest('[hidden]');
        control.disabled = !activo || Boolean(contenedorOculto);
      }
      for (const direccion of direccionesRelativas) {
        if (direccion.disabled) continue;
        const magnitud = direccion.parentElement?.parentElement
          ?.querySelector('[data-relativo-magnitud]');
        if (!magnitud) continue;
        const esAhora = direccion.value === 'ahora';
        magnitud.disabled = esAhora;
        magnitud.required = !esAhora;
        if (esAhora) magnitud.value = '0';
      }
    };

    const actualizarResumenRelativo = () => {
      if (!campoMomentoRelativo || selectorTipo.value !== 'momento_utc_relativo') {
        return true;
      }
      sincronizarControlesRelativos(true);
      let valida = true;
      for (const magnitud of magnitudesRelativas) {
        if (magnitud.disabled) continue;
        const correcta = /^(?:0|[1-9]\d*)$/u.test(magnitud.value);
        magnitud.setCustomValidity(correcta
          ? ''
          : 'Introduce una magnitud entera no negativa.');
        valida = valida && correcta;
      }
      const forma = selectorFormaRelativa.value;
      const frases = {
        limite_inferior: 'Requiere atención cuando la fecha queda por debajo del límite.',
        limite_superior: 'Requiere atención cuando la fecha supera el límite.',
        fuera_intervalo: 'Requiere atención cuando la fecha queda fuera de ambos límites.'
      };
      salidaResumenRelativo.textContent = `${frases[forma]} ` +
        'La comparación se recalcula frente al presente UTC y conserva el margen de histéresis configurado.';
      salidaResumenRelativo.classList.toggle('alert-danger', !valida);
      salidaResumenRelativo.classList.toggle('alert-info', valida);
      return valida;
    };

    const actualizarAyudaDuracion = () => {
      const esDuracion = selectorTipo.value === 'duracion';
      ayudaDuracion.hidden = !esDuracion;
      if (!esDuracion) return;
      const segundos = Number(entradaUmbral.value);
      ayudaDuracion.textContent = Number.isFinite(segundos) && segundos >= 0
        ? `Lectura humana: ${formatearDuracionHumana(segundos)}. Se guardará el valor exacto en segundos.`
        : 'Introduce una duración no negativa, con un máximo de cuatro decimales.';
    };

    const actualizarUmbralMomento = () => {
      const esMomento = selectorTipo.value === 'momento_utc';
      entradaMomentoLocal.required = esMomento;
      entradaMomentoUtc.disabled = !esMomento;
      entradaMomentoLocal.setCustomValidity('');
      if (!esMomento) return;

      const umbralUtc = convertirMomentoLocalAUtc(entradaMomentoLocal.value);
      entradaMomentoUtc.value = umbralUtc || '';
      if (!umbralUtc) {
        entradaMomentoLocal.setCustomValidity(
          'Elige una fecha y hora local reales, con precisión de segundo.'
        );
        ayudaMomento.textContent =
          'La fecha local debe ser real y producir un UTC entre los años 1000 y 9999.';
        return;
      }
      ayudaMomento.textContent = `Se guardará exactamente: ${umbralUtc}`;
    };

    const actualizarAyudaRegex = () => {
      const esRegex = selectorTipo.value === 'texto_regex';
      entradaPatronRegex.setCustomValidity('');
      entradaUmbralRegex.setCustomValidity('');
      if (!esRegex) return true;
      const longitud = [...entradaPatronRegex.value].length;
      if (longitud > 256) {
        entradaPatronRegex.setCustomValidity(
          'El patrón no puede superar 256 caracteres Unicode.'
        );
      }
      const esConteo = selectorModoRegex.value === 'conteo';
      const umbral = Number(entradaUmbralRegex.value);
      if (
        esConteo &&
        (
          entradaUmbralRegex.value === '' ||
          !Number.isSafeInteger(umbral) ||
          umbral < 0
        )
      ) {
        entradaUmbralRegex.setCustomValidity(
          'El umbral debe ser un entero seguro no negativo.'
        );
      }
      ayudaRegex.textContent =
        `${longitud}/256 caracteres Unicode · RE2 seguro · ` +
        `${esConteo ? 'conteo no solapado' : 'modo existencia'}. ` +
        'Sentinelia validará el patrón con el mismo motor usado por el runtime.';
      return entradaPatronRegex.checkValidity() &&
        entradaUmbralRegex.checkValidity();
    };

    const actualizarAyudaMuestraRegex = () => {
      if (selectorTipo.value !== 'texto_regex') return true;
      const longitud = [...entradaMuestraRegex.value].length;
      const valida = longitud <= 2048;
      ayudaMuestraRegex.textContent = valida
        ? `${longitud}/2048 caracteres Unicode. La muestra no se guardará en la revisión ni se devolverá completa.`
        : `${longitud}/2048 caracteres Unicode. Reduce la muestra antes de comprobarla.`;
      ayudaMuestraRegex.classList.toggle('text-danger', !valida);
      return valida;
    };

    selectorSenal?.addEventListener('change', () => sincronizar());
    selectorTipo.addEventListener('change', () => sincronizar({ conservarTipo: true }));
    selectorModoRegex.addEventListener(
      'change',
      () => sincronizar({ conservarTipo: true })
    );
    selectorFormaRelativa?.addEventListener(
      'change',
      () => sincronizar({ conservarTipo: true })
    );
    for (const direccion of direccionesRelativas) {
      direccion.addEventListener('change', () => {
        sincronizarControlesRelativos(true);
        actualizarResumenRelativo();
      });
    }
    for (const magnitud of magnitudesRelativas) {
      magnitud.addEventListener('input', actualizarResumenRelativo);
    }
    entradaUmbral.addEventListener('input', actualizarAyudaDuracion);
    entradaMomentoLocal.addEventListener('input', actualizarUmbralMomento);
    entradaPatronRegex.addEventListener('input', actualizarAyudaRegex);
    entradaUmbralRegex.addEventListener('input', actualizarAyudaRegex);
    entradaMuestraRegex.addEventListener('input', actualizarAyudaMuestraRegex);
    formulario.addEventListener('submit', (evento) => {
      actualizarUmbralMomento();
      actualizarAyudaRegex();
      const relativoValido = actualizarResumenRelativo();
      if (!relativoValido) {
        evento.preventDefault();
        formulario.querySelector('[data-relativo-magnitud]:invalid')?.reportValidity();
        return;
      }
      if (
        selectorTipo.value === 'momento_utc' &&
        !entradaMomentoLocal.checkValidity()
      ) {
        evento.preventDefault();
        entradaMomentoLocal.reportValidity();
        return;
      }
      if (
        selectorTipo.value === 'texto_regex' &&
        !actualizarAyudaRegex()
      ) {
        evento.preventDefault();
        const invalida = entradaPatronRegex.checkValidity()
          ? entradaUmbralRegex
          : entradaPatronRegex;
        invalida.reportValidity();
      }
    });
    sincronizar({ conservarTipo: true });

    botonPrevisualizar?.addEventListener('click', async () => {
      actualizarUmbralMomento();
      actualizarAyudaRegex();
      if (!actualizarResumenRelativo()) {
        formulario.querySelector('[data-relativo-magnitud]:invalid')?.reportValidity();
        return;
      }
      if (
        selectorTipo.value === 'momento_utc' &&
        !entradaMomentoLocal.checkValidity()
      ) {
        entradaMomentoLocal.reportValidity();
        return;
      }
      if (
        selectorTipo.value === 'texto_regex' &&
        !actualizarAyudaRegex()
      ) {
        const invalida = entradaPatronRegex.checkValidity()
          ? entradaUmbralRegex
          : entradaPatronRegex;
        invalida.reportValidity();
        return;
      }
      if (
        selectorTipo.value === 'texto_regex' &&
        !actualizarAyudaMuestraRegex()
      ) {
        return;
      }
      const datos = new URLSearchParams(new FormData(formulario));
      datos.set('senal_id', obtenerSenal().id);
      salida.className = 'alert alert-light border mb-0';
      salida.textContent = 'Comprobando cómo se interpretará la condición…';
      try {
        const respuesta = await fetch(formulario.dataset.previewUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body: datos.toString()
        });
        const resultado = await respuesta.json();
        if (!respuesta.ok || !resultado.ok) {
          throw new Error(resultado.mensaje || 'No se pudo comprobar la condición.');
        }
        salida.className = 'alert alert-success mb-0';
        const muestra = resultado.resultadoMuestra;
        const resumenMuestra = muestra
          ? muestra.modo === 'conteo'
            ? ` Muestra: ${muestra.conteo} coincidencias; ${muestra.resultado}.`
            : ` Muestra: ${muestra.coincidenciaEncontrada ? 'hay coincidencia' : 'sin coincidencia'}; ${muestra.resultado}.`
          : '';
        const temporal = resultado.previsualizacionTemporalRelativa;
        const resumenTemporal = temporal
          ? temporal.disponible
            ? ` Ejemplo actual: M=${temporal.momentoUtc}, N=${temporal.ahoraUtc}, ` +
              `D=${temporal.desviacionSegundos} s; ${temporal.resultado}. ` +
              `${temporal.proximaFronteraUtc
                ? `Próxima frontera: ${temporal.proximaFronteraUtc}.`
                : 'No requiere otra frontera temporal.'}`
            : ' No existe todavía una fotografía vigente con la que calcular el ejemplo.'
          : '';
        salida.textContent = `Condición lista para usar: ` +
          `${resultado.condicionCanonica}.${resumenMuestra}${resumenTemporal}`;
      } catch (error) {
        salida.className = 'alert alert-danger mb-0';
        salida.textContent = error.message;
      }
    });
  }

  function formatearDuracionHumana(valor) {
    let restante = Number(valor);
    if (!Number.isFinite(restante) || restante < 0) return 'duración inválida';
    const partes = [];
    for (const [segundos, etiqueta] of [
      [31536000, 'a'],
      [86400, 'd'],
      [3600, 'h'],
      [60, 'min']
    ]) {
      const cantidad = Math.floor(restante / segundos);
      if (cantidad > 0) {
        partes.push(`${cantidad} ${etiqueta}`);
        restante -= cantidad * segundos;
      }
    }
    if (restante > 0 || partes.length === 0) {
      partes.push(`${new Intl.NumberFormat('es-ES', {
        maximumFractionDigits: 4
      }).format(restante)} s`);
    }
    return partes.join(' ');
  }

  function convertirMomentoLocalAUtc(valor) {
    const coincidencia = /^(\d{4,6})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/u
      .exec(String(valor || ''));
    if (!coincidencia) return null;
    const [, anioTexto, mesTexto, diaTexto, horaTexto, minutoTexto, segundoTexto = '00'] =
      coincidencia;
    const partes = [anioTexto, mesTexto, diaTexto, horaTexto, minutoTexto, segundoTexto]
      .map((parte) => Number.parseInt(parte, 10));
    const [anio, mes, dia, hora, minuto, segundo] = partes;
    if (anio < 1) return null;

    const fecha = new Date(0);
    fecha.setFullYear(anio, mes - 1, dia);
    fecha.setHours(hora, minuto, segundo, 0);
    if (
      fecha.getFullYear() !== anio ||
      fecha.getMonth() !== mes - 1 ||
      fecha.getDate() !== dia ||
      fecha.getHours() !== hora ||
      fecha.getMinutes() !== minuto ||
      fecha.getSeconds() !== segundo
    ) return null;
    const utc = fecha.toISOString().replace(/\.000Z$/u, 'Z');
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(utc) &&
      Number.parseInt(utc.slice(0, 4), 10) >= 1000
      ? utc
      : null;
  }

  function formatearMomentoUtcComoLocal(valor) {
    const fecha = new Date(valor);
    if (!Number.isFinite(fecha.getTime())) return '';
    const dos = (numero) => String(numero).padStart(2, '0');
    const anio = String(fecha.getFullYear()).padStart(4, '0');
    return `${anio}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())}` +
      `T${dos(fecha.getHours())}:${dos(fecha.getMinutes())}:${dos(fecha.getSeconds())}`;
  }
})();
