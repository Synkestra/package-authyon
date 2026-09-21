# Publicação da versão beta

O repositório publica os pacotes em lockstep pelo GitHub Actions, usando npm Trusted Publishing e provenance. A preparação local não publica nem cria tags automaticamente.

## Versão preparada

```text
@authyon/auth   0.2.0-beta.9
@authyon/server 0.2.0-beta.9
```

## Validação local

```bash
npm ci
npm run release:check
```

Esse gate executa tipos, lint, formatação, testes, documentação, inspeção dos tarballs e auditoria das dependências de produção.

## Publicação

1. Faça commit de todos os arquivos da release.
2. Crie a tag anotada `v0.2.0-beta.9` no commit validado.
3. Envie o commit e a tag ao GitHub.
4. Crie uma GitHub Release apontando exatamente para essa tag.
5. Confira os dois publishes e o provenance no workflow.
6. Verifique no npm que a versão está sob o dist tag `beta`, nunca `latest`.

O workflow deriva a versão da tag, valida SemVer e usa o identificador do prerelease como dist tag. Assim, `v0.2.0-beta.4` publica com `--tag beta`; uma versão sem prerelease publica com `--tag latest`.

## Smoke test após publicação

Em um diretório vazio:

```bash
npm init -y
npm install @authyon/auth@beta @authyon/server@beta
node -e "import('@authyon/auth').then(m => console.log(typeof m.createClient))"
node -e "import('@authyon/server').then(m => console.log(typeof m.createServerClient))"
npm view @authyon/auth dist-tags
npm view @authyon/server dist-tags
```

Teste também uma aplicação React importando `@authyon/auth/react`, pois esse entrypoint depende do peer React do consumidor.

## Próxima beta e versão estável

- Próxima correção ou feedback: `0.2.0-beta.10`.
- Candidato final opcional: `0.2.0-rc.0`, publicado sob `rc`.
- Versão estável: `0.2.0`, após repetir o gate completo; ela usará `latest`.

Não reutilize uma versão publicada. Pacotes npm são imutáveis; em caso de problema, publique o próximo prerelease e, se necessário, remova o dist tag afetado.
