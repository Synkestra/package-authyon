# Abilities e permissões

Permissões Authyon usam `subject:action`. A ability aceita permissões, roles e scope OAuth:

```ts
const ability = createAuthyonAbility(identity, {
  rules: [{
    action: "update",
    subject: "documents",
    inverted: true,
    conditions: { locked: true },
  }],
});

ability.can("read", "reports");
ability.cannot("update", { __type: "documents", locked: true });
```

Use `AuthyonAbilityBuilder` para regras fluentes e `update()` quando identidade ou organização ativa mudar. O comportamento é deny-by-default e a última regra aplicável prevalece.
