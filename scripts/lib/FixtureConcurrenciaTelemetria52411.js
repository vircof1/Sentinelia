export function crearLoteConcurrenciaTelemetria52411() {
  return {
    emitidoEnUtc: '2026-08-26T09:59:59Z',
    observaciones: [
      {
        categoria: 'cierre_52411',
        clave: 'duracion',
        tipoDato: 'duracion',
        unidad: 's',
        observadoEnUtc: '2026-08-26T09:59:58Z',
        valorDuracion: 1.2345
      },
      {
        categoria: 'cierre_52411',
        clave: 'momento',
        tipoDato: 'momento_utc',
        observadoEnUtc: '2026-08-26T09:59:58Z',
        valorMomentoUtc: '9999-12-31T23:59:59Z'
      },
      {
        categoria: 'cierre_52411',
        clave: 'conflicto',
        tipoDato: 'texto',
        observadoEnUtc: '2026-08-26T09:59:58Z',
        valorTexto: 'debe rechazarse sin abortar las dos observaciones válidas'
      }
    ]
  };
}
