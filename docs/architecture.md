# Arquitetura - Pelidev (Webcam Wi-Fi)

## Visão Geral
O sistema transforma um dispositivo Android em uma webcam (Browser Source) para uso em um computador na mesma rede local via WebRTC.

```
┌─────────────────────┐        Sinalização (WebSocket/Vercel)        ┌──────────────────────┐
│  CELULAR ANDROID    │◄────────────────────────────────────────────►│  MACBOOK (receptor)  │
│  (transmissor)      │                                              │                      │
│                     │                                              │                      │
│  A: PWA/Web         │──────────── vídeo WebRTC P2P direto ────────►│  OBS Browser Source  │
│  B: App Nativo      │      (não passa pelo servidor depois         │  -> Virtual Camera   │
└─────────────────────┘       do handshake inicial)                  └──────────────────────┘
```

## Componentes

1. **Servidor de Sinalização (Vercel Functions)**
   - Rota WebSocket utilizando `@vercel/functions` e `experimental_upgradeWebSocket()`.
   - Responsável por trocar SDP (Offer/Answer) e candidatos ICE.
   - Padrão de Sala: Tokens dinâmicos no formato `Sala-Token`.

2. **Web App Transmissor e Receptor (Next.js + TypeScript)**
   - **`/transmitir`:** Obtém feed da câmera (`getUserMedia`), codifica (preferencialmente H.264), estabelece a conexão com o receptor via sinalização, exibe feedback visual.
   - **`/receber`:** Gera o token de sala, mostra QR Code para pareamento rápido, escuta WebRTC, exibe o `<video>` em tela cheia (opção `?clean=1` para OBS).

3. **Android App Transmissor Nativo (Kotlin + CameraX)**
   - Utiliza `io.getstream:stream-webrtc-android`.
   - Roda em *Foreground Service* (`FOREGROUND_SERVICE_CAMERA`) para permitir transmissão com tela apagada.
   - Interface de pareamento idêntica à da Web (Leitor de QR Code integrado).

## Decisões Técnicas & Trade-offs
- **Sinalização WebSockets na Vercel:** Beta pública, mas ideal para reduzir dependências externas. Fallback previsto: Firebase Realtime Database.
- **Integração com Videoconferência:** Utilizamos OBS Virtual Camera por ser universal, estável e livre da fragilidade e complexidade (além do custo da licença Apple Developer) de desenvolver uma extensão `CoreMediaIO` no macOS neste momento (Fase 4 opcional).
- **Isolamento de Rede (Limitação Conhecida):** Redes com "Client/AP isolation" (comum em redes Guest) impedirão a conexão P2P. Nesses casos, o fallback STUN/TURN será exigido caso configurado. STUN público gratuito do Google (`stun.l.google.com:19302`) será utilizado.
