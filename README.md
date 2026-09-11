# KevenZL Pix Alertas
Starter para Mercado Pago Orders + Pix + Webhook + Overlay OBS.
## Desenvolvimento
1. Instale Node.js 18+.
2. `npm install`
3. Copie `.env.example` para `.env`.
4. Preencha `MP_ACCESS_TOKEN` somente no ambiente do servidor.
5. `npm start`.
Overlay: `/overlay`.
Antes de produção: validar assinatura HMAC do webhook, usar banco de dados, HTTPS e credenciais de produção.
