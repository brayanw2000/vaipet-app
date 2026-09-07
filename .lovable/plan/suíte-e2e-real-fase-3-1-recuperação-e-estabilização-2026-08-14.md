# Suíte E2E Real - Fase 3.1 - Recuperação e Estabilização

Este plano visa recuperar a suíte de testes E2E real que foi acidentalmente truncada, restaurando cenários operacionais completos e garantindo independência entre blocos.

## Ações imediatas

- **Recuperação de Testes**: Restaurar os testes operacionais (setup, matching, tracking, negative, completion, full) baseando-se no commit `3650e7b`, mas adaptando-os para o novo padrão de isolamento (provisionamento individual por teste).
- **Independência Operacional**: Cada bloco (`setup`, `matching`, etc.) deve provisionar seus próprios usuários e recursos, garantindo que possam ser executados de forma isolada via scripts `npm run test:e2e:walk:*`.
- **Harden de Cleanup**: Corrigir `quickCleanup` e `preflightCleanup` para serem resilientes, verificando erros em todas as etapas e seguindo a ordem de exclusão hierárquica (tracking -> offers -> sessions -> pets -> profiles).
- **Documentação e Certificação**: Atualizar `docs/PHASE3_STABILIZATION.md` e executar a bateria completa de testes exigida (5x tracking, 2x suite completa, zero falhas).

## Detalhes técnicos

- **tests/walk-real-e2e.spec.ts**: Expansão do arquivo para incluir os 8+ cenários reais, com helpers de provisionamento robustos.
- **Isolamento**: Uso de `e2e_run_id` e domínio `@e2e.vaipet.invalid` em todos os recursos.
- **Assertions Reais**: Fim dos placeholders; todos os fluxos devem validar estados no banco e na UI.
- **Validação de Produção**: Preservação das migrations de segurança e ausência de `bun.lock`.
- **Relatório**: Ao final, contagem exata de linhas, testes e resultados.

## Próximos passos

1.  **Escrita do código**: Atualizar `tests/walk-real-e2e.spec.ts` com a lógica completa.
2.  **Execução de blocos**: Rodar cada teste isoladamente.
3.  **Stress Test**: Executar repetições para garantir estabilidade.
4.  **Relatório Final**: Atualizar documentação e encerrar a fase.
