import assert from 'node:assert/strict';
import {
  VERSION_DETALLE_CAMBIOS_AUDITORIA,
  proyectarDetalleCambiosAuditoria
} from '../paquetes/auditoria/src/ProyectorDetalleCambiosAuditoria.js';

function main() {
  verificarCambioCompleto();
  verificarMinimizacionYAlcance();
  verificarEstadosYFotografias();
  console.log('[auditoria] OK detalle-cambios: dominio=v1 alcance=estricto minimizacion=segura');
}

function verificarCambioCompleto() {
  const detalle = proyectarDetalleCambiosAuditoria({
    evento: evento({
      resultado: 'actualizado',
      camposCambiados: ['activo', 'nombre'],
      antes: { activo: true, nombre: 'Anterior' },
      despues: { activo: false, nombre: 'Nuevo' }
    }),
    alcanceCompleto: true
  });
  assert.deepEqual(detalle, {
    version: VERSION_DETALLE_CAMBIOS_AUDITORIA,
    clase: 'cambio',
    cambios: [
      { campo: 'activo', antes: true, despues: false },
      { campo: 'nombre', antes: 'Anterior', despues: 'Nuevo' }
    ]
  });
  assert.equal(Object.isFrozen(detalle), true);
  assert.equal(Object.isFrozen(detalle.cambios), true);
}

function verificarMinimizacionYAlcance() {
  const sensible = evento({
    resultado: 'actualizado',
    camposCambiados: ['email'],
    antes: {},
    despues: {}
  });
  assert.equal(proyectarDetalleCambiosAuditoria({
    evento: sensible,
    alcanceCompleto: true
  }), null);
  assert.equal(proyectarDetalleCambiosAuditoria({
    evento: evento({
      resultado: 'actualizado',
      camposCambiados: ['nombre'],
      antes: { nombre: 'Anterior' },
      despues: { nombre: 'Nuevo' }
    }),
    alcanceCompleto: false
  }), null);
}

function verificarEstadosYFotografias() {
  assert.deepEqual(
    proyectarDetalleCambiosAuditoria({
      evento: evento({ estadoAntes: 'activo', estadoDespues: 'inactivo', motivo: 'operador' }),
      alcanceCompleto: true
    })?.cambios,
    [{ campo: 'estado', antes: 'activo', despues: 'inactivo' }]
  );
  assert.deepEqual(
    proyectarDetalleCambiosAuditoria({
      evento: evento({ resultado: 'creado', antes: null, despues: { activo: true, nombre: 'Nuevo' } }),
      alcanceCompleto: true
    }),
    {
      version: 1,
      clase: 'alta',
      cambios: [
        { campo: 'activo', antes: null, despues: true },
        { campo: 'nombre', antes: null, despues: 'Nuevo' }
      ]
    }
  );
  assert.deepEqual(
    proyectarDetalleCambiosAuditoria({
      evento: evento({ resultado: 'eliminado', antes: { nombre: 'Anterior' }, despues: null }),
      alcanceCompleto: true
    })?.cambios,
    [{ campo: 'nombre', antes: 'Anterior', despues: null }]
  );
}

function evento(payload) {
  return { versionContrato: 1, payload };
}

main();
