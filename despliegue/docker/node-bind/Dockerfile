FROM node:24-bookworm-slim

LABEL org.opencontainers.image.title="Sentinelia NodeJS + BIND"
LABEL org.opencontainers.image.description="Imagen productiva canonica para contrato DNS 5.21"
LABEL org.sentinelia.contrato-despliegue="5.21"
LABEL es.sentinelia.contrato-dns="5.21"

ENV NODE_ENV=production
ENV TZ=Europe/Madrid
ENV DNS_ACTIVO=false
ENV BIND_RAIZ_ARTEFACTOS=/var/lib/sentinelia/bind/artefactos
ENV BIND_PUBLICADOR_COORDINADO_ACTIVO=true
ENV BIND_SELECTOR_ACTIVO=/etc/bind/sentinelia-selector.conf
ENV BIND_LOCK_FILE=/var/lib/sentinelia/bind/publicacion.lock
ENV BIND_NAMED_CONF_ACTIVO=/etc/bind/sentinelia-root.conf
ENV BIND_NAMED_EXECUTABLE=/usr/sbin/named
ENV BIND_NAMED_ARGUMENTOS_JSON=[]
ENV BIND_RNDC_EXECUTABLE=/usr/sbin/rndc
ENV BIND_RNDC_ARGUMENTOS_JSON=["-s","127.0.0.1","-p","953","-k","/run/named/sentinelia-rndc.key"]
ENV BIND_CHECKCONF_EXECUTABLE=/usr/bin/named-checkconf
ENV BIND_CHECKZONE_EXECUTABLE=/usr/bin/named-checkzone

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      bind9 \
      bind9-utils \
      dnsutils \
      iputils-ping \
      procps \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN chmod +x /app/despliegue/docker/node-bind/docker-entrypoint.sh

EXPOSE 3000 53/tcp 53/udp

STOPSIGNAL SIGTERM

ENTRYPOINT ["/app/despliegue/docker/node-bind/docker-entrypoint.sh"]
CMD ["node", "despliegue/docker/node-bind/supervisor-sentinelia.mjs"]
