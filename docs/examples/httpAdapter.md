# HttpAdapter e logger

Implemente `HttpAdapter` para mocks, tracing ou outra stack HTTP. O logger pode ser alternado em runtime:

```ts
const httpLogger = {
  enabled: true,
  logger: (event) => telemetry.track(event.type, event),
};

const authyon = createClient({ envKey: "pk_live_...", httpAdapter, httpLogger });
httpLogger.enabled = false;
```

Eventos não carregam headers, bodies nem valores de query. Exceções do logger são isoladas e não interrompem requests.
