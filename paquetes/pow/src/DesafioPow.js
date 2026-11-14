export class DesafioPow {
  constructor({
    id,
    ip,
    reto,
    sal,
    coste,
    regla,
    tiempoObjetivoMs,
    hashrateReferencia,
    emitidoEn,
    expiraEn,
    benchmarkClienteMs
  }) {
    this.id = id;
    this.ip = ip;
    this.reto = reto;
    this.sal = sal;
    this.coste = coste;
    this.regla = regla;
    this.tiempoObjetivoMs = tiempoObjetivoMs;
    this.hashrateReferencia = hashrateReferencia;
    this.emitidoEn = emitidoEn;
    this.expiraEn = expiraEn;
    this.benchmarkClienteMs = benchmarkClienteMs;
  }

  serializar() {
    return JSON.stringify({
      id: this.id,
      ip: this.ip,
      reto: this.reto,
      sal: this.sal,
      coste: this.coste,
      regla: this.regla,
      tiempoObjetivoMs: this.tiempoObjetivoMs,
      hashrateReferencia: this.hashrateReferencia,
      emitidoEn: this.emitidoEn,
      expiraEn: this.expiraEn,
      benchmarkClienteMs: this.benchmarkClienteMs
    });
  }

  static desdeJson(valor) {
    return new DesafioPow(JSON.parse(valor));
  }
}
