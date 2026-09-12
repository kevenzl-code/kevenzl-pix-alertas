require("dotenv").config();

const express = require("express");
const crypto = require("crypto");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 10000;
const HOST = "0.0.0.0";

app.use(express.json());
app.use(express.static("public"));


// ========================================
// MEMÓRIA TEMPORÁRIA
// ========================================

const donations = new Map();

const subscribers = new Set();

const audios = new Map();


// ========================================
// VOZ PADRÃO ELEVENLABS
// ========================================
//
// Depois podemos trocar por outra voz.
// Se criarmos ELEVENLABS_VOICE_ID no Render,
// ela terá prioridade.
//

const DEFAULT_VOICE_ID =
  "JBFqnCBsd6RMkjVDRZzb";


// ========================================
// TIER DA DOAÇÃO
// ========================================

function tierFor(amount) {

  if (amount < 10) {
    return "basic";
  }

  if (amount < 25) {
    return "medium";
  }

  if (amount < 50) {
    return "epic";
  }

  if (amount < 100) {
    return "special";
  }

  return "legendary";
}


// ========================================
// LIMPAR TEXTO
// ========================================

function cleanText(text) {

  if (!text) {
    return "";
  }

  return String(text)
    .replace(
      /(https?:\/\/[^\s]+)/gi,
      ""
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim()
    .slice(
      0,
      250
    );
}


// ========================================
// TRANSMITIR PARA O OVERLAY
// ========================================

function broadcast(payload) {

  const data =
    `data: ${JSON.stringify(payload)}\n\n`;

  for (const res of subscribers) {

    try {

      res.write(data);

    } catch {

      subscribers.delete(res);

    }
  }
}


// ========================================
// GERAR VOZ ELEVENLABS
// ========================================

async function generateTTS(
  name,
  amount,
  message
) {

  if (!process.env.ELEVENLABS_API_KEY) {

    console.log(
      "ElevenLabs não configurada."
    );

    return null;
  }


  const safeName =
    cleanText(name) ||
    "Alguém";


  const safeMessage =
    cleanText(message);


  const value =
    Number(amount);


  const money =
    value.toLocaleString(
      "pt-BR",
      {
        style: "currency",
        currency: "BRL"
      }
    );


  let text =
    `${safeName} enviou ${money}.`;


  if (safeMessage) {

    text +=
      ` ${safeMessage}`;

  }


  const voiceId =
    process.env.ELEVENLABS_VOICE_ID ||
    DEFAULT_VOICE_ID;


  console.log(
    "Gerando voz ElevenLabs..."
  );


  const response =
    await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
      {
        method: "POST",

        headers: {

          "xi-api-key":
            process.env.ELEVENLABS_API_KEY,

          "Content-Type":
            "application/json",

          Accept:
            "audio/mpeg"
        },

        body: JSON.stringify({

          text,

          model_id:
            "eleven_multilingual_v2",

          voice_settings: {

            stability:
              0.5,

            similarity_boost:
              0.75,

            style:
              0.15,

            use_speaker_boost:
              true
          }
        })
      }
    );


  if (!response.ok) {

    const errorText =
      await response.text();


    console.error(
      "ERRO ELEVENLABS:",
      response.status,
      errorText
    );


    return null;
  }


  const arrayBuffer =
    await response.arrayBuffer();


  const buffer =
    Buffer.from(
      arrayBuffer
    );


  const audioId =
    crypto.randomUUID();


  audios.set(
    audioId,
    {
      buffer,
      createdAt:
        Date.now()
    }
  );


  // apagar automaticamente
  // depois de 2 minutos

  setTimeout(
    () => {

      audios.delete(
        audioId
      );

    },
    120000
  );


  console.log(
    "Voz criada com sucesso."
  );


  return audioId;
}


// ========================================
// HEALTH CHECK
// ========================================

app.get(
  "/api/health",
  (req, res) => {

    res.json({

      ok: true,

      mercadopagoConfigured:
        Boolean(
          process.env.MP_ACCESS_TOKEN
        ),

      elevenlabsConfigured:
        Boolean(
          process.env.ELEVENLABS_API_KEY
        )
    });
  }
);


// ========================================
// CRIAR PIX
// ========================================

app.post(
  "/api/create-pix",
  async (req, res) => {

    try {

      const {
        amount,
        name,
        email,
        message = ""
      } = req.body;


      const value =
        Number(amount);


      if (
        !Number.isFinite(value) ||
        value < 1 ||
        value > 10000
      ) {

        return res
          .status(400)
          .json({

            error:
              "Valor inválido. Use entre R$ 1 e R$ 10.000."
          });
      }


      if (
        !name ||
        String(name)
          .trim()
          .length < 2
      ) {

        return res
          .status(400)
          .json({

            error:
              "Informe seu nome."
          });
      }


      if (
        !email ||
        !String(email)
          .includes("@")
      ) {

        return res
          .status(400)
          .json({

            error:
              "Informe um e-mail válido."
          });
      }


      if (
        !process.env.MP_ACCESS_TOKEN
      ) {

        return res
          .status(500)
          .json({

            error:
              "Mercado Pago ainda não está configurado no servidor."
          });
      }


      const externalReference =
        `kevenzl_${crypto.randomUUID()}`;


      const idempotencyKey =
        crypto.randomUUID();


      const donation = {

        externalReference,

        amount:
          value,

        name:
          String(name)
            .trim(),

        email:
          String(email)
            .trim(),

        message:
          String(message)
            .trim(),

        tier:
          tierFor(value),

        status:
          "pending",

        createdAt:
          new Date()
            .toISOString()
      };


      const orderBody = {

        type:
          "online",

        total_amount:
          value.toFixed(2),

        external_reference:
          externalReference,

        processing_mode:
          "automatic",


        payer: {

          email:
            String(email)
              .trim(),

          // usado no teste do Mercado Pago
          first_name:
            "APRO"
        },


        transactions: {

          payments: [

            {

              amount:
                value.toFixed(2),

              payment_method: {

                id:
                  "pix",

                type:
                  "bank_transfer"
              }
            }
          ]
        }
      };


      const response =
        await fetch(
          "https://api.mercadopago.com/v1/orders",
          {

            method:
              "POST",

            headers: {

              Authorization:
                `Bearer ${process.env.MP_ACCESS_TOKEN}`,

              "Content-Type":
                "application/json",

              Accept:
                "application/json",

              "X-Idempotency-Key":
                idempotencyKey
            },

            body:
              JSON.stringify(
                orderBody
              )
          }
        );


      const rawText =
        await response.text();


      let data;


      try {

        data =
          JSON.parse(
            rawText
          );

      } catch {

        data = {
          raw:
            rawText
        };
      }


      if (!response.ok) {

        console.error(
          "ERRO MERCADO PAGO COMPLETO:",
          JSON.stringify(
            {

              status:
                response.status,

              statusText:
                response.statusText,

              response:
                data

            },
            null,
            2
          )
        );


        return res
          .status(
            response.status ||
            502
          )
          .json({

            error:
              "Mercado Pago recusou a criação do Pix.",

            mercadopagoStatus:
              response.status,

            details:
              data
          });
      }


      const payment =
        data
          ?.transactions
          ?.payments
          ?.[0];


      donation.orderId =
        data.id;


      donation.status =
        data.status ||
        payment?.status ||
        "pending";


      donations.set(
        String(
          data.id
        ),
        donation
      );


      res.json({

        orderId:
          data.id,

        status:
          donation.status,


        ticketUrl:

          payment
            ?.payment_method
            ?.ticket_url ||

          payment
            ?.ticket_url ||

          null,


        qrCode:

          payment
            ?.payment_method
            ?.qr_code ||

          payment
            ?.qr_code ||

          null,


        qrCodeBase64:

          payment
            ?.payment_method
            ?.qr_code_base64 ||

          payment
            ?.qr_code_base64 ||

          null
      });

    } catch (error) {

      console.error(
        "Erro interno em /api/create-pix:",
        error
      );


      res
        .status(500)
        .json({

          error:
            "Erro interno ao criar o Pix."
        });
    }
  }
);


// ========================================
// WEBHOOK MERCADO PAGO
// ========================================

app.post(
  "/api/webhook/mercadopago",
  async (req, res) => {

    // responde rapidamente
    // ao Mercado Pago

    res.sendStatus(200);


    try {

      console.log(
        "Webhook recebido:",
        JSON.stringify(
          req.body
        )
      );


      const orderId =
        req.body
          ?.data
          ?.id;


      if (
        !orderId ||
        !process.env.MP_ACCESS_TOKEN
      ) {

        return;
      }


      const response =
        await fetch(
          `https://api.mercadopago.com/v1/orders/${encodeURIComponent(orderId)}`,
          {

            headers: {

              Authorization:
                `Bearer ${process.env.MP_ACCESS_TOKEN}`,

              Accept:
                "application/json"
            }
          }
        );


      if (!response.ok) {

        console.error(
          "Erro ao consultar ordem no webhook:",
          response.status,
          await response.text()
        );

        return;
      }


      const order =
        await response.json();


      const payment =
        order
          ?.transactions
          ?.payments
          ?.[0];


      const donation =
        donations.get(
          String(orderId)
        );


      if (!donation) {

        console.log(
          "Doação não encontrada na memória:",
          orderId
        );

        return;
      }


      donation.status =
        order.status ||
        payment?.status ||
        "pending";


      console.log(
        "Status da ordem:",
        donation.status,
        payment?.status_detail
      );


      const approved =

        order.status ===
          "processed" ||

        payment?.status ===
          "processed" ||

        payment?.status ===
          "approved" ||

        payment?.status_detail ===
          "accredited";


      if (
        approved &&
        !donation.alertSent
      ) {

        donation.alertSent =
          true;


        // ============================
        // GERAR VOZ IA
        // ============================

        let audioId = null;


        try {

          audioId =
            await generateTTS(
              donation.name,
              donation.amount,
              donation.message
            );

        } catch (error) {

          console.error(
            "Erro ao gerar voz:",
            error
          );
        }


        // ============================
        // ENVIAR ALERTA
        // ============================

        broadcast({

          type:
            "donation",

          orderId:
            String(orderId),

          amount:
            donation.amount,

          name:
            donation.name,

          message:
            donation.message,

          tier:
            donation.tier,

          audioUrl:
            audioId
              ? `/api/audio/${audioId}`
              : null
        });


        console.log(
          "Alerta enviado ao overlay."
        );
      }

    } catch (error) {

      console.error(
        "Webhook error:",
        error
      );
    }
  }
);


// ========================================
// ÁUDIO GERADO
// ========================================

app.get(
  "/api/audio/:audioId",
  (req, res) => {

    const audio =
      audios.get(
        String(
          req.params.audioId
        )
      );


    if (!audio) {

      return res
        .status(404)
        .send(
          "Áudio não encontrado."
        );
    }


    res.setHeader(
      "Content-Type",
      "audio/mpeg"
    );


    res.setHeader(
      "Cache-Control",
      "no-store"
    );


    res.send(
      audio.buffer
    );
  }
);


// ========================================
// STATUS DA DOAÇÃO
// ========================================

app.get(
  "/api/status/:orderId",
  (req, res) => {

    const donation =
      donations.get(
        String(
          req.params.orderId
        )
      );


    if (!donation) {

      return res
        .status(404)
        .json({

          error:
            "Doação não encontrada."
        });
    }


    res.json({

      orderId:
        donation.orderId,

      status:
        donation.status,

      amount:
        donation.amount,

      name:
        donation.name,

      message:
        donation.message,

      tier:
        donation.tier
    });
  }
);


// ========================================
// STREAM DO OVERLAY
// ========================================

app.get(
  "/api/overlay/stream",
  (req, res) => {

    res.setHeader(
      "Content-Type",
      "text/event-stream"
    );


    res.setHeader(
      "Cache-Control",
      "no-cache"
    );


    res.setHeader(
      "Connection",
      "keep-alive"
    );


    res.flushHeaders?.();


    subscribers.add(
      res
    );


    res.write(
      `data: ${JSON.stringify(
        {
          type:
            "connected"
        }
      )}\n\n`
    );


    req.on(
      "close",
      () => {

        subscribers.delete(
          res
        );
      }
    );
  }
);


// ========================================
// PÁGINA DO OVERLAY
// ========================================

app.get(
  "/overlay",
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        "public",
        "overlay.html"
      )
    );
  }
);


// ========================================
// INICIAR SERVIDOR
// ========================================

app.listen(
  PORT,
  HOST,
  () => {

    console.log(
      `KevenZL Pix Alertas na porta ${PORT}`
    );

    console.log(
      "Mercado Pago:",
      process.env.MP_ACCESS_TOKEN
        ? "OK"
        : "NÃO CONFIGURADO"
    );

    console.log(
      "ElevenLabs:",
      process.env.ELEVENLABS_API_KEY
        ? "OK"
        : "NÃO CONFIGURADO"
    );
  }
);
