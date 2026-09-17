# Pesquisa Fase 0 - App Webcam Android via Wi-Fi

Este documento compila a pesquisa de validação solicitada para garantir que as premissas técnicas e dependências propostas para o projeto (estilo DroidCam/Iriun) estão atualizadas com as melhores práticas de 2026.

## 1. Biblioteca WebRTC Android
- **Status de `io.getstream:stream-webrtc-android`:** A biblioteca permanece ativamente mantida e é a escolha correta, substituindo a descontinuada `org.webrtc:google-webrtc`.
- **Versão Atual:** A versão estável mais recente disponível no Maven Central é a **1.3.10** (verificada em set/2026).
- **Como usar:** Adicionada via `implementation("io.getstream:stream-webrtc-android:1.3.10")` no `build.gradle.kts`. Ela será combinada com a CameraX para a captura nativa.

## 2. Suporte Nativo a WebSocket da Vercel
- **Status Beta:** A Vercel lançou o suporte nativo a WebSocket em beta pública rodando sobre Fluid Compute.
- **Implementação:** A API correta a ser utilizada no Next.js (dentro do App Router) é de fato a `experimental_upgradeWebSocket()` fornecida pelo pacote `@vercel/functions`.
- **Limitações a considerar:**
  - **Duração Máxima:** O WebSocket fica "preso" à duração da function. No plano padrão/Hobby, isso pode limitar-se a alguns minutos, sendo necessário implementar reconexão.
  - **Isolamento de Instância:** Não há state compartilhado out-of-the-box (pub/sub entre diferentes instâncias). Como precisamos apenas de sinalização (Offer/Answer/ICE) que dura poucos segundos, isso atende bem o nosso cenário inicial, mas manteremos o Firebase Realtime Database como um "Plano B" validado caso a estabilidade do beta em sessões reais se mostre intermitente.

## 3. CameraX e Foreground Services
- **Foreground Service Android 14+:** É estritamente obrigatório declarar o serviço com `android:foregroundServiceType="camera"`, além de solicitar as permissões corretas (`FOREGROUND_SERVICE_CAMERA`) no `AndroidManifest.xml`.
- O app nativo deverá fornecer uma notificação persistente detalhada durante a operação da câmera em background, caso contrário o Android encerra o stream.

## 4. `getUserMedia` Chrome for Android (1080p)
- **HTTPS:** A exigência de Secure Context está plenamente em vigor. Como o Vercel provê HTTPS nativo, não teremos problemas para testes via web.
- **Resoluções:** Chrome for Android suporta as constraints de `1080p` desde que o hardware tenha suporte, sendo vital passar fallback options nas constraints para garantir o acesso quando 1080p não for suportado.

## 5. Ponte OBS (Browser Source -> Virtual Camera)
- Esta continua sendo a ponte de integração de menor atrito.
- **Passo a passo atual:** O usuário abre o OBS -> Adiciona uma Fonte de Navegador (Browser Source) -> Insere a URL `/receber?clean=1` -> Inicia "Virtual Camera" no OBS -> Seleciona no Meet/Teams. Funciona perfeitamente em Windows/Mac.

## 6. Extensão de Câmera Virtual no macOS (Apple Developer Program)
- **Status:** CoreMediaIO é de fato o único caminho "oficial" moderno no macOS (substituindo DAL).
- **Requisitos:** Exige uma assinatura ativa do Apple Developer Program (~US$99/ano) para assinar a System Extension com o entitlement correto e distribuí-la. Sem esta conta, é inviável desenvolver e testar localmente de forma escalável sem desativar o SIP (System Integrity Protection).

## Próximos Passos
O próximo passo é definir as questões abertas antes de procedermos para a implementação do plano.
