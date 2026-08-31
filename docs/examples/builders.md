# Builders

Builders são oferecidos onde existe configuração progressiva. Para configurações curtas, `createClient()` continua sendo a opção mais direta.

## Frontend

```ts
const authyon = new AuthyonClientBuilder("pk_live_...")
  .withStorage(createLocalStorage())
  .withAutomaticRefresh(true)
  .withTimeout(10_000)
  .withHttpLogger(httpLogger)
  .build();
```

## Backend

```ts
const authyon = new AuthyonServerClientBuilder()
  .withEnvironmentKey(process.env.AUTHYON_ENV_KEY)
  .withEnvironmentCredentials(
    process.env.AUTHYON_CLIENT_ID,
    process.env.AUTHYON_CLIENT_SECRET,
  )
  .withTimeout(10_000)
  .withHttpLogger(httpLogger)
  .build();
```

## Regras

`AuthyonAbilityBuilder` permanece dedicado a regras condicionais:

```ts
const ability = new AuthyonAbilityBuilder()
  .can("read", "articles")
  .can("update", "articles", { authorId: user.id })
  .cannot("delete", "articles", { published: true })
  .build();
```

Não há builder para login, logout, validação ou operações CRUD porque são chamadas simples e um builder tornaria o fluxo menos claro.
